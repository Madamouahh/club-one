// lib/guestPortal.ts — logique PURE du PORTAIL CLIENT (audit E2 préférences/consentements, E3 agenda mensuel).
// Aucun accès réseau. MIROIR côté client des RPC 0058 : set_guest_preferences_v1, public_month_events_v1,
// get_guest_space_v2. Les helpers ci-dessous ne font que VALIDER/PRÉSENTER pour l'UX — jamais sécuriser
// (la sécurité réelle est refaite côté SQL : whitelist des clés, bornes, rejet des jetons expirés).
//
// Règles dures respectées :
//   · on n'invente aucune donnée (préférences vides = état honnête, pas de valeur par défaut fabriquée) ;
//   · les bornes ici MIROITENT exactement celles de la RPC (280 caractères, whitelist musique/table/allergies) ;
//   · le modèle mois/salle est déterministe et testable (aucune dépendance à un fuseau serveur).

// ————————————————————————————————————————————————————————————————
// Salles (miroir strict de public.venues 0004 : eden / cercle / terminus).
// ————————————————————————————————————————————————————————————————
export const VENUE_IDS = ["eden", "cercle", "terminus"] as const;
export type VenueId = (typeof VENUE_IDS)[number];

export function isVenueId(value: unknown): value is VenueId {
  return typeof value === "string" && (VENUE_IDS as readonly string[]).includes(value);
}

export function venueLabel(venue: string | null | undefined): string {
  switch (venue) {
    case "eden":
      return "Eden";
    case "cercle":
      return "Cercle";
    case "terminus":
      return "Terminus";
    default:
      return "Toutes les salles";
  }
}

// Filtre de salle envoyé à public_month_events_v1 : null = toutes les salles ; sinon un id de salle valide.
export function normalizeVenueFilter(value: unknown): VenueId | null {
  return isVenueId(value) ? value : null;
}

// ————————————————————————————————————————————————————————————————
// Préférences de service (E2) — whitelist STRICTE, bornes miroir de set_guest_preferences_v1.
// ————————————————————————————————————————————————————————————————
export const PREF_KEYS = ["musique", "table", "allergies"] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export const PREF_MAX_LEN = 280;

export type GuestPreferences = {
  musique?: string;
  table?: string;
  allergies?: string;
};

// Normalise une valeur inconnue (payload RPC ou saisie UI) en préférences sûres : trim, borne, whitelist.
// Une clé vide après trim est OMISE (jamais stockée comme chaîne vide) — miroir exact du SQL.
export function normalizePreferences(input: unknown): GuestPreferences {
  const out: GuestPreferences = {};
  if (!input || typeof input !== "object") return out;
  const obj = input as Record<string, unknown>;
  for (const key of PREF_KEYS) {
    const raw = obj[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, PREF_MAX_LEN);
    if (value) out[key] = value;
  }
  return out;
}

// Vrai si au moins une préférence est renseignée (pour un affichage « aucune préférence » honnête).
export function hasAnyPreference(prefs: GuestPreferences): boolean {
  return PREF_KEYS.some((key) => {
    const value = prefs[key];
    return typeof value === "string" && value.length > 0;
  });
}

export type PrefValidation = { ok: boolean; errors: PrefKey[]; clean: GuestPreferences };

// Valide une saisie brute d'UI. Une saisie dépassant la borne est signalée (l'UI peut alerter) mais reste
// TRONQUÉE dans `clean` (jamais rejetée silencieusement) — le SQL tronquerait de toute façon.
export function validatePreferencesInput(input: Record<string, string>): PrefValidation {
  const errors: PrefKey[] = [];
  const clean: GuestPreferences = {};
  for (const key of PREF_KEYS) {
    const raw = typeof input[key] === "string" ? input[key] : "";
    const trimmed = raw.trim();
    if (trimmed.length > PREF_MAX_LEN) errors.push(key);
    const value = trimmed.slice(0, PREF_MAX_LEN);
    if (value) clean[key] = value;
  }
  return { ok: errors.length === 0, errors, clean };
}

// ————————————————————————————————————————————————————————————————
// Modèle mois/agenda (E3) — déterministe, sans fuseau serveur, testable.
// Un mois est identifié par (year, month) avec month ∈ 1..12. On borne l'année comme la RPC (2000..2100).
// ————————————————————————————————————————————————————————————————
export type MonthRef = { year: number; month: number };

export function isValidMonthRef(ref: MonthRef): boolean {
  return (
    Number.isInteger(ref.year) &&
    Number.isInteger(ref.month) &&
    ref.year >= 2000 &&
    ref.year <= 2100 &&
    ref.month >= 1 &&
    ref.month <= 12
  );
}

