// lib/floorPlanView.ts — modèle de VUE PUR du plan de salle (chunk 2 de PLAN_SALLE_EDEN), aucun réseau.
//
// Le composant SVG <FloorPlan> (components/FloorPlan.tsx) ne fait que dessiner ce que ce module décide :
//   · la direction artistique de chaque univers (VENUE_THEME — Eden crème/or/tropical, Terminus rouge/bleu) ;
//   · le viewBox (aspect réel du screenshot pour l'Eden : 952×506) et la conversion %→unités SVG ;
//   · les MURS d'un univers (EDEN_WALLS = transcription approximative de la spec §1, jamais inventée) ;
//   · l'état d'une table (libre / demandée / confirmée / indisponible) et sa palette ;
//   · le mode « consultation honnête » : SANS données de soirée, aucune table n'est présentée « libre »
//     (résa possible) — elle est neutre. Une table INACTIVE reste « indisponible » (fait statique).
//   · la géométrie (ronde → cercle, carrée → banquette, debout → pictogramme distinct) ;
//   · la légende, la sélectionnabilité (une DEMANDE client ne vise qu'une table active et libre), l'aria-label.
//
// Règle dure : aucune fausse disponibilité. Le module ne fabrique jamais un état « libre » quand il n'a
// pas de données de soirée ; il ne fabrique jamais une capacité (délègue à capacityLabel de venueTables).
// Tout est PUR et testable ; le rendu SVG et l'accès réseau restent en dehors.

import {
  EDEN_SCREENSHOT_REF,
  capacityKnown,
  capacityLabel,
  tableKindLabel,
  type Venue,
  type VenueTable,
} from "./venueTables.ts";

// ————————————————————————————————————————————————————————————————
// États d'une table (miroir de la spec §3 : libre / demandée / confirmée / indisponible)
// ————————————————————————————————————————————————————————————————

export const TABLE_AVAILABILITY = ["free", "requested", "confirmed", "unavailable"] as const;
export type TableAvailability = (typeof TABLE_AVAILABILITY)[number];

export function isTableAvailability(v: unknown): v is TableAvailability {
  return typeof v === "string" && (TABLE_AVAILABILITY as readonly string[]).includes(v);
}

// Style d'un état. Couleurs en hex (self-contained pour le SVG, aucune dépendance Tailwind à l'intérieur).
export type AvailabilityStyle = { label: string; fill: string; stroke: string; text: string };

export const AVAILABILITY_STYLE: Record<TableAvailability, AvailabilityStyle> = {
  free: { label: "Libre", fill: "rgba(52,211,153,.14)", stroke: "#34d399", text: "#a7f3d0" },
  requested: { label: "Demandée", fill: "rgba(251,191,36,.18)", stroke: "#fbbf24", text: "#fde68a" },
  confirmed: { label: "Confirmée", fill: "rgba(239,68,68,.24)", stroke: "#ef4444", text: "#fecaca" },
  unavailable: { label: "Indisponible", fill: "rgba(113,113,122,.16)", stroke: "#71717a", text: "#a1a1aa" },
};

// Style « consultation » : le plan est affiché SANS données de soirée. Neutre, jamais « libre ».
export const CONSULTATION_STYLE: AvailabilityStyle = {
  label: "Consultation",
  fill: "rgba(148,163,184,.10)",
  stroke: "#94a3b8",
  text: "#cbd5e1",
};

// ————————————————————————————————————————————————————————————————
// Direction artistique par univers (spec §3 : Eden crème/or/tropical · Terminus rouge/bleu nuit)
// ————————————————————————————————————————————————————————————————

// Interprétation lisible sur l'app sombre (#070707) : fonds profonds, accents de l'univers.
export type VenueTheme = {
  name: string;
  backgroundFrom: string; // dégradé de fond (haut/extérieur)
  backgroundTo: string; // dégradé de fond (bas/centre)
  wall: string; // couleur des murs/cloisons
  accent: string; // liseré/accent de l'univers
  label: string; // couleur des libellés de table
};

