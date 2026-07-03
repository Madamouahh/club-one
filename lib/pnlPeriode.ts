// lib/pnlPeriode.ts — P&L de PÉRIODE (cumul multi-soirées : fenêtre glissante & récap mensuel).
// Logique PURE, aucun accès réseau — même discipline que lib/pnlSoiree / lib/rhRollup.
//
// Le P&L par soirée existe déjà (buildPnlSoiree, S4). Ce module NE recalcule rien : il RÉUTILISE
// buildPnlSoiree nuit par nuit pour le PRODUIT (Z de caisse), puis agrège sur une période. Le coût
// staff de période arrive DÉJÀ agrégé de lib/rhRollup (periodStaffChargeAmount) — une seule source
// (aucune divergence de calcul avec le per-soirée ni avec le cumul RH).
//
// RÈGLES DURES (identiques au P&L par soirée) :
//   · aucun produit fabriqué : le CA de période = somme des Z RÉELLEMENT saisis, jamais estimé ;
//     une nuit sans Z n'entre pas dans le produit (aucun 0 fantôme) ;
//   · un coût partiel n'est JAMAIS branché (staff reste null tant que le cumul RH n'est pas complet) ;
//   · le résultat n'est « net » que si PLUS aucune charge n'est en attente ;
//   · COUVERTURE honnête : les soirées OPÉRÉES (staff présent) mais sans Z sont exposées — le produit
//     de période les SOUS-compte, on ne masque jamais ce trou (miroir du garde-fou couverture ailleurs).

import { round2, type CaisseZRecord } from "./caisseZ.ts";
import { buildPnlSoiree, summarizeCaisse, type PnlCharge } from "./pnlSoiree.ts";

// ————————————————————————————————————————————————————————————————
// Dates
// ————————————————————————————————————————————————————————————————

// Clé de mois (YYYY-MM) d'une date d'exploitation ISO (YYYY-MM-DD). "" si illisible.
export function periodeMonthKey(exploitationDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(exploitationDate) ? exploitationDate.slice(0, 7) : "";
}

// ————————————————————————————————————————————————————————————————
// Produit agrégé (somme des Z de caisse sur une période)
// ————————————————————————————————————————————————————————————————

export type PnlPeriodeNight = {
  exploitationDate: string;
  caisseRecords: CaisseZRecord[];
  caTables: number; // CA des tables saisi pour cette soirée
  // Nb d'entrées de cette soirée (source honnête : event_archives.total_entries figé à la clôture).
  // `null` = entrées INCONNUES pour cette nuit (ex. la nuit active pas encore clôturée/archivée) :
  // la nuit reste comptée dans le produit, mais elle est EXCLUE du panier moyen (jamais un 0 qui
  // gonflerait le ratio produit ÷ entrées).
  entries: number | null;
};

export type ProduitPeriode = {
  soireesAvecZ: number; // nuits distinctes RÉELLEMENT chiffrées par un Z (base du produit)
  produitTotal: number; // somme des CA caisse (Z) ; 0 si aucune nuit chiffrée
  caBarTotal: number;
  caEntreesTotal: number;
  caVestiaireTotal: number;
  offertsTotal: number;
  caTablesTotal: number;
  entriesTotal: number; // somme des entrées des seules nuits à entrées CONNUES (jamais estimée)
  entriesCouvertureNuits: number; // nb de nuits chiffrées (Z) dont les entrées sont connues (couverture du panier)
  nbTicketsTotal: number | null; // somme si au moins une nuit renseigne ses tickets, sinon null
  ecart: number | null; // caBarTotal − caTablesTotal ; null si aucune base « bar » sur la période
  tauxSaisie: number | null; // caTablesTotal / caBarTotal ; couverture de la saisie table
  // Panier moyen = produit des nuits à entrées connues ÷ entrées cumulées de CES MÊMES nuits.
  // Ratio calculé sur un ensemble de nuits COHÉRENT (produit et entrées appariés) : une nuit à Z
  // mais sans entrées connues n'entre dans AUCUN des deux termes → jamais de panier surévalué.
  panierMoyen: number | null;
};

