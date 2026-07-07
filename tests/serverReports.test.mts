// tests/serverReports.test.mts — logique pure du reporting par serveur (lib/serverReports.ts).
// Vague 2 : découverte role-authoritative (roster) + attribution RÉELLE (table_server_assignments).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildServerReport,
  type StaffRosterEntry,
  type ServerReportTable,
  type ServerTableAssignment,
  type ServerReportEntryLog,
} from "../lib/serverReports.ts";

// Roster role-authoritative : jeremy/sofia = server ; boss = admin ; mathias = promoter.
const roster: StaffRosterEntry[] = [
  { username: "jeremy", role: "server" },
  { username: "sofia", role: "server" },
  { username: "boss", role: "admin" },
  { username: "mathias", role: "promoter" },
];

// Tables = SOURCE DE DÉPENSE uniquement (aucun champ serveur).
const tables: ServerReportTable[] = [
  { id: "A1", expenses: [{ id: "e1", amount: 12000 }, { id: "e2", amount: 3000 }] },
  { id: "A2", expenses: [{ id: "e3", amount: 5000 }] },
  { id: "B1", expenses: [{ id: "e4", amount: 20000 }] },
  { id: "B2", expenses: [] }, // servie mais sans dépense → compte comme table, 0 CA
  { id: "C1", expenses: [{ id: "e5", amount: 9999 }] },
];

// Attribution RÉELLE serveur↔table.
const assignments: ServerTableAssignment[] = [
  { table_id: "A1", server_username: "jeremy" },
  { table_id: "A2", server_username: "jeremy" },
  { table_id: "B2", server_username: "jeremy" },
  { table_id: "B1", server_username: "sofia" },
  { table_id: "C1", server_username: "mathias" }, // mathias = promoter (pas server) → attribution IGNORÉE
];

test("agrège par serveur via l'attribution réelle : tables, dépense, moyenne", () => {
  const rows = buildServerReport(roster, tables, assignments);
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

test("ROLE-AUTHORITATIVE : attribution vers un NON-serveur (promoteur) est ignorée", () => {
  const rows = buildServerReport(roster, tables, assignments);
  // C1 (9999) est attribuée à mathias (promoter) → n'apparaît dans AUCUNE ligne serveur.
  assert.equal(rows.some((r) => r.server === "mathias"), false);
  assert.equal(rows.some((r) => r.totalSpendCents === 9999), false);
});

test("serveur hors de toute liste héritée ressort dès qu'il a le rôle + une attribution", () => {
  const rows = buildServerReport(
    [{ username: "nouvelle_recrue", role: "server" }],
    [{ id: "Z9", expenses: [{ id: "x1", amount: 4200 }] }],
    [{ table_id: "Z9", server_username: "nouvelle_recrue" }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server, "nouvelle_recrue");
  assert.equal(rows[0].totalSpendCents, 4200);
});

test("attribution vers un username ABSENT du roster est ignorée (fail-closed)", () => {
  const rows = buildServerReport(
    [{ username: "jeremy", role: "server" }],
    [{ id: "T1", expenses: [{ id: "a", amount: 5000 }] }],
    [{ table_id: "T1", server_username: "inconnu" }],
  );
  assert.deepEqual(rows, []);
});

test("entrées gérées : logs 'entry' comptés SEULEMENT pour un serveur au roster ; union avec les tables", () => {
  const rosterWithPortier: StaffRosterEntry[] = [
    ...roster,
    { username: "portier_server", role: "server" }, // serveur sans table
    { username: "securite1", role: "security" }, // non-serveur → ses entrées ignorées
  ];
  const entries: ServerReportEntryLog[] = [
    { staff_username: "jeremy", type: "entry" },
    { staff_username: "jeremy", type: "entry" },
    { staff_username: "jeremy", type: "exit" }, // exit ne compte pas
    { staff_username: "portier_server", type: "entry" }, // serveur sans table → apparaît quand même
    { staff_username: "securite1", type: "entry" }, // non-serveur → ignoré
  ];
  const rows = buildServerReport(rosterWithPortier, tables, assignments, { entries });

  const jeremy = rows.find((r) => r.server === "jeremy");
  assert.equal(jeremy?.entriesHandled, 2);

  const portier = rows.find((r) => r.server === "portier_server");
  assert.ok(portier, "un serveur (par rôle) qui n'a que pointé des entrées apparaît via l'union");
  assert.equal(portier.tablesServed, 0);
  assert.equal(portier.totalSpendCents, 0);
  assert.equal(portier.averagePerTableCents, null); // aucune table → pas de moyenne fabriquée
  assert.equal(portier.entriesHandled, 1);

  assert.equal(rows.some((r) => r.server === "securite1"), false);
});

test("déduplication des dépenses par id (dépense partagée entre tables liées, même serveur)", () => {
  const rows = buildServerReport(
    [{ username: "jeremy", role: "server" }],
    [
      { id: "L1", expenses: [{ id: "shared", amount: 8000 }] },
      { id: "L2", expenses: [{ id: "shared", amount: 8000 }] }, // même dépense (tables liées)
    ],
    [
      { table_id: "L1", server_username: "jeremy" },
      { table_id: "L2", server_username: "jeremy" },
    ],
  );
  assert.equal(rows[0].totalSpendCents, 8000); // comptée une seule fois
  assert.equal(rows[0].tablesServed, 2);
});

test("montants illisibles → 0 ; discipline entière (arrondi)", () => {
  const rows = buildServerReport(
    [{ username: "jeremy", role: "server" }],
    [{ id: "A1", expenses: [{ amount: "3000" }, { amount: null }, { amount: undefined }, { amount: 10.6 }] }],
    [{ table_id: "A1", server_username: "jeremy" }],
  );
  assert.equal(rows[0].totalSpendCents, 3000 + 0 + 0 + 11);
});

test("entrée vide → tableau vide (état honnête, aucun serveur fabriqué)", () => {
  assert.deepEqual(buildServerReport([], [], []), []);
  assert.deepEqual(buildServerReport(roster, [], []), []);
  assert.deepEqual(buildServerReport(roster, tables, [], { entries: [] }), []);
});

test("tri : dépense décroissante, départage par nom (ordre déterministe)", () => {
  const rows = buildServerReport(
    [
      { username: "bob", role: "server" },
      { username: "alice", role: "server" },
      { username: "carol", role: "server" },
    ],
    [
      { id: "T1", expenses: [{ id: "a", amount: 5000 }] },
      { id: "T2", expenses: [{ id: "b", amount: 5000 }] },
      { id: "T3", expenses: [{ id: "c", amount: 9000 }] },
    ],
    [
      { table_id: "T1", server_username: "bob" },
      { table_id: "T2", server_username: "alice" }, // même CA que bob → alice avant bob
      { table_id: "T3", server_username: "carol" },
    ],
  );
  assert.deepEqual(
    rows.map((r) => r.server),
    ["carol", "alice", "bob"],
  );
});
