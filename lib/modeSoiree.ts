// lib/modeSoiree.ts — logique PURE du cockpit « Mode Soirée » (A1), aucun accès réseau.
//
// A1 n'est PAS un nouveau module de données : c'est une VUE D'AGRÉGATION temps réel des modules
// d'exploitation déjà construits (A6 incidents · A7 comm interne · A8 artiste · A9 checklists).
//   · zéro table nouvelle, zéro migration : le cockpit ne fait que composer les résumés existants ;
//   · chaque panneau est cadré par la garde de rôle DE SON module (miroir des RLS 0023/0026/0027/0028) —
//     un rôle qui n'a pas accès à un module ne voit pas son panneau (panneau = null) ;
//   · le cockpit lui-même est refusé au promoteur (matrice §4.2 : Mode Soirée = ⛔ promoteur) ;
//   · il dérive un fil d'alertes déterministe (sévérité info/attention/critique) et un niveau global
//     (calme/vigilance/tension) UNIQUEMENT à partir des données réelles reçues ;
//   · états vides HONNÊTES partout : aucune donnée → des zéros et « calme », jamais une alerte fabriquée.
// Aucune donnée n'est inventée : buildCockpit ne lit que ce que app/page.tsx lui passe (déjà filtré RLS).

import type { StaffRole } from "./permissions.ts";
import {
  canAccessIncidents,
  isActiveStatus,
  summarizeIncidents,
  visibleIncidents,
  type Incident,
  type IncidentSummary,
} from "./incidents.ts";
import {
  canAccessInternalComm,
  summarizeFeed,
  type CommSummary,
  type InternalMessage,
  type MessageRead,
} from "./internalComms.ts";
import {
  canViewArtistCheckin,
  summarizeCheckins,
  type ArtistCheckin,
  type CheckinSummary,
} from "./artistCheckin.ts";
import {
  canViewChecklists,
  progressByPhase,
  summarizeChecklist,
  type ChecklistLine,
  type ChecklistSummary,
  type PhaseProgress,
} from "./checklists.ts";

// ————————————————————————————————————————————————————————————————
// Garde de rôle du cockpit — matrice §4.2 « Mode Soirée (A1) »
//   Direction ✅ · Manager ✅ · Serveur 👁 · Sécurité 👁 · Compteur 👁 · Promoteur ⛔
// (Le rôle d'auth « artiste » n'existe pas encore dans StaffRole : accès artiste DIFFÉRÉ, non fabriqué.)
// ————————————————————————————————————————————————————————————————

export const MODE_SOIREE_ROLES = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
] as const satisfies readonly StaffRole[];

// Peut ouvrir le cockpit (au moins en lecture). Promoteur ⛔ (aucun métier de soirée temps réel).
export function canViewModeSoiree(role: StaffRole): boolean {
  return (MODE_SOIREE_ROLES as readonly string[]).includes(role);
}

// ————————————————————————————————————————————————————————————————
// Sévérité & niveau global (vocabulaires fermés)
// ————————————————————————————————————————————————————————————————

export const COCKPIT_SEVERITIES = ["info", "attention", "critique"] as const;
export type CockpitSeverity = (typeof COCKPIT_SEVERITIES)[number];

const SEVERITY_RANK: Record<CockpitSeverity, number> = {
  info: 1,
  attention: 2,
  critique: 3,
};

export const COCKPIT_LEVELS = ["calme", "vigilance", "tension"] as const;
export type CockpitLevel = (typeof COCKPIT_LEVELS)[number];

export type CockpitSource = "incident" | "comm" | "artiste" | "checklist";

export type CockpitAlert = {
  source: CockpitSource;
  severity: CockpitSeverity;
  code: string;
  label: string; // libellé FR déterministe, dérivé du compte réel
  count: number;
};

// ————————————————————————————————————————————————————————————————
// Panneaux — un panneau est null si le rôle n'a pas accès au module (miroir RLS)
// ————————————————————————————————————————————————————————————————

export type ChecklistPanel = {
  summary: ChecklistSummary;
  parPhase: PhaseProgress[];
};

export type CockpitPanels = {
  incidents: IncidentSummary | null; // A6 — canAccessIncidents
  comms: CommSummary | null; // A7 — canAccessInternalComm
  artists: CheckinSummary | null; // A8 — canViewArtistCheckin (admin/manager/sécurité)
  checklist: ChecklistPanel | null; // A9 — canViewChecklists
};

