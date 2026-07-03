import assert from "node:assert/strict";
import test from "node:test";

import {
  COCKPIT_LEVELS,
  COCKPIT_SEVERITIES,
  MODE_SOIREE_ROLES,
  buildCockpit,
  canViewModeSoiree,
  levelLabel,
  severityLabel,
  sourceLabel,
  type CockpitInput,
} from "../lib/modeSoiree.ts";
import type { StaffRole } from "../lib/permissions.ts";
import type { Incident } from "../lib/incidents.ts";
import type { InternalMessage } from "../lib/internalComms.ts";
import type { ArtistCheckin } from "../lib/artistCheckin.ts";
import type { ChecklistLine, ChecklistItem } from "../lib/checklists.ts";

const ALL_ROLES: StaffRole[] = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
  "promoter",
];

// ————————————————————————————————————————————————————————————————
// Factories (aucune donnée inventée : ce sont des fixtures de test explicites)
// ————————————————————————————————————————————————————————————————

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: over.id ?? "inc1",
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
    auteur_username: over.auteur_username ?? "manuel",
    resolved_at: over.resolved_at ?? null,
    created_at: over.created_at ?? "2026-07-03T21:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-03T21:00:00.000Z",
  };
}

function message(over: Partial<InternalMessage> = {}): InternalMessage {
  return {
    id: over.id ?? "m1",
    event_id: over.event_id ?? null,
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    kind: over.kind ?? "message",
    body: over.body ?? "corps",
    target_role: over.target_role ?? null,
    assignee_username: over.assignee_username ?? null,
    auteur_username: over.auteur_username ?? "manuel",
    resolved_at: over.resolved_at ?? null,
    created_at: over.created_at ?? "2026-07-03T21:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-03T21:00:00.000Z",
  };
}

function checkin(over: Partial<ArtistCheckin> = {}): ArtistCheckin {
  return {
    id: over.id ?? "a1",
    event_id: over.event_id ?? null,
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    artist_name: over.artist_name ?? "DJ Test",
    slot_label: over.slot_label ?? null,
    status: over.status ?? "attendu",
    companions: over.companions ?? 0,
    dressing_room: over.dressing_room ?? null,
    contact: over.contact ?? null,
    rider_notes: over.rider_notes ?? null,
    material_notes: over.material_notes ?? null,
    arrived_at: over.arrived_at ?? null,
    soundcheck_at: over.soundcheck_at ?? null,
    tech_validated_at: over.tech_validated_at ?? null,
    tech_validated_by: over.tech_validated_by ?? null,
    notes: over.notes ?? null,
    auteur_username: over.auteur_username ?? "manuel",
    created_at: over.created_at ?? "2026-07-03T20:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-03T20:00:00.000Z",
  };
}

function checklistItem(over: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: over.id ?? "i1",
    venue: over.venue ?? null,
    phase: over.phase ?? "ouverture",
    category: over.category ?? "secu",
    poste: over.poste ?? null,
    label: over.label ?? "Vérifier extincteurs",
    position: over.position ?? 0,
    active: over.active ?? true,
    auteur_username: over.auteur_username ?? "manuel",
    created_at: over.created_at ?? "2026-07-03T18:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-03T18:00:00.000Z",
  };
}

function line(over: { item?: Partial<ChecklistItem>; done?: boolean } = {}): ChecklistLine {
  return {
    item: checklistItem(over.item),
    done: over.done ?? false,
    doneBy: over.done ? "manuel" : null,
    doneAt: over.done ? "2026-07-03T18:30:00.000Z" : null,
    note: null,
  };
}

function input(over: Partial<CockpitInput> = {}): CockpitInput {
  return {
    role: over.role ?? "admin",
    username: over.username ?? "patron",
    incidents: over.incidents,
    messages: over.messages,
    reads: over.reads,
    checkins: over.checkins,
    checklistLines: over.checklistLines,
  };
}

// ————————————————————————————————————————————————————————————————
// Vocabulaires fermés
// ————————————————————————————————————————————————————————————————

test("vocabulaires fermés : sévérités, niveaux, rôles (promoteur exclu)", () => {
  assert.deepEqual([...COCKPIT_SEVERITIES], ["info", "attention", "critique"]);
  assert.deepEqual([...COCKPIT_LEVELS], ["calme", "vigilance", "tension"]);
  assert.ok(!(MODE_SOIREE_ROLES as readonly string[]).includes("promoter"));
  assert.equal(MODE_SOIREE_ROLES.length, 5);
});

