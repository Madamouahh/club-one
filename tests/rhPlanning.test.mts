import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRAT_TYPES,
  SHIFT_STATUSES,
  actualHours,
  buildShiftInstants,
  hoursBetween,
  instantToHHMM,
  isContratType,
  isShiftStatus,
  normalizeUsername,
  parseTauxHoraire,
  plannedHours,
  rhDataReady,
  shiftCost,
  staffChargeAmount,
  summarizeMasseHoraire,
  toShiftInstant,
  validateShiftDraft,
  validateStaffMemberDraft,
  type StaffMember,
  type StaffShift,
} from "../lib/rhPlanning.ts";

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

test("guards recognise only real contract types and shift statuses", () => {
  assert.deepEqual([...CONTRAT_TYPES], ["cdi", "cdd", "extra", "prestataire", "stage"]);
  assert.deepEqual([...SHIFT_STATUSES], [
    "planifie",
    "confirme",
    "present",
    "absent",
    "retard",
    "annule",
  ]);
  assert.equal(isContratType("extra"), true);
  assert.equal(isContratType("freelance"), false);
  assert.equal(isShiftStatus("retard"), true);
  assert.equal(isShiftStatus("late"), false);
});

test("hoursBetween returns null on missing/invalid times, never a fabricated duration", () => {
  assert.equal(hoursBetween(null, "2026-07-03T05:00:00Z"), null);
  assert.equal(hoursBetween("2026-07-03T23:00:00Z", null), null);
  assert.equal(hoursBetween("pas-une-date", "2026-07-03T05:00:00Z"), null);
});

test("hoursBetween handles a normal evening and a shift crossing midnight", () => {
  // 22:00 → 02:00 (le lendemain) = 4 h, la fin est « avant » le début dans la même date ISO.
  assert.equal(hoursBetween("2026-07-03T22:00:00Z", "2026-07-04T02:00:00Z"), 4);
  // même horaire exprimé sans changement de jour → +24 h appliqué une fois.
  assert.equal(hoursBetween("2026-07-03T22:00:00Z", "2026-07-03T02:00:00Z"), 4);
  assert.equal(hoursBetween("2026-07-03T21:30:00Z", "2026-07-04T05:00:00Z"), 7.5);
});

test("planned vs actual hours respect the shift status", () => {
  const planned = shift({
    status: "confirme",
    planned_start: "2026-07-03T22:00:00Z",
    planned_end: "2026-07-04T04:00:00Z",
  });
  assert.equal(plannedHours(planned), 6);
  // pas de pointage → heures réelles null (aucune heure inventée)
  assert.equal(actualHours(planned), null);

  const annule = shift({ status: "annule", planned_start: "2026-07-03T22:00:00Z", planned_end: "2026-07-04T04:00:00Z" });
  assert.equal(plannedHours(annule), null); // shift annulé : hors prévisionnel

  const present = shift({
    status: "present",
    actual_start: "2026-07-03T22:15:00Z",
    actual_end: "2026-07-04T05:15:00Z",
  });
  assert.equal(actualHours(present), 7);
});

test("shiftCost stays null unless both a real rate and real hours exist", () => {
  const present = shift({ status: "present", actual_start: "2026-07-03T22:00:00Z", actual_end: "2026-07-04T02:00:00Z" });
  // taux horaire non renseigné → pas de coût
  assert.equal(shiftCost(present, member({ taux_horaire: null })), null);
  // taux renseigné + 4 h → 4 × 15 = 60
  assert.equal(shiftCost(present, member({ taux_horaire: 15 })), 60);
  // pas de membre du tout
  assert.equal(shiftCost(present, undefined), null);
  // taux OK mais pas pointé (planifie) → null
  const planifie = shift({ status: "planifie", planned_start: "2026-07-03T22:00:00Z", planned_end: "2026-07-04T02:00:00Z" });
  assert.equal(shiftCost(planifie, member({ taux_horaire: 15 })), null);
});

