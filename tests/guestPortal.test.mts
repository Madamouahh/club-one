import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDateFr,
  formatSlot,
  groupEventsByDay,
  hasAnyPreference,
  isValidMonthRef,
  isValidPinFormat,
  isVenueId,
  monthLabelFr,
  normalizeMonthEvent,
  normalizeMonthEvents,
  normalizePreferences,
  normalizeVenueFilter,
  readSpaceAccess,
  shiftMonth,
  validatePreferencesInput,
  venueLabel,
  type MonthEvent,
} from "../lib/guestPortal.ts";

function ev(over: Partial<MonthEvent> = {}): MonthEvent {
  return {
    venue_id: over.venue_id ?? "eden",
    venue_name: "venue_name" in over ? over.venue_name ?? null : "L'Éden",
    venue_kind: "venue_kind" in over ? over.venue_kind ?? null : "rooftop",
    title: "title" in over ? over.title ?? null : "Soirée test",
    slug: "slug" in over ? over.slug ?? null : "soiree-test",
    event_date: over.event_date ?? "2026-07-04",
    start_time: "start_time" in over ? over.start_time ?? null : "23:00",
    horaire_debut: "horaire_debut" in over ? over.horaire_debut ?? null : null,
    horaire_fin: "horaire_fin" in over ? over.horaire_fin ?? null : null,
    description: "description" in over ? over.description ?? null : null,
    lineup: "lineup" in over ? over.lineup ?? null : null,
    artistes: "artistes" in over ? over.artistes ?? null : null,
    cover_url: "cover_url" in over ? over.cover_url ?? null : null,
    ticket_url: "ticket_url" in over ? over.ticket_url ?? null : null,
  };
}

// ————————————————————————————————————————————————————————————————
// Salles
// ————————————————————————————————————————————————————————————————
test("isVenueId n'accepte que les 3 salles connues", () => {
  assert.equal(isVenueId("eden"), true);
  assert.equal(isVenueId("cercle"), true);
  assert.equal(isVenueId("terminus"), true);
  assert.equal(isVenueId("rooftop"), false);
  assert.equal(isVenueId(null), false);
  assert.equal(isVenueId(42), false);
});

test("venueLabel : libellés FR + repli 'Toutes les salles'", () => {
  assert.equal(venueLabel("eden"), "Eden");
  assert.equal(venueLabel("cercle"), "Cercle");
  assert.equal(venueLabel("terminus"), "Terminus");
  assert.equal(venueLabel(null), "Toutes les salles");
  assert.equal(venueLabel("inconnu"), "Toutes les salles");
});

test("normalizeVenueFilter : salle valide ou null (toutes)", () => {
  assert.equal(normalizeVenueFilter("cercle"), "cercle");
  assert.equal(normalizeVenueFilter("nope"), null);
  assert.equal(normalizeVenueFilter(undefined), null);
});

// ————————————————————————————————————————————————————————————————
// Préférences (whitelist stricte, bornes miroir du SQL)
// ————————————————————————————————————————————————————————————————
test("normalizePreferences retient uniquement les 3 clés connues", () => {
  const out = normalizePreferences({
    musique: "  techno  ",
    table: "près du DJ",
    allergies: "arachides",
    // clés parasites ignorées (whitelist)
    admin: true,
    spend: 9999,
    phone: "+33600000000",
  });
  assert.deepEqual(out, { musique: "techno", table: "près du DJ", allergies: "arachides" });
});

test("normalizePreferences : chaîne vide après trim → clé OMISE", () => {
  const out = normalizePreferences({ musique: "   ", table: "", allergies: "ok" });
  assert.deepEqual(out, { allergies: "ok" });
});

test("normalizePreferences : borne 280 caractères", () => {
  const long = "a".repeat(500);
  const out = normalizePreferences({ musique: long });
  assert.equal(out.musique?.length, 280);
});

test("normalizePreferences : entrée non-objet → {}", () => {
  assert.deepEqual(normalizePreferences(null), {});
  assert.deepEqual(normalizePreferences("x"), {});
  assert.deepEqual(normalizePreferences(undefined), {});
});

test("hasAnyPreference", () => {
  assert.equal(hasAnyPreference({}), false);
  assert.equal(hasAnyPreference({ musique: "techno" }), true);
});

test("validatePreferencesInput signale un dépassement mais tronque dans clean", () => {
  const res = validatePreferencesInput({ musique: "a".repeat(300), table: "ok", allergies: "" });
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors, ["musique"]);
  assert.equal(res.clean.musique?.length, 280);
  assert.equal(res.clean.table, "ok");
  assert.equal("allergies" in res.clean, false);
});