// ————————————————————————————————————————————————————————————————
// Garde de rôle du cockpit
// ————————————————————————————————————————————————————————————————

test("canViewModeSoiree : tous sauf promoteur", () => {
  for (const role of ALL_ROLES) {
    assert.equal(canViewModeSoiree(role), role !== "promoter");
  }
});

test("promoteur : cockpit fermé, tout vide, niveau calme, aucune tâche", () => {
  const c = buildCockpit(
    input({
      role: "promoter",
      incidents: [incident({ escalade: true, status: "escalade" })],
      messages: [message({ kind: "urgence" })],
    }),
  );
  assert.equal(c.accessible, false);
  assert.equal(c.panels.incidents, null);
  assert.equal(c.panels.comms, null);
  assert.equal(c.panels.artists, null);
  assert.equal(c.panels.checklist, null);
  assert.deepEqual(c.alerts, []);
  assert.equal(c.level, "calme");
  assert.equal(c.tachesOuvertes, 0);
  assert.equal(c.isEmpty, true);
});

// ————————————————————————————————————————————————————————————————
// Cadrage des panneaux par rôle (miroir des gardes de chaque module)
// ————————————————————————————————————————————————————————————————

test("admin : les quatre panneaux présents (accès complet)", () => {
  const c = buildCockpit(input({ role: "admin" }));
  assert.ok(c.accessible);
  assert.ok(c.panels.incidents);
  assert.ok(c.panels.comms);
  assert.ok(c.panels.artists);
  assert.ok(c.panels.checklist);
});

test("serveur : pas de panneau artiste (A8 = admin/manager/sécurité), reste présent", () => {
  const c = buildCockpit(input({ role: "server" }));
  assert.ok(c.panels.incidents); // canAccessIncidents inclut server (signaler)
  assert.ok(c.panels.comms); // COMM_ROLES inclut server
  assert.equal(c.panels.artists, null); // server ⛔ artiste
  assert.ok(c.panels.checklist); // CHECKLIST_ROLES inclut server
});

test("compteur : pas de panneau artiste ; incidents/comm/checklist présents", () => {
  const c = buildCockpit(input({ role: "security_counter" }));
  assert.ok(c.panels.incidents);
  assert.ok(c.panels.comms);
  assert.equal(c.panels.artists, null);
  assert.ok(c.panels.checklist);
});

test("sécurité : panneau artiste présent (👁)", () => {
  const c = buildCockpit(input({ role: "security" }));
  assert.ok(c.panels.artists);
  assert.ok(c.panels.incidents);
});

// ————————————————————————————————————————————————————————————————
// États vides HONNÊTES
// ————————————————————————————————————————————————————————————————

test("admin sans aucune donnée : panneaux à zéro, aucune alerte, calme, isEmpty", () => {
  const c = buildCockpit(input({ role: "admin" }));
  assert.equal(c.panels.incidents?.total, 0);
  assert.equal(c.panels.comms?.total, 0);
  assert.equal(c.panels.artists?.total, 0);
  assert.equal(c.panels.checklist?.summary.total, 0);
  assert.deepEqual(c.alerts, []);
  assert.equal(c.level, "calme");
  assert.equal(c.tachesOuvertes, 0);
  assert.equal(c.isEmpty, true);
});

// ————————————————————————————————————————————————————————————————
// Dérivation des alertes
// ————————————————————————————————————————————————————————————————

test("incident escaladé → alerte critique + niveau tension", () => {
  const c = buildCockpit(
    input({ incidents: [incident({ status: "escalade", escalade: true, niveau: "grave" })] }),
  );
  const escal = c.alerts.find((a) => a.code === "incident_escalade");
  assert.ok(escal);
  assert.equal(escal.severity, "critique");
  assert.equal(escal.count, 1);
  assert.equal(c.level, "tension");
});

test("incident grave actif (non escaladé) → critique via incident_grave_actif", () => {
  const c = buildCockpit(input({ incidents: [incident({ status: "en_cours", niveau: "critique" })] }));
  const grave = c.alerts.find((a) => a.code === "incident_grave_actif");
  assert.ok(grave);
  assert.equal(grave.severity, "critique");
  assert.equal(c.alerts.find((a) => a.code === "incident_escalade"), undefined);
});

