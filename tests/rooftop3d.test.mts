import assert from "node:assert/strict";
import test from "node:test";

import { EDEN_SEED_V2, isTableKind } from "../lib/venueTables.ts";
import {
  DECK_DEPTH,
  DECK_LENGTH,
  ROOFTOP_PALETTE,
  TABLE_STATE_COLOR,
  buildTables3D,
  catenaryPoints,
  describeRooftop,
  djBoothBetween,
  geometryForKind,
  guirlandeSpans,
  initialCameraView,
  masts,
  railingPerimeter,
  seedToWorld,
  tableStateColor,
  withinDeck,
  type Point3,
} from "../lib/rooftop3d.ts";

// ————————————————————————————————————————————————————————————————
// Deck & ratio : la profondeur suit EXACTEMENT le ratio du screenshot (bande longue, rien inventé).
// ————————————————————————————————————————————————————————————————

test("deck : profondeur dérivée du ratio 952×506, pas une valeur au hasard", () => {
  const expected = Math.round(DECK_LENGTH * (506 / 952) * 1000) / 1000;
  assert.equal(DECK_DEPTH, expected);
  assert.ok(DECK_LENGTH > DECK_DEPTH, "le rooftop est une bande plus longue que profonde");
});

// ————————————————————————————————————————————————————————————————
// Tables : les 44 vraies tables, mêmes labels, DANS le deck, types préservés.
// ————————————————————————————————————————————————————————————————

test("buildTables3D : exactement 44 tables, labels = EDEN_SEED_V2 (aucune renumérotée)", () => {
  const tables = buildTables3D();
  assert.equal(tables.length, 44);
  assert.equal(tables.length, EDEN_SEED_V2.length);
  const seedLabels = EDEN_SEED_V2.map((e) => e.label).sort();
  const worldLabels = tables.map((t) => t.label).sort();
  assert.deepEqual(worldLabels, seedLabels);
});

test("buildTables3D : toutes les tables tombent DANS les limites du deck (aucune hors cadre)", () => {
  for (const t of buildTables3D()) {
    assert.ok(withinDeck(t.world), `table ${t.label} hors deck: ${JSON.stringify(t.world)}`);
  }
});

test("buildTables3D : kind valide + cohérence capacité/standing (haute = debout, cap null)", () => {
  for (const t of buildTables3D()) {
    assert.ok(isTableKind(t.kind), `kind invalide pour ${t.label}`);
    if (t.kind === "haute") {
      assert.equal(t.standing, true, `haute ${t.label} devrait être debout`);
      assert.equal(t.capacity, null, `haute ${t.label} n'a pas de capacité assise`);
    }
    if (t.kind === "canape" || t.kind === "olivier") {
      assert.equal(t.capacity, 6, `${t.kind} ${t.label} = 6 pers (fondateur)`);
    }
    if (t.kind === "modulable") {
      assert.equal(t.capacity, 2, `modulable ${t.label} = 2 pers`);
    }
  }
});

test("buildTables3D : la capacité est celle du seed (jamais fabriquée)", () => {
  const bySeed = new Map(EDEN_SEED_V2.map((e) => [e.label, e]));
  for (const t of buildTables3D()) {
    const e = bySeed.get(t.label);
    assert.ok(e);
    assert.equal(t.capacity, e.cap);
    assert.equal(t.standing, e.standing);
    assert.equal(t.kind, e.kind);
  }
});

// ————————————————————————————————————————————————————————————————
// Projection screenshot → monde : déterministe, centrée, orientée.
// ————————————————————————————————————————————————————————————————

test("seedToWorld : centre du screenshot → origine ; coins → coins du deck", () => {
  const center = seedToWorld({ px: 476, py: 253 });
  assert.equal(center.x, 0);
  assert.equal(center.z, 0);
  const topLeft = seedToWorld({ px: 0, py: 0 });
  assert.equal(topLeft.x, Math.round(-DECK_LENGTH / 2 * 1000) / 1000);
  assert.equal(topLeft.z, Math.round(-DECK_DEPTH / 2 * 1000) / 1000);
});

test("seedToWorld : déterministe (même entrée → même sortie)", () => {
  const a = seedToWorld({ px: 300, py: 200 });
  const b = seedToWorld({ px: 300, py: 200 });
  assert.deepEqual(a, b);
});

// ————————————————————————————————————————————————————————————————
// Mobilier par type : reflet du brief (canapé bas & large, haute étroite & haute, olivier a un arbre).
// ————————————————————————————————————————————————————————————————

test("geometryForKind : canapé carré bas large, haute ronde étroite haute, olivier porte un arbre", () => {
  const canape = geometryForKind("canape");
  assert.equal(canape.footprint, "square");
  const haute = geometryForKind("haute");
  const modulable = geometryForKind("modulable");
  assert.ok(haute.height > modulable.height, "mange-debout plus HAUT qu'une table assise");
  assert.ok(haute.radius < canape.radius, "mange-debout plus ÉTROIT qu'un canapé");
  assert.equal(geometryForKind("olivier").hasOliveTree, true);
  assert.equal(geometryForKind("modulable").hasOliveTree, false);
});

// ————————————————————————————————————————————————————————————————
// Cabine DJ : DÉRIVÉE (milieu de 304 et 406), jamais posée à la main. Garde dure si table absente.
// ————————————————————————————————————————————————————————————————

