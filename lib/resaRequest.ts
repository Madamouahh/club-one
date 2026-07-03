// lib/resaRequest.ts — logique PURE du FLUX CLIENT « demande de résa » (chunk 4 de PLAN_SALLE_EDEN).
// Aucun accès réseau. C'est le SOCLE côté UI de la demande de réservation depuis le plan interactif :
//   · validation du brouillon client (funnel 18+/consentement réutilisé de crmFunnel, party_size, capacité) ;
//   · la disponibilité RÉELLE d'une table au sens « couche demandes » (aucune fausse dispo physique) ;
//   · le modèle de vue de la file staff (tri, décision, garde de rôle, résumé honnête).
//
// Le vrai enforcement (dédup, 18+, 1 demande/client/soirée, atomicité) est en SQL (RPC SECURITY DEFINER
// de la migration 0025). Ces fonctions TS ne font que MIROIR pour l'UI, jamais une sécurité.
//
// Règles dures reprises de la spec §3 :
//   · une DEMANDE naît `pending` — jamais auto-confirmée ; un manager valide/refuse ;
//   · le client s'inscrit LUI-MÊME (mêmes 2 cases de consentement dégroupées, blocage < 18 ans) ;
//   · aucune fausse disponibilité : sans données de demande, une table active est « libre » au sens
//     de la couche demandes uniquement (pas de statut physique inventé) ;
//   · aucune capacité inventée : party_size n'est borné que si la capacité est CONNUE (null = à confirmer).

import { validateRegistration, type RegistrationError } from "./crmFunnel.ts";
import type { TableAvailability } from "./floorPlanView.ts";
import type { VenueTable } from "./venueTables.ts";

// ————————————————————————————————————————————————————————————————
// Statut d'une demande (miroir du CHECK 0025)
// ————————————————————————————————————————————————————————————————

export const RESA_STATUSES = ["pending", "approved", "declined", "cancelled"] as const;
export type ResaStatus = (typeof RESA_STATUSES)[number];

export function isResaStatus(v: unknown): v is ResaStatus {
  return typeof v === "string" && (RESA_STATUSES as readonly string[]).includes(v);
}

// Une demande est ACTIVE (occupe la table / le créneau du client) tant qu'elle est pending ou approved.
// declined/cancelled libèrent la table — miroir EXACT des index uniques partiels de la migration 0025.
export const ACTIVE_RESA_STATUSES: readonly ResaStatus[] = ["pending", "approved"];

export function isActiveResaStatus(s: ResaStatus): boolean {
  return (ACTIVE_RESA_STATUSES as readonly string[]).includes(s);
}

// Style d'affichage d'un statut (self-contained, hex — aucune dépendance Tailwind à l'intérieur).
export type ResaStatusStyle = { label: string; stroke: string; text: string };

export const RESA_STATUS_STYLE: Record<ResaStatus, ResaStatusStyle> = {
  pending: { label: "En attente", stroke: "#fbbf24", text: "#fde68a" },
  approved: { label: "Validée", stroke: "#34d399", text: "#a7f3d0" },
  declined: { label: "Refusée", stroke: "#f87171", text: "#fecaca" },
  cancelled: { label: "Annulée", stroke: "#71717a", text: "#a1a1aa" },
};

// ————————————————————————————————————————————————————————————————
// Modèle (miroir de table_reservation_requests 0025)
// ————————————————————————————————————————————————————————————————

export type ReservationRequest = {
  id: string;
  venue_table_id: string;
  guest_id: string;
  event_id: string | null;
  exploitation_date: string; // ISO YYYY-MM-DD
  venue: string;
  party_size: number;
  standing: boolean;
  slot: string | null;
  guest_note: string | null;
  status: ResaStatus;
  owner_promoter: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decline_reason: string | null;
  created_at: string; // ISO timestamp
};

// Ligne enrichie pour la file staff : jointe au libellé de la table (jamais fabriqué).
export type ReservationRequestRow = ReservationRequest & {
  table_label: string | null; // libellé de venue_tables ; null si la table n'est plus retrouvée
  guest_name: string | null; // prénom (+ nom) du client ; null si non joint
  guest_phone: string | null; // E.164 ; visible direction/promoteur propriétaire seulement (RLS)
};

// ————————————————————————————————————————————————————————————————
// Disponibilité au sens « couche demandes » (aucune fausse dispo physique)
// ————————————————————————————————————————————————————————————————

// À partir des demandes ACTIVES d'une soirée, dresse la carte tableId → état d'affichage :
//   · une demande approved → "confirmed" (l'emporte sur une éventuelle pending) ;
//   · une demande pending  → "requested" ;
//   · aucune demande active → la table n'apparaît pas (l'appelant retombe sur "free" si active).
// N'invente rien : une table absente de la carte n'est PAS marquée occupée — elle est libre au sens
// couche demandes (le plan reste honnête, il ne prétend pas connaître l'occupation physique).
export function buildAvailabilityMap(
  requests: readonly Pick<ReservationRequest, "venue_table_id" | "status">[],
): Record<string, TableAvailability> {
  const map: Record<string, TableAvailability> = {};
  for (const r of requests) {
    if (r.status === "approved") {
      map[r.venue_table_id] = "confirmed"; // approved l'emporte toujours
    } else if (r.status === "pending" && map[r.venue_table_id] !== "confirmed") {
      map[r.venue_table_id] = "requested";
    }
  }
  return map;
}

