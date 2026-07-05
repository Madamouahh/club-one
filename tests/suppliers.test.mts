// tests/suppliers.test.mts — logique pure du module Fournisseurs/Achats (lib/suppliers.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManagePurchasing,
  canViewPurchasing,
  orderTotalFromLines,
  ordersSummary,
  purchasingCostForEvent,
  validateSupplierDraft,
  validateOrderDraft,
  formatCostEuro,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "../lib/suppliers.ts";

const orders: PurchaseOrder[] = [
  { id: "o1", supplier_id: "metro", status: "brouillon", total_cents: 10000 },
  { id: "o2", supplier_id: "metro", status: "envoyee", total_cents: 45000, event_id: "ev1" },
  { id: "o3", supplier_id: "pro", status: "recue", total_cents: 20000, event_id: "ev1" },
  { id: "o4", supplier_id: "pro", status: "annulee", total_cents: 99999 },
  { id: "o5", supplier_id: "metro", status: "envoyee", total_cents: null }, // engagée sans total connu
];
const lines: PurchaseOrderLine[] = [
  { id: "l1", order_id: "o2", designation: "Champagne", qty: 6, unit_price_cents: 3000 },
  { id: "l2", order_id: "o2", designation: "Vodka", qty: 3, unit_price_cents: 1500 },
  { id: "l3", order_id: "o2", designation: "Verres (offert)", qty: 100, unit_price_cents: null }, // coût inconnu, ignoré
  { id: "l4", order_id: "o3", designation: "Softs", qty: 24, unit_price_cents: 100 },
];

test("gardes de rôle : direction gère, staff-op consulte, promoteur exclu", () => {
  assert.equal(canManagePurchasing("admin"), true);
  assert.equal(canManagePurchasing("manager"), true);
  assert.equal(canManagePurchasing("server"), false);
  assert.equal(canViewPurchasing("server"), true);
  assert.equal(canViewPurchasing("promoter"), false);
});

test("orderTotalFromLines = somme qty × prix unitaire, coût connu seulement", () => {
  assert.equal(orderTotalFromLines("o2", lines), 6 * 3000 + 3 * 1500); // verres offerts ignorés
  assert.equal(orderTotalFromLines("o3", lines), 24 * 100);
  assert.equal(orderTotalFromLines("inconnu", lines), 0);
});

test("ordersSummary : total, ventilation par statut, engagé (envoyée+reçue, total connu)", () => {
  const s = ordersSummary(orders);
  assert.equal(s.total, 5);
  assert.equal(s.parStatut.brouillon, 1);
  assert.equal(s.parStatut.envoyee, 2);
  assert.equal(s.parStatut.recue, 1);
  assert.equal(s.parStatut.annulee, 1);
  // engagé = o2 45000 + o3 20000 (o1 brouillon, o4 annulée, o5 total null : exclus)
  assert.equal(s.engageCents, 45000 + 20000);
});

test("purchasingCostForEvent : commandes engagées imputées, total connu seulement", () => {
  // ev1 : o2 (envoyee 45000) + o3 (recue 20000)
  assert.equal(purchasingCostForEvent(orders, "ev1"), 45000 + 20000);
  assert.equal(purchasingCostForEvent(orders, "ev-inconnu"), 0);
});

test("validateSupplierDraft", () => {
  assert.equal(validateSupplierDraft({ name: "" }).ok, false);
  assert.equal(validateSupplierDraft({ name: "Metro", category: "x" }).ok, false);
  assert.equal(validateSupplierDraft({ name: "Metro", category: "boissons" }).ok, true);
});

test("validateOrderDraft", () => {
  assert.equal(validateOrderDraft({ supplier_id: "" }).ok, false);
  assert.equal(validateOrderDraft({ supplier_id: "metro", status: "x" }).ok, false);
  assert.equal(validateOrderDraft({ supplier_id: "metro", total_cents: -5 }).ok, false);
  assert.equal(validateOrderDraft({ supplier_id: "metro", status: "envoyee", total_cents: 45000 }).ok, true);
  assert.equal(validateOrderDraft({ supplier_id: "metro" }).ok, true); // total facultatif
});

test("formatCostEuro : coût inconnu = tiret", () => {
  assert.equal(formatCostEuro(null), "—");
  assert.match(formatCostEuro(45000), /450/);
});