export const VENUE_THEME: Record<Venue, VenueTheme> = {
  // Eden : crème / or / tropical, décliné en sombre chaud (olive profond → brun espresso, or, végétal).
  eden: {
    name: "Eden",
    backgroundFrom: "#12140c",
    backgroundTo: "#0a0b07",
    wall: "#c8a24a",
    accent: "#3f9b6d",
    label: "#efe6cf",
  },
  // Terminus : rouge / bleu nuit (référence UX staff existante).
  terminus: {
    name: "Terminus",
    backgroundFrom: "#0b0f1c",
    backgroundTo: "#070707",
    wall: "#ec4900",
    accent: "#6d5cf5",
    label: "#e5e7eb",
  },
  // Cercle : pas encore de plan réel ; DA sobre en attendant (aucune donnée fabriquée).
  cercle: {
    name: "Cercle",
    backgroundFrom: "#0d0d10",
    backgroundTo: "#070707",
    wall: "#9ca3af",
    accent: "#94a3b8",
    label: "#e5e7eb",
  },
};

// viewBox (unités SVG) par univers. Eden = aspect RÉEL du screenshot (952×506) → les % retombent
// exactement sur les pixels transcrits. Les autres univers n'ont pas encore de plan → défaut sobre.
export const DEFAULT_VIEWBOX = { width: 1000, height: 600 } as const;

export const VENUE_VIEWBOX: Record<Venue, { width: number; height: number }> = {
  eden: { width: EDEN_SCREENSHOT_REF.width, height: EDEN_SCREENSHOT_REF.height },
  terminus: { width: DEFAULT_VIEWBOX.width, height: DEFAULT_VIEWBOX.height },
  cercle: { width: DEFAULT_VIEWBOX.width, height: DEFAULT_VIEWBOX.height },
};

// ————————————————————————————————————————————————————————————————
// Murs / cloisons (transcription APPROXIMATIVE de la spec §1 — jamais inventés, « à affiner à l'œil »)
// ————————————————————————————————————————————————————————————————

export type WallSegment = { x1: number; y1: number; x2: number; y2: number };

// Segments en PIXELS sur le repère Eden 952×506 (= viewBox eden). Reprend littéralement les repères
// donnés par le fondateur (§1) : contour, bloc technique haut-droite + pan coupé, mur vertical x≈775,
// refends courts. Marqué approximatif : aucune précision revendiquée au-delà de la description spec.
export const EDEN_WALLS: readonly WallSegment[] = [
  // Contour extérieur.
  { x1: 6, y1: 6, x2: 946, y2: 6 },
  { x1: 946, y1: 6, x2: 946, y2: 500 },
  { x1: 946, y1: 500, x2: 6, y2: 500 },
  { x1: 6, y1: 500, x2: 6, y2: 6 },
  // Bloc technique haut-droite (~x 550→775, y 120→210) avec pan coupé en biais (~x 385→550, y 205).
  { x1: 550, y1: 120, x2: 775, y2: 120 },
  { x1: 775, y1: 120, x2: 775, y2: 210 },
  { x1: 775, y1: 210, x2: 550, y2: 210 },
  { x1: 550, y1: 210, x2: 385, y2: 205 }, // pan coupé en biais
  // Mur vertical x≈775 du haut jusqu'à y≈125.
  { x1: 775, y1: 6, x2: 775, y2: 125 },
  // Refends courts.
  { x1: 230, y1: 120, x2: 230, y2: 240 },
  { x1: 252, y1: 300, x2: 252, y2: 380 },
  { x1: 20, y1: 300, x2: 20, y2: 380 },
  { x1: 390, y1: 120, x2: 390, y2: 205 },
];

// Murs d'un univers. Seul l'Eden a un tracé transcrit ; les autres renvoient [] (aucun mur inventé).
export function venueWalls(venue: Venue): readonly WallSegment[] {
  return venue === "eden" ? EDEN_WALLS : [];
}

// ————————————————————————————————————————————————————————————————
// Position & géométrie d'une table (% [0,100] → unités SVG du viewBox)
// ————————————————————————————————————————————————————————————————

export type Point = { cx: number; cy: number };

// Convertit la position en % d'une table vers les unités SVG du viewBox fourni. Bornée au cadre.
export function tablePosition(
  table: Pick<VenueTable, "x_pct" | "y_pct">,
  viewBox: { width: number; height: number },
): Point {
  const clampPct = (p: number) => (Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0);
  return {
    cx: (clampPct(table.x_pct) / 100) * viewBox.width,
    cy: (clampPct(table.y_pct) / 100) * viewBox.height,
  };
}

