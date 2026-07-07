// lib/guestPortalAuth.ts — logique PURE de l'AUTH du PORTAIL CLIENT (0061 : rate limiting, récupération sans
// email, révocation/logout, rotation de PIN). Aucun accès réseau. MIROIR côté client des RPC 0061 :
// verify_guest_pin_v2, recover_guest_access_v1, revoke_guest_token_v1, rotate_guest_pin_v1.
//
// Ces helpers ne font que VALIDER / PRÉSENTER pour l'UX — jamais sécuriser (la sécurité réelle est refaite
// côté SQL : hash bcrypt, verrou en base, réponses neutres anti-énumération). Le state machine de verrou est
// un MIROIR déterministe (mêmes constantes que le SQL) pour un compte à rebours honnête côté client — il ne
// remplace JAMAIS le verrou serveur (source de vérité).

// ————————————————————————————————————————————————————————————————
// Constantes de politique — MIROIR STRICT de 0061 (_guest_auth_note_fail).
// ————————————————————————————————————————————————————————————————
export const AUTH_MAX_FAILS = 5;
export const AUTH_WINDOW_MS = 15 * 60 * 1000; // fenêtre glissante de comptage : 15 min
export const AUTH_LOCKOUT_MS = 15 * 60 * 1000; // durée du verrou : 15 min

// ————————————————————————————————————————————————————————————————
// Format d'un PIN (miroir de set_guest_pin_v1 / rotate_guest_pin_v1 : 4 à 8 chiffres).
// ————————————————————————————————————————————————————————————————
export function isPinFormat(pin: string): boolean {
  return /^[0-9]{4,8}$/.test((pin ?? "").trim());
}

// Nettoie une saisie de PIN pour un <input> : chiffres uniquement, borné à 8.
export function sanitizePinInput(raw: string): string {
  return (raw ?? "").replace(/[^0-9]/g, "").slice(0, 8);
}

// ————————————————————————————————————————————————————————————————
// State machine de verrou (MIROIR de _guest_auth_note_fail) — déterministe, testable, sans horloge cachée.
// L'appelant fournit `nowMs` (Date.now()) : aucune dépendance temporelle implicite.
// ————————————————————————————————————————————————————————————————
export type AuthAttemptState = {
  failedCount: number;
  windowStartedAt: number | null; // ms epoch, début de la fenêtre glissante
  lockedUntil: number | null; // ms epoch, fin du verrou (null = pas de verrou)
};

export function initialAttemptState(): AuthAttemptState {
  return { failedCount: 0, windowStartedAt: null, lockedUntil: null };
}

// Enregistre un ÉCHEC : incrémente dans la fenêtre, ou repart à 1 si la fenêtre est écoulée ; arme le verrou
// au seuil. Retourne un NOUVEL état (pur, jamais de mutation en place).
export function registerFailure(state: AuthAttemptState, nowMs: number): AuthAttemptState {
  const windowExpired =
    state.windowStartedAt === null || state.windowStartedAt < nowMs - AUTH_WINDOW_MS;
  const failedCount = windowExpired ? 1 : state.failedCount + 1;
  const windowStartedAt = windowExpired ? nowMs : state.windowStartedAt;
  // On garde un verrou déjà armé s'il est encore actif ; sinon on l'arme au seuil.
  const alreadyLocked = state.lockedUntil !== null && state.lockedUntil > nowMs;
  const lockedUntil =
    failedCount >= AUTH_MAX_FAILS
      ? alreadyLocked
        ? state.lockedUntil
        : nowMs + AUTH_LOCKOUT_MS
      : alreadyLocked
        ? state.lockedUntil
        : null;
  return { failedCount, windowStartedAt, lockedUntil };
}

// Reset après un SUCCÈS (le client légitime repart propre) — miroir de _guest_auth_reset.
export function resetAttempts(): AuthAttemptState {
  return initialAttemptState();
}

export function isLocked(state: AuthAttemptState, nowMs: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > nowMs;
}

// Millisecondes restantes avant la levée du verrou (0 si pas de verrou actif).
export function lockRemainingMs(state: AuthAttemptState, nowMs: number): number {
  if (state.lockedUntil === null) return 0;
  return Math.max(0, state.lockedUntil - nowMs);
}

// Nombre d'essais restants avant verrou (indicatif UX ; le serveur reste la vérité). Jamais négatif.
export function remainingAttempts(state: AuthAttemptState, nowMs: number): number {
  if (isLocked(state, nowMs)) return 0;
  const windowExpired =
    state.windowStartedAt === null || state.windowStartedAt < nowMs - AUTH_WINDOW_MS;
  const effectiveCount = windowExpired ? 0 : state.failedCount;
  return Math.max(0, AUTH_MAX_FAILS - effectiveCount);
}

