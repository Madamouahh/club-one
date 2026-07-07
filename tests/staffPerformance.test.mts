import assert from "node:assert/strict";
import test from "node:test";

import type { StaffMember, StaffShift } from "../lib/rhPlanning.ts";
import {
  formatPresenceRate,
  parseStaffPerformanceRows,
  performanceDataReady,
  staffPerformanceTeamTotals,
  summarizeStaffPerformance,
  type StaffPerformanceRow,
} from "../lib/staffPerformance.ts";

function member(over: Partial<StaffMember> = {}): StaffMember {
  return {
    id: over.id ?? "m1",
    username: over.username ?? "jeremy",
    full_name: over.full_name ?? "Jeremy",
    poste: over.poste ?? "bar",
    contrat_type: over.contrat_type ?? "cdi",
    taux_horaire: over.taux_horaire ?? null,
    actif: over.actif ?? true,
    notes_direction: over.notes_direction ?? null,
  };
}

function shift(over: Partial<StaffShift> = {}): StaffShift {
  return {
    id: over.id ?? "s1",
    staff_member_id: over.staff_member_id ?? "m1",
    event_id: over.event_id ?? null,
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    poste: over.poste ?? null,
    planned_start: over.planned_start ?? null,
    planned_end: over.planned_end ?? null,
    actual_start: over.actual_start ?? null,
    actual_end: over.actual_end ?? null,
    status: over.status ?? "planifie",
    commentaire: over.commentaire ?? null,
  };
}

// ————————————————————————————————————————————————————————————————
// summarizeStaffPerformance — agrégation honnête
// ————————————————————————————————————————————————————————————————

test("empty base ships an empty table — nothing fabricated", () => {
  assert.deepEqual(summarizeStaffPerformance([], []), []);
  const totals = staffPerformanceTeamTotals([]);
  assert.equal(totals.staffTracked, 0);
  assert.equal(totals.presentsTotal, 0);
  assert.equal(totals.teamPresenceRate, null);
  assert.deepEqual(performanceDataReady([]), { hasStaff: false, hasShifts: false, hasAttendance: false });
});

test("a member with no shift gets an honest zero row, presence_rate null (never 0%)", () => {
  const rows = summarizeStaffPerformance([member({ id: "m1" })], []);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.shifts_total, 0);
  assert.equal(r.shifts_planned, 0);
  assert.equal(r.attendance_recorded, 0);
  assert.equal(r.presence_rate, null);
  assert.equal(r.last_shift_date, null);
  assert.equal(formatPresenceRate(r.presence_rate), "—");
  // état vide honnête : des salariés existent mais aucun shift
  assert.deepEqual(performanceDataReady(rows), { hasStaff: true, hasShifts: false, hasAttendance: false });
});

test("status buckets are counted exactly (planned / confirmed / present / late / absent / cancelled)", () => {
  const shifts = [
    shift({ id: "a", exploitation_date: "2026-07-01", status: "planifie" }),
    shift({ id: "b", exploitation_date: "2026-07-02", status: "confirme" }),
    shift({ id: "c", exploitation_date: "2026-07-03", status: "present" }),
    shift({ id: "d", exploitation_date: "2026-07-04", status: "retard" }),
    shift({ id: "e", exploitation_date: "2026-07-05", status: "absent" }),
    shift({ id: "f", exploitation_date: "2026-07-06", status: "annule" }),
  ];
  const [r] = summarizeStaffPerformance([member({ id: "m1" })], shifts);
  assert.equal(r.shifts_total, 6);
  assert.equal(r.shifts_planned, 4); // planifie + confirme + present + retard
  assert.equal(r.shifts_confirmed, 3); // confirme + present + retard
  assert.equal(r.shifts_present, 2); // present + retard
  assert.equal(r.shifts_late, 1); // retard
  assert.equal(r.shifts_absent, 1); // absent
  assert.equal(r.shifts_cancelled, 1); // annule
  assert.equal(r.attendance_recorded, 3); // present + retard + absent
  assert.equal(r.presence_rate, 0.6667); // 2 / 3, arrondi 4 décimales
  assert.equal(r.last_shift_date, "2026-07-06"); // max exploitation_date
});

