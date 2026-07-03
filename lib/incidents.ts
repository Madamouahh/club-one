// lib/incidents.ts — logique PURE du module Incidents (A6), aucun accès réseau.
//
// Le registre des incidents de soirée (migration 0023) est une donnée SENSIBLE à visibilité
// RESTREINTE. Ce module :
//   · décrit le modèle (miroir des tables incidents / incident_updates) ;
//   · valide un brouillon d'incident AVANT insert (types/niveaux/statuts fermés, description requise) ;
//   · porte les gardes de rôle de la matrice A6 (source de vérité UI ; la RLS 0023 reste l'autorité) ;
//   · agrège une liste pour le rapport post-soirée (états vides HONNÊTES : une liste vide → des zéros,
//     jamais une donnée fabriquée).
// L'accès Supabase reste dans app/page.tsx (comme caisse_z / staff_shifts) ; ce module ne fait que
// valider, filtrer et agréger. Rien n'est inventé : aucun incident n'est fabriqué ici.

import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Modèle (miroir des tables 0023)
// ————————————————————————————————————————————————————————————————

// Catégories d'incident (vocabulaire fermé — pas une donnée fondateur, une structure légale/métier).
export const INCIDENT_TYPES = [
  "altercation",
  "refus_entree",
  "malaise",
  "vol",
  "degradation",
  "securite",
  "technique",
  "autre",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

// Niveaux de gravité, du plus faible au plus fort (l'ordre porte le tri de priorité).
export const INCIDENT_LEVELS = ["mineur", "moyen", "grave", "critique"] as const;
export type IncidentLevel = (typeof INCIDENT_LEVELS)[number];

// États du workflow ouvert → clos.
export const INCIDENT_STATUSES = [
  "ouvert",
  "en_cours",
  "escalade",
  "resolu",
  "clos",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// Un incident est ACTIF (à traiter, compte dans « en cours ») tant qu'il n'est ni résolu ni clos.
const ACTIVE_STATUSES: ReadonlySet<IncidentStatus> = new Set<IncidentStatus>([
  "ouvert",
  "en_cours",
  "escalade",
]);

export type Incident = {
  id: string;
  event_id: string | null;
  exploitation_date: string;
  type: IncidentType;
  niveau: IncidentLevel;
  lieu: string | null;
  personne_concernee: string | null;
  description: string;
  photo_refs: string[];
  status: IncidentStatus;
  escalade: boolean;
  auteur_username: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IncidentUpdate = {
  id: string;
  incident_id: string;
  auteur_username: string;
  action: string | null;
  new_status: IncidentStatus | null;
  note: string | null;
  created_at: string;
};

// Brouillon de signalement saisi côté client (sans les champs fixés serveur : id/auteur/timestamps).
export type IncidentDraft = {
  exploitation_date: string;
  type: string;
  niveau: string;
  lieu?: string | null;
  personne_concernee?: string | null;
  description: string;
  event_id?: string | null;
};

// ————————————————————————————————————————————————————————————————
// Gardes de type (vocabulaires fermés)
// ————————————————————————————————————————————————————————————————

export function isIncidentType(value: string): value is IncidentType {
  return (INCIDENT_TYPES as readonly string[]).includes(value);
}
export function isIncidentLevel(value: string): value is IncidentLevel {
  return (INCIDENT_LEVELS as readonly string[]).includes(value);
}
export function isIncidentStatus(value: string): value is IncidentStatus {
  return (INCIDENT_STATUSES as readonly string[]).includes(value);
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — matrice A6 (CLUB_ONE_OS_MASTER §4.2)
//   Direction/Patronat ✅ · Manager ✅➕ · Serveur ➕(signaler) · Sécurité ✅➕ ·
//   Compteur ➕(signaler) · Promoteur ⛔ · Artiste ⛔
// La RLS 0023 reste l'AUTORITÉ ; ces helpers ne font que refléter la même règle côté UI.
// ————————————————————————————————————————————————————————————————

// Peut OUVRIR (signaler) un incident : direction, sécurité, serveur, compteur. Pas le promoteur.
export function canReportIncident(role: StaffRole): boolean {
  return (
    role === "admin" ||
    role === "manager" ||
    role === "security" ||
    role === "server" ||
    role === "security_counter"
  );
}

// Peut MUTER (statut, escalade, suivi) : direction + sécurité (« ✅➕ »). Serveur/compteur = signaler seul.
export function canManageIncidents(role: StaffRole): boolean {
  return role === "admin" || role === "manager" || role === "security";
}

// Lit TOUS les incidents (supervision, rapport post-soirée) : direction + sécurité.
export function canViewAllIncidents(role: StaffRole): boolean {
  return role === "admin" || role === "manager" || role === "security";
}

// A une raison d'ouvrir l'onglet Incidents (lecture globale OU au moins signaler + relire les siens).
export function canAccessIncidents(role: StaffRole): boolean {
  return canReportIncident(role) || canViewAllIncidents(role);
}

// Visibilité d'UNE ligne, miroir exact du prédicat RLS incidents_read : direction/sécurité voient
// tout ; les autres ne voient QUE leurs propres signalements. Filtrer une liste vide → liste vide.
export function canViewIncident(
  role: StaffRole,
  incident: Pick<Incident, "auteur_username">,
  username: string,
): boolean {
  if (canViewAllIncidents(role)) return true;
  return incident.auteur_username === username;
}

// Restreint une liste déjà chargée au périmètre visible du rôle (défense en profondeur côté client ;
// la RLS a déjà filtré côté base). PURE : ne fabrique jamais de ligne.
export function visibleIncidents(
  incidents: readonly Incident[],
  role: StaffRole,
  username: string,
): Incident[] {
  return incidents.filter((incident) => canViewIncident(role, incident, username));
}

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon de signalement (avant insert)
// ————————————————————————————————————————————————————————————————

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DraftValidation = { ok: boolean; errors: string[] };

export function validateIncidentDraft(draft: IncidentDraft): DraftValidation {
  const errors: string[] = [];
  if (!ISO_DATE.test(draft.exploitation_date)) {
    errors.push("date de soirée invalide (attendu AAAA-MM-JJ)");
  }
  if (!isIncidentType(draft.type)) {
    errors.push("type d'incident inconnu");
  }
  if (!isIncidentLevel(draft.niveau)) {
    errors.push("niveau de gravité inconnu");
  }
  if (draft.description.trim().length === 0) {
    errors.push("description requise");
  }
  return { ok: errors.length === 0, errors };
}

// ————————————————————————————————————————————————————————————————
// Workflow de statut (transitions autorisées — trace, la base reste juge)
// ————————————————————————————————————————————————————————————————

const TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  ouvert: ["en_cours", "escalade", "resolu", "clos"],
  en_cours: ["escalade", "resolu", "clos"],
  escalade: ["en_cours", "resolu", "clos"],
  resolu: ["clos", "en_cours"], // réouverture possible si résolution insuffisante
  clos: [], // terminal
};

export function nextStatuses(status: IncidentStatus): IncidentStatus[] {
  return [...TRANSITIONS[status]];
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isActiveStatus(status: IncidentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

// ————————————————————————————————————————————————————————————————
// Tri de priorité : d'abord les actifs, puis par gravité décroissante, puis le plus récent.
// ————————————————————————————————————————————————————————————————

function levelRank(level: IncidentLevel): number {
  return INCIDENT_LEVELS.indexOf(level); // mineur=0 … critique=3
}

export function sortByPriority(incidents: readonly Incident[]): Incident[] {
  return [...incidents].sort((a, b) => {
    const activeA = isActiveStatus(a.status) ? 1 : 0;
    const activeB = isActiveStatus(b.status) ? 1 : 0;
    if (activeA !== activeB) return activeB - activeA; // actifs d'abord
    const rank = levelRank(b.niveau) - levelRank(a.niveau); // gravité décroissante
    if (rank !== 0) return rank;
    // plus récent d'abord (comparaison de chaînes ISO, aucun new Date() → aucun décalage de fuseau)
    if (a.created_at === b.created_at) return 0;
    return a.created_at < b.created_at ? 1 : -1;
  });
}

// ————————————————————————————————————————————————————————————————
// Agrégat pour le rapport post-soirée (états vides HONNÊTES : liste vide → zéros)
// ————————————————————————————————————————————————————————————————

export type IncidentSummary = {
  total: number;
  actifs: number; // ouvert + en_cours + escalade
  escalades: number;
  resolus: number; // resolu + clos
  parNiveau: Record<IncidentLevel, number>;
  parType: Record<IncidentType, number>;
  parStatus: Record<IncidentStatus, number>;
};

function zeroByLevel(): Record<IncidentLevel, number> {
  return INCIDENT_LEVELS.reduce(
    (acc, l) => ({ ...acc, [l]: 0 }),
    {} as Record<IncidentLevel, number>,
  );
}
function zeroByType(): Record<IncidentType, number> {
  return INCIDENT_TYPES.reduce(
    (acc, t) => ({ ...acc, [t]: 0 }),
    {} as Record<IncidentType, number>,
  );
}
function zeroByStatus(): Record<IncidentStatus, number> {
  return INCIDENT_STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<IncidentStatus, number>,
  );
}

export function summarizeIncidents(incidents: readonly Incident[]): IncidentSummary {
  const parNiveau = zeroByLevel();
  const parType = zeroByType();
  const parStatus = zeroByStatus();
  let actifs = 0;
  let escalades = 0;
  let resolus = 0;

  for (const inc of incidents) {
    parNiveau[inc.niveau] += 1;
    parType[inc.type] += 1;
    parStatus[inc.status] += 1;
    if (isActiveStatus(inc.status)) actifs += 1;
    else resolus += 1;
    if (inc.escalade) escalades += 1;
  }

  return {
    total: incidents.length,
    actifs,
    escalades,
    resolus,
    parNiveau,
    parType,
    parStatus,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes (aucun fuseau/locale runtime)
// ————————————————————————————————————————————————————————————————

const TYPE_LABELS: Record<IncidentType, string> = {
  altercation: "Altercation",
  refus_entree: "Refus d'entrée",
  malaise: "Malaise",
  vol: "Vol",
  degradation: "Dégradation",
  securite: "Sécurité",
  technique: "Technique",
  autre: "Autre",
};
const LEVEL_LABELS: Record<IncidentLevel, string> = {
  mineur: "Mineur",
  moyen: "Moyen",
  grave: "Grave",
  critique: "Critique",
};
const STATUS_LABELS: Record<IncidentStatus, string> = {
  ouvert: "Ouvert",
  en_cours: "En cours",
  escalade: "Escaladé",
  resolu: "Résolu",
  clos: "Clos",
};

export function incidentTypeLabel(type: IncidentType): string {
  return TYPE_LABELS[type];
}
export function incidentLevelLabel(level: IncidentLevel): string {
  return LEVEL_LABELS[level];
}
export function incidentStatusLabel(status: IncidentStatus): string {
  return STATUS_LABELS[status];
}
