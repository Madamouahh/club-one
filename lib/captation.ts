// lib/captation.ts — logique PURE du module Captation en soirée (A10), aucun accès réseau.
//
// Shot list de captation photo/vidéo de la soirée (migration 0029). Ce module :
//   · décrit le modèle (miroir des tables shot_list_items / shot_captures) ;
//   · porte le SEUL vocabulaire fermé légitime — le STATUT (cycle de vie « à capturer → capturé → déposé au
//     DAM » décrit littéralement par le master §1 l.100) et l'univers (réutilisé de venueTables 0024).
//     Le libellé du plan, le sujet, le format et l'heure idéale sont des champs LIBRES saisis au runtime
//     par la créa : AUCUNE taxonomie de format n'est inventée, le module ship VIDE ;
//   · valide un brouillon de plan AVANT insert (libellé requis, univers/statut bornés, position entière) ;
//   · porte les gardes de rôle de la matrice A10 (source de vérité UI ; la RLS 0029 reste l'AUTORITÉ) ;
//   · fusionne plans + captures d'une soirée, groupe par univers, calcule l'avancement, et résume (états
//     vides HONNÊTES : aucun plan → des zéros, jamais une ligne fabriquée).
// L'accès Supabase reste dans app/page.tsx (comme incidents / comm / artiste / checklists) ; ce module ne
// fait que valider, filtrer et agréger. Rien n'est inventé.

import type { StaffRole } from "./permissions.ts";
import { VENUES, type Venue } from "./venueTables.ts";

// ————————————————————————————————————————————————————————————————
// Vocabulaire fermé (structure métier issue du master §1 l.98-100, PAS une donnée fondateur)
// ————————————————————————————————————————————————————————————————

// Statut = cycle de vie de captation, littéralement « statut · dépôt rapide → DAM » du master.
//   a_capturer : plan prévu, pas encore pris · capture : pris · depose : déposé au DAM (B4).
export const CAPTATION_STATUSES = ["a_capturer", "capture", "depose"] as const;
export type CaptationStatus = (typeof CAPTATION_STATUSES)[number];

// Univers physiques : réutilisés de venueTables (0024) — jamais redéfinis (eden / terminus / cercle).
export { VENUES };
export type { Venue };

// Rôles ayant accès à la captation. Le master §3.1 dit « Manager, créa » ; il n'existe PAS de rôle d'auth
// « créa » dans le socle (StaffRole) → câblé sur la DIRECTION (admin/manager), comme le rôle « artiste »
// différé en 0027. On ne fabrique pas de rôle.
export const CAPTATION_ROLES = ["admin", "manager"] as const satisfies readonly StaffRole[];

// ————————————————————————————————————————————————————————————————
// Modèle (miroir des tables 0029)
// ————————————————————————————————————————————————————————————————

export type ShotListItem = {
  id: string;
  venue: Venue | null; // null = toutes salles
  label: string;
  sujet: string | null; // artiste / public / décor… LIBRE
  format: string | null; // format de rendu, LIBRE (jamais énuméré)
  heure_ideale: string | null; // heure idéale de captation, LIBRE
  prioritaire: boolean;
  position: number;
  active: boolean;
  auteur_username: string;
  created_at: string;
  updated_at: string;
};

export type ShotCapture = {
  id: string;
  item_id: string;
  event_id: string | null;
  exploitation_date: string;
  status: CaptationStatus;
  dam_ref: string | null;
  note: string | null;
  updated_by: string;
  updated_at: string;
};

// Brouillon de plan saisi côté client (sans les champs fixés serveur : id/auteur/timestamps).
export type ShotListDraft = {
  label: string;
  venue?: string | null;
  sujet?: string | null;
  format?: string | null;
  heure_ideale?: string | null;
  prioritaire?: boolean;
  position?: number;
};

// ————————————————————————————————————————————————————————————————
// Gardes de type (vocabulaire fermé)
// ————————————————————————————————————————————————————————————————

export function isCaptationStatus(value: string): value is CaptationStatus {
  return (CAPTATION_STATUSES as readonly string[]).includes(value);
}

