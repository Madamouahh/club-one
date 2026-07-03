import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  EDEN_SCREENSHOT_REF,
  EDEN_SEED,
  EDEN_SEED_V2,
  EDEN_STANDING_LABELS,
  SHAPE_BY_LETTER,
  TABLE_KIND_LABEL,
  TABLE_KINDS,
  TABLE_SHAPES,
  VENUES,
  capacityKnown,
  capacityLabel,
  groupByVenue,
  isTableKind,
  isTableShape,
  isVenue,
  pixelToPct,
  planReady,
  planSummary,
  seedToPct,
  seedToPortraitPct,
  tableKindLabel,
  tableKindLabelV2,
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

// ————————————————————————————————————————————————————————————————
// EDEN_SEED_V2 — plan « proprement » (corrections fondateur 2026-07-03) + cross-check migration 0031
// ————————————————————————————————————————————————————————————————

// Ensembles de labels attendus par TYPE (règles fondateur explicites, jamais devinées).
const CANAPE_LABELS = ["100", "101", "102", "103", "104", "105"]; // 6 pers chacun
const OLIVIER_LABELS = ["200", "201", "202", "203", "204", "205"]; // 6 pers chacun

test("EDEN_SEED_V2 : exactement 44 tables, mêmes labels que V1 (mêmes zones/numéros)", () => {
  assert.equal(EDEN_SEED_V2.length, 44);
  const v1 = new Set(EDEN_SEED.map((s) => s.label));
  const v2 = new Set(EDEN_SEED_V2.map((s) => s.label));
  assert.equal(v2.size, 44);
  assert.deepEqual([...v2].sort(), [...v1].sort());
});

test("EDEN_SEED_V2 : chaque table a un kind valide", () => {
  for (const s of EDEN_SEED_V2) {
    assert.ok(isTableKind(s.kind), `kind invalide pour ${s.label}: ${s.kind}`);
  }
});

test("EDEN_SEED_V2 : canapés = 100-105, tous 6 pers, forme square (règle fondateur)", () => {
  const canapes = EDEN_SEED_V2.filter((s) => s.kind === "canape");
  assert.deepEqual(canapes.map((s) => s.label).sort(), [...CANAPE_LABELS].sort());
  for (const s of canapes) {
    assert.equal(s.cap, 6, `canapé ${s.label} devrait être 6 pers`);
    assert.equal(s.shape, "square", `canapé ${s.label} devrait être square`);
    assert.equal(s.standing, false);
  }
});

test("EDEN_SEED_V2 : oliviers = 200-205, tous 6 pers assis (règle fondateur)", () => {
  const oliviers = EDEN_SEED_V2.filter((s) => s.kind === "olivier");
  assert.deepEqual(oliviers.map((s) => s.label).sort(), [...OLIVIER_LABELS].sort());
  for (const s of oliviers) {
    assert.equal(s.cap, 6, `olivier ${s.label} devrait être 6 pers`);
    assert.equal(s.standing, false);
  }
});

test("EDEN_SEED_V2 : hautes debout = liste EXACTE fondateur (106,107,400-406,500), cap null par nature", () => {
  const hautes = EDEN_SEED_V2.filter((s) => s.kind === "haute");
  assert.deepEqual(hautes.map((s) => s.label).sort(), [...EDEN_STANDING_LABELS].sort());
  for (const s of hautes) {
    assert.equal(s.standing, true, `haute ${s.label} devrait être debout`);
    assert.equal(s.cap, null, `haute ${s.label} = groupe debout sans capacité assise`);
  }
});

test("EDEN_SEED_V2 : tout le reste = modulables 2 pers assis", () => {
  const typed = new Set([...CANAPE_LABELS, ...OLIVIER_LABELS, ...EDEN_STANDING_LABELS]);
  const modulables = EDEN_SEED_V2.filter((s) => s.kind === "modulable");
  // Les modulables sont exactement les tables NON canapé/olivier/haute.
  assert.deepEqual(
    modulables.map((s) => s.label).sort(),
    EDEN_SEED_V2.filter((s) => !typed.has(s.label)).map((s) => s.label).sort(),
  );
  for (const s of modulables) {
    assert.equal(s.cap, 2, `modulable ${s.label} devrait être 2 pers`);
    assert.equal(s.standing, false);
  }
});