test("a late present still counts as present (showed up), and is flagged as late", () => {
  const shifts = [shift({ id: "l", status: "retard", exploitation_date: "2026-07-03" })];
  const [r] = summarizeStaffPerformance([member({ id: "m1" })], shifts);
  assert.equal(r.shifts_present, 1);
  assert.equal(r.shifts_late, 1);
  assert.equal(r.presence_rate, 1); // 1 présent / 1 décision enregistrée
});

test("cancelled shifts never count in attendance denominator (no phantom absence)", () => {
  const shifts = [
    shift({ id: "p", status: "present", exploitation_date: "2026-07-03" }),
    shift({ id: "x", status: "annule", exploitation_date: "2026-07-04" }),
  ];
  const [r] = summarizeStaffPerformance([member({ id: "m1" })], shifts);
  assert.equal(r.attendance_recorded, 1); // seul le présent ; l'annulé n'ouvre pas de décision
  assert.equal(r.presence_rate, 1);
  assert.equal(r.shifts_cancelled, 1);
});

test("orphan shifts (no matching member) are ignored — no phantom row", () => {
  const shifts = [shift({ id: "o", staff_member_id: "ghost", status: "present" })];
  const rows = summarizeStaffPerformance([member({ id: "m1" })], shifts);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shifts_total, 0);
});

test("rows are sorted by full_name", () => {
  const rows = summarizeStaffPerformance(
    [member({ id: "b", full_name: "Zoe" }), member({ id: "a", full_name: "Alice" })],
    [],
  );
  assert.deepEqual(rows.map((r) => r.full_name), ["Alice", "Zoe"]);
});

// ————————————————————————————————————————————————————————————————
// Totaux d'équipe — taux recalculé sur les totaux, jamais une moyenne de taux
// ————————————————————————————————————————————————————————————————

test("team presence rate is computed over totals, not an average of per-staff rates", () => {
  const members = [member({ id: "m1", full_name: "A" }), member({ id: "m2", full_name: "B" })];
  const shifts = [
    // m1 : 1 présent / 1 décision (100%)
    shift({ id: "p1", staff_member_id: "m1", status: "present", exploitation_date: "2026-07-03" }),
    // m2 : 1 présent + 3 absents → 1/4 (25%)
    shift({ id: "p2", staff_member_id: "m2", status: "present", exploitation_date: "2026-07-03" }),
    shift({ id: "a1", staff_member_id: "m2", status: "absent", exploitation_date: "2026-07-04" }),
    shift({ id: "a2", staff_member_id: "m2", status: "absent", exploitation_date: "2026-07-05" }),
    shift({ id: "a3", staff_member_id: "m2", status: "absent", exploitation_date: "2026-07-06" }),
  ];
  const rows = summarizeStaffPerformance(members, shifts);
  const totals = staffPerformanceTeamTotals(rows);
  assert.equal(totals.presentsTotal, 2);
  assert.equal(totals.absentsTotal, 3);
  assert.equal(totals.attendanceRecordedTotal, 5);
  // 2 présents / 5 décisions = 0.4 — PAS la moyenne des taux (1.0 + 0.25)/2 = 0.625
  assert.equal(totals.teamPresenceRate, 0.4);
});

test("team rate stays null while no attendance was ever recorded (planned-only)", () => {
  const rows = summarizeStaffPerformance(
    [member({ id: "m1" })],
    [shift({ id: "pl", status: "planifie", exploitation_date: "2026-07-03" })],
  );
  const totals = staffPerformanceTeamTotals(rows);
  assert.equal(totals.shiftsTotal, 1);
  assert.equal(totals.attendanceRecordedTotal, 0);
  assert.equal(totals.teamPresenceRate, null);
  assert.deepEqual(performanceDataReady(rows), { hasStaff: true, hasShifts: true, hasAttendance: false });
});