export function isVenue(value: string): value is Venue {
  return (VENUES as readonly string[]).includes(value);
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — matrice A10 (master §3.1 « Manager, créa » → direction dans le socle)
// La RLS 0029 reste l'AUTORITÉ ; ces helpers ne font que refléter la même règle côté UI.
// ————————————————————————————————————————————————————————————————

// A accès à la captation (lecture au minimum) : direction seule dans le socle actuel.
export function canViewCaptation(role: StaffRole): boolean {
  return (CAPTATION_ROLES as readonly string[]).includes(role);
}

// Peut composer la shot list (créer/éditer/désactiver un plan) : direction seule.
export function canManageShotList(role: StaffRole): boolean {
  return canViewCaptation(role);
}

// Peut mettre à jour le statut de capture d'un plan : direction seule, et seulement si le plan est actif.
export function canCaptureShot(role: StaffRole, item: Pick<ShotListItem, "active">): boolean {
  if (!canViewCaptation(role)) return false;
  return item.active;
}

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon de plan (avant insert)
// ————————————————————————————————————————————————————————————————

export type DraftValidation = { ok: boolean; errors: string[] };

export function validateShotDraft(draft: ShotListDraft, role: StaffRole): DraftValidation {
  const errors: string[] = [];
  if (draft.label.trim().length === 0) {
    errors.push("libellé du plan requis");
  }
  if (draft.venue !== undefined && draft.venue !== null && !isVenue(draft.venue)) {
    errors.push("univers inconnu (eden, terminus ou cercle)");
  }
  if (
    draft.position !== undefined &&
    (!Number.isInteger(draft.position) || draft.position < 0)
  ) {
    errors.push("position invalide (entier ≥ 0)");
  }
  if (!canManageShotList(role)) {
    errors.push("ce rôle ne peut pas composer la shot list");
  }
  return { ok: errors.length === 0, errors };
}

// ————————————————————————————————————————————————————————————————
// Fusion plans + captures d'une soirée (état d'avancement, jamais inventé)
// ————————————————————————————————————————————————————————————————

export type ShotLine = {
  item: ShotListItem;
  status: CaptationStatus; // statut de la soirée ; « a_capturer » par défaut si pas encore de capture
  damRef: string | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

// Associe à chaque plan ACTIF son état pour la soirée donnée (statut « a_capturer » si aucune capture).
// Les plans inactifs sont exclus (retirés de la liste courante mais conservés en base pour l'historique).
export function buildShotLines(
  items: readonly ShotListItem[],
  captures: readonly ShotCapture[],
  exploitationDate: string,
): ShotLine[] {
  const byItem = new Map<string, ShotCapture>();
  for (const c of captures) {
    if (c.exploitation_date === exploitationDate) byItem.set(c.item_id, c);
  }
  return items
    .filter((it) => it.active)
    .map((item) => {
      const c = byItem.get(item.id) ?? null;
      return {
        item,
        status: c?.status ?? "a_capturer",
        damRef: c?.dam_ref ?? null,
        note: c?.note ?? null,
        updatedBy: c?.updated_by ?? null,
        updatedAt: c?.updated_at ?? null,
      };
    });
}

// ————————————————————————————————————————————————————————————————
// Regroupement par univers (ordre déterministe : prioritaires d'abord, puis position, puis libellé)
// ————————————————————————————————————————————————————————————————

export type VenueGroup = { venue: Venue | null; lines: ShotLine[] };

// Trie les lignes d'un univers : plans prioritaires d'abord, puis par position, puis par libellé.
function sortLines(lines: ShotLine[]): ShotLine[] {
  return [...lines].sort((a, b) => {
    if (a.item.prioritaire !== b.item.prioritaire) return a.item.prioritaire ? -1 : 1;
    if (a.item.position !== b.item.position) return a.item.position - b.item.position;
    return a.item.label < b.item.label ? -1 : a.item.label > b.item.label ? 1 : 0;
  });
}

// Groupe les lignes par univers (ordre du vocabulaire VENUES) ; les plans « toutes salles » (venue null)
// forment un dernier groupe. Les univers sans ligne sont omis (état vide honnête).
export function groupByVenue(lines: readonly ShotLine[]): VenueGroup[] {
  const result: VenueGroup[] = [];
  for (const venue of VENUES) {
    const inVenue = lines.filter((l) => l.item.venue === venue);
    if (inVenue.length > 0) result.push({ venue, lines: sortLines(inVenue) });
  }
  const noVenue = lines.filter((l) => l.item.venue === null);
  if (noVenue.length > 0) result.push({ venue: null, lines: sortLines(noVenue) });
  return result;
}

// ————————————————————————————————————————————————————————————————
// Avancement & résumé (états vides HONNÊTES)
// ————————————————————————————————————————————————————————————————

export type StatusCounts = Record<CaptationStatus, number>;

// Compte les plans par statut. Aucun plan → tous les compteurs à zéro (jamais de fabrication).
export function countByStatus(lines: readonly ShotLine[]): StatusCounts {
  const counts: StatusCounts = { a_capturer: 0, capture: 0, depose: 0 };
  for (const l of lines) counts[l.status] += 1;
  return counts;
}

export type CaptationSummary = {
  total: number; // plans actifs
  captured: number; // capturés OU déposés (au moins pris)
  deposited: number; // déposés au DAM
  remaining: number; // encore « à capturer »
  complete: boolean; // tout est déposé (et il y a au moins un plan)
};

export function summarizeCaptation(lines: readonly ShotLine[]): CaptationSummary {
  const counts = countByStatus(lines);
  const total = lines.length;
  const deposited = counts.depose;
  const captured = counts.capture + counts.depose;
  return {
    total,
    captured,
    deposited,
    remaining: counts.a_capturer,
    complete: total > 0 && deposited === total,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes (aucun fuseau/locale runtime)
// ————————————————————————————————————————————————————————————————

const STATUS_LABELS: Record<CaptationStatus, string> = {
  a_capturer: "À capturer",
  capture: "Capturé",
  depose: "Déposé au DAM",
};

const VENUE_LABELS: Record<Venue, string> = {
  eden: "Eden",
  terminus: "Terminus",
  cercle: "Le Cercle",
};

export function statusLabel(status: CaptationStatus): string {
  return STATUS_LABELS[status];
}

export function venueLabel(venue: Venue | null): string {
  return venue === null ? "Toutes salles" : VENUE_LABELS[venue];
}
