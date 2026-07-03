import assert from "node:assert/strict";
import test from "node:test";

import {
  isoMonthKey,
  isIsoDate,
  distinctMonths,
  applyPeriodChoice,
  isChoiceStale,
  normalizeChoice,
  monthLabelFr,
  dateLabelFr,
  periodChoiceLabel,
  WINDOW_CHOICE,
  type PeriodChoice,
} from "../lib/periodSelection.ts";

// ————————————————————————————————————————————————————————————————
// isoMonthKey — YYYY-MM ou "" (illisible / vide)
// ————————————————————————————————————————————————————————————————
test("isoMonthKey extrait YYYY-MM d'une date ISO", () => {
  assert.equal(isoMonthKey("2026-07-03"), "2026-07");
  assert.equal(isoMonthKey("2025-12-31"), "2025-12");
});

test("isoMonthKey renvoie \"\" pour une date illisible/absente (aucun mois inventé)", () => {
  assert.equal(isoMonthKey(""), "");
  assert.equal(isoMonthKey(null), "");
  assert.equal(isoMonthKey(undefined), "");
  assert.equal(isoMonthKey("03/07/2026"), "");
  assert.equal(isoMonthKey("2026-7-3"), "");
});

// ————————————————————————————————————————————————————————————————
// distinctMonths — mois réels, triés récent d'abord, illisibles ignorés
// ————————————————————————————————————————————————————————————————
test("distinctMonths dédoublonne et trie décroissant (récent d'abord)", () => {
  const months = distinctMonths([
    "2026-07-03",
    "2026-07-01",
    "2025-12-20",
    "2026-01-05",
  ]);
  assert.deepEqual(months, ["2026-07", "2025-12", "2026-01"].sort().reverse());
  assert.deepEqual(months, ["2026-07", "2026-01", "2025-12"]);
});

test("distinctMonths ignore les dates illisibles/vides (aucun mois « inconnu »)", () => {
  assert.deepEqual(distinctMonths([]), []);
  assert.deepEqual(distinctMonths(["", null, undefined, "bad"]), []);
  assert.deepEqual(distinctMonths(["2026-07-03", "bad", null]), ["2026-07"]);
});

// ————————————————————————————————————————————————————————————————
// applyPeriodChoice — window = tout, month = restreint (PURE)
// ————————————————————————————————————————————————————————————————
type Row = { d: string; v: number };
const ROWS: Row[] = [
  { d: "2026-07-03", v: 1 },
  { d: "2026-07-28", v: 2 },
  { d: "2026-06-15", v: 3 },
  { d: "bad", v: 4 },
];

test("applyPeriodChoice window renvoie la liste entière (aucun filtrage)", () => {
  const out = applyPeriodChoice(ROWS, (r) => r.d, WINDOW_CHOICE);
  assert.equal(out.length, 4);
  assert.deepEqual(out, ROWS);
});

test("applyPeriodChoice month ne garde que le mois choisi", () => {
  const out = applyPeriodChoice(ROWS, (r) => r.d, { kind: "month", month: "2026-07" });
  assert.deepEqual(
    out.map((r) => r.v),
    [1, 2],
  );
});

test("applyPeriodChoice month sur un mois absent → liste vide (jamais fabriquée)", () => {
  const out = applyPeriodChoice(ROWS, (r) => r.d, { kind: "month", month: "2026-01" });
  assert.deepEqual(out, []);
});

test("applyPeriodChoice ne modifie pas la liste source (pureté)", () => {
  const copy = [...ROWS];
  applyPeriodChoice(ROWS, (r) => r.d, { kind: "month", month: "2026-07" });
  assert.deepEqual(ROWS, copy);
});

// ————————————————————————————————————————————————————————————————
// isChoiceStale / normalizeChoice — retomber proprement sur la fenêtre
// ————————————————————————————————————————————————————————————————
test("isChoiceStale : window jamais périmé ; month périmé si absent des options", () => {
  const months = ["2026-07", "2026-06"];
  assert.equal(isChoiceStale(WINDOW_CHOICE, months), false);
  assert.equal(isChoiceStale({ kind: "month", month: "2026-07" }, months), false);
  assert.equal(isChoiceStale({ kind: "month", month: "2025-01" }, months), true);
});

test("normalizeChoice ramène un mois disparu à la fenêtre entière", () => {
  const months = ["2026-07"];
  const stale: PeriodChoice = { kind: "month", month: "2025-01" };
  assert.deepEqual(normalizeChoice(stale, months), WINDOW_CHOICE);
  const valid: PeriodChoice = { kind: "month", month: "2026-07" };
  assert.deepEqual(normalizeChoice(valid, months), valid);
  assert.deepEqual(normalizeChoice(WINDOW_CHOICE, months), WINDOW_CHOICE);
});

// ————————————————————————————————————————————————————————————————
// Libellés déterministes (aucune dépendance fuseau/locale)
// ————————————————————————————————————————————————————————————————
test("monthLabelFr formate en français ; illisible → clé brute", () => {
  assert.equal(monthLabelFr("2026-07"), "juillet 2026");
  assert.equal(monthLabelFr("2025-12"), "décembre 2025");
  assert.equal(monthLabelFr("2026-01"), "janvier 2026");
  assert.equal(monthLabelFr("bad"), "bad");
  assert.equal(monthLabelFr("2026-13"), "2026-13");
});

