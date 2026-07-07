"use client";

// app/_modules/reporting/ServerAttributionTab.tsx — attribution serveur↔table + RAPPORT PAR SERVEUR
// (migration 0060). Autonome (self-contained), mobile-first, direction-gated (admin/manager).
//
// Comble l'absence d'UI pour la table table_server_assignments : la direction attribue une table à un
// serveur (upsert on (event_id, table_id) — la contrainte UNIQUE interdit toute double attribution),
// change le serveur (edit), ou retire l'attribution (delete). Le RAPPORT PAR SERVEUR (buildServerReport,
// lib/serverReports) affiche, à partir des DONNÉES RÉELLES, les tables servies, le CA et la moyenne par
// serveur. Aucune donnée fabriquée : état vide honnête tant qu'aucune attribution n'existe.
//
// Sécurité : cet écran n'est PAS une frontière. La RLS 0060 (admin/manager plein ; server lit le sien)
// reste l'autorité. Le garde de rôle ci-dessous n'est qu'un miroir UI.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import { loadActiveEventContext, type ActiveEventContext } from "@/lib/activeEvent";
import {
  buildServerReport,
  type StaffRosterEntry,
  type ServerReportTable,
  type ServerTableAssignment,
  type ServerReportEntryLog,
  type ServerReportRow,
} from "@/lib/serverReports";
import {
  assignableServers,
  assignmentAction,
  detectConflicts,
  serverForTable,
} from "./serverAttributionHelpers";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const BTN_GHOST = "rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-white/70 disabled:opacity-40";

// Table telle que lue depuis club_tables (source de DÉPENSE + libellé d'affichage). L'attribution NE
// vient PAS de ce champ : club_tables n'a aucun serveur ; elle vient de table_server_assignments.
type TableRow = {
  id: string;
  zone?: string | null;
  expenses?: Array<{ id?: string | null; amount?: number | string | null }> | null;
};

// Ligne brute table_server_assignments (migration 0060).
type AssignmentRow = {
  table_id?: string | null;
  table_label?: string | null;
  server_username?: string | null;
};

function tableLabel(t: TableRow): string {
  const zone = typeof t.zone === "string" && t.zone.trim() ? t.zone.trim() : null;
  return zone ? `${t.id} · ${zone}` : t.id;
}