test("summarizeMasseHoraire aggregates one night without inventing costs", () => {
  const members = [
    member({ id: "m1", username: "jeremy", taux_horaire: 15 }),
    member({ id: "m2", username: "sarah", taux_horaire: null }), // taux manquant → coût incalculable
    member({ id: "m3", username: "leo", taux_horaire: 20 }),
  ];
  const shifts = [
    shift({ id: "s1", staff_member_id: "m1", status: "present", actual_start: "2026-07-03T22:00:00Z", actual_end: "2026-07-04T04:00:00Z" }), // 6 h × 15 = 90
    shift({ id: "s2", staff_member_id: "m2", status: "present", actual_start: "2026-07-03T22:00:00Z", actual_end: "2026-07-04T04:00:00Z" }), // 6 h, pas de taux
    shift({ id: "s3", staff_member_id: "m3", status: "absent" }),
    shift({ id: "s4", staff_member_id: "m1", exploitation_date: "2026-07-10", status: "present", actual_start: "2026-07-10T22:00:00Z", actual_end: "2026-07-11T02:00:00Z" }), // autre soirée, ignoré
  ];

  const masse = summarizeMasseHoraire("2026-07-03", shifts, members);
  assert.equal(masse.shiftsTotal, 3); // s4 exclu (autre date)
  assert.equal(masse.presents, 2);
  assert.equal(masse.absents, 1);
  assert.equal(masse.heuresReelles, 12); // 6 + 6
  assert.equal(masse.coutStaff, 90); // uniquement m1 (m2 sans taux)
  assert.equal(masse.presentsSansTaux, 1);
  assert.equal(masse.coutComplet, false); // un présent sans coût → incomplet
  // charge P&L : refuse un coût partiel → null tant que ce n'est pas complet
  assert.equal(staffChargeAmount(masse), null);
});

test("summarizeMasseHoraire yields a complete cost only when every present is costed", () => {
  const members = [member({ id: "m1", taux_horaire: 15 }), member({ id: "m2", username: "leo", taux_horaire: 20 })];
  const shifts = [
    shift({ id: "s1", staff_member_id: "m1", status: "present", actual_start: "2026-07-03T22:00:00Z", actual_end: "2026-07-04T04:00:00Z" }), // 6 × 15 = 90
    shift({ id: "s2", staff_member_id: "m2", status: "retard", actual_start: "2026-07-03T23:00:00Z", actual_end: "2026-07-04T04:00:00Z" }), // 5 × 20 = 100
  ];
  const masse = summarizeMasseHoraire("2026-07-03", shifts, members);
  assert.equal(masse.presents, 2);
  assert.equal(masse.presentsSansTaux, 0);
  assert.equal(masse.coutStaff, 190);
  assert.equal(masse.coutComplet, true);
  assert.equal(staffChargeAmount(masse), 190); // coût complet → branché au P&L
});

test("empty night is honest: no shifts, no cost, nothing fabricated", () => {
  const masse = summarizeMasseHoraire("2026-07-03", [], []);
  assert.equal(masse.shiftsTotal, 0);
  assert.equal(masse.presents, 0);
  assert.equal(masse.heuresReelles, null);
  assert.equal(masse.coutStaff, null);
  assert.equal(masse.coutComplet, false);
  assert.equal(staffChargeAmount(masse), null);
});

test("rhDataReady reflects exactly what the founder has provided", () => {
  const empty = rhDataReady([]);
  assert.deepEqual(empty, { total: 0, actifs: 0, withTaux: 0 });

  const some = rhDataReady([
    member({ id: "m1", taux_horaire: 15, actif: true }),
    member({ id: "m2", taux_horaire: null, actif: true }),
    member({ id: "m3", taux_horaire: 20, actif: false }),
  ]);
  assert.deepEqual(some, { total: 3, actifs: 2, withTaux: 2 });
});

// ————————————————————————————————————————————————————————————————
// Saisie (write) — validation des formulaires direction
// ————————————————————————————————————————————————————————————————

test("normalizeUsername lowercases and strips spaces (clé de rattachement staff)", () => {
  assert.equal(normalizeUsername("  Jeremy B "), "jeremyb");
  assert.equal(normalizeUsername("SARAH"), "sarah");
});

test("parseTauxHoraire: vide = null honnête, virgule FR ok, négatif/texte refusés", () => {
  assert.deepEqual(parseTauxHoraire(null), { ok: true, value: null });
  assert.deepEqual(parseTauxHoraire("   "), { ok: true, value: null });
  assert.deepEqual(parseTauxHoraire("12,50"), { ok: true, value: 12.5 });
  assert.deepEqual(parseTauxHoraire("15"), { ok: true, value: 15 });
  assert.equal(parseTauxHoraire("-3").ok, false);
  assert.equal(parseTauxHoraire("abc").ok, false);
});

