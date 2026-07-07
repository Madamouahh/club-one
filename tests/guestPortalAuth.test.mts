import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_LOCKOUT_MS,
  AUTH_MAX_FAILS,
  AUTH_WINDOW_MS,
  authErrorMessage,
  canAttemptRecovery,
  formatRetryDelay,
  initialAttemptState,
  isLocked,
  isPinFormat,
  lockRemainingMs,
  normalizePhone,
  parseAuthResult,
  registerFailure,
  remainingAttempts,
  resetAttempts,
  sanitizePinInput,
  type AuthAttemptState,
} from "../lib/guestPortalAuth.ts";

// ————————————————————————————————————————————————————————————————
// Format / sanitisation de PIN
// ————————————————————————————————————————————————————————————————
test("isPinFormat : 4 à 8 chiffres, trim toléré", () => {
  assert.equal(isPinFormat("1234"), true);
  assert.equal(isPinFormat("12345678"), true);
  assert.equal(isPinFormat("  4321 "), true);
  assert.equal(isPinFormat("123"), false);
  assert.equal(isPinFormat("123456789"), false);
  assert.equal(isPinFormat("12a4"), false);
  assert.equal(isPinFormat(""), false);
});

test("sanitizePinInput : chiffres uniquement, borné à 8", () => {
  assert.equal(sanitizePinInput("12ab34"), "1234");
  assert.equal(sanitizePinInput("123456789"), "12345678");
  assert.equal(sanitizePinInput("  9 9 "), "99");
  assert.equal(sanitizePinInput(""), "");
});

// ————————————————————————————————————————————————————————————————
// State machine de verrou (miroir de _guest_auth_note_fail)
// ————————————————————————————————————————————————————————————————
test("registerFailure incrémente dans la fenêtre puis verrouille au seuil", () => {
  const t0 = 1_000_000;
  let s: AuthAttemptState = initialAttemptState();
  for (let i = 1; i < AUTH_MAX_FAILS; i++) {
    s = registerFailure(s, t0 + i);
    assert.equal(s.failedCount, i);
    assert.equal(isLocked(s, t0 + i), false, `pas encore verrouillé à ${i} échecs`);
  }
  // Le AUTH_MAX_FAILS-ième échec arme le verrou.
  s = registerFailure(s, t0 + AUTH_MAX_FAILS);
  assert.equal(s.failedCount, AUTH_MAX_FAILS);
  assert.equal(isLocked(s, t0 + AUTH_MAX_FAILS), true);
  assert.equal(s.lockedUntil, t0 + AUTH_MAX_FAILS + AUTH_LOCKOUT_MS);
});

test("registerFailure repart à 1 si la fenêtre est écoulée", () => {
  const t0 = 5_000_000;
  let s = registerFailure(initialAttemptState(), t0);
  s = registerFailure(s, t0 + 1);
  assert.equal(s.failedCount, 2);
  // Bien au-delà de la fenêtre → recompte à 1, nouvelle fenêtre.
  const later = t0 + AUTH_WINDOW_MS + 1;
  s = registerFailure(s, later);
  assert.equal(s.failedCount, 1);
  assert.equal(s.windowStartedAt, later);
  assert.equal(isLocked(s, later), false);
});

test("isLocked / lockRemainingMs reflètent l'état du verrou", () => {
  const t0 = 2_000_000;
  let s = initialAttemptState();
  for (let i = 0; i < AUTH_MAX_FAILS; i++) s = registerFailure(s, t0 + i);
  assert.equal(isLocked(s, t0 + AUTH_MAX_FAILS), true);
  assert.ok(lockRemainingMs(s, t0 + AUTH_MAX_FAILS) > 0);
  // Après expiration du verrou.
  const after = (s.lockedUntil as number) + 1;
  assert.equal(isLocked(s, after), false);
  assert.equal(lockRemainingMs(s, after), 0);
});

test("resetAttempts remet l'état à zéro (succès)", () => {
  const s = resetAttempts();
  assert.deepEqual(s, { failedCount: 0, windowStartedAt: null, lockedUntil: null });
  assert.equal(isLocked(s, Date.now()), false);
});

test("remainingAttempts décroît puis tombe à 0 sous verrou", () => {
  const t0 = 3_000_000;
  let s = initialAttemptState();
  assert.equal(remainingAttempts(s, t0), AUTH_MAX_FAILS);
  s = registerFailure(s, t0);
  assert.equal(remainingAttempts(s, t0), AUTH_MAX_FAILS - 1);
  for (let i = 1; i < AUTH_MAX_FAILS; i++) s = registerFailure(s, t0 + i);
  assert.equal(remainingAttempts(s, t0 + AUTH_MAX_FAILS), 0);
});

