// lib/agentOrchestrator.ts — logique PURE de l'ORCHESTRATEUR D'AGENTS IA + REGISTRE D'AUTONOMIE (module 0.6, Socle).
// Aucun accès réseau, aucune horloge (new Date()/Date.now() interdits — tout vient des entrées).
//
// 0.6 (CLUB_ONE_OS_MASTER §3.1 « Orchestrateur agents IA (autonomie 0→4) · Socle · Direction · P2 » ;
// arbre §"Orchestrateur d'agents IA + registre d'autonomie (0→4)") répond à une question de gouvernance :
// pour CHAQUE agent IA, quel niveau d'autonomie est RÉELLEMENT actif, et la direction garde-t-elle la main
// (interrupteur par agent + ARRÊT GLOBAL) ? Il ne parle jamais à Supabase ni à aucun worker : il REÇOIT un
// registre d'agents (lignes d'une future table) + les réglages globaux, et se contente de CLAMPER, agréger
// et présenter.
//
// Règles dures (honnêteté), héritées de la gouvernance Club One :
//   · Le module SHIP VIDE. Club One n'a AUCUN agent IA en production aujourd'hui : le registre par défaut
//     est vide (« cadre de gouvernance prêt à recevoir des agents »). AUCUN agent n'est inventé ici — les
//     agents sont des ENTRÉES. La démonstration (route d'aperçu) fournit des agents fictifs étiquetés.
//   · Le moteur ne CHOISIT jamais le niveau d'un agent : la direction le configure (entrée). Le moteur ne
//     fait que le BORNER vers le bas. Un plafond ne peut JAMAIS relever un niveau, seulement l'abaisser.
//   · Chaque capacité a un PLAFOND d'autonomie qui encode une règle DURE déjà existante du projet — ce
//     n'est pas une invention de politique, c'est la traduction de contraintes déjà écrites :
//       - client_messaging → plafond 2 (brouillon) : Loi Evin + « AUCUNE fonction d'envoi automatisé »
//         (seuls des liens wa.me qu'un humain clique). Un agent ne peut JAMAIS auto-envoyer à un client.
//       - prod_mutation → plafond 1 (suggestion) : aucune écriture prod / clôture / migration autonome
//         (règles absolues CLAUDE.md : jamais de migration/close sans GO, jamais d'écriture prod devinée).
//       - pii_processing → plafond 2 : PII client sous consentement, RLS pas encore en cutover final.
//       - content_classification → plafond 3 : étiquetage/routage réversible, sous veto humain.
//       - internal_insight → plafond 4 : lecture seule + rapport à la direction → autonomie bornée admise.
//   · L'ARRÊT GLOBAL (kill-switch) force le niveau EFFECTIF de TOUS les agents à 0, quel que soit leur
//     réglage. C'est le gros bouton rouge honnête ; il ne « suggère » rien, il coupe.
//   · La garde de rôle (direction seule) est un confort d'UI, PAS une sécurité : l'autorité d'exécution
//     réelle reste côté serveur (RLS + workers + RPC). Ce module ne mute rien.
//   · L'observabilité (coût IA, santé workers, files/retry/dead-letter) est une ENTRÉE optionnelle. Sans
//     télémétrie fournie, la vue l'affiche honnêtement « non disponible » — jamais un chiffre fabriqué.

import { type StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Échelle d'autonomie 0→4 — cadre de référence documenté (architecture, pas donnée fondateur).
// ————————————————————————————————————————————————————————————————
export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export function isAutonomyLevel(n: unknown): n is AutonomyLevel {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 4;
}

// Borne une valeur quelconque dans l'échelle [0..4] sans jamais la relever au-dessus de 4 ni sous 0.
export function clampAutonomy(n: number): AutonomyLevel {
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  if (i <= 0) return 0;
  if (i >= 4) return 4;
  return i as AutonomyLevel;
}

const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  0: "Désactivé",
  1: "Observation",
  2: "Brouillon",
  3: "Supervisé",
  4: "Autonome borné",
};

