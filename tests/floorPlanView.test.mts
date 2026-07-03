import assert from "node:assert/strict";
import test from "node:test";

import { EDEN_SCREENSHOT_REF, VENUES, type VenueTable } from "../lib/venueTables.ts";
import {
  AVAILABILITY_STYLE,
  CONSULTATION_STYLE,
  EDEN_WALLS,
  TABLE_AVAILABILITY,
  VENUE_THEME,
  VENUE_VIEWBOX,
  availabilityStyle,
  buildLegend,
  isSelectableForRequest,
  isTableAvailability,
  resolveAvailability,
  tableAriaLabel,
  tableGeometry,
  tablePosition,
  venueWalls,
} from "../lib/floorPlanView.ts";

// Fabrique une table de test minimale (aucune donnée réelle inventée : ce sont des fixtures de test).
function mkTable(over: Partial<VenueTable> = {}): VenueTable {
  return {
    id: over.id ?? "t-1",
    venue: over.venue ?? "eden",
    label: over.label ?? "704",
    x_pct: over.x_pct ?? 50,
    y_pct: over.y_pct ?? 50,
    shape: over.shape ?? "round",
    standing: over.standing ?? false,
    capacity: over.capacity ?? null,
    active: over.active ?? true,
  };
}

// ————————————————————————————————————————————————————————————————
// États & garde de type
// ————————————————————————————————————————————————————————————————

test("les 4 états de la spec existent et ont un style complet", () => {
  assert.deepEqual([...TABLE_AVAILABILITY], ["free", "requested", "confirmed", "unavailable"]);
  for (const a of TABLE_AVAILABILITY) {
    const s = AVAILABILITY_STYLE[a];
    assert.ok(s.label && s.fill && s.stroke && s.text, `style complet pour ${a}`);
  }
});

test("isTableAvailability accepte les états connus et rejette le reste", () => {
  assert.equal(isTableAvailability("free"), true);
  assert.equal(isTableAvailability("confirmed"), true);
  assert.equal(isTableAvailability("booked"), false);
  assert.equal(isTableAvailability(null), false);
  assert.equal(isTableAvailability(42), false);
});

// ————————————————————————————————————————————————————————————————
// DA & viewBox par univers
// ————————————————————————————————————————————————————————————————

test("chaque univers a un thème et un viewBox", () => {
  for (const v of VENUES) {
    assert.ok(VENUE_THEME[v], `thème pour ${v}`);
    const vb = VENUE_VIEWBOX[v];
    assert.ok(vb.width > 0 && vb.height > 0, `viewBox positif pour ${v}`);
  }
});

test("le viewBox Eden reprend l'aspect réel du screenshot (952×506)", () => {
  assert.equal(VENUE_VIEWBOX.eden.width, EDEN_SCREENSHOT_REF.width);
  assert.equal(VENUE_VIEWBOX.eden.height, EDEN_SCREENSHOT_REF.height);
});

// ————————————————————————————————————————————————————————————————
// Murs — transcription (jamais inventée pour les univers sans plan)
// ————————————————————————————————————————————————————————————————

test("seul l'Eden a des murs transcrits ; les autres univers renvoient []", () => {
  assert.ok(venueWalls("eden").length > 0);
  assert.equal(venueWalls("terminus").length, 0);
  assert.equal(venueWalls("cercle").length, 0);
  assert.equal(EDEN_WALLS.length, venueWalls("eden").length);
});

test("les murs Eden restent dans le cadre du screenshot", () => {
  for (const w of EDEN_WALLS) {
    for (const [x, y] of [
      [w.x1, w.y1],
      [w.x2, w.y2],
    ] as const) {
      assert.ok(x >= 0 && x <= EDEN_SCREENSHOT_REF.width, "x dans le cadre");
      assert.ok(y >= 0 && y <= EDEN_SCREENSHOT_REF.height, "y dans le cadre");
    }
  }
});

// ————————————————————————————————————————————————————————————————
// Position & géométrie
// ————————————————————————————————————————————————————————————————

test("tablePosition convertit le % en unités du viewBox", () => {
  const vb = VENUE_VIEWBOX.eden;
  assert.deepEqual(tablePosition({ x_pct: 0, y_pct: 0 }, vb), { cx: 0, cy: 0 });
  assert.deepEqual(tablePosition({ x_pct: 100, y_pct: 100 }, vb), { cx: vb.width, cy: vb.height });
  const mid = tablePosition({ x_pct: 50, y_pct: 50 }, vb);
  assert.equal(mid.cx, vb.width / 2);
  assert.equal(mid.cy, vb.height / 2);
});

