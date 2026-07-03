import assert from "node:assert/strict";
import test from "node:test";

import type { VenueTable } from "../lib/venueTables.ts";
import {
  ACTIVE_RESA_STATUSES,
  buildAvailabilityMap,
  canDecideResa,
  isActiveResaStatus,
  isDecidable,
  isResaStatus,
  isTableRequestable,
  nextResaStatus,
  requestSummaryLabel,
  resaQueueSummary,
  seatingNotice,
  sortForQueue,
  validateReservationDraft,
  type ReservationDraft,
  type ReservationRequest,
} from "../lib/resaRequest.ts";

// Date de référence fixe (soirée) pour un calcul d'âge déterministe.
const SOIREE = new Date(Date.UTC(2026, 6, 3)); // 2026-07-03

function vt(over: Partial<VenueTable> = {}): VenueTable {
  return {
    id: over.id ?? "t1",
    venue: over.venue ?? "eden",
    label: over.label ?? "205",
    x_pct: over.x_pct ?? 50,
    y_pct: over.y_pct ?? 50,
    shape: over.shape ?? "round",
    standing: over.standing ?? false,
    capacity: over.capacity === undefined ? null : over.capacity,
    active: over.active ?? true,
  };
}

function req(over: Partial<ReservationRequest> = {}): ReservationRequest {
  return {
    id: over.id ?? "r1",
    venue_table_id: over.venue_table_id ?? "t1",
    guest_id: over.guest_id ?? "g1",
    event_id: over.event_id ?? "e1",
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    venue: over.venue ?? "eden",
    party_size: over.party_size ?? 4,
    standing: over.standing ?? false,
    slot: over.slot ?? null,
    guest_note: over.guest_note ?? null,
    status: over.status ?? "pending",
    owner_promoter: over.owner_promoter ?? null,
    decided_by: over.decided_by ?? null,
    decided_at: over.decided_at ?? null,
    decline_reason: over.decline_reason ?? null,
    created_at: over.created_at ?? "2026-07-01T20:00:00.000Z",
  };
}

// Brouillon client valide de base (majeur à la date de la soirée).
function draft(over: Partial<ReservationDraft> = {}): ReservationDraft {
  return {
    firstName: over.firstName ?? "Léa",
    lastName: over.lastName ?? "M",
    // `in` (pas `??`) : permet d'écraser explicitement par null (le cas « non normalisé »).
    phoneE164: "phoneE164" in over ? (over.phoneE164 as string | null) : "+33612345678",
    birthday: over.birthday ?? "1998-01-01",
    partySize: over.partySize ?? 4,
    slot: over.slot ?? null,
    guestNote: over.guestNote ?? null,
    consentService: over.consentService ?? false,
    consentServiceText: over.consentServiceText ?? null,
    consentMarketing: over.consentMarketing ?? false,
    consentMarketingText: over.consentMarketingText ?? null,
  };
}

// ————————————————————————————————————————————————————————————————
// Statuts
// ————————————————————————————————————————————————————————————————

test("isResaStatus : garde de type sur le vocabulaire fermé", () => {
  assert.equal(isResaStatus("pending"), true);
  assert.equal(isResaStatus("approved"), true);
  assert.equal(isResaStatus("seated"), false); // statut guest_visits, pas une demande
  assert.equal(isResaStatus(null), false);
});

test("isActiveResaStatus : pending et approved occupent la table ; declined/cancelled la libèrent", () => {
  assert.deepEqual([...ACTIVE_RESA_STATUSES].sort(), ["approved", "pending"]);
  assert.equal(isActiveResaStatus("pending"), true);
  assert.equal(isActiveResaStatus("approved"), true);
  assert.equal(isActiveResaStatus("declined"), false);
  assert.equal(isActiveResaStatus("cancelled"), false);
});

// ————————————————————————————————————————————————————————————————
// Carte de disponibilité (couche demandes) — aucune fausse dispo physique
// ————————————————————————————————————————————————————————————————

