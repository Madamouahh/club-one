// lib/suppliers.ts — logique métier PURE du module Fournisseurs/Achats (0048). 100% testable.
// Total d'une commande = somme des lignes (qty × prix unitaire), sinon total forfaitaire saisi.
// Aucun adaptateur paiement/facture/email : préparé mais NON ACTIVÉ (aucune donnée inventée).

import type { StaffRole } from "./permissions.ts";

export const SUPPLIER_CATEGORIES = ["boissons", "alimentaire", "technique", "securite", "general"] as const;
export const ORDER_STATUSES = ["brouillon", "envoyee", "recue", "annulee"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Supplier = {
  id: string;
  name: string;
  category: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
};
export type PurchaseOrder = {
  id: string;
  supplier_id: string;
  status: string;
  label?: string | null;
  total_cents?: number | null;
  event_id?: string | null;
  expected_date?: string | null;
  received_date?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};
export type PurchaseOrderLine = {
  id: string;
  order_id: string;
  designation: string;
  qty: number;
  unit_price_cents?: number | null;
  created_at?: string | null;
};

export function canManagePurchasing(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}
export function canViewPurchasing(role: StaffRole): boolean {
  return role !== "promoter";
}

// Total d'une commande à partir de ses lignes (qty × prix unitaire connu seulement).
export function orderTotalFromLines(orderId: string, lines: PurchaseOrderLine[]): number {
  return lines
    .filter((l) => l.order_id === orderId)
    .reduce((s, l) => {
      const p = l.unit_price_cents;
      return p != null ? s + Math.max(0, Number(l.qty) || 0) * p : s;
    }, 0);
}

export type OrdersSummary = {
  total: number;
  parStatut: Record<OrderStatus, number>;
  engageCents: number; // total engagé = commandes envoyées + reçues (ni brouillon ni annulée), coûts connus
};

// Une commande n'engage la dépense qu'une fois envoyée ou reçue (brouillon = pas engagé, annulée = annulé).
const ENGAGED_STATUSES: OrderStatus[] = ["envoyee", "recue"];

export function ordersSummary(orders: PurchaseOrder[]): OrdersSummary {
  const parStatut = { brouillon: 0, envoyee: 0, recue: 0, annulee: 0 } as Record<OrderStatus, number>;
  let engageCents = 0;
  for (const o of orders) {
    if ((ORDER_STATUSES as readonly string[]).includes(o.status)) {
      parStatut[o.status as OrderStatus] += 1;
    }
    if (ENGAGED_STATUSES.includes(o.status as OrderStatus) && o.total_cents != null) {
      engageCents += Math.max(0, o.total_cents);
    }
  }
  return { total: orders.length, parStatut, engageCents };
}

// Coût des achats imputé à une soirée (valorisation honnête : commandes engagées au total connu seulement).
export function purchasingCostForEvent(orders: PurchaseOrder[], eventId: string): number {
  return orders
    .filter((o) => o.event_id === eventId && ENGAGED_STATUSES.includes(o.status as OrderStatus) && o.total_cents != null)
    .reduce((s, o) => s + Math.max(0, o.total_cents as number), 0);
}

export function validateSupplierDraft(d: { name?: string | null; category?: string | null }): {
  ok: boolean;
  message: string;
} {
  if (!d.name || !d.name.trim()) return { ok: false, message: "Nom du fournisseur requis." };
  if (d.category && !SUPPLIER_CATEGORIES.includes(d.category as (typeof SUPPLIER_CATEGORIES)[number]))
    return { ok: false, message: "Catégorie inconnue." };
  return { ok: true, message: "" };
}

export function validateOrderDraft(d: {
  supplier_id?: string | null;
  status?: string | null;
  total_cents?: number | null;
}): { ok: boolean; message: string } {
  if (!d.supplier_id || !d.supplier_id.trim()) return { ok: false, message: "Fournisseur requis." };
  if (d.status && !ORDER_STATUSES.includes(d.status as OrderStatus)) return { ok: false, message: "Statut de commande inconnu." };
  if (d.total_cents != null && (!Number.isFinite(d.total_cents) || d.total_cents < 0))
    return { ok: false, message: "Montant invalide." };
  return { ok: true, message: "" };
}

export function formatCostEuro(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
