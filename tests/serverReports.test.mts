// tests/serverReports.test.mts — logique pure du reporting par serveur (lib/serverReports.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildServerReport,
  type ServerReportTable,
  type ServerReportEntryLog,
} from "../lib/serverReports.ts";

const tables: ServerReportTable[] = [
  {
    id: "A1",
    server: "jeremy",
    expenses: [
      { id: "e1", amount: 12000 },
      { id: "e2", amount: 3000 },
    ],
  },
  { id: "A2", server: "jeremy", expenses: [{ id: "e3", amount: 5000 }] },
  { id: "B1", server: "sofia", expenses: [{ id: "e4", amount: 20000 }] },
  { id: "B2", server: "jeremy", expenses: [] }, // servie mais sans dépense → compte comme table, 0 CA
  { id: "C1", server: "", expenses: [{ id: "e5", amount: 9999 }] }, // non attribuée → ignorée
];

test("agrège par serveur : tables servies, dépense totale, moyenne, entrées", () => {
  const rows = buildServerReport(tables);
  const jeremy = rows.find((r) => r.server === "jeremy");
  const sofia = rows.find((r) => r.server === "sofia");

  assert.ok(jeremy);
  assert.equal(jeremy.tablesServed, 3); // A1, A2, B2
  assert.equal(jeremy.totalSpendCents, 20000); // 12000 + 3000 + 5000
  assert.equal(jeremy.averagePerTableCents, Math.round(20000 / 3));
  assert.equal(jeremy.entriesHandled, 0); // aucun log fourni

  assert.ok(sofia);
  assert.equal(sofia.tablesServed, 1);
  assert.equal(sofia.totalSpendCents, 20000);
  assert.equal(sofia.averagePerTableCents, 20000);
});

test("serveur non listé dans une liste héritée ressort quand même (jeu dynamique)", () => {
  const rows = buildServerReport([
    { id: "Z9", server: "nouvelle_recrue", expenses: [{ id: "x1", amount: 4200 }] },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server, "nouvelle_recrue");
  assert.equal(rows[0].totalSpendCents, 4200);
});

test("table non attribuée (server vide) est ignorée", () => {
  const rows = buildServerReport(tables);
  assert.equal(rows.some((r) => r.totalSpendCents === 9999), false);
  assert.equal(rows.some((r) => r.server === ""), false);
});

test("entrées gérées : compte les logs type 'entry' par staff_username ; union avec les tables", () => {
  const entries: ServerReportEntryLog[] = [
    { staff_username: "jeremy", type: "entry" },
    { staff_username: "jeremy", type: "entry" },
    { staff_username: "jeremy", type: "exit" }, // exit ne compte pas
    { staff_username: "portier_only", type: "entry" }, // serveur sans table → apparaît quand même
  ];
  const rows = buildServerReport(tables, { entries });

  const jeremy = rows.find((r) => r.server === "jeremy");
  assert.equal(jeremy?.entriesHandled, 2);

  const portier = rows.find((r) => r.server === "portier_only");
  assert.ok(portier, "un staff qui n'a que pointé des entrées apparaît via l'union");
  assert.equal(portier.tablesServed, 0);
  assert.equal(portier.totalSpendCents, 0);
  assert.equal(portier.averagePerTableCents, null); // aucune table → pas de moyenne fabriquée
  assert.equal(portier.entriesHandled, 1);
});

test("déduplication des dépenses par id (dépense partagée non comptée deux fois)", () => {
  const shared: ServerReportTable[] = [
    { id: "L1", server: "jeremy", expenses: [{ id: "shared", amount: 8000 }] },
    { id: "L2", server: "jeremy", expenses: [{ id: "shared", amount: 8000 }] }, // même dépense (tables liées)
  ];
  const rows = buildServerReport(shared);
  assert.equal(rows[0].totalSpendCents, 8000); // comptée une seule fois
  assert.equal(rows[0].tablesServed, 2);
});

test("montants illisibles → 0 ; discipline entière (arrondi)", () => {
  const rows = buildServerReport([
    {
      id: "A1",
      server: "jeremy",
      expenses: [{ amount: "3000" }, { amount: null }, { amount: undefined }, { amount: 10.6 }],
    },
  ]);
  assert.equal(rows[0].totalSpendCents, 3000 + 0 + 0 + 11);
});

test("entrée vide → tableau vide (état honnête, aucun serveur fabriqué)", () => {
  assert.deepEqual(buildServerReport([]), []);
  assert.deepEqual(buildServerReport([], { entries: [] }), []);
});

test("tri : dépense décroissante, départage par nom (ordre déterministe)", () => {
  const rows = buildServerReport([
    { id: "T1", server: "bob", expenses: [{ id: "a", amount: 5000 }] },
    { id: "T2", server: "alice", expenses: [{ id: "b", amount: 5000 }] }, // même CA que bob → alice avant bob
    { id: "T3", server: "carol", expenses: [{ id: "c", amount: 9000 }] },
  ]);
  assert.deepEqual(
    rows.map((r) => r.server),
    ["carol", "alice", "bob"],
  );
});
