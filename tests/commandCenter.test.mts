import assert from "node:assert/strict";
import test from "node:test";

import {
  CC_DOMAINS,
  buildCommandCenter,
  canViewCommandCenter,
  commandCenterDomainTitle,
  commandCenterSeverityLabel,
  type CommandCenterInput,
} from "../lib/commandCenter.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Garde de rôle : B1 = direction (admin + manager) uniquement
// ————————————————————————————————————————————————————————————————
test("canViewCommandCenter : direction (admin/manager) OUI ; employés/promoteur NON", () => {
  assert.equal(canViewCommandCenter("admin"), true);
  assert.equal(canViewCommandCenter("manager"), true);
  for (const role of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canViewCommandCenter(role), false, `${role} ne doit PAS voir B1`);
  }
});

test("canViewCommandCenter couvre tous les rôles connus sans exception", () => {
  for (const role of STAFF_ROLES) {
    assert.equal(typeof canViewCommandCenter(role), "boolean");
  }
});

// ————————————————————————————————————————————————————————————————
// Honnêteté de couverture : un cockpit sans aucun signal → tout « non branché »,
// jamais un faux zéro, jamais une alerte fabriquée.
// ————————————————————————————————————————————————————————————————
test("aucun signal → chaque domaine est non_connecte, overall non_connecte, 0 alerte", () => {
  const view = buildCommandCenter({ activeEvent: null });
  assert.equal(view.tiles.length, CC_DOMAINS.length);
  for (const tile of view.tiles) {
    assert.equal(tile.connected, false);
    assert.equal(tile.severity, "non_connecte");
  }
  assert.equal(view.coverage.total, CC_DOMAINS.length);
  assert.equal(view.coverage.connected, 0);
  assert.equal(view.coverage.notConnected, CC_DOMAINS.length);
  assert.equal(view.overall, "non_connecte");
  assert.equal(view.attentionCount, 0);
  assert.equal(view.critiqueCount, 0);
  assert.equal(view.event, null);
});

test("les tuiles sortent dans l'ordre canonique de CC_DOMAINS", () => {
  const view = buildCommandCenter({ activeEvent: null });
  assert.deepEqual(
    view.tiles.map((t) => t.key),
    [...CC_DOMAINS],
  );
});

// ————————————————————————————————————————————————————————————————
// Incidents : escalade/critique → critique ; actif → attention ; 0 → ok
// ————————————————————————————————————————————————————————————————
test("incidents escaladés → tuile critique", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    incidents: { actifs: 2, escalades: 1, critiquesActifs: 0 },
  });
  const t = view.tiles.find((x) => x.key === "incidents")!;
  assert.equal(t.connected, true);
  assert.equal(t.severity, "critique");
  assert.equal(view.critiqueCount, 1);
  assert.equal(view.overall, "critique");
});

test("incidents actifs sans escalade → attention", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    incidents: { actifs: 3, escalades: 0, critiquesActifs: 0 },
  });
  const t = view.tiles.find((x) => x.key === "incidents")!;
  assert.equal(t.severity, "attention");
  assert.equal(view.attentionCount, 1);
});

test("incidents à zéro → ok (branché mais rien à traiter, pas non_connecte)", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    incidents: { actifs: 0, escalades: 0, critiquesActifs: 0 },
  });
  const t = view.tiles.find((x) => x.key === "incidents")!;
  assert.equal(t.connected, true);
  assert.equal(t.severity, "ok");
});

// ————————————————————————————————————————————————————————————————
// Remplissage : complet → attention ; total 0 → vide (pas ok)
// ————————————————————————————————————————————————————————————————
test("remplissage complet → attention avec pourcentage", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    remplissage: { occupees: 44, total: 44 },
  });
  const t = view.tiles.find((x) => x.key === "remplissage")!;
  assert.equal(t.severity, "attention");
  assert.match(t.headline, /44\/44 \(100 %\)/);
});

test("remplissage sans table → vide, pas ok", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    remplissage: { occupees: 0, total: 0 },
  });
  const t = view.tiles.find((x) => x.key === "remplissage")!;
  assert.equal(t.severity, "vide");
});