export type Cockpit = {
  role: StaffRole;
  accessible: boolean; // canViewModeSoiree (false = promoteur → tout vide)
  panels: CockpitPanels;
  alerts: CockpitAlert[]; // triées sévérité décroissante, ordre source déterministe à sévérité égale
  level: CockpitLevel; // niveau global dérivé des alertes
  tachesOuvertes: number; // total de choses en attente d'action (agrégat, jamais négatif)
  isEmpty: boolean; // aucun élément dans aucun panneau accessible
};

// Entrées : ce que app/page.tsx a déjà chargé (et que la RLS a déjà filtré côté base).
export type CockpitInput = {
  role: StaffRole;
  username: string;
  incidents?: readonly Incident[];
  messages?: readonly InternalMessage[];
  reads?: readonly MessageRead[];
  checkins?: readonly ArtistCheckin[];
  checklistLines?: readonly ChecklistLine[];
};

// ————————————————————————————————————————————————————————————————
// Construction du cockpit
// ————————————————————————————————————————————————————————————————

const EMPTY_PANELS: CockpitPanels = {
  incidents: null,
  comms: null,
  artists: null,
  checklist: null,
};

function checklistRemaining(parPhase: readonly PhaseProgress[], phase: "ouverture" | "fermeture"): number {
  const p = parPhase.find((x) => x.phase === phase);
  if (!p) return 0;
  return p.total - p.done;
}

