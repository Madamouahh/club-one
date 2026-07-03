import assert from "node:assert/strict";
import test from "node:test";

import type { StaffMember, StaffShift } from "../lib/rhPlanning.ts";
import {
  buildMonthlyStaffRollups,
  buildPeriodStaffRollup,
  distinctExploitationDates,
  monthKey,
  periodStaffChargeAmount,
  rollupDataReady,
} from "../lib/rhRollup.ts";

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

// Un shift PRÉSENT et pointé (present + horaires réels) sur une date donnée.
function presentShift(date: string, memberId: string, hStart: string, hEnd: string, id: string): StaffShift {
  return shift({
    id,
    staff_member_id: memberId,
    exploitation_date: date,
    status: "present",
    actual_start: `${date}T${hStart}:00.000Z`,
    actual_end: `${date}T${hEnd}:00.000Z`,
  });
}

test("monthKey extracts YYYY-MM and rejects garbage", () => {
  assert.equal(monthKey("2026-07-03"), "2026-07");
  assert.equal(monthKey("2026-12-31"), "2026-12");
  assert.equal(monthKey("nope"), "");
  assert.equal(monthKey("2026-7-3"), "");
});

test("distinctExploitationDates dedups and sorts ascending", () => {
  const shifts = [
    shift({ id: "a", exploitation_date: "2026-07-10" }),
    shift({ id: "b", exploitation_date: "2026-07-03" }),
    shift({ id: "c", exploitation_date: "2026-07-10" }),
  ];
  assert.deepEqual(distinctExploitationDates(shifts), ["2026-07-03", "2026-07-10"]);
});

test("empty period ships honest zeros — nothing fabricated", () => {
  const r = buildPeriodStaffRollup([], []);
  assert.equal(r.nightsTotal, 0);
  assert.equal(r.nightsWithPresents, 0);
  assert.equal(r.presentsTotal, 0);
  assert.equal(r.heuresPlanifieesTotal, 0);
  assert.equal(r.heuresReellesTotal, null);
  assert.equal(r.coutStaffCumul, null);
  assert.equal(r.coutComplet, false);
  assert.equal(periodStaffChargeAmount(r), null);
  const ready = rollupDataReady(r);
  assert.deepEqual(ready, { hasNights: false, hasPresents: false, hasCost: false, costPartial: false });
});

test("two fully-costed nights aggregate into a complete cumulative cost", () => {
  const members = [member({ id: "m1", taux_horaire: 12 })];
  const shifts = [
    // nuit 1 : 4 h réelles → 48 €
    presentShift("2026-07-03", "m1", "22:00", "02:00", "n1"),
    // nuit 2 : 5 h réelles → 60 €
    presentShift("2026-07-10", "m1", "22:00", "03:00", "n2"),
  ];
  const r = buildPeriodStaffRollup(shifts, members);
  assert.equal(r.nightsTotal, 2);
  assert.equal(r.nightsWithPresents, 2);
  assert.equal(r.presentsTotal, 2);
  assert.equal(r.heuresReellesTotal, 9); // 4 + 5 (passage minuit géré par summarizeMasseHoraire)
  assert.equal(r.coutStaffCumul, 108); // 48 + 60
  assert.equal(r.coutComplet, true);
  assert.equal(r.nightsSansCoutComplet, 0);
  assert.equal(r.presentsSansTaux, 0);
  assert.equal(periodStaffChargeAmount(r), 108); // branchable : cumul complet
  assert.deepEqual(rollupDataReady(r), {
    hasNights: true,
    hasPresents: true,
    hasCost: true,
    costPartial: false,
  });
});