// Agrège le PRODUIT de plusieurs soirées en réutilisant buildPnlSoiree nuit par nuit (aucune
// divergence de calcul avec le per-soirée). Une nuit sans Z (caisse indisponible) est ignorée du
// produit — on ne fabrique aucun 0.
export function aggregateProduit(nights: PnlPeriodeNight[]): ProduitPeriode {
  let soireesAvecZ = 0;
  let produitTotal = 0;
  let caBarTotal = 0;
  let caEntreesTotal = 0;
  let caVestiaireTotal = 0;
  let offertsTotal = 0;
  let caTablesTotal = 0;
  let entriesTotal = 0;
  let entriesCouvertureNuits = 0;
  let produitEntriesConnues = 0; // produit des seules nuits à entrées connues (numérateur du panier)
  let ticketsSum = 0;
  let anyTickets = false;

  for (const n of nights) {
    const pnl = buildPnlSoiree({
      exploitationDate: n.exploitationDate,
      caisseRecords: n.caisseRecords,
      caTables: n.caTables,
      entries: n.entries ?? 0, // entrées inconnues → 0 pour le calcul per-soirée, mais exclues du panier ci-dessous
    });
    if (!pnl.caisse.available) continue; // nuit sans Z → hors produit (pas de 0 fantôme)
    soireesAvecZ += 1;
    produitTotal += pnl.produitTotal;
    caBarTotal += pnl.caisse.caBar;
    caEntreesTotal += pnl.caisse.caEntrees;
    caVestiaireTotal += pnl.caisse.caVestiaire;
    offertsTotal += pnl.caisse.offerts;
    caTablesTotal += pnl.reconciliation.caTables;
    // Panier moyen : n'agréger produit ET entrées QUE pour les nuits à entrées réellement connues.
    // Une nuit à Z mais sans entrées connues (ex. soirée active non clôturée) est laissée hors des
    // deux termes → le ratio reste appareillé (jamais un produit divisé par trop peu d'entrées).
    if (n.entries != null) {
      entriesTotal += pnl.entries;
      produitEntriesConnues += pnl.produitTotal;
      entriesCouvertureNuits += 1;
    }
    if (pnl.caisse.nbTickets != null) {
      ticketsSum += pnl.caisse.nbTickets;
      anyTickets = true;
    }
  }

  produitTotal = round2(produitTotal);
  caBarTotal = round2(caBarTotal);
  caTablesTotal = round2(caTablesTotal);
  const bar = caBarTotal > 0 ? caBarTotal : null;

  return {
    soireesAvecZ,
    produitTotal,
    caBarTotal,
    caEntreesTotal: round2(caEntreesTotal),
    caVestiaireTotal: round2(caVestiaireTotal),
    offertsTotal: round2(offertsTotal),
    caTablesTotal,
    entriesTotal,
    entriesCouvertureNuits,
    nbTicketsTotal: anyTickets ? ticketsSum : null,
    ecart: bar == null ? null : round2(bar - caTablesTotal),
    tauxSaisie: bar == null ? null : round2(caTablesTotal / bar),
    panierMoyen: entriesTotal > 0 ? round2(produitEntriesConnues / entriesTotal) : null,
  };
}

// ————————————————————————————————————————————————————————————————
// Charges de période
// ————————————————————————————————————————————————————————————————

// Charges du P&L de période. Convention identique au per-soirée : `undefined` = producteur non
// branché (wired=false) ; `null` = branché mais cumul non chiffrable (wired=true, montant null,
// jamais un coût partiel) ; `number` = coût complet de la période.
function periodeCharges(
  staffCharge: number | null | undefined,
  artistesCharge: number | null | undefined,
): PnlCharge[] {
  return [
    {
      key: "staff",
      label: "Coût staff (cumul période)",
      amount: staffCharge ?? null,
      source: staffCharge === undefined ? "RH · cumul (B7) — non branché" : "RH · cumul période (B7)",
      wired: staffCharge !== undefined,
    },
    {
      key: "artistes",
      label: "Coûts artistes & extras (période)",
      amount: artistesCharge ?? null,
      source:
        artistesCharge === undefined
          ? "Événement · booking (B2/B3) — non branché"
          : "Événement · booking (B2/B3)",
      wired: artistesCharge !== undefined,
    },
  ];
}

// ————————————————————————————————————————————————————————————————
// P&L de période (assemblage)
// ————————————————————————————————————————————————————————————————

