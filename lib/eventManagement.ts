// lib/eventManagement.ts — logique métier PURE du module Gestion des soirées / Agenda éditable (0054).
// 100% testable, aucune dépendance Supabase/React. Trois responsabilités :
//   1. Règles de transition de statut d'une soirée (draft → published → open → closed).
//   2. Validation d'un brouillon de soirée (champs de planification).
//   3. Calcul d'une grille mensuelle (semaines lundi→dimanche, jours débordants inclus) pour le calendrier.
//
// IMPORTANT (D-00) : ce module planifie des soirées FUTURES dans `events` (statut de planification).
// Il ne pilote JAMAIS le singleton runtime (bootstrap/activate/close_club_event_v2) : ouvrir/fermer ici
// = éditer une ligne planifiée, pas activer la soirée en cours d'exploitation.

import type { StaffRole } from "./permissions.ts";

// Vocabulaire de statut de PLANIFICATION. 'archived' existe en base (posé par la clôture runtime
// close_club_event_v2) : on le connaît pour le traiter en état terminal verrouillé, mais on ne le
// propose jamais comme cible d'édition.
export const EVENT_STATUSES = ["draft", "published", "open", "closed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

// Statuts éditables à la création : une soirée naît en brouillon ou publiée, jamais ouverte/close/archivée.
export const CREATABLE_EVENT_STATUSES = ["draft", "published"] as const;

// Transitions autorisées (miroir exact de la garde SQL event_status_transition_allowed dans 0054).
// closed et archived sont terminaux (aucune sortie). Un no-op (from === to) est traité à part.
const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["published", "closed"],
  published: ["draft", "open", "closed"],
  open: ["closed"],
  closed: [],
  archived: [],
};

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (EVENT_STATUSES as readonly string[]).includes(value);
}

// Une transition est valide si c'est un no-op sur un statut connu non terminal-inconnu, ou si `to`
// figure dans la liste blanche de `from`. On refuse tout statut source/cible inconnu.
export function validateStatusTransition(from: string, to: string): { ok: boolean; message: string } {
  if (!(from in STATUS_TRANSITIONS)) return { ok: false, message: `Statut de départ inconnu : ${from}.` };
  if (!isEventStatus(to)) return { ok: false, message: `Statut cible invalide : ${to}.` };
  if (from === to) return { ok: true, message: "" };
  if (from === "archived") return { ok: false, message: "Soirée archivée : édition verrouillée." };
  if (STATUS_TRANSITIONS[from].includes(to)) return { ok: true, message: "" };
  return { ok: false, message: `Transition ${from} → ${to} interdite.` };
}

export function canManageEvents(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// ───────── Validation d'un brouillon de soirée ─────────

export type EventDraft = {
  title?: string | null;
  venue_id?: string | null;
  event_date?: string | null; // YYYY-MM-DD
  status?: string | null;
  horaire_debut?: string | null;
  horaire_fin?: string | null;
  capacite?: number | null;
  espace?: string | null;
  artistes?: string | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Horaire souple : "23:30" ou "23h30" ou "23h" — texte libre borné, jamais imposé (nightclub = passage minuit).
const TIME_RE = /^([01]?\d|2[0-3])[:h]?([0-5]\d)?$/;

// Une date ISO est réputée valide si le format est bon ET si elle « fait l'aller-retour » (rejette 2026-02-30).
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateEventDraft(d: EventDraft): { ok: boolean; message: string } {
  if (!d.title || !d.title.trim()) return { ok: false, message: "Titre de soirée requis." };
  if (!d.event_date || !isValidIsoDate(d.event_date)) return { ok: false, message: "Date de soirée invalide (AAAA-MM-JJ)." };
  if (d.status != null && d.status !== "" && !isEventStatus(d.status))
    return { ok: false, message: "Statut de soirée inconnu." };
  if (d.capacite != null && (!Number.isInteger(d.capacite) || d.capacite < 0))
    return { ok: false, message: "Capacité invalide." };
  if (d.horaire_debut != null && d.horaire_debut !== "" && !TIME_RE.test(d.horaire_debut.trim()))
    return { ok: false, message: "Horaire de début invalide." };
  if (d.horaire_fin != null && d.horaire_fin !== "" && !TIME_RE.test(d.horaire_fin.trim()))
    return { ok: false, message: "Horaire de fin invalide." };
  return { ok: true, message: "" };
}

// ───────── Grille mensuelle (calendrier) ─────────

// Événement minimal projeté dans la grille : seule la date (YYYY-MM-DD, éventuellement horodatée) compte.
export type CalendarEvent = {
  id?: string;
  title?: string | null;
  event_date: string;
  status?: string | null;
  venue_id?: string | null;
};

export type MonthGridDay = {
  date: string; // YYYY-MM-DD
  day: number; // quantième (1..31)
  inMonth: boolean; // appartient au mois cible (false = débordement mois précédent/suivant)
  events: CalendarEvent[];
};

export type MonthGrid = {
  year: number;
  month: number; // 1..12
  label: string; // ex. "juillet 2026"
  weeks: MonthGridDay[][]; // semaines de 7 jours, lundi → dimanche
};

const MONTH_LABELS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  // month 1..12 ; Date.UTC(year, month, 0) = dernier jour du mois `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Index lundi-first (0 = lundi … 6 = dimanche) du premier jour du mois.
function mondayFirstWeekday(year: number, month: number): number {
  const jsDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = dimanche
  return (jsDay + 6) % 7;
}

export function prevMonth(year: number, month: number): { year: number; month: number } {
  return month <= 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month >= 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

// Regroupe les événements par date (clé YYYY-MM-DD), en ignorant les entrées sans date (honnêteté).
function indexEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    if (!e || !e.event_date) continue;
    const key = String(e.event_date).slice(0, 10);
    if (!ISO_DATE_RE.test(key)) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return map;
}

// Construit la grille du mois `month` (1..12) de l'année `year` : semaines complètes lundi→dimanche,
// avec les jours débordants du mois précédent/suivant (inMonth=false) pour remplir chaque semaine.
export function buildMonthGrid(year: number, month: number, events: CalendarEvent[] = []): MonthGrid {
  const byDate = indexEventsByDate(events);
  const leading = mondayFirstWeekday(year, month);
  const total = daysInMonth(year, month);
  const cells: MonthGridDay[] = [];

  const prev = prevMonth(year, month);
  const prevTotal = daysInMonth(prev.year, prev.month);
  // Jours débordants du mois précédent (en tête).
  for (let i = leading - 1; i >= 0; i--) {
    const day = prevTotal - i;
    const date = formatIsoDate(prev.year, prev.month, day);
    cells.push({ date, day, inMonth: false, events: byDate.get(date) ?? [] });
  }
  // Jours du mois cible.
  for (let day = 1; day <= total; day++) {
    const date = formatIsoDate(year, month, day);
    cells.push({ date, day, inMonth: true, events: byDate.get(date) ?? [] });
  }
  // Jours débordants du mois suivant (queue) pour compléter la dernière semaine.
  const next = nextMonth(year, month);
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const date = formatIsoDate(next.year, next.month, nextDay);
    cells.push({ date, day: nextDay, inMonth: false, events: byDate.get(date) ?? [] });
    nextDay++;
  }

  const weeks: MonthGridDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    year,
    month,
    label: `${MONTH_LABELS[month - 1]} ${year}`,
    weeks,
  };
}
