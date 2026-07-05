// tests/budget.test.mts — logique pure du module Budget prévu/réel (lib/budget.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageBudget,
  canViewBudget,
  validateForecastDraft,
  budgetSummary,
  variance,
  formatEuro,
  formatVariance,
  BUDGET_POSTES,
  type BudgetForecast,
} from "../lib/budget.ts";

const forecasts: BudgetForecast[] = [
  { id: "1", label: "DJ résident février", poste: "artistes", montant_prevu_cents: 200000 },
  { id: "2", label: "Tête d'affiche", poste: "artistes", montant_prevu_cents: 500000 },
  { id: "3", label: "Salaires équipe", poste: "personnel", montant_prevu_cents: 350000 },
  { id: "4", label: "Campagne insta", poste: "publicite", montant_prevu_cents: 80000 },
];

test("gardes de rôle : direction gère ET consulte, tout autre rôle exclu", () => {
  assert.equal(canManageBudget("admin"), true);
  assert.equal(canManageBudget("manager"), true);
  assert.equal(canManageBudget("server"), false);
  assert.equal(canManageBudget("promoter"), false);
  // Lecture aussi réservée à la direction (RLS 0051 direction-only).
  assert.equal(canViewBudget("admin"), true);
  assert.equal(canViewBudget("server"), false);
  assert.equal(canViewBudget("security"), false);
  assert.equal(canViewBudget("promoter"), false);
});

test("validateForecastDraft", () => {
  assert.equal(validateForecastDraft({ label: "" }).ok, false);
  assert.equal(validateForecastDraft({ label: "x", poste: "inconnu" }).ok, false);
  assert.equal(validateForecastDraft({ label: "x", montant_prevu_euros: null }).ok, false);
  assert.equal(validateForecastDraft({ label: "x", montant_prevu_euros: -5 }).ok, false);
  assert.equal(validateForecastDraft({ label: "DJ", poste: "artistes", montant_prevu_euros: 2000 }).ok, true);
});

test("budgetSummary : total prévu + ventilation par poste renseigné, ordre stable", () => {
  const s = budgetSummary(forecasts);
  assert.equal(s.lignes, 4);
  assert.equal(s.totalPrevuCents, 200000 + 500000 + 350000 + 80000);
  // Seuls les postes ayant des lignes apparaissent, dans l'ordre de BUDGET_POSTES.
  assert.deepEqual(s.parPoste.map((p) => p.poste), ["artistes", "personnel", "publicite"]);
  const artistes = s.parPoste.find((p) => p.poste === "artistes")!;
  assert.equal(artistes.totalPrevuCents, 700000);
  assert.equal(artistes.lignes, 2);
});

test("budgetSummary : poste hors vocabulaire rabattu sur 'autre', pas de crash", () => {
  const s = budgetSummary([{ id: "z", label: "?", poste: "xyz", montant_prevu_cents: 1000 }]);
  assert.deepEqual(s.parPoste.map((p) => p.poste), ["autre"]);
  assert.equal(s.totalPrevuCents, 1000);
});

test("variance : réel ABSENT = NON RENSEIGNÉ (jamais 0), jamais présenté comme comptable réel", () => {
  const vNull = variance(200000, null);
  assert.equal(vNull.ecartCents, null);
  assert.equal(vNull.tag, "NON RENSEIGNÉ");
  const vUndef = variance(200000, undefined);
  assert.equal(vUndef.tag, "NON RENSEIGNÉ");
  const vNaN = variance(200000, Number.NaN);
  assert.equal(vNaN.tag, "NON RENSEIGNÉ");
});

test("variance : réel FOURNI = écart chiffré signé (reel - prevu)", () => {
  const depassement = variance(200000, 250000);
  assert.equal(depassement.ecartCents, 50000);
  assert.equal(depassement.tag, 50000);
  const economie = variance(200000, 180000);
  assert.equal(economie.ecartCents, -20000);
  assert.equal(economie.tag, -20000);
});

test("formatEuro : valeur inconnue = tiret, jamais 0 € inventé", () => {
  assert.equal(formatEuro(null), "—");
  assert.equal(formatEuro(undefined), "—");
  assert.equal(formatEuro(Number.NaN), "—");
  assert.match(formatEuro(200000), /2\s?000/);
});

test("formatVariance : NON RENSEIGNÉ tant que le réel n'est pas connu ; signe explicite sinon", () => {
  assert.equal(formatVariance(variance(200000, null)), "NON RENSEIGNÉ");
  assert.match(formatVariance(variance(200000, 250000)), /^\+/); // dépassement
  assert.match(formatVariance(variance(200000, 180000)), /−|-/); // économie (signe négatif)
});

test("BUDGET_POSTES : vocabulaire fermé attendu", () => {
  assert.deepEqual([...BUDGET_POSTES], [
    "ca_tables",
    "artistes",
    "personnel",
    "publicite",
    "achats",
    "maintenance",
    "pertes",
    "autre",
  ]);
});