// Une table est-elle demandable par un CLIENT ? Active ET aucune demande active dessus (couche demandes).
// Réutilise la carte ci-dessus : "confirmed"/"requested" = déjà prise ; absente = libre.
export function isTableRequestable(
  table: Pick<VenueTable, "active">,
  availability: TableAvailability | undefined,
): boolean {
  if (!table.active) return false;
  return availability !== "confirmed" && availability !== "requested" && availability !== "unavailable";
}

// ————————————————————————————————————————————————————————————————
// Brouillon client d'une demande + validation (funnel réutilisé de crmFunnel)
// ————————————————————————————————————————————————————————————————

export type ReservationDraft = {
  // Funnel d'inscription (mêmes champs/règles que 0014) :
  firstName: string;
  lastName?: string | null;
  phoneE164: string | null;
  birthday: string; // ISO YYYY-MM-DD
  consentService: boolean;
  consentServiceText?: string | null;
  consentMarketing: boolean;
  consentMarketingText?: string | null;
  // Spécifique demande de résa :
  partySize: number;
  slot?: string | null;
  guestNote?: string | null;
};

export type ReservationDraftError =
  | RegistrationError
  | "party_size_invalid"
  | "party_over_capacity"
  | "table_unavailable";

// Valide un brouillon de demande à la date de la soirée. Combine :
//   · le funnel d'inscription (validateRegistration : prénom, E.164, 18+, journalisation consentement) ;
//   · party_size entier > 0 ;
//   · party_size ≤ capacité SEULEMENT si la capacité est connue (null = à confirmer → aucun blocage) ;
//   · la table doit être demandable (active + libre couche-demandes).
// La case marketing n'est JAMAIS requise (l'absence n'apparaît pas dans les erreurs) — miroir de la spec.
export function validateReservationDraft(
  draft: ReservationDraft,
  table: Pick<VenueTable, "active" | "capacity">,
  availability: TableAvailability | undefined,
  refDate: Date,
): { ok: boolean; errors: ReservationDraftError[] } {
  const errors: ReservationDraftError[] = [];

  // 1) Funnel d'inscription (réutilise la logique 18+/consentement, ne la duplique pas).
  const reg = validateRegistration(
    {
      firstName: draft.firstName,
      lastName: draft.lastName,
      phoneE164: draft.phoneE164,
      birthday: draft.birthday,
      consentService: draft.consentService,
      consentServiceText: draft.consentServiceText,
      consentMarketing: draft.consentMarketing,
      consentMarketingText: draft.consentMarketingText,
    },
    refDate,
  );
  errors.push(...reg.errors);

  // 2) party_size entier strictement positif.
  if (!Number.isInteger(draft.partySize) || draft.partySize <= 0) {
    errors.push("party_size_invalid");
  } else if (
    typeof table.capacity === "number" &&
    Number.isFinite(table.capacity) &&
    draft.partySize > table.capacity
  ) {
    // 3) Dépassement de capacité UNIQUEMENT si la capacité est connue (jamais un blocage inventé).
    errors.push("party_over_capacity");
  }

  // 4) La table doit rester demandable au moment de l'envoi (défense UI ; le SQL retranche en dernier).
  if (!isTableRequestable(table, availability)) {
    errors.push("table_unavailable");
  }

  return { ok: errors.length === 0, errors };
}

// Note d'assise à afficher au client selon la table (les tables hautes = « groupe debout », spec §3).
export function seatingNotice(table: Pick<VenueTable, "standing">): string {
  return table.standing
    ? "Table haute — groupe debout (sans chaise)."
    : "Table assise.";
}

// ————————————————————————————————————————————————————————————————
// File staff : tri, décision, garde de rôle, résumé honnête
// ————————————————————————————————————————————————————————————————

// Seule la direction valide/refuse une demande (miroir de la RPC decide_table_reservation_v1).
export function canDecideResa(role: string | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export const RESA_DECISIONS = ["approve", "decline"] as const;
export type ResaDecision = (typeof RESA_DECISIONS)[number];

// Une demande n'est décidable que si elle est encore `pending` (miroir du garde SQL `not_pending`).
export function isDecidable(request: Pick<ReservationRequest, "status">): boolean {
  return request.status === "pending";
}

// Statut résultant d'une décision — ou null si la transition est illégale (rien n'est forcé).
export function nextResaStatus(
  request: Pick<ReservationRequest, "status">,
  decision: ResaDecision,
): ResaStatus | null {
  if (request.status !== "pending") return null;
  return decision === "approve" ? "approved" : "declined";
}

// Ordre d'affichage de la file : les `pending` d'abord (à traiter), puis approved, declined, cancelled ;
// à statut égal, les plus anciennes en tête (FIFO — on traite d'abord la plus ancienne). Copie non mutante.
const STATUS_ORDER: Record<ResaStatus, number> = {
  pending: 0,
  approved: 1,
  declined: 2,
  cancelled: 3,
};

export function sortForQueue<T extends Pick<ReservationRequest, "status" | "created_at">>(
  requests: readonly T[],
): T[] {
  return [...requests].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 99;
    const sb = STATUS_ORDER[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.created_at.localeCompare(b.created_at); // ISO → tri lexicographique = chronologique
  });
}

