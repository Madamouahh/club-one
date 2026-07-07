// tests/promoterReports.test.mts — logique pure de la contribution par promoteur (lib/promoterReports.ts).
// Vague 2 : découverte role-authoritative (roster username→role) au lieu de l'heuristique assignedTo.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPromoterReport,
  type StaffRosterEntry,
  type PromoterReportTable,
  type PromoterReportGuestEntry,
} from "../lib/promoterReports.ts";

// Roster role-authoritative : mathias/quentin/enzo/nadia = promoter ; boss = admin ; jeremy = server.
const roster: StaffRosterEntry[] = [
  { username: "mathias", role: "promoter" },
  { username: "quentin", role: "promoter" },
  { username: "enzo", role: "promoter" },
  { username: "nadia", role: "promoter" },
  { username: "boss", role: "admin" },
  { username: "jeremy", role: "server" },
];

const tables: PromoterReportTable[] = [
  { id: "A1", promoter: "mathias", expenses: [{ id: "e1", amount: 30000 }, { id: "e2", amount: 10000 }] },
  { id: "A2", promoter: "mathias", expenses: [{ id: "e3", amount: 5000 }] },
  { id: "B1", promoter: "quentin", expenses: [{ id: "e4", amount: 20000 }] },
  { id: "C1", promoter: "", expenses: [{ id: "e5", amount: 9999 }] }, // non attribuée → ignorée
  { id: "D1", promoter: "boss", expenses: [{ id: "e6", amount: 77000 }] }, // assigné = admin (non-promoteur) → ignorée
];

const entries: PromoterReportGuestEntry[] = [
  { promoter_username: "mathias", checked_in: true },
  { promoter_username: "mathias", checked_in: false },
  { promoter_username: "quentin", checked_in: true },
  // enzo n'a AUCUNE table mais amène des invités → doit apparaître (rôle promoter).
  { promoter_username: "enzo", checked_in: true },
  { promoter_username: "enzo", checked_in: false },
];

test("agrège par promoteur : CA, tables assignées, invités amenés / pointés", () => {
  const rows = buildPromoterReport(roster, tables, entries);
  const mathias = rows.find((r) => r.promoter === "mathias");
  const quentin = rows.find((r) => r.promoter === "quentin");

  assert.ok(mathias);
  assert.equal(mathias.caCents, 45000); // 30000 + 10000 + 5000
  assert.equal(mathias.tablesAssigned, 2);
  assert.equal(mathias.guestsBrought, 2);
  assert.equal(mathias.guestsCheckedIn, 1);

  assert.ok(quentin);
  assert.equal(quentin.caCents, 20000);
  assert.equal(quentin.tablesAssigned, 1);
  assert.equal(quentin.guestsBrought, 1);
  assert.equal(quentin.guestsCheckedIn, 1);
});

test("CŒUR DU FIX : découverte par RÔLE — un promoteur (rôle) apparaît, un assigné NON-promoteur NON", () => {
  const rows = buildPromoterReport(roster, tables, entries);

  // enzo (rôle promoter, invités seulement) apparaît même sans table.
  const enzo = rows.find((r) => r.promoter === "enzo");
  assert.ok(enzo, "un promoteur identifié par RÔLE apparaît dès qu'il amène des invités");
  assert.equal(enzo.caCents, 0); // aucune table → CA 0, pas de CA fabriqué
  assert.equal(enzo.tablesAssigned, 0);
  assert.equal(enzo.guestsBrought, 2);
  assert.equal(enzo.guestsCheckedIn, 1);

  // boss est admin : sa table D1 (77000) ne DOIT PAS être comptée comme CA promoteur.
  assert.equal(rows.some((r) => r.promoter === "boss"), false);
  assert.equal(rows.some((r) => r.caCents === 77000), false);
});

test("promoteur (rôle) avec tables mais sans invités apparaît", () => {
  const rows = buildPromoterReport(
    [{ username: "solo", role: "promoter" }],
    [{ id: "T1", promoter: "solo", expenses: [{ id: "s1", amount: 7000 }] }],
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].promoter, "solo");
  assert.equal(rows[0].guestsBrought, 0);
  assert.equal(rows[0].caCents, 7000);
});

test("table non attribuée (promoter vide) est ignorée", () => {
  const rows = buildPromoterReport(roster, tables, entries);
  assert.equal(rows.some((r) => r.caCents === 9999), false);
  assert.equal(rows.some((r) => r.promoter === ""), false);
});

test("username hors roster (rôle inconnu) est ignoré (fail-closed)", () => {
  const rows = buildPromoterReport(
    [{ username: "mathias", role: "promoter" }],
    [{ id: "T1", promoter: "fantome", expenses: [{ id: "z", amount: 5000 }] }],
    [{ promoter_username: "fantome", checked_in: true }],
  );
  assert.deepEqual(rows, []);
});

test("déduplication des dépenses par id (dépense partagée entre tables liées)", () => {
  const rows = buildPromoterReport(
    [{ username: "mathias", role: "promoter" }],
    [
      { id: "L1", promoter: "mathias", expenses: [{ id: "shared", amount: 8000 }] },
      { id: "L2", promoter: "mathias", expenses: [{ id: "shared", amount: 8000 }] },
    ],
    [],
  );
  assert.equal(rows[0].caCents, 8000); // comptée une seule fois
  assert.equal(rows[0].tablesAssigned, 2);
});

test("guestsCheckedIn ne dépasse jamais guestsBrought", () => {
  const rows = buildPromoterReport(
    [{ username: "p", role: "promoter" }],
    [],
    [
      { promoter_username: "p", checked_in: true },
      { promoter_username: "p", checked_in: true },
      { promoter_username: "p", checked_in: null },
    ],
  );
  assert.equal(rows[0].guestsBrought, 3);
  assert.equal(rows[0].guestsCheckedIn, 2);
});

test("entrée vide → tableau vide (base vide honnête)", () => {
  assert.deepEqual(buildPromoterReport([], [], []), []);
  assert.deepEqual(buildPromoterReport(roster, [], []), []);
});

test("tri : CA décroissant, départage par nom (déterministe)", () => {
  const rows = buildPromoterReport(
    [
      { username: "bob", role: "promoter" },
      { username: "alice", role: "promoter" },
      { username: "carol", role: "promoter" },
    ],
    [
      { id: "T1", promoter: "bob", expenses: [{ id: "a", amount: 5000 }] },
      { id: "T2", promoter: "alice", expenses: [{ id: "b", amount: 5000 }] },
      { id: "T3", promoter: "carol", expenses: [{ id: "c", amount: 9000 }] },
    ],
    [],
  );
  assert.deepEqual(
    rows.map((r) => r.promoter),
    ["carol", "alice", "bob"],
  );
});