// Mois précédent / suivant, avec passage d'année. Bornes 2000..2100 respectées (clamp aux extrêmes).
export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const zeroBased = (ref.year * 12 + (ref.month - 1)) + delta;
  let year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  if (year < 2000) year = 2000;
  if (year > 2100) year = 2100;
  return { year, month };
}

const MONTH_LABELS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

// Libellé FR « juillet 2026 » (aucune dépendance externe ni fuseau).
export function monthLabelFr(ref: MonthRef): string {
  if (!isValidMonthRef(ref)) return "";
  return `${MONTH_LABELS_FR[ref.month - 1]} ${ref.year}`;
}

// Le mois courant à partir d'une Date de référence (heure locale, composants bruts).
export function currentMonthRef(now: Date): MonthRef {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

// ————————————————————————————————————————————————————————————————
// Événements d'agenda (miroir de public_month_events_v1).
// ————————————————————————————————————————————————————————————————
export type MonthEvent = {
  venue_id: string;
  venue_name: string | null;
  venue_kind: string | null;
  title: string | null;
  slug: string | null;
  event_date: string; // 'YYYY-MM-DD'
  start_time: string | null;
  horaire_debut: string | null;
  horaire_fin: string | null;
  description: string | null;
  lineup: string[] | null;
  artistes: string | null;
  cover_url: string | null;
  ticket_url: string | null;
};

// Normalise une ligne inconnue de la RPC en MonthEvent sûr (jamais d'exception ; champs manquants → null).
export function normalizeMonthEvent(input: unknown): MonthEvent | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const venueId = typeof o.venue_id === "string" ? o.venue_id : "";
  const eventDate = typeof o.event_date === "string" ? o.event_date : "";
  if (!venueId || !eventDate) return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const lineup = Array.isArray(o.lineup) ? o.lineup.filter((x): x is string => typeof x === "string") : null;
  return {
    venue_id: venueId,
    venue_name: str(o.venue_name),
    venue_kind: str(o.venue_kind),
    title: str(o.title),
    slug: str(o.slug),
    event_date: eventDate,
    start_time: str(o.start_time),
    horaire_debut: str(o.horaire_debut),
    horaire_fin: str(o.horaire_fin),
    description: str(o.description),
    lineup,
    artistes: str(o.artistes),
    cover_url: str(o.cover_url),
    ticket_url: str(o.ticket_url),
  };
}

export function normalizeMonthEvents(input: unknown): MonthEvent[] {
  if (!Array.isArray(input)) return [];
  const out: MonthEvent[] = [];
  for (const row of input) {
    const ev = normalizeMonthEvent(row);
    if (ev) out.push(ev);
  }
  return out;
}

export type DayGroup = { date: string; events: MonthEvent[] };

// Regroupe les événements par jour (croissant), en conservant l'ordre serveur au sein d'un jour.
// Filtrage optionnel par salle côté client (la RPC filtre déjà, ce miroir sert l'onglet salle sans refetch).
export function groupEventsByDay(events: MonthEvent[], venue: VenueId | null): DayGroup[] {
  const byDay = new Map<string, MonthEvent[]>();
  for (const ev of events) {
    if (venue && ev.venue_id !== venue) continue;
    const bucket = byDay.get(ev.event_date);
    if (bucket) bucket.push(ev);
    else byDay.set(ev.event_date, [ev]);
  }
  return [...byDay.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({ date, events: byDay.get(date) as MonthEvent[] }));
}

// Affichage FR d'une date ISO 'YYYY-MM-DD' → 'DD/MM/YYYY' (composants bruts, aucun fuseau).
export function formatDateFr(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// Créneau horaire présentable « 23:30 → 05:00 » à partir des champs souples (fallbacks honnêtes, jamais inventés).
export function formatSlot(ev: Pick<MonthEvent, "start_time" | "horaire_debut" | "horaire_fin">): string {
  const debut = ev.horaire_debut || ev.start_time || "";
  const fin = ev.horaire_fin || "";
  if (debut && fin) return `${debut} → ${fin}`;
  return debut || "";
}

// ————————————————————————————————————————————————————————————————
// Jeton d'espace expiré : lecture du signal renvoyé par get_guest_space_v2 (found:false, expired:true).
// ————————————————————————————————————————————————————————————————
export type SpaceAccess = { found: boolean; expired: boolean; hasPin: boolean };

export function readSpaceAccess(input: unknown): SpaceAccess {
  if (!input || typeof input !== "object") return { found: false, expired: false, hasPin: false };
  const o = input as Record<string, unknown>;
  return {
    found: o.found === true,
    expired: o.expired === true,
    hasPin: o.has_pin === true,
  };
}

// Format d'un PIN de re-accès (miroir de set_guest_pin_v1 : 4 à 8 chiffres).
export function isValidPinFormat(pin: string): boolean {
  return /^[0-9]{4,8}$/.test(pin.trim());
}
