// lib/venueTableEditor.ts — logique PURE de l'écran direction « ÉDITER TABLE » (chunk 3 PLAN_SALLE_EDEN).
//
// But de l'écran (spec §2) : combler les capacités NULL du seed EDEN (26 tables « à confirmer ») avec les
// VRAIES valeurs, et basculer actif/debout — SANS redéploiement. Ce module ne fait AUCUN réseau : il
// prépare, valide et diffe un brouillon d'édition ; l'écriture réelle en base (UPDATE venue_tables,
// autorisée aux seuls admin/manager par la RLS 0024) est faite par l'appelant thin (composant / monolithe).
//
// Règle dure conservée depuis le seed : AUCUNE capacité inventée. Le champ capacité vide → `null`
// (« à confirmer »), JAMAIS promu en 0 ni en valeur par défaut. `parseCapacityInput` est le point de
// vérité de cette honnêteté : « » → null, tout ce qui n'est pas un entier > 0 → erreur explicite.
//
// La sécurité reste côté base : ce module ne décide d'aucun droit. `buildVenueTableUpdate` construit un
// patch minimal (seuls les champs réellement modifiés) que la RLS acceptera ou refusera — l'UI n'accorde rien.

import {
  capacityKnown,
  isTableShape,
  isVenue,
  validateVenueTableDraft,
  type TableShape,
  type VenueTable,
  type VenueTableDraft,
} from "./venueTables.ts";

// ————————————————————————————————————————————————————————————————
// 1) Parsing du champ CAPACITÉ — le garde-fou d'honnêteté (vide = à confirmer, jamais inventé)
// ————————————————————————————————————————————————————————————————

export type CapacityParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: string };

// Message unique (miroir de validateVenueTableDraft / du CHECK 0024 capacity>0).
export const CAPACITY_HINT = "capacité : entier positif, ou vide = à confirmer";

// Interprète le texte saisi dans le champ capacité :
//   · « » / espaces           → null  (à confirmer — la table reste « — » dans le plan, honnête)
//   · un entier strictement >0 → ce nombre
//   · tout le reste           → erreur explicite (décimale, 0, négatif, texte, « 4 places »…)
// On refuse plutôt que de « deviner » : une capacité fausse serait pire qu'une capacité vide.
export function parseCapacityInput(raw: string): CapacityParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  // Seuls des chiffres — rejette « 4.5 », « -2 », « 4 places », « abc », « 1e3 ».
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: CAPACITY_HINT };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, reason: CAPACITY_HINT };
  return { ok: true, value: n };
}

// Réciproque : la valeur stockée → texte pré-rempli du champ (null → champ vide, jamais « 0 »).
export function capacityInputValue(capacity: number | null): string {
  return capacity === null ? "" : String(capacity);
}

// ————————————————————————————————————————————————————————————————
// 2) Brouillon éditable : d'une table vers un draft, et retour vers un patch minimal
// ————————————————————————————————————————————————————————————————

// Colonnes que l'écran direction peut modifier (miroir des GRANT/policies UPDATE de la 0024).
export type VenueTableUpdate = Partial<{
  label: string;
  shape: TableShape;
  x_pct: number;
  y_pct: number;
  standing: boolean;
  capacity: number | null;
  active: boolean;
}>;