// Ce que l'humain fait / ce que l'agent fait, à chaque barreau — non négociable, sert de légende partout.
const AUTONOMY_DESCRIPTIONS: Record<AutonomyLevel, string> = {
  0: "L'agent ne fait rien. 100 % humain.",
  1: "L'agent lit et propose ; il n'exécute aucune action. L'humain fait tout.",
  2: "L'agent prépare un brouillon ; l'humain valide CHAQUE action avant exécution.",
  3: "L'agent agit puis notifie, avec fenêtre de veto/annulation ; l'humain peut arrêter.",
  4: "L'agent agit seul dans des limites définies ; l'humain audite a posteriori.",
};

export function autonomyLabel(level: AutonomyLevel): string {
  return AUTONOMY_LABELS[level];
}

export function autonomyDescription(level: AutonomyLevel): string {
  return AUTONOMY_DESCRIPTIONS[level];
}

// ————————————————————————————————————————————————————————————————
// Capacités d'agent + PLAFONDS d'autonomie (encodage de règles DURES existantes, jamais une invention)
// ————————————————————————————————————————————————————————————————
export const AGENT_CAPABILITIES = [
  "internal_insight",
  "content_classification",
  "pii_processing",
  "client_messaging",
  "prod_mutation",
] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export function isAgentCapability(s: unknown): s is AgentCapability {
  return typeof s === "string" && (AGENT_CAPABILITIES as readonly string[]).includes(s);
}

// Plafond d'autonomie par capacité. Chaque valeur TRADUIT une règle déjà écrite (voir en-tête). Le moteur
// ne dépasse JAMAIS ce plafond, quel que soit le niveau configuré par la direction.
export const CAPABILITY_CEILING: Record<AgentCapability, AutonomyLevel> = {
  internal_insight: 4, // lecture seule + rapport direction → autonomie bornée admise
  content_classification: 3, // étiquetage/routage réversible sous veto humain
  pii_processing: 2, // PII client : brouillon + validation humaine (consentement ; RLS pas en cutover final)
  client_messaging: 2, // Loi Evin + AUCUN envoi automatisé : brouillon MAX, l'humain clique le lien wa.me
  prod_mutation: 1, // écriture prod / clôture / migration : suggestion SEULE, jamais autonome
};

const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  internal_insight: "Analyse interne (lecture seule)",
  content_classification: "Classification / routage de contenu",
  pii_processing: "Traitement de données client (PII)",
  client_messaging: "Message vers un client",
  prod_mutation: "Écriture en base / clôture / migration",
};

// Raison DURE du plafond — affichée telle quelle, sert de justification non devinée.
const CEILING_REASONS: Record<AgentCapability, string> = {
  internal_insight: "Lecture seule et rapport à la direction : autonomie bornée admise jusqu'au niveau 4.",
  content_classification: "Étiquetage/routage réversible : autonomie supervisée (veto humain) jusqu'au niveau 3.",
  pii_processing: "Données client sous consentement, RLS pas encore en cutover final : brouillon validé humainement (niveau 2 max).",
  client_messaging: "Loi Evin + aucun envoi automatisé (liens wa.me cliqués par un humain) : brouillon uniquement (niveau 2 max).",
  prod_mutation: "Aucune écriture prod / clôture / migration autonome (règles absolues) : suggestion seule (niveau 1 max).",
};

export function capabilityLabel(capability: AgentCapability): string {
  return CAPABILITY_LABELS[capability];
}

export function capabilityCeiling(capability: AgentCapability): AutonomyLevel {
  return CAPABILITY_CEILING[capability];
}

export function ceilingReason(capability: AgentCapability): string {
  return CEILING_REASONS[capability];
}

