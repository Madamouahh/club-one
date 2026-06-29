import assert from "node:assert/strict";
import test from "node:test";

import {
  addExpenseMessage,
  buildAddExpenseArgs,
  buildCheckInArgs,
  checkInMessage,
  normalizeAddExpenseResponse,
  normalizeCheckInResponse,
} from "../lib/atomicOperations.ts";

test("depense: construit les arguments RPC pour add_expense_v2", () => {
  const built = buildAddExpenseArgs({
    tableId: "A1",
    label: "Bouteille",
    amount: "120",
    dateKey: "2026-06-29",
  });

  assert.equal(built.ok, true);
  assert.deepEqual(built.args, {
    p_table_id: "A1",
    p_label: "Bouteille",
    p_amount: 120,
    p_date_key: "2026-06-29",
  });
});

test("depense: accepte un montant valide", () => {
  assert.equal(buildAddExpenseArgs({ tableId: "A1", label: "Soft", amount: 1, dateKey: "2026-06-29" }).ok, true);
});

test("depense: refuse montant nul et negatif cote client", () => {
  const zero = buildAddExpenseArgs({ tableId: "A1", label: "Zero", amount: 0, dateKey: "2026-06-29" });
  const negative = buildAddExpenseArgs({ tableId: "A1", label: "Negatif", amount: -1, dateKey: "2026-06-29" });

  assert.equal(zero.ok, false);
  assert.equal(negative.ok, false);
  assert.equal(zero.message, "Montant invalide.");
});

test("depense: remonte table inexistante ou non autorisee", () => {
  const result = normalizeAddExpenseResponse({
    data: [{
      ok: false,
      code: "table_not_found_or_forbidden",
      message: "Table introuvable ou action non autorisee.",
      table_id: "BAD",
    }],
    error: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "table_not_found_or_forbidden");
  assert.equal(addExpenseMessage(result), "Table introuvable ou action non autorisee.");
});

test("depense: remonte une reponse non autorisee", () => {
  const result = normalizeAddExpenseResponse({
    data: [{ ok: false, code: "unauthorized", message: "Utilisateur non autorise." }],
    error: null,
  });

  assert.equal(result.ok, false);
  assert.equal(addExpenseMessage(result), "Utilisateur non autorise.");
});

test("depense: remonte auteur retourne dans le JSON sans casser le format", () => {
  const result = normalizeAddExpenseResponse({
    data: [{
      ok: true,
      code: "ok",
      table_id: "A1",
      expense: {
        id: "e1",
        label: "Bouteille",
        amount: 120,
        createdAt: "23:45",
        dateKey: "2026-06-29",
        createdBy: "maxime",
      },
    }],
    error: null,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.expense, {
    id: "e1",
    label: "Bouteille",
    amount: 120,
    createdAt: "23:45",
    dateKey: "2026-06-29",
    createdBy: "maxime",
  });
});

test("depense: deux appels concurrents simules restent deux succes distincts", () => {
  const first = normalizeAddExpenseResponse({
    data: [{ ok: true, code: "ok", table_id: "A1", expense: { id: "e1", amount: 100 } }],
    error: null,
  });
  const second = normalizeAddExpenseResponse({
    data: [{ ok: true, code: "ok", table_id: "A1", expense: { id: "e2", amount: 200 } }],
    error: null,
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notDeepEqual(first.expense, second.expense);
});

test("QR: premier scan valide", () => {
  const result = normalizeCheckInResponse({
    data: [{
      ok: true,
      code: "checked_in",
      guest_name: "Client Test",
      promoter_username: "mathias",
      event_date: "2026-06-29",
    }],
    error: null,
  });

  assert.equal(result.ok, true);
  assert.equal(checkInMessage(result), "Entree validee : Client Test - mathias");
});

test("QR: deuxieme scan refuse", () => {
  const result = normalizeCheckInResponse({
    data: [{
      ok: false,
      code: "already_used",
      message: "QR deja utilise.",
      guest_name: "Client Test",
      promoter_username: "mathias",
      event_date: "2026-06-29",
    }],
    error: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "already_used");
  assert.equal(checkInMessage(result), "QR deja utilise. Client Test.");
});

test("QR: checked_in NULL est accepte une seule fois par la RPC", () => {
  const first = normalizeCheckInResponse({ data: [{ ok: true, code: "checked_in" }], error: null });
  const second = normalizeCheckInResponse({ data: [{ ok: false, code: "already_used", message: "QR deja utilise." }], error: null });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
});

test("QR: construit les arguments RPC et refuse token vide", () => {
  const valid = buildCheckInArgs({ token: "mathias-token", eventDate: "2026-06-29" });
  const empty = buildCheckInArgs({ token: "   ", eventDate: "2026-06-29" });

  assert.equal(valid.ok, true);
  assert.deepEqual(valid.args, { p_token: "mathias-token", p_event_date: "2026-06-29" });
  assert.equal(empty.ok, false);
  assert.equal(empty.message, "QR vide ou invalide.");
});

test("QR: token inconnu et mauvaise date", () => {
  const unknown = normalizeCheckInResponse({
    data: [{ ok: false, code: "unknown_token", message: "QR introuvable ou invalide." }],
    error: null,
  });
  const wrongDate = normalizeCheckInResponse({
    data: [{ ok: false, code: "wrong_date", message: "QR valide mais pas pour cette soiree.", event_date: "2026-06-28" }],
    error: null,
  });

  assert.equal(checkInMessage(unknown), "QR introuvable ou invalide.");
  assert.equal(checkInMessage(wrongDate), "QR valide mais pas pour cette soiree. (2026-06-28).");
});

test("QR: role promoteur refuse et role securite autorise par reponses RPC", () => {
  const promoter = normalizeCheckInResponse({
    data: [{ ok: false, code: "unauthorized", message: "Utilisateur non autorise." }],
    error: null,
  });
  const security = normalizeCheckInResponse({
    data: [{ ok: true, code: "checked_in", guest_name: "Client Test", promoter_username: "mathias" }],
    error: null,
  });

  assert.equal(promoter.ok, false);
  assert.equal(checkInMessage(promoter), "Utilisateur non autorise.");
  assert.equal(security.ok, true);
});

test("QR: reponse reseau invalide", () => {
  const network = normalizeCheckInResponse({
    data: null,
    error: { message: "fetch failed" },
  });

  assert.equal(network.ok, false);
  assert.equal(network.code, "network_error");
  assert.equal(checkInMessage(network), "fetch failed");
});
