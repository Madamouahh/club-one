import assert from "node:assert/strict";
import test from "node:test";

import {
  EDEN_SCREENSHOT_REF,
  EDEN_SEED,
  EDEN_STANDING_LABELS,
  SHAPE_BY_LETTER,
  TABLE_SHAPES,
  VENUES,
  capacityKnown,
  capacityLabel,
  groupByVenue,
  isTableShape,
  isVenue,
  pixelToPct,
  planReady,
  planSummary,
  seedToPct,
  tableKindLabel,
  validateVenueTableDraft,
  type VenueTable,
  type VenueTableDraft,
} from "../lib/venueTables.ts";

function vt(over: Partial<VenueTable> = {}): VenueTable {
  return {
    id: over.id ?? "t1",
    venue: over.venue ?? "eden",
    label: over.label ?? "100",
    x_pct: over.x_pct ?? 50,
    y_pct: over.y_pct ?? 50,
    shape: over.shape ?? "round",
    standing: over.standing ?? false,
    capacity: over.capacity === undefined ? null : over.capacity,
    active: over.active ?? true,
  };
}

// ————————————————————————————————————————————————————————————————
// Transcription EDEN — invariants de fidélité au screenshot fondateur
// ————————————————————————————————————————————————————————————————

test("EDEN_SEED : exactement 44 tables (transcription du screenshot)", () => {
  assert.equal(EDEN_SEED.length, 44);
});

test("EDEN_SEED : labels uniques", () => {
  const labels = EDEN_SEED.map((s) => s.label);
  assert.equal(new Set(labels).size, labels.length);
});

test("EDEN_SEED : tables debout = liste EXACTE du fondateur (106,107,400-406,500)", () => {
  const standing = EDEN_SEED.filter((s) => s.standing).map((s) => s.label).sort();
  assert.deepEqual(standing, [...EDEN_STANDING_LABELS].sort());
});

test("EDEN_SEED : aucune capacité inventée (null OU entier strictement positif)", () => {
  for (const s of EDEN_SEED) {
    if (s.cap !== null) {
      assert.ok(Number.isInteger(s.cap) && s.cap > 0, `cap invalide pour ${s.label}`);
    }
  }
});

test("EDEN_SEED : 18 capacités connues / 26 à confirmer (état honnête)", () => {
  const known = EDEN_SEED.filter((s) => s.cap !== null).length;
  assert.equal(known, 18);
  assert.equal(EDEN_SEED.length - known, 26);
});

test("EDEN_SEED : toutes les formes sont valides + pixels dans le cadre 952×506", () => {
  for (const s of EDEN_SEED) {
    assert.ok(isTableShape(s.shape));
    assert.ok(s.px >= 0 && s.px <= EDEN_SCREENSHOT_REF.width, `px hors cadre ${s.label}`);
    assert.ok(s.py >= 0 && s.py <= EDEN_SCREENSHOT_REF.height, `py hors cadre ${s.label}`);
  }
});

// ————————————————————————————————————————————————————————————————
// Normalisation pixel → % (mêmes maths que le SQL round(...,3))
// ————————————————————————————————————————————————————————————————

test("pixelToPct : arrondi 3 décimales, borné [0,100]", () => {
  assert.equal(pixelToPct(37, 952), 3.887); // 37/952*100 = 3.8865...
  assert.equal(pixelToPct(0, 952), 0);
  assert.equal(pixelToPct(952, 952), 100);
  assert.equal(pixelToPct(2000, 952), 100); // clamp haut
  assert.equal(pixelToPct(-5, 952), 0); // clamp bas
});

test("pixelToPct : ref invalide → 0 (jamais NaN/Infinity propagé)", () => {
  assert.equal(pixelToPct(37, 0), 0);
  assert.equal(pixelToPct(Number.NaN, 952), 0);
});

test("seedToPct : dérive x/y d'une entrée avec la ref Eden", () => {
  const p = seedToPct({ label: "100", px: 868, py: 218, shape: "square", standing: false, cap: 4 });
  assert.equal(p.x_pct, pixelToPct(868, 952));
  assert.equal(p.y_pct, pixelToPct(218, 506));
});

// ————————————————————————————————————————————————————————————————
// Gardes de type & libellés
// ————————————————————————————————————————————————————————————————

test("isVenue / isTableShape : vocabulaires fermés", () => {
  assert.ok(isVenue("eden"));
  assert.ok(!isVenue("complexe"));
  assert.ok(!isVenue(42));
  assert.ok(isTableShape("square"));
  assert.ok(!isTableShape("hexagon"));
  assert.deepEqual([...VENUES], ["eden", "terminus", "cercle"]);
  assert.deepEqual([...TABLE_SHAPES], ["round", "square"]);
  assert.equal(SHAPE_BY_LETTER.R, "round");
  assert.equal(SHAPE_BY_LETTER.C, "square");
});