test("validatePreferencesInput ok quand tout est dans les bornes", () => {
  const res = validatePreferencesInput({ musique: "house", table: "", allergies: "gluten" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.clean, { musique: "house", allergies: "gluten" });
});

// ————————————————————————————————————————————————————————————————
// Modèle mois
// ————————————————————————————————————————————————————————————————
test("isValidMonthRef borne année 2000..2100 et mois 1..12", () => {
  assert.equal(isValidMonthRef({ year: 2026, month: 7 }), true);
  assert.equal(isValidMonthRef({ year: 2026, month: 0 }), false);
  assert.equal(isValidMonthRef({ year: 2026, month: 13 }), false);
  assert.equal(isValidMonthRef({ year: 1999, month: 6 }), false);
  assert.equal(isValidMonthRef({ year: 2101, month: 6 }), false);
  assert.equal(isValidMonthRef({ year: 2026.5, month: 6 }), false);
});

test("shiftMonth avance et recule avec passage d'année", () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 7 }, 1), { year: 2026, month: 8 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 7 }, 6), { year: 2027, month: 1 });
});

test("shiftMonth clampe aux bornes 2000..2100", () => {
  assert.equal(shiftMonth({ year: 2000, month: 1 }, -12).year, 2000);
  assert.equal(shiftMonth({ year: 2100, month: 12 }, 12).year, 2100);
});

test("monthLabelFr", () => {
  assert.equal(monthLabelFr({ year: 2026, month: 7 }), "juillet 2026");
  assert.equal(monthLabelFr({ year: 2026, month: 1 }), "janvier 2026");
  assert.equal(monthLabelFr({ year: 2026, month: 13 }), "");
});

// ————————————————————————————————————————————————————————————————
// Événements
// ————————————————————————————————————————————————————————————————
test("normalizeMonthEvent rejette les lignes sans venue_id ou event_date", () => {
  assert.equal(normalizeMonthEvent({ event_date: "2026-07-04" }), null);
  assert.equal(normalizeMonthEvent({ venue_id: "eden" }), null);
  assert.equal(normalizeMonthEvent(null), null);
});

test("normalizeMonthEvent normalise champs vides en null et filtre lineup", () => {
  const out = normalizeMonthEvent({
    venue_id: "cercle",
    venue_name: "",
    event_date: "2026-07-10",
    lineup: ["DJ A", 42, "DJ B", null],
    title: "Nuit",
  });
  assert.ok(out);
  assert.equal(out?.venue_name, null);
  assert.equal(out?.title, "Nuit");
  assert.deepEqual(out?.lineup, ["DJ A", "DJ B"]);
});

test("normalizeMonthEvents ignore les lignes invalides", () => {
  const rows = [ev(), { bogus: true }, ev({ event_date: "2026-07-11" }), null];
  const out = normalizeMonthEvents(rows);
  assert.equal(out.length, 2);
});

test("groupEventsByDay groupe et trie par jour croissant", () => {
  const events = [
    ev({ event_date: "2026-07-20", venue_id: "eden" }),
    ev({ event_date: "2026-07-04", venue_id: "cercle" }),
    ev({ event_date: "2026-07-04", venue_id: "eden" }),
  ];
  const groups = groupEventsByDay(events, null);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, "2026-07-04");
  assert.equal(groups[0].events.length, 2);
  assert.equal(groups[1].date, "2026-07-20");
});

test("groupEventsByDay filtre par salle côté client", () => {
  const events = [
    ev({ event_date: "2026-07-04", venue_id: "eden" }),
    ev({ event_date: "2026-07-04", venue_id: "cercle" }),
  ];
  const groups = groupEventsByDay(events, "cercle");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].events.length, 1);
  assert.equal(groups[0].events[0].venue_id, "cercle");
});

test("formatDateFr", () => {
  assert.equal(formatDateFr("2026-07-04"), "04/07/2026");
  assert.equal(formatDateFr("bogus"), "bogus");
});

test("formatSlot : combine, tombe sur start_time, ou vide honnête", () => {
  assert.equal(formatSlot({ start_time: null, horaire_debut: "23:30", horaire_fin: "05:00" }), "23:30 → 05:00");
  assert.equal(formatSlot({ start_time: "23:00", horaire_debut: null, horaire_fin: null }), "23:00");
  assert.equal(formatSlot({ start_time: null, horaire_debut: null, horaire_fin: null }), "");
});

// ————————————————————————————————————————————————————————————————
// Accès espace (expiration E6) + PIN
// ————————————————————————————————————————————————————————————————
test("readSpaceAccess lit found/expired/has_pin", () => {
  assert.deepEqual(readSpaceAccess({ found: true }), { found: true, expired: false, hasPin: false });
  assert.deepEqual(readSpaceAccess({ found: false, expired: true, has_pin: true }), {
    found: false,
    expired: true,
    hasPin: true,
  });
  assert.deepEqual(readSpaceAccess(null), { found: false, expired: false, hasPin: false });
});

test("isValidPinFormat : 4 à 8 chiffres", () => {
  assert.equal(isValidPinFormat("1234"), true);
  assert.equal(isValidPinFormat("12345678"), true);
  assert.equal(isValidPinFormat("  4321  "), true);
  assert.equal(isValidPinFormat("123"), false);
  assert.equal(isValidPinFormat("123456789"), false);
  assert.equal(isValidPinFormat("12a4"), false);
  assert.equal(isValidPinFormat(""), false);
});
