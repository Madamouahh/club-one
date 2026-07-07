// lib/artists.ts — logique PURE du module Fiches artistes (C5), aucun accès réseau.
//
// Répertoire des artistes du club (migration 0069) : coordonnées, style, cachet, contraintes
// techniques, notes, et historique de rattachement aux soirées (artist_event_links). Ce module :
//   · décrit le modèle (miroir des tables artists / artist_event_links) ;
//   · valide un brouillon de fiche AVANT insert (nom de scène requis, cachet entier ≥ 0, email
//     de forme basique) ;
//   · porte les gardes de rôle de la matrice C5 (direction seule ; source de vérité UI, la RLS
//     0069 reste l'autorité) ;
//   · met en forme le cachet en euros (déterministe) et agrège un résumé HONNÊTE (aucune fiche →
//     des zéros, jamais un artiste ou un cachet fabriqué).
// L'accès Supabase reste dans le composant branché (DML direct via le client, comme le module
// tasks) ; ce module ne fait que valider, trier et agréger. Rien n'est inventé ici.

import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Modèle (miroir des tables 0069)
// ————————————————————————————————————————————————————————————————

// Cycle de vie d'une fiche artiste (vocabulaire fermé — une structure métier, pas une donnée fondateur).
export const ARTIST_STATUSES = ["active", "archived"] as const;
export type ArtistStatus = (typeof ARTIST_STATUSES)[number];

export type Artist = {
  id: string;
  stage_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  style: string | null;
  fee_cents: number | null; // cachet EN CENTIMES ; null = à confirmer ; toujours ≥ 0 sinon
  tech_requirements: string | null;
  notes: string | null;
  status: ArtistStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Rattachement d'un artiste à une soirée (historique). UNIQUE(artist_id, event_id) côté base.
export type ArtistEventLink = {
  id: string;
  artist_id: string;
  event_id: string;
  slot_label: string | null;
  fee_cents_override: number | null; // cachet spécifique à la soirée ; toujours ≥ 0 sinon
  created_by: string | null;
  created_at: string;
};

// Brouillon saisi côté client (sans les champs fixés serveur : id/created_by/timestamps/status).
// Les champs optionnels vides sont normalisés en null par le composant avant insert.
export type ArtistDraft = {
  stage_name: string;
  legal_name?: string | null;
  email?: string | null;
  phone?: string | null;
  style?: string | null;
  fee_cents?: number | null;
  tech_requirements?: string | null;
  notes?: string | null;
};

// ————————————————————————————————————————————————————————————————
// Gardes de type (vocabulaire fermé)
// ————————————————————————————————————————————————————————————————

export function isArtistStatus(value: string): value is ArtistStatus {
  return (ARTIST_STATUSES as readonly string[]).includes(value);
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — matrice C5 (fiche artiste réservée à la direction)
//   Direction ✅ · Manager ✅ · Serveur ⛔ · Sécurité ⛔ · Compteur ⛔ · Promoteur ⛔
// La RLS 0069 (direction-only) reste l'AUTORITÉ ; ces helpers ne font que refléter la même règle
// côté UI (masquer un formulaire n'est jamais une sécurité).
// ————————————————————————————————————————————————————————————————

// Peut créer/modifier/archiver une fiche artiste : direction (admin + manager). Miroir de la RLS.
export function canManageArtists(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// A accès (lecture) au répertoire artistes : direction seule (RLS direction-only). Aucun rôle
// opérationnel ne voit les fiches artistes.
export function canViewArtists(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon (avant insert)
// ————————————————————————————————————————————————————————————————

// Email de forme basique : une @ entourée de non-espaces, avec un point dans le domaine.
// On ne prétend pas valider l'existence de l'adresse — juste écarter les saisies manifestement fausses.
const EMAIL_BASIC = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DraftValidation = { ok: boolean; errors: string[] };

// Le rôle est requis pour vérifier le droit de gestion (miroir de la RLS direction-only).
export function validateArtistDraft(draft: ArtistDraft, role: StaffRole): DraftValidation {
  const errors: string[] = [];

  if (draft.stage_name.trim().length === 0) {
    errors.push("nom de scène requis");
  }

  if (draft.fee_cents !== undefined && draft.fee_cents !== null) {
    if (!Number.isInteger(draft.fee_cents) || draft.fee_cents < 0) {
      errors.push("cachet invalide (entier de centimes ≥ 0)");
    }
  }

  if (draft.email !== undefined && draft.email !== null && draft.email.trim().length > 0) {
    if (!EMAIL_BASIC.test(draft.email.trim())) {
      errors.push("email invalide");
    }
  }

  if (!canManageArtists(role)) {
    errors.push("ce rôle ne peut pas gérer les fiches artistes");
  }

  return { ok: errors.length === 0, errors };
}

// ————————————————————————————————————————————————————————————————
// Mise en forme du cachet (déterministe — fr-FR, cohérent avec lib/commandCenter.ts tileCa)
// ————————————————————————————————————————————————————————————————

// Cachet formaté en euros. null → "à confirmer" (le cachet n'est pas encore fixé, jamais fabriqué).
// Le montant est stocké EN CENTIMES : on divise par 100 avant mise en forme.
export function formatFee(fee_cents: number | null): string {
  if (fee_cents === null) return "à confirmer";
  const euros = (fee_cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${euros} €`;
}

// ————————————————————————————————————————————————————————————————
// Tri du répertoire : actifs d'abord, puis ordre alphabétique par nom de scène (copie non mutante).
// ————————————————————————————————————————————————————————————————

export function sortArtists(list: readonly Artist[]): Artist[] {
  return [...list].sort((a, b) => {
    const aa = a.status === "archived" ? 1 : 0;
    const ab = b.status === "archived" ? 1 : 0;
    if (aa !== ab) return aa - ab; // actifs d'abord
    // ordre alphabétique insensible à la casse (comparaison de chaînes, aucun fuseau/locale runtime)
    const na = a.stage_name.toLowerCase();
    const nb = b.stage_name.toLowerCase();
    if (na === nb) return 0;
    return na < nb ? -1 : 1;
  });
}

// ————————————————————————————————————————————————————————————————
// Résumé (états vides HONNÊTES : aucune fiche → zéros)
// ————————————————————————————————————————————————————————————————

export type ArtistSummary = {
  total: number;
  actifs: number;
  archives: number;
};

export function summarizeArtists(list: readonly Artist[]): ArtistSummary {
  let actifs = 0;
  let archives = 0;
  for (const a of list) {
    if (a.status === "archived") archives += 1;
    else actifs += 1;
  }
  return { total: list.length, actifs, archives };
}

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes (aucun fuseau/locale runtime)
// ————————————————————————————————————————————————————————————————

const STATUS_LABELS: Record<ArtistStatus, string> = {
  active: "Actif",
  archived: "Archivé",
};

export function artistStatusLabel(status: ArtistStatus): string {
  return STATUS_LABELS[status];
}
