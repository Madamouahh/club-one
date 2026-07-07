// app/_modules/crmboards/reservationRequests.ts — helpers PURS (aucun réseau, aucun React) pour brancher
// la file de DEMANDES DE RÉSA (table_reservation_requests, migration 0025) sur le composant existant
// <ReservationRequestQueue>. Séparé du conteneur pour rester testable (tests/crmBoards.test.mts).
//
// Rôle : convertir une ligne SQL jointe (table_reservation_requests + venue_tables + guests, déjà
// cantonnée par la RLS 0025) en ReservationRequestRow attendu par lib/resaRequest. On ne fabrique RIEN :
// un libellé de table absent (jointure vide) reste null ; un nom de client absent reste null.

import type { StaffRole } from "@/lib/permissions";
import type { ReservationRequest, ReservationRequestRow } from "@/lib/resaRequest";

// Select PostgREST : toutes les colonnes de la demande + le libellé de la table + l'identité minimale du
// client (nom + téléphone). Les embeds sont cantonnés par la RLS de venue_tables / guests côté serveur.
export const RESERVATION_REQUEST_SELECT =
  "*, venue_tables:venue_table_id(label), guests:guest_id(first_name,last_name,phone)";

// Un embed PostgREST « to-one » remonte un objet (ou null) ; on tolère aussi un tableau par prudence.
type Embedded<T> = T | T[] | null | undefined;

type EmbeddedTable = { label: string | null };
type EmbeddedGuest = { first_name: string | null; last_name: string | null; phone: string | null };

// Ligne brute telle que renvoyée par supabase.from("table_reservation_requests").select(RESERVATION_REQUEST_SELECT).
export type RawReservationRequestRow = ReservationRequest & {
  venue_tables?: Embedded<EmbeddedTable>;
  guests?: Embedded<EmbeddedGuest>;
};

function firstOf<T>(v: Embedded<T>): T | null {
  if (Array.isArray(v)) return v.length > 0 ? v[0] : null;
  return v ?? null;
}

// Nom d'affichage du client : « Prénom Nom » (nom optionnel), ou null si rien d'exploitable (jamais « »).
export function fullGuestName(
  first: string | null | undefined,
  last: string | null | undefined,
): string | null {
  const name = [first ?? "", last ?? ""].map((s) => s.trim()).filter(Boolean).join(" ");
  return name.length > 0 ? name : null;
}

// Convertit UNE ligne brute jointe en ReservationRequestRow (miroir strict du modèle 0025). Aucun défaut
// fabriqué : les colonnes optionnelles absentes retombent sur null, le libellé/nom joint sur null.
export function mapReservationRequestRow(raw: RawReservationRequestRow): ReservationRequestRow {
  const table = firstOf<EmbeddedTable>(raw.venue_tables);
  const guest = firstOf<EmbeddedGuest>(raw.guests);
  return {
    id: raw.id,
    venue_table_id: raw.venue_table_id,
    guest_id: raw.guest_id,
    event_id: raw.event_id ?? null,
    exploitation_date: raw.exploitation_date,
    venue: raw.venue,
    party_size: raw.party_size,
    standing: raw.standing,
    slot: raw.slot ?? null,
    guest_note: raw.guest_note ?? null,
    status: raw.status,
    owner_promoter: raw.owner_promoter ?? null,
    decided_by: raw.decided_by ?? null,
    decided_at: raw.decided_at ?? null,
    decline_reason: raw.decline_reason ?? null,
    created_at: raw.created_at,
    table_label: table?.label ?? null,
    guest_name: fullGuestName(guest?.first_name, guest?.last_name),
    guest_phone: guest?.phone ?? null,
  };
}

export function mapReservationRequestRows(
  rows: readonly RawReservationRequestRow[],
): ReservationRequestRow[] {
  return rows.map(mapReservationRequestRow);
}

// Qui VOIT la file de demandes de résa côté écran — MIROIR de la policy trr_read (0025) : direction voit
// tout, le promoteur voit SES demandes. Les autres rôles (server/security/security_counter) n'ont AUCUNE
// ligne (la RLS ne leur en renvoie aucune). Confort d'UI, PAS une sécurité : l'autorité reste la RLS.
export function canViewResaRequests(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "promoter";
}

// Forme du retour de la RPC decide_table_reservation_v1 (0025) : returns table (ok, code, message, status).
export type DecideResaResult = {
  ok: boolean;
  code: string;
  message: string;
  status: string | null;
};

// Normalise le retour RPC (Supabase renvoie soit un tableau de lignes, soit une ligne) en un seul objet,
// ou null si rien d'exploitable. Ne fabrique aucun succès : une réponse vide/illisible → null.
export function firstDecideResult(data: unknown): DecideResaResult | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.ok !== "boolean") return null;
  return {
    ok: r.ok,
    code: typeof r.code === "string" ? r.code : "",
    message: typeof r.message === "string" ? r.message : "",
    status: typeof r.status === "string" ? r.status : null,
  };
}
