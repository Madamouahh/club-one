// lib/commandCenter.ts — logique PURE du CENTRE DE COMMANDEMENT (B1), aucun accès réseau.
//
// B1 est l'ÉCRAN DIRECTION du plan maître (CLUB_ONE_OS_MASTER §2, ligne « B1. CENTRE DE
// COMMANDEMENT »). Il n'a PAS de table à lui : il AGRÈGE les signaux déjà produits par les
// autres modules (incidents A6, remplissage tables A2, présence RH B7, résa en attente B10,
// captation A10, checklists A9, CA soirée B8…) en une vue de pilotage unique pour la direction.
//
// Deux principes DURS, hérités de la gouvernance Club One :
//   1. HONNÊTETÉ DE COUVERTURE. Beaucoup de sources listées au plan maître pour B1 (campagnes,
//      avis, leads, contrats, reco IA, agents, météo, prévision…) N'EXISTENT PAS encore comme
//      module branché. Elles ne rendent JAMAIS un faux zéro : elles rendent le statut
//      « non branché » explicite. Une tuile vide honnête, jamais une donnée fabriquée.
//   2. AUCUN RECALCUL. Ce module ne ré-implémente aucune règle d'un autre module : il reçoit des
//      signaux compacts déjà calculés par les fonctions de production (ex. summarizeIncidents,
//      resaQueueSummary) et se contente de les classer/agréger. Un seul intégrateur, périmètres
//      disjoints (rule 30). Le réseau/RLS reste dans app/page.tsx.
//
// PURETÉ : aucun new Date()/Date.now() — tout est déterminé par les entrées.

import type { StaffRole } from "./permissions.ts";
import type { Venue } from "./venueTables.ts";

