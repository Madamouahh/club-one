// lib/artistesExtras.ts — logique PURE de la 2ᵉ charge du P&L : coûts ARTISTES & EXTRAS (B2/B3).
// Aucun accès réseau. Ce module transforme la liste des postes de coût d'une soirée (table
// soiree_charges, migration 0012) en COÛT ARTISTES — la charge que le P&L par soirée (lib/pnlSoiree)
// attend honnêtement à null tant qu'elle n'est pas branchée (charge « artistes », wired=false).
//
// Rien n'est inventé (même discipline que le coût staff, lib/rhPlanning) :
//   · aucun poste n'est fabriqué (les vrais cachets viennent des contrats booking du fondateur) ;
//   · le montant reste null tant que le fondateur n'a pas chiffré le poste (montant_ttc NULL) ;
//   · un poste ENGAGÉ (confirmé/payé) sans montant rend le coût INCOMPLET → jamais de total tronqué
//     branché comme s'il était le coût artistes réel de la soirée.
// L'accès Supabase reste dans app/page.tsx (comme caisse_z / staff_shifts).

import { round2 } from "./caisseZ.ts";

// ————————————————————————————————————————————————————————————————
// Modèle (miroir de la table 0012)
// ————————————————————————————————————————————————————————————————

// Catégories de coût reconnues (structure, pas une donnée fondateur). Miroir du CHECK SQL.
export const CHARGE_CATEGORIES = [
  "artiste",
  "dj",
  "technique",
  "securite_externe",
  "extra",
  "location",
  "autre",
] as const;
export type ChargeCategorie = (typeof CHARGE_CATEGORIES)[number];

// États d'un poste de coût. « prevu » = pressenti (pas encore ferme) ; « confirme »/« paye » =
// engagement ferme (compte dans le coût) ; « annule » = exclu.
export const CHARGE_STATUSES = ["prevu", "confirme", "paye", "annule"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

// Un statut ENGAGE un coût réel pour la soirée (engagement ferme). « prevu » reste provisionnel et
// n'entre pas dans le coût branché au P&L ; « annule » est exclu.
const COMMITTED_STATUSES: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>(["confirme", "paye"]);

export const CHARGE_CATEGORIE_LABELS: Record<ChargeCategorie, string> = {
  artiste: "Artiste",
  dj: "DJ",
  technique: "Technique (son/lumière)",
  securite_externe: "Sécurité externe",
  extra: "Extra (renfort ponctuel)",
  location: "Location matériel",
  autre: "Autre",
};

export type SoireeCharge = {
  id: string;
  exploitation_date: string;
  event_id: string | null;
  categorie: ChargeCategorie;
  label: string;
  montant_ttc: number | null; // cachet/coût TTC ; null tant que le fondateur ne l'a pas chiffré
  statut: ChargeStatus;
  notes_direction?: string | null; // direction uniquement
  saisi_par?: string | null;
};

export function isChargeCategorie(value: string): value is ChargeCategorie {
  return (CHARGE_CATEGORIES as readonly string[]).includes(value);
}

export function isChargeStatus(value: string): value is ChargeStatus {
  return (CHARGE_STATUSES as readonly string[]).includes(value);
}

// Un poste ferme (confirmé/payé, non annulé) engage un coût. Sert de filtre partout.
export function isCommitted(charge: SoireeCharge): boolean {
  return COMMITTED_STATUSES.has(charge.statut);
}

// Coût réel d'un poste = montant s'il est ENGAGÉ et chiffré ; null sinon (provisionnel, annulé, ou
// engagé mais pas encore chiffré). AUCUN coût fantôme.
export function chargeCost(charge: SoireeCharge): number | null {
  if (!isCommitted(charge)) return null;
  if (charge.montant_ttc == null) return null;
  return round2(charge.montant_ttc);
}

// ————————————————————————————————————————————————————————————————
// Synthèse des coûts d'une soirée (le producteur du « coût artistes » du P&L)
// ————————————————————————————————————————————————————————————————

export type ArtistesSummary = {
  exploitationDate: string;
  lignesTotal: number; // nombre de postes de la soirée (tous statuts sauf annulés)
  engagees: number; // postes fermes (confirmé/payé)
  provisionnelles: number; // postes « prévu » (pressentis, non fermes)
  annulees: number; // postes annulés (exclus du coût)
  coutArtistes: number | null; // somme des coûts fermes chiffrés ; null si aucun calculable
  coutComplet: boolean; // true seulement si TOUS les engagés sont chiffrés → coût fiable
  engageesSansMontant: number; // engagés dont le cachet n'est pas encore renseigné
  montantProvisionnel: number | null; // somme des montants « prévu » chiffrés (indicatif, hors P&L)
};

// Agrège les postes d'UNE soirée en coût artistes/extras. Le coût n'est « complet » que si chaque
// poste ENGAGÉ a un montant chiffré. Sinon coutComplet=false et on expose combien d'engagés restent
// sans montant — le P&L ne présentera donc pas un total tronqué comme définitif (même règle que le
// coût staff, lib/rhPlanning.summarizeMasseHoraire).
export function summarizeArtistesCharges(
  exploitationDate: string,
  charges: SoireeCharge[],
): ArtistesSummary {
  const nuit = charges.filter((c) => c.exploitation_date === exploitationDate);

  let engagees = 0;
  let provisionnelles = 0;
  let annulees = 0;
  let coutArtistes = 0;
  let anyCout = false;
  let engageesSansMontant = 0;
  let montantProvisionnel = 0;
  let anyProvisionnel = false;

  for (const charge of nuit) {
    if (charge.statut === "annule") {
      annulees += 1;
      continue;
    }
    if (charge.statut === "prevu") {
      provisionnelles += 1;
      if (charge.montant_ttc != null) {
        montantProvisionnel += charge.montant_ttc;
        anyProvisionnel = true;
      }
      continue;
    }
    // confirmé / payé → engagé
    engagees += 1;
    const cost = chargeCost(charge);
    if (cost != null) {
      coutArtistes += cost;
      anyCout = true;
    } else {
      engageesSansMontant += 1;
    }
  }

  return {
    exploitationDate,
    lignesTotal: engagees + provisionnelles, // les annulés ne comptent pas comme lignes vivantes
    engagees,
    provisionnelles,
    annulees,
    coutArtistes: anyCout ? round2(coutArtistes) : null,
    coutComplet: engagees > 0 && engageesSansMontant === 0 && anyCout,
    engageesSansMontant,
    montantProvisionnel: anyProvisionnel ? round2(montantProvisionnel) : null,
  };
}

// ————————————————————————————————————————————————————————————————
// Indicateurs d'honnêteté (état vide)
// ————————————————————————————————————————————————————————————————

// Vrai reflet de ce que le fondateur a saisi : combien de postes, combien engagés, combien chiffrés
// (sans quoi aucun coût artistes n'est calculable). Sert à afficher un état vide honnête.
export function artistesDataReady(charges: SoireeCharge[]): {
  total: number;
  engagees: number;
  withMontant: number;
} {
  return {
    total: charges.length,
    engagees: charges.filter((c) => isCommitted(c)).length,
    withMontant: charges.filter((c) => c.montant_ttc != null).length,
  };
}

// Projette la synthèse d'une soirée vers la charge « artistes » attendue par le P&L (pnlSoiree).
// amount reste null tant que le coût n'est pas COMPLET (au moins un engagé sans montant) : on ne
// branche jamais un coût partiel comme s'il était le coût artistes réel de la soirée.
export function artistesChargeAmount(summary: ArtistesSummary): number | null {
  return summary.coutComplet ? summary.coutArtistes : null;
}