test("EDEN_SEED_V2 : cohérence standing ⟺ haute et capacité null ⟺ haute (aucune table assise sans capacité)", () => {
  for (const s of EDEN_SEED_V2) {
    assert.equal(s.standing, s.kind === "haute", `standing/kind incohérents pour ${s.label}`);
    assert.equal(s.cap === null, s.kind === "haute", `capacité null hors debout pour ${s.label}`);
  }
});

test("tableKindLabelV2 : rend le libellé de type d'assise réel quand kind connu, sinon repli V1", () => {
  for (const kind of TABLE_KINDS) {
    assert.equal(
      tableKindLabelV2({ shape: "round", standing: false, kind }),
      TABLE_KIND_LABEL[kind],
    );
  }
  // Sans kind : repli exact sur tableKindLabel (compat V1).
  const noKind = { shape: "round" as const, standing: true, kind: null };
  assert.equal(tableKindLabelV2(noKind), tableKindLabel(noKind));
});

test("seedToPortraitPct : rotation 90° — rangée 700 (px bas) arrive en HAUT du portrait (y petit)", () => {
  const r704 = EDEN_SEED_V2.find((s) => s.label === "704")!;
  const canape104 = EDEN_SEED_V2.find((s) => s.label === "104")!;
  const p704 = seedToPortraitPct(r704);
  const p104 = seedToPortraitPct(canape104);
  // 704 est tout à gauche du screenshot (px petit) → en haut du portrait (y_pct petit).
  assert.ok(p704.y_pct < p104.y_pct, "704 devrait être plus haut que 104 en portrait");
  // Bornes % valides.
  for (const p of [p704, p104]) {
    assert.ok(p.x_pct >= 0 && p.x_pct <= 100);
    assert.ok(p.y_pct >= 0 && p.y_pct <= 100);
  }
});

// —— Cross-check STATIQUE (niveau 3) : EDEN_SEED_V2 doit être le miroir EXACT de la migration 0031 ——
// Ne prouve PAS l'exécution PostgreSQL (niveau 4, LABO) ; prouve que le code et le SQL disent la même chose.

type SqlRow = {
  px: number;
  py: number;
  shape: string;
  standing: boolean;
  capacity: number | null;
  kind: string;
  label: string;
};

function parse0031(): SqlRow[] {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "0031_eden_plan_v2.sql"),
    "utf8",
  );
  const re =
    /update public\.venue_tables set x_pct = round\(\((\d+)::numeric\/952\)\*100,3\),\s*y_pct = round\(\((\d+)::numeric\/506\)\*100,3\), shape='(\w+)', standing=(true|false), capacity=(\d+|null), kind='(\w+)' where venue='eden' and label='(\w+)';/g;
  const rows: SqlRow[] = [];
  for (const m of sql.matchAll(re)) {
    rows.push({
      px: Number(m[1]),
      py: Number(m[2]),
      shape: m[3],
      standing: m[4] === "true",
      capacity: m[5] === "null" ? null : Number(m[5]),
      kind: m[6],
      label: m[7],
    });
  }
  return rows;
}

test("0031 ↔ EDEN_SEED_V2 : 44 UPDATE parsés, mêmes labels (miroir code/SQL)", () => {
  const rows = parse0031();
  assert.equal(rows.length, 44, "44 lignes UPDATE attendues dans 0031");
  const sqlLabels = new Set(rows.map((r) => r.label));
  const seedLabels = new Set(EDEN_SEED_V2.map((s) => s.label));
  assert.deepEqual([...sqlLabels].sort(), [...seedLabels].sort());
});