// ————————————————————————————————————————————————————————————————
// Présence : sous-effectif → attention ; coût partiel signalé honnêtement
// ————————————————————————————————————————————————————————————————
test("présence sous-effectif ET coût partiel → attention + double détail honnête", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    presence: { presents: 4, attendus: 6, coutComplet: false },
  });
  const t = view.tiles.find((x) => x.key === "presence_staff")!;
  assert.equal(t.severity, "attention");
  assert.match(t.detail ?? "", /non pointé/);
  assert.match(t.detail ?? "", /coût staff partiel/);
});

test("présence complète et coût complet → ok sans détail", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    presence: { presents: 6, attendus: 6, coutComplet: true },
  });
  const t = view.tiles.find((x) => x.key === "presence_staff")!;
  assert.equal(t.severity, "ok");
  assert.equal(t.detail, null);
});

// ————————————————————————————————————————————————————————————————
// Résa / captation / checklists / CA
// ————————————————————————————————————————————————————————————————
test("résas en attente → attention ; zéro → ok", () => {
  const a = buildCommandCenter({ activeEvent: null, resa: { pending: 2 } });
  assert.equal(a.tiles.find((x) => x.key === "resa_en_attente")!.severity, "attention");
  const b = buildCommandCenter({ activeEvent: null, resa: { pending: 0 } });
  assert.equal(b.tiles.find((x) => x.key === "resa_en_attente")!.severity, "ok");
});

test("CA partiel → détail d'honnêteté « PARTIEL » ; CA nul → vide", () => {
  const partial = buildCommandCenter({
    activeEvent: null,
    ca: { montantCents: 123456, complet: false },
  });
  const t = partial.tiles.find((x) => x.key === "ca_soiree")!;
  assert.equal(t.severity, "ok");
  assert.match(t.detail ?? "", /PARTIEL/);

  const empty = buildCommandCenter({ activeEvent: null, ca: { montantCents: 0, complet: true } });
  assert.equal(empty.tiles.find((x) => x.key === "ca_soiree")!.severity, "vide");
});

// ————————————————————————————————————————————————————————————————
// Agrégat : overall = pire sévérité PARMI LES BRANCHÉS ; les non_connecte ne polluent pas
// ————————————————————————————————————————————————————————————————
test("overall ignore les domaines non branchés et prend la pire sévérité branchée", () => {
  const view = buildCommandCenter({
    activeEvent: { label: "Eden — démo", date: "2026-07-04", venue: "eden" },
    incidents: { actifs: 1, escalades: 0, critiquesActifs: 0 }, // attention
    ca: { montantCents: 500000, complet: true }, // ok
    // tout le reste : non branché
  });
  assert.equal(view.overall, "attention");
  assert.equal(view.coverage.connected, 2);
  assert.equal(view.coverage.notConnected, CC_DOMAINS.length - 2);
  assert.deepEqual(view.event, { label: "Eden — démo", date: "2026-07-04", venue: "eden" });
});

test("une critique domine une attention dans overall", () => {
  const input: CommandCenterInput = {
    activeEvent: null,
    incidents: { actifs: 2, escalades: 1, critiquesActifs: 1 }, // critique
    resa: { pending: 5 }, // attention
  };
  const view = buildCommandCenter(input);
  assert.equal(view.overall, "critique");
  assert.equal(view.critiqueCount, 1);
  assert.equal(view.attentionCount, 1);
});

test("tous branchés en OK → overall ok (pas vide, pas non_connecte)", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    incidents: { actifs: 0, escalades: 0, critiquesActifs: 0 },
    resa: { pending: 0 },
  });
  assert.equal(view.overall, "ok");
});

// ————————————————————————————————————————————————————————————————
// Libellés
// ————————————————————————————————————————————————————————————————
test("libellés de domaine et de sévérité définis et non vides", () => {
  for (const d of CC_DOMAINS) {
    assert.ok(commandCenterDomainTitle(d).length > 0);
  }
  assert.equal(commandCenterSeverityLabel("critique"), "Critique");
  assert.equal(commandCenterSeverityLabel("non_connecte"), "Non branché");
});