test("incident moyen actif → attention (incident_actif), pas de double comptage avec les graves", () => {
  const c = buildCockpit(
    input({
      incidents: [
        incident({ id: "x1", status: "ouvert", niveau: "moyen" }),
        incident({ id: "x2", status: "en_cours", niveau: "grave" }),
      ],
    }),
  );
  const actif = c.alerts.find((a) => a.code === "incident_actif");
  const grave = c.alerts.find((a) => a.code === "incident_grave_actif");
  assert.ok(actif);
  assert.equal(actif.count, 1); // seulement le moyen, le grave est compté à part
  assert.ok(grave);
  assert.equal(grave.count, 1);
});

test("incident résolu grave → aucune alerte (isActiveStatus false)", () => {
  const c = buildCockpit(
    input({ incidents: [incident({ status: "clos", niveau: "critique", resolved_at: "2026-07-03T22:00:00.000Z" })] }),
  );
  assert.equal(c.alerts.length, 0);
  assert.equal(c.level, "calme");
  assert.equal(c.panels.incidents?.total, 1);
  assert.equal(c.panels.incidents?.actifs, 0);
});

test("comm : urgence ouverte → critique ; tâche ouverte → attention", () => {
  const c = buildCockpit(
    input({
      messages: [
        message({ id: "u1", kind: "urgence", auteur_username: "manuel" }),
        message({ id: "t1", kind: "tache", auteur_username: "manuel" }),
      ],
      // patron a lu les deux → pas d'alerte non-lu parasite
      reads: [
        { id: "r1", message_id: "u1", reader_username: "patron", created_at: "2026-07-03T21:05:00.000Z" },
        { id: "r2", message_id: "t1", reader_username: "patron", created_at: "2026-07-03T21:05:00.000Z" },
      ],
    }),
  );
  assert.equal(c.alerts.find((a) => a.code === "comm_urgence")?.severity, "critique");
  assert.equal(c.alerts.find((a) => a.code === "comm_tache")?.severity, "attention");
  assert.equal(c.alerts.find((a) => a.code === "comm_nonlu"), undefined);
  assert.equal(c.level, "tension");
});

test("comm : message non lu par l'utilisateur courant → info", () => {
  const c = buildCockpit(input({ messages: [message({ id: "m9", kind: "message", auteur_username: "manuel" })] }));
  const nonlu = c.alerts.find((a) => a.code === "comm_nonlu");
  assert.ok(nonlu);
  assert.equal(nonlu.severity, "info");
  assert.equal(nonlu.count, 1);
  assert.equal(c.level, "calme"); // info seul (aucune attention/critique) → calme
});

test("info seule (message non lu) → niveau calme (info ne déclenche pas vigilance)", () => {
  const c = buildCockpit(input({ messages: [message({ id: "m9", auteur_username: "manuel" })] }));
  // un seul message non lu = info → pas d'attention ni de critique
  assert.ok(c.alerts.every((a) => a.severity === "info"));
  assert.equal(c.level, "calme");
});

test("artiste no-show → attention ; artiste attendu → info", () => {
  const c = buildCockpit(
    input({
      role: "security",
      checkins: [checkin({ id: "n1", status: "no_show" }), checkin({ id: "n2", status: "attendu" })],
    }),
  );
  assert.equal(c.alerts.find((a) => a.code === "artiste_noshow")?.severity, "attention");
  assert.equal(c.alerts.find((a) => a.code === "artiste_attendu")?.severity, "info");
  assert.equal(c.level, "vigilance");
});

test("checklist : fermeture incomplète → attention ; ouverture incomplète → info", () => {
  const c = buildCockpit(
    input({
      checklistLines: [
        line({ item: { id: "f1", phase: "fermeture" }, done: false }),
        line({ item: { id: "o1", phase: "ouverture" }, done: false }),
      ],
    }),
  );
  assert.equal(c.alerts.find((a) => a.code === "checklist_fermeture")?.severity, "attention");
  assert.equal(c.alerts.find((a) => a.code === "checklist_ouverture")?.severity, "info");
});

