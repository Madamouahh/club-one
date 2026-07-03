import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  actionLabel,
  buildAuditJournal,
  canRevertAuditEvent,
  canViewAuditJournal,
  categoryLabel,
  isAuditAction,
  markReverted,
  resolveCategory,
  sortForJournal,
  type AuditEventRow,
  type AuditJournalRow,
} from "../lib/auditJournal.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Fabrique d'événements de test (100 % déterministe : id + at fournis, aucune horloge)
// ————————————————————————————————————————————————————————————————
function ev(over: Partial<AuditEventRow> & { id: string; at: string; action: string }): AuditEventRow {
  return {
    id: over.id,
    at: over.at,
    actor: over.actor ?? "jeremy",
    actorRole: over.actorRole ?? "manager",
    action: over.action,
    targetLabel: over.targetLabel ?? null,
    venue: over.venue ?? "eden",
    reversible: over.reversible ?? false,
    revertedAt: over.revertedAt ?? null,
  };
}

// ————————————————————————————————————————————————————————————————
// Catalogue d'actions & catégories
// ————————————————————————————————————————————————————————————————
test("le catalogue d'actions est le miroir exact de la matrice RBAC §0.2", () => {
  assert.deepEqual(
    [...AUDIT_ACTIONS],
    [
      "reservation.create",
      "table.assign",
      "entry.increment",
      "incident.sensitive.read",
      "content.publish",
      "campaign.launch",
      "analytics.financial.read",
      "user.manage",
      "settings.manage",
    ],
  );
});

test("isAuditAction distingue une clé du catalogue d'une clé inconnue", () => {
  assert.equal(isAuditAction("table.assign"), true);
  assert.equal(isAuditAction("reservation.delete"), false);
  assert.equal(isAuditAction(42), false);
  assert.equal(isAuditAction(null), false);
});

test("resolveCategory classe chaque action connue, et retombe sur non_classe sans deviner", () => {
  assert.equal(resolveCategory("reservation.create"), "operation");
  assert.equal(resolveCategory("table.assign"), "operation");
  assert.equal(resolveCategory("entry.increment"), "operation");
  assert.equal(resolveCategory("incident.sensitive.read"), "sensible");
  assert.equal(resolveCategory("analytics.financial.read"), "sensible");
  assert.equal(resolveCategory("content.publish"), "administration");
  assert.equal(resolveCategory("campaign.launch"), "administration");
  assert.equal(resolveCategory("user.manage"), "administration");
  assert.equal(resolveCategory("settings.manage"), "administration");
  // action hors catalogue → non classée, jamais réinterprétée
  assert.equal(resolveCategory("mystere.action"), "non_classe");
});

test("chaque action du catalogue a une catégorie non 'non_classe'", () => {
  for (const a of AUDIT_ACTIONS) {
    assert.notEqual(resolveCategory(a), "non_classe", `${a} devrait être classée`);
  }
});

test("actionLabel rend le libellé FR d'une action connue, la clé brute d'une inconnue", () => {
  assert.equal(actionLabel("table.assign"), "Table attribuée");
  assert.equal(actionLabel("analytics.financial.read"), "Données financières consultées");
  assert.equal(actionLabel("mystere.action"), "mystere.action");
});