test("remainingAttempts se recharge quand la fenêtre est écoulée", () => {
  const t0 = 4_000_000;
  let s = registerFailure(initialAttemptState(), t0);
  assert.equal(remainingAttempts(s, t0), AUTH_MAX_FAILS - 1);
  const after = t0 + AUTH_WINDOW_MS + 1;
  assert.equal(remainingAttempts(s, after), AUTH_MAX_FAILS);
});

// ————————————————————————————————————————————————————————————————
// Éligibilité récupération (RC)
// ————————————————————————————————————————————————————————————————
test("normalizePhone trim", () => {
  assert.equal(normalizePhone("  +33600000000 "), "+33600000000");
  assert.equal(normalizePhone(""), "");
});

test("canAttemptRecovery exige téléphone non vide + PIN bien formé", () => {
  assert.equal(canAttemptRecovery({ phone: "+33600000000", pin: "1234" }), true);
  assert.equal(canAttemptRecovery({ phone: "  ", pin: "1234" }), false);
  assert.equal(canAttemptRecovery({ phone: "+33600000000", pin: "12" }), false);
  assert.equal(canAttemptRecovery({ phone: "+33600000000", pin: "abcd" }), false);
});

// ————————————————————————————————————————————————————————————————
// Parsing des réponses RPC 0061
// ————————————————————————————————————————————————————————————————
test("parseAuthResult : succès verify (expires_at)", () => {
  const r = parseAuthResult({ ok: true, expires_at: "2027-01-01T00:00:00Z" });
  assert.equal(r.ok, true);
  assert.equal(r.code, null);
  assert.equal(r.expiresAt, "2027-01-01T00:00:00Z");
});

test("parseAuthResult : succès recover (space_token)", () => {
  const r = parseAuthResult({ ok: true, space_token: "abc", expires_at: "x" });
  assert.equal(r.ok, true);
  assert.equal(r.spaceToken, "abc");
});

test("parseAuthResult : verrou (locked + retry_after_seconds)", () => {
  const r = parseAuthResult({
    ok: false,
    code: "locked",
    locked_until: "2026-07-07T10:00:00Z",
    retry_after_seconds: 900,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "locked");
  assert.equal(r.lockedUntil, "2026-07-07T10:00:00Z");
  assert.equal(r.retryAfterSeconds, 900);
});

test("parseAuthResult : code neutre pin_invalid", () => {
  const r = parseAuthResult({ ok: false, code: "pin_invalid" });
  assert.equal(r.code, "pin_invalid");
});

test("parseAuthResult : code inconnu → 'unknown'", () => {
  assert.equal(parseAuthResult({ ok: false, code: "wat" }).code, "unknown");
  assert.equal(parseAuthResult(null).code, "unknown");
  assert.equal(parseAuthResult("x").code, "unknown");
  assert.equal(parseAuthResult({ ok: false }).code, "unknown");
});

test("parseAuthResult : retry_after_seconds non-numérique ignoré", () => {
  const r = parseAuthResult({ ok: false, code: "locked", retry_after_seconds: "soon" });
  assert.equal(r.retryAfterSeconds, null);
});

// ————————————————————————————————————————————————————————————————
// Messages FR
// ————————————————————————————————————————————————————————————————
test("formatRetryDelay : secondes / minutes / repli", () => {
  assert.equal(formatRetryDelay(30), "30 secondes");
  assert.equal(formatRetryDelay(1), "1 seconde");
  assert.equal(formatRetryDelay(90), "2 minutes");
  assert.equal(formatRetryDelay(60), "1 minute");
  assert.equal(formatRetryDelay(0), "quelques instants");
  assert.equal(formatRetryDelay(null), "quelques instants");
});

test("authErrorMessage : messages neutres + compte à rebours verrou", () => {
  assert.equal(authErrorMessage(null), "");
  assert.equal(authErrorMessage("pin_invalid"), "Code incorrect.");
  assert.equal(authErrorMessage("recover_invalid"), "Téléphone ou code incorrect.");
  assert.equal(authErrorMessage("pin_format"), "Le code doit contenir 4 à 8 chiffres.");
  assert.equal(authErrorMessage("expired"), "Ce lien a expiré.");
  assert.equal(authErrorMessage("invalid_token"), "Lien invalide.");
  assert.equal(
    authErrorMessage("locked", { retryAfterSeconds: 120 }),
    "Trop de tentatives. Réessayez dans 2 minutes.",
  );
  assert.equal(authErrorMessage("unknown"), "Action refusée. Réessayez.");
  assert.equal(authErrorMessage("network"), "Service momentanément indisponible. Réessayez.");
});

test("authErrorMessage : pin_invalid NE distingue PAS 'pas de PIN' de 'PIN faux' (anti-énumération)", () => {
  // Deux situations serveur distinctes → même message client.
  assert.equal(authErrorMessage("pin_invalid"), authErrorMessage("pin_invalid"));
});
