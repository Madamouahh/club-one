// lib/cercleFloorPlan.ts — logique PURE du PLAN DE SALLE du CERCLE (layout propre à l'univers), aucun réseau.
//
// Contexte (audit G5) : parmi les 3 univers, l'Éden a son plan (44 tables, screenshot fondateur,
// lib/venueTables.ts EDEN_SEED_V2) et le Terminus son plan legacy (18 tables). LE CERCLE, lui, était
// DÉCLARÉ mais VIDE : ligne `venues('cercle', 'Le Cercle', 'club_house')` présente depuis 0004, mais
// AUCUNE table dans venue_tables. Ce module donne au Cercle son PROPRE modèle de salle — pas un clone
// graphique du Terminus, mais un layout à son identité : club house INTIMISTE et HAUT DE GAMME.
//
// Parti pris (assumé, pas inventé au hasard) : « on n'y vient pas pour le nombre — pour l'ambiance »
// (tagline 0004). Le Cercle s'organise donc AUTOUR d'un cercle central (piste / DJ) :
//   · un ANNEAU de 8 salons canapés VIP (6 pers) ceinturant le centre — le cœur du lieu ;
//   · 4 tables HAUTES debout en périphérie (mezzanine / abords du bar), groupes debout ;
//   · 2 ALCÔVES intimes (tables 2 pers modulables) sur les flancs.
// → 14 tables au total : distinct des 18 du Terminus et des 44 de l'Éden, avec une composition
//   qui lui est propre (aucune table olivier ; centre de gravité sur le canapé VIP).
//
// Règle dure (miroir de venueTables.ts) : AUCUNE capacité fabriquée « à la louche ». Les capacités
// ici découlent de la DÉFINITION STRUCTURELLE du type d'assise (canapé = 6 pers · modulable = 2 pers ·
// table haute = debout, sans capacité assise → null PAR NATURE), pas d'un chiffre deviné table par
// table. Invariant conservé, comme l'Éden : DEBOUT ⟺ capacity NULL.
//
// Repère : le Cercle n'a pas de screenshot source (contrairement à l'Éden). Le layout est donc défini
// DIRECTEMENT en POURCENTAGE [0,100] (x_pct / y_pct), viewBox-agnostique — les mêmes valeurs literales
// alimentent le seed SQL 0057 (source unique auditable, croisée par le test et la vérification SQL).
// Le rendu SVG et l'accès Supabase restent HORS de ce module : il ne fait que décrire, agréger, valider.

import {
  TABLE_KINDS,
  isTableKind,
  type TableKind,
  type TableShape,
  type VenueTable,
} from "./venueTables.ts";

// L'identifiant d'univers du Cercle (miroir de venues.id / du CHECK venue_tables.venue).
export const CERCLE_VENUE = "cercle" as const;

// ————————————————————————————————————————————————————————————————
// Zones du Cercle — vocabulaire fermé, propre à l'univers (aucun rapport avec les rangées Éden)
// ————————————————————————————————————————————————————————————————

// Les 3 zones qui structurent la salle. « salon » = anneau VIP central ; « mezzanine » = tables
// hautes des abords ; « alcove » = tables intimes 2 pers sur les flancs.
export const CERCLE_ZONES = ["salon", "mezzanine", "alcove"] as const;
export type CercleZone = (typeof CERCLE_ZONES)[number];

export function isCercleZone(z: unknown): z is CercleZone {
  return typeof z === "string" && (CERCLE_ZONES as readonly string[]).includes(z);
}

export const CERCLE_ZONE_LABEL: Record<CercleZone, string> = {
  salon: "Salon VIP — anneau central",
  mezzanine: "Mezzanine — tables hautes",
  alcove: "Alcôve — table intime",
};

// ————————————————————————————————————————————————————————————————
// Le seed du Cercle — SOURCE testable (positions en %, jamais de capacité inventée)
// ————————————————————————————————————————————————————————————————

// Une entrée de layout du Cercle. Miroir exact de ce que le seed SQL 0057 insère dans venue_tables.
// capacity : null UNIQUEMENT pour les tables hautes (debout, sans capacité assise par nature).
export type CercleSeedEntry = {
  label: string;
  zone: CercleZone;
  x_pct: number;
  y_pct: number;
  shape: TableShape;
  standing: boolean;
  capacity: number | null;
  kind: TableKind;
};

