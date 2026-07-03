// lib/activeEventSelector.ts — logique PURE du SÉLECTEUR UNIVERS + ÉVÉNEMENT ACTIF (module 0.4, Socle).
// Aucun accès réseau, aucune horloge (new Date()/Date.now() interdits — tout vient des entrées).
//
// 0.4 (CLUB_ONE_OS_MASTER §3.1 « Sélecteur univers + événement actif · Socle · Tous · P1 ») répond à
// une question simple mais transverse : QUELLE soirée est active, et — pour la direction — comment en
// activer une. Il ne parle jamais à Supabase : il REÇOIT le contexte serveur déjà chargé par
// lib/activeEvent (get_active_event_context → ActiveEventRuntimeContext ; list_activatable_club_events →
// ActiveEventCandidate[]) et se contente de le classer, filtrer et présenter.
//
// Règles dures (honnêteté), héritées de la gouvernance Club One (§50 Domaine) :
//   · La DÉCISION bootstrap-vs-activation ne se déduit JAMAIS d'un message d'erreur : elle vient du
//     contexte serveur (chooseActiveEventLifecycleAction, déjà dans lib/activeEvent). Ce module la
//     RÉUTILISE, il ne la ré-invente pas.
//   · Un événement n'est ACTIVABLE que si son statut ∈ {draft, published}. archived / statut inconnu =
//     JAMAIS proposé (mais compté honnêtement, pas masqué en silence).
//   · AUCUN univers inventé : les candidats portent leur PROPRE venue (venue_id/venue_name du modèle
//     événements). On ne les force PAS dans le vocabulaire fermé du plan de salle (eden/terminus/cercle) —
//     le rapprochement des deux est une décision fondateur, pas une supposition. Un candidat sans venue
//     tombe dans un groupe « Univers non renseigné » explicite.
//   · La garde de rôle est un confort d'UI, PAS une sécurité : l'autorité reste les RPC SECURITY DEFINER
//     (bootstrap/activate/close_club_event_v2) + la RLS. Ce module ne mute rien.

import { STAFF_ROLES, type StaffRole } from "./permissions.ts";
import {
  chooseActiveEventLifecycleAction,
  type ActiveEventCandidate,
  type ActiveEventContext,
  type ActiveEventLifecycleAction,
  type ActiveEventRuntimeContext,
} from "./activeEvent.ts";

// ————————————————————————————————————————————————————————————————
// Statuts activables — miroir de la règle domaine (§50) : bootstrap/activation refusent tout le reste.
// ————————————————————————————————————————————————————————————————
export const ACTIVATABLE_STATUSES = ["draft", "published"] as const;
export type ActivatableStatus = (typeof ACTIVATABLE_STATUSES)[number];

