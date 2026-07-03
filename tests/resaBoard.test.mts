import assert from "node:assert/strict";
import test from "node:test";

import {
  ARRIVAL_STATES,
  ARRIVAL_STATE_STYLE,
  applyArrival,
  arrivalStateLabel,
  buildReservationBoard,
  canMarkArrival,
  canViewResaBoard,
  formatCovers,
  isArrivalState,
  isArrivalTransition,
  isOnBoard,
  resolveArrival,
  sortForBoard,
  type ArrivalState,
} from "../lib/resaBoard.ts";
import { assemblePendingRow, type ReservationRequestRow } from "../lib/resaRequest.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Fabrique de lignes de test (100 % déterministe : id + created_at fournis, aucune horloge)
// ————————————————————————————————————————————————————————————————
function row(over: {
  id: string;
  createdAt: string;
  label?: string;
  partySize?: number;
  standing?: boolean;
  slot?: string | null;
  status?: ReservationRequestRow["status"];
}): ReservationRequestRow {
  const base = assemblePendingRow({
    id: over.id,
    createdAt: over.createdAt,
    table: { id: `t-${over.id}`, venue: "eden", standing: over.standing ?? false, label: over.label ?? "205" },
    guestId: `g-${over.id}`,
    eventId: "ev-1",
    exploitationDate: "2026-07-03",
    partySize: over.partySize ?? 4,
    slot: over.slot ?? null,
    guestNote: null,
    guestName: "Client démo",
    guestPhone: null,
  });
  return { ...base, status: over.status ?? "approved" };
}