test("buildAvailabilityMap : approved = confirmed, pending = requested, absente = libre", () => {
  const map = buildAvailabilityMap([
    req({ venue_table_id: "a", status: "pending" }),
    req({ venue_table_id: "b", status: "approved" }),
    req({ venue_table_id: "c", status: "declined" }), // ne réserve rien
    req({ venue_table_id: "d", status: "cancelled" }), // ne réserve rien
  ]);
  assert.equal(map["a"], "requested");
  assert.equal(map["b"], "confirmed");
  assert.equal(map["c"], undefined); // declined ne marque pas la table
  assert.equal(map["d"], undefined);
  assert.equal(map["zzz"], undefined); // table jamais demandée = absente = libre
});

test("buildAvailabilityMap : approved l'emporte sur une pending sur la même table", () => {
  const map1 = buildAvailabilityMap([
    req({ id: "1", venue_table_id: "x", status: "pending" }),
    req({ id: "2", venue_table_id: "x", status: "approved" }),
  ]);
  assert.equal(map1["x"], "confirmed");
  // Ordre inverse : approved d'abord puis pending — approved reste vainqueur.
  const map2 = buildAvailabilityMap([
    req({ id: "2", venue_table_id: "x", status: "approved" }),
    req({ id: "1", venue_table_id: "x", status: "pending" }),
  ]);
  assert.equal(map2["x"], "confirmed");
});

test("isTableRequestable : table active + libre demandable ; prise/inactive non", () => {
  assert.equal(isTableRequestable(vt({ active: true }), undefined), true); // libre
  assert.equal(isTableRequestable(vt({ active: true }), "requested"), false); // déjà demandée
  assert.equal(isTableRequestable(vt({ active: true }), "confirmed"), false); // déjà confirmée
  assert.equal(isTableRequestable(vt({ active: false }), undefined), false); // inactive
  assert.equal(isTableRequestable(vt({ active: true }), "unavailable"), false);
});

// ————————————————————————————————————————————————————————————————
// Validation du brouillon client
// ————————————————————————————————————————————————————————————————