test("staffActifs counts only active members", () => {
  const rows = summarizeStaffPerformance(
    [member({ id: "m1", actif: true }), member({ id: "m2", actif: false })],
    [],
  );
  const totals = staffPerformanceTeamTotals(rows);
  assert.equal(totals.staffTracked, 2);
  assert.equal(totals.staffActifs, 1);
});

// ————————————————————————————————————————————————————————————————
// parseStaffPerformanceRows — lecture défensive du résultat de la vue
// ————————————————————————————————————————————————————————————————

test("parse coerces numeric strings (PG numeric) and null rate; ignores non-objects", () => {
  const raw = [
    {
      staff_member_id: "m1",
      username: "jeremy",
      full_name: "Jeremy",
      poste: "bar",
      actif: true,
      shifts_total: "5",
      shifts_planned: "4",
      shifts_confirmed: "3",
      shifts_present: "2",
      shifts_late: "1",
      shifts_absent: "1",
      shifts_cancelled: "0",
      attendance_recorded: "3",
      presence_rate: "0.6667",
      last_shift_date: "2026-07-06",
    },
    null,
    "garbage",
    { username: "no-id" }, // sans staff_member_id → ignoré
  ];
  const rows = parseStaffPerformanceRows(raw);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.shifts_total, 5);
  assert.equal(r.shifts_present, 2);
  assert.equal(r.presence_rate, 0.6667);
  assert.equal(r.poste, "bar");
});

test("parse keeps presence_rate null when absent/illegible — never fabricates 0", () => {
  const rows = parseStaffPerformanceRows([
    { staff_member_id: "m1", full_name: "A", presence_rate: null, attendance_recorded: 0 },
    { staff_member_id: "m2", full_name: "B", presence_rate: "not-a-number" },
  ]);
  assert.equal(rows[0].presence_rate, null);
  assert.equal(rows[1].presence_rate, null);
});

test("parse on non-array input yields empty (defensive)", () => {
  assert.deepEqual(parseStaffPerformanceRows(null), []);
  assert.deepEqual(parseStaffPerformanceRows(undefined), []);
  assert.deepEqual(parseStaffPerformanceRows({}), []);
});

// ————————————————————————————————————————————————————————————————
// formatPresenceRate — affichage honnête
// ————————————————————————————————————————————————————————————————

test("formatPresenceRate shows a dash for null and a percent otherwise", () => {
  assert.equal(formatPresenceRate(null), "—");
  assert.equal(formatPresenceRate(1), "100%");
  assert.equal(formatPresenceRate(0.6667), "66.7%");
  assert.equal(formatPresenceRate(0), "0%");
});

// Parité conceptuelle : la vue SQL 0066 doit reproduire summarizeStaffPerformance. Ce test documente
// la forme attendue d'une ligne de la vue (mêmes colonnes) pour ancrer le contrat côté TS.
test("parsed view row and summarized row share the same shape/contract", () => {
  const [summarized] = summarizeStaffPerformance(
    [member({ id: "m1", full_name: "Jeremy", username: "jeremy", poste: "bar" })],
    [
      shift({ id: "p", status: "present", exploitation_date: "2026-07-03" }),
      shift({ id: "a", status: "absent", exploitation_date: "2026-07-04" }),
    ],
  );
  const fromView: StaffPerformanceRow = parseStaffPerformanceRows([
    {
      staff_member_id: "m1",
      username: "jeremy",
      full_name: "Jeremy",
      poste: "bar",
      actif: true,
      shifts_total: 2,
      shifts_planned: 1,
      shifts_confirmed: 1,
      shifts_present: 1,
      shifts_late: 0,
      shifts_absent: 1,
      shifts_cancelled: 0,
      attendance_recorded: 2,
      presence_rate: 0.5,
      last_shift_date: "2026-07-04",
    },
  ])[0];
  assert.deepEqual(fromView, summarized);
});
