// lib/resaBoard.ts — logique PURE de la VUE SOIRÉE des réservations (module A3 du plan maître).
// Aucun accès réseau. C'est l'outil de l'accueil / de la direction PENDANT la soirée : le tableau
// des réservations DÉJÀ VALIDÉES (status = "approved" côté file resaRequest → migration 0025) présenté
// comme un banc d'accueil (« qui vient ce soir · à quelle table · arrivé / pas encore / no-show »).
//
// A3 est DISTINCT de deux modules voisins et ne les duplique pas :
//   · resaRequest (file des DEMANDES `pending` → décision manager) : A3 ne montre QUE les approuvées ;
//   · A4/A5 (comptage d'entrées QR / flux) : A3 suit les RÉSERVATIONS de table, pas le compteur de porte.
//
// Règles dures (honnêteté) :
//   · le tableau ne contient QUE des réservations approuvées — jamais une `pending`/`declined`/`cancelled`
//     transformée en présence ; sans réservation approuvée, le banc est VIDE (aucun invité fabriqué) ;
//   · l'état d'arrivée est un GESTE HUMAIN (l'accueil pointe) — JAMAIS dérivé d'une horloge : on n'invente
//     pas un « no-show » à partir d'un créneau ambigu (« 23:00 » vs club à 3 h) ; défaut = `attendu`,
//     jamais deviné « arrivé » ni « no-show » ;
//   · la garde de rôle est un confort d'UI, PAS une sécurité — l'autorité reste la RLS de la table de
//     réservations (0025) ; A3 n'a aucune table propre, il compose des lignes déjà filtrées côté SQL.

import type { StaffRole } from "./permissions.ts";
import {
  requestSummaryLabel,
  type ReservationRequestRow,
  type ResaStatus,
} from "./resaRequest.ts";

// ————————————————————————————————————————————————————————————————
// Quelles réservations montent sur le banc de soirée
// ————————————————————————————————————————————————————————————————

// SEULE une réservation approuvée occupe une table pour la soirée. pending appartient à la file
// resaRequest ; declined/cancelled n'occupent rien. Miroir de isActiveResaStatus mais restreint à
// l'approuvé (une `pending` n'est PAS encore une place réservée que l'accueil doit honorer).
export function isOnBoard(status: ResaStatus): boolean {
  return status === "approved";
}

// ————————————————————————————————————————————————————————————————
// État d'arrivée (marqué à la main par l'accueil — jamais dérivé d'une horloge)
// ————————————————————————————————————————————————————————————————

export const ARRIVAL_STATES = ["attendu", "arrive", "no_show"] as const;
export type ArrivalState = (typeof ARRIVAL_STATES)[number];

export function isArrivalState(v: unknown): v is ArrivalState {
  return typeof v === "string" && (ARRIVAL_STATES as readonly string[]).includes(v);
}

// Style d'affichage (self-contained, hex — aucune dépendance Tailwind à l'intérieur).
export type ArrivalStateStyle = { label: string; stroke: string; text: string };

export const ARRIVAL_STATE_STYLE: Record<ArrivalState, ArrivalStateStyle> = {
  attendu: { label: "Attendu", stroke: "#fbbf24", text: "#fde68a" },
  arrive: { label: "Arrivé", stroke: "#34d399", text: "#a7f3d0" },
  no_show: { label: "No-show", stroke: "#f87171", text: "#fecaca" },
};

export function arrivalStateLabel(state: ArrivalState): string {
  return ARRIVAL_STATE_STYLE[state].label;
}

// Résout l'état d'arrivée SANS jamais deviner : une valeur explicite valide prime, sinon `attendu`.
// Une valeur inconnue/illisible retombe honnêtement sur `attendu` (« pas encore pointé »), jamais
// sur « arrivé » ni « no-show ».
export function resolveArrival(explicit: ArrivalState | null | undefined): ArrivalState {
  return isArrivalState(explicit) ? explicit : "attendu";
}