// ————————————————————————————————————————————————————————————————
// Éligibilité à la récupération (RC) — miroir des gardes de recover_guest_access_v1.
// Le client doit fournir un téléphone non vide ET un PIN bien formé (le serveur revérifie tout).
// ————————————————————————————————————————————————————————————————
export function normalizePhone(raw: string): string {
  return (raw ?? "").trim();
}

export function canAttemptRecovery(input: { phone: string; pin: string }): boolean {
  return normalizePhone(input.phone).length > 0 && isPinFormat(input.pin);
}

// ————————————————————————————————————————————————————————————————
// Parsing des réponses RPC 0061 (jsonb) — jamais d'exception, valeurs par défaut honnêtes.
// ————————————————————————————————————————————————————————————————
export type AuthErrorCode =
  | "pin_invalid"
  | "pin_format"
  | "pin_unavailable"
  | "locked"
  | "expired"
  | "invalid_token"
  | "recover_invalid"
  | "network"
  | "unknown";

export type AuthResult = {
  ok: boolean;
  code: AuthErrorCode | null;
  spaceToken: string | null; // renvoyé par recover_guest_access_v1 en cas de succès
  expiresAt: string | null;
  lockedUntil: string | null;
  retryAfterSeconds: number | null;
};

const KNOWN_CODES: ReadonlySet<string> = new Set<AuthErrorCode>([
  "pin_invalid",
  "pin_format",
  "pin_unavailable",
  "locked",
  "expired",
  "invalid_token",
  "recover_invalid",
  "network",
  "unknown",
]);

export function parseAuthResult(input: unknown): AuthResult {
  const base: AuthResult = {
    ok: false,
    code: null,
    spaceToken: null,
    expiresAt: null,
    lockedUntil: null,
    retryAfterSeconds: null,
  };
  if (!input || typeof input !== "object") return { ...base, code: "unknown" };
  const o = input as Record<string, unknown>;
  const ok = o.ok === true;
  const rawCode = typeof o.code === "string" ? o.code : null;
  const code: AuthErrorCode | null = ok
    ? null
    : rawCode && KNOWN_CODES.has(rawCode)
      ? (rawCode as AuthErrorCode)
      : "unknown";
  const spaceToken = typeof o.space_token === "string" ? o.space_token : null;
  const expiresAt = typeof o.expires_at === "string" ? o.expires_at : null;
  const lockedUntil = typeof o.locked_until === "string" ? o.locked_until : null;
  const retryAfterSeconds =
    typeof o.retry_after_seconds === "number" && Number.isFinite(o.retry_after_seconds)
      ? Math.max(0, Math.trunc(o.retry_after_seconds))
      : null;
  return { ok, code, spaceToken, expiresAt, lockedUntil, retryAfterSeconds };
}

// ————————————————————————————————————————————————————————————————
// Code d'erreur → message FR (l'UI n'invente jamais : messages NEUTRES, sans révéler d'info d'énumération).
// `retryAfterSeconds` enrichit le message 'locked' avec un compte à rebours honnête.
// ————————————————————————————————————————————————————————————————
export function formatRetryDelay(seconds: number | null | undefined): string {
  const s = typeof seconds === "number" && seconds > 0 ? Math.ceil(seconds) : 0;
  if (s <= 0) return "quelques instants";
  if (s < 60) return `${s} seconde${s > 1 ? "s" : ""}`;
  const minutes = Math.ceil(s / 60);
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

export function authErrorMessage(
  code: AuthErrorCode | null,
  ctx?: { retryAfterSeconds?: number | null },
): string {
  switch (code) {
    case null:
      return "";
    case "pin_invalid":
      // NEUTRE : ne distingue jamais « pas de PIN » de « PIN faux » (anti-énumération, miroir SQL).
      return "Code incorrect.";
    case "recover_invalid":
      return "Téléphone ou code incorrect.";
    case "pin_format":
      return "Le code doit contenir 4 à 8 chiffres.";
    case "locked":
      return `Trop de tentatives. Réessayez dans ${formatRetryDelay(ctx?.retryAfterSeconds)}.`;
    case "expired":
      return "Ce lien a expiré.";
    case "invalid_token":
      return "Lien invalide.";
    case "pin_unavailable":
      return "Fonction indisponible sur cet environnement.";
    case "network":
      return "Service momentanément indisponible. Réessayez.";
    case "unknown":
    default:
      return "Action refusée. Réessayez.";
  }
}
