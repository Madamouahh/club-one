"use client";

// app/_modules/budget/BudgetView.tsx — écran Budget PRÉVU/RÉEL (0051), mobile-first, autonome.
// RLS 0051 = frontière dure (lecture ET écriture direction). Le RÉEL est CROISÉ depuis les tables déjà
// vivantes (caisse_z 0010 · soiree_charges 0012 · staff_shifts 0011 · stock_movements 0047 ·
// maintenance_interventions 0046) et rangé par poste via computeRealFromSources (lib/budget, PUR).
// Honnêteté DURE : un poste sans source valorisée affiche « NON CONNECTÉ » — JAMAIS 0 € inventé,
// JAMAIS un prévu maquillé en réel, JAMAIS un coût partiel/estimé présenté comme réel comptable.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  BUDGET_POSTES,
  canManageBudget,
  canViewBudget,
  budgetSummary,
  computeRealFromSources,
  formatEuro,
  formatVariance,
  validateForecastDraft,
  variance,
  type BudgetForecast,
  type RealByPoste,
} from "@/lib/budget";
import type { CaisseZRecord } from "@/lib/caisseZ";
import { summarizeCaisse } from "@/lib/pnlSoiree";
import { buildPeriodStaffRollup, periodStaffChargeAmount } from "@/lib/rhRollup";
import type { StaffMember, StaffShift } from "@/lib/rhPlanning";
import { chargeCost, type SoireeCharge } from "@/lib/artistesExtras";

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

  // RÉEL croisé, rangé par poste (null par poste = NON CONNECTÉ). null tant que le croisement charge.
  const [real, setReal] = useState<RealByPoste | null>(null);
  const [realLoading, setRealLoading] = useState(canView);

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

  // Croisement RÉEL : lit les sources déjà vivantes (chacune filtrée par SA propre RLS) et les réduit
  // en cents par poste. AUCUNE écriture. Toute la logique de mapping/honnêteté vit dans lib/budget +
  // les summaries des modules — ce View ne fait qu'agréger et n'invente aucun montant.
  useEffect(() => {
    if (!canView) return;
    let active = true;
    (async () => {
      const results = await Promise.all([
        supabase.from("caisse_z").select("exploitation_date, venue, ca_ttc, familles, offerts_ttc, nb_tickets"),
        supabase.from("soiree_charges").select("id, exploitation_date, event_id, categorie, label, montant_ttc, statut"),
        supabase.from("staff_shifts").select("*"),
        supabase.from("staff_members").select("*"),
        supabase.from("stock_items").select("id, unit_cost_cents"),
        supabase.from("stock_movements").select("item_id, kind, qty"),
        supabase.from("maintenance_interventions").select("cost_cents"),
      ]);
      if (!active) return;
      const firstError = results.find((r) => r.error)?.error;
      if (firstError) {
        setError(`Croisement réel indisponible : ${firstError.message}`);
        setRealLoading(false);
        return;
      }
      const [caisseR, chargesR, shiftsR, membersR, itemsR, movesR, maintR] = results.map((r) => r.data || []);

      // ── ca_tables ← caisse_z : CA réel par soirée (summarizeCaisse évite le double-compte
      //    complexe/univers), sommé sur toutes les soirées. euros → cents. Aucun Z ⇒ null.
      const caisseRows = caisseR as CaisseZRecord[];
      const byDate = new Map<string, CaisseZRecord[]>();
      for (const r of caisseRows) {
        const bucket = byDate.get(r.exploitation_date);
        if (bucket) bucket.push(r);
        else byDate.set(r.exploitation_date, [r]);
      }
      let caEuros = 0;
      let anyCaisse = false;
      for (const rows of byDate.values()) {
        const s = summarizeCaisse(rows);
        if (s.available) {
          caEuros += s.caTotal;
          anyCaisse = true;
        }
      }
      const caTablesCents = anyCaisse ? Math.round(caEuros * 100) : null;

      // ── artistes ← soiree_charges : coûts ENGAGÉS (confirmé/payé) ET chiffrés (chargeCost). Un poste
      //    engagé sans montant est ignoré (pas de total tronqué). euros → cents. Aucun coût ⇒ null.
      let artEuros = 0;
      let artCount = 0;
      for (const c of chargesR as SoireeCharge[]) {
        const cost = chargeCost(c);
        if (cost != null) {
          artEuros += cost;
          artCount += 1;
        }
      }
      const artistesCents = artCount > 0 ? Math.round(artEuros * 100) : null;

      // ── personnel ← staff_shifts + staff_members (rhRollup) : coût staff de la période, branché
      //    UNIQUEMENT s'il est COMPLET (periodStaffChargeAmount → null sinon). Jamais un coût partiel
      //    présenté comme réel. euros → cents.
      const rollup = buildPeriodStaffRollup(shiftsR as StaffShift[], membersR as StaffMember[]);
      const staffEuros = periodStaffChargeAmount(rollup);
      const personnelCents = staffEuros == null ? null : Math.round(staffEuros * 100);

      // ── achats / pertes ← stock_movements valorisés au coût unitaire CONNU (unit_cost_cents). Un
      //    mouvement sans coût connu est ignoré ; aucune valorisation ⇒ null (jamais 0 fabriqué).
      const costById = new Map((itemsR as { id: string; unit_cost_cents?: number | null }[]).map((i) => [i.id, i.unit_cost_cents]));
      let achatsCents = 0;
      let achatsCount = 0;
      let pertesCents = 0;
      let pertesCount = 0;
      for (const m of movesR as { item_id: string; kind: string; qty: number }[]) {
        const c = costById.get(m.item_id);
        if (c == null) continue;
        const val = Math.abs(Number(m.qty) || 0) * c;
        if (m.kind === "entree") {
          achatsCents += val;
          achatsCount += 1;
        } else if (m.kind === "perte" || m.kind === "casse") {
          pertesCents += val;
          pertesCount += 1;
        }
      }

      // ── maintenance ← maintenance_interventions : somme des coûts RENSEIGNÉS (cost_cents en cents).
      let maintCents = 0;
      let maintCount = 0;
      for (const m of maintR as { cost_cents?: number | null }[]) {
        if (m.cost_cents != null && Number.isFinite(m.cost_cents)) {
          maintCents += m.cost_cents;
          maintCount += 1;
        }
      }

      setReal(
        computeRealFromSources({
          caTablesCents,
          artistesCents,
          personnelCents,
          achatsCents: achatsCount > 0 ? achatsCents : null,
          pertesCents: pertesCount > 0 ? pertesCents : null,
          maintenanceCents: maintCount > 0 ? maintCents : null,
        }),
      );
      setRealLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, canView]);

  const summary = useMemo(() => budgetSummary(forecasts), [forecasts]);

  // Total réel des postes CONNECTÉS présents au prévisionnel (miroir du total prévu, honnête sur la
  // couverture : on annonce combien de postes restent non connectés plutôt qu'un total maquillé).
  const realTotals = useMemo(() => {
    if (!real) return null;
    let sum = 0;
    let connected = 0;
    let missing = 0;
    for (const p of summary.parPoste) {
      const r = real[p.poste];
      if (r != null) {
        sum += r;
        connected += 1;
      } else {
        missing += 1;
      }
    }
    return { sum, connected, missing };
  }, [real, summary.parPoste]);

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
          {realLoading ? (
            <div className="text-2xl font-black text-white/40">…</div>
          ) : realTotals && realTotals.connected > 0 ? (
            <div className="text-2xl font-black text-cyan-300">{formatEuro(realTotals.sum)}</div>
          ) : (
            <div className="text-2xl font-black text-white/40">NON CONNECTÉ</div>
          )}
          <div className="text-[10px] uppercase text-white/50">
            Réel{realTotals && realTotals.connected > 0 ? ` · ${realTotals.connected} poste(s) connecté(s)` : ""}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
        {realLoading
          ? "Croisement caisse / charges / staff / stock / maintenance · CHARGEMENT…"
          : realTotals && realTotals.missing > 0
            ? `Réel croisé · ${realTotals.missing} poste(s) sans source valorisée (NON CONNECTÉ)`
            : "Réel croisé : caisse_z · soiree_charges · staff · stock · maintenance"}
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
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-bold uppercase text-white/50">Prévu vs Réel par poste</div>
            {realLoading && <span className="text-[10px] text-white/40">croisement…</span>}
          </div>
          <ul className="space-y-2">
            {summary.parPoste.map((p) => {
              const reel = real ? real[p.poste] : undefined;
              const connected = reel != null;
              const v = variance(p.totalPrevuCents, reel);
              return (
                <li key={p.poste} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white/80">
                      {p.poste} <span className="text-[10px] text-white/40">({p.lignes})</span>
                    </span>
                    <span className={`text-xs font-black ${v.ecartCents == null ? "text-white/40" : v.ecartCents > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                      {formatVariance(v)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="text-white/60">Prévu <b className="text-white">{formatEuro(p.totalPrevuCents)}</b></div>
                    <div className="text-white/60">
                      Réel{" "}
                      {realLoading ? (
                        <span className="text-white/40">…</span>
                      ) : connected ? (
                        <b className="text-cyan-300">{formatEuro(reel)}</b>
                      ) : (
                        <span className="font-bold uppercase text-white/40">NON CONNECTÉ</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 text-[10px] leading-snug text-white/40">
            Réel croisé depuis les tables vivantes. « NON CONNECTÉ » = aucune source valorisée pour ce poste
            (publicité et « autre » n'ont aucune source ; personnel exige un coût staff complet) — jamais 0 € fabriqué.
          </div>
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
                  <div className="text-[9px] font-normal uppercase text-white/40">prévu · réel croisé par poste</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
