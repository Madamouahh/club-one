"use client";

// app/_modules/rh/StaffPerformanceTab.tsx — Assiduité du personnel (B7, migration 0066), autonome.
//
// AGRÉGATION HONNÊTE de faits réels (staff_shifts) — JAMAIS un score inventé. L'écran ne fait que lire
// la vue staff_performance_v1 (direction only, RLS 0011 via security_invoker) et l'afficher : comptages
// par statut + taux de présence honnête (« — » tant qu'aucune présence n'est pointée, jamais 0 %).
//
// Direction only : gardé côté UI (admin/manager) ET côté base (la vue renvoie vide à un salarié). La
// garde UI n'est qu'un confort — la vraie frontière est la RLS/garde SQL 0066.

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  formatPresenceRate,
  parseStaffPerformanceRows,
  performanceDataReady,
  staffPerformanceTeamTotals,
  type StaffPerformanceRow,
} from "@/lib/staffPerformance";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";

function isDirection(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

export default function StaffPerformanceTab({
  supabase,
  role,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const direction = isDirection(role);
  const [rows, setRows] = useState<StaffPerformanceRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!direction) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("staff_performance_v1")
        .select("*");
      if (!active) return;
      if (e) setError(e.message);
      else setRows(parseStaffPerformanceRows(data));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, direction]);

  const totals = useMemo(() => staffPerformanceTeamTotals(rows), [rows]);
  const ready = useMemo(() => performanceDataReady(rows), [rows]);

  // Garde UI (confort) : la frontière réelle est la vue direction-only 0066.
  if (!direction) {
    return (
      <div className="p-4 text-center text-sm text-white/50">
        Assiduité du personnel — réservé à la direction.
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black">{totals.staffTracked}</div>
          <div className="text-[10px] uppercase text-white/50">Salariés suivis</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-emerald-300">{totals.presentsTotal}</div>
          <div className="text-[10px] uppercase text-white/50">Présences</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-red-400">{totals.absentsTotal}</div>
          <div className="text-[10px] uppercase text-white/50">Absences</div>
        </div>
      </div>
      <div className="text-center text-xs text-white/60">
        Taux de présence équipe :{" "}
        <b className="text-white">{formatPresenceRate(totals.teamPresenceRate)}</b>
        {totals.latesTotal > 0 && (
          <span className="text-amber-300"> · {totals.latesTotal} retard{totals.latesTotal > 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
        Faits réels pointés (staff_shifts) · aucun score inventé
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Assiduité par salarié ({rows.length})</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : !ready.hasStaff ? (
          <div className="text-center text-sm text-white/40">
            Aucun salarié. La direction compose le répertoire dans l'onglet RH.
          </div>
        ) : !ready.hasShifts ? (
          <div className="text-center text-sm text-white/40">
            Aucun shift enregistré. L'assiduité apparaîtra dès que le planning et le pointage seront saisis.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.staff_member_id} className={CARD}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">
                      {r.full_name}
                      {!r.actif && <span className="ml-1 text-[10px] font-normal text-white/40">(inactif)</span>}
                    </div>
                    <div className="text-[11px] text-white/50">
                      @{r.username}
                      {r.poste ? ` · ${r.poste}` : ""}
                      {r.last_shift_date ? ` · dernier : ${r.last_shift_date}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`text-sm font-black ${
                        r.presence_rate == null
                          ? "text-white/40"
                          : r.presence_rate >= 0.9
                            ? "text-emerald-300"
                            : r.presence_rate >= 0.7
                              ? "text-amber-400"
                              : "text-red-400"
                      }`}
                    >
                      {formatPresenceRate(r.presence_rate)}
                    </div>
                    <div className="text-[9px] font-normal uppercase text-white/40">présence</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px]">
                  <Stat label="planifiés" value={r.shifts_planned} />
                  <Stat label="confirmés" value={r.shifts_confirmed} />
                  <Stat label="présents" value={r.shifts_present} tone="text-emerald-300" />
                  <Stat label="retards" value={r.shifts_late} tone={r.shifts_late > 0 ? "text-amber-300" : undefined} />
                  <Stat label="absents" value={r.shifts_absent} tone={r.shifts_absent > 0 ? "text-red-400" : undefined} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 py-1">
      <div className={`text-sm font-bold ${tone ?? "text-white"}`}>{value}</div>
      <div className="text-[8px] uppercase text-white/40">{label}</div>
    </div>
  );
}
