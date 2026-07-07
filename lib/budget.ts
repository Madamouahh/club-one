// lib/budget.ts — logique métier PURE du module Budget PRÉVU/RÉEL (0051). 100% testable.
//
// Cette lib ne connaît QUE le PRÉVISIONNEL saisi. Le RÉEL vient d'AILLEURS (caisse_z, soiree_charges,
// stock, maintenance) et n'est PAS stocké par ce module. Tant qu'une valeur réelle n'est pas croisée,
// elle est marquée « NON RENSEIGNÉ » / « NON CONNECTÉE » — JAMAIS présentée comme comptable réelle,
// JAMAIS remplacée par 0 € inventé.

import type { StaffRole } from "./permissions.ts";

// Postes fermés du budget prévisionnel (vocabulaire verrouillé, aligné sur la migration 0051).
export const BUDGET_POSTES = [
  "ca_tables",
  "artistes",
  "personnel",
  "publicite",
  "achats",
  "maintenance",
  "pertes",
  "autre",
] as const;
export type BudgetPoste = (typeof BUDGET_POSTES)[number];

export type BudgetForecast = {
  id: string;
  event_id?: string | null;
  label: string;
  poste: string;
  montant_prevu_cents: number;
  created_by?: string | null;
  created_at?: string | null;
};