export type ResaQueueSummary = {
  total: number;
  pending: number;
  approved: number;
  declined: number;
  cancelled: number;
};

// Compte honnête par statut. Liste vide → zéros (jamais de donnée fabriquée).
export function resaQueueSummary(requests: readonly Pick<ReservationRequest, "status">[]): ResaQueueSummary {
  const s: ResaQueueSummary = { total: requests.length, pending: 0, approved: 0, declined: 0, cancelled: 0 };
  for (const r of requests) {
    if (r.status === "pending") s.pending += 1;
    else if (r.status === "approved") s.approved += 1;
    else if (r.status === "declined") s.declined += 1;
    else if (r.status === "cancelled") s.cancelled += 1;
  }
  return s;
}

// Libellé d'affichage d'une demande dans la file (« Table 205 · 6 pers. · groupe debout »).
export function requestSummaryLabel(row: Pick<ReservationRequestRow, "table_label" | "party_size" | "standing">): string {
  const parts: string[] = [];
  parts.push(row.table_label ? `Table ${row.table_label}` : "Table (retirée)");
  parts.push(`${row.party_size} pers.`);
  if (row.standing) parts.push("groupe debout");
  return parts.join(" · ");
}

// ————————————————————————————————————————————————————————————————
// Transitions immuables côté UI (miroir des RPC ; le SQL reste l'autorité)
// ————————————————————————————————————————————————————————————————

// Assemble une nouvelle demande `pending` de façon DÉTERMINISTE (id + created_at injectés par l'appelant :
// aucune source d'entropie ici → fonction pure et testable). C'est le miroir UI de ce que la RPC
// request_table_reservation_v1 crée en base : une DEMANDE, jamais une confirmation (status = "pending").
// N'invente rien — la capacité, la table haute (standing) et l'univers viennent de la table réelle.
export function assemblePendingRow(args: {
  id: string;
  createdAt: string; // ISO timestamp (fourni par l'appelant, jamais fabriqué ici)
  table: Pick<VenueTable, "id" | "venue" | "standing" | "label">;
  guestId: string;
  eventId: string | null;
  exploitationDate: string; // ISO YYYY-MM-DD
  partySize: number;
  slot: string | null;
  guestNote: string | null;
  guestName: string | null;
  guestPhone: string | null;
  ownerPromoter?: string | null;
}): ReservationRequestRow {
  return {
    id: args.id,
    venue_table_id: args.table.id,
    guest_id: args.guestId,
    event_id: args.eventId,
    exploitation_date: args.exploitationDate,
    venue: args.table.venue,
    party_size: args.partySize,
    standing: args.table.standing,
    slot: args.slot,
    guest_note: args.guestNote,
    status: "pending",
    owner_promoter: args.ownerPromoter ?? null,
    decided_by: null,
    decided_at: null,
    decline_reason: null,
    created_at: args.createdAt,
    table_label: args.table.label,
    guest_name: args.guestName,
    guest_phone: args.guestPhone,
  };
}

// Applique une décision à une file de demandes de façon IMMUABLE (nouvelle liste, aucune mutation).
// Miroir strict de la RPC decide_table_reservation_v1 :
//   · seule une demande `pending` est décidable (nextResaStatus renvoie null sinon → ligne inchangée) ;
//   · `approve` → approved ; `decline` → declined (+ motif) ; on horodate et on trace le décideur ;
//   · une décision sur un id absent est un no-op silencieux (la liste revient à l'identique).
// L'AUTORITÉ reste le SQL (RLS admin/manager + garde not_pending) ; ceci n'est qu'une mise à jour
// optimiste d'UI, réutilisable par le futur écran réel.
export function applyResaDecision(
  rows: readonly ReservationRequestRow[],
  id: string,
  decision: ResaDecision,
  decidedBy: string | null,
  reason: string | null,
  decidedAt: string | null,
): ReservationRequestRow[] {
  return rows.map((row) => {
    if (row.id !== id) return row;
    const next = nextResaStatus(row, decision);
    if (next === null) return row; // transition illégale (déjà traitée) → inchangée
    return {
      ...row,
      status: next,
      decided_by: decidedBy,
      decided_at: decidedAt,
      decline_reason: decision === "decline" ? reason : null,
    };
  });
}
