import assert from "node:assert/strict";
import test from "node:test";

import type { VenueTable } from "../lib/venueTables.ts";
import {
  buildCapacityExport,
  capacityExportJson,
  capacityFillProgress,
  classifyCapacityDiff,
  diffCapacities,
  summarizeCapacityDiffs,
} from "../lib/venueCapacityExport.ts";

function vt(over: Partial<VenueTable> = {}): VenueTable {
  return {
    id: over.id ?? `eden-${over.label ?? "100"}`,
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

test("classifyCapacityDiff: filled / corrected / cleared", () => {
  assert.equal(classifyCapacityDiff({ label: "1", from: null, to: 4 }), "filled");
  assert.equal(classifyCapacityDiff({ label: "1", from: 4, to: 6 }), "corrected");
  assert.equal(classifyCapacityDiff({ label: "1", from: 4, to: null }), "cleared");
});

test("diffCapacities: ne renvoie que les capacités réellement changées", () => {
  const original = [
    vt({ label: "205", capacity: 6 }), // inchangée
    vt({ label: "203", capacity: null }), // sera remplie
    vt({ label: "201", capacity: null }), // restera vide
  ];
  const edited = [
    vt({ label: "205", capacity: 6 }),
    vt({ label: "203", capacity: 5 }),
    vt({ label: "201", capacity: null }),
  ];
  const diffs = diffCapacities(original, edited);
  assert.deepEqual(diffs, [{ label: "203", from: null, to: 5 }]);
});

test("diffCapacities: tri numérique des labels, pas lexicographique", () => {
  const original = [
    vt({ label: "704", capacity: null }),
    vt({ label: "100", capacity: null }),
    vt({ label: "205", capacity: null }),
  ];
  const edited = [
    vt({ label: "704", capacity: 2 }),
    vt({ label: "100", capacity: 4 }),
    vt({ label: "205", capacity: 6 }),
  ];
  assert.deepEqual(
    diffCapacities(original, edited).map((d) => d.label),
    ["100", "205", "704"],
  );
});

test("diffCapacities: apparie par venue+label (jamais de collision inter-univers)", () => {
  const original = [vt({ venue: "eden", label: "100", capacity: null })];
  const edited = [
    vt({ venue: "terminus", label: "100", capacity: 9 }), // même label, autre univers → ignoré
    vt({ venue: "eden", label: "100", capacity: 4 }),
  ];
  assert.deepEqual(diffCapacities(original, edited), [{ label: "100", from: null, to: 4 }]);
});

test("diffCapacities: table absente du plan édité → aucun diff (rien inventé)", () => {
  const original = [vt({ label: "100", capacity: null }), vt({ label: "101", capacity: null })];
  const edited = [vt({ label: "100", capacity: 4 })];
  assert.deepEqual(
    diffCapacities(original, edited).map((d) => d.label),
    ["100"],
  );
});

test("summarizeCapacityDiffs: compte filled / corrected / cleared", () => {
  const diffs = [
    { label: "1", from: null, to: 4 },
    { label: "2", from: null, to: 6 },
    { label: "3", from: 4, to: 5 },
    { label: "4", from: 6, to: null },
  ];
  assert.deepEqual(summarizeCapacityDiffs(diffs), {
    changed: 4,
    filled: 2,
    corrected: 1,
    cleared: 1,
  });
});

test("summarizeCapacityDiffs: liste vide → tout à zéro", () => {
  assert.deepEqual(summarizeCapacityDiffs([]), { changed: 0, filled: 0, corrected: 0, cleared: 0 });
});

test("capacityFillProgress: reflète l'état réel du plan édité", () => {
  const edited = [
    vt({ label: "100", capacity: 4 }),
    vt({ label: "101", capacity: null }),
    vt({ label: "102", capacity: 6 }),
  ];
  assert.deepEqual(capacityFillProgress(edited), {
    total: 3,
    known: 2,
    unknown: 1,
    complete: false,
  });
});

test("capacityFillProgress: complet quand plus aucune capacité nulle", () => {
  const edited = [vt({ label: "100", capacity: 4 }), vt({ label: "101", capacity: 6 })];
  assert.equal(capacityFillProgress(edited).complete, true);
});

test("capacityFillProgress: plan vide → complete=false (état vide honnête)", () => {
  assert.equal(capacityFillProgress([]).complete, false);
});

test("buildCapacityExport: n'inclut que les valeurs saisies, cleared à part, clés triées", () => {
  const diffs = [
    { label: "704", from: null, to: 2 },
    { label: "100", from: null, to: 4 },
    { label: "205", from: 6, to: null }, // effacée
  ];
  const exp = buildCapacityExport("eden", diffs);
  assert.equal(exp.venue, "eden");
  assert.deepEqual(exp.capacities, { "100": 4, "704": 2 });
  assert.deepEqual(exp.cleared, ["205"]);
  // Ordre des clés déterministe (numérique) dans le JSON sérialisé.
  assert.deepEqual(Object.keys(exp.capacities), ["100", "704"]);
});

test("buildCapacityExport: aucune saisie → export vide honnête (pas de 0 inventé)", () => {
  const exp = buildCapacityExport("eden", []);
  assert.deepEqual(exp.capacities, {});
  assert.deepEqual(exp.cleared, []);
});

test("capacityExportJson: sérialisation stable et relisible", () => {
  const exp = buildCapacityExport("eden", [
    { label: "205", from: null, to: 6 },
    { label: "100", from: null, to: 4 },
  ]);
  const json = capacityExportJson(exp);
  assert.equal(
    json,
    `{
  "venue": "eden",
  "capacities": {
    "100": 4,
    "205": 6
  },
  "cleared": []
}`,
  );
});