export function isActivatableStatus(s: unknown): s is ActivatableStatus {
  return typeof s === "string" && (ACTIVATABLE_STATUSES as readonly string[]).includes(s);
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle
//   · consultation : TOUS les rôles voient quelle soirée est active (bandeau contextuel). §3.1 « Tous ».
//   · gestion : seule la DIRECTION (admin/manager) déclenche bootstrap / activation / clôture.
// Ni l'une ni l'autre n'est une sécurité : la RLS + les RPC SECURITY DEFINER restent l'autorité.
// ————————————————————————————————————————————————————————————————
export function canViewActiveEvent(role: StaffRole | null | undefined): boolean {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}

export function canManageActiveEvent(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// Cycle de vie du sélecteur — POURQUOI telle action (ou aucune) est possible, sans deviner.
//   not_authorized — le rôle courant ne gère pas l'événement actif (consultation seule)
//   already_active — une soirée est DÉJÀ active : il faut la clôturer avant d'en activer une autre
//   bootstrap      — premier lancement jamais fait (bootstrap_completed_at IS NULL)
//   activate       — socle déjà amorcé, aucune soirée active : on active une soirée
// ————————————————————————————————————————————————————————————————
export const LIFECYCLE_REASONS = [
  "not_authorized",
  "already_active",
  "bootstrap",
  "activate",
] as const;
export type LifecycleReason = (typeof LIFECYCLE_REASONS)[number];

export type SelectorLifecycle = {
  action: ActiveEventLifecycleAction; // "bootstrap" | "activate" | "none"
  reason: LifecycleReason;
  canManage: boolean;
  requiresCandidate: boolean; // bootstrap/activate exigent le choix d'un événement cible
};

// Résout l'action de cycle de vie disponible. La décision NE PARSE aucun message : elle compose le
// contexte serveur (runtime) et la garde de rôle. chooseActiveEventLifecycleAction reste la source de
// vérité bootstrap-vs-activation ; on la borne d'abord par « un actif existe déjà ? » (RPC d'activation
// exige active_event_id IS NULL — on ne propose donc jamais d'activer par-dessus une soirée en cours).
export function resolveSelectorLifecycle(input: {
  role: StaffRole | null | undefined;
  runtime: ActiveEventRuntimeContext;
}): SelectorLifecycle {
  const canManage = canManageActiveEvent(input.role);
  if (!canManage) {
    return { action: "none", reason: "not_authorized", canManage, requiresCandidate: false };
  }
  if (input.runtime.activeEvent) {
    // Une soirée est active : bootstrap et activation sont tous deux fermés (clôturer d'abord).
    return { action: "none", reason: "already_active", canManage, requiresCandidate: false };
  }
  const action = chooseActiveEventLifecycleAction({
    role: input.role as string, // canManage garantit admin/manager
    bootstrapCompleted: input.runtime.bootstrapCompleted,
  });
  return {
    action,
    reason: action === "bootstrap" ? "bootstrap" : "activate",
    canManage,
    requiresCandidate: action !== "none",
  };
}

// ————————————————————————————————————————————————————————————————
// Candidat enrichi + regroupement par univers (jamais coercé vers le vocabulaire du plan de salle)
// ————————————————————————————————————————————————————————————————
export type SelectorCandidate = ActiveEventCandidate & {
  venueKey: string; // clé de regroupement stable ("" = univers non renseigné)
  venueLabel: string; // libellé affiché ("Univers non renseigné" si aucune venue jointe)
  activatable: boolean; // statut ∈ {draft, published}
};

const UNSET_VENUE_LABEL = "Univers non renseigné";

export function classifyCandidate(c: ActiveEventCandidate): SelectorCandidate {
  const name = typeof c.venueName === "string" ? c.venueName.trim() : "";
  const hasVenue = name.length > 0;
  return {
    ...c,
    venueKey: hasVenue ? name : "",
    venueLabel: hasVenue ? name : UNSET_VENUE_LABEL,
    activatable: isActivatableStatus(c.status),
  };
}

export type VenueGroup = {
  venueKey: string;
  venueLabel: string;
  candidates: SelectorCandidate[]; // triés (date croissante, départage id)
  activatableCount: number;
};

// Tri des candidats d'un groupe : date croissante (la plus proche d'abord), départage stable par id.
// Aucune horloge : on compare les chaînes ISO/date telles quelles (lexicographique = chronologique).
function compareCandidates(a: SelectorCandidate, b: SelectorCandidate): number {
  if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Tri des groupes : univers nommés en tête (ordre alphabétique FR), « non renseigné » en dernier.
function compareGroups(a: VenueGroup, b: VenueGroup): number {
  const aUnset = a.venueKey === "";
  const bUnset = b.venueKey === "";
  if (aUnset !== bUnset) return aUnset ? 1 : -1;
  return a.venueLabel.localeCompare(b.venueLabel, "fr");
}

// ————————————————————————————————————————————————————————————————
// Vue complète
// ————————————————————————————————————————————————————————————————
export type VenueFilterOption = { key: string; label: string; count: number; activatableCount: number };

export type ActiveEventSelectorView = {
  canView: boolean;
  lifecycle: SelectorLifecycle;
  activeEvent: ActiveEventContext | null;
  bootstrapCompleted: boolean;
  bootstrapCompletedAt: string | null;
  lastClosedEventId: string | null;
  groups: VenueGroup[]; // après filtre univers, triés
  venueFilterOptions: VenueFilterOption[]; // univers présents (avant filtre), triés
  totalCandidates: number; // candidats bruts (avant filtre univers)
  activatableCandidates: number; // candidats activables (avant filtre univers)
  shownCandidates: number; // candidats après filtre univers
  filteredByVenue: boolean;
  selected: SelectorCandidate | null; // candidat choisi résolu (parmi TOUS les candidats)
  selectionValid: boolean; // le choix est actionnable : action attend un id ET le candidat est activable
};

export function buildActiveEventSelector(input: {
  role: StaffRole | null | undefined;
  runtime: ActiveEventRuntimeContext;
  candidates: readonly ActiveEventCandidate[];
  venueFilter?: string | null; // venueKey ; absent/null = tous les univers
  selectedId?: string | null;
}): ActiveEventSelectorView {
  const canView = canViewActiveEvent(input.role);
  const lifecycle = resolveSelectorLifecycle({ role: input.role, runtime: input.runtime });

  const classified = input.candidates.map(classifyCandidate);
  const activatableCandidates = classified.filter((c) => c.activatable).length;

  // Options d'univers (avant filtre) : un bucket par venueKey présent, comptes honnêtes.
  const optionMap = new Map<string, VenueFilterOption>();
  for (const c of classified) {
    const prev = optionMap.get(c.venueKey);
    if (prev) {
      prev.count += 1;
      if (c.activatable) prev.activatableCount += 1;
    } else {
      optionMap.set(c.venueKey, {
        key: c.venueKey,
        label: c.venueLabel,
        count: 1,
        activatableCount: c.activatable ? 1 : 0,
      });
    }
  }
  const venueFilterOptions = [...optionMap.values()].sort((a, b) =>
    compareGroups(
      { venueKey: a.key, venueLabel: a.label, candidates: [], activatableCount: 0 },
      { venueKey: b.key, venueLabel: b.label, candidates: [], activatableCount: 0 },
    ),
  );

  // Filtre univers (sur la clé exacte). null/absent = non filtrant.
  const filterKey = typeof input.venueFilter === "string" ? input.venueFilter : null;
  const filteredByVenue = filterKey !== null;
  const shown = filteredByVenue ? classified.filter((c) => c.venueKey === filterKey) : classified;

  // Regroupement des candidats affichés.
  const groupMap = new Map<string, VenueGroup>();
  for (const c of shown) {
    const prev = groupMap.get(c.venueKey);
    if (prev) {
      prev.candidates.push(c);
      if (c.activatable) prev.activatableCount += 1;
    } else {
      groupMap.set(c.venueKey, {
        venueKey: c.venueKey,
        venueLabel: c.venueLabel,
        candidates: [c],
        activatableCount: c.activatable ? 1 : 0,
      });
    }
  }
  const groups = [...groupMap.values()]
    .map((g) => ({ ...g, candidates: [...g.candidates].sort(compareCandidates) }))
    .sort(compareGroups);

  // Résolution du candidat choisi (parmi TOUS les candidats, pas seulement l'univers filtré).
  const selectedId = typeof input.selectedId === "string" ? input.selectedId : null;
  const selected = selectedId ? classified.find((c) => c.id === selectedId) ?? null : null;
  const selectionValid = lifecycle.requiresCandidate && selected !== null && selected.activatable;

  return {
    canView,
    lifecycle,
    activeEvent: input.runtime.activeEvent,
    bootstrapCompleted: input.runtime.bootstrapCompleted,
    bootstrapCompletedAt: input.runtime.bootstrapCompletedAt,
    lastClosedEventId: input.runtime.lastClosedEventId,
    groups,
    venueFilterOptions,
    totalCandidates: classified.length,
    activatableCandidates,
    shownCandidates: shown.length,
    filteredByVenue,
    selected,
    selectionValid,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés d'UI (self-contained, aucune dépendance)
// ————————————————————————————————————————————————————————————————
const LIFECYCLE_ACTION_LABELS: Record<ActiveEventLifecycleAction, string> = {
  bootstrap: "Amorcer la première soirée",
  activate: "Activer une soirée",
  none: "Aucune action disponible",
};

export function lifecycleActionLabel(action: ActiveEventLifecycleAction): string {
  return LIFECYCLE_ACTION_LABELS[action];
}

const LIFECYCLE_REASON_MESSAGES: Record<LifecycleReason, string> = {
  not_authorized: "Consultation seule — seule la direction active ou clôture une soirée.",
  already_active: "Une soirée est déjà active. Clôturez-la avant d'en activer une autre.",
  bootstrap: "Aucune soirée n'a jamais été amorcée : le premier lancement est un amorçage (bootstrap).",
  activate: "Le socle est amorcé et aucune soirée n'est active : choisissez une soirée à activer.",
};

export function lifecycleReasonMessage(reason: LifecycleReason): string {
  return LIFECYCLE_REASON_MESSAGES[reason];
}

const STATUS_LABELS: Record<ActivatableStatus, string> = {
  draft: "Brouillon",
  published: "Publiée",
};

// Libellé de statut : les statuts activables ont un libellé FR ; tout autre statut garde sa clé brute
// (aucune réinterprétation — un statut inconnu reste visible tel quel, jamais promu « activable »).
export function candidateStatusLabel(status: string): string {
  return isActivatableStatus(status) ? STATUS_LABELS[status] : status;
}
