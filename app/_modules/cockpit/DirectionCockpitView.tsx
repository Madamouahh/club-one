"use client";

// app/_modules/cockpit/DirectionCockpitView.tsx — COCKPIT DIRECTION (agrégat décisionnel), lecture seule.
// N'écrit AUCUNE donnée (D-01) : lit les sources existantes (filtrées par LEUR RLS) et réutilise les
// summaries des modules. Réservé à la direction (admin/manager). Honnêteté : postes non connectés = marqués.

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import { frequentation, estimatedMargin, globalAlertLevel, pendingDecisions, formatEuro } from "@/lib/directionCockpit";
import { stockSummary } from "@/lib/stock";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const ALERT_STYLE: Record<string, string> = {
  critique: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  attention: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

type Row = Record<string, unknown>;

export default function DirectionCockpitView({ supabase, role }: { supabase: SupabaseClient; role: StaffRole }) {
  const isDirection = role === "admin" || role === "manager";
  const [d, setD] = useState<{
    caCents: number;
    occupees: number;
    total: number;
    entryLogs: { type: string }[];
    incidentsActifs: number;
    incidentsCritiques: number;
    stockRuptures: number;
    stockSousSeuil: number;
    stockValeurCents: number;
    maintUrgente: number;
    maintOuvertes: number;
    leadsNouveaux: number;
    pipelineCents: number;
    campActives: number;
    campBrouillon: number;
    resaPending: number;
    chargesCents: number;
    pertesCents: number;
  } | null>(null);
  // loading initialisé selon le garde → pas de setState synchrone dans l'effet (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(role === "admin" || role === "manager");

  useEffect(() => {
    if (!isDirection) return;
    let active = true;
    (async () => {
      const A = "ouvert";
      const results = await Promise.all([
        supabase.from("club_tables").select("status, revenue_total"),
        supabase.from("entry_logs").select("type"),
        supabase.from("incidents").select("status, niveau"),
        supabase.from("stock_items").select("*"),
        supabase.from("stock_movements").select("*"),
        supabase.from("maintenance_interventions").select("priority, status"),
        supabase.from("commercial_leads").select("status, estimated_value_cents"),
        supabase.from("marketing_campaigns").select("status"),
        supabase.from("table_reservation_requests").select("status"),
        supabase.from("soiree_charges").select("montant_cents"),
      ]);
      if (!active) return;
      const [tbl, ent, inc, sit, smv, mnt, lead, camp, resa, chg] = results.map((r) => (r.data || []) as Row[]);
      const openStatuses = new Set([A, "en_cours", "escalade"]);
      const stock = stockSummary(sit as never[], smv as never[]);
      const pertes = (smv as Row[])
        .filter((m) => m.kind === "perte" || m.kind === "casse")
        .reduce((s, m) => {
          const it = (sit as Row[]).find((i) => i.id === m.item_id);
          const c = it?.unit_cost_cents as number | undefined;
          return c != null ? s + Math.abs(Number(m.qty) || 0) * c : s;
        }, 0);
      setD({
        caCents: Math.round((tbl as Row[]).reduce((s, t) => s + (Number(t.revenue_total) || 0), 0) * 100),
        occupees: (tbl as Row[]).filter((t) => t.status !== "free").length,
        total: (tbl as Row[]).length,
        entryLogs: ent as { type: string }[],
        incidentsActifs: (inc as Row[]).filter((i) => openStatuses.has(i.status as string)).length,
        incidentsCritiques: (inc as Row[]).filter((i) => openStatuses.has(i.status as string) && i.niveau === "critique").length,
        stockRuptures: stock.ruptures,
        stockSousSeuil: stock.sousSeuil,
        stockValeurCents: stock.valeurStockCents,
        maintUrgente: (mnt as Row[]).filter((m) => m.priority === "urgente" && (m.status === A || m.status === "en_cours")).length,
        maintOuvertes: (mnt as Row[]).filter((m) => m.status === A || m.status === "en_cours").length,
        leadsNouveaux: (lead as Row[]).filter((l) => l.status === "nouveau").length,
        pipelineCents: (lead as Row[]).filter((l) => l.status === "gagne").reduce((s, l) => s + (Number(l.estimated_value_cents) || 0), 0),
        campActives: (camp as Row[]).filter((c) => c.status === "active").length,
        campBrouillon: (camp as Row[]).filter((c) => c.status === "brouillon").length,
        resaPending: (resa as Row[]).filter((r) => r.status === "pending").length,
        chargesCents: (chg as Row[]).reduce((s, c) => s + (Number(c.montant_cents) || 0), 0),
        pertesCents: pertes,
      });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, isDirection]);

  if (!isDirection) {
    return <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">Cockpit direction réservé à la direction (admin / manager).</p>;
  }
  if (loading || !d) return <div className="p-6 text-center text-sm text-white/40">Chargement du cockpit direction…</div>;

  const freq = frequentation(d.entryLogs);
  const alert = globalAlertLevel({ incidentsCritiques: d.incidentsCritiques, stockRuptures: d.stockRuptures, maintenanceUrgente: d.maintUrgente });
  const coutsConnus = d.chargesCents + d.pertesCents;
  const marge = estimatedMargin(d.caCents, coutsConnus);
  const decisions = pendingDecisions({ resaPending: d.resaPending, leadsNouveaux: d.leadsNouveaux, campaignsBrouillon: d.campBrouillon });

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className={`rounded-2xl border px-3 py-2 text-center text-sm font-bold ${ALERT_STYLE[alert]}`}>
        État global : {alert === "critique" ? "🔴 CRITIQUE" : alert === "attention" ? "🟠 ATTENTION" : "🟢 OK"}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className={CARD}><div className="text-xl font-black text-cyan-300">{formatEuro(d.caCents)}</div><div className="text-[10px] uppercase text-white/50">CA tables (live)</div></div>
        <div className={CARD}><div className="text-xl font-black">{d.occupees}/{d.total}</div><div className="text-[10px] uppercase text-white/50">Tables occupées</div></div>
        <div className={CARD}><div className="text-xl font-black">{freq.present}</div><div className="text-[10px] uppercase text-white/50">Présents (E {freq.entrees} / S {freq.sorties})</div></div>
        <div className={CARD}><div className={`text-xl font-black ${d.incidentsCritiques ? "text-rose-400" : ""}`}>{d.incidentsActifs}</div><div className="text-[10px] uppercase text-white/50">Incidents actifs {d.incidentsCritiques ? `(${d.incidentsCritiques} crit.)` : ""}</div></div>
        <div className={CARD}><div className={`text-xl font-black ${d.stockRuptures ? "text-rose-400" : d.stockSousSeuil ? "text-amber-400" : ""}`}>{d.stockRuptures} / {d.stockSousSeuil}</div><div className="text-[10px] uppercase text-white/50">Ruptures / sous seuil</div></div>
        <div className={CARD}><div className={`text-xl font-black ${d.maintUrgente ? "text-rose-400" : ""}`}>{d.maintUrgente} / {d.maintOuvertes}</div><div className="text-[10px] uppercase text-white/50">Maint. urgente / ouverte</div></div>
        <div className={CARD}><div className="text-xl font-black text-emerald-300">{d.campActives}</div><div className="text-[10px] uppercase text-white/50">Campagnes actives</div></div>
        <div className={CARD}><div className="text-xl font-black">{formatEuro(d.pipelineCents)}</div><div className="text-[10px] uppercase text-white/50">Pipeline gagné</div></div>
      </div>

      <div className={CARD}>
        <div className="mb-1 text-xs font-bold uppercase text-white/50">Marge (ESTIMATION)</div>
        <div className="text-sm">CA <b>{formatEuro(d.caCents)}</b> − coûts connus <b>{formatEuro(coutsConnus)}</b> = <b className={marge.margeCents >= 0 ? "text-emerald-300" : "text-rose-400"}>{formatEuro(marge.margeCents)}</b></div>
        <div className="mt-1 text-[10px] text-white/40">⚠ ESTIMATION : personnel, publicité, achats et JDC NON CONNECTÉS — pas un résultat comptable.</div>
      </div>

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Décisions en attente</div>
        {decisions.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucune décision en attente.</div>
        ) : (
          <ul className="space-y-2">
            {decisions.map((x) => (
              <li key={x.label} className={`${CARD} flex items-center justify-between`}>
                <span className="text-sm">{x.label}</span>
                <span className="rounded-full bg-orange-600 px-2 py-0.5 text-xs font-bold">{x.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
