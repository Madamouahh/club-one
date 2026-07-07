// tests/serverAttribution.test.mts — logique pure de l'attribution serveur↔table (migration 0060).
// Couvre : roster → serveurs assignables (role-authoritative), map d'attribution, détection de conflit
// (double attribution), action create/update/noop, et le mapping du rapport par serveur (buildServerReport).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignableServers,
  isAssignableServer,
  buildAssignmentMap,
  serverForTable,
  detectConflicts,
  assignmentAction,
} from "../app/_modules/reporting/serverAttributionHelpers.ts";
import {
  buildServerReport,
  type StaffRosterEntry,
  type ServerReportTable,
  type ServerTableAssignment,
} from "../lib/serverReports.ts";

const roster: StaffRosterEntry[] = [
  { username: "jeremy", role: "server" },
  { username: "sofia", role: "server" },
  { username: "boss", role: "admin" },
  { username: "mathias", role: "promoter" },
  { username: " ", role: "server" }, // username vide → ignoré
  { username: "jeremy", role: "server" }, // doublon → dédupliqué
];

test("roster → serveurs assignables : role-authoritative, dédupliqué, trié, sans nom en dur", () => {
  assert.deepEqual(assignableServers(roster), ["jeremy", "sofia"]);
  // Un admin / promoteur n'est JAMAIS assignable comme serveur.
  assert.equal(assignableServers(roster).includes("boss"), false);
  assert.equal(assignableServers(roster).includes("mathias"), false);
});

test("assignableServers : entrées vides / nulles → liste vide honnête", () => {
  assert.deepEqual(assignableServers([]), []);
  assert.deepEqual(assignableServers(null), []);
  assert.deepEqual(assignableServers([{ username: "x", role: "manager" }]), []);
});

test("isAssignableServer : fail-closed sur non-serveur / inconnu / vide", () => {
  assert.equal(isAssignableServer(roster, "jeremy"), true);
  assert.equal(isAssignableServer(roster, "boss"), false); // admin
  assert.equal(isAssignableServer(roster, "fantome"), false); // hors roster
  assert.equal(isAssignableServer(roster, "  "), false);
  assert.equal(isAssignableServer(roster, null), false);
});

test("buildAssignmentMap / serverForTable : lookup table → serveur", () => {
  const assignments: ServerTableAssignment[] = [
    { table_id: "A1", server_username: "jeremy" },
    { table_id: "B2", server_username: "sofia" },
    { table_id: "", server_username: "jeremy" }, // table vide → ignorée
    { table_id: "C3", server_username: " " }, // serveur vide → ignoré
  ];
  const map = buildAssignmentMap(assignments);
  assert.equal(map.get("A1"), "jeremy");
  assert.equal(map.get("B2"), "sofia");
  assert.equal(map.has("C3"), false);
  assert.equal(serverForTable(assignments, "A1"), "jeremy");
  assert.equal(serverForTable(assignments, "Z9"), null); // non attribuée
  assert.equal(serverForTable(assignments, ""), null);
});

test("détection de DOUBLE attribution : même table à deux serveurs distincts", () => {
  const incoherent: ServerTableAssignment[] = [
    { table_id: "A1", server_username: "jeremy" },
    { table_id: "A1", server_username: "sofia" }, // conflit sur A1
    { table_id: "B2", server_username: "sofia" },
    { table_id: "B2", server_username: "sofia" }, // même serveur → PAS un conflit
  ];
  assert.deepEqual(detectConflicts(incoherent), ["A1"]);
});

test("aucun conflit quand chaque table a au plus un serveur", () => {
  assert.deepEqual(
    detectConflicts([
      { table_id: "A1", server_username: "jeremy" },
      { table_id: "B2", server_username: "sofia" },
    ]),
    [],
  );
  assert.deepEqual(detectConflicts([]), []);
});

test("assignmentAction : create / update / noop", () => {
  const assignments: ServerTableAssignment[] = [{ table_id: "A1", server_username: "jeremy" }];
  assert.equal(assignmentAction(assignments, "A2", "jeremy"), "create"); // table libre
  assert.equal(assignmentAction(assignments, "A1", "sofia"), "update"); // changement de serveur
  assert.equal(assignmentAction(assignments, "A1", "jeremy"), "noop"); // déjà ce serveur
  assert.equal(assignmentAction(assignments, "", "jeremy"), "create"); // entrée incomplète → create
});

test("mapping rapport par serveur : tables servies, CA, moyenne (données réelles)", () => {
  const tables: ServerReportTable[] = [
    { id: "A1", expenses: [{ id: "e1", amount: 30000 }, { id: "e2", amount: 10000 }] },
    { id: "A2", expenses: [{ id: "e3", amount: 20000 }] },
    { id: "B1", expenses: [{ id: "e4", amount: 5000 }] },
  ];
  const assignments: ServerTableAssignment[] = [
    { table_id: "A1", server_username: "jeremy" },
    { table_id: "A2", server_username: "jeremy" },
    { table_id: "B1", server_username: "sofia" },
    { table_id: "A1", server_username: "boss" }, // boss = admin (non-serveur) → ignoré, pas de double CA
  ];
  const rows = buildServerReport(roster, tables, assignments, {});

  const jeremy = rows.find((r) => r.server === "jeremy");
  assert.ok(jeremy);
  assert.equal(jeremy.tablesServed, 2);
  assert.equal(jeremy.totalSpendCents, 60000); // 30000 + 10000 + 20000
  assert.equal(jeremy.averagePerTableCents, 30000);

  const sofia = rows.find((r) => r.server === "sofia");
  assert.ok(sofia);
  assert.equal(sofia.tablesServed, 1);
  assert.equal(sofia.totalSpendCents, 5000);
  assert.equal(sofia.averagePerTableCents, 5000);

  // boss (admin) n'apparaît jamais dans le rapport serveur (role-authoritative, fail-closed).
  assert.equal(rows.some((r) => r.server === "boss"), false);
});

test("rapport vide honnête quand aucune attribution", () => {
  assert.deepEqual(buildServerReport(roster, [{ id: "A1", expenses: [{ id: "e", amount: 100 }] }], []), []);
});