test("tablePosition borne les % hors cadre et neutralise le non-fini", () => {
  const vb = VENUE_VIEWBOX.eden;
  assert.deepEqual(tablePosition({ x_pct: 150, y_pct: -10 }, vb), { cx: vb.width, cy: 0 });
  assert.deepEqual(tablePosition({ x_pct: Number.NaN, y_pct: 50 }, vb), { cx: 0, cy: vb.height / 2 });
});

test("tableGeometry : carré → banquette, rond → cercle, debout → cercle plus petit", () => {
  const square = tableGeometry({ shape: "square", standing: false });
  assert.equal(square.kind, "rect");

  const round = tableGeometry({ shape: "round", standing: false });
  const standing = tableGeometry({ shape: "round", standing: true });
  assert.equal(round.kind, "circle");
  assert.equal(standing.kind, "circle");
  if (round.kind === "circle" && standing.kind === "circle") {
    assert.equal(round.standing, false);
    assert.equal(standing.standing, true);
    assert.ok(standing.r < round.r, "la table haute est un pictogramme plus petit");
  }
});

// ————————————————————————————————————————————————————————————————
// Résolution d'état — cœur de l'honnêteté (jamais de fausse dispo)
// ————————————————————————————————————————————————————————————————

test("consultation : SANS carte d'états, une table active est neutre (null), jamais « libre »", () => {
  const t = mkTable({ active: true });
  assert.equal(resolveAvailability(t), null);
  assert.equal(availabilityStyle(null), CONSULTATION_STYLE);
});

test("une table inactive est « indisponible », même en consultation", () => {
  const t = mkTable({ active: false });
  assert.equal(resolveAvailability(t), "unavailable");
  assert.equal(resolveAvailability(t, {}), "unavailable");
});

test("mode live : la carte fournit l'état ; défaut « libre » quand la table active y est absente", () => {
  const t = mkTable({ id: "x", active: true });
  assert.equal(resolveAvailability(t, { x: "confirmed" }), "confirmed");
  assert.equal(resolveAvailability(t, { autre: "confirmed" }), "free");
  assert.equal(resolveAvailability(t, { x: "n'importe quoi" as unknown as never }), "free");
});

// ————————————————————————————————————————————————————————————————
// Sélectionnabilité (demande de résa client) & aria-label
// ————————————————————————————————————————————————————————————————

test("seule une table active ET libre est proposable à une demande de résa", () => {
  assert.equal(isSelectableForRequest({ active: true }, "free"), true);
  assert.equal(isSelectableForRequest({ active: true }, "confirmed"), false);
  assert.equal(isSelectableForRequest({ active: true }, "requested"), false);
  assert.equal(isSelectableForRequest({ active: false }, "free"), false);
  // Consultation (null) → jamais sélectionnable (pas de données de soirée).
  assert.equal(isSelectableForRequest({ active: true }, null), false);
});

test("tableAriaLabel énonce type, capacité (ou « à confirmer ») et état", () => {
  const known = mkTable({ label: "205", shape: "round", standing: false, capacity: 6 });
  assert.equal(tableAriaLabel(known, "free"), "Table 205 · Table · 6 places · libre");

  const unknownCap = mkTable({ label: "703", capacity: null });
  assert.equal(tableAriaLabel(unknownCap, null), "Table 703 · Table · capacité à confirmer · consultation");

  const standing = mkTable({ label: "400", standing: true, capacity: 4 });
  assert.equal(tableAriaLabel(standing, "confirmed"), "Table 400 · Table haute — debout · 4 places · confirmée");
});

// ————————————————————————————————————————————————————————————————
// Légende
// ————————————————————————————————————————————————————————————————

test("légende consultation : pas de 4 faux états, une note consultation + 3 types d'assise", () => {
  const legend = buildLegend("consultation");
  assert.equal(legend.length, 4);
  assert.equal(legend[0].key, "consultation");
  const keys = legend.map((e) => e.key);
  assert.ok(keys.includes("shape-round"));
  assert.ok(keys.includes("shape-square"));
  assert.ok(keys.includes("shape-standing"));
  // Aucun état de dispo listé en consultation.
  assert.ok(!keys.some((k) => k.startsWith("state-")));
});

test("légende live : les 4 états + les 3 types d'assise", () => {
  const legend = buildLegend("live");
  const keys = legend.map((e) => e.key);
  for (const a of TABLE_AVAILABILITY) assert.ok(keys.includes(`state-${a}`), `état ${a} en légende`);
  assert.ok(keys.includes("shape-round") && keys.includes("shape-square") && keys.includes("shape-standing"));
});
