// tests/pwa.test.mts — helpers PURS de la couche PWA (lib/pwa.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PWA_SHELL_VERSION,
  compareVersions,
  isUpdateAvailable,
  nextConnectionStatus,
  shouldShowConnectionBanner,
  isInstallEligible,
  isManualInstallHint,
  type ConnectionStatus,
} from "../lib/pwa.ts";

test("compareVersions : ordre semver segment par segment", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1); // comparaison numérique, pas lexicale
});

test("compareVersions : longueurs différentes et parties non numériques = 0", () => {
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.2.1", "1.2"), 1);
  assert.equal(compareVersions("", "0.0.0"), 0);
  assert.equal(compareVersions("1.x.0", "1.0.0"), 0); // x -> 0
});

test("isUpdateAvailable : strictement plus récente uniquement", () => {
  assert.equal(isUpdateAvailable("1.0.0", "1.0.1"), true);
  assert.equal(isUpdateAvailable("1.0.0", "1.0.0"), false);
  assert.equal(isUpdateAvailable("1.0.1", "1.0.0"), false); // pas un downgrade
});

test("PWA_SHELL_VERSION est une version semver exploitable", () => {
  assert.match(PWA_SHELL_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(compareVersions(PWA_SHELL_VERSION, PWA_SHELL_VERSION), 0);
});

test("nextConnectionStatus : offline force offline depuis tout état", () => {
  const states: ConnectionStatus[] = ["online", "offline", "reconnecting"];
  for (const s of states) {
    assert.equal(nextConnectionStatus(s, "offline"), "offline");
  }
});

test("nextConnectionStatus : online déclenche une vérification depuis offline", () => {
  assert.equal(nextConnectionStatus("offline", "online"), "reconnecting");
  assert.equal(nextConnectionStatus("reconnecting", "online"), "reconnecting");
  assert.equal(nextConnectionStatus("online", "online"), "online");
});

test("nextConnectionStatus : le probe confirme ou infirme la reconnexion", () => {
  assert.equal(nextConnectionStatus("reconnecting", "reconnect-confirmed"), "online");
  assert.equal(nextConnectionStatus("reconnecting", "reconnect-failed"), "offline");
  // reconnect-failed hors phase de vérification ne change rien.
  assert.equal(nextConnectionStatus("online", "reconnect-failed"), "online");
  assert.equal(nextConnectionStatus("offline", "reconnect-failed"), "offline");
});

test("nextConnectionStatus : cycle complet offline -> reconnecting -> online", () => {
  let s: ConnectionStatus = "online";
  s = nextConnectionStatus(s, "offline");
  assert.equal(s, "offline");
  s = nextConnectionStatus(s, "online");
  assert.equal(s, "reconnecting");
  s = nextConnectionStatus(s, "reconnect-confirmed");
  assert.equal(s, "online");
});

test("shouldShowConnectionBanner : visible sauf online stable", () => {
  assert.equal(shouldShowConnectionBanner("online"), false);
  assert.equal(shouldShowConnectionBanner("offline"), true);
  assert.equal(shouldShowConnectionBanner("reconnecting"), true);
});

test("isInstallEligible : toutes les conditions requises", () => {
  const base = {
    isStandalone: false,
    hasServiceWorker: true,
    isSecureContext: true,
    hasBeforeInstallPrompt: true,
  };
  assert.equal(isInstallEligible(base), true);
  assert.equal(isInstallEligible({ ...base, isStandalone: true }), false); // déjà installée
  assert.equal(isInstallEligible({ ...base, isSecureContext: false }), false); // pas https
  assert.equal(isInstallEligible({ ...base, hasServiceWorker: false }), false);
  assert.equal(isInstallEligible({ ...base, hasBeforeInstallPrompt: false }), false);
});

test("isManualInstallHint : iOS non installée uniquement", () => {
  assert.equal(isManualInstallHint({ isIOS: true, isStandalone: false }), true);
  assert.equal(isManualInstallHint({ isIOS: true, isStandalone: true }), false);
  assert.equal(isManualInstallHint({ isIOS: false, isStandalone: false }), false);
});
