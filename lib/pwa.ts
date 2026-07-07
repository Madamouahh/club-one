// lib/pwa.ts — Helpers PURS pour la couche PWA de Club One (aucune dépendance DOM/React).
// Testables en isolation (voir tests/pwa.test.mts). Consommés par app/_components/PwaRegister.tsx
// et alignés avec la version de cache déclarée dans public/sw.js.

/**
 * Version courante de l'app shell / du service worker.
 * DOIT rester synchronisée avec la constante `VERSION` de public/sw.js.
 * Format semver simple "major.minor.patch".
 */
export const PWA_SHELL_VERSION = "1.0.0";

/** Découpe une version "1.2.3" en segments numériques. Parties absentes ou non numériques = 0. */
function parseVersion(v: string): number[] {
  return String(v)
    .trim()
    .split(".")
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/**
 * Compare deux versions semver simples segment par segment.
 * @returns 1 si a > b, -1 si a < b, 0 si égales.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** true si `incoming` est strictement plus récente que `current` (une mise à jour est disponible). */
export function isUpdateAvailable(current: string, incoming: string): boolean {
  return compareVersions(incoming, current) === 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Machine à états de connexion (offline / reconnexion)
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionStatus = "online" | "offline" | "reconnecting";

/**
 * Événements d'entrée de la machine :
 * - "offline" / "online" : événements navigateur bruts (navigator.onLine / window events).
 * - "reconnect-confirmed" / "reconnect-failed" : résultat d'un probe réseau réel
 *   (navigator.onLine peut être `true` sans connectivité effective — d'où la vérification).
 */
export type ConnectionEvent =
  | "offline"
  | "online"
  | "reconnect-confirmed"
  | "reconnect-failed";

/**
 * Transition PURE de la machine à états de connexion.
 * Un passage online→ n'est jamais considéré comme rétabli tant qu'un probe ne l'a pas confirmé :
 * l'état intermédiaire est "reconnecting".
 */
export function nextConnectionStatus(
  state: ConnectionStatus,
  event: ConnectionEvent,
): ConnectionStatus {
  switch (event) {
    case "offline":
      return "offline";
    case "online":
      // Depuis offline, on entre en phase de vérification. Depuis online, rien ne change.
      return state === "online" ? "online" : "reconnecting";
    case "reconnect-confirmed":
      return "online";
    case "reconnect-failed":
      // Un échec de probe ne fait retomber que si on était en train de vérifier.
      return state === "reconnecting" ? "offline" : state;
    default:
      return state;
  }
}

/** Indique si une bannière de connexion doit être montrée (tout sauf l'état online stable). */
export function shouldShowConnectionBanner(state: ConnectionStatus): boolean {
  return state !== "online";
}

// ─────────────────────────────────────────────────────────────────────────────
// Éligibilité à l'installation (Add to Home Screen)
// ─────────────────────────────────────────────────────────────────────────────

export interface InstallEligibilityInput {
  /** L'app tourne déjà en mode standalone (déjà installée). */
  isStandalone: boolean;
  /** navigator.serviceWorker est disponible. */
  hasServiceWorker: boolean;
  /** Contexte sécurisé (https ou localhost) — requis pour l'installation. */
  isSecureContext: boolean;
  /** L'événement `beforeinstallprompt` a été capturé (Chromium uniquement). */
  hasBeforeInstallPrompt: boolean;
}

/**
 * Éligibilité au prompt d'installation natif (Chromium).
 * Retourne false si déjà installée, hors contexte sécurisé, sans SW, ou sans prompt capturé.
 */
export function isInstallEligible(input: InstallEligibilityInput): boolean {
  if (input.isStandalone) return false;
  if (!input.isSecureContext) return false;
  if (!input.hasServiceWorker) return false;
  return input.hasBeforeInstallPrompt;
}

/**
 * iOS/Safari n'expose pas `beforeinstallprompt` : on affiche une consigne manuelle
 * "Ajouter à l'écran d'accueil" tant que l'app n'est pas déjà en standalone.
 */
export function isManualInstallHint(input: {
  isIOS: boolean;
  isStandalone: boolean;
}): boolean {
  return input.isIOS && !input.isStandalone;
}
