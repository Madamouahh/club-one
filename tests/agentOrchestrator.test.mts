import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_CAPABILITIES,
  AUTONOMY_LEVELS,
  CAPABILITY_CEILING,
  autonomyDescription,
  autonomyLabel,
  buildOrchestratorView,
  canManageOrchestrator,
  canViewOrchestrator,
  capabilityCeiling,
  capabilityLabel,
  ceilingReason,
  clampAutonomy,
  isAgentCapability,
  isAutonomyLevel,
  postureLabel,
  resolveAgentGovernance,
  type AgentCapability,
  type AgentDescriptor,
  type AutonomyLevel,
  type OrchestratorSettings,
} from "../lib/agentOrchestrator.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Fabriques déterministes
// ————————————————————————————————————————————————————————————————
function agent(over: Partial<AgentDescriptor> & { id: string }): AgentDescriptor {
  return {
    id: over.id,
    name: over.name ?? `Agent ${over.id}`,
    capability: over.capability ?? "internal_insight",
    configuredLevel: over.configuredLevel ?? 1,
    enabled: over.enabled ?? true,
    description: "description" in over ? over.description ?? null : null,
  };
}

function settings(over: Partial<OrchestratorSettings> = {}): OrchestratorSettings {
  return { killSwitchEngaged: over.killSwitchEngaged ?? false };
}

// ————————————————————————————————————————————————————————————————
// Échelle d'autonomie
// ————————————————————————————————————————————————————————————————
test("AUTONOMY_LEVELS = 0..4", () => {
  assert.deepEqual([...AUTONOMY_LEVELS], [0, 1, 2, 3, 4]);
});

test("isAutonomyLevel accepte 0..4, refuse le reste", () => {
  for (const l of [0, 1, 2, 3, 4]) assert.equal(isAutonomyLevel(l), true);
  for (const bad of [-1, 5, 1.5, "2", null, undefined, NaN]) {
    assert.equal(isAutonomyLevel(bad), false);
  }
});

test("clampAutonomy borne dans [0..4] sans jamais relever au-dessus de 4", () => {
  assert.equal(clampAutonomy(-3), 0);
  assert.equal(clampAutonomy(0), 0);
  assert.equal(clampAutonomy(2), 2);
  assert.equal(clampAutonomy(4), 4);
  assert.equal(clampAutonomy(9), 4);
  assert.equal(clampAutonomy(2.9), 2);
  assert.equal(clampAutonomy(NaN), 0);
});

test("libellés et descriptions d'autonomie couvrent les 5 barreaux", () => {
  for (const l of AUTONOMY_LEVELS) {
    assert.equal(typeof autonomyLabel(l), "string");
    assert.ok(autonomyLabel(l).length > 0);
    assert.ok(autonomyDescription(l).length > 0);
  }
  assert.equal(autonomyLabel(0), "Désactivé");
  assert.equal(autonomyLabel(4), "Autonome borné");
});

// ————————————————————————————————————————————————————————————————
// Capacités + plafonds (encodage de règles dures)
// ————————————————————————————————————————————————————————————————
test("plafonds encodent les règles dures existantes", () => {
  assert.equal(CAPABILITY_CEILING.client_messaging, 2); // Loi Evin + aucun envoi automatisé
  assert.equal(CAPABILITY_CEILING.prod_mutation, 1); // aucune écriture prod autonome
  assert.equal(CAPABILITY_CEILING.pii_processing, 2);
  assert.equal(CAPABILITY_CEILING.content_classification, 3);
  assert.equal(CAPABILITY_CEILING.internal_insight, 4);
});

test("capabilityCeiling / ceilingReason cohérents pour chaque capacité", () => {
  for (const c of AGENT_CAPABILITIES) {
    assert.equal(capabilityCeiling(c), CAPABILITY_CEILING[c]);
    assert.ok(ceilingReason(c).length > 0);
    assert.ok(capabilityLabel(c).length > 0);
  }
});