test("checklist entièrement cochée → aucune alerte checklist", () => {
  const c = buildCockpit(
    input({ checklistLines: [line({ item: { id: "f1", phase: "fermeture" }, done: true })] }),
  );
  assert.equal(c.alerts.find((a) => a.source === "checklist"), undefined);
  assert.equal(c.panels.checklist?.summary.complete, true);
});

// ————————————————————————————————————————————————————————————————
// Tri des alertes & niveau global
// ————————————————————————————————————————————————————————————————

test("tri : critique avant attention avant info", () => {
  const c = buildCockpit(
    input({
      role: "security",
      incidents: [incident({ status: "escalade", escalade: true })], // critique
      checkins: [checkin({ id: "n1", status: "no_show" })], // attention
      messages: [message({ id: "m9", auteur_username: "manuel" })], // info non-lu
    }),
  );
  const sev = c.alerts.map((a) => a.severity);
  const rank = { info: 1, attention: 2, critique: 3 } as const;
  for (let i = 1; i < sev.length; i++) {
    assert.ok(rank[sev[i - 1]] >= rank[sev[i]], "sévérité décroissante");
  }
  assert.equal(c.level, "tension");
});

test("niveau vigilance quand seulement des alertes attention", () => {
  const c = buildCockpit(input({ incidents: [incident({ status: "ouvert", niveau: "moyen" })] }));
  assert.ok(c.alerts.every((a) => a.severity === "attention"));
  assert.equal(c.level, "vigilance");
});

// ————————————————————————————————————————————————————————————————
// Tâches immédiates (agrégat)
// ————————————————————————————————————————————————————————————————

test("tachesOuvertes = urgences + tâches comm + incidents actifs + checklist restante", () => {
  const c = buildCockpit(
    input({
      incidents: [incident({ id: "i1", status: "en_cours", niveau: "moyen" })], // 1 actif
      messages: [
        message({ id: "u1", kind: "urgence", auteur_username: "manuel" }), // 1 urgence
        message({ id: "t1", kind: "tache", auteur_username: "manuel" }), // 1 tâche
      ],
      checklistLines: [
        line({ item: { id: "c1" }, done: false }),
        line({ item: { id: "c2" }, done: true }),
      ], // 1 restante
    }),
  );
  assert.equal(c.tachesOuvertes, 1 + 1 + 1 + 1);
});

// ————————————————————————————————————————————————————————————————
// Cadrage de visibilité (défense en profondeur : le serveur ne voit que ses incidents)
// ————————————————————————————————————————————————————————————————

test("serveur : incidents cadrés à ses propres signalements", () => {
  const c = buildCockpit(
    input({
      role: "server",
      username: "jeremy",
      incidents: [
        incident({ id: "mine", auteur_username: "jeremy", status: "ouvert", niveau: "moyen" }),
        incident({ id: "other", auteur_username: "manuel", status: "escalade", escalade: true }),
      ],
    }),
  );
  // ne compte que le sien ; l'incident escaladé d'autrui est invisible → pas d'alerte critique
  assert.equal(c.panels.incidents?.total, 1);
  assert.equal(c.alerts.find((a) => a.code === "incident_escalade"), undefined);
  assert.ok(c.alerts.find((a) => a.code === "incident_actif"));
});

// ————————————————————————————————————————————————————————————————
// Libellés déterministes
// ————————————————————————————————————————————————————————————————

test("libellés FR déterministes", () => {
  assert.equal(severityLabel("critique"), "Critique");
  assert.equal(levelLabel("tension"), "Tension");
  assert.equal(sourceLabel("incident"), "Incidents");
  assert.equal(sourceLabel("checklist"), "Checklists");
});

test("pluriel des libellés d'alerte (1 → singulier, 2 → pluriel)", () => {
  const un = buildCockpit(input({ incidents: [incident({ id: "a", status: "escalade", escalade: true })] }));
  assert.ok(un.alerts.find((a) => a.label === "1 incident escaladé"));
  const deux = buildCockpit(
    input({
      incidents: [
        incident({ id: "a", status: "escalade", escalade: true }),
        incident({ id: "b", status: "escalade", escalade: true }),
      ],
    }),
  );
  assert.ok(deux.alerts.find((a) => a.label === "2 incidents escaladés"));
});
