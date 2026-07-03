// lib/venueTables.ts — logique PURE du PLAN DE SALLE (layout des tables par univers), aucun réseau.
//
// Le layout de référence d'un univers (migration 0024 : venue_tables) est une donnée de FOND DE PLAN
// — positions, formes, capacités, tables hautes « debout ». Aucune PII, aucun montant. Ce module :
//   · décrit le modèle (miroir de la table venue_tables) ;
//   · porte les vocabulaires fermés (miroir des CHECK : venue, shape) ;
//   · transcrit le screenshot Eden du fondateur en SOURCE unique testable (EDEN_SEED, pixels bruts) ;
//   · dérive le pourcentage EXACTEMENT comme le SQL (pixelToPct, ref 952×506) — aucun arrondi divergent ;
//   · valide un brouillon d'édition direction (validateVenueTableDraft) AVANT écriture ;
//   · agrège honnêtement l'état du plan (planSummary : combien de capacités RESTENT à confirmer).
//
// Règle dure : AUCUNE capacité inventée. Une table dont la capacité est illisible sur le screenshot
// reste `capacity: null` (= « à confirmer ») jusqu'à saisie réelle par la direction. Le rendu SVG
// (chunk ultérieur) et l'accès Supabase restent en dehors de ce module — il ne fait que décrire,
// transcrire, dériver, valider et agréger.

// ————————————————————————————————————————————————————————————————
// Modèle & vocabulaires fermés (miroir des CHECK 0024)
// ————————————————————————————————————————————————————————————————

// Univers physiques disposant d'un plan de salle (miroir du CHECK venue).
export const VENUES = ["eden", "terminus", "cercle"] as const;
export type Venue = (typeof VENUES)[number];