test("categoryLabel couvre toutes les catégories", () => {
  for (const c of AUDIT_CATEGORIES) {
    assert.equal(typeof categoryLabel(c), "string");
    assert.ok(categoryLabel(c).length > 0);
  }
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle (confort UI, PAS une sécurité)
// ————————————————————————————————————————————————————————————————
test("canViewAuditJournal : direction (admin/manager) seulement", () => {
  const expected: Record<StaffRole, boolean> = {
    admin: true,
    manager: true,
    server: false,
    security: false,
    security_counter: false,
    promoter: false,
  };
  for (const r of STAFF_ROLES) assert.equal(canViewAuditJournal(r), expected[r], r);
  assert.equal(canViewAuditJournal(null), false);
  assert.equal(canViewAuditJournal(undefined), false);
});

test("canRevertAuditEvent : admin seul (le manager consulte mais n'annule pas)", () => {
  const expected: Record<StaffRole, boolean> = {
    admin: true,
    manager: false,
    server: false,
    security: false,
    security_counter: false,
    promoter: false,
  };
  for (const r of STAFF_ROLES) assert.equal(canRevertAuditEvent(r), expected[r], r);
  assert.equal(canRevertAuditEvent(null), false);
});

// ————————————————————————————————————————————————————————————————
// Journal vide honnête
// ————————————————————————————————————————————————————————————————
test("journal vide : aucune ligne fabriquée, tous les compteurs à zéro", () => {
  const view = buildAuditJournal({ role: "admin", events: [] });
  assert.equal(view.canView, true);
  assert.equal(view.rows.length, 0);
  assert.equal(view.summary.total, 0);
  assert.equal(view.summary.distinctActors, 0);
  assert.equal(view.summary.reversibleCount, 0);
  assert.equal(view.summary.revertedCount, 0);
  assert.equal(view.summary.sensitiveCount, 0);
  assert.deepEqual(view.summary.byAction, []);
  assert.deepEqual(view.summary.byCategory, {
    operation: 0,
    sensible: 0,
    administration: 0,
    non_classe: 0,
  });
  assert.equal(view.filtered, false);
  assert.equal(view.totalBeforeFilter, 0);
});

test("garde refusée : la vue reste construite mais canView=false (sans filtrer la donnée)", () => {
  const events = [ev({ id: "e1", at: "2026-07-03T22:00:00Z", action: "table.assign" })];
  const view = buildAuditJournal({ role: "server", events });
  assert.equal(view.canView, false);
  assert.equal(view.canRevert, false);
  // la donnée n'est pas censurée par la lib (c'est la RLS qui filtre en amont) : la garde est UI
  assert.equal(view.rows.length, 1);
});

// ————————————————————————————————————————————————————————————————
// Tri : plus récent d'abord, stable
// ————————————————————————————————————————————————————————————————
test("tri : le plus récent d'abord, départage par id, non mutant", () => {
  const events = [
    ev({ id: "b", at: "2026-07-03T22:00:00Z", action: "table.assign" }),
    ev({ id: "a", at: "2026-07-03T23:00:00Z", action: "entry.increment" }),
    ev({ id: "c", at: "2026-07-03T22:00:00Z", action: "reservation.create" }),
  ];
  const snapshot = events.map((e) => e.id);
  const view = buildAuditJournal({ role: "admin", events });
  // 23:00 d'abord, puis les deux 22:00 départagés par id décroissant (c avant b)
  assert.deepEqual(view.rows.map((r) => r.event.id), ["a", "c", "b"]);
  // entrée non mutée
  assert.deepEqual(events.map((e) => e.id), snapshot);
});

test("sortForJournal ne mute pas l'entrée", () => {
  const rows: AuditJournalRow[] = [
    {
      event: ev({ id: "x", at: "2026-07-03T20:00:00Z", action: "table.assign" }),
      category: "operation",
      actionLabel: "Table attribuée",
      reverted: false,
      revertedAt: null,
    },
    {
      event: ev({ id: "y", at: "2026-07-03T21:00:00Z", action: "entry.increment" }),
      category: "operation",
      actionLabel: "Entrée comptée",
      reverted: false,
      revertedAt: null,
    },
  ];
  const before = rows.map((r) => r.event.id);
  sortForJournal(rows);
  assert.deepEqual(rows.map((r) => r.event.id), before);
});

// ————————————————————————————————————————————————————————————————
// Synthèse
// ————————————————————————————————————————————————————————————————
test("synthèse : catégories, acteurs distincts, réversibles vs annulés", () => {
  const events = [
    ev({ id: "e1", at: "2026-07-03T22:00:00Z", action: "table.assign", actor: "jeremy" }),
    ev({ id: "e2", at: "2026-07-03T22:10:00Z", action: "table.assign", actor: "lea", reversible: true }),
    ev({ id: "e3", at: "2026-07-03T22:20:00Z", action: "analytics.financial.read", actor: "patron" }),
    ev({
      id: "e4",
      at: "2026-07-03T22:30:00Z",
      action: "settings.manage",
      actor: "patron",
      reversible: true,
      revertedAt: "2026-07-03T22:45:00Z", // déjà annulée
    }),
    ev({ id: "e5", at: "2026-07-03T22:40:00Z", action: "mystere.action", actor: "jeremy" }),
  ];
  const view = buildAuditJournal({ role: "admin", events });
  assert.equal(view.summary.total, 5);
  assert.deepEqual(view.summary.byCategory, {
    operation: 2, // 2× table.assign
    sensible: 1, // analytics.financial.read
    administration: 1, // settings.manage
    non_classe: 1, // mystere.action
  });
  assert.equal(view.summary.sensitiveCount, 1);
  assert.equal(view.summary.distinctActors, 3); // jeremy, lea, patron
  // e2 réversible non annulé ; e4 réversible MAIS déjà annulé → compté dans reverted, pas reversible
  assert.equal(view.summary.reversibleCount, 1);
  assert.equal(view.summary.revertedCount, 1);
});

test("byAction : trié par nombre décroissant puis libellé", () => {
  const events = [
    ev({ id: "a", at: "2026-07-03T22:00:00Z", action: "entry.increment" }),
    ev({ id: "b", at: "2026-07-03T22:01:00Z", action: "entry.increment" }),
    ev({ id: "c", at: "2026-07-03T22:02:00Z", action: "entry.increment" }),
    ev({ id: "d", at: "2026-07-03T22:03:00Z", action: "table.assign" }),
    ev({ id: "e", at: "2026-07-03T22:04:00Z", action: "table.assign" }),
    ev({ id: "f", at: "2026-07-03T22:05:00Z", action: "reservation.create" }),
  ];
  const view = buildAuditJournal({ role: "admin", events });
  assert.deepEqual(
    view.summary.byAction.map((a) => [a.action, a.count]),
    [
      ["entry.increment", 3],
      ["table.assign", 2],
      ["reservation.create", 1],
    ],
  );
});

// ————————————————————————————————————————————————————————————————
// Filtres
// ————————————————————————————————————————————————————————————————
const MIXED: AuditEventRow[] = [
  ev({ id: "e1", at: "2026-07-03T22:00:00Z", action: "table.assign", actor: "jeremy", venue: "eden", reversible: true }),
  ev({ id: "e2", at: "2026-07-03T22:10:00Z", action: "analytics.financial.read", actor: "patron", venue: "eden" }),
  ev({ id: "e3", at: "2026-07-03T22:20:00Z", action: "entry.increment", actor: "lea", venue: "terminus" }),
  ev({
    id: "e4",
    at: "2026-07-03T22:30:00Z",
    action: "settings.manage",
    actor: "patron",
    venue: null,
    reversible: true,
    revertedAt: "2026-07-03T22:45:00Z",
  }),
];

test("filtre par action", () => {
  const view = buildAuditJournal({ role: "admin", events: MIXED, filter: { action: "table.assign" } });
  assert.equal(view.filtered, true);
  assert.equal(view.totalBeforeFilter, 4);
  assert.deepEqual(view.rows.map((r) => r.event.id), ["e1"]);
});

test("filtre par catégorie", () => {
  const view = buildAuditJournal({ role: "admin", events: MIXED, filter: { category: "sensible" } });
  assert.deepEqual(view.rows.map((r) => r.event.id), ["e2"]);
});

test("filtre par acteur", () => {
  const view = buildAuditJournal({ role: "admin", events: MIXED, filter: { actor: "patron" } });
  assert.deepEqual(view.rows.map((r) => r.event.id).sort(), ["e2", "e4"]);
});

test("filtre par venue", () => {
  const view = buildAuditJournal({ role: "admin", events: MIXED, filter: { venue: "terminus" } });
  assert.deepEqual(view.rows.map((r) => r.event.id), ["e3"]);
});

test("filtre onlyReversible : exclut le non réversible ET le déjà annulé", () => {
  const view = buildAuditJournal({ role: "admin", events: MIXED, filter: { onlyReversible: true } });
  // e1 réversible non annulé ; e4 réversible mais déjà annulé → exclu
  assert.deepEqual(view.rows.map((r) => r.event.id), ["e1"]);
});

test("filtre onlyReverted : ne garde que les annulés", () => {
  const view = buildAuditJournal({ role: "admin", events: MIXED, filter: { onlyReverted: true } });
  assert.deepEqual(view.rows.map((r) => r.event.id), ["e4"]);
});

test("filtre vide n'est pas 'filtered'", () => {
  const view = buildAuditJournal({ role: "admin", events: MIXED, filter: {} });
  assert.equal(view.filtered, false);
  assert.equal(view.rows.length, 4);
});

// ————————————————————————————————————————————————————————————————
// Overlay d'annulation d'UI (miroir, non persisté)
// ————————————————————————————————————————————————————————————————
test("overlay reverted prime sur l'événement (annulation d'UI en cours)", () => {
  const events = [ev({ id: "e1", at: "2026-07-03T22:00:00Z", action: "settings.manage", reversible: true })];
  const view = buildAuditJournal({
    role: "admin",
    events,
    reverted: { e1: "2026-07-03T23:00:00Z" },
  });
  assert.equal(view.rows[0].reverted, true);
  assert.equal(view.rows[0].revertedAt, "2026-07-03T23:00:00Z");
  assert.equal(view.summary.revertedCount, 1);
  assert.equal(view.summary.reversibleCount, 0);
});

test("markReverted est immuable et n'invente aucune horloge (at fourni)", () => {
  const before: Record<string, string> = {};
  const after = markReverted(before, "e1", "2026-07-03T23:00:00Z");
  assert.deepEqual(before, {}); // entrée intacte
  assert.deepEqual(after, { e1: "2026-07-03T23:00:00Z" });
  // re-marquer écrase
  const again = markReverted(after, "e1", "2026-07-03T23:30:00Z");
  assert.equal(again.e1, "2026-07-03T23:30:00Z");
});
