"use client";

// app/_modules/marketing/MarketingView.tsx — écran Marketing/acquisition (0050), mobile-first, autonome.
// RLS 0050 = frontière dure (lecture ET écriture direction). Plateformes pub externes : PRÊT À CONNECTER — NON ACTIVÉ.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  MARKETING_CHANNELS,
  CAMPAIGN_STATUSES,
  canManageMarketing,
  canViewMarketing,
  validateCampaignDraft,
  campaignRoas,
  campaignCac,
  marketingSummary,
  formatEuro,
  formatRoas,
  type Campaign,
} from "@/lib/marketing";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export default function MarketingView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = canManageMarketing(role);
  const canView = canViewMarketing(role);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [cName, setCName] = useState("");
  const [cChannel, setCChannel] = useState<string>("instagram");
  const [cStatus, setCStatus] = useState<string>("brouillon");
  const [cBudget, setCBudget] = useState("");
  const [cSpent, setCSpent] = useState("");
  const [cPromo, setCPromo] = useState("");
  const [cRevenue, setCRevenue] = useState("");
  const [cReservations, setCReservations] = useState("");

  const load = useCallback(async () => {
    const res = await supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false });
    if (res.error) setError(res.error.message);
    else setCampaigns((res.data || []) as Campaign[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false });
      if (!active) return;
      if (res.error) setError(res.error.message);
      else setCampaigns((res.data || []) as Campaign[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const summary = useMemo(() => marketingSummary(campaigns), [campaigns]);

  async function addCampaign() {
    setError("");
    const budgetCents = cBudget ? Math.round(Number(cBudget) * 100) : null;
    const spentCents = cSpent ? Math.round(Number(cSpent) * 100) : 0;
    const draft = { name: cName, channel: cChannel, budget_cents: budgetCents, spent_cents: spentCents };
    const check = validateCampaignDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("marketing_campaigns").insert({
      name: cName.trim(),
      channel: cChannel,
      status: cStatus,
      budget_cents: budgetCents,
      spent_cents: spentCents,
      promo_code: cPromo.trim() || null,
      attributed_revenue_cents: cRevenue ? Math.round(Number(cRevenue) * 100) : 0,
      attributed_reservations: cReservations ? Math.round(Number(cReservations)) : 0,
      created_by: username,
    });
    if (e) {
      setError(`Campagne refusée : ${e.message}`);
      return;
    }
    setCName("");
    setCBudget("");
    setCSpent("");
    setCPromo("");
    setCRevenue("");
    setCReservations("");
    await load();
  }

  if (!canView) {
    return (
      <div className="space-y-3 pb-4 text-white">
        <div className="text-center text-sm text-white/40">Le marketing est réservé à la direction.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black">{summary.totalCampagnes}</div>
          <div className="text-[10px] uppercase text-white/50">Campagnes</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-emerald-300">{summary.actives}</div>
          <div className="text-[10px] uppercase text-white/50">Actives</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-amber-400">{formatRoas(summary.roasGlobal)}</div>
          <div className="text-[10px] uppercase text-white/50">ROAS global</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs text-white/60">
        <div>
          Budget <b className="block text-white">{formatEuro(summary.budgetTotalCents)}</b>
        </div>
        <div>
          Dépensé <b className="block text-white">{formatEuro(summary.depenseTotalCents)}</b>
        </div>
        <div>
          CA attribué <b className="block text-white">{formatEuro(summary.caAttribueTotalCents)}</b>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
        Plateformes pub externes (Instagram/Facebook/TikTok/Google) · PRÊT À CONNECTER — NON ACTIVÉ
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>}

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Nouvelle campagne</div>
          <div className="space-y-2">
            <input className={INPUT} placeholder="Nom (ex. Insta soirée Techno)" value={cName} onChange={(e) => setCName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={cChannel} onChange={(e) => setCChannel(e.target.value)}>
                {MARKETING_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className={INPUT} value={cStatus} onChange={(e) => setCStatus(e.target.value)}>
                {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} inputMode="decimal" placeholder="Budget € (opt.)" value={cBudget} onChange={(e) => setCBudget(e.target.value)} />
              <input className={INPUT} inputMode="decimal" placeholder="Dépensé € (opt.)" value={cSpent} onChange={(e) => setCSpent(e.target.value)} />
            </div>
            <input className={INPUT} placeholder="Code promo (opt.)" value={cPromo} onChange={(e) => setCPromo(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} inputMode="decimal" placeholder="CA attribué € (opt.)" value={cRevenue} onChange={(e) => setCRevenue(e.target.value)} />
              <input className={INPUT} inputMode="numeric" placeholder="Résas attribuées (opt.)" value={cReservations} onChange={(e) => setCReservations(e.target.value)} />
            </div>
            <button className={BTN} onClick={addCampaign} disabled={!cName.trim()}>Créer la campagne</button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Campagnes ({campaigns.length})</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucune campagne. La direction saisit l’acquisition réelle.</div>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => {
              const roas = campaignRoas(c);
              const cac = campaignCac(c);
              return (
                <li key={c.id} className={CARD}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{c.name}</div>
                      <div className="text-[11px] text-white/50">
                        {c.channel} · {c.status || "brouillon"}{c.promo_code ? ` · code ${c.promo_code}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-black text-amber-400">{formatRoas(roas)}</div>
                      <div className="text-[9px] uppercase text-white/40">ROAS</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-white/60">
                    <div>
                      Dépensé <b className="block text-white">{formatEuro(c.spent_cents)}</b>
                    </div>
                    <div>
                      CA attribué <b className="block text-white">{formatEuro(c.attributed_revenue_cents)}</b>
                    </div>
                    <div>
                      CAC <b className="block text-white">{cac != null ? formatEuro(cac) : "—"}</b>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
