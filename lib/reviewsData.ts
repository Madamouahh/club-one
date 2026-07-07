// lib/reviewsData.ts — modèle de données SAISIE STAFF du module RÉPUTATION & AVIS (B14), logique PURE.
//
// Connecteur externe (Google Business / Meta / Tripadvisor API) : PRÊT À CONNECTER — NON ACTIVÉ. À la
// place, la direction SAISIT les avis (table `reviews`, migration 0064). Ces helpers convertissent une
// ligne DB vers le type `Review` du composant présentationnel (lib/reputation) — AUCUN réseau, AUCUNE
// horloge implicite (`new Date()`/`Date.now()`), AUCUN avis/note/sentiment fabriqué.
//
// FRICTION ASSUMÉE : le tableau de bord présentationnel (lib/reputation) ne modélise QUE `google` et
// `meta`. Les avis `tripadvisor`/`autre` sont STOCKÉS et GÉRÉS (saisie/réponse/statut) mais restent HORS
// de l'agrégat Google/Meta — jamais déguisés en Google (honnêteté : pas de fausse plateforme). Le
// conteneur (ReputationTab) affiche un décompte honnête de ces avis hors agrégat.

import type { Review, ReviewPlatform } from "./reputation.ts";

// ————————————————————————————————————————————————————————————————
// Sources persistées — reviews.source (migration 0064).
// ————————————————————————————————————————————————————————————————
export const REVIEW_SOURCES = ["google", "meta", "tripadvisor", "autre"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

const SOURCE_LABELS: Record<ReviewSource, string> = {
  google: "Google Business",
  meta: "Meta (Facebook)",
  tripadvisor: "Tripadvisor",
  autre: "Autre",
};

export function reviewSourceLabel(source: ReviewSource): string {
  return SOURCE_LABELS[source];
}

// ————————————————————————————————————————————————————————————————
// Statuts persistés — reviews.status (sous-ensemble du pipeline du board : pas de `en_cours` en base).
// ————————————————————————————————————————————————————————————————
export const DB_REVIEW_STATUSES = ["nouveau", "repondu", "ignore"] as const;
export type DbReviewStatus = (typeof DB_REVIEW_STATUSES)[number];

const DB_STATUS_LABELS: Record<DbReviewStatus, string> = {
  nouveau: "Nouveau",
  repondu: "Répondu",
  ignore: "Ignoré",
};

export function dbReviewStatusLabel(status: DbReviewStatus): string {
  return DB_STATUS_LABELS[status];
}

// ————————————————————————————————————————————————————————————————
// Ligne brute de la table `reviews` (migration 0064).
// ————————————————————————————————————————————————————————————————
export type ReviewRecord = {
  id: string;
  source: ReviewSource;
  rating: number | null;
  author: string;
  body: string | null;
  review_date: string | null; // date 'YYYY-MM-DD'
  status: DbReviewStatus;
  response: string | null;
  created_by: string | null;
  created_at: string; // timestamptz ISO
};

// Le board présentationnel ne modélise QUE google/meta. Prédicat de rétrécissement de type.
export function isBoardPlatform(source: ReviewSource): source is ReviewPlatform {
  return source === "google" || source === "meta";
}

// Convertit une date 'YYYY-MM-DD' en ISO (minuit UTC). null/illisible → null (jamais de date fabriquée).
// N'utilise Date QUE pour parser une chaîne DÉJÀ fournie, jamais l'horloge.
export function reviewDateToIso(date: string | null): string | null {
  if (!date) return null;
  const ms = new Date(`${date}T00:00:00.000Z`).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// Convertit une ligne DB en `Review` du board — UNIQUEMENT pour google/meta (le board ne modélise pas
// tripadvisor/autre). Retourne null sinon : ces avis restent gérés hors agrégat, jamais déguisés.
export function recordToBoardReview(rec: ReviewRecord): Review | null {
  if (!isBoardPlatform(rec.source)) return null;
  // Ancienneté calculée sur la date de l'avis ; repli sur created_at si la date est absente.
  const postedAt = reviewDateToIso(rec.review_date) ?? rec.created_at;
  const hasResponse = !!(rec.response && rec.response.trim());
  return {
    id: rec.id,
    platform: rec.source,
    author: rec.author,
    rating: rec.rating, // null si non noté — jamais fabriqué
    sentiment: null, // aucun champ sentiment en base → le board déduit de la note, sinon `inconnu`
    text: rec.body,
    status: rec.status, // nouveau|repondu|ignore ⊂ statuts du board
    postedAt,
    respondedAt: null, // on n'horodate pas la réponse en base → jamais un faux instant de réponse
    // Un brouillon existe si une réponse est saisie mais l'avis n'est pas encore marqué répondu.
    hasDraft: rec.status !== "repondu" && hasResponse,
    permalink: null, // aucun lien profond stocké → refus honnête côté board (pas de lien fabriqué)
  };
}

// Convertit un lot de lignes DB → Review[] du board (les sources non modélisées sont écartées).
export function recordsToBoardReviews(recs: ReviewRecord[]): Review[] {
  const out: Review[] = [];
  for (const rec of recs) {
    const b = recordToBoardReview(rec);
    if (b) out.push(b);
  }
  return out;
}

// Nombre d'avis dont la source n'est PAS modélisée par le board (tripadvisor/autre). Sert au conteneur
// pour afficher honnêtement « N avis hors agrégat Google/Meta ».
export function offBoardCount(recs: ReviewRecord[]): number {
  return recs.filter((r) => !isBoardPlatform(r.source)).length;
}

// ————————————————————————————————————————————————————————————————
// Validation d'une saisie d'avis (formulaire staff). Pur, sans réseau.
// ————————————————————————————————————————————————————————————————
export type NewReviewDraft = {
  source: string;
  rating: string; // brut du champ (peut être vide)
  author: string;
  body: string;
  review_date: string; // 'YYYY-MM-DD' ou vide
};

export type NewReviewValue = {
  source: ReviewSource;
  rating: number | null;
  author: string;
  body: string | null;
  review_date: string | null;
};

export type NewReviewCheck =
  | { ok: true; value: NewReviewValue }
  | { ok: false; message: string };

export function validateNewReview(draft: NewReviewDraft): NewReviewCheck {
  const author = draft.author.trim();
  if (!author) return { ok: false, message: "Nom de l'auteur requis." };

  if (!(REVIEW_SOURCES as readonly string[]).includes(draft.source)) {
    return { ok: false, message: "Source inconnue." };
  }

  let rating: number | null = null;
  const rt = draft.rating.trim();
  if (rt) {
    const n = Number(rt);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return { ok: false, message: "La note doit être un entier de 1 à 5 (ou vide)." };
    }
    rating = n;
  }

  return {
    ok: true,
    value: {
      source: draft.source as ReviewSource,
      rating,
      author,
      body: draft.body.trim() || null,
      review_date: draft.review_date.trim() || null,
    },
  };
}
