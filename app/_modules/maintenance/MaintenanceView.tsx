"use client";

// app/_modules/maintenance/MaintenanceView.tsx — écran Maintenance (module 0046), mobile-first.
// Autonome : reçoit le client supabase partagé + le rôle. La RLS 0046 est la frontière dure (écriture
// direction) ; le front reflète la même règle (canManageMaintenance). Aucune donnée inventée.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUSES,
  INTERVENTION_KINDS,
  INTERVENTION_PRIORITIES,
  canManageMaintenance,
  formatCostEuro,
  maintenanceSummary,
  sortInterventions,
  statusLabel,
  validateInterventionDraft,
  type Equipment,
  type MaintenanceIntervention,
} from "@/lib/maintenance";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export default function MaintenanceView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = canManageMaintenance(role);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [interventions, setInterventions] = useState<MaintenanceIntervention[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Nouvel équipement
  const [eqName, setEqName] = useState("");
  const [eqCat, setEqCat] = useState<string>("general");
  const [eqStatus, setEqStatus] = useState<string>("ok");
  // Nouvelle intervention
  const [ivEquip, setIvEquip] = useState<string>("");
  const [ivKind, setIvKind] = useState<string>("panne");
  const [ivPriority, setIvPriority] = useState<string>("normale");
  const [ivDesc, setIvDesc] = useState("");

  // Pas de setState SYNCHRONE ici (l'état initial `loading=true` couvre le 1er chargement) : le premier
  // setState survient APRÈS l'await → évite la cascade de rendus (react-hooks/set-state-in-effect).
  const load = useCallback(async () => {
    const [eq, iv] = await Promise.all([
      supabase.from("equipment").select("*").order("status", { ascending: true }),
      supabase.from("maintenance_interventions").select("*"),
    ]);
    if (eq.error) setError(eq.error.message);
    else setEquipment((eq.data || []) as Equipment[]);
    if (!iv.error) setInterventions((iv.data || []) as MaintenanceIntervention[]);
    setLoading(false);
  }, [supabase]);

  // Chargement initial : IIFE async avec garde de montage. Le setState est POST-await (jamais synchrone
  // dans l'effet) → pas de cascade de rendus. `load` (ci-dessus) sert aux rechargements après mutation.
  useEffect(() => {
    let active = true;
    (async () => {
      const [eq, iv] = await Promise.all([
        supabase.from("equipment").select("*").order("status", { ascending: true }),
        supabase.from("maintenance_interventions").select("*"),
      ]);
      if (!active) return;
      if (eq.error) setError(eq.error.message);
      else setEquipment((eq.data || []) as Equipment[]);
      if (!iv.error) setInterventions((iv.data || []) as MaintenanceIntervention[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const summary = useMemo(() => maintenanceSummary(equipment, interventions), [equipment, interventions]);
  const sortedInterventions = useMemo(() => sortInterventions(interventions), [interventions]);
  const equipById = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);

  async function addEquipment() {
    setError("");
    if (!eqName.trim()) {
      setError("Nom de l'équipement requis.");
      return;
    }
    const { error: e } = await supabase.from("equipment").insert({ name: eqName.trim(), category: eqCat, status: eqStatus });
    if (e) {
      setError(`Ajout équipement refusé : ${e.message}`);
      return;
    }
    setEqName("");
    await load();
  }

  async function addIntervention() {
    setError("");
    const draft = { equipment_id: ivEquip, kind: ivKind, priority: ivPriority };
    const check = validateInterventionDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("maintenance_interventions").insert({
      equipment_id: ivEquip,
      kind: ivKind,
      priority: ivPriority,
      status: "ouvert",
      description: ivDesc.trim() || null,
      reported_by: username,
    });
    if (e) {
      setError(`Ajout intervention refusé : ${e.message}`);
      return;
    }
    setIvDesc("");
    await load();
  }

  async function resolveIntervention(id: string) {
    setError("");
    const { error: e } = await supabase
      .from("maintenance_interventions")
      .update({ status: "resolu", resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (e) {
      setError(`Résolution refusée : ${e.message}`);
      return;
    }
    await load();
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black">{summary.parcTotal}</div>
          <div className="text-[10px] uppercase text-white/50">Parc</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-red-400">{summary.enPanne + summary.horsService}</div>
          <div className="text-[10px] uppercase text-white/50">Panne / HS</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-orange-400">{summary.interventionsOuvertes}</div>
          <div className="text-[10px] uppercase text-white/50">Ouvertes {summary.urgentes > 0 ? `(${summary.urgentes} 🔴)` : ""}</div>
        </div>
      </div>
      <div className="text-center text-xs text-white/60">
        Coût des interventions ouvertes renseignées : <b className="text-white">{formatCostEuro(summary.coutOuvertCents)}</b>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>
      )}

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Ajouter un équipement</div>
          <div className="space-y-2">
            <input className={INPUT} placeholder="Nom (ex. Ampli façade)" value={eqName} onChange={(e) => setEqName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={eqCat} onChange={(e) => setEqCat(e.target.value)}>
                {EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className={INPUT} value={eqStatus} onChange={(e) => setEqStatus(e.target.value)}>
                {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </div>
            <button className={BTN} onClick={addEquipment} disabled={!eqName.trim()}>Ajouter</button>
          </div>
        </div>
      )}

      {canManage && equipment.length > 0 && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Signaler une intervention</div>
          <div className="space-y-2">
            <select className={INPUT} value={ivEquip} onChange={(e) => setIvEquip(e.target.value)}>
              <option value="">— équipement —</option>
              {equipment.map((eq) => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={ivKind} onChange={(e) => setIvKind(e.target.value)}>
                {INTERVENTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select className={INPUT} value={ivPriority} onChange={(e) => setIvPriority(e.target.value)}>
                {INTERVENTION_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <input className={INPUT} placeholder="Description (optionnel)" value={ivDesc} onChange={(e) => setIvDesc(e.target.value)} />
            <button className={BTN} onClick={addIntervention} disabled={!ivEquip}>Signaler</button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Interventions</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : sortedInterventions.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucune intervention. Le parc est sain (ou rien n’a encore été saisi).</div>
        ) : (
          <ul className="space-y-2">
            {sortedInterventions.map((iv) => {
              const eq = equipById.get(iv.equipment_id);
              const open = iv.status === "ouvert" || iv.status === "en_cours";
              return (
                <li key={iv.id} className={`${CARD} flex items-center justify-between gap-2`}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{eq?.name ?? "Équipement supprimé"}</div>
                    <div className="text-[11px] text-white/50">
                      {iv.kind} · <span className={iv.priority === "urgente" ? "text-red-400 font-bold" : ""}>{iv.priority}</span> · {statusLabel(iv.status)}
                      {iv.description ? ` — ${iv.description}` : ""}
                    </div>
                  </div>
                  {canManage && open && (
                    <button className="shrink-0 rounded-lg border border-white/20 px-2 py-1 text-[11px]" onClick={() => resolveIntervention(iv.id)}>
                      Résoudre
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Parc ({equipment.length})</div>
        {equipment.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucun équipement saisi. La direction constitue le parc réel.</div>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {equipment.map((eq) => (
              <li key={eq.id} className={CARD}>
                <div className="truncate text-sm font-bold">{eq.name}</div>
                <div className="text-[11px] text-white/50">{eq.category} · {statusLabel(eq.status)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
