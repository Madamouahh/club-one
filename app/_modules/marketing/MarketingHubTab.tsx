"use client";

// app/_modules/marketing/MarketingHubTab.tsx — conteneur AUTONOME du hub Marketing (F1/F4/F5).
// Même contrat que StockView : { supabase, role, username }. Récupère les tables 0056 + guests + campagnes,
// gère loading/error/empty, et câble les trois panneaux (Audiences / Outbox / Codes promo).
//
// INVARIANT DRY_RUN : l'outbox ne fait JAMAIS d'envoi réel. La seule mutation d'envoi passe par
// lib/messaging (dryRunAdapter, importé dans OutboxPanel) ; ici on ne fait que persister des lignes.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import { canManageMarketing, canViewMarketing } from "@/lib/marketing";
import type { QueuedMessage } from "@/lib/messaging";
import type { GuestRecord, RecipientDraft, SegmentCriteria } from "@/lib/marketingUi";
import type { PromoCode, DiscountType } from "@/lib/promoCodes";
import AudiencesPanel, { type AudienceRow, type RecipientRow } from "./AudiencesPanel";
import OutboxPanel from "./OutboxPanel";
import PromoCodesPanel, { type RedemptionRow } from "./PromoCodesPanel";

type Tab = "audiences" | "outbox" | "promo";

const TABS: { key: Tab; label: string }[] = [
  { key: "audiences", label: "Audiences" },
  { key: "outbox", label: "Outbox" },
  { key: "promo", label: "Promo" },
];

type CampaignRow = { id: string; name: string };

