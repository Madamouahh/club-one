import assert from "node:assert/strict";
import test from "node:test";

import {
  canViewResaRequests,
  firstDecideResult,
  fullGuestName,
  mapReservationRequestRow,
  mapReservationRequestRows,
  type RawReservationRequestRow,
} from "../app/_modules/crmboards/reservationRequests.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Fabrique de ligne brute (100 % déterministe, aucune horloge). Reflète une ligne
// table_reservation_requests (0025) jointe à venue_tables + guests.
// ————————————————————————————————————————————————————————————————
function raw(over: Partial<RawReservationRequestRow> = {}): RawReservationRequestRow {
  return {
    id: "r1",
    venue_table_id: "t1",
    guest_id: "g1",
    event_id: "ev1",
    exploitation_date: "2026-07-04",
    venue: "eden",
    party_size: 6,
    standing: false,
    slot: "23:00",
    guest_note: null,
    status: "pending",
    owner_promoter: null,
    decided_by: null,
    decided_at: null,
    decline_reason: null,
    created_at: "2026-07-01T18:00:00Z",
    venue_tables: { label: "205" },
    guests: { first_name: "Alice", last_name: "Martin", phone: "+33123456789" },
    ...over,
  };
}

// ————————————————————————————————————————————————————————————————
// fullGuestName
// ————————————————————————————————————————————————————————————————
test("fullGuestName combine prénom + nom, trim, et null si rien", () => {
  assert.equal(fullGuestName("Alice", "Martin"), "Alice Martin");
  assert.equal(fullGuestName("  Alice  ", null), "Alice");
  assert.equal(fullGuestName(null, "Martin"), "Martin");
  assert.equal(fullGuestName(null, null), null);
  assert.equal(fullGuestName("", "   "), null); // jamais une chaîne vide fabriquée
});

// ————————————————————————————————————————————————————————————————
// mapReservationRequestRow — miroir strict du modèle 0025, aucun défaut fabriqué
// ————————————————————————————————————————————————————————————————
test("mapReservationRequestRow mappe une ligne jointe complète", () => {
  const row = mapReservationRequestRow(raw());
  assert.equal(row.id, "r1");
  assert.equal(row.venue_table_id, "t1");
  assert.equal(row.status, "pending");
  assert.equal(row.party_size, 6);
  assert.equal(row.table_label, "205");
  assert.equal(row.guest_name, "Alice Martin");
  assert.equal(row.guest_phone, "+33123456789");
});

test("mapReservationRequestRow tolère les jointures absentes sans rien fabriquer", () => {
  const row = mapReservationRequestRow(
    raw({ venue_tables: null, guests: null, slot: null, owner_promoter: null }),
  );
  assert.equal(row.table_label, null); // libellé de table absent → null (jamais « Table (retirée) » ici)
  assert.equal(row.guest_name, null);
  assert.equal(row.guest_phone, null);
  assert.equal(row.slot, null);
});

test("mapReservationRequestRow accepte un embed sous forme de tableau (prend le 1er)", () => {
  const row = mapReservationRequestRow(
    raw({
      venue_tables: [{ label: "Carré VIP" }],
      guests: [{ first_name: "Bob", last_name: null, phone: null }],
    }),
  );
  assert.equal(row.table_label, "Carré VIP");
  assert.equal(row.guest_name, "Bob");
  assert.equal(row.guest_phone, null);
});

test("mapReservationRequestRow gère un embed tableau vide → null honnête", () => {
  const row = mapReservationRequestRow(raw({ venue_tables: [], guests: [] }));
  assert.equal(row.table_label, null);
  assert.equal(row.guest_name, null);
});

test("mapReservationRequestRow conserve les champs de décision d'une demande traitée", () => {
  const row = mapReservationRequestRow(
    raw({ status: "declined", decided_by: "manager1", decided_at: "2026-07-02T10:00:00Z", decline_reason: "complet" }),
  );
  assert.equal(row.status, "declined");
  assert.equal(row.decided_by, "manager1");
  assert.equal(row.decided_at, "2026-07-02T10:00:00Z");
  assert.equal(row.decline_reason, "complet");
});

test("mapReservationRequestRows mappe un lot en préservant l'ordre", () => {
  const rows = mapReservationRequestRows([
    raw({ id: "a" }),
    raw({ id: "b", guests: { first_name: "Zoé", last_name: null, phone: null } }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"]);
  assert.equal(rows[1].guest_name, "Zoé");
});

// ————————————————————————————————————————————————————————————————
// canViewResaRequests — miroir de trr_read : direction + promoteur ; autres fermés
// ————————————————————————————————————————————————————————————————
test("canViewResaRequests : admin/manager/promoter oui, les autres non", () => {
  assert.equal(canViewResaRequests("admin"), true);
  assert.equal(canViewResaRequests("manager"), true);
  assert.equal(canViewResaRequests("promoter"), true);
  assert.equal(canViewResaRequests("server"), false);
  assert.equal(canViewResaRequests("security"), false);
  assert.equal(canViewResaRequests("security_counter"), false);
  assert.equal(canViewResaRequests(null), false);
  assert.equal(canViewResaRequests(undefined), false);
  // Tout rôle connu est classé explicitement (aucune surprise si la matrice évolue).
  for (const r of STAFF_ROLES as readonly StaffRole[]) {
    assert.equal(typeof canViewResaRequests(r), "boolean");
  }
});

// ————————————————————————————————————————————————————————————————
// firstDecideResult — normalisation du retour RPC, aucun succès fabriqué
// ————————————————————————————————————————————————————————————————
test("firstDecideResult extrait la 1re ligne d'un tableau", () => {
  const res = firstDecideResult([{ ok: true, code: "approved", message: "Demande validée.", status: "approved" }]);
  assert.deepEqual(res, { ok: true, code: "approved", message: "Demande validée.", status: "approved" });
});

test("firstDecideResult accepte une ligne unique (objet)", () => {
  const res = firstDecideResult({ ok: false, code: "not_pending", message: "Déjà traitée.", status: "approved" });
  assert.equal(res?.ok, false);
  assert.equal(res?.code, "not_pending");
});

test("firstDecideResult → null si rien d'exploitable (jamais un faux succès)", () => {
  assert.equal(firstDecideResult(null), null);
  assert.equal(firstDecideResult([]), null);
  assert.equal(firstDecideResult(undefined), null);
  assert.equal(firstDecideResult({ message: "x" }), null); // pas de ok booléen → null
});
