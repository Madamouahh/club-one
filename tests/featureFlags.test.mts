// tests/featureFlags.test.mts — registre des feature flags du programme (lib/featureFlags.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_KEYS,
  FEATURE_DEFAULTS,
  parseFeatureOverrides,
  isFeatureEnabled,
  enabledFeatures,
  adapterStatus,
} from "../lib/featureFlags.ts";

test("chaque nouveau module a un défaut OFF (rien de non-terminé exposé)", () => {
  for (const key of FEATURE_KEYS) {
    assert.equal(FEATURE_DEFAULTS[key], false, `${key} doit être OFF par défaut`);
  }
});

test("parse : `key` force ON, `!key` force OFF, espaces tolérés, inconnus ignorés", () => {
  const o = parseFeatureOverrides(" cockpitManager , !maintenance ,inconnu, ");
  assert.equal(o.cockpitManager, true);
  assert.equal(o.maintenance, false);
  assert.equal("inconnu" in o, false);
  assert.deepEqual(parseFeatureOverrides(null), {});
  assert.deepEqual(parseFeatureOverrides(""), {});
});

test("isFeatureEnabled : override sinon défaut", () => {
  assert.equal(isFeatureEnabled("cockpitManager"), false); // défaut OFF
  assert.equal(isFeatureEnabled("cockpitManager", "cockpitManager"), true); // override ON
  assert.equal(isFeatureEnabled("maintenance", "!maintenance"), false); // override OFF explicite
  assert.equal(isFeatureEnabled("commercial", "cockpitManager"), false); // autre clé → défaut
});

test("enabledFeatures reflète la chaîne", () => {
  assert.deepEqual(enabledFeatures("cockpitManager,agenda"), ["cockpitManager", "agenda"]);
  assert.deepEqual(enabledFeatures(null), []); // tous OFF par défaut
});

test("adapterStatus : statut honnête, jamais un mock présenté comme actif", () => {
  assert.equal(adapterStatus(false, false), "NON ACTIVÉ");
  assert.equal(adapterStatus(false, true), "PRÊT À CONNECTER"); // flag on mais pas de clé
  assert.equal(adapterStatus(true, false), "NON ACTIVÉ"); // clé présente mais flag off
  assert.equal(adapterStatus(true, true), "ACTIF");
});
