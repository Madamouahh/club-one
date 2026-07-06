import assert from "node:assert/strict";
import test from "node:test";

import {
  EDEN_SEED_V2,
  TABLE_KINDS,
  isVenue,
  type VenueTable,
} from "../lib/venueTables.ts";
import {
  CERCLE_SEED,
  CERCLE_TABLE_COUNT,
  CERCLE_VENUE,
  CERCLE_ZONES,
  CERCLE_ZONE_LABEL,
  cercleCapacityTotals,
  cercleFloorPlanModel,
  cercleTablesByZone,
  isCercleZone,
} from "../lib/cercleFloorPlan.ts";

// Baselines de RÉFÉRENCE pour la distinction inter-univers (audit G5) :
//   · Éden : 44 tables (dérivé de EDEN_SEED_V2, source de vérité du dépôt) ;
//   · Terminus : 18 tables (plan legacy documenté — pas de seed venue_tables, valeur de référence).
const EDEN_TABLE_COUNT = EDEN_SEED_V2.length;
const TERMINUS_TABLE_COUNT = 18;

// ————————————————————————————————————————————————————————————————
// Identité & vocabulaire de zones
// ————————————————————————————————————————————————————————————————

test("le Cercle est un univers connu (miroir du CHECK venue)", () => {
  assert.equal(CERCLE_VENUE, "cercle");
  assert.equal(isVenue(CERCLE_VENUE), true);
});

test("chaque zone a un libellé et isCercleZone garde le vocabulaire fermé", () => {
  for (const z of CERCLE_ZONES) {
    assert.ok(CERCLE_ZONE_LABEL[z], `libellé pour la zone ${z}`);
    assert.equal(isCercleZone(z), true);
  }
  assert.equal(isCercleZone("rooftop"), false);
  assert.equal(isCercleZone(null), false);
});

// ————————————————————————————————————————————————————————————————
// Compte DISTINCT des autres univers (cœur du mandat : pas un clone)
// ————————————————————————————————————————————————————————————————

test("le Cercle a 14 tables, distinct du Terminus (18) et de l'Éden (44)", () => {
  assert.equal(CERCLE_TABLE_COUNT, 14);
  assert.equal(CERCLE_SEED.length, 14);
  assert.notEqual(CERCLE_TABLE_COUNT, TERMINUS_TABLE_COUNT);
  assert.notEqual(CERCLE_TABLE_COUNT, EDEN_TABLE_COUNT);
  assert.equal(EDEN_TABLE_COUNT, 44); // garde-fou : la baseline Éden reste la vérité attendue
});

// ————————————————————————————————————————————————————————————————
// Cohérence interne du modèle
// ————————————————————————————————————————————————————————————————

test("labels uniques et zones toutes valides", () => {
  const labels = CERCLE_SEED.map((t) => t.label);
  assert.equal(new Set(labels).size, labels.length, "aucun label dupliqué");
  for (const t of CERCLE_SEED) {
    assert.equal(isCercleZone(t.zone), true, `zone valide pour ${t.label}`);
  }
});

test("toutes les positions restent dans le cadre [0,100]", () => {
  for (const t of CERCLE_SEED) {
    assert.ok(t.x_pct >= 0 && t.x_pct <= 100, `x_pct dans [0,100] pour ${t.label}`);
    assert.ok(t.y_pct >= 0 && t.y_pct <= 100, `y_pct dans [0,100] pour ${t.label}`);
  }
});

test("chaque kind du seed appartient à la nomenclature venue_tables", () => {
  for (const t of CERCLE_SEED) {
    assert.ok((TABLE_KINDS as readonly string[]).includes(t.kind), `kind connu pour ${t.label}`);
  }
});

test("invariant DEBOUT ⟺ capacité NULL (comme l'Éden) ; sinon capacité entière > 0", () => {
  for (const t of CERCLE_SEED) {
    assert.equal(
      t.standing,
      t.capacity === null,
      `standing (${t.standing}) doit valoir (capacity===null) pour ${t.label}`,
    );
    if (t.capacity !== null) {
      assert.ok(Number.isInteger(t.capacity) && t.capacity > 0, `capacité > 0 pour ${t.label}`);
    }
  }
});

