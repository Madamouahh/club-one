// lib/staffPerformance.ts — logique PURE de l'assiduité du personnel (B7), aucun accès réseau.
//
// « Performance » ici = AGRÉGATION HONNÊTE de faits réels de staff_shifts (migration 0011), JAMAIS un
// score arbitraire. On ne compte que ce que la direction a réellement pointé : shifts planifiés /
// confirmés, présents, retards, absents ; et un taux de présence dérivé honnêtement (présents sur
// décisions de présence réellement enregistrées ; null tant qu'aucune décision n'existe).
//
// La VUE SQL staff_performance_v1 (0066) produit exactement ces mêmes colonnes côté serveur (direction
// only, RLS 0011). Ce module reste la définition CANONIQUE et testable de cette agrégation :
//   · summarizeStaffPerformance  : mêmes comptages que la vue, à partir des faits bruts (miroir SQL) ;
//   · parseStaffPerformanceRows  : lecture défensive du résultat de la vue côté front (typage sûr) ;
//   · staffPerformanceTeamTotals : totaux d'équipe honnêtes (taux null si aucune présence enregistrée) ;
//   · performanceDataReady + formatRate : états vides / affichage honnêtes.
// Rien n'est fabriqué : base vide → tableau vide ; salarié jamais pointé → taux null (pas 0 % inventé).

import type { ShiftStatus, StaffMember, StaffShift } from "./rhPlanning.ts";

// ————————————————————————————————————————————————————————————————
// Buckets de statuts (miroir strict de la sémantique rhPlanning / de la vue 0066)
// ————————————————————————————————————————————————————————————————

// Planifiés : engagement au planning (ni annulé, ni absent). = PLANNED_STATUSES de rhPlanning.
const PLANNED: ReadonlySet<ShiftStatus> = new Set<ShiftStatus>(["planifie", "confirme", "present", "retard"]);
// Confirmés : la venue a été confirmée (puis éventuellement présent / en retard).
const CONFIRMED: ReadonlySet<ShiftStatus> = new Set<ShiftStatus>(["confirme", "present", "retard"]);
// Présents : la personne était là, même en retard. = PRESENT_STATUSES de rhPlanning.
const PRESENT: ReadonlySet<ShiftStatus> = new Set<ShiftStatus>(["present", "retard"]);
// Décisions de présence RÉELLEMENT enregistrées = dénominateur du taux de présence.
const ATTENDANCE_RECORDED: ReadonlySet<ShiftStatus> = new Set<ShiftStatus>(["present", "retard", "absent"]);

// Arrondi à 4 décimales (le taux de présence a besoin de plus de précision qu'un montant en euros).
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ————————————————————————————————————————————————————————————————
// Ligne d'assiduité (miroir exact des colonnes de la vue staff_performance_v1)
// ————————————————————————————————————————————————————————————————

export type StaffPerformanceRow = {
  staff_member_id: string;
  username: string;
  full_name: string;
  poste: string | null;
  actif: boolean;
  shifts_total: number;
  shifts_planned: number; // planifie + confirme + present + retard
  shifts_confirmed: number; // confirme + present + retard
  shifts_present: number; // present + retard (présent même en retard)
  shifts_late: number; // retard
  shifts_absent: number; // absent
  shifts_cancelled: number; // annule
  attendance_recorded: number; // present + retard + absent (dénominateur du taux)
  presence_rate: number | null; // present / attendance_recorded ; null si attendance_recorded === 0
  last_shift_date: string | null; // max(exploitation_date) ; null si aucun shift
};

// ————————————————————————————————————————————————————————————————
// Agrégation PURE (miroir SQL) — un enregistrement par salarié, y compris ceux SANS shift (zéros honnêtes)
// ————————————————————————————————————————————————————————————————

// Agrège les faits bruts (membres + shifts) en une ligne d'assiduité par salarié, triée par nom.
// Un salarié sans aucun shift produit une ligne à zéros avec presence_rate = null (rien d'inventé).
export function summarizeStaffPerformance(
  members: StaffMember[],
  shifts: StaffShift[],
): StaffPerformanceRow[] {
  // Regroupe les shifts par salarié (on ignore les shifts orphelins : aucun membre correspondant).
  const shiftsByMember = new Map<string, StaffShift[]>();
  for (const s of shifts) {
    const bucket = shiftsByMember.get(s.staff_member_id);
    if (bucket) bucket.push(s);
    else shiftsByMember.set(s.staff_member_id, [s]);
  }

  const rows = members.map((m) => {
    const memberShifts = shiftsByMember.get(m.id) ?? [];

    let planned = 0;
    let confirmed = 0;
    let present = 0;
    let late = 0;
    let absent = 0;
    let cancelled = 0;
    let attendance = 0;
    let lastDate: string | null = null;

    for (const s of memberShifts) {
      if (PLANNED.has(s.status)) planned += 1;
      if (CONFIRMED.has(s.status)) confirmed += 1;
      if (PRESENT.has(s.status)) present += 1;
      if (s.status === "retard") late += 1;
      if (s.status === "absent") absent += 1;
      if (s.status === "annule") cancelled += 1;
      if (ATTENDANCE_RECORDED.has(s.status)) attendance += 1;
      if (s.exploitation_date && (lastDate === null || s.exploitation_date > lastDate)) {
        lastDate = s.exploitation_date;
      }
    }

    return {
      staff_member_id: m.id,
      username: m.username,
      full_name: m.full_name,
      poste: m.poste,
      actif: m.actif,
      shifts_total: memberShifts.length,
      shifts_planned: planned,
      shifts_confirmed: confirmed,
      shifts_present: present,
      shifts_late: late,
      shifts_absent: absent,
      shifts_cancelled: cancelled,
      attendance_recorded: attendance,
      presence_rate: attendance === 0 ? null : round4(present / attendance),
      last_shift_date: lastDate,
    };
  });

  rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return rows;
}