test("validateReservationDraft : brouillon complet et majeur = ok", () => {
  const r = validateReservationDraft(draft(), vt({ capacity: 6 }), undefined, SOIREE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("validateReservationDraft : mineur à la date de la soirée refusé (L.3342-1)", () => {
  const r = validateReservationDraft(draft({ birthday: "2010-01-01" }), vt(), undefined, SOIREE);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("underage"));
});

test("validateReservationDraft : téléphone non normalisé refusé", () => {
  const r = validateReservationDraft(draft({ phoneE164: null }), vt(), undefined, SOIREE);
  assert.ok(r.errors.includes("phone_invalid"));
});

test("validateReservationDraft : party_size invalide (0, négatif, décimal)", () => {
  for (const bad of [0, -2, 2.5, Number.NaN]) {
    const r = validateReservationDraft(draft({ partySize: bad }), vt(), undefined, SOIREE);
    assert.ok(r.errors.includes("party_size_invalid"), `party_size=${bad}`);
  }
});

test("validateReservationDraft : dépassement de capacité SEULEMENT si connue", () => {
  // Capacité connue (2) et party_size 4 → refus.
  const over = validateReservationDraft(draft({ partySize: 4 }), vt({ capacity: 2 }), undefined, SOIREE);
  assert.ok(over.errors.includes("party_over_capacity"));
  // Capacité null (à confirmer) → JAMAIS de blocage inventé, même pour un grand groupe.
  const nullCap = validateReservationDraft(draft({ partySize: 20 }), vt({ capacity: null }), undefined, SOIREE);
  assert.equal(nullCap.errors.includes("party_over_capacity"), false);
});

test("validateReservationDraft : table déjà prise → table_unavailable", () => {
  const r = validateReservationDraft(draft(), vt(), "requested", SOIREE);
  assert.ok(r.errors.includes("table_unavailable"));
});

test("validateReservationDraft : case marketing JAMAIS requise (absence non listée)", () => {
  const r = validateReservationDraft(
    draft({ consentMarketing: false, consentService: false }),
    vt(),
    undefined,
    SOIREE,
  );
  assert.equal(r.ok, true); // aucune erreur de consentement : les cases sont optionnelles
});

test("validateReservationDraft : case cochée sans texte exact = refus (journalisation CNIL)", () => {
  const r = validateReservationDraft(
    draft({ consentMarketing: true, consentMarketingText: null }),
    vt(),
    undefined,
    SOIREE,
  );
  assert.ok(r.errors.includes("consent_marketing_text_missing"));
});

// ————————————————————————————————————————————————————————————————
// Assise
// ————————————————————————————————————————————————————————————————

test("seatingNotice : table haute = groupe debout ; sinon table assise", () => {
  assert.match(seatingNotice(vt({ standing: true })), /debout/i);
  assert.match(seatingNotice(vt({ standing: false })), /assise/i);
});

// ————————————————————————————————————————————————————————————————
// File staff : décision, tri, résumé, garde de rôle
// ————————————————————————————————————————————————————————————————

test("canDecideResa : direction seule (admin/manager)", () => {
  assert.equal(canDecideResa("admin"), true);
  assert.equal(canDecideResa("manager"), true);
  assert.equal(canDecideResa("promoter"), false);
  assert.equal(canDecideResa("server"), false);
  assert.equal(canDecideResa(null), false);
});

test("isDecidable : seule une demande pending est décidable", () => {
  assert.equal(isDecidable(req({ status: "pending" })), true);
  assert.equal(isDecidable(req({ status: "approved" })), false);
  assert.equal(isDecidable(req({ status: "declined" })), false);
});

test("nextResaStatus : transitions légales depuis pending, null sinon", () => {
  assert.equal(nextResaStatus(req({ status: "pending" }), "approve"), "approved");
  assert.equal(nextResaStatus(req({ status: "pending" }), "decline"), "declined");
  // Non-pending → aucune transition forcée.
  assert.equal(nextResaStatus(req({ status: "approved" }), "decline"), null);
  assert.equal(nextResaStatus(req({ status: "declined" }), "approve"), null);
});

test("sortForQueue : pending d'abord, puis FIFO par date de création (copie non mutante)", () => {
  const input = [
    req({ id: "a", status: "approved", created_at: "2026-07-01T10:00:00Z" }),
    req({ id: "b", status: "pending", created_at: "2026-07-01T12:00:00Z" }),
    req({ id: "c", status: "pending", created_at: "2026-07-01T09:00:00Z" }),
    req({ id: "d", status: "declined", created_at: "2026-07-01T08:00:00Z" }),
  ];
  const snapshot = input.map((r) => r.id);
  const out = sortForQueue(input);
  assert.deepEqual(out.map((r) => r.id), ["c", "b", "a", "d"]); // pending (FIFO), approved, declined
  assert.deepEqual(input.map((r) => r.id), snapshot); // entrée non mutée
});

test("resaQueueSummary : compte honnête par statut ; liste vide = zéros", () => {
  const s = resaQueueSummary([
    req({ status: "pending" }),
    req({ status: "pending" }),
    req({ status: "approved" }),
    req({ status: "declined" }),
    req({ status: "cancelled" }),
  ]);
  assert.deepEqual(s, { total: 5, pending: 2, approved: 1, declined: 1, cancelled: 1 });
  assert.deepEqual(resaQueueSummary([]), {
    total: 0,
    pending: 0,
    approved: 0,
    declined: 0,
    cancelled: 0,
  });
});

test("requestSummaryLabel : table + personnes + mention debout ; table retirée honnête", () => {
  assert.equal(
    requestSummaryLabel({ table_label: "205", party_size: 6, standing: false }),
    "Table 205 · 6 pers.",
  );
  assert.equal(
    requestSummaryLabel({ table_label: "500", party_size: 8, standing: true }),
    "Table 500 · 8 pers. · groupe debout",
  );
  assert.equal(
    requestSummaryLabel({ table_label: null, party_size: 2, standing: false }),
    "Table (retirée) · 2 pers.",
  );
});
