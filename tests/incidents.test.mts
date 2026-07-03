import assert from "node:assert/strict";
import test from "node:test";

import {
  INCIDENT_LEVELS,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  canAccessIncidents,
  canManageIncidents,
  canReportIncident,
  canTransition,
  canViewAllIncidents,
  canViewIncident,
  incidentLevelLabel,
  incidentStatusLabel,
  incidentTypeLabel,
  isActiveStatus,
  isIncidentLevel,
  isIncidentStatus,
  isIncidentType,
  nextStatuses,
  sortByPriority,
  summarizeIncidents,
  validateIncidentDraft,
  visibleIncidents,
  type Incident,
  type IncidentDraft,
} from "../lib/incidents.ts";
import type { StaffRole } from "../lib/permissions.ts";

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: over.id ?? "i1",
    event_id: over.event_id ?? null,
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    type: over.type ?? "altercation",
    niveau: over.niveau ?? "moyen",
    lieu: over.lieu ?? null,
    personne_concernee: over.personne_concernee ?? null,
    description: over.description ?? "desc",
    photo_refs: over.photo_refs ?? [],
    status: over.status ?? "ouvert",
    escalade: over.escalade ?? false,
    auteur_username: over.auteur_username ?? "server",
    resolved_at: over.resolved_at ?? null,
    created_at: over.created_at ?? "2026-07-03T22:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-03T22:00:00.000Z",
  };
}

function draft(over: Partial<IncidentDraft> = {}): IncidentDraft {
  return {
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    type: over.type ?? "vol",
    niveau: over.niveau ?? "grave",
    description: over.description ?? "vol constaté au vestiaire",
    lieu: over.lieu,
    personne_concernee: over.personne_concernee,
    event_id: over.event_id,
  };
}

const ALL_ROLES: StaffRole[] = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
  "promoter",
];

// ————————————————————————————————— Gardes de type —————————————————————————————————

test("gardes de type : vocabulaires fermés", () => {
  assert.ok(isIncidentType("refus_entree"));
  assert.ok(!isIncidentType("inconnu"));
  assert.ok(isIncidentLevel("critique"));
  assert.ok(!isIncidentLevel("apocalyptique"));
  assert.ok(isIncidentStatus("escalade"));
  assert.ok(!isIncidentStatus("zombie"));
  // Cohérence des enums exportés
  assert.equal(INCIDENT_TYPES.length, 8);
  assert.equal(INCIDENT_LEVELS.length, 4);
  assert.equal(INCIDENT_STATUSES.length, 5);
});

// ————————————————————————————————— Matrice de rôles A6 —————————————————————————————————

test("canReportIncident : tous signalent SAUF promoteur", () => {
  const expected: Record<StaffRole, boolean> = {
    admin: true,
    manager: true,
    server: true,
    security: true,
    security_counter: true,
    promoter: false,
  };
  for (const role of ALL_ROLES) {
    assert.equal(canReportIncident(role), expected[role], `report ${role}`);
  }
});

test("canManageIncidents / canViewAllIncidents : direction + sécurité uniquement", () => {
  const expected: Record<StaffRole, boolean> = {
    admin: true,
    manager: true,
    security: true,
    server: false,
    security_counter: false,
    promoter: false,
  };
  for (const role of ALL_ROLES) {
    assert.equal(canManageIncidents(role), expected[role], `manage ${role}`);
    assert.equal(canViewAllIncidents(role), expected[role], `viewAll ${role}`);
  }
});

test("canAccessIncidents : tout le monde sauf promoteur (⛔)", () => {
  for (const role of ALL_ROLES) {
    assert.equal(canAccessIncidents(role), role !== "promoter", `access ${role}`);
  }
});

test("canViewIncident : server ne voit QUE ses propres signalements", () => {
  const mine = incident({ auteur_username: "server" });
  const other = incident({ auteur_username: "security" });
  // server : le sien oui, celui d'un autre non
  assert.ok(canViewIncident("server", mine, "server"));
  assert.ok(!canViewIncident("server", other, "server"));
  // security : voit tout
  assert.ok(canViewIncident("security", mine, "security"));
  assert.ok(canViewIncident("security", other, "security"));
  // compteur : que le sien
  assert.ok(!canViewIncident("security_counter", mine, "counter"));
  assert.ok(canViewIncident("security_counter", incident({ auteur_username: "counter" }), "counter"));
});

test("visibleIncidents : filtre au périmètre du rôle, liste vide → liste vide", () => {
  const list = [
    incident({ id: "a", auteur_username: "server" }),
    incident({ id: "b", auteur_username: "counter" }),
    incident({ id: "c", auteur_username: "security" }),
  ];
  assert.deepEqual(
    visibleIncidents(list, "server", "server").map((i) => i.id),
    ["a"],
  );
  assert.equal(visibleIncidents(list, "manager", "mgr").length, 3);
  assert.deepEqual(visibleIncidents([], "admin", "adm"), []);
});

