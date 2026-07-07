// lib/spendAttribution.ts — logique PURE de l'ATTRIBUTION DE DÉPENSE PAR CLIENT (Vague 6, Squad D4).
// Aucun accès réseau. Miroir applicatif des gardes de la RPC attribute_guest_spend_v1 (migration 0068) :
// on valide/normalise CÔTÉ APP avant l'appel, mais la garde RÉELLE reste en SQL (SECURITY DEFINER + RLS).
//
// PRINCIPE D'HONNÊTETÉ (hérité de 0013/0059/lib/crmProfile) : rien n'est fabriqué. Le montant est SAISI
// par un humain de la direction (jamais deviné) ; un montant vide/nul/négatif/mal formé est REFUSÉ, pas
// « corrigé » au hasard ; une date future est refusée (une soirée à venir n'a pas de dépense réelle).
//
// Unité : la RPC prend un montant EN CENTIMES (p_amount_cents int). On parse l'euro saisi (« 1 250,50 »)
// en centimes entiers, en évitant l'imprécision flottante (parties entière/décimale traitées séparément).

// int4 signé = plafond du paramètre p_amount_cents de la RPC (0068). Au-delà : refus (jamais d'overflow).
export const AMOUNT_MAX_CENTS = 2_147_483_647;

// ————————————————————————————————————————————————————————————————
// Montant — parse un euro saisi en centimes entiers (> 0). Déterministe, sans flottant.
// ————————————————————————————————————————————————————————————————

export type AmountError =
  | "empty" // rien saisi
  | "not_a_number" // format non numérique
  | "negative" // montant négatif
  | "zero" // montant nul (aucune dépense à attribuer)
  | "too_many_decimals" // plus de 2 décimales (les centimes s'arrêtent au centième)
  | "too_large"; // dépasse le plafond int4 de la RPC

export type AmountResult =
  | { ok: true; cents: number }
  | { ok: false; error: AmountError };

// Accepte « 12 », « 12,5 », « 12.50 », « 1 250,50 » (espaces fines/insécables tolérés comme séparateurs
// de milliers). Refuse le vide, le négatif, le zéro, > 2 décimales, le non-numérique, le trop grand.
export function parseEuroToCents(raw: string): AmountResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "empty" };

  // Retire les espaces (séparateurs de milliers), unifie la virgule décimale en point.
  const compact = trimmed.replace(/[\s  ]/g, "").replace(",", ".");

  if (compact.startsWith("-")) return { ok: false, error: "negative" };

  // Trop de décimales : détecté explicitement pour un message honnête (≠ « pas un nombre »).
  if (/^\d+\.\d{3,}$/.test(compact)) return { ok: false, error: "too_many_decimals" };

  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(compact);
  if (!m) return { ok: false, error: "not_a_number" };

  const whole = Number(m[1]);
  const fracStr = m[2] ? (m[2] + "00").slice(0, 2) : "00"; // « 5 » → « 50 » centimes
  const cents = whole * 100 + Number(fracStr);

  if (cents === 0) return { ok: false, error: "zero" };
  if (cents > AMOUNT_MAX_CENTS) return { ok: false, error: "too_large" };
  return { ok: true, cents };
}

// Formatage d'un montant en centimes → chaîne euro FR (affichage honnête, jamais de valeur inventée).
export function formatCentsAsEuro(cents: number): string {
  const euros = cents / 100;
  return `${euros.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

// ————————————————————————————————————————————————————————————————
// Date de soirée — ISO canonique (AAAA-MM-JJ), non future. Miroir de la garde SQL (p_event_date > today).
// ————————————————————————————————————————————————————————————————

export type DateError = "empty" | "invalid" | "future";

export type DateResult =
  | { ok: true; value: string }
  | { ok: false; error: DateError };

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

// Compare deux dates ISO AAAA-MM-JJ lexicographiquement (valide car format à largeur fixe, zéro-paddé).
export function validateEventDate(raw: string, todayIso: string): DateResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "empty" };
  if (!isIsoDate(trimmed)) return { ok: false, error: "invalid" };
  if (trimmed > todayIso) return { ok: false, error: "future" };
  return { ok: true, value: trimmed };
}

// Renvoie la date du jour au format ISO AAAA-MM-JJ (UTC) — pour comparer sans dériver sur le fuseau.
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ————————————————————————————————————————————————————————————————
// Validation combinée — l'entrée complète du formulaire d'attribution avant l'appel RPC.
// ————————————————————————————————————————————————————————————————

export type AttributionInput = {
  guestId: string | null; // le client sélectionné (uuid) ; null = aucune sélection
  eventDateRaw: string; // date de soirée saisie
  amountRaw: string; // montant euro saisi
};

export type AttributionFieldError = "no_guest" | AmountError | DateError;

export type AttributionResult =
  | { ok: true; guestId: string; eventDate: string; amountCents: number }
  | { ok: false; errors: AttributionFieldError[] };

// Valide l'ensemble ; agrège les erreurs par champ (le formulaire les affiche toutes d'un coup).
// N'appelle rien : produit exactement les 3 arguments attendus par attribute_guest_spend_v1.
export function validateAttribution(
  input: AttributionInput,
  todayIsoDate: string,
): AttributionResult {
  const errors: AttributionFieldError[] = [];

  const hasGuest = typeof input.guestId === "string" && input.guestId.trim().length > 0;
  if (!hasGuest) errors.push("no_guest");

  const date = validateEventDate(input.eventDateRaw, todayIsoDate);
  if (!date.ok) errors.push(date.error);

  const amount = parseEuroToCents(input.amountRaw);
  if (!amount.ok) errors.push(amount.error);

  if (!hasGuest || !date.ok || !amount.ok) return { ok: false, errors };

  return {
    ok: true,
    guestId: (input.guestId as string).trim(),
    eventDate: date.value,
    amountCents: amount.cents,
  };
}

// Messages FR prêts à afficher (l'UI mappe l'erreur → texte ; garde le composant mince).
export const ATTRIBUTION_ERROR_LABELS: Record<AttributionFieldError, string> = {
  no_guest: "Sélectionnez un client.",
  empty: "Champ requis.",
  invalid: "Date invalide (AAAA-MM-JJ).",
  future: "Date future refusée : la soirée n'a pas encore eu lieu.",
  not_a_number: "Montant non numérique.",
  negative: "Le montant ne peut pas être négatif.",
  zero: "Le montant doit être supérieur à 0.",
  too_many_decimals: "Deux décimales maximum (centimes).",
  too_large: "Montant trop élevé.",
};
