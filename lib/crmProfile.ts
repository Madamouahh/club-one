// lib/crmProfile.ts — logique PURE de l'ENRICHISSEMENT FICHE CLIENT (V1). Aucun accès réseau.
// Prolonge lib/crmClients (scoring/segments/garde Évin/consentement) avec ce que ce squad possède :
// email, tags, notes internes, DÉDUPLICATION (téléphone/email/nom), IMPORT/EXPORT CSV déterministe,
// et helpers d'« usabilité » d'un segment (peut-on contacter ce client, et à quel titre).
//
// Règles de fond héritées de crmClients / du schéma 0013/0025/0059 :
//   · rien n'est fabriqué : la dépense (spend_attributed) peut être NULL → la vue 360 remonte
//     spend_is_known=false, et spendSummary() le dit honnêtement (jamais un 0 € inventé) ;
//   · l'email n'est PAS une clé unique en base (0059) : la dédup se fait ICI, en app, et retourne des
//     GROUPES CANDIDATS que l'humain tranche (aucune fusion automatique destructive) ;
//   · normalisations idempotentes (round-trip import/export stable) et déterministes (tri explicite).

import {
  classifyGuest,
  normalizeE164,
  type GuestScoreRow,
  type GuestSegment,
  type SegmentInput,
} from "./crmClients.ts";

// ————————————————————————————————————————————————————————————————
// Normalisations de base (comparaison insensible casse/accents/espaces).
// ————————————————————————————————————————————————————————————————

// Minuscule + accents retirés + ponctuation → espace + espaces compactés. Pour CLÉS de comparaison.
function foldForCompare(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ————————————————————————————————————————————————————————————————
// Email — contact commercial neutre, format vérifié, jamais unique en base (dédup app).
// Miroir exact du CHECK guests_email_format_chk (0059) : local@domaine.tld, sans espace ni second @.
// ————————————————————————————————————————————————————————————————

export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

// Normalise un email saisi : trim + minuscule. Retourne null si vide ou format invalide (aucun email inventé).
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return isEmail(trimmed) ? trimmed : null;
}

// ————————————————————————————————————————————————————————————————
// Tags — étiquettes libres (segment manuel maison). Normalisées pour respecter unique(guest_id,tag) (0059).
// ————————————————————————————————————————————————————————————————

export const TAG_MAX_LENGTH = 64;

export type TagError = "empty" | "too_long";

// Normalise une étiquette : trim + espaces compactés + minuscule. null si vide ou trop longue.
// (minuscule = même clé que la contrainte d'unicité côté app ; l'affichage peut re-capitaliser à l'UI.)
export function normalizeTag(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return null;
  if (collapsed.length > TAG_MAX_LENGTH) return null;
  return collapsed.toLowerCase();
}

export function validateTag(raw: string): { ok: boolean; error?: TagError; value?: string } {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return { ok: false, error: "empty" };
  if (collapsed.length > TAG_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, value: collapsed.toLowerCase() };
}

// Ajoute une étiquette normalisée à une liste SANS doublon (respecte unique(guest_id,tag)). Tri déterministe.
export function addTag(existing: readonly string[], raw: string): string[] {
  const norm = normalizeTag(raw);
  const base = [...existing];
  if (norm && !base.includes(norm)) base.push(norm);
  return base.sort();
}

// ————————————————————————————————————————————————————————————————
// Notes internes (timeline 0059) — usage commercial neutre (minimisation : jamais comportement/ébriété).
// ————————————————————————————————————————————————————————————————

export const NOTE_MAX_LENGTH = 4000;

export type NoteError = "empty" | "too_long";

export function validateNote(body: string): { ok: boolean; error?: NoteError } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "empty" };
  if (trimmed.length > NOTE_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true };
}

// ————————————————————————————————————————————————————————————————
// Types de la fiche client V1 (miroir des colonnes que l'intégrateur édite / affiche).
// ————————————————————————————————————————————————————————————————

// Champs ÉDITABLES de la fiche (owned par ce squad : identité + email ; consentement géré par 0013/funnel).
export type GuestEditFields = {
  first_name: string;
  last_name: string | null;
  email: string | null; // normalisé (normalizeEmail) ; null si absent
  phone: string; // E.164 — clé de dédup (jamais réécrite ici)
  birthday: string | null; // ISO YYYY-MM-DD
};

export type GuestTag = {
  id: string;
  guest_id: string;
  tag: string;
  created_by: string | null;
  created_at: string;
};

export type GuestNote = {
  id: string;
  guest_id: string;
  body: string;
  author: string | null;
  created_at: string;
};

