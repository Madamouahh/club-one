import assert from "node:assert/strict";
import test from "node:test";

import {
  DOOR_SCAN_ROLES,
  extractPassToken,
  interpretScanResult,
  normalizeScanResponse,
  type ScanPassResult,
} from "../lib/crmScan.ts";

// Jeton d'entrée réaliste = deux uuid hex concaténés (64 hex), tel que généré par la RPC 0014/0015.
const REAL_TOKEN = "a".repeat(32) + "b".repeat(32);

function res(over: Partial<ScanPassResult> = {}): ScanPassResult {
  return {
    ok: over.ok ?? true,
    code: over.code ?? "ok",
    message: over.message ?? "",
    first_name: "first_name" in over ? over.first_name ?? null : "Alex",
    univers: "univers" in over ? over.univers ?? null : "eden",
    is_host: over.is_host ?? false,
    scanned_at: over.scanned_at ?? null,
    scanned_by: over.scanned_by ?? null,
  };
}

// ————————————————————————————————————————————————————————————————
// extractPassToken — n'accepte QUE le jeton brut opaque ; rejette URL, vide, forme invalide.
// ————————————————————————————————————————————————————————————————

test("extractPassToken accepte un jeton hexadécimal brut", () => {
  assert.equal(extractPassToken(REAL_TOKEN), REAL_TOKEN);
});

test("extractPassToken trim et met en minuscules", () => {
  assert.equal(extractPassToken(`  ${REAL_TOKEN.toUpperCase()}  `), REAL_TOKEN);
});

test("extractPassToken rejette une URL (QR d'invitation, pas un pass d'entrée)", () => {
  assert.equal(extractPassToken(`https://club.example/i/${REAL_TOKEN}`), null);
  assert.equal(extractPassToken(`/i/${REAL_TOKEN}`), null);
});

test("extractPassToken rejette vide, null, espaces", () => {
  assert.equal(extractPassToken(""), null);
  assert.equal(extractPassToken("   "), null);
  assert.equal(extractPassToken(null), null);
  assert.equal(extractPassToken(undefined), null);
});

test("extractPassToken rejette une forme non hexadécimale ou trop courte", () => {
  assert.equal(extractPassToken("pas-un-token"), null);
  assert.equal(extractPassToken("xyz123"), null); // trop court + z hors hex
  assert.equal(extractPassToken("g".repeat(64)), null); // g n'est pas hex
});

// ————————————————————————————————————————————————————————————————
// interpretScanResult — feedback honnête, jamais de faux succès.
// ————————————————————————————————————————————————————————————————

test("interpretScanResult ok → admis, ton ok, prénom + salle", () => {
  const fb = interpretScanResult(res({ code: "ok", first_name: "Sofia", univers: "eden" }));
  assert.equal(fb.tone, "ok");
  assert.equal(fb.admitted, true);
  assert.match(fb.title, /Sofia/);
  assert.match(fb.detail, /EDEN/);
});

test("interpretScanResult already_scanned → admis mais ton warn (déjà entré)", () => {
  const fb = interpretScanResult(res({ ok: true, code: "already_scanned", first_name: "Léo" }));
  assert.equal(fb.tone, "warn");
  assert.equal(fb.admitted, true);
  assert.match(fb.title, /déjà entré/i);
});

test("interpretScanResult marque l'hôte de table", () => {
  const fb = interpretScanResult(res({ code: "ok", is_host: true }));
  assert.match(fb.detail, /HÔTE/);
});

test("interpretScanResult wrong_event → refus dur, non admis", () => {
  const fb = interpretScanResult(res({ ok: false, code: "wrong_event", first_name: "Max" }));
  assert.equal(fb.tone, "error");
  assert.equal(fb.admitted, false);
  assert.match(fb.detail, /soirée/i);
});

test("interpretScanResult unknown_pass / pass_cancelled / unauthorized → refus non admis", () => {
  for (const code of ["unknown_pass", "pass_cancelled", "unauthorized", "missing_active_event", "invalid_token"]) {
    const fb = interpretScanResult(res({ ok: false, code }));
    assert.equal(fb.admitted, false, `${code} ne doit jamais admettre`);
    assert.equal(fb.tone, "error", `${code} doit être une erreur`);
  }
});

test("interpretScanResult code inconnu ET ok=false → refus (jamais un faux succès)", () => {
  const fb = interpretScanResult(res({ ok: false, code: "some_new_code", message: "boom" }));
  assert.equal(fb.admitted, false);
  assert.equal(fb.tone, "error");
  assert.equal(fb.detail, "boom");
});

// ————————————————————————————————————————————————————————————————
// normalizeScanResponse — tableau/objet/erreur → ScanPassResult, aucune donnée fabriquée.
// ————————————————————————————————————————————————————————————————

test("normalizeScanResponse déballe un tableau (retour SETOF de la RPC)", () => {
  const row = res({ code: "ok", first_name: "Ana" });
  const out = normalizeScanResponse({ data: [row], error: null });
  assert.equal(out.code, "ok");
  assert.equal(out.first_name, "Ana");
});

test("normalizeScanResponse gère un objet simple", () => {
  const out = normalizeScanResponse({ data: res({ code: "ok" }), error: null });
  assert.equal(out.ok, true);
});

test("normalizeScanResponse transforme une erreur réseau en code explicite", () => {
  const out = normalizeScanResponse({ data: null, error: { message: "timeout" } });
  assert.equal(out.ok, false);
  assert.equal(out.code, "network_error");
  assert.match(out.message, /timeout/);
});

test("normalizeScanResponse data vide → network_error (jamais un succès fabriqué)", () => {
  const out = normalizeScanResponse({ data: null, error: null });
  assert.equal(out.ok, false);
  assert.equal(out.code, "network_error");
});

// ————————————————————————————————————————————————————————————————
// Invariant de rôles porte (miroir de la garde SQL 0015 + canCheckInQr).
// ————————————————————————————————————————————————————————————————

test("DOOR_SCAN_ROLES = les rôles porte, sans promoteur ni serveur", () => {
  assert.deepEqual([...DOOR_SCAN_ROLES], ["admin", "manager", "security", "security_counter"]);
  assert.equal(DOOR_SCAN_ROLES.includes("promoter" as never), false);
  assert.equal(DOOR_SCAN_ROLES.includes("server" as never), false);
});