// ————————————————————————————————— Validation —————————————————————————————————

test("validateIncidentDraft : brouillon valide", () => {
  const r = validateIncidentDraft(draft());
  assert.ok(r.ok);
  assert.deepEqual(r.errors, []);
});

test("validateIncidentDraft : rejette date/type/niveau/description invalides", () => {
  const r = validateIncidentDraft(
    draft({ exploitation_date: "03-07-2026", type: "xxx", niveau: "yyy", description: "   " }),
  );
  assert.ok(!r.ok);
  assert.equal(r.errors.length, 4);
});

test("validateIncidentDraft : description composée d'espaces refusée", () => {
  const r = validateIncidentDraft(draft({ description: "\n\t  " }));
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes("description")));
});

// ————————————————————————————————— Workflow de statut —————————————————————————————————

test("transitions : ouvert → * autorisé, clos terminal", () => {
  assert.ok(canTransition("ouvert", "en_cours"));
  assert.ok(canTransition("ouvert", "escalade"));
  assert.ok(canTransition("resolu", "en_cours")); // réouverture
  assert.ok(!canTransition("clos", "ouvert")); // terminal
  assert.deepEqual(nextStatuses("clos"), []);
  assert.ok(nextStatuses("ouvert").includes("resolu"));
});

test("isActiveStatus : actif tant que non résolu/clos", () => {
  assert.ok(isActiveStatus("ouvert"));
  assert.ok(isActiveStatus("en_cours"));
  assert.ok(isActiveStatus("escalade"));
  assert.ok(!isActiveStatus("resolu"));
  assert.ok(!isActiveStatus("clos"));
});

// ————————————————————————————————— Tri de priorité —————————————————————————————————

test("sortByPriority : actifs d'abord, puis gravité décroissante, puis récent", () => {
  const list = [
    incident({ id: "clos-critique", status: "clos", niveau: "critique" }),
    incident({ id: "ouvert-mineur", status: "ouvert", niveau: "mineur", created_at: "2026-07-03T20:00:00.000Z" }),
    incident({ id: "ouvert-grave", status: "ouvert", niveau: "grave" }),
    incident({ id: "ouvert-mineur-recent", status: "ouvert", niveau: "mineur", created_at: "2026-07-03T23:00:00.000Z" }),
  ];
  const ordered = sortByPriority(list).map((i) => i.id);
  // grave avant les mineurs ; parmi les mineurs actifs, le plus récent d'abord ; le clos en dernier
  assert.deepEqual(ordered, [
    "ouvert-grave",
    "ouvert-mineur-recent",
    "ouvert-mineur",
    "clos-critique",
  ]);
});

test("sortByPriority : ne mute pas la liste d'entrée", () => {
  const list = [incident({ id: "a" }), incident({ id: "b", niveau: "critique" })];
  const copy = [...list];
  sortByPriority(list);
  assert.deepEqual(list.map((i) => i.id), copy.map((i) => i.id));
});

// ————————————————————————————————— Agrégat rapport post-soirée —————————————————————————————————

test("summarizeIncidents : liste vide → zéros honnêtes (jamais de donnée fabriquée)", () => {
  const s = summarizeIncidents([]);
  assert.equal(s.total, 0);
  assert.equal(s.actifs, 0);
  assert.equal(s.escalades, 0);
  assert.equal(s.resolus, 0);
  assert.equal(s.parNiveau.critique, 0);
  assert.equal(s.parType.vol, 0);
  assert.equal(s.parStatus.ouvert, 0);
});

test("summarizeIncidents : compte actifs / escalades / résolus", () => {
  const s = summarizeIncidents([
    incident({ status: "ouvert", niveau: "grave", type: "altercation" }),
    incident({ status: "escalade", niveau: "critique", type: "securite", escalade: true }),
    incident({ status: "resolu", niveau: "moyen", type: "vol" }),
    incident({ status: "clos", niveau: "mineur", type: "technique" }),
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.actifs, 2); // ouvert + escalade
  assert.equal(s.resolus, 2); // resolu + clos
  assert.equal(s.escalades, 1);
  assert.equal(s.parNiveau.critique, 1);
  assert.equal(s.parNiveau.grave, 1);
  assert.equal(s.parType.vol, 1);
  assert.equal(s.parStatus.escalade, 1);
});

// ————————————————————————————————— Libellés —————————————————————————————————

test("libellés FR déterministes", () => {
  assert.equal(incidentTypeLabel("refus_entree"), "Refus d'entrée");
  assert.equal(incidentLevelLabel("critique"), "Critique");
  assert.equal(incidentStatusLabel("escalade"), "Escaladé");
});