test("validateStaffMemberDraft exige nom + identifiant, ne fabrique aucun taux", () => {
  const bad = validateStaffMemberDraft({
    fullName: "X",
    username: "jeremy",
    poste: null,
    contratType: null,
    tauxHoraire: null,
    actif: true,
  });
  assert.equal(bad.ok, false); // nom trop court

  const badUser = validateStaffMemberDraft({
    fullName: "Jeremy Bar",
    username: "a b!",
    poste: null,
    contratType: null,
    tauxHoraire: null,
    actif: true,
  });
  assert.equal(badUser.ok, false); // identifiant invalide

  const badContrat = validateStaffMemberDraft({
    fullName: "Jeremy Bar",
    username: "jeremy",
    poste: "bar",
    contratType: "freelance",
    tauxHoraire: null,
    actif: true,
  });
  assert.equal(badContrat.ok, false); // contrat inconnu

  const ok = validateStaffMemberDraft({
    fullName: "  Jeremy Bar ",
    username: "  Jeremy ",
    poste: "  bar ",
    contratType: "extra",
    tauxHoraire: "13,5",
    actif: true,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.value, {
      full_name: "Jeremy Bar",
      username: "jeremy",
      poste: "bar",
      contrat_type: "extra",
      taux_horaire: 13.5,
      actif: true,
    });
  }

  // taux non fourni → reste null (jamais 0 fabriqué)
  const noTaux = validateStaffMemberDraft({
    fullName: "Sarah Accueil",
    username: "sarah",
    poste: null,
    contratType: null,
    tauxHoraire: "",
    actif: true,
  });
  assert.equal(noTaux.ok, true);
  if (noTaux.ok) assert.equal(noTaux.value.taux_horaire, null);
});

test("toShiftInstant construit un instant UTC déterministe, null si vide/invalide", () => {
  assert.equal(toShiftInstant("2026-07-03", "22:30"), "2026-07-03T22:30:00.000Z");
  assert.equal(toShiftInstant("2026-07-03", ""), null);
  assert.equal(toShiftInstant("2026-07-03", "25:00"), null);
  assert.equal(toShiftInstant("2026-07-03", "9:5"), null); // format strict HH:MM
});

test("buildShiftInstants pousse une fin ≤ début au lendemain (passage minuit)", () => {
  const i = buildShiftInstants("2026-07-03", {
    plannedStart: "22:00",
    plannedEnd: "02:00", // avant le début même jour → +1 jour
    actualStart: null,
    actualEnd: null,
  });
  assert.equal(i.planned_start, "2026-07-03T22:00:00.000Z");
  assert.equal(i.planned_end, "2026-07-04T02:00:00.000Z");
  assert.equal(i.actual_start, null);
  assert.equal(i.actual_end, null);

  // fin après le début le même soir → pas de décalage
  const j = buildShiftInstants("2026-07-03", {
    plannedStart: "18:00",
    plannedEnd: "23:00",
    actualStart: null,
    actualEnd: null,
  });
  assert.equal(j.planned_end, "2026-07-03T23:00:00.000Z");
});

test("instantToHHMM fait l'aller-retour (UTC, indépendant du fuseau)", () => {
  assert.equal(instantToHHMM("2026-07-04T02:00:00.000Z"), "02:00");
  assert.equal(instantToHHMM("2026-07-03T22:00:00+00:00"), "22:00");
  assert.equal(instantToHHMM(null), "");
  assert.equal(instantToHHMM("pas-une-date"), "");
});

test("validateShiftDraft refuse fin sans début et heure invalide, autorise présent sans horaire", () => {
  assert.equal(
    validateShiftDraft("2026-07-03", {
      status: "planifie",
      poste: null,
      plannedStart: null,
      plannedEnd: "02:00",
      actualStart: null,
      actualEnd: null,
    }).ok,
    false, // fin prévue sans début
  );

  assert.equal(
    validateShiftDraft("2026-07-03", {
      status: "confirme",
      poste: null,
      plannedStart: "aa:bb",
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
    }).ok,
    false, // heure invalide
  );

  assert.equal(
    validateShiftDraft("2026-07-03", {
      status: "late",
      poste: null,
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
    }).ok,
    false, // statut inconnu
  );

  // présent sans horaire réel : autorisé (la masse horaire le comptera « présent sans coût »)
  const present = validateShiftDraft("2026-07-03", {
    status: "present",
    poste: "bar",
    plannedStart: "22:00",
    plannedEnd: "05:00",
    actualStart: null,
    actualEnd: null,
  });
  assert.equal(present.ok, true);
  if (present.ok) {
    assert.equal(present.value.status, "present");
    assert.equal(present.value.poste, "bar");
    assert.equal(present.value.planned_start, "2026-07-03T22:00:00.000Z");
    assert.equal(present.value.planned_end, "2026-07-04T05:00:00.000Z");
    assert.equal(present.value.actual_start, null);
    assert.equal(present.value.actual_end, null);
  }
});