test("isAgentCapability reconnaît le vocabulaire fermé, refuse le reste", () => {
  for (const c of AGENT_CAPABILITIES) assert.equal(isAgentCapability(c), true);
  for (const bad of ["marketing", "", null, undefined, 3]) {
    assert.equal(isAgentCapability(bad), false);
  }
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle (direction seule)
// ————————————————————————————————————————————————————————————————
test("view/manage réservés à la direction (admin/manager)", () => {
  const direction: StaffRole[] = ["admin", "manager"];
  for (const r of STAFF_ROLES) {
    const expected = direction.includes(r);
    assert.equal(canViewOrchestrator(r), expected, `view ${r}`);
    assert.equal(canManageOrchestrator(r), expected, `manage ${r}`);
  }
  assert.equal(canViewOrchestrator(null), false);
  assert.equal(canManageOrchestrator(undefined), false);
});

// ————————————————————————————————————————————————————————————————
// resolveAgentGovernance — le plafond n'abaisse jamais au-dessus, le kill-switch coupe
// ————————————————————————————————————————————————————————————————
test("un plafond abaisse un niveau configuré trop haut (jamais l'inverse)", () => {
  const g = resolveAgentGovernance(
    agent({ id: "a", capability: "client_messaging", configuredLevel: 4 }),
    settings(),
  );
  assert.equal(g.ceiling, 2);
  assert.equal(g.cappedByCeiling, true);
  assert.equal(g.effectiveLevel, 2); // abaissé au plafond, jamais 4
});

test("prod_mutation configuré à 3 → effectif 1 (plafond), plafonné", () => {
  const g = resolveAgentGovernance(
    agent({ id: "a", capability: "prod_mutation", configuredLevel: 3 }),
    settings(),
  );
  assert.equal(g.effectiveLevel, 1);
  assert.equal(g.cappedByCeiling, true);
});

test("configuré sous le plafond n'est pas plafonné et reste tel quel", () => {
  const g = resolveAgentGovernance(
    agent({ id: "a", capability: "internal_insight", configuredLevel: 3 }),
    settings(),
  );
  assert.equal(g.cappedByCeiling, false);
  assert.equal(g.effectiveLevel, 3);
});

test("interrupteur agent off → effectif 0 sans arrêt global", () => {
  const g = resolveAgentGovernance(
    agent({ id: "a", capability: "internal_insight", configuredLevel: 4, enabled: false }),
    settings(),
  );
  assert.equal(g.disabledBySwitch, true);
  assert.equal(g.haltedByKillSwitch, false);
  assert.equal(g.effectiveLevel, 0);
});

test("arrêt global force TOUT à 0 quel que soit le réglage", () => {
  for (const c of AGENT_CAPABILITIES) {
    const g = resolveAgentGovernance(
      agent({ id: "a", capability: c, configuredLevel: 4, enabled: true }),
      settings({ killSwitchEngaged: true }),
    );
    assert.equal(g.haltedByKillSwitch, true);
    assert.equal(g.effectiveLevel, 0, `capacité ${c} doit être coupée`);
  }
});

// ————————————————————————————————————————————————————————————————
// buildOrchestratorView — état vide honnête
// ————————————————————————————————————————————————————————————————
test("vue vide honnête : aucun agent enregistré, posture au repos", () => {
  const v = buildOrchestratorView({ role: "admin" });
  assert.equal(v.isEmpty, true);
  assert.equal(v.totalAgents, 0);
  assert.equal(v.activeAgents, 0);
  assert.equal(v.maxEffectiveLevel, 0);
  assert.equal(v.posture, "idle");
  assert.equal(v.telemetry, null); // non disponible, jamais fabriqué
});

test("un rôle non-direction ne voit ni ne gère l'orchestrateur", () => {
  const v = buildOrchestratorView({ role: "server", agents: [agent({ id: "a" })] });
  assert.equal(v.canView, false);
  assert.equal(v.canManage, false);
});

// ————————————————————————————————————————————————————————————————
// buildOrchestratorView — agrégats & posture
// ————————————————————————————————————————————————————————————————
test("agrégats : actifs / plafonnés / désactivés / étouffés comptés honnêtement", () => {
  const v = buildOrchestratorView({
    role: "admin",
    agents: [
      agent({ id: "insight", capability: "internal_insight", configuredLevel: 4 }), // effectif 4
      agent({ id: "msg", capability: "client_messaging", configuredLevel: 4 }), // plafonné → 2
      agent({ id: "prod", capability: "prod_mutation", configuredLevel: 4 }), // plafonné → 1
      agent({ id: "off", capability: "content_classification", configuredLevel: 3, enabled: false }), // étouffé → 0
    ],
    settings: settings(),
  });
  assert.equal(v.totalAgents, 4);
  assert.equal(v.activeAgents, 3); // insight, msg, prod > 0
  assert.equal(v.idleAgents, 1); // off
  assert.equal(v.cappedAgents, 2); // msg + prod
  assert.equal(v.disabledAgents, 1); // off
  assert.equal(v.suppressedAgents, 1); // off était configuré à 3 mais effectif 0
  assert.equal(v.maxEffectiveLevel, 4);
  assert.equal(v.posture, "autonomous");
});

test("posture halted quand l'arrêt global est engagé, même avec des agents actifs", () => {
  const v = buildOrchestratorView({
    role: "admin",
    agents: [agent({ id: "insight", capability: "internal_insight", configuredLevel: 4 })],
    settings: settings({ killSwitchEngaged: true }),
  });
  assert.equal(v.killSwitchEngaged, true);
  assert.equal(v.posture, "halted");
  assert.equal(v.maxEffectiveLevel, 0);
  assert.equal(v.activeAgents, 0);
  assert.equal(v.suppressedAgents, 1); // configuré 4, coupé par l'arrêt global
});

test("posture suit le niveau effectif max quand aucun arrêt global", () => {
  const cases: Array<{ level: AutonomyLevel; capability: AgentCapability; posture: string }> = [
    { level: 1, capability: "internal_insight", posture: "observe" },
    { level: 2, capability: "internal_insight", posture: "draft" },
    { level: 3, capability: "internal_insight", posture: "supervised" },
    { level: 4, capability: "internal_insight", posture: "autonomous" },
  ];
  for (const c of cases) {
    const v = buildOrchestratorView({
      role: "admin",
      agents: [agent({ id: "a", capability: c.capability, configuredLevel: c.level })],
    });
    assert.equal(v.posture, c.posture, `niveau ${c.level}`);
  }
});

test("tri : agents plafonnés d'abord, puis capacité la plus risquée", () => {
  const v = buildOrchestratorView({
    role: "admin",
    agents: [
      agent({ id: "insight", capability: "internal_insight", configuredLevel: 2 }), // non plafonné
      agent({ id: "msg", capability: "client_messaging", configuredLevel: 4 }), // plafonné, risque 4
      agent({ id: "prod", capability: "prod_mutation", configuredLevel: 4 }), // plafonné, risque 5
    ],
  });
  // plafonnés d'abord (prod puis msg par risque), non plafonné en dernier
  assert.deepEqual(
    v.agents.map((a) => a.id),
    ["prod", "msg", "insight"],
  );
});

// ————————————————————————————————————————————————————————————————
// Télémétrie : passée telle quelle, jamais fabriquée
// ————————————————————————————————————————————————————————————————
test("télémétrie fournie est reportée ; absente reste null", () => {
  const withTel = buildOrchestratorView({
    role: "admin",
    telemetry: {
      aiCostCents: 1234,
      queuedJobs: 3,
      retryJobs: 1,
      deadLetterJobs: 0,
      workersHealthy: true,
    },
  });
  assert.equal(withTel.telemetry?.aiCostCents, 1234);
  assert.equal(withTel.telemetry?.workersHealthy, true);

  const without = buildOrchestratorView({ role: "admin" });
  assert.equal(without.telemetry, null);
});

// ————————————————————————————————————————————————————————————————
// Libellés de posture
// ————————————————————————————————————————————————————————————————
test("postureLabel couvre les postures utilisées", () => {
  assert.equal(postureLabel("halted"), "Arrêt global");
  assert.equal(postureLabel("idle"), "Au repos");
  assert.equal(postureLabel("autonomous"), "Autonome borné");
});

// ————————————————————————————————————————————————————————————————
// Non-mutation : l'entrée n'est jamais modifiée
// ————————————————————————————————————————————————————————————————
test("buildOrchestratorView ne mute pas les descripteurs d'entrée", () => {
  const src: AgentDescriptor[] = [
    agent({ id: "msg", capability: "client_messaging", configuredLevel: 4 }),
  ];
  const snapshot = JSON.parse(JSON.stringify(src));
  buildOrchestratorView({ role: "admin", agents: src, settings: settings({ killSwitchEngaged: true }) });
  assert.deepEqual(src, snapshot);
});
