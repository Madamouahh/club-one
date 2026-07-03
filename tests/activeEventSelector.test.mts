import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVATABLE_STATUSES,
  buildActiveEventSelector,
  canManageActiveEvent,
  canViewActiveEvent,
  candidateStatusLabel,
  classifyCandidate,
  isActivatableStatus,
  lifecycleActionLabel,
  lifecycleReasonMessage,
  resolveSelectorLifecycle,
} from "../lib/activeEventSelector.ts";
import type {
  ActiveEventCandidate,
  ActiveEventRuntimeContext,
} from "../lib/activeEvent.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Fabriques déterministes (aucune horloge : id / dates fournis)
// ————————————————————————————————————————————————————————————————
function cand(over: Partial<ActiveEventCandidate> & { id: string }): ActiveEventCandidate {
  return {
    id: over.id,
    title: over.title ?? `Soirée ${over.id}`,
    eventDate: over.eventDate ?? "2026-07-10",
    status: over.status ?? "published",
    venueId: "venueId" in over ? over.venueId ?? null : "v-eden",
    venueName: "venueName" in over ? over.venueName ?? null : "Eden",
  };
}

function runtime(over: Partial<ActiveEventRuntimeContext> = {}): ActiveEventRuntimeContext {
  return {
    activeEvent: over.activeEvent ?? null,
    bootstrapCompleted: over.bootstrapCompleted ?? false,
    bootstrapCompletedAt: over.bootstrapCompletedAt ?? null,
    lastClosedEventId: over.lastClosedEventId ?? null,
  };
}

const ACTIVE = {
  eventId: "e-live",
  eventDate: "2026-07-04",
  title: "Soirée en cours",
  status: "active" as const,
};

// ————————————————————————————————————————————————————————————————
// Statuts activables
// ————————————————————————————————————————————————————————————————
test("ACTIVATABLE_STATUSES = draft + published (miroir domaine §50)", () => {
  assert.deepEqual([...ACTIVATABLE_STATUSES], ["draft", "published"]);
});

test("isActivatableStatus refuse archived et tout statut inconnu", () => {
  assert.equal(isActivatableStatus("draft"), true);
  assert.equal(isActivatableStatus("published"), true);
  assert.equal(isActivatableStatus("archived"), false);
  assert.equal(isActivatableStatus("active"), false);
  assert.equal(isActivatableStatus("cancelled"), false);
  assert.equal(isActivatableStatus(""), false);
  assert.equal(isActivatableStatus(null), false);
  assert.equal(isActivatableStatus(42), false);
});