// ————————————————————————————————————————————————————————————————
// Lecture défensive du résultat de la vue (côté front) — typage sûr, jamais de valeur fabriquée
// ————————————————————————————————————————————————————————————————

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// presence_rate peut arriver en number, en string numérique (numeric PG) ou null. On ne fabrique JAMAIS
// un taux : une valeur illisible ou absente reste null (assiduité inconnue), pas 0.
function toRate(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? round4(n) : null;
}

function toText(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function toNullableText(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === "string" ? v : String(v);
  return s.trim() === "" ? null : s;
}

// Convertit le résultat brut de supabase.from('staff_performance_v1').select('*') en lignes typées.
// Toute entrée non-objet est ignorée (aucune ligne fantôme). Ordre stable : tri par nom.
export function parseStaffPerformanceRows(raw: unknown): StaffPerformanceRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: StaffPerformanceRow[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (r.staff_member_id == null) continue;
    rows.push({
      staff_member_id: toText(r.staff_member_id),
      username: toText(r.username),
      full_name: toText(r.full_name),
      poste: toNullableText(r.poste),
      actif: r.actif === true || r.actif === "true",
      shifts_total: toInt(r.shifts_total),
      shifts_planned: toInt(r.shifts_planned),
      shifts_confirmed: toInt(r.shifts_confirmed),
      shifts_present: toInt(r.shifts_present),
      shifts_late: toInt(r.shifts_late),
      shifts_absent: toInt(r.shifts_absent),
      shifts_cancelled: toInt(r.shifts_cancelled),
      attendance_recorded: toInt(r.attendance_recorded),
      presence_rate: toRate(r.presence_rate),
      last_shift_date: toNullableText(r.last_shift_date),
    });
  }
  rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return rows;
}

// ————————————————————————————————————————————————————————————————
// Totaux d'équipe honnêtes
// ————————————————————————————————————————————————————————————————

export type StaffPerformanceTeamTotals = {
  staffTracked: number; // nombre de salariés dans le tableau
  staffActifs: number; // salariés actifs
  shiftsTotal: number; // total de shifts tous salariés
  presentsTotal: number; // total présents (present + retard)
  latesTotal: number; // total retards
  absentsTotal: number; // total absents
  attendanceRecordedTotal: number; // total décisions de présence enregistrées
  teamPresenceRate: number | null; // présents / décisions ; null si AUCUNE décision enregistrée
};

// Agrège les lignes en totaux d'équipe. Le taux d'équipe est recalculé sur les totaux (jamais une
// moyenne de taux), et reste null tant qu'aucune présence n'a été enregistrée pour personne.
export function staffPerformanceTeamTotals(rows: StaffPerformanceRow[]): StaffPerformanceTeamTotals {
  let shiftsTotal = 0;
  let presentsTotal = 0;
  let latesTotal = 0;
  let absentsTotal = 0;
  let attendanceRecordedTotal = 0;
  let staffActifs = 0;

  for (const r of rows) {
    shiftsTotal += r.shifts_total;
    presentsTotal += r.shifts_present;
    latesTotal += r.shifts_late;
    absentsTotal += r.shifts_absent;
    attendanceRecordedTotal += r.attendance_recorded;
    if (r.actif) staffActifs += 1;
  }

  return {
    staffTracked: rows.length,
    staffActifs,
    shiftsTotal,
    presentsTotal,
    latesTotal,
    absentsTotal,
    attendanceRecordedTotal,
    teamPresenceRate: attendanceRecordedTotal === 0 ? null : round4(presentsTotal / attendanceRecordedTotal),
  };
}

// ————————————————————————————————————————————————————————————————
// États vides / affichage honnêtes
// ————————————————————————————————————————————————————————————————

// Reflet de ce que le tableau contient réellement, pour un bandeau d'état honnête.
export function performanceDataReady(rows: StaffPerformanceRow[]): {
  hasStaff: boolean;
  hasShifts: boolean;
  hasAttendance: boolean;
} {
  let hasShifts = false;
  let hasAttendance = false;
  for (const r of rows) {
    if (r.shifts_total > 0) hasShifts = true;
    if (r.attendance_recorded > 0) hasAttendance = true;
  }
  return { hasStaff: rows.length > 0, hasShifts, hasAttendance };
}

// Formate un taux de présence [0..1] en pourcentage. "—" si null (assiduité non renseignée), jamais 0 %.
export function formatPresenceRate(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}