// Miroir EXACT de la sortie de la RPC guest_360_v1 (0059) — contrat pour l'intégrateur (historique + fiche).
export type Guest360 = {
  guest_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string;
  birthday: string | null;
  owner_promoter: string | null;
  consent_marketing: boolean;
  opt_out: boolean;
  visits_seated_total: number;
  visits_booked_active: number;
  no_shows_total: number;
  last_seated_date: string | null;
  first_seen_date: string | null;
  visits_with_spend: number;
  spend_attributed_total: number | null; // NULL = aucune dépense identifiée (JAMAIS un 0 inventé)
  spend_attributed_12m: number | null;
  spend_is_known: boolean;
  reservation_requests_total: number;
  reservation_pending: number;
  reservation_approved: number;
  reservation_declined: number;
  reservation_cancelled: number;
  distinct_tables_requested: number;
  last_request_at: string | null;
  tags: string[];
  notes_count: number;
};

// Profil COMPLET assemblé (côté app) : la 360 + la timeline de notes + le segment RFM calculé.
export type GuestProfile = {
  identity: GuestEditFields;
  three60: Guest360;
  notes: GuestNote[];
  segment: GuestSegment | null; // null si on n'a pas la ligne de scoring (guest_scores) sous la main
};

// ————————————————————————————————————————————————————————————————
// Dépense HONNÊTE — dit clairement si une dépense est identifiée (jamais un 0 fabriqué).
// ————————————————————————————————————————————————————————————————

export type SpendSummary = {
  known: boolean; // au moins une visite « seated » avec spend_attributed non NULL
  total: number | null; // dépense attribuée toutes périodes ; null = non identifiée
  last12m: number | null;
  visitsWithSpend: number;
};

export function spendSummary(g: Guest360): SpendSummary {
  return {
    known: g.spend_is_known,
    total: g.spend_is_known ? g.spend_attributed_total : null,
    last12m: g.spend_is_known ? g.spend_attributed_12m : null,
    visitsWithSpend: g.visits_with_spend,
  };
}

// ————————————————————————————————————————————————————————————————
// Déduplication — détecte des GROUPES CANDIDATS par téléphone / email / nom normalisés.
// Ne fusionne rien : rend des groupes que l'humain tranchera (fusion = acte explicite, jamais auto ici).
// ————————————————————————————————————————————————————————————————

export type DedupCandidate = {
  guest_id: string;
  phone?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export type DuplicateKey = "phone" | "email" | "name";

export type DuplicateGroup = {
  key: DuplicateKey; // sur quel critère le groupe matche
  value: string; // la valeur normalisée partagée
  guestIds: string[]; // ≥ 2 identifiants distincts, triés
};

// Clé nom = « prénom nom » normalisé (accents/casse/espaces ignorés). null si vide (aucun regroupement à l'aveugle).
function nameKey(first?: string | null, last?: string | null): string | null {
  const parts = [first ?? "", last ?? ""].map(foldForCompare).filter(Boolean);
  const key = parts.join(" ").trim();
  return key || null;
}

function groupBy(
  candidates: readonly DedupCandidate[],
  key: DuplicateKey,
  valueOf: (c: DedupCandidate) => string | null,
): DuplicateGroup[] {
  const buckets = new Map<string, string[]>();
  for (const c of candidates) {
    const v = valueOf(c);
    if (!v) continue;
    const ids = buckets.get(v) ?? [];
    if (!ids.includes(c.guest_id)) ids.push(c.guest_id);
    buckets.set(v, ids);
  }
  const groups: DuplicateGroup[] = [];
  for (const [value, guestIds] of buckets) {
    if (guestIds.length >= 2) {
      groups.push({ key, value, guestIds: [...guestIds].sort() });
    }
  }
  // Tri déterministe des groupes par valeur.
  return groups.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

// Détecte les doublons candidats. Ordre déterministe : d'abord téléphone (clé forte), puis email, puis nom.
export function detectDuplicates(candidates: readonly DedupCandidate[]): DuplicateGroup[] {
  return [
    ...groupBy(candidates, "phone", (c) => (c.phone ? normalizeE164(c.phone) : null)),
    ...groupBy(candidates, "email", (c) => normalizeEmail(c.email ?? null)),
    ...groupBy(candidates, "name", (c) => nameKey(c.first_name, c.last_name)),
  ];
}

// ————————————————————————————————————————————————————————————————
// Import / Export CSV — mapping DÉTERMINISTE ligne CSV <-> champs guest. Round-trip stable.
// ————————————————————————————————————————————————————————————————

// Ordre FIGÉ des colonnes (en-tête d'export = ordre des cellules). Ne pas réordonner (contrat round-trip).
export const GUEST_CSV_COLUMNS = [
  "phone",
  "first_name",
  "last_name",
  "email",
  "birthday",
] as const;

export type GuestImportFields = {
  phone: string; // E.164 normalisé
  first_name: string;
  last_name: string | null;
  email: string | null; // normalisé
  birthday: string | null; // ISO YYYY-MM-DD
};

export type CsvImportError =
  | "wrong_column_count"
  | "phone_required"
  | "phone_invalid"
  | "first_name_required"
  | "email_invalid"
  | "birthday_invalid";

// Contrôle strict d'une date ISO canonique (rejette 2020-02-31). Aucune date fabriquée.
function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d
  );
}

