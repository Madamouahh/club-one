// tests/stock.test.mts — logique pure du module Stock (lib/stock.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageStock,
  canViewStock,
  signedQty,
  theoreticalStock,
  itemsWithStock,
  stockSummary,
  lossCostForEvent,
  validateMovementDraft,
  formatCostEuro,
  type StockItem,
  type StockMovement,
} from "../lib/stock.ts";

const items: StockItem[] = [
  { id: "vodka", name: "Vodka", family: "spiritueux", unit: "bouteille", par_level: 5, unit_cost_cents: 1500 },
  { id: "coca", name: "Coca", family: "soft", unit: "bouteille", par_level: 10, unit_cost_cents: 100 },
  { id: "olive", name: "Olives", family: "consommable", unit: "kg", par_level: null, unit_cost_cents: null },
];
const movements: StockMovement[] = [
  { id: "1", item_id: "vodka", kind: "entree", qty: 12 },
  { id: "2", item_id: "vodka", kind: "sortie", qty: -9 }, // stock vodka = 3 (< par 5)
  { id: "3", item_id: "coca", kind: "entree", qty: 24 },
  { id: "4", item_id: "coca", kind: "perte", qty: -2, event_id: "ev1" },
  { id: "5", item_id: "vodka", kind: "casse", qty: -1, event_id: "ev1" }, // vodka = 2
];

test("gardes de rôle : direction gère, staff-op consulte, promoteur exclu", () => {
  assert.equal(canManageStock("admin"), true);
  assert.equal(canManageStock("server"), false);
  assert.equal(canViewStock("server"), true);
  assert.equal(canViewStock("promoter"), false);
});

test("signedQty : entree +, sortie/perte/casse −, ajustement/inventaire tels quels", () => {
  assert.equal(signedQty("entree", 5), 5);
  assert.equal(signedQty("sortie", 5), -5);
  assert.equal(signedQty("perte", 3), -3);
  assert.equal(signedQty("casse", 2), -2);
  assert.equal(signedQty("ajustement", -4), -4);
  assert.equal(signedQty("inventaire", 20), 20);
});

test("theoreticalStock = somme des mouvements signés", () => {
  assert.equal(theoreticalStock("vodka", movements), 2); // 12 -9 -1
  assert.equal(theoreticalStock("coca", movements), 22); // 24 -2
  assert.equal(theoreticalStock("olive", movements), 0);
});

test("itemsWithStock : rupture + sous-seuil calculés", () => {
  const e = itemsWithStock(items, movements);
  const vodka = e.find((i) => i.id === "vodka")!;
  assert.equal(vodka.stock, 2);
  assert.equal(vodka.belowPar, true); // 2 <= 5
  assert.equal(vodka.rupture, false); // 2 > 0
  const olive = e.find((i) => i.id === "olive")!;
  assert.equal(olive.rupture, true); // 0 <= 0
  assert.equal(olive.belowPar, false); // pas de seuil
});

test("stockSummary : articles, sous-seuil, ruptures, valeur (coût connu seulement)", () => {
  const s = stockSummary(items, movements);
  assert.equal(s.totalArticles, 3);
  assert.equal(s.ruptures, 1); // olive
  assert.equal(s.sousSeuil, 1); // vodka
  // valeur = vodka 2×1500 + coca 22×100 (olive sans coût non valorisée)
  assert.equal(s.valeurStockCents, 2 * 1500 + 22 * 100);
});

test("lossCostForEvent : perte+casse imputées à la soirée, coût connu seulement", () => {
  // ev1 : coca perte 2×100 + vodka casse 1×1500 = 200 + 1500
  assert.equal(lossCostForEvent(items, movements, "ev1"), 2 * 100 + 1 * 1500);
  assert.equal(lossCostForEvent(items, movements, "ev-inconnu"), 0);
});

test("validateMovementDraft", () => {
  assert.equal(validateMovementDraft({ item_id: "" }).ok, false);
  assert.equal(validateMovementDraft({ item_id: "vodka", kind: "x" }).ok, false);
  assert.equal(validateMovementDraft({ item_id: "vodka", qty: 0 }).ok, false);
  assert.equal(validateMovementDraft({ item_id: "vodka", kind: "entree", qty: 6 }).ok, true);
});

test("formatCostEuro : coût inconnu = tiret", () => {
  assert.equal(formatCostEuro(null), "—");
  assert.match(formatCostEuro(1500), /15/);
});