export function buildCockpit(input: CockpitInput): Cockpit {
  const { role, username } = input;

  // Promoteur (ou tout rôle hors matrice) : cockpit entièrement fermé, aucun panneau, niveau calme.
  if (!canViewModeSoiree(role)) {
    return {
      role,
      accessible: false,
      panels: EMPTY_PANELS,
      alerts: [],
      level: "calme",
      tachesOuvertes: 0,
      isEmpty: true,
    };
  }

  // — A6 incidents (cadré par visibleIncidents : direction/sécurité voient tout, les autres les leurs)
  const visInc = canAccessIncidents(role)
    ? visibleIncidents(input.incidents ?? [], role, username)
    : null;
  const incidents = visInc ? summarizeIncidents(visInc) : null;
  // incidents actifs de niveau grave/critique — calculé sur les lignes réelles (parNiveau du résumé
  // inclut aussi les incidents résolus, donc on ne s'en sert pas pour la sévérité « en cours »).
  const gravesActifs = visInc
    ? visInc.filter((i) => isActiveStatus(i.status) && (i.niveau === "grave" || i.niveau === "critique")).length
    : 0;

  // — A7 comm interne (summarizeFeed cadre déjà au périmètre visible du rôle)
  const comms = canAccessInternalComm(role)
    ? summarizeFeed(input.messages ?? [], input.reads ?? [], role, username)
    : null;

  // — A8 artiste (admin/manager/sécurité uniquement)
  const artists = canViewArtistCheckin(role) ? summarizeCheckins(input.checkins ?? []) : null;

  // — A9 checklists (tous rôles opérationnels ; promoteur déjà exclu du cockpit)
  const lines = input.checklistLines ?? [];
  const checklist: ChecklistPanel | null = canViewChecklists(role)
    ? { summary: summarizeChecklist(lines), parPhase: progressByPhase(lines) }
    : null;

  const panels: CockpitPanels = { incidents, comms, artists, checklist };

  // — Fil d'alertes (ordre de construction : incident → comm → artiste → checklist ; tri stable ensuite)
  const alerts: CockpitAlert[] = [];

  if (incidents) {
    if (incidents.escalades > 0) {
      alerts.push({
        source: "incident",
        severity: "critique",
        code: "incident_escalade",
        count: incidents.escalades,
        label: `${incidents.escalades} incident${plural(incidents.escalades)} escaladé${plural(incidents.escalades)}`,
      });
    }
    if (gravesActifs > 0) {
      alerts.push({
        source: "incident",
        severity: "critique",
        code: "incident_grave_actif",
        count: gravesActifs,
        label: `${gravesActifs} incident${plural(gravesActifs)} grave${plural(gravesActifs)} en cours`,
      });
    }
    // incidents actifs restants (hors graves déjà signalés) → vigilance
    const autresActifs = incidents.actifs - gravesActifs;
    if (autresActifs > 0) {
      alerts.push({
        source: "incident",
        severity: "attention",
        code: "incident_actif",
        count: autresActifs,
        label: `${autresActifs} incident${plural(autresActifs)} en cours`,
      });
    }
  }

  if (comms) {
    if (comms.urgencesOuvertes > 0) {
      alerts.push({
        source: "comm",
        severity: "critique",
        code: "comm_urgence",
        count: comms.urgencesOuvertes,
        label: `${comms.urgencesOuvertes} urgence${plural(comms.urgencesOuvertes)} ouverte${plural(comms.urgencesOuvertes)}`,
      });
    }
    if (comms.tachesOuvertes > 0) {
      alerts.push({
        source: "comm",
        severity: "attention",
        code: "comm_tache",
        count: comms.tachesOuvertes,
        label: `${comms.tachesOuvertes} tâche${plural(comms.tachesOuvertes)} ouverte${plural(comms.tachesOuvertes)}`,
      });
    }
    if (comms.nonLus > 0) {
      alerts.push({
        source: "comm",
        severity: "info",
        code: "comm_nonlu",
        count: comms.nonLus,
        label: `${comms.nonLus} message${plural(comms.nonLus)} non lu${plural(comms.nonLus)}`,
      });
    }
  }

  if (artists) {
    if (artists.noShow > 0) {
      alerts.push({
        source: "artiste",
        severity: "attention",
        code: "artiste_noshow",
        count: artists.noShow,
        label: `${artists.noShow} artiste${plural(artists.noShow)} no-show`,
      });
    }
    if (artists.attendus > 0) {
      alerts.push({
        source: "artiste",
        severity: "info",
        code: "artiste_attendu",
        count: artists.attendus,
        label: `${artists.attendus} artiste${plural(artists.attendus)} attendu${plural(artists.attendus)}`,
      });
    }
  }

  if (checklist) {
    const restFermeture = checklistRemaining(checklist.parPhase, "fermeture");
    const restOuverture = checklistRemaining(checklist.parPhase, "ouverture");
    if (restFermeture > 0) {
      alerts.push({
        source: "checklist",
        severity: "attention",
        code: "checklist_fermeture",
        count: restFermeture,
        label: `${restFermeture} point${plural(restFermeture)} de fermeture à cocher`,
      });
    }
    if (restOuverture > 0) {
      alerts.push({
        source: "checklist",
        severity: "info",
        code: "checklist_ouverture",
        count: restOuverture,
        label: `${restOuverture} point${plural(restOuverture)} d'ouverture à cocher`,
      });
    }
  }

  // Tri stable par sévérité décroissante (à sévérité égale, l'ordre de construction — donc la priorité
  // source incident>comm>artiste>checklist — est conservé car Array.prototype.sort est stable).
  const sorted = [...alerts].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const level: CockpitLevel = sorted.some((a) => a.severity === "critique")
    ? "tension"
    : sorted.some((a) => a.severity === "attention")
      ? "vigilance"
      : "calme";

  // Tâches immédiates = tout ce qui attend une action, sur le périmètre accessible.
  const tachesOuvertes =
    (comms ? comms.urgencesOuvertes + comms.tachesOuvertes : 0) +
    (incidents ? incidents.actifs : 0) +
    (checklist ? checklist.summary.remaining : 0);

  const isEmpty =
    (incidents?.total ?? 0) === 0 &&
    (comms?.total ?? 0) === 0 &&
    (artists?.total ?? 0) === 0 &&
    (checklist?.summary.total ?? 0) === 0;

  return {
    role,
    accessible: true,
    panels,
    alerts: sorted,
    level,
    tachesOuvertes,
    isEmpty,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes (aucun fuseau/locale runtime)
// ————————————————————————————————————————————————————————————————

// Marque du pluriel français simple (« s » au-delà de 1). Déterministe, sans locale.
function plural(n: number): string {
  return n > 1 ? "s" : "";
}

const SEVERITY_LABELS: Record<CockpitSeverity, string> = {
  info: "Information",
  attention: "Attention",
  critique: "Critique",
};

const LEVEL_LABELS: Record<CockpitLevel, string> = {
  calme: "Calme",
  vigilance: "Vigilance",
  tension: "Tension",
};

const SOURCE_LABELS: Record<CockpitSource, string> = {
  incident: "Incidents",
  comm: "Communication",
  artiste: "Artistes",
  checklist: "Checklists",
};

export function severityLabel(severity: CockpitSeverity): string {
  return SEVERITY_LABELS[severity];
}

export function levelLabel(level: CockpitLevel): string {
  return LEVEL_LABELS[level];
}

export function sourceLabel(source: CockpitSource): string {
  return SOURCE_LABELS[source];
}