// Toute transition entre les trois états est un choix HUMAIN légitime (l'accueil corrige un pointage
// erroné) — on n'interdit rien, mais repointer le même état est un no-op honnête.
export function isArrivalTransition(from: ArrivalState, to: ArrivalState): boolean {
  return isArrivalState(from) && isArrivalState(to) && from !== to;
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle (confort UI — PAS une sécurité ; la RLS 0025 reste l'autorité)
// ————————————————————————————————————————————————————————————————

// Consultent le banc de soirée : la direction (admin/manager) + l'accueil / la porte
// (security, security_counter). Le serveur voit ses tables via A2, pas le carnet de résa ; le
// promoteur n'a pas accès aux coordonnées des autres. Réglable par le fondateur.
export function canViewResaBoard(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "security" || role === "security_counter";
}

// Pointent une arrivée : la direction + le compteur d'accueil (security_counter) qui tient la porte.
// La sécurité (security) consulte mais ne clôt pas le pointage d'accueil. Réglable par le fondateur.
export function canMarkArrival(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "security_counter";
}

// ————————————————————————————————————————————————————————————————
// Modèle de vue
// ————————————————————————————————————————————————————————————————

export type ReservationBoardRow = {
  request: ReservationRequestRow;
  arrival: ArrivalState;
  covers: number; // party_size (jamais recalculé — vient de la demande réelle)
  label: string; // « Table 205 · 6 pers. · groupe debout » (réutilise requestSummaryLabel)
};

export type ReservationBoardSummary = {
  total: number; // nb de réservations approuvées sur le banc
  byArrival: Record<ArrivalState, number>;
  expectedCovers: number; // couverts encore attendus ou déjà arrivés (exclut les no-show)
  arrivedCovers: number; // couverts effectivement arrivés
  pendingArrivals: number; // réservations encore `attendu` (à accueillir)
};

export type ReservationBoardView = {
  canView: boolean;
  canMark: boolean;
  rows: ReservationBoardRow[]; // triées (voir sortForBoard) ; vide si aucune réservation approuvée
  summary: ReservationBoardSummary;
};

// Ordre du banc : d'abord ce qu'il reste à accueillir (`attendu`), puis les arrivés, puis les no-show.
// À état égal : par créneau (les sans-créneau en fin), puis les plus anciennes demandes, puis par id
// (départage stable, déterministe — aucune source d'entropie).
const ARRIVAL_ORDER: Record<ArrivalState, number> = { attendu: 0, arrive: 1, no_show: 2 };

function compareRows(a: ReservationBoardRow, b: ReservationBoardRow): number {
  const byArrival = ARRIVAL_ORDER[a.arrival] - ARRIVAL_ORDER[b.arrival];
  if (byArrival !== 0) return byArrival;
  // créneau : null en dernier
  const sa = a.request.slot;
  const sb = b.request.slot;
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    if (sa < sb) return -1;
    if (sa > sb) return 1;
  }
  if (a.request.created_at !== b.request.created_at) {
    return a.request.created_at < b.request.created_at ? -1 : 1;
  }
  return a.request.id < b.request.id ? -1 : a.request.id > b.request.id ? 1 : 0;
}

export function sortForBoard(rows: readonly ReservationBoardRow[]): ReservationBoardRow[] {
  return [...rows].sort(compareRows);
}

// ————————————————————————————————————————————————————————————————
// Construction du banc
// ————————————————————————————————————————————————————————————————

export function buildReservationBoard(input: {
  role: StaffRole | null | undefined;
  requests: readonly ReservationRequestRow[];
  arrivals?: Record<string, ArrivalState>; // état d'arrivée par id de réservation (pointage humain)
}): ReservationBoardView {
  const canView = canViewResaBoard(input.role);
  const canMark = canMarkArrival(input.role);

  const arrivals = input.arrivals ?? {};

  // On ne garde QUE les réservations approuvées (le reste n'a rien à faire sur le banc d'accueil).
  const rows: ReservationBoardRow[] = input.requests
    .filter((r) => isOnBoard(r.status))
    .map((request) => {
      const arrival = resolveArrival(arrivals[request.id]);
      return {
        request,
        arrival,
        covers: request.party_size,
        label: requestSummaryLabel(request),
      };
    });

  const sorted = sortForBoard(rows);

  const byArrival: Record<ArrivalState, number> = { attendu: 0, arrive: 0, no_show: 0 };
  let expectedCovers = 0;
  let arrivedCovers = 0;
  for (const row of sorted) {
    byArrival[row.arrival] += 1;
    if (row.arrival !== "no_show") expectedCovers += row.covers;
    if (row.arrival === "arrive") arrivedCovers += row.covers;
  }

  return {
    canView,
    canMark,
    rows: sorted,
    summary: {
      total: sorted.length,
      byArrival,
      expectedCovers,
      arrivedCovers,
      pendingArrivals: byArrival.attendu,
    },
  };
}

// Applique un pointage d'arrivée de façon IMMUABLE (nouvelle map, aucune mutation). Miroir UI de la
// future RPC de pointage : l'AUTORITÉ reste le SQL (RLS accueil/direction). Un id absent est ajouté ;
// repointer le même état est un no-op (map inchangée en valeur).
export function applyArrival(
  arrivals: Readonly<Record<string, ArrivalState>>,
  id: string,
  state: ArrivalState,
): Record<string, ArrivalState> {
  return { ...arrivals, [id]: state };
}

// ————————————————————————————————————————————————————————————————
// Formatage FR déterministe
// ————————————————————————————————————————————————————————————————

export function formatCovers(n: number): string {
  return `${n} pers.`;
}