export const EDITABLE_FIELDS = [
  "label",
  "shape",
  "x_pct",
  "y_pct",
  "standing",
  "capacity",
  "active",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

// Table existante → brouillon éditable (copie fidèle ; aucune valeur fabriquée).
export function toEditableDraft(t: VenueTable): VenueTableDraft {
  return {
    venue: t.venue,
    label: t.label,
    x_pct: t.x_pct,
    y_pct: t.y_pct,
    shape: t.shape,
    standing: t.standing,
    capacity: t.capacity,
    active: t.active,
  };
}

// Normalise un brouillon avant diff/écriture (trim du label ; le reste est déjà typé).
export function normalizeVenueTableDraft(draft: VenueTableDraft): VenueTableDraft {
  return { ...draft, label: typeof draft.label === "string" ? draft.label.trim() : draft.label };
}

// Champs réellement modifiés entre la table d'origine et le brouillon (normalisé).
// Ne compare QUE les colonnes éditables → on n'écrit jamais un champ inchangé, et « rien à enregistrer »
// est détectable (liste vide). null vs null = pas de changement (capacité restée « à confirmer »).
export function draftChangedFields(original: VenueTable, draft: VenueTableDraft): EditableField[] {
  const n = normalizeVenueTableDraft(draft);
  const changed: EditableField[] = [];
  if (n.label !== original.label) changed.push("label");
  if (n.shape !== original.shape) changed.push("shape");
  if (n.x_pct !== original.x_pct) changed.push("x_pct");
  if (n.y_pct !== original.y_pct) changed.push("y_pct");
  if (n.standing !== original.standing) changed.push("standing");
  if (n.capacity !== original.capacity) changed.push("capacity");
  if (n.active !== original.active) changed.push("active");
  return changed;
}

export type BuildUpdateResult =
  | { ok: false; errors: string[] }
  | { ok: true; changed: EditableField[]; update: VenueTableUpdate | null };

// Construit le patch minimal à envoyer à Supabase (UPDATE ... where id = ...).
//   · brouillon invalide            → { ok:false, errors } (l'UI bloque l'enregistrement)
//   · aucun changement              → { ok:true, changed:[], update:null } (« rien à enregistrer »)
//   · sinon                         → { ok:true, changed, update:{ seuls les champs modifiés } }
// Le patch peut contenir capacity:null (direction qui EFFACE une valeur erronée → retour « à confirmer ») :
// c'est légitime, la 0024 l'autorise (CHECK capacity is null or capacity>0).
export function buildVenueTableUpdate(original: VenueTable, draft: VenueTableDraft): BuildUpdateResult {
  const normalized = normalizeVenueTableDraft(draft);
  const validation = validateVenueTableDraft(normalized);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const changed = draftChangedFields(original, normalized);
  if (changed.length === 0) return { ok: true, changed: [], update: null };

  const update: VenueTableUpdate = {};
  for (const field of changed) {
    switch (field) {
      case "label":
        update.label = normalized.label;
        break;
      case "shape":
        update.shape = normalized.shape;
        break;
      case "x_pct":
        update.x_pct = normalized.x_pct;
        break;
      case "y_pct":
        update.y_pct = normalized.y_pct;
        break;
      case "standing":
        update.standing = normalized.standing;
        break;
      case "capacity":
        update.capacity = normalized.capacity;
        break;
      case "active":
        update.active = normalized.active;
        break;
    }
  }
  return { ok: true, changed, update };
}

// Défense en profondeur : un patch reçu (ex. depuis un formulaire) ne contient QUE des champs éditables.
// Utile côté appelant thin avant l'UPDATE ; ne remplace pas la RLS, la double.
export function isEditableField(key: string): key is EditableField {
  return (EDITABLE_FIELDS as readonly string[]).includes(key);
}

// ————————————————————————————————————————————————————————————————
// 3) Vue de liste : mettre EN PREMIER ce que la direction doit encore renseigner
// ————————————————————————————————————————————————————————————————

// Ordre numérique des labels de table (« 100 » < « 205 » < « 704 ») ; repli lexicographique si non numérique.
function labelOrder(label: string): number {
  const n = Number(label);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

// Trie pour l'écran d'édition : capacités À CONFIRMER en tête (le travail restant est visible), puis par
// label croissant. Ne fabrique ni ne masque aucune ligne. N'altère pas le tableau d'entrée (copie).
export function sortForEditing(tables: readonly VenueTable[]): VenueTable[] {
  return [...tables].sort((a, b) => {
    const au = capacityKnown(a) ? 1 : 0;
    const bu = capacityKnown(b) ? 1 : 0;
    if (au !== bu) return au - bu; // 0 (inconnue) avant 1 (connue)
    const la = labelOrder(a.label);
    const lb = labelOrder(b.label);
    if (la !== lb) return la - lb;
    return a.label.localeCompare(b.label);
  });
}

// Sous-ensemble des tables dont la capacité RESTE à confirmer (ce que la direction doit encore saisir).
export function tablesNeedingCapacity(tables: readonly VenueTable[]): VenueTable[] {
  return tables.filter((t) => !capacityKnown(t));
}

export type CapacityProgress = { total: number; known: number; unknown: number; complete: boolean };

// Progression du remplissage des capacités (barre honnête de l'écran). Liste vide → complete=false
// (aucune table à documenter n'est PAS « terminé » : c'est un état vide, l'UI l'affiche comme tel).
export function capacityProgress(tables: readonly VenueTable[]): CapacityProgress {
  let known = 0;
  for (const t of tables) if (capacityKnown(t)) known += 1;
  const total = tables.length;
  return { total, known, unknown: total - known, complete: total > 0 && known === total };
}

// Garde d'entrée : ne présenter à l'édition que des univers connus (miroir isVenue). Défensif.
export function editableVenues(tables: readonly VenueTable[]): string[] {
  const seen: string[] = [];
  for (const t of tables) {
    if (isVenue(t.venue) && !seen.includes(t.venue)) seen.push(t.venue);
  }
  return seen;
}

// Garde de forme réexportée pour l'écran (sélecteur rond/carré en mode ajout).
export { isTableShape };
