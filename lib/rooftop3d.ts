// lib/rooftop3d.ts — GÉOMÉTRIE PURE du PLAN CLIENT 3D « rooftop Eden » (site public), aucun réseau,
// aucun DOM, aucun WebGL. Ce module DÉCRIT la scène ; le rendu Three.js (side-effectful) vit dans
// la route d'aperçu isolée app/rooftop-3d-preview et n'appelle que ces descripteurs déterministes.
//
// Source des tables : EDEN_SEED_V2 (lib/venueTables) — les 44 tables réelles du fondateur (V2 « proprement »),
// gardées des DEUX côtés (EDEN_TABLES monolithe ↔ EDEN_SEED_V2 ↔ migration 0031). Aucune position inventée :
// on PROJETTE le repère screenshot 952×506 sur un sol 3D centré, sans réordonner ni renuméroter.
//
// Brief de référence : club-one-lab/reference-eden/BRIEF_3D_EDEN.md (géométrie du lieu, mobilier par type,
// palette golden hour). Le rendu est STYLISÉ — un beau stylisé cohérent, pas du photoréalisme raté — et ne
// publie JAMAIS les frames de référence (visages clients → référence interne uniquement).
//
// Règle dure : rien de fabriqué. Une table haute « debout » a capacity null PAR NATURE (pas un manque).
// Les états (libre / demandée / indisponible) sont fournis par l'appelant (dérivés de vraies demandes),
// jamais inventés ici : ce module ne connaît que la GÉOMÉTRIE et la PALETTE.

import {
  EDEN_SCREENSHOT_REF,
  EDEN_SEED_V2,
  type EdenSeedV2Entry,
  type TableKind,
} from "./venueTables.ts";

// ————————————————————————————————————————————————————————————————
// Dimensions du deck (mètres, repère 3D centré sur l'origine)
// ————————————————————————————————————————————————————————————————
//
// Le rooftop est une bande LONGUE (screenshot 952×506, ratio ≈ 1.88). On garde ce ratio exact : la
// longueur du deck (axe X) = DECK_LENGTH ; la profondeur (axe Z) en découle. L'origine est au centre,
// donc x ∈ [−L/2, +L/2] et z ∈ [−D/2, +D/2]. Y = hauteur (0 = plancher deck).

export const DECK_LENGTH = 40; // mètres, axe X (longueur du rooftop)
export const DECK_DEPTH = Math.round((DECK_LENGTH * (EDEN_SCREENSHOT_REF.height / EDEN_SCREENSHOT_REF.width)) * 1000) / 1000; // ≈ 21.26

// ————————————————————————————————————————————————————————————————
// Palette « golden hour » (brief) — l'identité visuelle du lieu au coucher de soleil.
// Bois clair/miel · toile crème/taupe · coussins écrus · zellige émeraude · ciel pêche/or · accents
// bleu nuit. AUCUN néon criard. Valeurs hex 0xRRGGBB (consommées telles quelles par Three.Color).
// ————————————————————————————————————————————————————————————————

export const ROOFTOP_PALETTE = {
  deckWood: 0x9c7a4e, // bois miel (deck)
  toileCream: 0xe9e0cf, // toile tendue crème/taupe
  mastWood: 0x7a5a37, // mâts bois flotté
  cushionEcru: 0xd8cdb6, // coussins / poufs écrus (canapés)
  zelligeEmerald: 0x1f7a63, // plateaux zellige émeraude (modulables)
  olive: 0x5c6e43, // feuillage oliviers
  planter: 0x6a4a2c, // bacs / pots bois
  glassRail: 0x9fb8c4, // garde-corps vitré (teinte froide translucide)
  skyPeach: 0xf4b982, // ciel pêche (fond / hémisphère haut)
  skyGround: 0x2a2340, // sol d'ambiance nuit (hémisphère bas)
  nightBlue: 0x3d5a8a, // accent flood bleu nuit
  warmLight: 0xffd9a0, // guirlandes 2700K / rasant chaud
  djBooth: 0x2b2b30, // meuble DJ sobre
} as const;

// Couleurs d'ÉTAT d'une table (lisibles SANS texte — halo/émissif). Fournies à l'appelant qui mappe
// un état réel → une couleur ; jamais utilisées pour fabriquer une disponibilité.
export type TableState = "libre" | "demandee" | "indisponible";

export const TABLE_STATE_COLOR: Record<TableState, number> = {
  libre: 0x3fae82, // émeraude douce (disponible)
  demandee: 0xe0a94a, // ambre (demande en cours)
  indisponible: 0x555a63, // gris éteint (non réservable / complet)
};

export function tableStateColor(state: TableState): number {
  return TABLE_STATE_COLOR[state];
}

