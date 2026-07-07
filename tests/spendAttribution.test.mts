import assert from "node:assert/strict";
import test from "node:test";

import {
  AMOUNT_MAX_CENTS,
  ATTRIBUTION_ERROR_LABELS,
  formatCentsAsEuro,
  parseEuroToCents,
  todayIso,
  validateAttribution,
  validateEventDate,
  type AttributionFieldError,
} from "../lib/spendAttribution.ts";

// ————————————————————————————————————————————————————————————————
// parseEuroToCents — euro saisi → centimes entiers (> 0), sans imprécision flottante.
// ————————————————————————————————————————————————————————————————

test("parseEuroToCents: entier simple → centimes", () => {
  assert.deepEqual(parseEuroToCents("12"), { ok: true, cents: 1200 });
});

test("parseEuroToCents: décimale point et virgule équivalentes", () => {
  assert.deepEqual(parseEuroToCents("12.50"), { ok: true, cents: 1250 });
  assert.deepEqual(parseEuroToCents("12,50"), { ok: true, cents: 1250 });
});

test("parseEuroToCents: une seule décimale → complète les centimes (5 → 50)", () => {
  assert.deepEqual(parseEuroToCents("12,5"), { ok: true, cents: 1250 });
});

test("parseEuroToCents: séparateurs de milliers (espaces) tolérés", () => {
  assert.deepEqual(parseEuroToCents("1 250,50"), { ok: true, cents: 125050 });
  assert.deepEqual(parseEuroToCents("1 250,50"), { ok: true, cents: 125050 });
});

test("parseEuroToCents: pas d'imprécision flottante (0,29 → 29 centimes)", () => {
  assert.deepEqual(parseEuroToCents("0,29"), { ok: true, cents: 29 });
  assert.deepEqual(parseEuroToCents("19,99"), { ok: true, cents: 1999 });
});

test("parseEuroToCents: vide refusé", () => {
  assert.deepEqual(parseEuroToCents(""), { ok: false, error: "empty" });
  assert.deepEqual(parseEuroToCents("   "), { ok: false, error: "empty" });
});

test("parseEuroToCents: zéro refusé (aucune dépense à attribuer)", () => {
  assert.deepEqual(parseEuroToCents("0"), { ok: false, error: "zero" });
  assert.deepEqual(parseEuroToCents("0,00"), { ok: false, error: "zero" });
});

test("parseEuroToCents: négatif refusé", () => {
  assert.deepEqual(parseEuroToCents("-5"), { ok: false, error: "negative" });
  assert.deepEqual(parseEuroToCents("-0,01"), { ok: false, error: "negative" });
});

test("parseEuroToCents: plus de 2 décimales refusé explicitement", () => {
  assert.deepEqual(parseEuroToCents("12,345"), { ok: false, error: "too_many_decimals" });
});

test("parseEuroToCents: non numérique refusé", () => {
  assert.deepEqual(parseEuroToCents("abc"), { ok: false, error: "not_a_number" });
  assert.deepEqual(parseEuroToCents("12€"), { ok: false, error: "not_a_number" });
  assert.deepEqual(parseEuroToCents("1.2.3"), { ok: false, error: "not_a_number" });
});

test("parseEuroToCents: au plafond int4 OK, au-delà refusé", () => {
  assert.deepEqual(parseEuroToCents(String(AMOUNT_MAX_CENTS / 100)), {
    ok: true,
    cents: AMOUNT_MAX_CENTS,
  });
  // Un cran au-dessus du plafond → too_large.
  assert.deepEqual(parseEuroToCents("21474836.48"), { ok: false, error: "too_large" });
});

// ————————————————————————————————————————————————————————————————
// validateEventDate — ISO canonique, non future.
// ————————————————————————————————————————————————————————————————

test("validateEventDate: date passée valide", () => {
  assert.deepEqual(validateEventDate("2026-07-01", "2026-07-07"), {
    ok: true,
    value: "2026-07-01",
  });
});