export type PnlPeriodeMonth = {
  month: string; // YYYY-MM
  produit: ProduitPeriode;
  staffCharge: number | null; // du récap mensuel RH (buildMonthlyStaffRollups) ; null si non complet
  margeApresStaff: number | null; // produit − staffCharge (staff seule charge mensuelle disponible)
  staffDeduit: boolean; // true seulement si un coût staff complet a été déduit ce mois-ci
};

export type PnlPeriode = {
  produit: ProduitPeriode;
  charges: PnlCharge[];
  chargesConnues: number; // somme des charges réellement branchées ET chiffrées
  chargesEnAttente: PnlCharge[]; // charges non branchées ou branchées-mais-incomplètes
  margeApresChargesConnues: number | null; // produit − chargesConnues ; null si aucun Z
  resultatNetComplet: boolean; // true seulement quand PLUS aucune charge n'est en attente
  soireesOpereesSansZ: string[]; // dates opérées (staff présent) SANS Z → produit sous-compté
  couvertureZComplete: boolean; // true si aucune soirée opérée n'est sans Z
  months: PnlPeriodeMonth[]; // récap mensuel (produit + coût staff par mois)
};

export type PnlPeriodeInput = {
  nights: PnlPeriodeNight[];
  // Coût staff de période, DÉJÀ agrégé par lib/rhRollup (periodStaffChargeAmount). undefined = non
  // branché ; null = branché mais cumul non complet ; number = coût staff complet de la période.
  staffCharge?: number | null;
  // Coût artistes/extras de période (non produit à ce jour → laissé undefined par le front).
  artistesCharge?: number | null;
  // Dates où le club a réellement opéré (staff présent), pour la couverture Z. Une date ici sans Z
  // signale que le produit de période la sous-compte. Absent = pas de contrôle de couverture.
  operatedDates?: string[];
  // Coût staff par mois calendaire (buildMonthlyStaffRollups → periodStaffChargeAmount). monthKey →
  // montant (null si le mois n'est pas entièrement chiffré). Absent = pas de coût staff mensuel.
  monthlyStaffCharges?: Record<string, number | null>;
};

export function buildPnlPeriode(input: PnlPeriodeInput): PnlPeriode {
  const produit = aggregateProduit(input.nights);
  const charges = periodeCharges(input.staffCharge, input.artistesCharge);
  const chargesEnAttente = charges.filter((c) => !c.wired || c.amount == null);
  const chargesConnues = round2(
    charges
      .filter((c) => c.wired && c.amount != null)
      .reduce((sum, c) => sum + (c.amount as number), 0),
  );
  const hasProduit = produit.soireesAvecZ > 0;

  // Couverture Z : quelles dates opérées (staff présent) n'ont AUCUN Z → produit sous-compté.
  const zDates = new Set(
    input.nights.filter((n) => summarizeCaisse(n.caisseRecords).available).map((n) => n.exploitationDate),
  );
  const operated = input.operatedDates ?? [];
  const soireesOpereesSansZ = [...new Set(operated)].filter((d) => !zDates.has(d)).sort();

  // Récap mensuel : produit par mois + coût staff mensuel (récap paie RH). Les nuits sans date
  // lisible sont ignorées (aucune ligne « mois inconnu » fabriquée).
  const byMonth = new Map<string, PnlPeriodeNight[]>();
  for (const n of input.nights) {
    const mk = periodeMonthKey(n.exploitationDate);
    if (mk === "") continue;
    const bucket = byMonth.get(mk);
    if (bucket) bucket.push(n);
    else byMonth.set(mk, [n]);
  }
  const months: PnlPeriodeMonth[] = [...byMonth.keys()].sort().map((month) => {
    const p = aggregateProduit(byMonth.get(month)!);
    const staffCharge = input.monthlyStaffCharges?.[month] ?? null;
    const staffDeduit = staffCharge != null;
    return {
      month,
      produit: p,
      staffCharge,
      margeApresStaff: p.soireesAvecZ > 0 ? round2(p.produitTotal - (staffCharge ?? 0)) : null,
      staffDeduit,
    };
  });

  return {
    produit,
    charges,
    chargesConnues,
    chargesEnAttente,
    margeApresChargesConnues: hasProduit ? round2(produit.produitTotal - chargesConnues) : null,
    resultatNetComplet: chargesEnAttente.length === 0,
    soireesOpereesSansZ,
    couvertureZComplete: soireesOpereesSansZ.length === 0,
    months,
  };
}
