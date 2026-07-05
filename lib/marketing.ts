// lib/marketing.ts — logique métier PURE du module Marketing/acquisition (0050). 100% testable.
// Attribution HONNÊTE : ROAS/CAC calculés seulement quand le dénominateur est réel (>0) ; sinon null → « — ».
// Aucune synchronisation de plateforme pub externe (adaptateurs OFF). Données SAISIES uniquement.

import type { StaffRole } from "./permissions.ts";

export const MARKETING_CHANNELS = [
  "instagram",
  "facebook",
  "tiktok",
  "google",
  "affichage",
  "promoteurs",
  "autre",
] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export const CAMPAIGN_STATUSES = ["brouillon", "active", "terminee"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export type Campaign = {
  id: string;
  name: string;
  channel: string;
  budget_cents?: number | null;
  spent_cents?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  event_id?: string | null;
  promo_code?: string | null;
  status?: string | null;
  attributed_revenue_cents?: number | null;
  attributed_reservations?: number | null;
  created_by?: string | null;
  created_at?: string | null;
};

export function canManageMarketing(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}
export function canViewMarketing(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

export function validateCampaignDraft(d: {
  name?: string | null;
  channel?: string | null;
  budget_cents?: number | null;
  spent_cents?: number | null;
}): { ok: boolean; message: string } {
  if (!d.name || !d.name.trim()) return { ok: false, message: "Nom de campagne requis." };
  if (d.channel && !MARKETING_CHANNELS.includes(d.channel as MarketingChannel))
    return { ok: false, message: "Canal inconnu." };
  if (d.budget_cents != null && (!Number.isFinite(d.budget_cents) || d.budget_cents < 0))
    return { ok: false, message: "Budget invalide." };
  if (d.spent_cents != null && (!Number.isFinite(d.spent_cents) || d.spent_cents < 0))
    return { ok: false, message: "Dépensé invalide." };
  return { ok: true, message: "" };
}

// ROAS = CA attribué / dépensé. Null si aucune dépense réelle (pas de division vide, pas de faux ratio).
export function campaignRoas(c: Campaign): number | null {
  const spent = Number(c.spent_cents) || 0;
  if (spent <= 0) return null;
  const revenue = Number(c.attributed_revenue_cents) || 0;
  return revenue / spent;
}

// CAC = dépensé / réservations attribuées (en centimes). Null si aucune réservation attribuée.
export function campaignCac(c: Campaign): number | null {
  const reservations = Number(c.attributed_reservations) || 0;
  if (reservations <= 0) return null;
  const spent = Number(c.spent_cents) || 0;
  return spent / reservations;
}

export type MarketingSummary = {
  totalCampagnes: number;
  actives: number;
  budgetTotalCents: number;
  depenseTotalCents: number;
  caAttribueTotalCents: number;
  reservationsAttribuees: number;
  roasGlobal: number | null; // CA total / dépensé total ; null si dépensé total = 0 (honnête)
};

export function marketingSummary(campaigns: Campaign[]): MarketingSummary {
  const budgetTotalCents = campaigns.reduce((s, c) => s + (Number(c.budget_cents) || 0), 0);
  const depenseTotalCents = campaigns.reduce((s, c) => s + (Number(c.spent_cents) || 0), 0);
  const caAttribueTotalCents = campaigns.reduce((s, c) => s + (Number(c.attributed_revenue_cents) || 0), 0);
  const reservationsAttribuees = campaigns.reduce((s, c) => s + (Number(c.attributed_reservations) || 0), 0);
  return {
    totalCampagnes: campaigns.length,
    actives: campaigns.filter((c) => c.status === "active").length,
    budgetTotalCents,
    depenseTotalCents,
    caAttribueTotalCents,
    reservationsAttribuees,
    roasGlobal: depenseTotalCents > 0 ? caAttribueTotalCents / depenseTotalCents : null,
  };
}

export function formatEuro(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

// ROAS/CAC affichés : tiret honnête quand le calcul n'a pas de base réelle.
export function formatRoas(roas: number | null): string {
  if (roas == null) return "—";
  return `${roas.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;
}
