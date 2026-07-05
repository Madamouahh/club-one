"use client";

// app/_modules/budget/BudgetView.tsx — écran Budget PRÉVU/RÉEL (0051), mobile-first, autonome.
// RLS 0051 = frontière dure (lecture ET écriture direction). Le RÉEL n'est PAS géré ici : il vient du
// croisement caisse_z / soiree_charges / stock / maintenance — affiché « NON CONNECTÉ » tant que le
// cockpit de croisement n'est pas branché. JAMAIS 0 € inventé, JAMAIS un prévu maquillé en réel.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  BUDGET_POSTES,
  canManageBudget,
  canViewBudget,
  budgetSummary,
  formatEuro,
  validateForecastDraft,
  type BudgetForecast,
} from "@/lib/budget";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export default function BudgetView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = canManageBudget(role);
  const canView = canViewBudget(role);

  const [forecasts, setForecasts] = useState<BudgetForecast[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [fLabel, setFLabel] = useState("");
  const [fPoste, setFPoste] = useState<string>("artistes");
  const [fMontant, setFMontant] = useState("");

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("budget_forecasts")
      .select("*")
      .order("created_at", { ascending: false });
    if (e) setError(e.message);
    else setForecasts((data || []) as BudgetForecast[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("budget_forecasts")
        .select("*")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (e) setError(e.message);
      else setForecasts((data || []) as BudgetForecast[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const summary = useMemo(() => budgetSummary(forecasts), [forecasts]);

  async function addForecast() {
    setError("");
    const montantEuros = Number(fMontant);
    const draft = { label: fLabel, poste: fPoste, montant_prevu_euros: montantEuros };
    const check = validateForecastDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("budget_forecasts").insert({
      label: fLabel.trim(),
      poste: fPoste,
      montant_prevu_cents: Math.round(montantEuros * 100),
      created_by: username,
    });
    if (e) {
      setError(`Ligne de budget refusée : ${e.message}`);
      return;
    }
    setFLabel("");
    setFMontant("");
    await load();
  }

  // Lecture réservée à la direction (RLS 0051 direction-only) : garde honnête côté UI.
  if (!canView) {
    return (
      <div className="space-y-3 pb-4 text-white">
        <div className={`${CARD} text-center text-sm text-white/60`}>
          Le budget prévisionnel est réservé à la direction.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black text-emerald-300">{formatEuro(summary.totalPrevuCents)}</div>
          <div className="text-[10px] uppercase text-white/50">Total prévu</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-white/40">NON CONNECTÉ</div>
          <div className="text-[10px] uppercase text-white/50">Réel</div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
        Croisement caisse / charges / stock / maintenance · PRÊT À CONNECTER — NON ACTIVÉ
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>}

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Ajouter une ligne de budget prévu</div>
          <div className="space-y-2">
            <input
              className={INPUT}
              placeholder="Intitulé (ex. DJ résident février)"
              value={fLabel}
              onChange={(e) => setFLabel(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={fPoste} onChange={(e) => setFPoste(e.target.value)}>
                {BUDGET_POSTES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <input
                className={INPUT}
                inputMode="decimal"
                placeholder="Montant prévu €"
                value={fMontant}
                onChange={(e) => setFMontant(e.target.value)}
              />
            </div>
            <button className={BTN} onClick={addForecast} disabled={!fLabel.trim() || !fMontant}>
              Ajouter au prévisionnel
            </button>
          </div>
        </div>
      )}

      {summary.parPoste.length > 0 && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Prévu par poste</div>
          <ul className="space-y-1.5">
            {summary.parPoste.map((p) => (
              <li key={p.poste} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-white/70">{p.poste} <span className="text-[10px] text-white/40">({p.lignes})</span></span>
                <b className="text-white">{formatEuro(p.totalPrevuCents)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Lignes prévisionnelles ({forecasts.length})</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : forecasts.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucune ligne de budget. La direction saisit le prévisionnel réel.</div>
        ) : (
          <ul className="space-y-2">
            {forecasts.map((f) => (
              <li key={f.id} className={`${CARD} flex items-center justify-between gap-2`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{f.label}</div>
                  <div className="text-[11px] text-white/50">{f.poste}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black text-emerald-300">{formatEuro(f.montant_prevu_cents)}</div>
                  <div className="text-[9px] font-normal uppercase text-white/40">réel : non connecté</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