test("candidateStatusLabel : FR pour activables, clé brute conservée sinon", () => {
  assert.equal(candidateStatusLabel("draft"), "Brouillon");
  assert.equal(candidateStatusLabel("published"), "Publiée");
  assert.equal(candidateStatusLabel("archived"), "archived");
  assert.equal(candidateStatusLabel("weird_status"), "weird_status");
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle
// ————————————————————————————————————————————————————————————————
test("canViewActiveEvent : tous les rôles staff, jamais null/inconnu", () => {
  for (const r of STAFF_ROLES) assert.equal(canViewActiveEvent(r), true);
  assert.equal(canViewActiveEvent(null), false);
  assert.equal(canViewActiveEvent(undefined), false);
  assert.equal(canViewActiveEvent("root" as StaffRole), false);
});

test("canManageActiveEvent : direction seule (admin/manager)", () => {
  assert.equal(canManageActiveEvent("admin"), true);
  assert.equal(canManageActiveEvent("manager"), true);
  for (const r of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canManageActiveEvent(r), false);
  }
  assert.equal(canManageActiveEvent(null), false);
});

// ————————————————————————————————————————————————————————————————
// Cycle de vie — décision serveur, jamais devinée
// ————————————————————————————————————————————————————————————————
test("lifecycle : rôle non-direction → none / not_authorized", () => {
  const lc = resolveSelectorLifecycle({ role: "server", runtime: runtime({ bootstrapCompleted: true }) });
  assert.equal(lc.action, "none");
  assert.equal(lc.reason, "not_authorized");
  assert.equal(lc.canManage, false);
  assert.equal(lc.requiresCandidate, false);
});

test("lifecycle : direction + jamais amorcé → bootstrap", () => {
  const lc = resolveSelectorLifecycle({ role: "admin", runtime: runtime({ bootstrapCompleted: false }) });
  assert.equal(lc.action, "bootstrap");
  assert.equal(lc.reason, "bootstrap");
  assert.equal(lc.requiresCandidate, true);
});

test("lifecycle : direction + amorcé + aucun actif → activate", () => {
  const lc = resolveSelectorLifecycle({ role: "manager", runtime: runtime({ bootstrapCompleted: true }) });
  assert.equal(lc.action, "activate");
  assert.equal(lc.reason, "activate");
  assert.equal(lc.requiresCandidate, true);
});

test("lifecycle : un événement DÉJÀ actif → none / already_active (clôturer d'abord)", () => {
  // Même bootstrapCompleted=true : on NE propose PAS d'activer par-dessus une soirée en cours.
  const lc = resolveSelectorLifecycle({
    role: "admin",
    runtime: runtime({ bootstrapCompleted: true, activeEvent: ACTIVE }),
  });
  assert.equal(lc.action, "none");
  assert.equal(lc.reason, "already_active");
  assert.equal(lc.canManage, true);
  assert.equal(lc.requiresCandidate, false);
});

// ————————————————————————————————————————————————————————————————
// classifyCandidate
// ————————————————————————————————————————————————————————————————
test("classifyCandidate : venue jointe → clé/label, activable selon statut", () => {
  const c = classifyCandidate(cand({ id: "1", venueName: "  Terminus ", status: "draft" }));
  assert.equal(c.venueKey, "Terminus");
  assert.equal(c.venueLabel, "Terminus");
  assert.equal(c.activatable, true);
});

test("classifyCandidate : venue absente → groupe « non renseigné » explicite (jamais inventé)", () => {
  const c = classifyCandidate(cand({ id: "2", venueName: null, status: "published" }));
  assert.equal(c.venueKey, "");
  assert.equal(c.venueLabel, "Univers non renseigné");
  assert.equal(c.activatable, true);
});

test("classifyCandidate : statut archived → non activable (mais conservé)", () => {
  const c = classifyCandidate(cand({ id: "3", status: "archived" }));
  assert.equal(c.activatable, false);
  assert.equal(c.status, "archived");
});

// ————————————————————————————————————————————————————————————————
// buildActiveEventSelector — vue complète
// ————————————————————————————————————————————————————————————————
test("selector : liste vide → zéros honnêtes, aucun candidat fabriqué", () => {
  const v = buildActiveEventSelector({
    role: "admin",
    runtime: runtime({ bootstrapCompleted: true }),
    candidates: [],
  });
  assert.equal(v.canView, true);
  assert.equal(v.totalCandidates, 0);
  assert.equal(v.activatableCandidates, 0);
  assert.equal(v.groups.length, 0);
  assert.equal(v.venueFilterOptions.length, 0);
  assert.equal(v.selected, null);
  assert.equal(v.selectionValid, false);
});

test("selector : regroupe par univers, compte activables, univers non renseigné en dernier", () => {
  const v = buildActiveEventSelector({
    role: "admin",
    runtime: runtime({ bootstrapCompleted: true }),
    candidates: [
      cand({ id: "1", venueName: "Terminus", status: "published" }),
      cand({ id: "2", venueName: "Eden", status: "draft" }),
      cand({ id: "3", venueName: "Eden", status: "archived" }), // non activable
      cand({ id: "4", venueName: null, status: "published" }),
    ],
  });
  assert.equal(v.totalCandidates, 4);
  assert.equal(v.activatableCandidates, 3); // 1,2,4 (le 3 archived exclu)
  // Ordre : Eden, Terminus (alpha FR), puis « non renseigné » en dernier.
  assert.deepEqual(v.groups.map((g) => g.venueLabel), ["Eden", "Terminus", "Univers non renseigné"]);
  const eden = v.groups.find((g) => g.venueKey === "Eden")!;
  assert.equal(eden.candidates.length, 2);
  assert.equal(eden.activatableCount, 1); // seul le draft, pas l'archived
});

test("selector : tri intra-groupe par date croissante puis id", () => {
  const v = buildActiveEventSelector({
    role: "admin",
    runtime: runtime({ bootstrapCompleted: true }),
    candidates: [
      cand({ id: "b", venueName: "Eden", eventDate: "2026-07-20" }),
      cand({ id: "a", venueName: "Eden", eventDate: "2026-07-10" }),
      cand({ id: "c", venueName: "Eden", eventDate: "2026-07-10" }),
    ],
  });
  const eden = v.groups[0];
  assert.deepEqual(eden.candidates.map((c) => c.id), ["a", "c", "b"]);
});

test("selector : filtre univers ne garde que le bucket demandé (les options restent globales)", () => {
  const v = buildActiveEventSelector({
    role: "admin",
    runtime: runtime({ bootstrapCompleted: true }),
    candidates: [
      cand({ id: "1", venueName: "Eden" }),
      cand({ id: "2", venueName: "Terminus" }),
    ],
    venueFilter: "Eden",
  });
  assert.equal(v.filteredByVenue, true);
  assert.equal(v.shownCandidates, 1);
  assert.deepEqual(v.groups.map((g) => g.venueLabel), ["Eden"]);
  // les options d'univers reflètent TOUT (avant filtre), pour pouvoir changer de filtre.
  assert.deepEqual(v.venueFilterOptions.map((o) => o.label), ["Eden", "Terminus"]);
  assert.equal(v.totalCandidates, 2);
});

test("selector : sélection valide seulement si action attend un candidat ET candidat activable", () => {
  const base = {
    runtime: runtime({ bootstrapCompleted: true }),
    candidates: [
      cand({ id: "ok", status: "published" }),
      cand({ id: "arch", status: "archived" }),
    ],
  };
  // direction, activate attendu, candidat activable → valide
  const good = buildActiveEventSelector({ role: "admin", ...base, selectedId: "ok" });
  assert.equal(good.lifecycle.action, "activate");
  assert.equal(good.selected?.id, "ok");
  assert.equal(good.selectionValid, true);

  // candidat archived → sélection résolue mais NON valide (non activable)
  const arch = buildActiveEventSelector({ role: "admin", ...base, selectedId: "arch" });
  assert.equal(arch.selected?.id, "arch");
  assert.equal(arch.selectionValid, false);

  // rôle non-direction : aucune action → même un candidat activable n'est pas actionnable
  const viewer = buildActiveEventSelector({ role: "server", ...base, selectedId: "ok" });
  assert.equal(viewer.lifecycle.requiresCandidate, false);
  assert.equal(viewer.selectionValid, false);
});

test("selector : sélection résolue parmi TOUS les candidats, pas seulement l'univers filtré", () => {
  const v = buildActiveEventSelector({
    role: "admin",
    runtime: runtime({ bootstrapCompleted: true }),
    candidates: [
      cand({ id: "eden1", venueName: "Eden", status: "published" }),
      cand({ id: "term1", venueName: "Terminus", status: "published" }),
    ],
    venueFilter: "Eden",
    selectedId: "term1", // hors du filtre courant
  });
  assert.equal(v.selected?.id, "term1");
  assert.equal(v.selectionValid, true);
});

test("selector : reporte l'événement actif et le dernier clôturé sans les fabriquer", () => {
  const v = buildActiveEventSelector({
    role: "manager",
    runtime: runtime({
      bootstrapCompleted: true,
      activeEvent: ACTIVE,
      bootstrapCompletedAt: "2026-06-01T00:00:00Z",
      lastClosedEventId: "e-prev",
    }),
    candidates: [cand({ id: "1" })],
  });
  assert.equal(v.activeEvent?.eventId, "e-live");
  assert.equal(v.bootstrapCompletedAt, "2026-06-01T00:00:00Z");
  assert.equal(v.lastClosedEventId, "e-prev");
  assert.equal(v.lifecycle.reason, "already_active"); // actif → pas d'activation proposée
});

test("selector : rôle non-staff → canView false", () => {
  const v = buildActiveEventSelector({
    role: null,
    runtime: runtime({ bootstrapCompleted: true }),
    candidates: [cand({ id: "1" })],
  });
  assert.equal(v.canView, false);
});

// ————————————————————————————————————————————————————————————————
// Libellés
// ————————————————————————————————————————————————————————————————
test("lifecycleActionLabel & lifecycleReasonMessage couvrent chaque cas", () => {
  assert.equal(lifecycleActionLabel("bootstrap"), "Amorcer la première soirée");
  assert.equal(lifecycleActionLabel("activate"), "Activer une soirée");
  assert.equal(lifecycleActionLabel("none"), "Aucune action disponible");
  assert.match(lifecycleReasonMessage("already_active"), /Clôturez/);
  assert.match(lifecycleReasonMessage("not_authorized"), /direction/);
  assert.match(lifecycleReasonMessage("bootstrap"), /amorçage/);
  assert.match(lifecycleReasonMessage("activate"), /activer/);
});

// ————————————————————————————————————————————————————————————————
// Non-mutation
// ————————————————————————————————————————————————————————————————
test("selector : n'altère pas le tableau de candidats fourni", () => {
  const input: ActiveEventCandidate[] = [
    cand({ id: "b", eventDate: "2026-07-20" }),
    cand({ id: "a", eventDate: "2026-07-10" }),
  ];
  const snapshot = input.map((c) => c.id);
  buildActiveEventSelector({
    role: "admin",
    runtime: runtime({ bootstrapCompleted: true }),
    candidates: input,
  });
  assert.deepEqual(input.map((c) => c.id), snapshot);
});
