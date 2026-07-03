// lib/rhRollup.ts — CUMUL MULTI-SOIRÉES de la masse horaire & du coût staff (B7, période / mois).
// Logique PURE, aucun accès réseau — même discipline que lib/rhPlanning / lib/pnlSoiree.
//
// Le per-soirée existe déjà (summarizeMasseHoraire de rhPlanning, branché au P&L par soirée depuis S6).
// Ce module NE re-calcule rien : il RÉUTILISE summarizeMasseHoraire nuit par nuit puis AGRÈGE sur une
// période (fenêtre glissante) et par mois, pour le « récap mensuel paie » attendu côté direction.
//
// RÈGLES DURES (identiques au reste du module RH) :
//   · aucun salarié ni shift fabriqué (base vide → rollup vide, états honnêtes) ;
//   · le coût cumulé n'est « complet » que si CHAQUE nuit-avec-présents a un coût complet (taux + heures
//     pour tous les présents). Sinon coutComplet=false + on expose combien de nuits restent partielles :
//     on ne présente JAMAIS un cumul tronqué comme le coût staff définitif de la période ;
//   · periodStaffChargeAmount reste null tant que le cumul n'est pas complet → un futur P&L de période
//     ne branchera jamais un coût partiel (miroir exact de staffChargeAmount du per-soirée).

import { round2 } from "./caisseZ.ts";
import { summarizeMasseHoraire, type MasseHoraire, type StaffMember, type StaffShift } from "./rhPlanning.ts";

// ————————————————————————————————————————————————————————————————
// Dates
// ————————————————————————————————————————————————————————————————

// Clé de mois (YYYY-MM) d'une date d'exploitation ISO (YYYY-MM-DD). "" si illisible.
export function monthKey(exploitationDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(exploitationDate) ? exploitationDate.slice(0, 7) : "";
}

// Dates d'exploitation distinctes présentes dans les shifts, triées croissant.
export function distinctExploitationDates(shifts: StaffShift[]): string[] {
  const set = new Set<string>();
  for (const s of shifts) if (s.exploitation_date) set.add(s.exploitation_date);
  return [...set].sort();
}

// ————————————————————————————————————————————————————————————————
// Cumul de période
// ————————————————————————————————————————————————————————————————

export type PeriodStaffRollup = {
  nights: MasseHoraire[]; // par soirée, triées croissant (réutilise summarizeMasseHoraire)
  nightsTotal: number; // nombre de soirées distinctes agrégées
  nightsWithPresents: number; // soirées où au moins un présent est pointé
  shiftsTotal: number; // total de shifts sur la période
  presentsTotal: number; // total de présents (present + retard)
  absentsTotal: number; // total d'absents
  heuresPlanifieesTotal: number; // somme des heures prévues
  heuresReellesTotal: number | null; // somme des heures pointées ; null si AUCUNE nuit pointée
  coutStaffCumul: number | null; // somme des coûts calculables (peut être partiel) ; null si aucun
  coutComplet: boolean; // true seulement si CHAQUE nuit-avec-présents a un coût complet
  nightsSansCoutComplet: number; // soirées avec présents mais coût incomplet (taux/heures manquants)
  presentsSansTaux: number; // total de présents sans coût calculable sur la période
};

// Agrège une liste de soirées (identifiées par leurs dates distinctes dans `shifts`) en un cumul.
// Chaque soirée passe par summarizeMasseHoraire (aucune divergence de calcul avec le per-soirée).
export function buildPeriodStaffRollup(shifts: StaffShift[], members: StaffMember[]): PeriodStaffRollup {
  const dates = distinctExploitationDates(shifts);
  const nights = dates.map((d) => summarizeMasseHoraire(d, shifts, members));

  let shiftsTotal = 0;
  let presentsTotal = 0;
  let absentsTotal = 0;
  let heuresPlanifieesTotal = 0;
  let heuresReellesTotal = 0;
  let anyReelle = false;
  let coutStaffCumul = 0;
  let anyCout = false;
  let nightsWithPresents = 0;
  let nightsSansCoutComplet = 0;
  let presentsSansTaux = 0;

  for (const m of nights) {
    shiftsTotal += m.shiftsTotal;
    presentsTotal += m.presents;
    absentsTotal += m.absents;
    heuresPlanifieesTotal += m.heuresPlanifiees;
    if (m.heuresReelles != null) {
      heuresReellesTotal += m.heuresReelles;
      anyReelle = true;
    }
    if (m.coutStaff != null) {
      coutStaffCumul += m.coutStaff;
      anyCout = true;
    }
    presentsSansTaux += m.presentsSansTaux;
    if (m.presents > 0) {
      nightsWithPresents += 1;
      if (!m.coutComplet) nightsSansCoutComplet += 1;
    }
  }

  return {
    nights,
    nightsTotal: nights.length,
    nightsWithPresents,
    shiftsTotal,
    presentsTotal,
    absentsTotal,
    heuresPlanifieesTotal: round2(heuresPlanifieesTotal),
    heuresReellesTotal: anyReelle ? round2(heuresReellesTotal) : null,
    coutStaffCumul: anyCout ? round2(coutStaffCumul) : null,
    coutComplet: nightsWithPresents > 0 && nightsSansCoutComplet === 0,
    nightsSansCoutComplet,
    presentsSansTaux,
  };
}

// Projette le cumul de période vers une charge staff « de période » branchable (futur P&L période) :
// null tant que le cumul n'est pas COMPLET — jamais un coût partiel présenté comme définitif.
export function periodStaffChargeAmount(rollup: PeriodStaffRollup): number | null {
  return rollup.coutComplet ? rollup.coutStaffCumul : null;
}

// ————————————————————————————————————————————————————————————————
// Récap MENSUEL (paie)
// ————————————————————————————————————————————————————————————————

export type MonthlyStaffRollup = {
  month: string; // YYYY-MM
  rollup: PeriodStaffRollup;
};

// Un cumul par mois calendaire présent dans les shifts, trié croissant. Les shifts sans date lisible
// (monthKey === "") sont ignorés (aucune ligne « mois inconnu » fabriquée).
export function buildMonthlyStaffRollups(shifts: StaffShift[], members: StaffMember[]): MonthlyStaffRollup[] {
  const byMonth = new Map<string, StaffShift[]>();
  for (const s of shifts) {
    const mk = monthKey(s.exploitation_date);
    if (mk === "") continue;
    const bucket = byMonth.get(mk);
    if (bucket) bucket.push(s);
    else byMonth.set(mk, [s]);
  }
  return [...byMonth.keys()]
    .sort()
    .map((month) => ({ month, rollup: buildPeriodStaffRollup(byMonth.get(month)!, members) }));
}

// ————————————————————————————————————————————————————————————————
// État vide honnête
// ————————————————————————————————————————————————————————————————

// Reflet de ce que la période contient réellement, pour un bandeau d'état honnête.
export function rollupDataReady(rollup: PeriodStaffRollup): {
  hasNights: boolean;
  hasPresents: boolean;
  hasCost: boolean;
  costPartial: boolean;
} {
  return {
    hasNights: rollup.nightsTotal > 0,
    hasPresents: rollup.presentsTotal > 0,
    hasCost: rollup.coutStaffCumul != null,
    costPartial: rollup.coutStaffCumul != null && !rollup.coutComplet,
  };
}