test("capacityKnown / capacityLabel : null = à confirmer (— honnête)", () => {
  assert.ok(capacityKnown({ capacity: 4 }));
  assert.ok(!capacityKnown({ capacity: null }));
  assert.equal(capacityLabel(6), "6");
  assert.equal(capacityLabel(null), "—");
});

test("tableKindLabel : debout distinct de banquette/table", () => {
  assert.equal(tableKindLabel({ shape: "round", standing: true }), "Table haute — debout");
  assert.equal(tableKindLabel({ shape: "square", standing: false }), "Banquette");
  assert.equal(tableKindLabel({ shape: "round", standing: false }), "Table");
});

// ————————————————————————————————————————————————————————————————
// Agrégats & regroupement (états vides honnêtes)
// ————————————————————————————————————————————————————————————————

test("planSummary : liste vide → zéros honnêtes", () => {
  assert.deepEqual(planSummary([]), {
    total: 0,
    active: 0,
    standing: 0,
    capacityKnown: 0,
    capacityUnknown: 0,
  });
});

test("planSummary : compte actifs, debout, capacités connues/à confirmer", () => {
  const tables = [
    vt({ label: "a", capacity: 4, standing: false, active: true }),
    vt({ label: "b", capacity: null, standing: true, active: true }),
    vt({ label: "c", capacity: null, standing: false, active: false }),
  ];
  assert.deepEqual(planSummary(tables), {
    total: 3,
    active: 2,
    standing: 1,
    capacityKnown: 1,
    capacityUnknown: 2,
  });
});

test("planSummary : sur le seed Eden mappé → 44 tables, 10 debout, 18 capacités connues", () => {
  const tables: VenueTable[] = EDEN_SEED.map((s, i) => {
    const p = seedToPct(s);
    return {
      id: `eden-${i}`,
      venue: "eden",
      label: s.label,
      x_pct: p.x_pct,
      y_pct: p.y_pct,
      shape: s.shape,
      standing: s.standing,
      capacity: s.cap,
      active: true,
    };
  });
  const sum = planSummary(tables);
  assert.equal(sum.total, 44);
  assert.equal(sum.standing, 10);
  assert.equal(sum.capacityKnown, 18);
  assert.equal(sum.capacityUnknown, 26);
});

test("groupByVenue : range par univers, ignore un univers inattendu", () => {
  const tables = [
    vt({ venue: "eden", label: "1" }),
    vt({ venue: "terminus", label: "2" }),
    vt({ venue: "eden", label: "3" }),
    { ...vt({ label: "4" }), venue: "complexe" as unknown as VenueTable["venue"] },
  ];
  const grouped = groupByVenue(tables);
  assert.equal(grouped.get("eden")?.length, 2);
  assert.equal(grouped.get("terminus")?.length, 1);
  assert.ok(!grouped.has("complexe" as never));
});

test("planReady : vrai dès une table, faux si vide", () => {
  assert.ok(!planReady([]));
  assert.ok(planReady([vt()]));
});

// ————————————————————————————————————————————————————————————————
// Validation du brouillon d'édition direction (miroir des CHECK 0024)
// ————————————————————————————————————————————————————————————————

function draft(over: Partial<VenueTableDraft> = {}): VenueTableDraft {
  return {
    venue: over.venue ?? "eden",
    label: over.label ?? "999",
    x_pct: over.x_pct ?? 50,
    y_pct: over.y_pct ?? 50,
    shape: over.shape ?? "round",
    standing: over.standing ?? false,
    capacity: over.capacity === undefined ? null : over.capacity,
    active: over.active ?? true,
  };
}

test("validateVenueTableDraft : brouillon nominal accepté (capacité vide OK)", () => {
  assert.deepEqual(validateVenueTableDraft(draft()), { ok: true, errors: [] });
  assert.ok(validateVenueTableDraft(draft({ capacity: 6 })).ok);
});

test("validateVenueTableDraft : capacité 0 ou négative refusée (jamais inventée)", () => {
  assert.ok(!validateVenueTableDraft(draft({ capacity: 0 })).ok);
  assert.ok(!validateVenueTableDraft(draft({ capacity: -2 })).ok);
  assert.ok(!validateVenueTableDraft(draft({ capacity: 2.5 })).ok);
});

test("validateVenueTableDraft : label vide, univers/forme inconnus, bornes % refusés", () => {
  assert.ok(!validateVenueTableDraft(draft({ label: "   " })).ok);
  assert.ok(!validateVenueTableDraft(draft({ venue: "xxx" as unknown as VenueTableDraft["venue"] })).ok);
  assert.ok(!validateVenueTableDraft(draft({ shape: "tri" as unknown as VenueTableDraft["shape"] })).ok);
  assert.ok(!validateVenueTableDraft(draft({ x_pct: 120 })).ok);
  assert.ok(!validateVenueTableDraft(draft({ y_pct: -1 })).ok);
});