test("validateEventDate: date du jour valide (borne incluse)", () => {
  assert.deepEqual(validateEventDate("2026-07-07", "2026-07-07"), {
    ok: true,
    value: "2026-07-07",
  });
});

test("validateEventDate: date future refusée", () => {
  assert.deepEqual(validateEventDate("2026-07-08", "2026-07-07"), {
    ok: false,
    error: "future",
  });
});

test("validateEventDate: vide refusé", () => {
  assert.deepEqual(validateEventDate("", "2026-07-07"), { ok: false, error: "empty" });
});

test("validateEventDate: format invalide refusé", () => {
  assert.deepEqual(validateEventDate("07/07/2026", "2026-07-07"), { ok: false, error: "invalid" });
  assert.deepEqual(validateEventDate("2026-7-7", "2026-07-07"), { ok: false, error: "invalid" });
});

test("validateEventDate: date calendaire impossible refusée (31 février)", () => {
  assert.deepEqual(validateEventDate("2026-02-31", "2026-07-07"), { ok: false, error: "invalid" });
});

// ————————————————————————————————————————————————————————————————
// todayIso — ISO AAAA-MM-JJ déterministe.
// ————————————————————————————————————————————————————————————————

test("todayIso: rend AAAA-MM-JJ d'une date donnée", () => {
  assert.equal(todayIso(new Date("2026-07-07T23:30:00Z")), "2026-07-07");
});

// ————————————————————————————————————————————————————————————————
// validateAttribution — validation combinée (3 arguments RPC) + agrégation d'erreurs.
// ————————————————————————————————————————————————————————————————

const TODAY = "2026-07-07";

test("validateAttribution: entrée complète valide → arguments RPC prêts", () => {
  const res = validateAttribution(
    { guestId: "11111111-1111-1111-1111-111111111111", eventDateRaw: "2026-07-05", amountRaw: "450" },
    TODAY,
  );
  assert.deepEqual(res, {
    ok: true,
    guestId: "11111111-1111-1111-1111-111111111111",
    eventDate: "2026-07-05",
    amountCents: 45000,
  });
});

test("validateAttribution: aucun client → erreur no_guest", () => {
  const res = validateAttribution({ guestId: null, eventDateRaw: "2026-07-05", amountRaw: "10" }, TODAY);
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.errors.includes("no_guest"));
});

test("validateAttribution: guestId vide → erreur no_guest", () => {
  const res = validateAttribution({ guestId: "   ", eventDateRaw: "2026-07-05", amountRaw: "10" }, TODAY);
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.errors.includes("no_guest"));
});

test("validateAttribution: agrège plusieurs erreurs de champ", () => {
  const res = validateAttribution({ guestId: null, eventDateRaw: "2026-07-08", amountRaw: "0" }, TODAY);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.ok(res.errors.includes("no_guest"));
    assert.ok(res.errors.includes("future"));
    assert.ok(res.errors.includes("zero"));
  }
});

test("validateAttribution: montant trop grand refusé", () => {
  const res = validateAttribution(
    { guestId: "g", eventDateRaw: "2026-07-05", amountRaw: "21474836.48" },
    TODAY,
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.errors.includes("too_large"));
});

// ————————————————————————————————————————————————————————————————
// formatCentsAsEuro + labels — affichage honnête.
// ————————————————————————————————————————————————————————————————

test("formatCentsAsEuro: 2 décimales toujours", () => {
  assert.match(formatCentsAsEuro(45000), /450,00\s?€/);
  assert.match(formatCentsAsEuro(29), /0,29\s?€/);
});

test("ATTRIBUTION_ERROR_LABELS: chaque erreur possible a un libellé non vide", () => {
  const errs: AttributionFieldError[] = [
    "no_guest",
    "empty",
    "invalid",
    "future",
    "not_a_number",
    "negative",
    "zero",
    "too_many_decimals",
    "too_large",
  ];
  for (const e of errs) {
    assert.equal(typeof ATTRIBUTION_ERROR_LABELS[e], "string");
    assert.ok(ATTRIBUTION_ERROR_LABELS[e].length > 0);
  }
});
