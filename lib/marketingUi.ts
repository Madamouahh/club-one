// lib/marketingUi.ts — helpers PURS pour l'UI Marketing (audiences F1 / outbox F5 / promo F4).
// 100% déterministe, aucune I/O, aucun réseau, AUCUN fournisseur externe. Testable sans React.
//
// Deux familles de fonctions :
//   1) AUDIENCES  : segment (critères déclaratifs) → liste de destinataires (campaign_recipients).
//   2) OUTBOX     : dérivation d'états d'affichage à partir des lignes message_queue (statuts F5).
//
// Ces helpers ne DÉCIDENT jamais d'un envoi : la porte de consentement, la dédup et le cap de fréquence
// restent dans lib/messaging (backend Vague-1). Ici on ne fait que MAPPER et RÉSUMER pour l'écran.

import type { ConsentState, MessageStatus, QueuedMessage } from "./messaging/types.ts";
import type { PromoCode } from "./promoCodes.ts";

// =====================================================================================
// 1) AUDIENCES — segment → destinataires
// =====================================================================================

// Miroir applicatif partiel de public.guests (0013) utile au ciblage. Tous les champs sont optionnels :
// un critère absent côté guest n'est jamais « vrai par défaut » (il ne matche pas les bornes numériques).
export type GuestRecord = {
  id: string;
  display_name?: string | null;
  consent_marketing?: boolean | null;
  opt_out_at?: string | null; // STOP définitif
  visits_count?: number | null;
  last_visit_at?: string | null; // ISO — dernière visite / dernier contact entrant
  total_spend_cents?: number | null;
  tags?: string[] | null;
};

// Critères déclaratifs d'un segment (public.campaign_audiences.criteria jsonb). Tous optionnels et combinés en ET.
export type SegmentCriteria = {
  min_visits?: number | null;
  max_visits?: number | null;
  min_spend_cents?: number | null;
  last_visit_after?: string | null; // dernière visite >= cette date
  last_visit_before?: string | null; // dernière visite <= cette date (dormants)
  requires_consent?: boolean | null; // exige consent_marketing === true
  exclude_opted_out?: boolean | null; // exclut tout guest ayant opt_out_at renseigné
  tags_any?: string[] | null; // au moins un tag commun
};

function parseMs(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// matchesSegment — vrai seulement si TOUS les critères fournis sont satisfaits (critère absent = ignoré).
export function matchesSegment(
  guest: GuestRecord,
  criteria: SegmentCriteria | null | undefined,
): boolean {
  if (!criteria) return true;

  const visits = Number(guest.visits_count) || 0;
  if (criteria.min_visits != null && visits < criteria.min_visits) return false;
  if (criteria.max_visits != null && visits > criteria.max_visits) return false;

  const spend = Number(guest.total_spend_cents) || 0;
  if (criteria.min_spend_cents != null && spend < criteria.min_spend_cents) return false;

  const lastVisit = parseMs(guest.last_visit_at);
  const after = parseMs(criteria.last_visit_after);
  if (after != null && (lastVisit == null || lastVisit < after)) return false;
  const before = parseMs(criteria.last_visit_before);
  if (before != null && (lastVisit == null || lastVisit > before)) return false;

  if (criteria.requires_consent === true && guest.consent_marketing !== true) return false;
  if (criteria.exclude_opted_out === true && guest.opt_out_at) return false;

  if (criteria.tags_any && criteria.tags_any.length > 0) {
    const tags = guest.tags ?? [];
    if (!criteria.tags_any.some((t) => tags.includes(t))) return false;
  }
  return true;
}

// evaluateSegment — sous-ensemble des guests satisfaisant le segment (ordre d'entrée préservé).
export function evaluateSegment(
  guests: GuestRecord[],
  criteria: SegmentCriteria | null | undefined,
): GuestRecord[] {
  return guests.filter((g) => matchesSegment(g, criteria));
}

export const RECIPIENT_STATUSES = ["pending", "queued", "sent", "skipped", "opted_out"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

// Brouillon de ligne campaign_recipients (statut initial 'pending', 1 ligne / (campagne, guest)).
export type RecipientDraft = {
  campaign_id: string;
  guest_id: string;
  status: RecipientStatus;
};

// buildRecipients — segment → destinataires dédupliqués par guest (idempotence campaign_recipients).
export function buildRecipients(
  campaignId: string,
  guests: GuestRecord[],
  criteria: SegmentCriteria | null | undefined,
): RecipientDraft[] {
  const seen = new Set<string>();
  const out: RecipientDraft[] = [];
  for (const g of evaluateSegment(guests, criteria)) {
    if (!g.id || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push({ campaign_id: campaignId, guest_id: g.id, status: "pending" });
  }
  return out;
}

// consentStateOf — projette un guest vers l'état de consentement attendu par lib/messaging.enqueue.
export function consentStateOf(
  guest: Pick<GuestRecord, "id" | "consent_marketing" | "opt_out_at">,
): ConsentState {
  return {
    guest_id: guest.id,
    consent_marketing: guest.consent_marketing ?? null,
    opt_out_at: guest.opt_out_at ?? null,
  };
}

// =====================================================================================
// 2) OUTBOX — dérivation d'états d'affichage (message_queue)
// =====================================================================================

export type OutboxSummary = {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
  opted_out: number;
  total: number;
};

// outboxSummary — compte les lignes par statut (F5). Aucune ligne n'est jamais « envoyée » réellement.
export function outboxSummary(queue: Pick<QueuedMessage, "status">[]): OutboxSummary {
  const s: OutboxSummary = {
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    opted_out: 0,
    total: 0,
  };
  for (const m of queue) {
    s.total++;
    s[m.status]++;
  }
  return s;
}

// recipientStatusFromMessage — miroir message_queue.status → campaign_recipients.status.
export function recipientStatusFromMessage(
  status: MessageStatus | null | undefined,
): RecipientStatus {
  switch (status) {
    case "queued":
    case "sending":
      return "queued";
    case "sent":
      return "sent";
    case "opted_out":
      return "opted_out";
    case "skipped":
    case "failed":
      return "skipped";
    default:
      return "pending";
  }
}

// Libellés FR pour l'affichage des statuts message_queue.
export function statusLabel(status: MessageStatus | RecipientStatus): string {
  switch (status) {
    case "pending":
      return "En attente";
    case "queued":
      return "En file";
    case "sending":
      return "Envoi…";
    case "sent":
      return "Envoyé (DRY_RUN)";
    case "failed":
      return "Échec";
    case "skipped":
      return "Ignoré";
    case "opted_out":
      return "Opt-out (STOP)";
    default:
      return status;
  }
}

// Classe Tailwind (couleur de texte) associée à un statut — honnête : 'sent' reste un envoi simulé.
export function statusTone(status: MessageStatus | RecipientStatus): string {
  switch (status) {
    case "sent":
      return "text-emerald-300";
    case "queued":
    case "sending":
      return "text-sky-300";
    case "skipped":
    case "pending":
      return "text-amber-400";
    case "failed":
      return "text-red-400";
    case "opted_out":
      return "text-fuchsia-300";
    default:
      return "text-white/60";
  }
}

// =====================================================================================
// 3) PROMO — libellé de remise (affichage). Le calcul réel reste dans lib/promoCodes.
// =====================================================================================

export function formatDiscountLabel(
  code: Pick<PromoCode, "discount_type" | "discount_value_cents">,
): string {
  const raw = Math.max(0, Number(code.discount_value_cents) || 0);
  if (code.discount_type === "percent") {
    return `-${Math.min(100, raw)} %`;
  }
  return `-${(raw / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`;
}
