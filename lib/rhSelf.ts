// lib/rhSelf.ts — logique PURE de la VUE SALARIÉ du module RH / Planning (B7), aucun accès réseau.
//
// La 0011 cantonne déjà chaque salarié à SA fiche et SES shifts (RLS staff_members_read /
// staff_shifts_read). Ce module transforme ces shifts (déjà scopés par la RLS) en une lecture
// honnête pour le salarié : mes créneaux à venir / passés, mes heures réelles cumulées, et quels
// créneaux restent à confirmer (la confirmation « 1 tap » planifie → confirme passe par la RPC
// confirm_my_shift_v1 de 0020 ; ici on ne fait que DÉCIDER si un créneau est confirmable et AGRÉGER).
//
// Règles dures : rien n'est inventé. Aucune heure n'est fabriquée (les heures réelles ne comptent
// que si le pointage existe réellement), aucun coût n'est exposé (le taux horaire est de la PII paie,
// jamais montrée au salarié — la vue salarié n'affiche que SES heures, pas son coût ni celui des autres).

import { actualHours, plannedHours } from "./rhPlanning.ts";
import type { StaffShift, ShiftStatus } from "./rhPlanning.ts";
import { round2 } from "./caisseZ.ts";

// Libellés français des statuts d'un créneau (miroir strict du CHECK 0011 : aucun statut inventé).
export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  planifie: "Planifié",
  confirme: "Confirmé",
  present: "Présent",
  absent: "Absent",
  retard: "Retard",
  annule: "Annulé",
};

export function shiftStatusLabel(status: ShiftStatus): string {
  return SHIFT_STATUS_LABELS[status];
}

// Un créneau est confirmable par le SALARIÉ uniquement s'il est encore 'planifie'. Une fois confirmé
// (rien à refaire) ou traité par la direction (present/absent/retard/annule), le 1-tap n'a plus lieu
// d'être : le pointage réel et l'annulation restent une prérogative direction (0011). Miroir exact de
// la garde SQL de confirm_my_shift_v1 (0020) — la RPC revalide, l'UI ne fait que masquer le bouton.
export function canSelfConfirm(shift: StaffShift): boolean {
  return shift.status === "planifie";
}

// ————————————————————————————————————————————————————————————————
// Répartition à venir / passé — déterministe, sur la date d'exploitation (la soirée chevauche minuit,
// on raisonne à la journée). refDate = « aujourd'hui » injecté (jamais Date.now() ici, testabilité).
// ————————————————————————————————————————————————————————————————

// Date d'exploitation (YYYY-MM-DD) → repère de jour en UTC, ou null si illisible (rien n'est deviné).
function exploitationDay(date: string): number | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function refDay(refDate: Date): number {
  return Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate());
}

export type SplitMyShifts = {
  upcoming: StaffShift[]; // exploitation_date >= aujourd'hui, du plus proche au plus lointain
  past: StaffShift[]; // exploitation_date < aujourd'hui, du plus récent au plus ancien
  undated: StaffShift[]; // date illisible : on ne l'invente pas, on l'isole honnêtement
};

// Sépare MES créneaux en « à venir » / « passés ». Le jour même est compté « à venir » (la soirée
// n'a pas encore eu lieu au moment où le salarié consulte, en journée). Tri déterministe.
export function splitMyShifts(shifts: StaffShift[], refDate: Date): SplitMyShifts {
  const ref = refDay(refDate);
  const upcoming: { s: StaffShift; d: number }[] = [];
  const past: { s: StaffShift; d: number }[] = [];
  const undated: StaffShift[] = [];

  for (const s of shifts) {
    const d = exploitationDay(s.exploitation_date);
    if (d == null) {
      undated.push(s);
    } else if (d >= ref) {
      upcoming.push({ s, d });
    } else {
      past.push({ s, d });
    }
  }

  upcoming.sort((a, b) => a.d - b.d || a.s.exploitation_date.localeCompare(b.s.exploitation_date));
  past.sort((a, b) => b.d - a.d || b.s.exploitation_date.localeCompare(a.s.exploitation_date));

  return {
    upcoming: upcoming.map((e) => e.s),
    past: past.map((e) => e.s),
    undated,
  };
}

// ————————————————————————————————————————————————————————————————
// Synthèse « MES heures » — honnête : les heures réelles ne comptent que là où le pointage existe.
// Aucun coût n'est calculé ni exposé (le taux horaire ne quitte jamais la vue direction).
// ————————————————————————————————————————————————————————————————

export type MyHoursSummary = {
  shiftsTotal: number; // nombre total de mes créneaux (tous statuts, toutes dates)
  aVenir: number; // créneaux à venir (>= aujourd'hui)
  passes: number; // créneaux passés
  aConfirmer: number; // créneaux encore 'planifie' → confirmables en 1 tap
  presents: number; // créneaux pointés présents (present + retard)
  absents: number; // créneaux marqués absents par la direction
  heuresReellesCumul: number | null; // somme de mes heures pointées ; null si AUCUN créneau pointé
  heuresPlanifieesAvenir: number; // somme des heures prévues de mes créneaux À VENIR (0 si aucune)
};

// Agrège MES shifts (déjà scopés RLS) en indicateurs personnels. `heuresReellesCumul` reste null tant
// qu'aucun créneau n'est réellement pointé : on n'affiche jamais « 0 h » comme s'il s'agissait d'un
// fait alors que rien n'a été pointé — la distinction null vs 0 est volontaire (honnêteté d'état vide).
export function summarizeMyHours(shifts: StaffShift[], refDate: Date): MyHoursSummary {
  const ref = refDay(refDate);
  let aVenir = 0;
  let passes = 0;
  let aConfirmer = 0;
  let presents = 0;
  let absents = 0;
  let heuresReelles = 0;
  let anyReelle = false;
  let heuresPlanifieesAvenir = 0;

  for (const s of shifts) {
    const d = exploitationDay(s.exploitation_date);
    const isUpcoming = d == null ? false : d >= ref;
    if (d != null) {
      if (isUpcoming) aVenir += 1;
      else passes += 1;
    }

    if (canSelfConfirm(s)) aConfirmer += 1;
    if (s.status === "absent") absents += 1;
    if (s.status === "present" || s.status === "retard") {
      presents += 1;
      const h = actualHours(s);
      if (h != null) {
        heuresReelles += h;
        anyReelle = true;
      }
    }

    if (isUpcoming) {
      const ph = plannedHours(s);
      if (ph != null) heuresPlanifieesAvenir += ph;
    }
  }

  return {
    shiftsTotal: shifts.length,
    aVenir,
    passes,
    aConfirmer,
    presents,
    absents,
    heuresReellesCumul: anyReelle ? round2(heuresReelles) : null,
    heuresPlanifieesAvenir: round2(heuresPlanifieesAvenir),
  };
}
