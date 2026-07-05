// lib/stock.ts — logique métier PURE du module Stock/inventaire/pertes (0047). 100% testable.
// Stock THÉORIQUE = somme des mouvements signés d'un article. Aucune donnée de caisse (rapprochement OFF).

import type { StaffRole } from "./permissions.ts";

export const STOCK_FAMILIES = ["spiritueux", "champagne", "soft", "biere", "consommable", "general"] as const;
export const STOCK_UNITS = ["piece", "bouteille", "cl", "kg", "L"] as const;
export const MOVEMENT_KINDS = ["entree", "sortie", "perte", "casse", "ajustement", "inventaire"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export type StockItem = {
  id: string;
  name: string;
  family: string;
  unit: string;
  venue?: string | null;
  par_level?: number | null;
  unit_cost_cents?: number | null;
  active?: boolean;
};
export type StockMovement = {
  id: string;
  item_id: string;
  kind: string;
  qty: number; // delta signé
  reason?: string | null;
  event_id?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

export function canManageStock(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}
export function canViewStock(role: StaffRole): boolean {
  return role !== "promoter";
}

// Les pertes/casse/sortie sont des SORTIES (qty négative attendue) ; entree positive ; ajustement/inventaire signés tels quels.
export function signedQty(kind: MovementKind, absQty: number): number {
  const a = Math.abs(absQty);
  if (kind === "entree") return a;
  if (kind === "sortie" || kind === "perte" || kind === "casse") return -a;
  return absQty; // ajustement / inventaire : le signe est fourni par l'appelant
}

export function theoreticalStock(itemId: string, movements: StockMovement[]): number {
  return movements.filter((m) => m.item_id === itemId).reduce((s, m) => s + (Number(m.qty) || 0), 0);
}

export type ItemWithStock = StockItem & { stock: number; belowPar: boolean; rupture: boolean };

export function itemsWithStock(items: StockItem[], movements: StockMovement[]): ItemWithStock[] {
  return items.map((it) => {
    const stock = theoreticalStock(it.id, movements);
    return {
      ...it,
      stock,
      rupture: stock <= 0,
      belowPar: it.par_level != null && stock <= it.par_level,
    };
  });
}

export type StockSummary = {
  totalArticles: number;
  sousSeuil: number;
  ruptures: number;
  valeurStockCents: number; // somme stock théorique × coût unitaire (articles valorisés)
};

export function stockSummary(items: StockItem[], movements: StockMovement[]): StockSummary {
  const enriched = itemsWithStock(items, movements);
  return {
    totalArticles: items.length,
    sousSeuil: enriched.filter((i) => i.belowPar).length,
    ruptures: enriched.filter((i) => i.rupture).length,
    valeurStockCents: enriched.reduce(
      (s, i) => s + (i.unit_cost_cents != null ? Math.max(0, i.stock) * i.unit_cost_cents : 0),
      0,
    ),
  };
}

// Coût des PERTES/CASSE imputé à une soirée (valorisation honnête : seulement les articles au coût connu).
export function lossCostForEvent(items: StockItem[], movements: StockMovement[], eventId: string): number {
  const cost = new Map(items.map((i) => [i.id, i.unit_cost_cents]));
  return movements
    .filter((m) => m.event_id === eventId && (m.kind === "perte" || m.kind === "casse"))
    .reduce((s, m) => {
      const c = cost.get(m.item_id);
      return c != null ? s + Math.abs(Number(m.qty) || 0) * c : s;
    }, 0);
}

export function validateMovementDraft(d: { item_id?: string | null; kind?: string | null; qty?: number | null }): {
  ok: boolean;
  message: string;
} {
  if (!d.item_id || !d.item_id.trim()) return { ok: false, message: "Article requis." };
  if (d.kind && !MOVEMENT_KINDS.includes(d.kind as MovementKind)) return { ok: false, message: "Type de mouvement inconnu." };
  if (d.qty == null || !Number.isFinite(d.qty) || d.qty === 0) return { ok: false, message: "Quantité invalide." };
  return { ok: true, message: "" };
}

export function formatCostEuro(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
