import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePassStatusAtClose,
  resolveVisitStatusAtClose,
  VISIT_STATUSES_PENDING_AT_CLOSE,
  type PassStatus,
  type VisitStatus,
} from "../lib/crmClose.ts";

// ————————————————————————————————————————————————————————————————
// resolveVisitStatusAtClose — booked/confirmed -> no_show ; le reste inchangé.
// ————————————————————————————————————————————————————————————————

test("une visite booked jamais scannée devient no_show à la clôture", () => {
  assert.equal(resolveVisitStatusAtClose("booked"), "no_show");
});

test("une visite confirmed (J-1) jamais scannée devient no_show à la clôture", () => {
  assert.equal(resolveVisitStatusAtClose("confirmed"), "no_show");
});

test("une présence constatée (seated) N'EST JAMAIS réécrite en no_show", () => {
  assert.equal(resolveVisitStatusAtClose("seated"), "seated");
});

test("un no_show déjà résolu reste no_show (idempotent)", () => {
  assert.equal(resolveVisitStatusAtClose("no_show"), "no_show");
});

test("une désinscription (cancelled) reste cancelled — pas transformée en no_show", () => {
  assert.equal(resolveVisitStatusAtClose("cancelled"), "cancelled");
});

test("seuls booked et confirmed sont les états en attente à la clôture", () => {
  // Garde anti-dérive : la liste doit rester le miroir EXACT du IN (...) de 0016.
  assert.deepEqual([...VISIT_STATUSES_PENDING_AT_CLOSE], ["booked", "confirmed"]);
  // Tout statut hors de cette liste doit être un point fixe.
  const allStatuses: VisitStatus[] = ["booked", "confirmed", "seated", "no_show", "cancelled"];
  for (const s of allStatuses) {
    const flips = (VISIT_STATUSES_PENDING_AT_CLOSE as readonly string[]).includes(s);
    assert.equal(resolveVisitStatusAtClose(s), flips ? "no_show" : s);
  }
});

// ————————————————————————————————————————————————————————————————
// resolvePassStatusAtClose — issued -> expired ; le reste inchangé.
// ————————————————————————————————————————————————————————————————

test("un pass issued jamais scanné devient expired à la clôture", () => {
  assert.equal(resolvePassStatusAtClose("issued"), "expired");
});

test("un pass scanned (présence faite) reste scanned", () => {
  assert.equal(resolvePassStatusAtClose("scanned"), "scanned");
});

test("un pass déjà expired reste expired (idempotent)", () => {
  assert.equal(resolvePassStatusAtClose("expired"), "expired");
});

test("un pass cancelled reste cancelled", () => {
  assert.equal(resolvePassStatusAtClose("cancelled"), "cancelled");
});

test("seul issued bascule ; tout autre statut de pass est un point fixe", () => {
  const allStatuses: PassStatus[] = ["issued", "scanned", "expired", "cancelled"];
  for (const s of allStatuses) {
    assert.equal(resolvePassStatusAtClose(s), s === "issued" ? "expired" : s);
  }
});
