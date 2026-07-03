import assert from "node:assert/strict";
import test from "node:test";

import type { VenueTable } from "../lib/venueTables.ts";
import {
  buildVenueTableUpdate,
  capacityInputValue,
  capacityProgress,
  draftChangedFields,
  editableVenues,
  isEditableField,
  normalizeVenueTableDraft,
  parseCapacityInput,
  sortForEditing,
  tablesNeedingCapacity,
  toEditableDraft,
} from "../lib/venueTableEditor.ts";

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
// parseCapacityInput — le garde-fou d'honnêteté (vide = à confirmer, jamais inventé)
// ————————————————————————————————————————————————————————————————

test("capacité vide → null (à confirmer, jamais 0)", () => {
  for (const raw of ["", "   ", "\t"]) {
    const r = parseCapacityInput(raw);
    assert.deepEqual(r, { ok: true, value: null });
  }
});

test("capacité entier positif → ce nombre (espaces tolérés)", () => {
  assert.deepEqual(parseCapacityInput("4"), { ok: true, value: 4 });
  assert.deepEqual(parseCapacityInput("  6 "), { ok: true, value: 6 });
  assert.deepEqual(parseCapacityInput("12"), { ok: true, value: 12 });
});

test("capacité 0 / négative / décimale / texte → refusée (jamais devinée)", () => {
  for (const raw of ["0", "-2", "4.5", "4,5", "abc", "4 places", "1e3", "2.0"]) {
    const r = parseCapacityInput(raw);
    assert.equal(r.ok, false, `"${raw}" doit être refusé`);
  }
});

test("capacityInputValue : null → champ vide (jamais « 0 »), n → texte", () => {
  assert.equal(capacityInputValue(null), "");
  assert.equal(capacityInputValue(4), "4");
});

// ————————————————————————————————————————————————————————————————
// draftChangedFields / buildVenueTableUpdate — patch minimal, « rien à enregistrer » détectable
// ————————————————————————————————————————————————————————————————

test("toEditableDraft copie fidèlement (aucune valeur fabriquée)", () => {
  const t = vt({ capacity: null, standing: true, label: "406" });
  const d = toEditableDraft(t);
  assert.equal(d.capacity, null);
  assert.equal(d.standing, true);
  assert.equal(d.label, "406");
  assert.equal(d.venue, "eden");
});

test("normalizeVenueTableDraft trim le label", () => {
  const d = normalizeVenueTableDraft(toEditableDraft(vt({ label: "  205  " })));
  assert.equal(d.label, "205");
});

test("aucun changement → changed vide + update null (rien à enregistrer)", () => {
  const t = vt({ capacity: 4 });
  const changed = draftChangedFields(t, toEditableDraft(t));
  assert.deepEqual(changed, []);
  const built = buildVenueTableUpdate(t, toEditableDraft(t));
  assert.deepEqual(built, { ok: true, changed: [], update: null });
});

test("renseigner une capacité NULL → patch { capacity: n } uniquement", () => {
  const t = vt({ capacity: null });
  const draft = { ...toEditableDraft(t), capacity: 6 };
  const built = buildVenueTableUpdate(t, draft);
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.deepEqual(built.changed, ["capacity"]);
    assert.deepEqual(built.update, { capacity: 6 });
  }
});

test("effacer une capacité erronée → patch { capacity: null } (retour à confirmer, autorisé)", () => {
  const t = vt({ capacity: 99 });
  const draft = { ...toEditableDraft(t), capacity: null };
  const built = buildVenueTableUpdate(t, draft);
  assert.equal(built.ok, true);
  if (built.ok) assert.deepEqual(built.update, { capacity: null });
});

test("changements multiples → patch ne contient QUE les champs modifiés", () => {
  const t = vt({ capacity: null, standing: false, active: true });
  const draft = { ...toEditableDraft(t), capacity: 4, standing: true };
  const built = buildVenueTableUpdate(t, draft);
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.deepEqual(built.changed.sort(), ["capacity", "standing"]);
    assert.deepEqual(built.update, { capacity: 4, standing: true });
    assert.equal("active" in (built.update ?? {}), false); // inchangé → absent
  }
});

