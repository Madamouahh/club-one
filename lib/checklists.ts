// lib/checklists.ts — logique PURE du module Checklists ouverture/fermeture (A9), aucun accès réseau.
//
// Listes de vérification d'ouverture et de fermeture, par espace et par poste (migration 0028). Ce module :
//   · décrit le modèle (miroir des tables checklist_items / checklist_completions) ;
//   · porte le vocabulaire fermé (phases, catégories §2 du master, postes) — AUCUN item de contenu n'est
//     défini ici : le module ship VIDE, les libellés sont saisis au runtime par un manager ;
//   · valide un brouillon d'item AVANT insert (libellé requis, phase/catégorie/poste bornés) ;
//   · porte les gardes de rôle de la matrice A9 (source de vérité UI ; la RLS 0028 reste l'AUTORITÉ) ;
//   · fusionne items + coches d'une soirée, calcule l'avancement, groupe par phase/catégorie, et résume
//     (états vides HONNÊTES : aucun item → des zéros, jamais une ligne fabriquée).
// L'accès Supabase reste dans app/page.tsx (comme incidents / comm interne / artiste) ; ce module ne fait
// que valider, filtrer et agréger. Rien n'est inventé.

import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Vocabulaire fermé (structure métier issue du master §2 l.96-97, PAS une donnée fondateur)
// ————————————————————————————————————————————————————————————————

export const CHECKLIST_PHASES = ["ouverture", "fermeture"] as const;
export type ChecklistPhase = (typeof CHECKLIST_PHASES)[number];

// Catégories = exactement celles de l'arborescence master : sécu · caisse · lumière · son · nettoyage ·
// stocks · tables · issues (sorties de secours) · signalétique · contenus à capturer.
export const CHECKLIST_CATEGORIES = [
  "secu",
  "caisse",
  "lumiere",
  "son",
  "nettoyage",
  "stocks",
  "tables",
  "issues",
  "signaletique",
  "captation",
] as const;
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

// Rôles opérationnels concernés par les checklists (« Tous par poste », master §3.1). Le promoteur n'a
// pas de poste d'ouverture/fermeture → exclu, comme pour comm interne (0026) / incidents (0023).
export const CHECKLIST_ROLES = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
] as const satisfies readonly StaffRole[];

// Postes assignables à un item (miroir de la contrainte SQL sur checklist_items.poste). null = tous.
export type ChecklistPoste = (typeof CHECKLIST_ROLES)[number];

// ————————————————————————————————————————————————————————————————
// Modèle (miroir des tables 0028)
// ————————————————————————————————————————————————————————————————

export type ChecklistItem = {
  id: string;
  venue: string | null;
  phase: ChecklistPhase;
  category: ChecklistCategory;
  poste: ChecklistPoste | null; // null = tous les postes
  label: string;
  position: number;
  active: boolean;
  auteur_username: string;
  created_at: string;
  updated_at: string;
};

export type ChecklistCompletion = {
  id: string;
  item_id: string;
  event_id: string | null;
  exploitation_date: string;
  note: string | null;
  done_by: string;
  done_at: string;
};

// Brouillon d'item saisi côté client (sans les champs fixés serveur : id/auteur/timestamps).
export type ChecklistItemDraft = {
  phase: string;
  category: string;
  label: string;
  poste?: string | null;
  venue?: string | null;
  position?: number;
};

// ————————————————————————————————————————————————————————————————
// Gardes de type (vocabulaire fermé)
// ————————————————————————————————————————————————————————————————

export function isChecklistPhase(value: string): value is ChecklistPhase {
  return (CHECKLIST_PHASES as readonly string[]).includes(value);
}

export function isChecklistCategory(value: string): value is ChecklistCategory {
  return (CHECKLIST_CATEGORIES as readonly string[]).includes(value);
}

