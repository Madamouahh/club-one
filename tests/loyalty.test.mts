// tests/loyalty.test.mts — logique pure du moteur de fidélité (lib/loyalty.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOYALTY_TIERS,
  tierForPoints,
  pointsToNextTier,
  canManageLoyalty,
  validateAccrue,
  validateRedeem,
  applyDelta,
  balanceFromLedger,
  type LoyaltyLedgerEntry,
} from "../lib/loyalty.ts";

test("tierForPoints : palier dérivé aux seuils (miroir de public.loyalty_tier)", () => {
  assert.equal(tierForPoints(0), "bronze");
  assert.equal(tierForPoints(499), "bronze");
  assert.equal(tierForPoints(500), "silver");
  assert.equal(tierForPoints(1499), "silver");
  assert.equal(tierForPoints(1500), "gold");
  assert.equal(tierForPoints(4999), "gold");
  assert.equal(tierForPoints(5000), "platinum");
  assert.equal(tierForPoints(999999), "platinum");
});

test("tierForPoints : solde négatif / non fini → bronze (aucun palier fabriqué)", () => {
  assert.equal(tierForPoints(-100), "bronze");
  assert.equal(tierForPoints(Number.NaN), "bronze");
});

test("pointsToNextTier : distance au palier suivant, null au sommet", () => {
  assert.deepEqual(pointsToNextTier(0), { next: "silver", remaining: 500 });
  assert.deepEqual(pointsToNextTier(500), { next: "gold", remaining: 1000 });
  assert.deepEqual(pointsToNextTier(1490), { next: "gold", remaining: 10 });
  assert.deepEqual(pointsToNextTier(1500), { next: "platinum", remaining: 3500 });
  assert.equal(pointsToNextTier(5000), null);
  assert.equal(pointsToNextTier(9999), null);
});

test("les seuils LOYALTY_TIERS sont strictement croissants et commencent à 0", () => {
  assert.equal(LOYALTY_TIERS[0].min, 0);
  for (let i = 1; i < LOYALTY_TIERS.length; i++) {
    assert.ok(LOYALTY_TIERS[i].min > LOYALTY_TIERS[i - 1].min);
  }
});

test("canManageLoyalty : direction gère, autres rôles exclus", () => {
  assert.equal(canManageLoyalty("admin"), true);
  assert.equal(canManageLoyalty("manager"), true);
  assert.equal(canManageLoyalty("promoter"), false);
  assert.equal(canManageLoyalty("server"), false);
  assert.equal(canManageLoyalty("security"), false);
  assert.equal(canManageLoyalty("security_counter"), false);
});

test("validateAccrue : entier strictement positif requis", () => {
  assert.equal(validateAccrue(100).ok, true);
  assert.equal(validateAccrue(1).ok, true);
  assert.equal(validateAccrue(0).ok, false);
  assert.equal(validateAccrue(-5).ok, false);
  assert.equal(validateAccrue(1.5).ok, false);
  assert.equal(validateAccrue(Number.NaN).ok, false);
});

test("validateRedeem : entier positif ET jamais au-delà du solde (pas de solde négatif)", () => {
  assert.equal(validateRedeem(50, 100).ok, true);
  assert.equal(validateRedeem(100, 100).ok, true); // solde exact autorisé
  assert.equal(validateRedeem(101, 100).ok, false); // dépasse → refusé
  assert.equal(validateRedeem(10, 0).ok, false); // aucun point → refusé
  assert.equal(validateRedeem(0, 100).ok, false);
  assert.equal(validateRedeem(-5, 100).ok, false);
  assert.equal(validateRedeem(2.5, 100).ok, false);
});

test("applyDelta : crédit/débit, clampé à 0 (jamais négatif à l'affichage)", () => {
  assert.equal(applyDelta(100, 50), 150);
  assert.equal(applyDelta(100, -40), 60);
  assert.equal(applyDelta(30, -100), 0); // clamp
});

test("balanceFromLedger : le solde est la somme des delta signés", () => {
  const entries: LoyaltyLedgerEntry[] = [
    { id: "1", guest_id: "g", delta: 100, reason: "visite", created_by: "admin", created_at: null },
    { id: "2", guest_id: "g", delta: 250, reason: null, created_by: "admin", created_at: null },
    { id: "3", guest_id: "g", delta: -50, reason: "bouteille", created_by: "manager", created_at: null },
  ];
  assert.equal(balanceFromLedger(entries), 300);
  assert.equal(balanceFromLedger([]), 0);
});
