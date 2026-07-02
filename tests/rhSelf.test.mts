import assert from "node:assert/strict";
import test from "node:test";

import {
  SHIFT_STATUS_LABELS,
  canSelfConfirm,
  shiftStatusLabel,
  splitMyShifts,
  summarizeMyHours,
} from "../lib/rhSelf.ts";
import type { StaffShift } from "../lib/rhPlanning.ts";

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

// Aujourd'hui de référence pour tous les tests de date (injecté, jamais Date.now()).
const TODAY = new Date("2026-07-03T12:00:00Z");

test("labels cover every real status and nothing else", () => {
  assert.deepEqual(Object.keys(SHIFT_STATUS_LABELS).sort(), [
    "absent",
    "annule",
    "confirme",
    "planifie",
    "present",
    "retard",
  ]);
  assert.equal(shiftStatusLabel("planifie"), "Planifié");
  assert.equal(shiftStatusLabel("confirme"), "Confirmé");
});

test("only a 'planifie' shift is self-confirmable (miroir de confirm_my_shift_v1)", () => {
  assert.equal(canSelfConfirm(shift({ status: "planifie" })), true);
  // Déjà confirmé, ou traité par la direction : plus de 1-tap salarié.
  assert.equal(canSelfConfirm(shift({ status: "confirme" })), false);
  assert.equal(canSelfConfirm(shift({ status: "present" })), false);
  assert.equal(canSelfConfirm(shift({ status: "absent" })), false);
  assert.equal(canSelfConfirm(shift({ status: "retard" })), false);
  assert.equal(canSelfConfirm(shift({ status: "annule" })), false);
});

test("splitMyShifts sépare à venir / passé, le jour même compte comme à venir", () => {
  const past = shift({ id: "p", exploitation_date: "2026-06-20" });
  const today = shift({ id: "t", exploitation_date: "2026-07-03" });
  const soon = shift({ id: "s", exploitation_date: "2026-07-10" });
  const later = shift({ id: "l", exploitation_date: "2026-07-25" });

  const res = splitMyShifts([later, past, today, soon], TODAY);
  // À venir : du plus proche au plus lointain, jour même inclus.
  assert.deepEqual(res.upcoming.map((s) => s.id), ["t", "s", "l"]);
  // Passé : du plus récent au plus ancien.
  assert.deepEqual(res.past.map((s) => s.id), ["p"]);
  assert.deepEqual(res.undated, []);
});

test("splitMyShifts isole une date illisible au lieu de l'inventer", () => {
  const bad = shift({ id: "x", exploitation_date: "pas-une-date" });
  const res = splitMyShifts([bad], TODAY);
  assert.deepEqual(res.undated.map((s) => s.id), ["x"]);
  assert.equal(res.upcoming.length, 0);
  assert.equal(res.past.length, 0);
});

test("summarizeMyHours : heures réelles restent null tant qu'aucun créneau n'est pointé", () => {
  const only = summarizeMyHours(
    [
      shift({ id: "a", exploitation_date: "2026-07-10", status: "planifie", planned_start: "2026-07-10T23:00:00.000Z", planned_end: "2026-07-11T05:00:00.000Z" }),
      shift({ id: "b", exploitation_date: "2026-07-17", status: "confirme" }),
    ],
    TODAY,
  );
  assert.equal(only.shiftsTotal, 2);
  assert.equal(only.aVenir, 2);
  assert.equal(only.passes, 0);
  assert.equal(only.aConfirmer, 1); // seul le 'planifie' reste à confirmer
  assert.equal(only.presents, 0);
  assert.equal(only.absents, 0);
  // Aucun pointage réel → null (jamais 0 h affiché comme un fait).
  assert.equal(only.heuresReellesCumul, null);
  // Heures prévues des créneaux à venir : 23h→05h = 6 h (passage de minuit géré par plannedHours).
  assert.equal(only.heuresPlanifieesAvenir, 6);
});

test("summarizeMyHours : cumul des heures réelles pointées, absents comptés, pas de coût exposé", () => {
  const res = summarizeMyHours(
    [
      shift({ id: "p1", exploitation_date: "2026-06-20", status: "present", actual_start: "2026-06-20T23:00:00.000Z", actual_end: "2026-06-21T04:00:00.000Z" }), // 5 h
      shift({ id: "p2", exploitation_date: "2026-06-13", status: "retard", actual_start: "2026-06-14T00:00:00.000Z", actual_end: "2026-06-14T03:30:00.000Z" }), // 3.5 h
      shift({ id: "ab", exploitation_date: "2026-06-06", status: "absent" }),
    ],
    TODAY,
  );
  assert.equal(res.passes, 3);
  assert.equal(res.aVenir, 0);
  assert.equal(res.presents, 2); // present + retard
  assert.equal(res.absents, 1);
  assert.equal(res.aConfirmer, 0);
  assert.equal(res.heuresReellesCumul, 8.5); // 5 + 3.5, honnête (seuls les pointés comptent)
  assert.equal(res.heuresPlanifieesAvenir, 0); // aucun créneau à venir
  // La synthèse salarié n'expose AUCUN champ de coût (le taux horaire reste en vue direction).
  assert.equal(Object.prototype.hasOwnProperty.call(res, "coutStaff"), false);
});

test("summarizeMyHours : un présent sans horaire pointé ne fabrique aucune heure", () => {
  const res = summarizeMyHours(
    [shift({ id: "p", exploitation_date: "2026-06-20", status: "present" })],
    TODAY,
  );
  assert.equal(res.presents, 1);
  // Présent mais horaires réels absents → aucune heure inventée, cumul reste null.
  assert.equal(res.heuresReellesCumul, null);
});