// ————————————————————————————————————————————————————————————————
// Projection screenshot → monde 3D (déterministe, testable)
// ————————————————————————————————————————————————————————————————

export type WorldXZ = { x: number; z: number };

// px ∈ [0, 952], py ∈ [0, 506] → sol centré. Le côté GAUCHE du screenshot (rangée 700) reste à x négatif ;
// le HAUT du screenshot (côté vue/garde-corps) reste à z négatif. Aucun arrondi divergent : math directe.
export function seedToWorld(
  entry: Pick<EdenSeedV2Entry, "px" | "py">,
  ref = EDEN_SCREENSHOT_REF,
): WorldXZ {
  const u = entry.px / ref.width; // [0,1] le long de la longueur
  const v = entry.py / ref.height; // [0,1] le long de la profondeur
  return {
    x: Math.round((u - 0.5) * DECK_LENGTH * 1000) / 1000,
    z: Math.round((v - 0.5) * DECK_DEPTH * 1000) / 1000,
  };
}

// ————————————————————————————————————————————————————————————————
// Mobilier par type (brief §Mobilier) — dimensions stylisées cohérentes
// ————————————————————————————————————————————————————————————————
//
// Chaque type d'assise a une empreinte au sol et une hauteur propres. Les tables hautes « debout »
// sont plus HAUTES et plus étroites (mange-debout) ; les canapés sont BAS et larges ; les oliviers
// portent un arbre en pot ; les modulables ont un petit plateau zellige.

export type TableFootprint = "round" | "square";

export type TableGeometry = {
  footprint: TableFootprint; // round (table ronde) | square (banquette/canapé)
  radius: number; // demi-largeur au sol (m)
  height: number; // hauteur du meuble (m)
  hasOliveTree: boolean; // olivier en pot à côté (kind = olivier)
  topColor: number; // couleur dominante du plateau/assise
};

// Géométrie déterministe par type d'assise. Aucune valeur au hasard : reflet du brief.
export function geometryForKind(kind: TableKind): TableGeometry {
  switch (kind) {
    case "canape":
      return { footprint: "square", radius: 1.2, height: 0.75, hasOliveTree: false, topColor: ROOFTOP_PALETTE.cushionEcru };
    case "olivier":
      return { footprint: "round", radius: 0.9, height: 0.74, hasOliveTree: true, topColor: ROOFTOP_PALETTE.deckWood };
    case "haute":
      return { footprint: "round", radius: 0.45, height: 1.1, hasOliveTree: false, topColor: ROOFTOP_PALETTE.mastWood };
    case "modulable":
    default:
      return { footprint: "round", radius: 0.55, height: 0.74, hasOliveTree: false, topColor: ROOFTOP_PALETTE.zelligeEmerald };
  }
}

// Un descripteur de table 3D complet, prêt pour le rendu (aucun état — l'état est appliqué au rendu).
export type Table3D = {
  label: string;
  kind: TableKind;
  capacity: number | null;
  standing: boolean;
  world: WorldXZ;
  geometry: TableGeometry;
};

export function buildTables3D(seed: readonly EdenSeedV2Entry[] = EDEN_SEED_V2): Table3D[] {
  return seed.map((e) => ({
    label: e.label,
    kind: e.kind,
    capacity: e.cap,
    standing: e.standing,
    world: seedToWorld(e),
    geometry: geometryForKind(e.kind),
  }));
}

// ————————————————————————————————————————————————————————————————
// Éléments FIXES du lieu (non réservables) : cabine DJ, mâts + toile, guirlandes, garde-corps
// ————————————————————————————————————————————————————————————————

export type DjBooth = { world: WorldXZ; width: number; depth: number; height: number };

// La cabine DJ est ENTRE 304 et 406 (fondateur). On la place au milieu géométrique de ces deux tables
// dans le monde 3D — donnée dérivée, jamais posée à la main. Lève si l'une des deux manque (garde dure).
export function djBoothBetween(
  tables: readonly Table3D[] = buildTables3D(),
  a = "304",
  b = "406",
): DjBooth {
  const ta = tables.find((t) => t.label === a);
  const tb = tables.find((t) => t.label === b);
  if (!ta || !tb) {
    throw new Error(`djBoothBetween: table(s) introuvable(s) pour la cabine DJ (${a}/${b})`);
  }
  return {
    world: {
      x: Math.round(((ta.world.x + tb.world.x) / 2) * 1000) / 1000,
      z: Math.round(((ta.world.z + tb.world.z) / 2) * 1000) / 1000,
    },
    width: 2.4,
    depth: 1.4,
    height: 1.2,
  };
}

// Garde-corps vitré : rectangle périmétrique du deck (coins dans l'ordre, boucle fermée par l'appelant).
export function railingPerimeter(): WorldXZ[] {
  const hx = DECK_LENGTH / 2;
  const hz = DECK_DEPTH / 2;
  return [
    { x: -hx, z: -hz },
    { x: hx, z: -hz },
    { x: hx, z: hz },
    { x: -hx, z: hz },
  ];
}