test("periodChoiceLabel décrit la fenêtre ou le mois choisi", () => {
  assert.equal(periodChoiceLabel(WINDOW_CHOICE, 120), "les 120 derniers jours (fenêtre glissante)");
  assert.equal(periodChoiceLabel({ kind: "month", month: "2026-07" }, 120), "juillet 2026");
});

// ————————————————————————————————————————————————————————————————
// isIsoDate — borne de plage lisible ou non
// ————————————————————————————————————————————————————————————————
test("isIsoDate reconnaît une date ISO complète, rejette le reste", () => {
  assert.equal(isIsoDate("2026-07-03"), true);
  assert.equal(isIsoDate("2026-07"), false);
  assert.equal(isIsoDate("2026-7-3"), false);
  assert.equal(isIsoDate(""), false);
  assert.equal(isIsoDate(null), false);
  assert.equal(isIsoDate(undefined), false);
});

// ————————————————————————————————————————————————————————————————
// applyPeriodChoice range — plage [from, to] inclus (PURE)
// ————————————————————————————————————————————————————————————————
test("applyPeriodChoice range ne garde que les dates dans [from, to] inclus", () => {
  const out = applyPeriodChoice(ROWS, (r) => r.d, { kind: "range", from: "2026-07-03", to: "2026-07-28" });
  assert.deepEqual(
    out.map((r) => r.v),
    [1, 2],
  );
});

test("applyPeriodChoice range inclut les bornes exactes", () => {
  const out = applyPeriodChoice(ROWS, (r) => r.d, { kind: "range", from: "2026-06-15", to: "2026-07-03" });
  assert.deepEqual(
    out.map((r) => r.v),
    [1, 3],
  );
});

test("applyPeriodChoice range tolère des bornes inversées (du 28 au 3 = du 3 au 28)", () => {
  const out = applyPeriodChoice(ROWS, (r) => r.d, { kind: "range", from: "2026-07-28", to: "2026-07-03" });
  assert.deepEqual(
    out.map((r) => r.v),
    [1, 2],
  );
});

test("applyPeriodChoice range aux bornes incomplètes → liste entière (aucun vide fabriqué)", () => {
  assert.deepEqual(applyPeriodChoice(ROWS, (r) => r.d, { kind: "range", from: "", to: "2026-07-28" }), ROWS);
  assert.deepEqual(applyPeriodChoice(ROWS, (r) => r.d, { kind: "range", from: "2026-07-03", to: "" }), ROWS);
  assert.deepEqual(applyPeriodChoice(ROWS, (r) => r.d, { kind: "range", from: "", to: "" }), ROWS);
});

test("applyPeriodChoice range ignore les dates illisibles (jamais dans la plage)", () => {
  const out = applyPeriodChoice(ROWS, (r) => r.d, { kind: "range", from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(
    out.map((r) => r.v),
    [1, 2, 3], // "bad" (v:4) exclu
  );
});

// ————————————————————————————————————————————————————————————————
// isChoiceStale / normalizeChoice — range
// ————————————————————————————————————————————————————————————————
test("isChoiceStale : range périmé tant qu'une borne manque, sinon valide", () => {
  const months = ["2026-07"];
  assert.equal(isChoiceStale({ kind: "range", from: "2026-07-01", to: "2026-07-31" }, months), false);
  assert.equal(isChoiceStale({ kind: "range", from: "", to: "2026-07-31" }, months), true);
  assert.equal(isChoiceStale({ kind: "range", from: "2026-07-01", to: "" }, months), true);
});

test("normalizeChoice : range incomplète → fenêtre ; bornes inversées réordonnées", () => {
  const months = ["2026-07"];
  assert.deepEqual(normalizeChoice({ kind: "range", from: "", to: "2026-07-31" }, months), WINDOW_CHOICE);
  assert.deepEqual(
    normalizeChoice({ kind: "range", from: "2026-07-28", to: "2026-07-03" }, months),
    { kind: "range", from: "2026-07-03", to: "2026-07-28" },
  );
  const already: PeriodChoice = { kind: "range", from: "2026-07-03", to: "2026-07-28" };
  assert.deepEqual(normalizeChoice(already, months), already);
});

// ————————————————————————————————————————————————————————————————
// dateLabelFr / periodChoiceLabel range — libellés déterministes
// ————————————————————————————————————————————————————————————————
test("dateLabelFr formate en français sans zéro de tête ; illisible → brut", () => {
  assert.equal(dateLabelFr("2026-07-03"), "3 juillet 2026");
  assert.equal(dateLabelFr("2025-12-31"), "31 décembre 2025");
  assert.equal(dateLabelFr("2026-07"), "2026-07");
  assert.equal(dateLabelFr("bad"), "bad");
});

test("periodChoiceLabel décrit une plage (bornes ordonnées)", () => {
  assert.equal(
    periodChoiceLabel({ kind: "range", from: "2026-07-03", to: "2026-07-28" }, 120),
    "du 3 juillet 2026 au 28 juillet 2026",
  );
  assert.equal(
    periodChoiceLabel({ kind: "range", from: "2026-07-28", to: "2026-07-03" }, 120),
    "du 3 juillet 2026 au 28 juillet 2026",
  );
});