// ————————————————————————————————————————————————————————————————
// Garde de rôle — B1 = écran DIRECTION (CLUB_ONE_OS_MASTER §2/§3.1 « B1 … Direction »)
// ————————————————————————————————————————————————————————————————
//
// Miroir de la strate « directionnel » de la chaîne de commandement : admin + manager, le même
// palier direction qui voit déjà le board RH (canViewTab "rh") et le P&L. Les employés de soirée
// (serveur, sécurité, compteur) et le promoteur n'ouvrent JAMAIS le centre de commandement.
// Ce n'est PAS une sécurité en soi (B1 ne lit aucune table propre) : chaque source reste protégée
// par sa propre RLS ; ce prédicat ne fait que refléter le périmètre direction côté UI.
export function canViewCommandCenter(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// Sévérité d'une tuile
// ————————————————————————————————————————————————————————————————
//
//   ok            — branché, rien qui demande une action
//   attention     — branché, un point à traiter (ex. résa en attente, incident actif)
//   critique      — branché, un point BLOQUANT (ex. incident escaladé/critique actif)
//   vide          — branché mais aucune donnée cette soirée (0 honnête, pas « non branché »)
//   non_connecte  — module PAS encore branché : ni donnée, ni zéro — statut assumé
export const CC_SEVERITIES = [
  "critique",
  "attention",
  "ok",
  "vide",
  "non_connecte",
] as const;
export type CommandCenterSeverity = (typeof CC_SEVERITIES)[number];

// Rang de gravité pour l'agrégat global (plus haut = plus grave).
const SEVERITY_RANK: Record<CommandCenterSeverity, number> = {
  critique: 4,
  attention: 3,
  ok: 2,
  vide: 1,
  non_connecte: 0,
};

// ————————————————————————————————————————————————————————————————
// Domaines agrégés — liste ORDONNÉE, miroir de l'énumération B1 du plan maître.
// Un domaine sans lib branchée reste dans la liste : il rend « non branché » honnête.
// ————————————————————————————————————————————————————————————————
export const CC_DOMAINS = [
  "incidents",
  "remplissage",
  "presence_staff",
  "resa_en_attente",
  "captation",
  "checklists",
  "ca_soiree",
  "evenements_a_venir",
  "validations_attente",
  "leads_chauds",
  "avis_a_traiter",
  "campagnes",
  "contrats_incomplets",
  "contenus_a_produire",
  "objectifs",
  "reco_ia",
  "activite_agents",
  "automatisations_erreur",
  "meteo_eden",
  "prevision_frequentation",
] as const;
export type CommandCenterDomain = (typeof CC_DOMAINS)[number];

const DOMAIN_TITLES: Record<CommandCenterDomain, string> = {
  incidents: "Incidents",
  remplissage: "Remplissage tables",
  presence_staff: "Présence équipe",
  resa_en_attente: "Résas en attente",
  captation: "Captation",
  checklists: "Checklists",
  ca_soiree: "CA soirée",
  evenements_a_venir: "Événements à venir",
  validations_attente: "Validations en attente",
  leads_chauds: "Leads chauds",
  avis_a_traiter: "Avis à traiter",
  campagnes: "Campagnes",
  contrats_incomplets: "Contrats incomplets",
  contenus_a_produire: "Contenus à produire",
  objectifs: "Objectifs",
  reco_ia: "Recommandations IA",
  activite_agents: "Activité agents",
  automatisations_erreur: "Automatisations en erreur",
  meteo_eden: "Météo Eden",
  prevision_frequentation: "Prévision fréquentation",
};

export function commandCenterDomainTitle(domain: CommandCenterDomain): string {
  return DOMAIN_TITLES[domain];
}

// ————————————————————————————————————————————————————————————————
// Signaux d'entrée — chacun OPTIONNEL. Absent/null ⇒ domaine « non branché » honnête.
// Les signaux sont des agrégats COMPACTS déjà calculés par les modules de production ; B1 ne
// recalcule rien, il reçoit des nombres et les classe.
// ————————————————————————————————————————————————————————————————

export type IncidentsSignal = {
  actifs: number;
  escalades: number;
  critiquesActifs: number; // incidents de niveau « critique » encore actifs
};
export type RemplissageSignal = { occupees: number; total: number };
export type PresenceSignal = {
  presents: number;
  attendus: number;
  coutComplet: boolean; // honnêteté RH : un taux/heure manque ⇒ coût partiel
};
export type ResaSignal = { pending: number };
export type CaptationSignal = { aFaire: number; total: number };
export type ChecklistsSignal = { ouverts: number; total: number };
export type CaSignal = { montantCents: number; complet: boolean };

export type CommandCenterInput = {
  // Contexte de soirée. null ⇒ aucune soirée active : le cockpit est en veille (honnête).
  activeEvent: { label: string; date: string; venue: Venue } | null;
  // Signaux des modules branchés (undefined/null ⇒ non branché) :
  incidents?: IncidentsSignal | null;
  remplissage?: RemplissageSignal | null;
  presence?: PresenceSignal | null;
  resa?: ResaSignal | null;
  captation?: CaptationSignal | null;
  checklists?: ChecklistsSignal | null;
  ca?: CaSignal | null;
};

// ————————————————————————————————————————————————————————————————
// Tuile de sortie
// ————————————————————————————————————————————————————————————————
export type CommandCenterTile = {
  key: CommandCenterDomain;
  title: string;
  connected: boolean;
  severity: CommandCenterSeverity;
  headline: string; // résumé chiffré principal
  detail: string | null; // précision (honnêteté de complétude, motif d'attention)
};

const NOT_CONNECTED_TILE = (key: CommandCenterDomain): CommandCenterTile => ({
  key,
  title: DOMAIN_TITLES[key],
  connected: false,
  severity: "non_connecte",
  headline: "Module non branché",
  detail: "Aucune donnée : ce module n'est pas encore relié au centre de commandement.",
});

// ————————————————————————————————————————————————————————————————
// Classement par domaine (chaque fonction reçoit un signal DÉJÀ calculé)
// ————————————————————————————————————————————————————————————————

function tileIncidents(s: IncidentsSignal): CommandCenterTile {
  let severity: CommandCenterSeverity;
  if (s.critiquesActifs > 0 || s.escalades > 0) severity = "critique";
  else if (s.actifs > 0) severity = "attention";
  else severity = "ok";
  const detail =
    s.escalades > 0
      ? `${s.escalades} escaladé(s)`
      : s.critiquesActifs > 0
        ? `${s.critiquesActifs} critique(s) actif(s)`
        : s.actifs > 0
          ? "à suivre"
          : "aucun incident actif";
  return {
    key: "incidents",
    title: DOMAIN_TITLES.incidents,
    connected: true,
    severity,
    headline: `${s.actifs} actif(s)`,
    detail,
  };
}

function tileRemplissage(s: RemplissageSignal): CommandCenterTile {
  if (s.total <= 0) {
    return {
      key: "remplissage",
      title: DOMAIN_TITLES.remplissage,
      connected: true,
      severity: "vide",
      headline: "Aucune table",
      detail: "Aucune table active pour cette soirée.",
    };
  }
  const complet = s.occupees >= s.total;
  const pct = Math.round((s.occupees / s.total) * 100);
  return {
    key: "remplissage",
    title: DOMAIN_TITLES.remplissage,
    connected: true,
    severity: complet ? "attention" : "ok",
    headline: `${s.occupees}/${s.total} (${pct} %)`,
    detail: complet ? "salle complète — proche de la capacité" : null,
  };
}

function tilePresence(s: PresenceSignal): CommandCenterTile {
  if (s.attendus <= 0) {
    return {
      key: "presence_staff",
      title: DOMAIN_TITLES.presence_staff,
      connected: true,
      severity: "vide",
      headline: "Aucun créneau",
      detail: "Aucun créneau planifié pour cette soirée.",
    };
  }
  const manque = s.presents < s.attendus;
  const detailParts: string[] = [];
  if (manque) detailParts.push(`${s.attendus - s.presents} attendu(s) non pointé(s)`);
  if (!s.coutComplet) detailParts.push("coût staff partiel (un taux/heure manque)");
  return {
    key: "presence_staff",
    title: DOMAIN_TITLES.presence_staff,
    connected: true,
    severity: manque ? "attention" : "ok",
    headline: `${s.presents}/${s.attendus} présent(s)`,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
  };
}

function tileResa(s: ResaSignal): CommandCenterTile {
  return {
    key: "resa_en_attente",
    title: DOMAIN_TITLES.resa_en_attente,
    connected: true,
    severity: s.pending > 0 ? "attention" : "ok",
    headline: `${s.pending} en attente`,
    detail: s.pending > 0 ? "demandes client à valider" : "aucune demande à traiter",
  };
}

function tileCaptation(s: CaptationSignal): CommandCenterTile {
  if (s.total <= 0) {
    return {
      key: "captation",
      title: DOMAIN_TITLES.captation,
      connected: true,
      severity: "vide",
      headline: "Aucun plan",
      detail: "Aucune prise de vue planifiée.",
    };
  }
  return {
    key: "captation",
    title: DOMAIN_TITLES.captation,
    connected: true,
    severity: s.aFaire > 0 ? "attention" : "ok",
    headline: `${s.aFaire}/${s.total} à faire`,
    detail: s.aFaire > 0 ? "prises de vue restantes" : "tout est capté",
  };
}

function tileChecklists(s: ChecklistsSignal): CommandCenterTile {
  if (s.total <= 0) {
    return {
      key: "checklists",
      title: DOMAIN_TITLES.checklists,
      connected: true,
      severity: "vide",
      headline: "Aucune tâche",
      detail: "Aucune checklist active.",
    };
  }
  return {
    key: "checklists",
    title: DOMAIN_TITLES.checklists,
    connected: true,
    severity: s.ouverts > 0 ? "attention" : "ok",
    headline: `${s.ouverts}/${s.total} ouverte(s)`,
    detail: s.ouverts > 0 ? "tâches non cochées" : "tout est fait",
  };
}

function tileCa(s: CaSignal): CommandCenterTile {
  const euros = (s.montantCents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (s.montantCents <= 0) {
    return {
      key: "ca_soiree",
      title: DOMAIN_TITLES.ca_soiree,
      connected: true,
      severity: "vide",
      headline: "0,00 €",
      detail: s.complet ? "aucune vente saisie" : "montant partiel (saisie en cours)",
    };
  }
  return {
    key: "ca_soiree",
    title: DOMAIN_TITLES.ca_soiree,
    connected: true,
    severity: "ok",
    headline: `${euros} €`,
    detail: s.complet ? null : "montant PARTIEL — saisie du Z en cours",
  };
}

// ————————————————————————————————————————————————————————————————
// Agrégat global
// ————————————————————————————————————————————————————————————————
export type CommandCenterCoverage = {
  total: number; // nb de domaines listés (branchés + non branchés)
  connected: number; // nb de domaines réellement branchés cette session
  notConnected: number; // nb de domaines encore « non branché » (honnêteté de couverture)
};

export type CommandCenterView = {
  event: { label: string; date: string; venue: Venue } | null;
  tiles: CommandCenterTile[]; // dans l'ordre de CC_DOMAINS
  coverage: CommandCenterCoverage;
  // Pire sévérité parmi les tuiles BRANCHÉES (les non_connecte ne comptent pas comme une alerte).
  overall: CommandCenterSeverity;
  attentionCount: number; // nb de tuiles branchées en « attention »
  critiqueCount: number; // nb de tuiles branchées en « critique »
};

// Construit un domaine à partir de son signal, ou rend la tuile « non branché » si absent.
function buildTile<T>(
  key: CommandCenterDomain,
  signal: T | null | undefined,
  make: (s: T) => CommandCenterTile,
): CommandCenterTile {
  if (signal === null || signal === undefined) return NOT_CONNECTED_TILE(key);
  return make(signal);
}

export function buildCommandCenter(input: CommandCenterInput): CommandCenterView {
  // Domaines branchés (une lib de production existe et un signal est fourni)…
  const wired: Partial<Record<CommandCenterDomain, CommandCenterTile>> = {
    incidents: buildTile("incidents", input.incidents, tileIncidents),
    remplissage: buildTile("remplissage", input.remplissage, tileRemplissage),
    presence_staff: buildTile("presence_staff", input.presence, tilePresence),
    resa_en_attente: buildTile("resa_en_attente", input.resa, tileResa),
    captation: buildTile("captation", input.captation, tileCaptation),
    checklists: buildTile("checklists", input.checklists, tileChecklists),
    ca_soiree: buildTile("ca_soiree", input.ca, tileCa),
  };

  // …assemblés dans l'ordre canonique ; tout domaine sans entrée reste « non branché ».
  const tiles: CommandCenterTile[] = CC_DOMAINS.map(
    (key) => wired[key] ?? NOT_CONNECTED_TILE(key),
  );

  const connected = tiles.filter((t) => t.connected).length;
  const attentionCount = tiles.filter((t) => t.connected && t.severity === "attention").length;
  const critiqueCount = tiles.filter((t) => t.connected && t.severity === "critique").length;

  // overall = pire sévérité parmi les tuiles branchées uniquement (un module non branché
  // n'est pas une alerte : c'est une lacune de couverture, comptée à part).
  let overall: CommandCenterSeverity = "non_connecte";
  for (const t of tiles) {
    if (!t.connected) continue;
    if (SEVERITY_RANK[t.severity] > SEVERITY_RANK[overall] || overall === "non_connecte") {
      overall = t.severity;
    }
  }

  return {
    event: input.activeEvent,
    tiles,
    coverage: {
      total: tiles.length,
      connected,
      notConnected: tiles.length - connected,
    },
    overall,
    attentionCount,
    critiqueCount,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes
// ————————————————————————————————————————————————————————————————
const SEVERITY_LABELS: Record<CommandCenterSeverity, string> = {
  critique: "Critique",
  attention: "À traiter",
  ok: "OK",
  vide: "Vide",
  non_connecte: "Non branché",
};

export function commandCenterSeverityLabel(severity: CommandCenterSeverity): string {
  return SEVERITY_LABELS[severity];
}