// Le prévisionnel de gestion est réservé à la DIRECTION (lecture ET écriture) — cohérent avec la RLS 0051.
export function canManageBudget(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}
export function canViewBudget(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

export type ForecastDraft = {
  label?: string | null;
  poste?: string | null;
  montant_prevu_euros?: number | null; // saisi en euros par l'UI ; converti en cents à l'insert
};

export function validateForecastDraft(d: ForecastDraft): { ok: boolean; message: string } {
  if (!d.label || !d.label.trim()) return { ok: false, message: "Intitulé requis." };
  if (d.poste && !BUDGET_POSTES.includes(d.poste as BudgetPoste)) return { ok: false, message: "Poste inconnu." };
  if (d.montant_prevu_euros == null || !Number.isFinite(d.montant_prevu_euros) || d.montant_prevu_euros < 0) {
    return { ok: false, message: "Montant prévu invalide." };
  }
  return { ok: true, message: "" };
}

export type PosteTotal = { poste: BudgetPoste; totalPrevuCents: number; lignes: number };

export type BudgetSummary = {
  totalPrevuCents: number;
  lignes: number;
  parPoste: PosteTotal[]; // un total par poste RENSEIGNÉ (postes sans ligne omis)
};

// Total prévu global + ventilation par poste (seuls les postes ayant au moins une ligne apparaissent).
export function budgetSummary(forecasts: BudgetForecast[]): BudgetSummary {
  const byPoste = new Map<BudgetPoste, { total: number; lignes: number }>();
  let totalPrevuCents = 0;
  for (const f of forecasts) {
    const cents = Number(f.montant_prevu_cents) || 0;
    totalPrevuCents += cents;
    const key = (BUDGET_POSTES.includes(f.poste as BudgetPoste) ? f.poste : "autre") as BudgetPoste;
    const cur = byPoste.get(key) ?? { total: 0, lignes: 0 };
    cur.total += cents;
    cur.lignes += 1;
    byPoste.set(key, cur);
  }
  // Ordre stable calqué sur BUDGET_POSTES.
  const parPoste: PosteTotal[] = BUDGET_POSTES.filter((p) => byPoste.has(p)).map((p) => {
    const v = byPoste.get(p)!;
    return { poste: p, totalPrevuCents: v.total, lignes: v.lignes };
  });
  return { totalPrevuCents, lignes: forecasts.length, parPoste };
}

// Écart prévu↔réel. Le RÉEL n'étant PAS géré par ce module, une valeur absente (null/undefined) n'est
// JAMAIS traitée comme 0 : elle produit le tag 'NON RENSEIGNÉ' (le croisement caisse/stock n'est pas
// branché). Quand un réel EST fourni (par le futur cockpit de croisement), l'écart chiffré est calculé.
export type Variance = {
  ecartCents: number | null; // reel - prevu ; null tant que le réel n'est pas connu
  tag: "NON RENSEIGNÉ" | "ESTIMATION" | number;
};

export function variance(prevuCents: number, reelCents: number | null | undefined): Variance {
  if (reelCents == null || !Number.isFinite(reelCents)) {
    return { ecartCents: null, tag: "NON RENSEIGNÉ" };
  }
  const ecart = reelCents - prevuCents;
  return { ecartCents: ecart, tag: ecart };
}

// ————————————————————————————————————————————————————————————————
// RÉEL connecté — mapping SOURCES LIVE → poste budgétaire (0051 · Squad G4)
// ————————————————————————————————————————————————————————————————
//
// Le RÉEL n'est PAS stocké par ce module : il est CROISÉ depuis les tables déjà vivantes du produit
// (caisse_z 0010, soiree_charges 0012, staff_shifts/rhRollup 0011, stock_movements 0047,
// maintenance_interventions 0046). Cette fonction est PURE : elle reçoit des agrégats déjà réduits en
// CENTS par la couche data (BudgetView) et les range par poste. Discipline d'honnêteté DURE :
//   · une source ABSENTE (undefined) ou NON CHIFFRABLE (null / NaN) laisse le poste à null →
//     l'UI affiche « NON CONNECTÉ / NON RENSEIGNÉ », JAMAIS 0 € fabriqué ;
//   · un poste SANS aucune source réelle dédiée (publicite, autre) est TOUJOURS null — on ne
//     présente jamais un poste non sourcé comme réel comptable ;
//   · aucune estimation n'est promue en réel : la couche data ne passe un nombre que lorsqu'une
//     donnée réelle valorisée existe (coût staff complet, cachet engagé & chiffré, coût unitaire connu).
export type RealSources = {
  caTablesCents?: number | null; // caisse_z (Z de clôture 0010) — CA réel de la soirée (revenu encaissé lu)
  artistesCents?: number | null; // soiree_charges (0012) — cachets artistes/extras ENGAGÉS & chiffrés
  personnelCents?: number | null; // staff_shifts + staff_members (0011 · rhRollup) — coût staff (complet only)
  achatsCents?: number | null; // stock_movements « entree » (0047) valorisées au coût unitaire connu
  pertesCents?: number | null; // stock_movements « perte » / « casse » (0047) valorisées au coût connu
  maintenanceCents?: number | null; // maintenance_interventions (0046) — coûts d'intervention renseignés
};

export type RealByPoste = Record<BudgetPoste, number | null>;

// Normalise une valeur en cents entiers, ou null si absente / non finie (honnêteté : jamais 0 inventé).
function cleanReelCents(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.round(v);
}

// Range les agrégats des sources live par poste budgétaire. Les postes publicite et autre restent
// TOUJOURS null : aucune source réelle dédiée n'existe (une dépense pub réelle ou « autre » n'est
// portée par aucune table vivante) — les présenter comme réels serait malhonnête.
export function computeRealFromSources(sources: RealSources): RealByPoste {
  return {
    ca_tables: cleanReelCents(sources.caTablesCents),
    artistes: cleanReelCents(sources.artistesCents),
    personnel: cleanReelCents(sources.personnelCents),
    publicite: null, // aucune source live (aucune table ne porte la dépense publicitaire réelle)
    achats: cleanReelCents(sources.achatsCents),
    maintenance: cleanReelCents(sources.maintenanceCents),
    pertes: cleanReelCents(sources.pertesCents),
    autre: null, // poste fourre-tout : aucune source réelle dédiée
  };
}

export function formatEuro(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

// Libellé d'un écart chiffré, signe explicite (+ = dépassement / surplus, − = économie / manque).
export function formatVariance(v: Variance): string {
  if (v.ecartCents == null) return "NON RENSEIGNÉ";
  const sign = v.ecartCents > 0 ? "+" : "";
  return `${sign}${formatEuro(v.ecartCents)}`;
}