export default function MarketingHubTab({
  supabase,
  role,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username?: string;
}) {
  const canView = canViewMarketing(role);
  const canManage = canManageMarketing(role);

  const [tab, setTab] = useState<Tab>("audiences");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [guests, setGuests] = useState<GuestRecord[]>([]);
  const [audiences, setAudiences] = useState<AudienceRow[]>([]);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [messages, setMessages] = useState<QueuedMessage[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);

  const load = useCallback(async () => {
    setError("");
    const [camp, gs, aud, rec, mq, pc, pr] = await Promise.all([
      supabase.from("marketing_campaigns").select("id,name").order("created_at", { ascending: false }),
      supabase
        .from("guests")
        .select("id,first_name,last_name,consent_marketing,opt_out_at,last_inbound_contact_at")
        .limit(500),
      supabase.from("campaign_audiences").select("id,campaign_id,segment_key,criteria,created_at"),
      supabase.from("campaign_recipients").select("id,campaign_id,guest_id,status"),
      supabase.from("message_queue").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("promo_codes").select("*").order("created_at", { ascending: false }),
      supabase.from("promo_redemptions").select("id,promo_code_id,guest_id,redeemed_at").limit(200),
    ]);

    const firstError = [camp, gs, aud, rec, mq, pc, pr].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);

    if (!camp.error) setCampaigns((camp.data || []) as CampaignRow[]);
    if (!gs.error) {
      setGuests(
        ((gs.data || []) as Record<string, unknown>[]).map((g) => ({
          id: String(g.id),
          display_name:
            [g.first_name, g.last_name].filter(Boolean).join(" ").trim() || String(g.id).slice(0, 8),
          consent_marketing: (g.consent_marketing as boolean | null) ?? null,
          opt_out_at: (g.opt_out_at as string | null) ?? null,
          last_visit_at: (g.last_inbound_contact_at as string | null) ?? null,
        })),
      );
    }
    if (!aud.error) setAudiences((aud.data || []) as AudienceRow[]);
    if (!rec.error) setRecipients((rec.data || []) as RecipientRow[]);
    if (!mq.error) setMessages((mq.data || []) as QueuedMessage[]);
    if (!pc.error) setPromoCodes((pc.data || []) as PromoCode[]);
    if (!pr.error) setRedemptions((pr.data || []) as RedemptionRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const campaignOptions = useMemo(() => campaigns.map((c) => ({ id: c.id, name: c.name })), [campaigns]);

  // ---------- Callbacks de persistance (tables 0056 existantes, aucune migration) ----------

  const onSaveAudience = useCallback(
    async (row: { campaign_id: string; segment_key: string; criteria: SegmentCriteria }) => {
      const { error: e } = await supabase.from("campaign_audiences").insert(row);
      if (e) throw new Error(e.message);
      await load();
    },
    [supabase, load],
  );

  const onMaterializeRecipients = useCallback(
    async (rows: RecipientDraft[]) => {
      if (rows.length === 0) return;
      // Idempotence : unique (campaign_id, guest_id) → upsert sans doublon.
      const { error: e } = await supabase
        .from("campaign_recipients")
        .upsert(rows, { onConflict: "campaign_id,guest_id", ignoreDuplicates: true });
      if (e) throw new Error(e.message);
      await load();
    },
    [supabase, load],
  );

  const onPersistEnqueue = useCallback(
    async (msg: QueuedMessage) => {
      const { error: e } = await supabase.from("message_queue").insert({
        id: msg.id,
        channel: msg.channel,
        guest_id: msg.guest_id ?? null,
        to_address: msg.to_address ?? null,
        template_key: msg.template_key ?? null,
        payload: msg.payload ?? {},
        status: msg.status,
        dedup_key: msg.dedup_key ?? null,
        scheduled_at: msg.scheduled_at ?? null,
        attempts: msg.attempts,
        max_attempts: msg.max_attempts,
        last_error: msg.last_error ?? null,
      });
      if (e) throw new Error(e.message);
      await load();
    },
    [supabase, load],
  );

  const onPersistProcessed = useCallback(
    async (msgs: QueuedMessage[]) => {
      for (const m of msgs) {
        const { error: e } = await supabase
          .from("message_queue")
          .update({
            status: m.status,
            sent_at: m.sent_at ?? null,
            attempts: m.attempts,
            last_error: m.last_error ?? null,
          })
          .eq("id", m.id);
        if (e) throw new Error(e.message);
      }
      await load();
    },
    [supabase, load],
  );

  const onCreatePromo = useCallback(
    async (draft: {
      code: string;
      campaign_id: string | null;
      discount_type: DiscountType;
      discount_value_cents: number;
      max_redemptions: number | null;
      per_guest_limit: number;
      valid_from: string | null;
      valid_until: string | null;
    }) => {
      const { error: e } = await supabase.from("promo_codes").insert(draft);
      if (e) throw new Error(e.message);
      await load();
    },
    [supabase, load],
  );

  const onTogglePromoActive = useCallback(
    async (id: string, active: boolean) => {
      const { error: e } = await supabase.from("promo_codes").update({ active }).eq("id", id);
      if (e) throw new Error(e.message);
      await load();
    },
    [supabase, load],
  );

  if (!canView) {
    return (
      <div className="space-y-3 pb-4 text-white">
        <div className="text-center text-sm text-white/40">Le marketing est réservé à la direction.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-3 gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wide ${
              tab === t.key ? "bg-orange-600 text-white" : "border border-white/15 bg-white/5 text-white/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
        Messagerie / codes promo · DRY_RUN — PRÊT À CONNECTER — NON ACTIVÉ
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center text-sm text-white/40">Chargement…</div>
      ) : (
        <>
          {tab === "audiences" && (
            <AudiencesPanel
              campaigns={campaignOptions}
              guests={guests}
              audiences={audiences}
              recipients={recipients}
              canManage={canManage}
              onSaveAudience={canManage ? onSaveAudience : undefined}
              onMaterializeRecipients={canManage ? onMaterializeRecipients : undefined}
            />
          )}
          {tab === "outbox" && (
            <OutboxPanel
              messages={messages}
              guests={guests}
              canManage={canManage}
              onPersistEnqueue={canManage ? onPersistEnqueue : undefined}
              onPersistProcessed={canManage ? onPersistProcessed : undefined}
            />
          )}
          {tab === "promo" && (
            <PromoCodesPanel
              promoCodes={promoCodes}
              redemptions={redemptions}
              campaigns={campaignOptions}
              canManage={canManage}
              onCreate={canManage ? onCreatePromo : undefined}
              onToggleActive={canManage ? onTogglePromoActive : undefined}
            />
          )}
        </>
      )}
    </div>
  );
}