export default function ServerAttributionTab({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = role === "admin" || role === "manager";

  const [activeEvent, setActiveEvent] = useState<ActiveEventContext | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [roster, setRoster] = useState<StaffRosterEntry[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Sélection courante du formulaire d'attribution (table → serveur).
  const [selTable, setSelTable] = useState("");
  const [selServer, setSelServer] = useState("");

  const load = useCallback(async () => {
    setError("");
    // 1) Soirée active (event_id) : indispensable pour scoper les attributions.
    let ev: ActiveEventContext | null = null;
    try {
      ev = await loadActiveEventContext(supabase);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Événement actif indisponible.");
    }
    setActiveEvent(ev);

    // 2) Tables de la soirée active (source de dépense + libellé). club_tables est déjà scopé à la
    //    soirée active (reset à la clôture) + RLS : on lit tel quel, comme le fait page.tsx (fetchTables).
    const tablesRes = await supabase
      .from("club_tables")
      .select("id, zone, expenses")
      .order("id", { ascending: true });
    if (tablesRes.error) setError(tablesRes.error.message);
    else setTables((tablesRes.data || []) as TableRow[]);

    // 3) Roster role-authoritative (staff_roster_v1, direction-gated) → serveurs assignables.
    const rosterRes = await supabase.rpc("staff_roster_v1");
    if (!rosterRes.error && rosterRes.data) setRoster(rosterRes.data as StaffRosterEntry[]);

    // 4) Attributions existantes de la soirée active.
    if (ev?.eventId) {
      const asgRes = await supabase
        .from("table_server_assignments")
        .select("table_id, table_label, server_username")
        .eq("event_id", ev.eventId);
      if (asgRes.error) setError(asgRes.error.message);
      else setAssignments((asgRes.data || []) as AssignmentRow[]);
    } else {
      setAssignments([]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      await load();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [canManage, load]);

  const servers = useMemo(() => assignableServers(roster), [roster]);
  const conflicts = useMemo(() => detectConflicts(assignments as ServerTableAssignment[]), [assignments]);

  // Rapport par serveur sur données RÉELLES (roster + attributions + dépenses des tables).
  const report: ServerReportRow[] = useMemo(() => {
    const reportTables: ServerReportTable[] = tables.map((t) => ({ id: t.id, expenses: t.expenses ?? [] }));
    const reportAssignments: ServerTableAssignment[] = assignments.map((a) => ({
      table_id: a.table_id,
      server_username: a.server_username,
    }));
    const entries: ServerReportEntryLog[] = [];
    return buildServerReport(roster, reportTables, reportAssignments, { entries });
  }, [roster, tables, assignments]);

  const action = useMemo(
    () => assignmentAction(assignments as ServerTableAssignment[], selTable, selServer),
    [assignments, selTable, selServer],
  );

  async function assign(tableId: string, server: string) {
    if (!activeEvent?.eventId) {
      setError("Aucune soirée active : impossible d'attribuer.");
      return;
    }
    const table = tables.find((t) => t.id === tableId);
    setBusy(true);
    setError("");
    // Upsert on (event_id, table_id) = INSERT ... ON CONFLICT DO UPDATE : create ET edit passent par là.
    // La contrainte UNIQUE(event_id, table_id) garantit qu'une table n'a JAMAIS deux serveurs.
    const { error: e } = await supabase
      .from("table_server_assignments")
      .upsert(
        {
          event_id: activeEvent.eventId,
          table_id: tableId,
          table_label: table ? tableLabel(table) : tableId,
          server_username: server,
          assigned_by: username,
        },
        { onConflict: "event_id,table_id" },
      );
    if (e) setError(`Attribution refusée : ${e.message}`);
    else {
      setSelTable("");
      setSelServer("");
    }
    await load();
    setBusy(false);
  }

  async function remove(tableId: string) {
    if (!activeEvent?.eventId) return;
    setBusy(true);
    setError("");
    const { error: e } = await supabase
      .from("table_server_assignments")
      .delete()
      .eq("event_id", activeEvent.eventId)
      .eq("table_id", tableId);
    if (e) setError(`Retrait refusé : ${e.message}`);
    await load();
    setBusy(false);
  }

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-white/50">
        Attribution des serveurs réservée à la direction.
      </div>
    );
  }

  if (loading) {
    return <div className="py-10 text-center text-sm text-white/40">Chargement…</div>;
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-wide text-white/50">Attribution serveurs · rapport par serveur</div>
        <div className="text-[11px] text-white/40">
          {activeEvent ? `Soirée active · ${activeEvent.venueName || activeEvent.eventDate}` : "Aucune soirée active"}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-bold text-amber-200">
          Attribution incohérente détectée (table servie par plusieurs serveurs) : {conflicts.join(", ")}. La base devrait l'empêcher — vérifier.
        </div>
      )}

      {!activeEvent ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-white/50">
          Aucune soirée active. Activez une soirée pour attribuer les tables aux serveurs.
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-white/50">
          Aucun serveur au roster. Ajoutez un compte de rôle « serveur » pour pouvoir attribuer.
        </div>
      ) : (
        <>
          {/* Formulaire d'attribution rapide */}
          <div className={CARD}>
            <div className="mb-2 text-xs font-bold uppercase text-white/50">Attribuer une table</div>
            <div className="space-y-2">
              <select className={INPUT} value={selTable} onChange={(e) => setSelTable(e.target.value)}>
                <option value="">— table —</option>
                {tables.map((t) => {
                  const cur = serverForTable(assignments as ServerTableAssignment[], t.id);
                  return (
                    <option key={t.id} value={t.id}>
                      {tableLabel(t)}{cur ? ` (→ ${cur})` : ""}
                    </option>
                  );
                })}
              </select>
              <select className={INPUT} value={selServer} onChange={(e) => setSelServer(e.target.value)}>
                <option value="">— serveur —</option>
                {servers.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                className={BTN}
                disabled={busy || !selTable || !selServer || action === "noop"}
                onClick={() => assign(selTable, selServer)}
              >
                {action === "update" ? "Changer le serveur" : action === "noop" ? "Déjà attribué" : "Attribuer"}
              </button>
            </div>
          </div>

          {/* Liste des tables : attribution en ligne, edit/retrait */}
          <div>
            <div className="mb-2 text-xs font-bold uppercase text-white/50">Tables ({tables.length})</div>
            {tables.length === 0 ? (
              <div className="text-center text-sm text-white/40">Aucune table pour cette soirée.</div>
            ) : (
              <ul className="space-y-2">
                {tables.map((t) => {
                  const cur = serverForTable(assignments as ServerTableAssignment[], t.id);
                  return (
                    <li key={t.id} className={`${CARD} space-y-2`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-sm font-bold">{tableLabel(t)}</div>
                        <div className={`shrink-0 text-xs font-bold ${cur ? "text-emerald-300" : "text-white/40"}`}>
                          {cur ? cur : "non attribué"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          className={`${INPUT} flex-1`}
                          value={cur ?? ""}
                          disabled={busy}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) assign(t.id, v);
                          }}
                        >
                          <option value="">— attribuer —</option>
                          {servers.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <button className={BTN_GHOST} disabled={busy || !cur} onClick={() => remove(t.id)}>
                          Retirer
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Rapport par serveur (données réelles) */}
      <div className={CARD}>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Rapport par serveur</div>
        {report.length === 0 ? (
          <div className="text-center text-sm text-white/40">
            Aucune attribution pour le moment. Attribuez une table à un serveur pour voir son rapport.
          </div>
        ) : (
          <ul className="space-y-2">
            {report.map((r) => (
              <li key={r.server} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{r.server}</div>
                  <div className="text-[11px] text-white/50">
                    {r.tablesServed} table{r.tablesServed > 1 ? "s" : ""} · moy. {r.averagePerTableCents == null ? "—" : `${r.averagePerTableCents}€`}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black text-cyan-300">{r.totalSpendCents}€</div>
                  <div className="text-[9px] uppercase text-white/40">CA servi</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