export function isChecklistPoste(value: string): value is ChecklistPoste {
  return (CHECKLIST_ROLES as readonly string[]).includes(value);
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — matrice A9 (master §3.1 « Tous (par poste) »)
//   Direction ✅➕ · Manager ✅➕ · Serveur/Sécurité/Compteur 👁➕ (leurs items) · Promoteur ⛔
// La RLS 0028 reste l'AUTORITÉ ; ces helpers ne font que refléter la même règle côté UI.
// ————————————————————————————————————————————————————————————————

// A accès aux checklists (au moins en lecture) : tous les rôles opérationnels. promoteur ⛔.
export function canViewChecklists(role: StaffRole): boolean {
  return (CHECKLIST_ROLES as readonly string[]).includes(role);
}

// Peut composer le modèle (créer/éditer/désactiver un item) : direction seule (manager inclus).
export function canManageChecklistItems(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// Peut cocher un item donné : direction coche tout ; un employé coche un item sans poste ou de son poste.
// Miroir exact du EXISTS/poste du WITH CHECK d'insert de checklist_completions (0028).
export function canCompleteItem(role: StaffRole, item: Pick<ChecklistItem, "poste" | "active">): boolean {
  if (!canViewChecklists(role)) return false; // promoteur ⛔
  if (!item.active) return false; // un item désactivé n'est plus cochable
  if (role === "admin" || role === "manager") return true;
  return item.poste === null || item.poste === role;
}

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon d'item (avant insert)
// ————————————————————————————————————————————————————————————————

export type DraftValidation = { ok: boolean; errors: string[] };

export function validateItemDraft(draft: ChecklistItemDraft, role: StaffRole): DraftValidation {
  const errors: string[] = [];
  if (!isChecklistPhase(draft.phase)) {
    errors.push("phase invalide (ouverture ou fermeture)");
  }
  if (!isChecklistCategory(draft.category)) {
    errors.push("catégorie inconnue");
  }
  if (draft.label.trim().length === 0) {
    errors.push("libellé de l'item requis");
  }
  if (draft.poste !== undefined && draft.poste !== null && !isChecklistPoste(draft.poste)) {
    errors.push("poste assigné invalide");
  }
  if (
    draft.position !== undefined &&
    (!Number.isInteger(draft.position) || draft.position < 0)
  ) {
    errors.push("position invalide (entier ≥ 0)");
  }
  if (!canManageChecklistItems(role)) {
    errors.push("ce rôle ne peut pas composer la checklist");
  }
  return { ok: errors.length === 0, errors };
}

// ————————————————————————————————————————————————————————————————
// Fusion items + coches d'une soirée (état d'avancement, jamais inventé)
// ————————————————————————————————————————————————————————————————

export type ChecklistLine = {
  item: ChecklistItem;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
  note: string | null;
};

// Associe à chaque item ACTIF sa coche pour la soirée donnée (si elle existe). Les items inactifs sont
// exclus (ils ne font plus partie de la liste courante mais restent en base pour l'historique).
export function buildLines(
  items: readonly ChecklistItem[],
  completions: readonly ChecklistCompletion[],
  exploitationDate: string,
): ChecklistLine[] {
  const byItem = new Map<string, ChecklistCompletion>();
  for (const c of completions) {
    if (c.exploitation_date === exploitationDate) byItem.set(c.item_id, c);
  }
  return items
    .filter((it) => it.active)
    .map((item) => {
      const c = byItem.get(item.id) ?? null;
      return {
        item,
        done: c !== null,
        doneBy: c?.done_by ?? null,
        doneAt: c?.done_at ?? null,
        note: c?.note ?? null,
      };
    });
}

// ————————————————————————————————————————————————————————————————
// Regroupement par phase → catégorie (ordre déterministe du vocabulaire fermé)
// ————————————————————————————————————————————————————————————————

export type CategoryGroup = { category: ChecklistCategory; lines: ChecklistLine[] };
export type PhaseGroup = { phase: ChecklistPhase; groups: CategoryGroup[] };

// Trie les lignes d'une catégorie par position puis libellé (déterministe, aucun fuseau).
function sortLines(lines: ChecklistLine[]): ChecklistLine[] {
  return [...lines].sort((a, b) => {
    if (a.item.position !== b.item.position) return a.item.position - b.item.position;
    return a.item.label < b.item.label ? -1 : a.item.label > b.item.label ? 1 : 0;
  });
}

// Groupe les lignes par phase (ordre du vocabulaire) puis par catégorie (ordre du vocabulaire).
// Les catégories/phases sans ligne sont omises (état vide honnête : on ne fabrique pas de section vide).
export function groupByPhase(lines: readonly ChecklistLine[]): PhaseGroup[] {
  const result: PhaseGroup[] = [];
  for (const phase of CHECKLIST_PHASES) {
    const inPhase = lines.filter((l) => l.item.phase === phase);
    if (inPhase.length === 0) continue;
    const groups: CategoryGroup[] = [];
    for (const category of CHECKLIST_CATEGORIES) {
      const inCat = inPhase.filter((l) => l.item.category === category);
      if (inCat.length === 0) continue;
      groups.push({ category, lines: sortLines(inCat) });
    }
    result.push({ phase, groups });
  }
  return result;
}

// Filtre les lignes visibles pour un poste : direction voit tout ; un employé voit les items sans poste
// ou de son poste (miroir du cochage « par poste »). Utile pour l'écran employé.
export function linesForPoste(lines: readonly ChecklistLine[], role: StaffRole): ChecklistLine[] {
  if (role === "admin" || role === "manager") return [...lines];
  return lines.filter((l) => l.item.poste === null || l.item.poste === role);
}

// ————————————————————————————————————————————————————————————————
// Avancement & résumé (états vides HONNÊTES)
// ————————————————————————————————————————————————————————————————

export type PhaseProgress = { phase: ChecklistPhase; total: number; done: number };

// Avancement par phase (nombre d'items cochés / total). Aucun item → total 0, done 0 (pas de division).
export function progressByPhase(lines: readonly ChecklistLine[]): PhaseProgress[] {
  return CHECKLIST_PHASES.map((phase) => {
    const inPhase = lines.filter((l) => l.item.phase === phase);
    return {
      phase,
      total: inPhase.length,
      done: inPhase.filter((l) => l.done).length,
    };
  });
}

export type ChecklistSummary = {
  total: number; // items actifs
  done: number; // items cochés pour la soirée
  remaining: number; // reste à cocher
  complete: boolean; // tout est coché (et il y a au moins un item)
};

export function summarizeChecklist(lines: readonly ChecklistLine[]): ChecklistSummary {
  const total = lines.length;
  const done = lines.filter((l) => l.done).length;
  return {
    total,
    done,
    remaining: total - done,
    complete: total > 0 && done === total,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes (aucun fuseau/locale runtime)
// ————————————————————————————————————————————————————————————————

const PHASE_LABELS: Record<ChecklistPhase, string> = {
  ouverture: "Ouverture",
  fermeture: "Fermeture",
};

const CATEGORY_LABELS: Record<ChecklistCategory, string> = {
  secu: "Sécurité",
  caisse: "Caisse",
  lumiere: "Lumière",
  son: "Son",
  nettoyage: "Nettoyage",
  stocks: "Stocks",
  tables: "Tables",
  issues: "Issues de secours",
  signaletique: "Signalétique",
  captation: "Contenus à capturer",
};

export function phaseLabel(phase: ChecklistPhase): string {
  return PHASE_LABELS[phase];
}

export function categoryLabel(category: ChecklistCategory): string {
  return CATEGORY_LABELS[category];
}