// Rang de risque pour le tri (plus haut = plus dangereux, remonte l'attention direction).
const CAPABILITY_RISK_RANK: Record<AgentCapability, number> = {
  prod_mutation: 5,
  client_messaging: 4,
  pii_processing: 3,
  content_classification: 2,
  internal_insight: 1,
};

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — direction seule (§3.1 « Direction »). NI l'une NI l'autre n'est une sécurité.
// ————————————————————————————————————————————————————————————————
export function canViewOrchestrator(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canManageOrchestrator(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// Registre d'agents (ENTRÉE : lignes d'une future table) + réglages globaux
// ————————————————————————————————————————————————————————————————
export type AgentDescriptor = {
  id: string;
  name: string;
  capability: AgentCapability;
  configuredLevel: AutonomyLevel; // choisi par la direction — le moteur ne le fixe jamais
  enabled: boolean; // interrupteur par agent
  description?: string | null; // note libre optionnelle
};

export type OrchestratorSettings = {
  killSwitchEngaged: boolean; // ARRÊT GLOBAL : force TOUT niveau effectif à 0
};

// ————————————————————————————————————————————————————————————————
// Résolution de gouvernance d'un agent — le niveau EFFECTIF ne dépasse jamais le configuré ni le plafond.
// ————————————————————————————————————————————————————————————————
export type AgentGovernance = AgentDescriptor & {
  ceiling: AutonomyLevel;
  ceilingReason: string;
  cappedByCeiling: boolean; // la direction a demandé PLUS que le plafond de la capacité
  disabledBySwitch: boolean; // interrupteur agent sur off
  haltedByKillSwitch: boolean; // arrêt global engagé
  effectiveLevel: AutonomyLevel; // min(configuré, plafond), puis forcé à 0 si off ou arrêt global
};

export function resolveAgentGovernance(
  agent: AgentDescriptor,
  settings: OrchestratorSettings,
): AgentGovernance {
  const configured = clampAutonomy(agent.configuredLevel);
  const ceiling = CAPABILITY_CEILING[agent.capability];
  const cappedByCeiling = configured > ceiling;
  const clampedToCeiling = Math.min(configured, ceiling) as AutonomyLevel;

  const disabledBySwitch = agent.enabled === false;
  const haltedByKillSwitch = settings.killSwitchEngaged === true;
  const effectiveLevel: AutonomyLevel =
    disabledBySwitch || haltedByKillSwitch ? 0 : clampedToCeiling;

  return {
    ...agent,
    configuredLevel: configured,
    ceiling,
    ceilingReason: CEILING_REASONS[agent.capability],
    cappedByCeiling,
    disabledBySwitch,
    haltedByKillSwitch,
    effectiveLevel,
  };
}

// Tri : agents plafonnés d'abord (attention direction), puis capacité la plus risquée, puis niveau effectif
// décroissant, puis nom (fr) et id — stable et déterministe.
function compareGovernance(a: AgentGovernance, b: AgentGovernance): number {
  if (a.cappedByCeiling !== b.cappedByCeiling) return a.cappedByCeiling ? -1 : 1;
  const ra = CAPABILITY_RISK_RANK[a.capability];
  const rb = CAPABILITY_RISK_RANK[b.capability];
  if (ra !== rb) return rb - ra;
  if (a.effectiveLevel !== b.effectiveLevel) return b.effectiveLevel - a.effectiveLevel;
  const byName = a.name.localeCompare(b.name, "fr");
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ————————————————————————————————————————————————————————————————
// Observabilité — ENTRÉE optionnelle. Absente ⇒ honnêtement « non disponible » (jamais un chiffre fabriqué).
// ————————————————————————————————————————————————————————————————
export type OrchestratorTelemetry = {
  aiCostCents: number | null;
  queuedJobs: number | null;
  retryJobs: number | null;
  deadLetterJobs: number | null;
  workersHealthy: boolean | null;
};

// ————————————————————————————————————————————————————————————————
// Posture globale — synthèse honnête de l'état de l'orchestrateur
// ————————————————————————————————————————————————————————————————
export const ORCHESTRATOR_POSTURES = [
  "halted", // arrêt global engagé
  "idle", // aucun agent enregistré, ou aucun agent au-dessus de 0
  "observe", // niveau effectif max = 1
  "draft", // niveau effectif max = 2
  "supervised", // niveau effectif max = 3
  "autonomous", // niveau effectif max = 4
] as const;
export type OrchestratorPosture = (typeof ORCHESTRATOR_POSTURES)[number];

const POSTURE_BY_LEVEL: Record<AutonomyLevel, OrchestratorPosture> = {
  0: "idle",
  1: "observe",
  2: "draft",
  3: "supervised",
  4: "autonomous",
};

const POSTURE_LABELS: Record<OrchestratorPosture, string> = {
  halted: "Arrêt global",
  idle: "Au repos",
  observe: "Observation",
  draft: "Brouillon",
  supervised: "Supervisé",
  autonomous: "Autonome borné",
};

export function postureLabel(posture: OrchestratorPosture): string {
  return POSTURE_LABELS[posture];
}

// ————————————————————————————————————————————————————————————————
// Vue complète
// ————————————————————————————————————————————————————————————————
export type OrchestratorView = {
  canView: boolean;
  canManage: boolean;
  killSwitchEngaged: boolean;
  agents: AgentGovernance[]; // triés (plafonnés puis risque puis niveau)
  isEmpty: boolean; // aucun agent enregistré (état par défaut honnête)
  totalAgents: number;
  activeAgents: number; // niveau effectif > 0
  idleAgents: number; // niveau effectif = 0
  cappedAgents: number; // configuré > plafond (demande abaissée par le moteur)
  disabledAgents: number; // interrupteur off
  suppressedAgents: number; // configuré > 0 mais effectif = 0 (coupé par off ou arrêt global)
  maxEffectiveLevel: AutonomyLevel;
  posture: OrchestratorPosture;
  telemetry: OrchestratorTelemetry | null; // null ⇒ non disponible
};

export function buildOrchestratorView(input: {
  role: StaffRole | null | undefined;
  agents?: readonly AgentDescriptor[];
  settings?: OrchestratorSettings;
  telemetry?: OrchestratorTelemetry | null;
}): OrchestratorView {
  const canView = canViewOrchestrator(input.role);
  const canManage = canManageOrchestrator(input.role);
  const settings: OrchestratorSettings = input.settings ?? { killSwitchEngaged: false };
  const killSwitchEngaged = settings.killSwitchEngaged === true;

  const source = input.agents ?? [];
  const agents = source.map((a) => resolveAgentGovernance(a, settings)).sort(compareGovernance);

  const totalAgents = agents.length;
  const activeAgents = agents.filter((a) => a.effectiveLevel > 0).length;
  const idleAgents = totalAgents - activeAgents;
  const cappedAgents = agents.filter((a) => a.cappedByCeiling).length;
  const disabledAgents = agents.filter((a) => a.disabledBySwitch).length;
  // Agents « étouffés » : la direction les voulait actifs (configuré > 0) mais l'off ou l'arrêt global les
  // a ramenés à 0 — utile pour distinguer « rien de configuré » de « configuré mais coupé ».
  const suppressedAgents = agents.filter(
    (a) => a.configuredLevel > 0 && a.effectiveLevel === 0,
  ).length;

  const maxEffectiveLevel = agents.reduce<AutonomyLevel>(
    (max, a) => (a.effectiveLevel > max ? a.effectiveLevel : max),
    0,
  );

  const posture: OrchestratorPosture = killSwitchEngaged
    ? "halted"
    : POSTURE_BY_LEVEL[maxEffectiveLevel];

  return {
    canView,
    canManage,
    killSwitchEngaged,
    agents,
    isEmpty: totalAgents === 0,
    totalAgents,
    activeAgents,
    idleAgents,
    cappedAgents,
    disabledAgents,
    suppressedAgents,
    maxEffectiveLevel,
    posture,
    telemetry: input.telemetry ?? null,
  };
}