// Les 14 tables du Cercle. Positions PRÉ-CALCULÉES en pourcentage (arrondies à 3 décimales, comme le
// SQL round(...,3)) et RECOPIÉES à l'identique dans le seed 0057 — un test croise les deux (compte,
// labels, kinds, capacités, bornes). L'anneau « salon » est calé sur un cercle centré (50,50), rayons
// (30,33) aux angles 0/45/…/315° ; d'où les valeurs ±21.213 / ±23.334 (30·cos45 / 33·sin45).
export const CERCLE_SEED: readonly CercleSeedEntry[] = [
  // Anneau central — 8 salons canapés VIP (6 pers), carrés, ceinturant la piste/DJ (sens horaire).
  { label: "S1", zone: "salon", x_pct: 80.0, y_pct: 50.0, shape: "square", standing: false, capacity: 6, kind: "canape" },
  { label: "S2", zone: "salon", x_pct: 71.213, y_pct: 73.334, shape: "square", standing: false, capacity: 6, kind: "canape" },
  { label: "S3", zone: "salon", x_pct: 50.0, y_pct: 83.0, shape: "square", standing: false, capacity: 6, kind: "canape" },
  { label: "S4", zone: "salon", x_pct: 28.787, y_pct: 73.334, shape: "square", standing: false, capacity: 6, kind: "canape" },
  { label: "S5", zone: "salon", x_pct: 20.0, y_pct: 50.0, shape: "square", standing: false, capacity: 6, kind: "canape" },
  { label: "S6", zone: "salon", x_pct: 28.787, y_pct: 26.666, shape: "square", standing: false, capacity: 6, kind: "canape" },
  { label: "S7", zone: "salon", x_pct: 50.0, y_pct: 17.0, shape: "square", standing: false, capacity: 6, kind: "canape" },
  { label: "S8", zone: "salon", x_pct: 71.213, y_pct: 26.666, shape: "square", standing: false, capacity: 6, kind: "canape" },
  // Mezzanine — 4 tables hautes debout (groupe, sans capacité assise), aux quatre coins.
  { label: "H1", zone: "mezzanine", x_pct: 9.0, y_pct: 12.0, shape: "round", standing: true, capacity: null, kind: "haute" },
  { label: "H2", zone: "mezzanine", x_pct: 91.0, y_pct: 12.0, shape: "round", standing: true, capacity: null, kind: "haute" },
  { label: "H3", zone: "mezzanine", x_pct: 9.0, y_pct: 88.0, shape: "round", standing: true, capacity: null, kind: "haute" },
  { label: "H4", zone: "mezzanine", x_pct: 91.0, y_pct: 88.0, shape: "round", standing: true, capacity: null, kind: "haute" },
  // Alcôves — 2 tables intimes 2 pers modulables, sur les flancs gauche/droit.
  { label: "A1", zone: "alcove", x_pct: 6.0, y_pct: 50.0, shape: "round", standing: false, capacity: 2, kind: "modulable" },
  { label: "A2", zone: "alcove", x_pct: 94.0, y_pct: 50.0, shape: "round", standing: false, capacity: 2, kind: "modulable" },
] as const;

// Nombre de tables du Cercle (distinct de Terminus 18 / Éden 44) — dérivé, jamais codé en dur ailleurs.
export const CERCLE_TABLE_COUNT = CERCLE_SEED.length;

// ————————————————————————————————————————————————————————————————
// Helpers PURS — agrégation, regroupement, modèle de rendu
// ————————————————————————————————————————————————————————————————

// Regroupe les tables du Cercle par zone (ordre d'insertion préservé, aucune ligne fabriquée).
export function cercleTablesByZone(): Map<CercleZone, CercleSeedEntry[]> {
  const out = new Map<CercleZone, CercleSeedEntry[]>();
  for (const z of CERCLE_ZONES) out.set(z, []);
  for (const t of CERCLE_SEED) {
    const bucket = out.get(t.zone);
    if (bucket) bucket.push(t);
  }
  return out;
}

export type CercleCapacityTotals = {
  tableCount: number;
  standingTables: number;
  seatedCapacity: number; // somme des capacités assises connues (les hautes n'y contribuent pas)
  byKind: Record<TableKind, number>;
};

// Agrège HONNÊTEMENT le layout : compte total, tables debout, somme des places assises, décompte par
// type. Les tables hautes (capacity null) ne gonflent jamais la capacité assise (règle dure).
export function cercleCapacityTotals(): CercleCapacityTotals {
  const byKind = Object.fromEntries(TABLE_KINDS.map((k) => [k, 0])) as Record<TableKind, number>;
  let standingTables = 0;
  let seatedCapacity = 0;
  for (const t of CERCLE_SEED) {
    if (isTableKind(t.kind)) byKind[t.kind] += 1;
    if (t.standing) standingTables += 1;
    if (typeof t.capacity === "number" && Number.isFinite(t.capacity)) {
      seatedCapacity += t.capacity;
    }
  }
  return { tableCount: CERCLE_SEED.length, standingTables, seatedCapacity, byKind };
}

// Le modèle de rendu : les tables du Cercle sous la forme VenueTable attendue par lib/floorPlanView.ts
// (le composant SVG dessine ces lignes exactement comme celles chargées depuis venue_tables). id
// déterministe (`cercle-<label>`) pour un rendu stable ; toutes actives (fond de plan complet).
export function cercleFloorPlanModel(): VenueTable[] {
  return CERCLE_SEED.map((t) => ({
    id: `cercle-${t.label}`,
    venue: CERCLE_VENUE,
    label: t.label,
    x_pct: t.x_pct,
    y_pct: t.y_pct,
    shape: t.shape,
    standing: t.standing,
    capacity: t.capacity,
    active: true,
    kind: t.kind,
  }));
}
