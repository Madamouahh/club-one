// tests/budgetReal.test.mts — RÉEL connecté du module Budget (lib/budget · computeRealFromSources).
// Vérifie le mapping source live → poste ET l'honnêteté null (poste sans source = NON RENSEIGNÉ,
// jamais 0 € fabriqué), en cohérence avec variance() qui produit alors le tag « NON RENSEIGNÉ ».
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRealFromSources,
  variance,
  BUDGET_POSTES,
  type RealByPoste,
} from "../lib/budget.ts";

test("mapping complet : chaque source alimente SON poste, en cents", () => {
  const real = computeRealFromSources({
    caTablesCents: 1200000,
    artistesCents: 500000,
    personnelCents: 350000,
    achatsCents: 90000,
    pertesCents: 12000,
    maintenanceCents: 45000,
  });
  assert.equal(real.ca_tables, 1200000);
  assert.equal(real.artistes, 500000);
  assert.equal(real.personnel, 350000);
  assert.equal(real.achats, 90000);
  assert.equal(real.pertes, 12000);
  assert.equal(real.maintenance, 45000);
});

test("honnêteté : postes SANS source dédiée toujours null (publicite, autre)", () => {
  const real = computeRealFromSources({
    caTablesCents: 1000,
    artistesCents: 1000,
    personnelCents: 1000,
    achatsCents: 1000,
    pertesCents: 1000,
    maintenanceCents: 1000,
  });
  // publicite & autre n'ont AUCUNE table vivante : jamais présentés comme réels.
  assert.equal(real.publicite, null);
  assert.equal(real.autre, null);
});

test("honnêteté : source absente (undefined) → poste null, jamais 0 fabriqué", () => {
  const real = computeRealFromSources({}); // aucune source fournie
  for (const p of BUDGET_POSTES) {
    assert.equal(real[p], null, `poste ${p} doit rester NON RENSEIGNÉ`);
  }
});

test("honnêteté : source connectée mais non chiffrable (null / NaN) → poste null", () => {
  const real = computeRealFromSources({
    caTablesCents: null, // caisse branchée mais aucun Z saisi
    personnelCents: Number.NaN, // rollup branché mais coût incomplet
    artistesCents: undefined, // aucun cachet engagé & chiffré
    achatsCents: 0, // 0 réel valorisé reste une valeur réelle (pas null)
  });
  assert.equal(real.ca_tables, null);
  assert.equal(real.personnel, null);
  assert.equal(real.artistes, null);
  // 0 explicite = donnée réelle valorisée à 0, distincte d'« absente » : on la garde.
  assert.equal(real.achats, 0);
});

test("cents non entiers arrondis (agrégat euros × 100 arrondi)", () => {
  const real = computeRealFromSources({ artistesCents: 12345.6 });
  assert.equal(real.artistes, 12346);
});

test("intégration variance : poste réel → écart chiffré ; poste non connecté → NON RENSEIGNÉ", () => {
  const real: RealByPoste = computeRealFromSources({ artistesCents: 550000 });
  // artistes connecté : écart réel − prévu.
  const vArtistes = variance(500000, real.artistes);
  assert.equal(vArtistes.ecartCents, 50000);
  assert.equal(vArtistes.tag, 50000);
  // publicite sans source : variance honnête « NON RENSEIGNÉ », jamais un écart fabriqué.
  const vPub = variance(80000, real.publicite);
  assert.equal(vPub.ecartCents, null);
  assert.equal(vPub.tag, "NON RENSEIGNÉ");
});

test("clés du record = vocabulaire fermé BUDGET_POSTES (aucun poste orphelin)", () => {
  const real = computeRealFromSources({});
  assert.deepEqual(Object.keys(real).sort(), [...BUDGET_POSTES].sort());
});