test("djBoothBetween : au milieu géométrique de 304 et 406", () => {
  const tables = buildTables3D();
  const t304 = tables.find((t) => t.label === "304");
  const t406 = tables.find((t) => t.label === "406");
  assert.ok(t304 && t406);
  const booth = djBoothBetween(tables);
  assert.equal(booth.world.x, Math.round(((t304.world.x + t406.world.x) / 2) * 1000) / 1000);
  assert.equal(booth.world.z, Math.round(((t304.world.z + t406.world.z) / 2) * 1000) / 1000);
  // strictement entre les deux tables (bornes incluses)
  const [xmin, xmax] = [Math.min(t304.world.x, t406.world.x), Math.max(t304.world.x, t406.world.x)];
  assert.ok(booth.world.x >= xmin && booth.world.x <= xmax);
});

test("djBoothBetween : lève si une table de référence manque (garde dure, rien inventé)", () => {
  assert.throws(() => djBoothBetween(buildTables3D(), "999", "406"), /introuvable/);
});

// ————————————————————————————————————————————————————————————————
// Périmètre & mâts : garde-corps rectangulaire, un mât central + périphériques.
// ————————————————————————————————————————————————————————————————

test("railingPerimeter : 4 coins du deck, boucle rectangulaire", () => {
  const p = railingPerimeter();
  assert.equal(p.length, 4);
  for (const c of p) {
    assert.equal(Math.abs(c.x), DECK_LENGTH / 2);
    assert.equal(Math.abs(c.z), DECK_DEPTH / 2);
  }
});

test("masts : exactement un mât central + des périphériques plus courts", () => {
  const m = masts();
  const central = m.filter((x) => x.central);
  assert.equal(central.length, 1);
  assert.equal(central[0].world.x, 0);
  assert.equal(central[0].world.z, 0);
  for (const p of m.filter((x) => !x.central)) {
    assert.ok(p.height <= central[0].height, "mât périphérique ≤ mât central");
  }
});

// ————————————————————————————————————————————————————————————————
// Guirlandes caténaires : extrémités exactes, creux au centre, symétrie.
// ————————————————————————————————————————————————————————————————

test("catenaryPoints : segments+1 points, extrémités exactes, milieu le plus bas", () => {
  const a: Point3 = { x: -10, y: 4, z: 0 };
  const b: Point3 = { x: 10, y: 4, z: 0 };
  const pts = catenaryPoints(a, b, 1.5, 16);
  assert.equal(pts.length, 17);
  assert.deepEqual(pts[0], a);
  assert.deepEqual(pts[pts.length - 1], b);
  const mid = pts[8];
  assert.equal(Math.round(mid.y * 1000) / 1000, Math.round((4 - 1.5) * 1000) / 1000);
  // le point du milieu est le plus bas de tous
  for (const p of pts) assert.ok(p.y >= mid.y - 1e-9);
  // symétrie gauche/droite en y
  for (let i = 0; i < pts.length; i += 1) {
    const mirror = pts[pts.length - 1 - i];
    assert.ok(Math.abs(pts[i].y - mirror.y) < 1e-9, `asymétrie à i=${i}`);
  }
});

test("guirlandeSpans : plusieurs travées, toutes pendantes sous l'ancrage", () => {
  const spans = guirlandeSpans(4.2, 0.9, 3);
  assert.equal(spans.length, 3);
  for (const s of spans) {
    const ys = s.points.map((p) => p.y);
    const maxY = Math.max(...ys);
    const minY = Math.min(...ys);
    assert.ok(maxY <= 4.2 + 1e-9, "aucun point au-dessus de l'ancrage");
    assert.ok(minY < maxY, "le câble pend (creux réel)");
  }
});

// ————————————————————————————————————————————————————————————————
// Palette & états : clés attendues, hex valides, états distincts.
// ————————————————————————————————————————————————————————————————

test("ROOFTOP_PALETTE : toutes les couleurs sont des entiers 0x000000..0xffffff", () => {
  for (const [k, v] of Object.entries(ROOFTOP_PALETTE)) {
    assert.equal(typeof v, "number", `${k} n'est pas un nombre`);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffff, `${k} hors plage hex: ${v}`);
  }
});

test("tableStateColor : trois états, trois couleurs distinctes", () => {
  const libre = tableStateColor("libre");
  const dem = tableStateColor("demandee");
  const indispo = tableStateColor("indisponible");
  assert.equal(new Set([libre, dem, indispo]).size, 3);
  assert.equal(libre, TABLE_STATE_COLOR.libre);
});

// ————————————————————————————————————————————————————————————————
// Caméra initiale : plongeante, en recul (voit tout le rooftop).
// ————————————————————————————————————————————————————————————————

test("initialCameraView : caméra en recul et surélevée, vise le centre bas", () => {
  const cam = initialCameraView();
  assert.ok(cam.position.y > 0, "caméra surélevée");
  assert.ok(cam.position.z > DECK_DEPTH / 2, "caméra en recul hors du deck");
  assert.equal(cam.target.x, 0);
  assert.ok(cam.fov > 0 && cam.fov < 120);
});

// ————————————————————————————————————————————————————————————————
// Spec complète : cohérence d'ensemble (un seul appel déterministe).
// ————————————————————————————————————————————————————————————————

test("describeRooftop : scène complète cohérente (44 tables, DJ dérivé, 5 mâts, guirlandes)", () => {
  const s = describeRooftop();
  assert.equal(s.tables.length, 44);
  assert.equal(s.deck.length, DECK_LENGTH);
  assert.equal(s.deck.depth, DECK_DEPTH);
  assert.equal(s.masts.length, 5);
  assert.equal(s.railing.length, 4);
  assert.ok(s.guirlandes.length >= 1);
  assert.ok(withinDeck(s.djBooth.world));
  assert.equal(s.palette, ROOFTOP_PALETTE);
});