test("0031 ↔ EDEN_SEED_V2 : chaque ligne SQL = pixels/forme/standing/capacité/kind identiques au seed", () => {
  const rows = parse0031();
  const byLabel = new Map(EDEN_SEED_V2.map((s) => [s.label, s]));
  for (const r of rows) {
    const s = byLabel.get(r.label);
    assert.ok(s, `label ${r.label} du SQL absent du seed`);
    assert.equal(r.px, s!.px, `px divergent pour ${r.label}`);
    assert.equal(r.py, s!.py, `py divergent pour ${r.label}`);
    assert.equal(r.shape, s!.shape, `shape divergent pour ${r.label}`);
    assert.equal(r.standing, s!.standing, `standing divergent pour ${r.label}`);
    assert.equal(r.capacity, s!.cap, `capacité divergente pour ${r.label}`);
    assert.equal(r.kind, s!.kind, `kind divergent pour ${r.label}`);
  }
});

// —— Cross-check STATIQUE (niveau 3) : le layout EDEN_TABLES du MONOLITHE (app/page.tsx) doit être
// le miroir EXACT de EDEN_SEED_V2 (lib/venueTables.ts). Deux constantes, une seule vérité : le seed
// est la source (croisée avec 0031), le monolithe en est la projection portrait pour l'écran équipes.
// Introduit par le commit d'intégration « l'Eden se gère DANS l'appli » (2aa7025) — sans ce garde,
// les deux tableaux peuvent dériver silencieusement (une table renumérotée, une capacité changée d'un
// seul côté). Ne prouve PAS le rendu React (niveau 5) ; prouve que code monolithe et lib disent pareil.

type EdenLayoutRow = {
  id: string;
  zone: string;
  x: number;
  y: number;
  status: string;
  capacity: number;
};

// Extrait le tableau `const EDEN_TABLES: ClubTable[] = [ ... ];` de app/page.tsx par parsing texte
// (la constante n'est ni exportée ni importable : app/page.tsx est un monolithe client React).
function parseEdenTablesFromMonolith(): EdenLayoutRow[] {
  const src = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
  const start = src.indexOf("const EDEN_TABLES: ClubTable[] = [");
  assert.ok(start >= 0, "const EDEN_TABLES introuvable dans app/page.tsx");
  const end = src.indexOf("];", start);
  assert.ok(end > start, "fin du tableau EDEN_TABLES introuvable");
  const block = src.slice(start, end);
  const re =
    /\{ id: "(\w+)", zone: "([^"]+)", x: (-?[\d.]+), y: (-?[\d.]+), status: "(\w+)", capacity: (-?\d+) \}/g;
  const rows: EdenLayoutRow[] = [];
  for (const m of block.matchAll(re)) {
    rows.push({
      id: m[1],
      zone: m[2],
      x: Number(m[3]),
      y: Number(m[4]),
      status: m[5],
      capacity: Number(m[6]),
    });
  }
  return rows;
}

test("EDEN_TABLES (monolithe) ↔ EDEN_SEED_V2 : exactement 44 tables, mêmes labels", () => {
  const rows = parseEdenTablesFromMonolith();
  assert.equal(rows.length, 44, "44 tables attendues dans EDEN_TABLES du monolithe");
  const monoLabels = new Set(rows.map((r) => r.id));
  assert.equal(monoLabels.size, 44, "labels dupliqués dans EDEN_TABLES");
  const seedLabels = new Set(EDEN_SEED_V2.map((s) => s.label));
  assert.deepEqual([...monoLabels].sort(), [...seedLabels].sort(), "labels divergents monolithe/seed");
});

test("EDEN_TABLES (monolithe) : toutes les tables partent libres (status free)", () => {
  const rows = parseEdenTablesFromMonolith();
  for (const r of rows) {
    assert.equal(r.status, "free", `table ${r.id} ne part pas 'free'`);
  }
});