// Rendu géométrique d'une table. round → cercle ; square → banquette (rect arrondi) ;
// standing → cercle plus petit + anneau distinct (pictogramme « table haute — debout »).
export type TableGeometry =
  | { kind: "circle"; r: number; standing: boolean }
  | { kind: "rect"; halfW: number; halfH: number; radius: number };

const CIRCLE_R = 16;
const STANDING_R = 12;
const RECT_HALF_W = 22;
const RECT_HALF_H = 13;
const RECT_RADIUS = 5;

export function tableGeometry(table: Pick<VenueTable, "shape" | "standing">): TableGeometry {
  if (table.shape === "square") {
    return { kind: "rect", halfW: RECT_HALF_W, halfH: RECT_HALF_H, radius: RECT_RADIUS };
  }
  return { kind: "circle", r: table.standing ? STANDING_R : CIRCLE_R, standing: table.standing };
}

// ————————————————————————————————————————————————————————————————
// Résolution d'état, style, sélectionnabilité, aria-label
// ————————————————————————————————————————————————————————————————

// Détermine l'état d'affichage d'une table.
//  · table inactive → "unavailable" (fait statique, indépendant de la soirée) ;
//  · pas de carte de disponibilité (map absente) → null = mode CONSULTATION (jamais « libre ») ;
//  · map fournie : l'état de la table si connu et valide, sinon "free" (on A des données de soirée).
export function resolveAvailability(
  table: Pick<VenueTable, "id" | "active">,
  map?: Readonly<Record<string, TableAvailability>>,
): TableAvailability | null {
  if (!table.active) return "unavailable";
  if (!map) return null;
  const a = map[table.id];
  return isTableAvailability(a) ? a : "free";
}

// Style d'affichage d'une table selon l'état résolu. null → consultation (neutre honnête).
export function availabilityStyle(availability: TableAvailability | null): AvailabilityStyle {
  return availability === null ? CONSULTATION_STYLE : AVAILABILITY_STYLE[availability];
}

// Une table est-elle proposable à une DEMANDE de résa client ? Uniquement une table ACTIVE et LIBRE,
// avec des données de soirée (état résolu = "free"). Consultation (null) → jamais sélectionnable.
export function isSelectableForRequest(
  table: Pick<VenueTable, "active">,
  availability: TableAvailability | null,
): boolean {
  return table.active && availability === "free";
}

// Libellé accessible / infobulle d'une table : « Table 704 · Table · 2 places · libre ».
export function tableAriaLabel(table: VenueTable, availability: TableAvailability | null): string {
  const parts = [`Table ${table.label}`, tableKindLabel(table)];
  if (capacityKnown(table)) {
    parts.push(`${capacityLabel(table.capacity)} places`);
  } else {
    parts.push("capacité à confirmer");
  }
  parts.push(availabilityStyle(availability).label.toLowerCase());
  return parts.join(" · ");
}

// ————————————————————————————————————————————————————————————————
// Légende
// ————————————————————————————————————————————————————————————————

export type LegendEntry = { key: string; label: string; swatch: string };

// Légende contextuelle.
//  · mode consultation (aucune donnée de soirée) → on n'affiche PAS 4 faux états de dispo : seulement
//    la note « consultation » + la légende des TYPES d'assise (table / banquette / debout).
//  · mode live (données de soirée) → les 4 états + les types d'assise.
export function buildLegend(mode: "consultation" | "live"): LegendEntry[] {
  const shapes: LegendEntry[] = [
    { key: "shape-round", label: "Table", swatch: "round" },
    { key: "shape-square", label: "Banquette", swatch: "square" },
    { key: "shape-standing", label: "Table haute — debout", swatch: "standing" },
  ];
  if (mode === "consultation") {
    return [{ key: "consultation", label: "Consultation — hors soirée", swatch: CONSULTATION_STYLE.stroke }, ...shapes];
  }
  const states: LegendEntry[] = TABLE_AVAILABILITY.map((a) => ({
    key: `state-${a}`,
    label: AVAILABILITY_STYLE[a].label,
    swatch: AVAILABILITY_STYLE[a].stroke,
  }));
  return [...states, ...shapes];
}
