// tests/promoterReports.test.mts — logique pure de la contribution par promoteur (lib/promoterReports.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPromoterReport,
  type PromoterReportTable,
  type PromoterReportGuestEntry,
} from "../lib/promoterReports.ts";

const tables: PromoterReportTable[] = [
  {
    id: "A1",
    promoter: "mathias",
    expenses: [
      { id: "e1", amount: 30000 },
      { id: "e2", amount: 10000 },
    ],
  },
  { id: "A2", promoter: "mathias", expenses: [{ id: "e3", amount: 5000 }] },
  { id: "B1", promoter: "quentin", expenses: [{ id: "e4", amount: 20000 }] },
  { id: "C1", promoter: "", expenses: [{ id: "e5", amount: 9999 }] }, // non attribuée → ignorée
];

const entries: PromoterReportGuestEntry[] = [
  { promoter_username: "mathias", checked_in: true },
  { promoter_username: "mathias", checked_in: false },
  { promoter_username: "quentin", checked_in: true },
  // enzo n'a AUCUNE table mais amène des invités → doit apparaître (jeu dynamique).
  { promoter_username: "enzo", checked_in: true },
  { promoter_username: "enzo", checked_in: false },
];

test("agrège par promoteur : CA, tables assignées, invités amenés / pointés", () => {
  const rows = buildPromoterReport(tables, entries);
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

test("CŒUR DU FIX G1 : un promoteur HORS liste en dur apparaît (jeu dynamique)", () => {
  // "lawrence" faisait partie de la liste en dur ; "enzo" et "nadia" n'en font PAS partie.
  const rows = buildPromoterReport(
    [{ id: "T1", promoter: "nadia", expenses: [{ id: "z1", amount: 12345 }] }],
    [{ promoter_username: "enzo", checked_in: true }],
  );
  const names = rows.map((r) => r.promoter).sort();
  assert.deepEqual(names, ["enzo", "nadia"]);

  const nadia = rows.find((r) => r.promoter === "nadia");
  assert.equal(nadia?.caCents, 12345);
  assert.equal(nadia?.tablesAssigned, 1);

  const enzo = rows.find((r) => r.promoter === "enzo");
  assert.equal(enzo?.caCents, 0); // aucune table → CA 0, pas de CA fabriqué
  assert.equal(enzo?.tablesAssigned, 0);
  assert.equal(enzo?.guestsBrought, 1);
});

test("promoteur avec tables mais sans invités apparaît (union tables ∪ entrées)", () => {
  const rows = buildPromoterReport(
    [{ id: "T1", promoter: "solo", expenses: [{ id: "s1", amount: 7000 }] }],
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].promoter, "solo");
  assert.equal(rows[0].guestsBrought, 0);
  assert.equal(rows[0].caCents, 7000);
});

test("table non attribuée (promoter vide) est ignorée", () => {
  const rows = buildPromoterReport(tables, entries);
  assert.equal(rows.some((r) => r.caCents === 9999), false);
  assert.equal(rows.some((r) => r.promoter === ""), false);
});

test("déduplication des dépenses par id (dépense partagée entre tables liées)", () => {
  const rows = buildPromoterReport(
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
  assert.deepEqual(buildPromoterReport([], []), []);
});

test("tri : CA décroissant, départage par nom (déterministe)", () => {
  const rows = buildPromoterReport(
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