test("label modifié (avec espaces) → patch label trimmé", () => {
  const t = vt({ label: "100" });
  const draft = { ...toEditableDraft(t), label: "  100b  " };
  const built = buildVenueTableUpdate(t, draft);
  assert.equal(built.ok, true);
  if (built.ok) assert.deepEqual(built.update, { label: "100b" });
});

test("brouillon invalide → ok:false avec erreurs, aucun patch", () => {
  const t = vt();
  const draft = { ...toEditableDraft(t), capacity: 0 };
  const built = buildVenueTableUpdate(t, draft);
  assert.equal(built.ok, false);
  if (!built.ok) assert.ok(built.errors.length > 0);
});

test("x_pct hors bornes → refusé (miroir CHECK 0024)", () => {
  const t = vt({ x_pct: 50 });
  const built = buildVenueTableUpdate(t, { ...toEditableDraft(t), x_pct: 150 });
  assert.equal(built.ok, false);
});

test("isEditableField : n'accepte que les colonnes éditables", () => {
  assert.equal(isEditableField("capacity"), true);
  assert.equal(isEditableField("active"), true);
  assert.equal(isEditableField("id"), false);
  assert.equal(isEditableField("created_at"), false);
  assert.equal(isEditableField("venue"), false);
});

// ————————————————————————————————————————————————————————————————
// sortForEditing / capacityProgress — ce qui reste à faire est visible en premier
// ————————————————————————————————————————————————————————————————

test("sortForEditing : capacités à confirmer en tête, puis label croissant", () => {
  const tables = [
    vt({ id: "a", label: "704", capacity: 2 }),
    vt({ id: "b", label: "606", capacity: null }),
    vt({ id: "c", label: "100", capacity: 4 }),
    vt({ id: "d", label: "500", capacity: null }),
  ];
  const ordered = sortForEditing(tables).map((t) => t.label);
  // les deux NULL d'abord (606 puis 500 — wait numeric: 500 < 606), puis les connues (100 < 704)
  assert.deepEqual(ordered, ["500", "606", "100", "704"]);
});

test("sortForEditing n'altère pas le tableau d'entrée (copie)", () => {
  const tables = [vt({ label: "704", capacity: 2 }), vt({ label: "606", capacity: null })];
  const before = tables.map((t) => t.label);
  sortForEditing(tables);
  assert.deepEqual(tables.map((t) => t.label), before);
});

test("tablesNeedingCapacity : sous-ensemble des capacités NULL", () => {
  const tables = [vt({ label: "a", capacity: 2 }), vt({ label: "b", capacity: null }), vt({ label: "c", capacity: null })];
  assert.deepEqual(tablesNeedingCapacity(tables).map((t) => t.label), ["b", "c"]);
});

test("capacityProgress : compte honnête, complete seulement si tout renseigné", () => {
  assert.deepEqual(capacityProgress([]), { total: 0, known: 0, unknown: 0, complete: false });
  assert.deepEqual(
    capacityProgress([vt({ capacity: 2 }), vt({ capacity: null })]),
    { total: 2, known: 1, unknown: 1, complete: false },
  );
  assert.deepEqual(
    capacityProgress([vt({ capacity: 2 }), vt({ capacity: 4 })]),
    { total: 2, known: 2, unknown: 0, complete: true },
  );
});

test("editableVenues : univers connus uniques, ordre d'apparition, défensif", () => {
  const tables = [
    vt({ venue: "eden" }),
    vt({ venue: "terminus" }),
    vt({ venue: "eden" }),
    { ...vt(), venue: "mars" as unknown as VenueTable["venue"] },
  ];
  assert.deepEqual(editableVenues(tables), ["eden", "terminus"]);
});
