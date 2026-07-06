// tests/eventManagement.test.mts — logique pure du module Gestion des soirées (lib/eventManagement.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_STATUSES,
  isEventStatus,
  validateStatusTransition,
  canManageEvents,
  validateEventDraft,
  isValidIsoDate,
  buildMonthGrid,
  daysInMonth,
  prevMonth,
  nextMonth,
  formatIsoDate,
  type CalendarEvent,
} from "../lib/eventManagement.ts";

test("gardes de rôle : seule la direction gère les soirées", () => {
  assert.equal(canManageEvents("admin"), true);
  assert.equal(canManageEvents("manager"), true);
  assert.equal(canManageEvents("server"), false);
  assert.equal(canManageEvents("promoter"), false);
  assert.equal(canManageEvents("security"), false);
});

test("isEventStatus reconnaît le vocabulaire de planification", () => {
  assert.deepEqual([...EVENT_STATUSES], ["draft", "published", "open", "closed"]);
  assert.equal(isEventStatus("open"), true);
  assert.equal(isEventStatus("archived"), false); // archived = runtime, pas éditable
  assert.equal(isEventStatus("wat"), false);
});

test("validateStatusTransition : transitions autorisées", () => {
  assert.equal(validateStatusTransition("draft", "published").ok, true);
  assert.equal(validateStatusTransition("draft", "closed").ok, true);
  assert.equal(validateStatusTransition("published", "open").ok, true);
  assert.equal(validateStatusTransition("published", "draft").ok, true);
  assert.equal(validateStatusTransition("published", "closed").ok, true);
  assert.equal(validateStatusTransition("open", "closed").ok, true);
  assert.equal(validateStatusTransition("open", "open").ok, true); // no-op autorisé
});

test("validateStatusTransition : transitions interdites", () => {
  assert.equal(validateStatusTransition("draft", "open").ok, false); // doit passer par published
  assert.equal(validateStatusTransition("closed", "open").ok, false); // terminal
  assert.equal(validateStatusTransition("closed", "draft").ok, false); // terminal
  assert.equal(validateStatusTransition("open", "published").ok, false);
  assert.equal(validateStatusTransition("archived", "draft").ok, false); // verrouillé
  assert.equal(validateStatusTransition("draft", "wat").ok, false); // cible inconnue
  assert.equal(validateStatusTransition("bogus", "draft").ok, false); // source inconnue
});

test("isValidIsoDate : format + aller-retour (rejette dates impossibles)", () => {
  assert.equal(isValidIsoDate("2026-07-07"), true);
  assert.equal(isValidIsoDate("2024-02-29"), true); // bissextile
  assert.equal(isValidIsoDate("2026-02-29"), false); // pas bissextile
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("2026-00-10"), false);
  assert.equal(isValidIsoDate("2026-7-7"), false); // non zéro-padé
  assert.equal(isValidIsoDate("07/07/2026"), false);
});

test("validateEventDraft", () => {
  assert.equal(validateEventDraft({ title: "" }).ok, false);
  assert.equal(validateEventDraft({ title: "Techno", event_date: "" }).ok, false);
  assert.equal(validateEventDraft({ title: "Techno", event_date: "2026-02-30" }).ok, false);
  assert.equal(validateEventDraft({ title: "Techno", event_date: "2026-07-07", status: "wat" }).ok, false);
  assert.equal(validateEventDraft({ title: "Techno", event_date: "2026-07-07", capacite: -1 }).ok, false);
  assert.equal(validateEventDraft({ title: "Techno", event_date: "2026-07-07", capacite: 1.5 }).ok, false);
  assert.equal(validateEventDraft({ title: "Techno", event_date: "2026-07-07", horaire_debut: "99:99" }).ok, false);
  assert.equal(
    validateEventDraft({ title: "Techno", event_date: "2026-07-07", status: "published", capacite: 400, horaire_debut: "23:30", horaire_fin: "05:00" }).ok,
    true,
  );
  // horaire souple accepté
  assert.equal(validateEventDraft({ title: "T", event_date: "2026-07-07", horaire_debut: "23h30" }).ok, true);
});