// ————————————————————————————————————————————————————————————————
// isOnBoard : SEULE l'approuvée monte sur le banc
// ————————————————————————————————————————————————————————————————
test("isOnBoard : approved OUI ; pending/declined/cancelled NON", () => {
  assert.equal(isOnBoard("approved"), true);
  assert.equal(isOnBoard("pending"), false);
  assert.equal(isOnBoard("declined"), false);
  assert.equal(isOnBoard("cancelled"), false);
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle : direction + accueil/porte voient ; serveur/promoteur non
// ————————————————————————————————————————————————————————————————
test("canViewResaBoard : admin/manager/security/security_counter OUI ; server/promoter NON", () => {
  for (const r of ["admin", "manager", "security", "security_counter"] as StaffRole[]) {
    assert.equal(canViewResaBoard(r), true, `${r} doit voir le banc`);
  }
  for (const r of ["server", "promoter"] as StaffRole[]) {
    assert.equal(canViewResaBoard(r), false, `${r} ne doit PAS voir le banc`);
  }
  assert.equal(canViewResaBoard(null), false);
  assert.equal(canViewResaBoard(undefined), false);
});

test("canMarkArrival : admin/manager/security_counter OUI ; security consulte seulement", () => {
  for (const r of ["admin", "manager", "security_counter"] as StaffRole[]) {
    assert.equal(canMarkArrival(r), true, `${r} doit pouvoir pointer`);
  }
  assert.equal(canMarkArrival("security"), false, "security consulte mais ne pointe pas");
  for (const r of ["server", "promoter"] as StaffRole[]) {
    assert.equal(canMarkArrival(r), false);
  }
  assert.equal(canMarkArrival(null), false);
});

test("chaque rôle du référentiel a une décision de garde définie (pas de undefined)", () => {
  for (const r of STAFF_ROLES) {
    assert.equal(typeof canViewResaBoard(r), "boolean");
    assert.equal(typeof canMarkArrival(r), "boolean");
  }
});

// ————————————————————————————————————————————————————————————————
// resolveArrival : défaut `attendu`, jamais deviné arrivé/no-show
// ————————————————————————————————————————————————————————————————
test("resolveArrival : explicite valide prime, sinon `attendu` (jamais deviné)", () => {
  assert.equal(resolveArrival("arrive"), "arrive");
  assert.equal(resolveArrival("no_show"), "no_show");
  assert.equal(resolveArrival("attendu"), "attendu");
  assert.equal(resolveArrival(null), "attendu");
  assert.equal(resolveArrival(undefined), "attendu");
  // valeur illisible → attendu, jamais « arrivé »
  assert.equal(resolveArrival("n_importe_quoi" as unknown as ArrivalState), "attendu");
});

test("isArrivalState : bornes", () => {
  for (const s of ARRIVAL_STATES) assert.equal(isArrivalState(s), true);
  assert.equal(isArrivalState("arrivee"), false);
  assert.equal(isArrivalState(""), false);
  assert.equal(isArrivalState(null), false);
  assert.equal(isArrivalState(2), false);
});

test("isArrivalTransition : changement d'état OK ; même état = no-op", () => {
  assert.equal(isArrivalTransition("attendu", "arrive"), true);
  assert.equal(isArrivalTransition("arrive", "no_show"), true);
  assert.equal(isArrivalTransition("no_show", "attendu"), true); // correction d'un pointage erroné
  assert.equal(isArrivalTransition("arrive", "arrive"), false);
});

// ————————————————————————————————————————————————————————————————
// buildReservationBoard : ne garde que les approuvées, honnête sur le vide
// ————————————————————————————————————————————————————————————————
test("buildReservationBoard : filtre les non-approuvées", () => {
  const view = buildReservationBoard({
    role: "manager",
    requests: [
      row({ id: "a", createdAt: "2026-07-03T18:00:00Z", status: "approved" }),
      row({ id: "b", createdAt: "2026-07-03T18:01:00Z", status: "pending" }),
      row({ id: "c", createdAt: "2026-07-03T18:02:00Z", status: "declined" }),
      row({ id: "d", createdAt: "2026-07-03T18:03:00Z", status: "cancelled" }),
      row({ id: "e", createdAt: "2026-07-03T18:04:00Z", status: "approved" }),
    ],
  });
  assert.deepEqual(
    view.rows.map((r) => r.request.id),
    ["a", "e"],
  );
  assert.equal(view.summary.total, 2);
});

test("buildReservationBoard : banc VIDE honnête (aucune approuvée → tout à zéro, aucun invité fabriqué)", () => {
  const view = buildReservationBoard({
    role: "manager",
    requests: [row({ id: "a", createdAt: "2026-07-03T18:00:00Z", status: "pending" })],
  });
  assert.equal(view.rows.length, 0);
  assert.equal(view.summary.total, 0);
  assert.deepEqual(view.summary.byArrival, { attendu: 0, arrive: 0, no_show: 0 });
  assert.equal(view.summary.expectedCovers, 0);
  assert.equal(view.summary.arrivedCovers, 0);
  assert.equal(view.summary.pendingArrivals, 0);
});

test("buildReservationBoard : garde de rôle reportée sans filtrer les lignes (la sécurité reste la RLS)", () => {
  const requests = [row({ id: "a", createdAt: "2026-07-03T18:00:00Z" })];
  const asServer = buildReservationBoard({ role: "server", requests });
  assert.equal(asServer.canView, false);
  assert.equal(asServer.canMark, false);
  // canView pilote l'affichage côté composant ; la lib ne masque pas la donnée elle-même.
  const asManager = buildReservationBoard({ role: "manager", requests });
  assert.equal(asManager.canView, true);
  assert.equal(asManager.canMark, true);
});

// ————————————————————————————————————————————————————————————————
// Pointage : état résolu, compteurs et couverts honnêtes
// ————————————————————————————————————————————————————————————————
test("buildReservationBoard : arrivals map appliquée, défaut `attendu`", () => {
  const view = buildReservationBoard({
    role: "manager",
    requests: [
      row({ id: "a", createdAt: "2026-07-03T18:00:00Z", partySize: 4 }),
      row({ id: "b", createdAt: "2026-07-03T18:01:00Z", partySize: 6 }),
      row({ id: "c", createdAt: "2026-07-03T18:02:00Z", partySize: 2 }),
    ],
    arrivals: { b: "arrive", c: "no_show" },
  });
  const byId = Object.fromEntries(view.rows.map((r) => [r.request.id, r.arrival]));
  assert.equal(byId.a, "attendu"); // non pointé → attendu (jamais deviné)
  assert.equal(byId.b, "arrive");
  assert.equal(byId.c, "no_show");
  assert.deepEqual(view.summary.byArrival, { attendu: 1, arrive: 1, no_show: 1 });
  assert.equal(view.summary.pendingArrivals, 1);
  // couverts attendus = attendu + arrivé (4 + 6), le no-show (2) exclu
  assert.equal(view.summary.expectedCovers, 10);
  // couverts arrivés = arrivé seul (6)
  assert.equal(view.summary.arrivedCovers, 6);
});

// ————————————————————————————————————————————————————————————————
// Tri déterministe : attendu d'abord, puis créneau, puis ancienneté, puis id
// ————————————————————————————————————————————————————————————————
test("sortForBoard : attendu avant arrivé avant no-show", () => {
  const view = buildReservationBoard({
    role: "manager",
    requests: [
      row({ id: "x", createdAt: "2026-07-03T18:00:00Z" }),
      row({ id: "y", createdAt: "2026-07-03T18:01:00Z" }),
      row({ id: "z", createdAt: "2026-07-03T18:02:00Z" }),
    ],
    arrivals: { x: "no_show", y: "arrive", z: "attendu" },
  });
  assert.deepEqual(
    view.rows.map((r) => r.request.id),
    ["z", "y", "x"],
  );
});

test("sortForBoard : à état égal, créneau croissant (null en dernier) puis ancienneté puis id", () => {
  const rows = [
    { request: row({ id: "b", createdAt: "2026-07-03T18:00:00Z", slot: "00:00" }), arrival: "attendu" as ArrivalState, covers: 4, label: "" },
    { request: row({ id: "a", createdAt: "2026-07-03T18:00:00Z", slot: "23:00" }), arrival: "attendu" as ArrivalState, covers: 4, label: "" },
    { request: row({ id: "c", createdAt: "2026-07-03T18:00:00Z", slot: null }), arrival: "attendu" as ArrivalState, covers: 4, label: "" },
  ];
  const sorted = sortForBoard(rows);
  assert.deepEqual(
    sorted.map((r) => r.request.id),
    ["b", "a", "c"], // "00:00" < "23:00" lexicographiquement ; créneau null en dernier
  );
});

test("sortForBoard : départage stable par id à créneau + ancienneté identiques", () => {
  const rows = ["m", "a", "z"].map((id) => ({
    request: row({ id, createdAt: "2026-07-03T18:00:00Z", slot: "23:00" }),
    arrival: "attendu" as ArrivalState,
    covers: 4,
    label: "",
  }));
  assert.deepEqual(
    sortForBoard(rows).map((r) => r.request.id),
    ["a", "m", "z"],
  );
});

test("sortForBoard : ne mute pas l'entrée", () => {
  const rows = [
    { request: row({ id: "b", createdAt: "2026-07-03T18:00:00Z" }), arrival: "arrive" as ArrivalState, covers: 4, label: "" },
    { request: row({ id: "a", createdAt: "2026-07-03T18:00:00Z" }), arrival: "attendu" as ArrivalState, covers: 4, label: "" },
  ];
  const before = rows.map((r) => r.request.id);
  sortForBoard(rows);
  assert.deepEqual(rows.map((r) => r.request.id), before);
});

// ————————————————————————————————————————————————————————————————
// applyArrival : immuable, ajoute/écrase sans muter
// ————————————————————————————————————————————————————————————————
test("applyArrival : nouvelle map, source inchangée", () => {
  const base: Record<string, ArrivalState> = { a: "attendu" };
  const next = applyArrival(base, "a", "arrive");
  assert.equal(next.a, "arrive");
  assert.equal(base.a, "attendu"); // source non mutée
  const added = applyArrival(base, "b", "no_show");
  assert.equal(added.b, "no_show");
  assert.equal(added.a, "attendu");
});

// ————————————————————————————————————————————————————————————————
// Libellés / style / formatage
// ————————————————————————————————————————————————————————————————
test("libellés d'état et style présents pour chaque état", () => {
  for (const s of ARRIVAL_STATES) {
    assert.equal(typeof arrivalStateLabel(s), "string");
    assert.ok(arrivalStateLabel(s).length > 0);
    assert.ok(ARRIVAL_STATE_STYLE[s].stroke.startsWith("#"));
    assert.ok(ARRIVAL_STATE_STYLE[s].text.startsWith("#"));
  }
});

test("formatCovers : FR déterministe", () => {
  assert.equal(formatCovers(1), "1 pers.");
  assert.equal(formatCovers(6), "6 pers.");
  assert.equal(formatCovers(0), "0 pers.");
});

test("label de ligne réutilise requestSummaryLabel (pas de re-fabrication)", () => {
  const view = buildReservationBoard({
    role: "manager",
    requests: [row({ id: "a", createdAt: "2026-07-03T18:00:00Z", label: "205", partySize: 6, standing: true })],
  });
  assert.equal(view.rows[0].label, "Table 205 · 6 pers. · groupe debout");
});
