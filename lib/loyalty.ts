// lib/loyalty.ts — logique PURE du moteur de fidélité (migration 0067). Aucun accès réseau.
// Miroir en TypeScript des SEUILS et des gardes de la RPC (public.loyalty_tier / loyalty_accrue_v1 /
// loyalty_redeem_v1) : le palier est TOUJOURS dérivé du solde, jamais saisi ; un débit qui rendrait le
// solde négatif est refusé. Rien n'est inventé : un client sans compte a un solde 0 (bronze), pas un bonus.
//
// La sécurité RÉELLE reste côté SQL (RLS direction + RPC SECURITY DEFINER). Ces fonctions servent à
// valider AVANT l'appel réseau (feedback immédiat) et à afficher un état cohérent — pas une frontière.

import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Paliers — SEUILS = source de vérité (doivent coïncider avec public.loyalty_tier en 0067).
// ————————————————————————————————————————————————————————————————
export const LOYALTY_TIERS = [
  { tier: "bronze", min: 0, label: "Bronze" },
  { tier: "silver", min: 500, label: "Argent" },
  { tier: "gold", min: 1500, label: "Or" },
  { tier: "platinum", min: 5000, label: "Platine" },
] as const;

export type LoyaltyTier = (typeof LOYALTY_TIERS)[number]["tier"];

export const LOYALTY_TIER_LABELS: Record<LoyaltyTier, string> = {
  bronze: "Bronze",
  silver: "Argent",
  gold: "Or",
  platinum: "Platine",
};

// Palier dérivé d'un solde de points. Solde négatif/absent → bronze (aucun palier « fabriqué »).
export function tierForPoints(points: number): LoyaltyTier {
  const p = Number.isFinite(points) ? points : 0;
  let result: LoyaltyTier = "bronze";
  for (const t of LOYALTY_TIERS) {
    if (p >= t.min) result = t.tier;
  }
  return result;
}

// Prochain palier + points restants pour l'atteindre. null si déjà au palier maximal.
export function pointsToNextTier(points: number): { next: LoyaltyTier; remaining: number } | null {
  const p = Number.isFinite(points) ? Math.max(0, points) : 0;
  for (const t of LOYALTY_TIERS) {
    if (p < t.min) return { next: t.tier, remaining: t.min - p };
  }
  return null;
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle (confort UI — la frontière réelle est la RLS/RPC 0067).
// ————————————————————————————————————————————————————————————————
export function canManageLoyalty(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// Modèle (miroir des tables loyalty_accounts / loyalty_ledger).
// ————————————————————————————————————————————————————————————————
export type LoyaltyAccount = {
  guest_id: string;
  points: number;
  tier: LoyaltyTier;
  updated_at: string | null;
};

export type LoyaltyLedgerEntry = {
  id: string;
  guest_id: string;
  delta: number; // + = crédit (accrual), − = débit (redeem)
  reason: string | null;
  created_by: string | null;
  created_at: string | null;
};

// Contrat de retour des RPC accrue/redeem (0065-style : ok + code + message + solde/palier à jour).
export type LoyaltyRpcResult = {
  ok: boolean;
  code: string;
  message: string;
  points: number | null;
  tier: LoyaltyTier | null;
};

// ————————————————————————————————————————————————————————————————
// Validation locale AVANT appel réseau (miroir des gardes de la RPC).
// ————————————————————————————————————————————————————————————————
export type ValidationResult = { ok: true } | { ok: false; message: string };

// Un crédit doit être un entier strictement positif (miroir de loyalty_accrue_v1).
export function validateAccrue(delta: number): ValidationResult {
  if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
    return { ok: false, message: "Le nombre de points doit être un entier." };
  }
  if (delta <= 0) {
    return { ok: false, message: "Le nombre de points à créditer doit être strictement positif." };
  }
  return { ok: true };
}

// Un débit doit être un entier strictement positif ET ne jamais dépasser le solde (pas de solde négatif).
export function validateRedeem(points: number, balance: number): ValidationResult {
  if (!Number.isFinite(points) || !Number.isInteger(points)) {
    return { ok: false, message: "Le nombre de points doit être un entier." };
  }
  if (points <= 0) {
    return { ok: false, message: "Le nombre de points à utiliser doit être strictement positif." };
  }
  const bal = Number.isFinite(balance) ? balance : 0;
  if (points > bal) {
    return { ok: false, message: `Solde insuffisant (${bal} point${bal > 1 ? "s" : ""} disponible${bal > 1 ? "s" : ""}).` };
  }
  return { ok: true };
}

// Solde après application d'un delta signé (jamais rendu négatif — clampe à 0 pour l'affichage).
export function applyDelta(balance: number, delta: number): number {
  const b = Number.isFinite(balance) ? balance : 0;
  const d = Number.isFinite(delta) ? delta : 0;
  return Math.max(0, b + d);
}

// Solde reconstitué depuis le journal (le ledger est la source de vérité ; jamais < 0 par construction RPC).
export function balanceFromLedger(entries: LoyaltyLedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + (Number.isFinite(e.delta) ? e.delta : 0), 0);
}