test("daysInMonth : mois standards, bissextile", () => {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29); // bissextile
  assert.equal(daysInMonth(2000, 2), 29); // séculaire divisible par 400
  assert.equal(daysInMonth(1900, 2), 28); // séculaire non divisible par 400
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test("prevMonth / nextMonth : bornes d'année", () => {
  assert.deepEqual(prevMonth(2026, 1), { year: 2025, month: 12 });
  assert.deepEqual(prevMonth(2026, 7), { year: 2026, month: 6 });
  assert.deepEqual(nextMonth(2026, 12), { year: 2027, month: 1 });
  assert.deepEqual(nextMonth(2026, 7), { year: 2026, month: 8 });
});

test("formatIsoDate : zéro-padding", () => {
  assert.equal(formatIsoDate(2026, 7, 7), "2026-07-07");
  assert.equal(formatIsoDate(2026, 12, 31), "2026-12-31");
});

test("buildMonthGrid : structure — semaines de 7 jours lundi→dimanche", () => {
  const grid = buildMonthGrid(2026, 7, []);
  assert.equal(grid.year, 2026);
  assert.equal(grid.month, 7);
  assert.equal(grid.label, "juillet 2026");
  for (const week of grid.weeks) assert.equal(week.length, 7);
  // toutes les cellules du mois cible sont présentes et marquées inMonth
  const inMonth = grid.weeks.flat().filter((d) => d.inMonth);
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth[0].date, "2026-07-01");
  assert.equal(inMonth[30].date, "2026-07-31");
});

test("buildMonthGrid : juillet 2026 commence un mercredi → 2 jours de juin en tête", () => {
  // 2026-07-01 est un mercredi ; lundi-first → 2 cellules débordantes (lun 29, mar 30 juin).
  const grid = buildMonthGrid(2026, 7, []);
  const firstWeek = grid.weeks[0];
  assert.equal(firstWeek[0].inMonth, false);
  assert.equal(firstWeek[0].date, "2026-06-29");
  assert.equal(firstWeek[1].date, "2026-06-30");
  assert.equal(firstWeek[2].inMonth, true);
  assert.equal(firstWeek[2].date, "2026-07-01");
});

test("buildMonthGrid : février bissextile 2024 (29 jours)", () => {
  const grid = buildMonthGrid(2024, 2, []);
  const inMonth = grid.weeks.flat().filter((d) => d.inMonth);
  assert.equal(inMonth.length, 29);
  assert.equal(inMonth[28].date, "2024-02-29");
});

test("buildMonthGrid : février non bissextile 2026 (28 jours)", () => {
  const grid = buildMonthGrid(2026, 2, []);
  const inMonth = grid.weeks.flat().filter((d) => d.inMonth);
  assert.equal(inMonth.length, 28);
  assert.equal(inMonth[27].date, "2026-02-28");
});

test("buildMonthGrid : bornes janvier (déborde sur décembre précédent)", () => {
  const grid = buildMonthGrid(2026, 1, []);
  const leading = grid.weeks[0].filter((d) => !d.inMonth);
  // les jours de tête proviennent de décembre 2025
  for (const d of leading) assert.match(d.date, /^2025-12-/);
});

test("buildMonthGrid : bornes décembre (déborde sur janvier suivant)", () => {
  const grid = buildMonthGrid(2026, 12, []);
  const trailing = grid.weeks.flat().filter((d) => !d.inMonth && d.date > "2026-12-31");
  for (const d of trailing) assert.match(d.date, /^2027-01-/);
});

test("buildMonthGrid : les événements sont rattachés à leur jour (horodatage toléré)", () => {
  const events: CalendarEvent[] = [
    { id: "a", title: "Soirée A", event_date: "2026-07-07" },
    { id: "b", title: "Soirée B", event_date: "2026-07-07T23:00:00Z" }, // même jour, horodaté
    { id: "c", title: "Soirée C", event_date: "2026-07-18" },
    { id: "x", title: "Sans date", event_date: "" }, // ignoré
  ];
  const grid = buildMonthGrid(2026, 7, events);
  const cells = grid.weeks.flat();
  const d7 = cells.find((d) => d.date === "2026-07-07")!;
  const d18 = cells.find((d) => d.date === "2026-07-18")!;
  assert.equal(d7.events.length, 2);
  assert.equal(d18.events.length, 1);
  // aucun événement fantôme ailleurs
  const total = cells.reduce((s, d) => s + d.events.length, 0);
  assert.equal(total, 3);
});