test("shape cohérent avec le type : canapé carré, haute/modulable rondes", () => {
  for (const t of CERCLE_SEED) {
    if (t.kind === "canape") assert.equal(t.shape, "square", `canapé carré (${t.label})`);
    if (t.kind === "haute" || t.kind === "modulable") {
      assert.equal(t.shape, "round", `${t.kind} ronde (${t.label})`);
    }
  }
});

// ————————————————————————————————————————————————————————————————
// Composition & agrégats
// ————————————————————————————————————————————————————————————————

test("composition propre au Cercle : 8 canapés + 4 hautes + 2 modulables, 0 olivier", () => {
  const totals = cercleCapacityTotals();
  assert.equal(totals.byKind.canape, 8);
  assert.equal(totals.byKind.haute, 4);
  assert.equal(totals.byKind.modulable, 2);
  assert.equal(totals.byKind.olivier, 0, "aucune olivier → typologie distincte de l'Éden");
  // Le total par kind couvre exactement toutes les tables.
  const sum = TABLE_KINDS.reduce((acc, k) => acc + totals.byKind[k], 0);
  assert.equal(sum, CERCLE_TABLE_COUNT);
});

test("agrégats honnêtes : 52 places assises, 4 tables debout non comptées en assise", () => {
  const totals = cercleCapacityTotals();
  assert.equal(totals.tableCount, 14);
  assert.equal(totals.standingTables, 4);
  // 8 canapés × 6 + 2 modulables × 2 = 52 ; les 4 hautes (null) ne gonflent jamais ce total.
  assert.equal(totals.seatedCapacity, 8 * 6 + 2 * 2);
  assert.equal(totals.seatedCapacity, 52);
});

test("cercleTablesByZone couvre toutes les tables sans en fabriquer", () => {
  const byZone = cercleTablesByZone();
  let counted = 0;
  for (const z of CERCLE_ZONES) {
    const bucket = byZone.get(z);
    assert.ok(bucket, `bucket présent pour ${z}`);
    counted += bucket!.length;
  }
  assert.equal(counted, CERCLE_SEED.length);
  assert.equal(byZone.get("salon")!.length, 8);
  assert.equal(byZone.get("mezzanine")!.length, 4);
  assert.equal(byZone.get("alcove")!.length, 2);
});

// ————————————————————————————————————————————————————————————————
// Modèle de rendu (forme VenueTable attendue par lib/floorPlanView.ts)
// ————————————————————————————————————————————————————————————————

test("cercleFloorPlanModel produit des VenueTable cohérentes, id stable, toutes actives", () => {
  const model = cercleFloorPlanModel();
  assert.equal(model.length, CERCLE_SEED.length);
  const ids = model.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "ids déterministes uniques");
  for (const t of model) {
    assert.equal(t.venue, "cercle");
    assert.equal(t.active, true);
    assert.equal(t.id, `cercle-${t.label}`);
    // Le modèle est bien une VenueTable exploitable par la vue (champs requis présents).
    const asVenueTable: VenueTable = t;
    assert.ok(typeof asVenueTable.x_pct === "number" && typeof asVenueTable.y_pct === "number");
  }
});

test("le modèle recopie fidèlement le seed (aucune donnée réécrite au passage)", () => {
  const model = cercleFloorPlanModel();
  for (const src of CERCLE_SEED) {
    const rendered = model.find((t) => t.label === src.label);
    assert.ok(rendered, `table ${src.label} présente dans le modèle`);
    assert.equal(rendered!.x_pct, src.x_pct);
    assert.equal(rendered!.y_pct, src.y_pct);
    assert.equal(rendered!.shape, src.shape);
    assert.equal(rendered!.standing, src.standing);
    assert.equal(rendered!.capacity, src.capacity);
    assert.equal(rendered!.kind, src.kind);
  }
});