test("one night with an unpriced present makes the whole cumul incomplete (never a truncated total)", () => {
  const members = [member({ id: "m1", taux_horaire: 12 }), member({ id: "m2", taux_horaire: null })];
  const shifts = [
    // nuit 1 : m1 chiffré (48 €)
    presentShift("2026-07-03", "m1", "22:00", "02:00", "n1a"),
    // nuit 2 : m1 chiffré (48 €) + m2 présent SANS taux → coût de la nuit partiel
    presentShift("2026-07-10", "m1", "22:00", "02:00", "n2a"),
    presentShift("2026-07-10", "m2", "22:00", "02:00", "n2b"),
  ];
  const r = buildPeriodStaffRollup(shifts, members);
  assert.equal(r.presentsTotal, 3);
  assert.equal(r.coutStaffCumul, 96); // 48 + 48 (m2 non chiffrable, jamais 0 inventé)
  assert.equal(r.coutComplet, false); // une nuit reste partielle
  assert.equal(r.nightsSansCoutComplet, 1);
  assert.equal(r.presentsSansTaux, 1);
  assert.equal(periodStaffChargeAmount(r), null); // jamais branché tant que partiel
  assert.equal(rollupDataReady(r).costPartial, true);
});

test("planned-only nights count hours but carry no real cost", () => {
  const members = [member({ id: "m1", taux_horaire: 20 })];
  const shifts = [
    shift({
      id: "p1",
      staff_member_id: "m1",
      exploitation_date: "2026-07-03",
      status: "planifie",
      planned_start: "2026-07-03T22:00:00.000Z",
      planned_end: "2026-07-04T02:00:00.000Z",
    }),
  ];
  const r = buildPeriodStaffRollup(shifts, members);
  assert.equal(r.nightsTotal, 1);
  assert.equal(r.nightsWithPresents, 0); // planifié ≠ présent
  assert.equal(r.heuresPlanifieesTotal, 4);
  assert.equal(r.heuresReellesTotal, null);
  assert.equal(r.coutStaffCumul, null);
  assert.equal(r.coutComplet, false); // pas de présent → pas de coût « complet » à revendiquer
  assert.equal(periodStaffChargeAmount(r), null);
});

test("monthly rollups split by calendar month, sorted, priced independently", () => {
  const members = [member({ id: "m1", taux_horaire: 10 })];
  const shifts = [
    presentShift("2026-06-27", "m1", "22:00", "00:00", "jun1"), // juin : 2 h → 20 €
    presentShift("2026-07-03", "m1", "22:00", "01:00", "jul1"), // juillet : 3 h → 30 €
    presentShift("2026-07-10", "m1", "22:00", "01:00", "jul2"), // juillet : 3 h → 30 €
  ];
  const months = buildMonthlyStaffRollups(shifts, members);
  assert.deepEqual(months.map((m) => m.month), ["2026-06", "2026-07"]);
  assert.equal(months[0].rollup.coutStaffCumul, 20);
  assert.equal(months[0].rollup.nightsTotal, 1);
  assert.equal(months[1].rollup.coutStaffCumul, 60);
  assert.equal(months[1].rollup.nightsTotal, 2);
  assert.equal(months[1].rollup.coutComplet, true);
});

test("shifts with an unreadable date are ignored by the monthly rollup (no phantom 'unknown month')", () => {
  const members = [member({ id: "m1", taux_horaire: 10 })];
  const shifts = [
    presentShift("2026-07-03", "m1", "22:00", "00:00", "ok1"),
    shift({ id: "bad", staff_member_id: "m1", exploitation_date: "not-a-date", status: "present" }),
  ];
  const months = buildMonthlyStaffRollups(shifts, members);
  assert.deepEqual(months.map((m) => m.month), ["2026-07"]);
});

test("absents are tallied but never counted as presents or cost", () => {
  const members = [member({ id: "m1", taux_horaire: 15 }), member({ id: "m2", taux_horaire: 15 })];
  const shifts = [
    presentShift("2026-07-03", "m1", "22:00", "02:00", "pres"),
    shift({ id: "abs", staff_member_id: "m2", exploitation_date: "2026-07-03", status: "absent" }),
  ];
  const r = buildPeriodStaffRollup(shifts, members);
  assert.equal(r.presentsTotal, 1);
  assert.equal(r.absentsTotal, 1);
  assert.equal(r.coutStaffCumul, 60); // seul le présent est chiffré (4 h × 15)
  assert.equal(r.coutComplet, true); // l'absent n'ouvre pas un « présent sans coût »
});
