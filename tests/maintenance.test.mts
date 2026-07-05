// tests/maintenance.test.mts — logique pure du module Maintenance (lib/maintenance.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageMaintenance,
  canViewMaintenance,
  isOpenIntervention,
  validateInterventionDraft,
  sortInterventions,
  maintenanceSummary,
  formatCostEuro,
  statusLabel,
  type MaintenanceIntervention,
  type Equipment,
} from "../lib/maintenance.ts";

test("gardes de rôle : direction gère, staff opérationnel consulte, promoteur exclu", () => {
  assert.equal(canManageMaintenance("admin"), true);
  assert.equal(canManageMaintenance("manager"), true);
  assert.equal(canManageMaintenance("server"), false);
  assert.equal(canManageMaintenance("promoter"), false);
  assert.equal(canViewMaintenance("server"), true);
  assert.equal(canViewMaintenance("security"), true);
  assert.equal(canViewMaintenance("promoter"), false); // aligné RLS 0046 (hors périmètre)
});

test("validation d'un brouillon d'intervention", () => {
  assert.equal(validateInterventionDraft({ equipment_id: "" }).ok, false);
  assert.equal(validateInterventionDraft({ equipment_id: "e1", kind: "inconnu" }).ok, false);
  assert.equal(validateInterventionDraft({ equipment_id: "e1", priority: "extreme" }).ok, false);
  assert.equal(validateInterventionDraft({ equipment_id: "e1", cost_cents: -5 }).ok, false);
  assert.equal(validateInterventionDraft({ equipment_id: "e1", kind: "panne", priority: "urgente", cost_cents: 12000 }).ok, true);
});

test("isOpenIntervention : ouvert/en_cours = ouvert ; resolu/annule = fermé", () => {
  assert.equal(isOpenIntervention({ status: "ouvert" } as MaintenanceIntervention), true);
  assert.equal(isOpenIntervention({ status: "en_cours" } as MaintenanceIntervention), true);
  assert.equal(isOpenIntervention({ status: "resolu" } as MaintenanceIntervention), false);
  assert.equal(isOpenIntervention({ status: "annule" } as MaintenanceIntervention), false);
});

test("tri : ouvertes d'abord, puis priorité urgente→basse, puis ancienneté", () => {
  const list: MaintenanceIntervention[] = [
    { id: "a", equipment_id: "e", kind: "panne", priority: "basse", status: "ouvert", opened_at: "2026-07-01" },
    { id: "b", equipment_id: "e", kind: "panne", priority: "urgente", status: "ouvert", opened_at: "2026-07-02" },
    { id: "c", equipment_id: "e", kind: "panne", priority: "urgente", status: "resolu", opened_at: "2026-07-03" },
    { id: "d", equipment_id: "e", kind: "panne", priority: "haute", status: "en_cours", opened_at: "2026-07-01" },
  ];
  assert.deepEqual(sortInterventions(list).map((i) => i.id), ["b", "d", "a", "c"]);
});

test("agrégat cockpit : parc, pannes, HS, ouvertes, urgentes, coût des OUVERTES renseignées", () => {
  const equipment: Equipment[] = [
    { id: "1", name: "Ampli", category: "son", status: "panne" },
    { id: "2", name: "Frigo", category: "froid", status: "hs" },
    { id: "3", name: "Spot", category: "lumiere", status: "ok" },
  ];
  const interventions: MaintenanceIntervention[] = [
    { id: "i1", equipment_id: "1", kind: "panne", priority: "urgente", status: "ouvert", cost_cents: 5000 },
    { id: "i2", equipment_id: "2", kind: "reparation", priority: "haute", status: "en_cours", cost_cents: null },
    { id: "i3", equipment_id: "3", kind: "preventif", priority: "basse", status: "resolu", cost_cents: 9999 },
  ];
  const s = maintenanceSummary(equipment, interventions);
  assert.equal(s.parcTotal, 3);
  assert.equal(s.enPanne, 1);
  assert.equal(s.horsService, 1);
  assert.equal(s.interventionsOuvertes, 2);
  assert.equal(s.urgentes, 1);
  assert.equal(s.coutOuvertCents, 5000); // i2 null non compté, i3 résolue non comptée
});

test("formatCostEuro : coût non renseigné = tiret (jamais 0 € inventé)", () => {
  assert.equal(formatCostEuro(null), "—");
  assert.equal(formatCostEuro(undefined), "—");
  assert.match(formatCostEuro(12000), /120/);
});

test("statusLabel : libellés lisibles", () => {
  assert.equal(statusLabel("panne"), "En panne");
  assert.equal(statusLabel("en_cours"), "En cours");
  assert.equal(statusLabel("inconnu"), "inconnu");
});