// Forme d'une table. R (ronde) → round · C (carrée) → square. Miroir du CHECK shape.
export const TABLE_SHAPES = ["round", "square"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

// Lettres de forme telles que transcrites du screenshot OctoTable → forme normalisée.
export const SHAPE_BY_LETTER: Record<"R" | "C", TableShape> = {
  R: "round",
  C: "square",
};

// Dimensions de référence du screenshot Eden (fondateur, 2026-07-03). Sert à normaliser les pixels
// bruts en pourcentage — la MÊME base que le SQL (round((px/952)*100, 3)).
export const EDEN_SCREENSHOT_REF = { width: 952, height: 506 } as const;

// Liste EXACTE (fondateur) des tables hautes « debout » de l'Eden — sans chaise, groupes debout.
export const EDEN_STANDING_LABELS = [
  "106",
  "107",
  "400",
  "401",
  "402",
  "403",
  "404",
  "405",
  "406",
  "500",
] as const;

// Une table du plan, telle que stockée (miroir de venue_tables). capacity null = à confirmer.
export type VenueTable = {
  id: string;
  venue: Venue;
  label: string;
  x_pct: number;
  y_pct: number;
  shape: TableShape;
  standing: boolean;
  capacity: number | null;
  active: boolean;
};

// Brouillon d'édition direction (écran « éditer table », chunk ultérieur). id absent = création.
export type VenueTableDraft = {
  venue: Venue;
  label: string;
  x_pct: number;
  y_pct: number;
  shape: TableShape;
  standing: boolean;
  capacity: number | null;
  active: boolean;
};

// ————————————————————————————————————————————————————————————————
// Transcription du screenshot Eden — SOURCE testable (pixels bruts, jamais de capacité inventée)
// ————————————————————————————————————————————————————————————————

// Une entrée de seed = ce qui est réellement lisible sur le screenshot. cap null = illisible.
export type EdenSeedEntry = {
  label: string;
  px: number;
  py: number;
  shape: TableShape;
  standing: boolean;
  cap: number | null;
};

// Les 44 tables de l'Eden (centres en pixels sur le screenshot 952×506). Cette constante est la
// même vérité que le VALUES du seed SQL 0024 — un test croise les deux (compte, labels, standing, caps).
export const EDEN_SEED: readonly EdenSeedEntry[] = [
  { label: "704", px: 37, py: 142, shape: "round", standing: false, cap: 2 },
  { label: "703", px: 70, py: 135, shape: "round", standing: false, cap: null },
  { label: "702", px: 112, py: 140, shape: "square", standing: false, cap: 2 },
  { label: "701", px: 155, py: 140, shape: "round", standing: false, cap: 2 },
  { label: "700", px: 192, py: 143, shape: "round", standing: false, cap: 2 },
  { label: "405", px: 265, py: 143, shape: "round", standing: true, cap: null },
  { label: "406", px: 268, py: 180, shape: "round", standing: true, cap: null },
  { label: "404", px: 320, py: 157, shape: "round", standing: true, cap: null },
  { label: "403", px: 360, py: 157, shape: "round", standing: true, cap: null },
  { label: "402", px: 412, py: 158, shape: "round", standing: true, cap: 4 },
  { label: "401", px: 458, py: 157, shape: "round", standing: true, cap: 4 },
  { label: "400", px: 500, py: 157, shape: "round", standing: true, cap: 4 },
  { label: "606", px: 14, py: 228, shape: "round", standing: false, cap: null },
  { label: "605", px: 62, py: 263, shape: "round", standing: false, cap: null },
  { label: "604", px: 88, py: 260, shape: "round", standing: false, cap: null },
  { label: "603", px: 117, py: 262, shape: "round", standing: false, cap: null },
  { label: "602", px: 157, py: 265, shape: "round", standing: false, cap: null },
  { label: "601", px: 185, py: 265, shape: "round", standing: false, cap: null },
  { label: "600", px: 212, py: 268, shape: "round", standing: false, cap: 2 },
  { label: "505", px: 38, py: 355, shape: "round", standing: false, cap: null },
  { label: "504", px: 65, py: 358, shape: "round", standing: false, cap: null },
  { label: "503", px: 95, py: 355, shape: "round", standing: false, cap: null },
  { label: "502", px: 118, py: 358, shape: "round", standing: false, cap: null },
  { label: "501", px: 152, py: 355, shape: "round", standing: false, cap: null },
  { label: "500", px: 205, py: 349, shape: "round", standing: true, cap: null },
  { label: "304", px: 268, py: 355, shape: "round", standing: false, cap: null },
  { label: "303", px: 305, py: 352, shape: "round", standing: false, cap: null },
  { label: "302", px: 342, py: 355, shape: "round", standing: false, cap: null },
  { label: "301", px: 381, py: 357, shape: "round", standing: false, cap: null },
  { label: "300", px: 430, py: 353, shape: "round", standing: false, cap: null },
  { label: "205", px: 520, py: 297, shape: "round", standing: false, cap: 6 },
  { label: "203", px: 585, py: 297, shape: "round", standing: false, cap: null },
  { label: "201", px: 635, py: 296, shape: "round", standing: false, cap: null },
  { label: "204", px: 530, py: 345, shape: "round", standing: false, cap: 5 },
  { label: "202", px: 598, py: 345, shape: "round", standing: false, cap: 6 },
  { label: "200", px: 652, py: 343, shape: "round", standing: false, cap: 6 },
  { label: "107", px: 712, py: 283, shape: "round", standing: true, cap: 4 },
  { label: "106", px: 757, py: 285, shape: "round", standing: true, cap: null },
  { label: "100", px: 868, py: 218, shape: "square", standing: false, cap: 4 },
  { label: "101", px: 868, py: 252, shape: "square", standing: false, cap: 6 },
  { label: "102", px: 866, py: 285, shape: "square", standing: false, cap: 6 },
  { label: "103", px: 866, py: 320, shape: "square", standing: false, cap: 6 },
  { label: "104", px: 866, py: 355, shape: "square", standing: false, cap: 6 },
  { label: "105", px: 822, py: 352, shape: "square", standing: false, cap: null },
] as const;

// ————————————————————————————————————————————————————————————————
// Gardes de type & helpers PURS
// ————————————————————————————————————————————————————————————————

export function isVenue(v: unknown): v is Venue {
  return typeof v === "string" && (VENUES as readonly string[]).includes(v);
}

export function isTableShape(s: unknown): s is TableShape {
  return typeof s === "string" && (TABLE_SHAPES as readonly string[]).includes(s);
}

// Normalise un pixel en pourcentage, arrondi à 3 décimales — EXACTEMENT comme le SQL round(...,3).
// ref > 0 requis ; renvoie une valeur bornée [0,100] (le screenshot ne sort jamais du cadre).
export function pixelToPct(px: number, ref: number): number {
  if (!Number.isFinite(px) || !Number.isFinite(ref) || ref <= 0) return 0;
  const raw = (px / ref) * 100;
  const clamped = Math.min(100, Math.max(0, raw));
  return Math.round(clamped * 1000) / 1000;
}

// Une entrée de seed transcrite → position en pourcentage (mêmes maths que le SQL 0024).
export function seedToPct(entry: EdenSeedEntry, ref = EDEN_SCREENSHOT_REF): { x_pct: number; y_pct: number } {
  return {
    x_pct: pixelToPct(entry.px, ref.width),
    y_pct: pixelToPct(entry.py, ref.height),
  };
}

// La capacité est-elle connue (renseignée) ? null = à confirmer (jamais promue en 0 ni inventée).
export function capacityKnown(t: Pick<VenueTable, "capacity">): boolean {
  return typeof t.capacity === "number" && Number.isFinite(t.capacity);
}

// Libellé de capacité pour l'écran : « — » tant que non confirmée (état vide HONNÊTE).
export function capacityLabel(capacity: number | null): string {
  return capacityKnown({ capacity }) ? String(capacity) : "—";
}

// Libellé de forme / type d'assise pour l'UI.
export function tableKindLabel(t: Pick<VenueTable, "shape" | "standing">): string {
  if (t.standing) return "Table haute — debout";
  return t.shape === "square" ? "Banquette" : "Table";
}

// Regroupe une liste de tables par univers (ordre d'insertion préservé, aucune ligne fabriquée).
export function groupByVenue(tables: readonly VenueTable[]): Map<Venue, VenueTable[]> {
  const out = new Map<Venue, VenueTable[]>();
  for (const t of tables) {
    if (!isVenue(t.venue)) continue; // défensif : jamais promouvoir un univers inattendu
    const bucket = out.get(t.venue) ?? [];
    bucket.push(t);
    out.set(t.venue, bucket);
  }
  return out;
}

export type PlanSummary = {
  total: number;
  active: number;
  standing: number;
  capacityKnown: number;
  capacityUnknown: number;
};

// Agrège l'état d'un plan. Liste vide → zéros HONNÊTES (jamais de donnée fabriquée). capacityUnknown
// = le nombre de tables dont la capacité RESTE à confirmer (ce que la direction doit encore saisir).
export function planSummary(tables: readonly VenueTable[]): PlanSummary {
  let active = 0;
  let standing = 0;
  let known = 0;
  for (const t of tables) {
    if (t.active) active += 1;
    if (t.standing) standing += 1;
    if (capacityKnown(t)) known += 1;
  }
  return {
    total: tables.length,
    active,
    standing,
    capacityKnown: known,
    capacityUnknown: tables.length - known,
  };
}

// Le plan est-il « prêt » à afficher ? Dès qu'au moins une table existe. Un plan sans table →
// état vide honnête (l'appelant affiche « aucune table » plutôt qu'un cadre vide trompeur).
export function planReady(tables: readonly VenueTable[]): boolean {
  return tables.length > 0;
}

export type DraftValidation = { ok: boolean; errors: string[] };

// Valide un brouillon d'édition direction AVANT écriture (miroir des CHECK 0024). Ne fabrique rien :
// une capacité vide reste null (à confirmer), jamais forcée à 0 ni à une valeur par défaut.
export function validateVenueTableDraft(draft: VenueTableDraft): DraftValidation {
  const errors: string[] = [];
  if (!isVenue(draft.venue)) errors.push("univers inconnu");
  if (typeof draft.label !== "string" || draft.label.trim().length === 0) {
    errors.push("label requis");
  }
  if (!isTableShape(draft.shape)) errors.push("forme inconnue");
  for (const [name, val] of [
    ["x_pct", draft.x_pct],
    ["y_pct", draft.y_pct],
  ] as const) {
    if (!Number.isFinite(val) || val < 0 || val > 100) {
      errors.push(`${name} hors bornes [0,100]`);
    }
  }
  if (draft.capacity !== null) {
    if (!Number.isInteger(draft.capacity) || draft.capacity <= 0) {
      errors.push("capacité : entier positif ou vide (à confirmer)");
    }
  }
  return { ok: errors.length === 0, errors };
}