test("EDEN_TABLES ↔ EDEN_SEED_V2 : capacité cohérente (0=debout ⟺ haute, sinon = cap du seed)", () => {
  const rows = parseEdenTablesFromMonolith();
  const byLabel = new Map(EDEN_SEED_V2.map((s) => [s.label, s]));
  for (const r of rows) {
    const s = byLabel.get(r.id);
    assert.ok(s, `table ${r.id} du monolithe absente du seed`);
    if (s!.kind === "haute") {
      // Mange-debout : le monolithe encode capacity 0 (groupe debout, sans chaise), le seed cap null.
      assert.equal(r.capacity, 0, `table debout ${r.id} devrait avoir capacity 0 dans le monolithe`);
      assert.equal(s!.cap, null, `table haute ${r.id} devrait avoir cap null dans le seed`);
      assert.equal(s!.standing, true, `table haute ${r.id} devrait être standing dans le seed`);
    } else {
      // Assise : capacité identique de part et d'autre (modulable 2, olivier/canapé 6).
      assert.equal(r.capacity, s!.cap, `capacité divergente pour ${r.id} (mono ${r.capacity} / seed ${s!.cap})`);
      assert.ok(r.capacity > 0, `table assise ${r.id} devrait avoir une capacité > 0 dans le monolithe`);
    }
  }
});

test("EDEN_TABLES ↔ EDEN_SEED_V2 : zone du monolithe cohérente avec le kind du seed", () => {
  const rows = parseEdenTablesFromMonolith();
  const byLabel = new Map(EDEN_SEED_V2.map((s) => [s.label, s]));
  for (const r of rows) {
    const s = byLabel.get(r.id)!;
    switch (s.kind) {
      case "haute":
        assert.equal(r.zone, "Mange-debout", `table haute ${r.id} devrait être zone Mange-debout`);
        break;
      case "canape":
        assert.equal(r.zone, "Canapés", `canapé ${r.id} devrait être zone Canapés`);
        break;
      case "olivier":
        assert.equal(r.zone, "Oliviers", `olivier ${r.id} devrait être zone Oliviers`);
        break;
      case "modulable":
        assert.match(r.zone, /^Rangée \d00$/, `modulable ${r.id} devrait être dans une Rangée N00`);
        break;
      default:
        assert.fail(`kind inattendu ${s.kind} pour ${r.id}`);
    }
  }
});

test("EDEN_TABLES ↔ EDEN_SEED_V2 : positions = projection portrait du seed (à l'arrondi au dixième près)", () => {
  // Le monolithe stocke les positions au dixième de % ; elles doivent être la projection portrait
  // du seed (rotation pure 90°). Tolérance 0.06 % = un demi-dixième, l'écart d'arrondi maximal légitime
  // (~0,3 px sur un écran de 390 px). Un vrai déplacement de table serait supérieur d'un ordre de
  // grandeur, donc toujours capté. Comparaison contre la projection BRUTE (avant arrondi au dixième)
  // pour ne pas dépendre du sens d'arrondi (ex. 201 : brut 73.95, monolithe 73.9 → écart 0.05, OK).
  const rows = parseEdenTablesFromMonolith();
  const byLabel = new Map(EDEN_SEED_V2.map((s) => [s.label, s]));
  const TOL = 0.06;
  for (const r of rows) {
    const s = byLabel.get(r.id)!;
    const proj = seedToPortraitPct({ px: s.px, py: s.py }, EDEN_SCREENSHOT_REF);
    assert.ok(
      Math.abs(r.x - proj.x_pct) <= TOL,
      `x divergent pour ${r.id} (mono ${r.x} / projeté ${proj.x_pct}, écart ${Math.abs(r.x - proj.x_pct).toFixed(3)})`,
    );
    assert.ok(
      Math.abs(r.y - proj.y_pct) <= TOL,
      `y divergent pour ${r.id} (mono ${r.y} / projeté ${proj.y_pct}, écart ${Math.abs(r.y - proj.y_pct).toFixed(3)})`,
    );
  }
});
