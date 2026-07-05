// tests/directionCockpit.test.mts — logique pure du cockpit direction (lib/directionCockpit.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  frequentation,
  estimatedMargin,
  globalAlertLevel,
  pendingDecisions,
  formatEuro,
} from "../lib/directionCockpit.ts";

test("frequentation : présents = entrées − sorties, borné à 0", () => {
  assert.deepEqual(frequentation([{ type: "entry" }, { type: "entry" }, { type: "exit" }]), {
    entrees: 2,
    sorties: 1,
    present: 1,
  });
  assert.equal(frequentation([{ type: "exit" }, { type: "exit" }]).present, 0);
});

test("estimatedMargin : marge = CA − coûts connus, toujours estimation", () => {
  const m = estimatedMargin(100000, 40000);
  assert.equal(m.margeCents, 60000);
  assert.equal(m.estimation, true);
});

test("globalAlertLevel : critique si incident critique OU maintenance urgente, attention si rupture", () => {
  assert.equal(globalAlertLevel({ incidentsCritiques: 1, stockRuptures: 0, maintenanceUrgente: 0 }), "critique");
  assert.equal(globalAlertLevel({ incidentsCritiques: 0, stockRuptures: 0, maintenanceUrgente: 2 }), "critique");
  assert.equal(globalAlertLevel({ incidentsCritiques: 0, stockRuptures: 3, maintenanceUrgente: 0 }), "attention");
  assert.equal(globalAlertLevel({ incidentsCritiques: 0, stockRuptures: 0, maintenanceUrgente: 0 }), "ok");
});

test("pendingDecisions : liste seulement les postes non vides", () => {
  assert.deepEqual(pendingDecisions({ resaPending: 2, leadsNouveaux: 0, campaignsBrouillon: 1 }), [
    { label: "Demandes de réservation à décider", count: 2 },
    { label: "Campagnes en brouillon", count: 1 },
  ]);
  assert.deepEqual(pendingDecisions({ resaPending: 0, leadsNouveaux: 0, campaignsBrouillon: 0 }), []);
});

test("formatEuro : valeur absente = NON RENSEIGNÉ (jamais 0 € comptable inventé)", () => {
  assert.equal(formatEuro(null), "NON RENSEIGNÉ");
  assert.match(formatEuro(123400), /1\s?234/);
});