// Mâts porteurs de la toile : un MÂT CENTRAL + quatre mâts périphériques (brief). Positions déterministes.
export type Mast = { world: WorldXZ; height: number; central: boolean };

export function masts(): Mast[] {
  const qx = DECK_LENGTH / 4;
  const qz = DECK_DEPTH / 4;
  return [
    { world: { x: 0, z: 0 }, height: 6.5, central: true },
    { world: { x: -qx, z: -qz }, height: 5, central: false },
    { world: { x: qx, z: -qz }, height: 5, central: false },
    { world: { x: qx, z: qz }, height: 5, central: false },
    { world: { x: -qx, z: qz }, height: 5, central: false },
  ];
}

// ————————————————————————————————————————————————————————————————
// Guirlandes guinguette — courbe caténaire (signature visuelle n°1)
// ————————————————————————————————————————————————————————————————
//
// Une travée de guirlande relie deux points d'ancrage haut ; le câble PEND (sag) au milieu. On échantillonne
// la courbe : approximation parabolique symétrique (le point le plus BAS est au centre). segments ≥ 1.
// Renvoie segments+1 points ; les extrémités valent EXACTEMENT a et b ; le milieu descend de `sag`.

export type Point3 = { x: number; y: number; z: number };

export function catenaryPoints(a: Point3, b: Point3, sag: number, segments = 16): Point3[] {
  const n = Math.max(1, Math.floor(segments));
  const pts: Point3[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n; // [0,1]
    // Poids parabolique du creux : 0 aux extrémités, 1 au centre (t=0.5).
    const dip = 1 - Math.pow(2 * t - 1, 2);
    pts.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t - sag * dip,
      z: a.z + (b.z - a.z) * t,
    });
  }
  return pts;
}

// Travées de guirlandes tendues le long du rooftop (entre les mâts périphériques, dans le sens de la
// longueur), à hauteur d'ancrage `anchorY`, avec un creux `sag`. Purement géométrique.
export function guirlandeSpans(anchorY = 4.2, sag = 0.9, rows = 3): Array<{ points: Point3[] }> {
  const hx = DECK_LENGTH / 2;
  const out: Array<{ points: Point3[] }> = [];
  const n = Math.max(1, Math.floor(rows));
  for (let r = 0; r < n; r += 1) {
    // Réparties régulièrement sur la profondeur (marge de bord aux deux extrémités).
    const zPos = -DECK_DEPTH / 2 + (DECK_DEPTH * (r + 1)) / (n + 1);
    out.push({
      points: catenaryPoints(
        { x: -hx * 0.9, y: anchorY, z: zPos },
        { x: hx * 0.9, y: anchorY, z: zPos },
        sag,
        24,
      ),
    });
  }
  return out;
}

// ————————————————————————————————————————————————————————————————
// Vue caméra initiale (brief §UX : vue d'ensemble légèrement plongeante, hauteur d'homme)
// ————————————————————————————————————————————————————————————————

export type CameraView = { position: Point3; target: Point3; fov: number };

export function initialCameraView(): CameraView {
  return {
    position: { x: 0, y: 9, z: DECK_DEPTH * 1.15 + 6 },
    target: { x: 0, y: 1, z: 0 },
    fov: 50,
  };
}

// ————————————————————————————————————————————————————————————————
// Spec complète de la scène (un seul appel déterministe pour le rendu ET les tests)
// ————————————————————————————————————————————————————————————————

export type RooftopScene = {
  deck: { length: number; depth: number };
  tables: Table3D[];
  djBooth: DjBooth;
  masts: Mast[];
  railing: WorldXZ[];
  guirlandes: Array<{ points: Point3[] }>;
  camera: CameraView;
  palette: typeof ROOFTOP_PALETTE;
};

export function describeRooftop(seed: readonly EdenSeedV2Entry[] = EDEN_SEED_V2): RooftopScene {
  const tables = buildTables3D(seed);
  return {
    deck: { length: DECK_LENGTH, depth: DECK_DEPTH },
    tables,
    djBooth: djBoothBetween(tables),
    masts: masts(),
    railing: railingPerimeter(),
    guirlandes: guirlandeSpans(),
    camera: initialCameraView(),
    palette: ROOFTOP_PALETTE,
  };
}

// Une table est-elle dans les limites du deck ? (garde de projection : aucune table hors cadre.)
export function withinDeck(world: WorldXZ): boolean {
  return (
    Math.abs(world.x) <= DECK_LENGTH / 2 + 1e-6 &&
    Math.abs(world.z) <= DECK_DEPTH / 2 + 1e-6
  );
}
