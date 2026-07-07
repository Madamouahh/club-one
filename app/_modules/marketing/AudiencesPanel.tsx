"use client";

// app/_modules/marketing/AudiencesPanel.tsx — F1 : construire/inspecter les segments d'audience.
// Présentational, PILOTÉ PAR PROPS. Le segment (critères déclaratifs) → aperçu de destinataires
// (campaign_recipients) via lib/marketingUi.buildRecipients. La persistance est déléguée au conteneur.

import { useMemo, useState } from "react";
import {
  buildRecipients,
  evaluateSegment,
  statusLabel,
  statusTone,
  type GuestRecord,
  type RecipientDraft,
  type RecipientStatus,
  type SegmentCriteria,
} from "@/lib/marketingUi";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export type AudienceRow = {
  id: string;
  campaign_id: string;
  segment_key: string;
  criteria: SegmentCriteria | null;
  created_at?: string | null;
};

export type RecipientRow = {
  id: string;
  campaign_id: string;
  guest_id: string;
  status: RecipientStatus | string;
};

export type CampaignOption = { id: string; name: string };

export default function AudiencesPanel({
  campaigns,
  guests,
  audiences,
  recipients,
  canManage,
  onSaveAudience,
  onMaterializeRecipients,
}: {
  campaigns: CampaignOption[];
  guests: GuestRecord[];
  audiences: AudienceRow[];
  recipients: RecipientRow[];
  canManage: boolean;
  // Persistance déléguée au conteneur (self-fetching). Optionnelles → panneau inspectable seul.
  onSaveAudience?: (row: {
    campaign_id: string;
    segment_key: string;
    criteria: SegmentCriteria;
  }) => Promise<void> | void;
  onMaterializeRecipients?: (rows: RecipientDraft[]) => Promise<void> | void;
}) {
  const [campaignId, setCampaignId] = useState<string>(campaigns[0]?.id ?? "");
  const [segmentKey, setSegmentKey] = useState("");
  const [minVisits, setMinVisits] = useState("");
  const [lastVisitAfter, setLastVisitAfter] = useState("");
  const [lastVisitBefore, setLastVisitBefore] = useState("");
  const [requiresConsent, setRequiresConsent] = useState(true);
  const [excludeOptOut, setExcludeOptOut] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const criteria = useMemo<SegmentCriteria>(
    () => ({
      min_visits: minVisits ? Number(minVisits) : null,
      last_visit_after: lastVisitAfter || null,
      last_visit_before: lastVisitBefore || null,
      requires_consent: requiresConsent,
      exclude_opted_out: excludeOptOut,
    }),
    [minVisits, lastVisitAfter, lastVisitBefore, requiresConsent, excludeOptOut],
  );

  // Aperçu déterministe : le segment appliqué au répertoire donne les destinataires candidats.
  const preview = useMemo(() => evaluateSegment(guests, criteria), [guests, criteria]);
  const drafts = useMemo(
    () => (campaignId ? buildRecipients(campaignId, guests, criteria) : []),
    [campaignId, guests, criteria],
  );

  async function saveAudience() {
    if (!onSaveAudience || !campaignId || !segmentKey.trim()) return;
    setBusy(true);
    setNote("");
    try {
      await onSaveAudience({ campaign_id: campaignId, segment_key: segmentKey.trim(), criteria });
      setNote(`Segment « ${segmentKey.trim()} » enregistré.`);
      setSegmentKey("");
    } catch (e) {
      setNote(`Échec enregistrement : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function materialize() {
    if (!onMaterializeRecipients || drafts.length === 0) return;
    setBusy(true);
    setNote("");
    try {
      await onMaterializeRecipients(drafts);
      setNote(`${drafts.length} destinataire(s) matérialisé(s) (statut « pending »).`);
    } catch (e) {
      setNote(`Échec matérialisation : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const recipientsForCampaign = recipients.filter((r) => r.campaign_id === campaignId);

  return (
    <div className="space-y-3">
      <div className="text-xs font-bold uppercase tracking-wide text-white/50">
        Audiences · segments → destinataires (F1)
      </div>

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Définir un segment</div>
          <div className="space-y-2">
            <select className={INPUT} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">— campagne —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className={INPUT}
              placeholder="Clé de segment (ex. vip_90d, dormant_180d)"
              value={segmentKey}
              onChange={(e) => setSegmentKey(e.target.value)}
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                className={INPUT}
                inputMode="numeric"
                placeholder="Visites min"
                value={minVisits}
                onChange={(e) => setMinVisits(e.target.value)}
              />
              <input
                className={INPUT}
                type="date"
                title="Dernière visite après"
                value={lastVisitAfter}
                onChange={(e) => setLastVisitAfter(e.target.value)}
              />
              <input
                className={INPUT}
                type="date"
                title="Dernière visite avant (dormants)"
                value={lastVisitBefore}
                onChange={(e) => setLastVisitBefore(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-white/70">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={requiresConsent}
                  onChange={(e) => setRequiresConsent(e.target.checked)}
                />
                Consentement marketing requis
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={excludeOptOut}
                  onChange={(e) => setExcludeOptOut(e.target.checked)}
                />
                Exclure les STOP (opt-out)
              </label>
            </div>
            <div className="flex gap-2">
              <button
                className={BTN}
                onClick={saveAudience}
                disabled={busy || !campaignId || !segmentKey.trim() || !onSaveAudience}
              >
                Enregistrer le segment
              </button>
              <button
                className={`${BTN} bg-sky-700`}
                onClick={materialize}
                disabled={busy || drafts.length === 0 || !onMaterializeRecipients}
              >
                Matérialiser {drafts.length} destinataire(s)
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black text-sky-300">{preview.length}</div>
          <div className="text-[10px] uppercase text-white/50">Ciblés (aperçu)</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black">{recipientsForCampaign.length}</div>
          <div className="text-[10px] uppercase text-white/50">Destinataires en base</div>
        </div>
      </div>

      {note && (
        <div className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs text-white/70">
          {note}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">
          Segments enregistrés ({audiences.filter((a) => a.campaign_id === campaignId || !campaignId).length})
        </div>
        {audiences.length === 0 ? (
          <div className="text-center text-sm text-white/40">
            Aucun segment. La direction définit le ciblage réel.
          </div>
        ) : (
          <ul className="space-y-2">
            {audiences.map((a) => (
              <li key={a.id} className={CARD}>
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-bold">{a.segment_key}</div>
                  <div className="shrink-0 text-[10px] uppercase text-white/40">
                    {campaigns.find((c) => c.id === a.campaign_id)?.name ?? a.campaign_id.slice(0, 8)}
                  </div>
                </div>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-black/40 p-2 text-[10px] text-white/50">
                  {JSON.stringify(a.criteria ?? {}, null, 0)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>

      {recipientsForCampaign.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">
            Destinataires ({recipientsForCampaign.length})
          </div>
          <ul className="space-y-1">
            {recipientsForCampaign.slice(0, 50).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs"
              >
                <span className="truncate text-white/70">{r.guest_id.slice(0, 8)}</span>
                <span className={`shrink-0 font-bold ${statusTone(r.status as RecipientStatus)}`}>
                  {statusLabel(r.status as RecipientStatus)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