// EXPORT : champs guest → cellules ordonnées (chaînes). Déterministe ; null → chaîne vide.
export function guestToCsvCells(fields: GuestImportFields): string[] {
  return [
    fields.phone,
    fields.first_name,
    fields.last_name ?? "",
    fields.email ?? "",
    fields.birthday ?? "",
  ];
}

// IMPORT : cellules (dans l'ordre GUEST_CSV_COLUMNS) → champs guest VALIDÉS/normalisés, ou erreurs.
// N'invente rien : un téléphone non normalisable ou une date incohérente est REFUSÉ (jamais corrigé au hasard).
export function csvCellsToGuest(
  cells: readonly string[],
): { ok: true; value: GuestImportFields } | { ok: false; errors: CsvImportError[] } {
  const errors: CsvImportError[] = [];
  if (cells.length !== GUEST_CSV_COLUMNS.length) {
    return { ok: false, errors: ["wrong_column_count"] };
  }

  const rawPhone = (cells[0] ?? "").trim();
  const firstName = (cells[1] ?? "").trim();
  const lastNameRaw = (cells[2] ?? "").trim();
  const emailRaw = (cells[3] ?? "").trim();
  const birthdayRaw = (cells[4] ?? "").trim();

  let phone = "";
  if (!rawPhone) {
    errors.push("phone_required");
  } else {
    const norm = normalizeE164(rawPhone);
    if (!norm) errors.push("phone_invalid");
    else phone = norm;
  }

  if (!firstName) errors.push("first_name_required");

  let email: string | null = null;
  if (emailRaw) {
    email = normalizeEmail(emailRaw);
    if (!email) errors.push("email_invalid");
  }

  let birthday: string | null = null;
  if (birthdayRaw) {
    if (!isIsoDate(birthdayRaw)) errors.push("birthday_invalid");
    else birthday = birthdayRaw;
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      phone,
      first_name: firstName,
      last_name: lastNameRaw || null,
      email,
      birthday,
    },
  };
}

// ————————————————————————————————————————————————————————————————
// Usabilité d'un segment — s'appuie sur classifyGuest (crmClients). Peut-on contacter, et à quel titre ?
// ————————————————————————————————————————————————————————————————

export type GuestContactState = {
  phoneE164: string | null;
  optOut: boolean;
  consentMarketing: boolean;
};

export type MarketingBlocker = "no_phone" | "opt_out" | "no_consent";

export type GuestActionability = {
  segment: GuestSegment;
  daysSinceLastSeated: number | null;
  birthdayThisMonth: boolean;
  isTopSpender: boolean;
  contactable: boolean; // un numéro E.164 ET pas d'opt-out (base de tout contact)
  canService: boolean; // message contractuel (« table prête ») : contactable suffit
  canMarket: boolean; // message de prospection : contactable + consentement marketing
  missingForMarketing: MarketingBlocker[]; // ce qu'il manque pour un envoi marketing (état honnête)
};

// Réutilise classifyGuest pour le segment, puis dit ce qui est ACTIONNABLE (sans dupliquer les règles Évin :
// la garde de contenu reste prepareContactLink dans crmClients ; ici on ne juge que l'ÉLIGIBILITÉ du client).
export function guestActionability(
  row: GuestScoreRow,
  input: SegmentInput,
  contact: GuestContactState,
): GuestActionability {
  const c = classifyGuest(row, input);
  const hasPhone = !!contact.phoneE164;
  const contactable = hasPhone && !contact.optOut;

  const missingForMarketing: MarketingBlocker[] = [];
  if (!hasPhone) missingForMarketing.push("no_phone");
  if (contact.optOut) missingForMarketing.push("opt_out");
  if (!contact.consentMarketing) missingForMarketing.push("no_consent");

  return {
    segment: c.segment,
    daysSinceLastSeated: c.daysSinceLastSeated,
    birthdayThisMonth: c.birthdayThisMonth,
    isTopSpender: c.isTopSpender,
    contactable,
    canService: contactable,
    canMarket: contactable && contact.consentMarketing,
    missingForMarketing,
  };
}
