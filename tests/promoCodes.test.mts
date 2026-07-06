// tests/promoCodes.test.mts — logique pure des codes promo (lib/promoCodes.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePromoCode,
  computeDiscountCents,
  type PromoCode,
} from "../lib/promoCodes.ts";

const NOW = Date.parse("2026-07-07T20:00:00.000Z");

function code(over: Partial<PromoCode> = {}): PromoCode {
  return {
    id: "p1",
    code: "SUMMER",
    discount_type: "percent",
    discount_value_cents: 20, // 20 %
    max_redemptions: null,
    redeemed_count: 0,
    per_guest_limit: 1,
    valid_from: "2026-07-01",
    valid_until: "2026-07-31",
    active: true,
    ...over,
  };
}

test("validatePromoCode : code valide dans la fenêtre", () => {
  assert.deepEqual(validatePromoCode(code(), { now: NOW }), { valid: true, reason: "ok" });
});

test("validatePromoCode : code absent ou inactif", () => {
  assert.equal(validatePromoCode(null, { now: NOW }).valid, false);
  assert.deepEqual(validatePromoCode(code({ active: false }), { now: NOW }), {
    valid: false,
    reason: "inactive",
  });
});

test("validatePromoCode : fenêtre de validité (pas encore / expiré)", () => {
  assert.deepEqual(
    validatePromoCode(code({ valid_from: "2026-08-01" }), { now: NOW }),
    { valid: false, reason: "not_yet_valid" },
  );
  assert.deepEqual(
    validatePromoCode(code({ valid_until: "2026-07-06" }), { now: NOW }),
    { valid: false, reason: "expired" },
  );
  // valid_until en date seule couvre toute la journée : le 2026-07-07 reste valide.
  assert.equal(validatePromoCode(code({ valid_until: "2026-07-07" }), { now: NOW }).valid, true);
});

test("validatePromoCode : plafond global de rédemption", () => {
  assert.deepEqual(
    validatePromoCode(code({ max_redemptions: 100, redeemed_count: 100 }), { now: NOW }),
    { valid: false, reason: "max_redemptions_reached" },
  );
  assert.equal(
    validatePromoCode(code({ max_redemptions: 100, redeemed_count: 99 }), { now: NOW }).valid,
    true,
  );
});

test("validatePromoCode : plafond par guest", () => {
  assert.deepEqual(
    validatePromoCode(code({ per_guest_limit: 1 }), { now: NOW, guestRedemptions: 1 }),
    { valid: false, reason: "per_guest_limit_reached" },
  );
  assert.equal(
    validatePromoCode(code({ per_guest_limit: 3 }), { now: NOW, guestRedemptions: 2 }).valid,
    true,
  );
  // per_guest_limit = 0 traité comme « pas de limite par guest » côté validation.
  assert.equal(
    validatePromoCode(code({ per_guest_limit: 0 }), { now: NOW, guestRedemptions: 9 }).valid,
    true,
  );
});

test("computeDiscountCents : pourcentage borné et arrondi", () => {
  assert.equal(computeDiscountCents({ discount_type: "percent", discount_value_cents: 20 }, 10000), 2000);
  // pourcentage > 100 borné à 100 ⇒ remise = sous-total
  assert.equal(computeDiscountCents({ discount_type: "percent", discount_value_cents: 150 }, 10000), 10000);
  // arrondi
  assert.equal(computeDiscountCents({ discount_type: "percent", discount_value_cents: 33 }, 999), 330);
});

test("computeDiscountCents : montant fixe borné au sous-total", () => {
  assert.equal(computeDiscountCents({ discount_type: "amount", discount_value_cents: 1500 }, 10000), 1500);
  // remise fixe > sous-total ⇒ bornée (jamais de total négatif)
  assert.equal(computeDiscountCents({ discount_type: "amount", discount_value_cents: 99999 }, 5000), 5000);
});

test("computeDiscountCents : sous-total nul/invalide ⇒ 0, valeur nulle ⇒ 0", () => {
  assert.equal(computeDiscountCents({ discount_type: "percent", discount_value_cents: 20 }, 0), 0);
  assert.equal(computeDiscountCents({ discount_type: "amount", discount_value_cents: 0 }, 10000), 0);
  assert.equal(computeDiscountCents({ discount_type: "percent", discount_value_cents: -5 }, 10000), 0);
});
