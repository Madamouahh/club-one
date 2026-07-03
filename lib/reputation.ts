// lib/reputation.ts — logique PURE du module RÉPUTATION & AVIS (B14), aucun accès réseau.
//
// B14 est un écran DIRECTION/COM du plan maître (CLUB_ONE_OS_MASTER §2 « B14. RÉPUTATION & AVIS »,
// matrice §3.1 : Direction, com · P2). Sa mission :
//   · agréger les avis Google Business / Meta (note, sentiment, ancienneté) ;
//   · surfacer les ALERTES (avis négatifs en attente) et le retard de réponse (objectif < 48 h) ;
//   · préparer une réponse HUMAINE (reco de réponse validée, jamais publiée automatiquement).
//
// QUATRE principes DURS (gouvernance Club One) :
//   1. AUCUN AVIS INVENTÉ. Ce module N'INVENTE aucun avis, aucune note, aucun sentiment. Tous les avis
//      viennent de l'appelant (connecteur Google/Meta réel). Sans avis réel, le module ship VIDE — un
//      état vide honnête, jamais un faux « 5 étoiles » ni une note fabriquée.
//   2. SENTIMENT NON DEVINÉ. Le sentiment vient d'un champ EXPLICITE fourni par le connecteur, ou — à
//      défaut — se déduit UNIQUEMENT d'une note numérique présente (1-2 négatif, 3 neutre, 4-5 positif).
//      Aucune analyse du texte libre : sans note ni sentiment explicite, le sentiment reste `inconnu`
//      (jamais supposé « neutre » ou « positif »). La source du sentiment est tracée (`sentimentSource`).
//   3. RÉPONSE = GESTE HUMAIN. La « reco réponse (IA, validée) » reste un BROUILLON. Le statut `repondu`
//      n'est posé QUE lorsqu'un humain a validé (respondedAt fourni). On répond sur la plateforme
//      elle-même : ce module PRÉPARE un lien vers l'avis (permalink) que l'humain ouvre — il ne publie
//      JAMAIS rien, et n'injecte aucun texte (loi Evin : aucune mention d'alcool ajoutée par l'outil).
//   4. SLA HONNÊTE. Le retard se calcule UNIQUEMENT contre un instant de référence fourni (`nowIso`).
//      Sans référence, aucun retard n'est affirmé. Un avis déjà répondu/ignoré n'est jamais « en retard ».
//
// PURETÉ : aucun `new Date()` / `Date.now()` implicite — l'instant de référence est une entrée.
// (Le parseur ISO n'utilise `Date` que pour convertir des chaînes DÉJÀ fournies, jamais l'horloge.)

import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — B14 = écran DIRECTION / COM (matrice plan §3.1)
// ————————————————————————————————————————————————————————————————
//
// Les avis exposent des noms d'auteurs et le e-réputation du complexe : écran réservé à la direction
// (admin/manager). Ce prédicat reflète le périmètre direction côté UI — ce n'est PAS la sécurité (la
// vraie garde reste la RLS de la table d'avis, quand le connecteur réel sera branché).
export function canViewReputation(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// Qui peut VALIDER une réponse (poser `repondu` / ouvrir le lien de réponse plateforme). Même palier
// que la consultation : direction/com. La validation reste un geste HUMAIN — jamais une publication auto.
export function canReplyReputation(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// Plateformes d'avis — Google Business / Meta (plan B14). Liste ORDONNÉE (ordre d'affichage canonique).
// ————————————————————————————————————————————————————————————————
export const REVIEW_PLATFORMS = ["google", "meta"] as const;
export type ReviewPlatform = (typeof REVIEW_PLATFORMS)[number];

const PLATFORM_LABELS: Record<ReviewPlatform, string> = {
  google: "Google Business",
  meta: "Meta (Facebook)",
};

export function reviewPlatformLabel(platform: ReviewPlatform): string {
  return PLATFORM_LABELS[platform];
}

// ————————————————————————————————————————————————————————————————
// Sentiment — provient d'un champ explicite ou d'une note ; jamais deviné depuis le texte libre.
// ————————————————————————————————————————————————————————————————
export const SENTIMENTS = ["positif", "neutre", "negatif", "inconnu"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positif: "Positif",
  neutre: "Neutre",
  negatif: "Négatif",
  inconnu: "Non qualifié",
};

export function sentimentLabel(sentiment: Sentiment): string {
  return SENTIMENT_LABELS[sentiment];
}

// D'où vient le sentiment retenu : champ explicite du connecteur, déduit d'une note, ou inconnu.
export type SentimentSource = "explicit" | "rating" | "unknown";

// Déduction du sentiment depuis une note — UNIQUEMENT si une note valide (1..5) est présente.
// Aucune note (null / hors bornes) ⇒ null (on ne fabrique aucun sentiment). Jamais d'analyse de texte.
export function ratingToSentiment(rating: number | null | undefined): Sentiment | null {
  if (rating === null || rating === undefined || Number.isNaN(rating)) return null;
  if (rating < 1 || rating > 5) return null;
  if (rating <= 2) return "negatif";
  if (rating < 4) return "neutre"; // 3
  return "positif"; // 4-5
}

// Sentiment retenu pour un avis + sa source. Priorité : champ explicite du connecteur → note → inconnu.
export function resolveSentiment(review: Pick<Review, "sentiment" | "rating">): {
  sentiment: Sentiment;
  source: SentimentSource;
} {
  if (review.sentiment && review.sentiment !== "inconnu") {
    return { sentiment: review.sentiment, source: "explicit" };
  }
  const fromRating = ratingToSentiment(review.rating);
  if (fromRating !== null) return { sentiment: fromRating, source: "rating" };
  return { sentiment: "inconnu", source: "unknown" };
}

// ————————————————————————————————————————————————————————————————
// Statuts — pipeline de réponse à un avis. `repondu` n'est JAMAIS automatique.
// ————————————————————————————————————————————————————————————————
export const REVIEW_STATUSES = ["nouveau", "en_cours", "repondu", "ignore"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const STATUS_LABELS: Record<ReviewStatus, string> = {
  nouveau: "Nouveau",
  en_cours: "En cours",
  repondu: "Répondu",
  ignore: "Ignoré",
};

export function reviewStatusLabel(status: ReviewStatus): string {
  return STATUS_LABELS[status];
}

// Un avis « en attente » (nouveau ou en cours) réclame une action humaine. Répondu/ignoré = traité.
const WAITING_STATUSES: ReadonlySet<ReviewStatus> = new Set<ReviewStatus>(["nouveau", "en_cours"]);

export function isWaitingStatus(status: ReviewStatus): boolean {
  return WAITING_STATUSES.has(status);
}

// ————————————————————————————————————————————————————————————————
// SLA de réponse — objectif < 48 h (plan B14). Un avis NÉGATIF est plus urgent (24 h, alerte).
// Valeurs de TRAVAIL réglables par le fondateur. Le SLA d'un avis dépend de son sentiment résolu.
// ————————————————————————————————————————————————————————————————
export const SENTIMENT_SLA_HOURS: Record<Sentiment, number> = {
  negatif: 24,
  neutre: 48,
  positif: 48,
  inconnu: 48,
};

export function slaForSentiment(sentiment: Sentiment): number {
  return SENTIMENT_SLA_HOURS[sentiment];
}

// ————————————————————————————————————————————————————————————————
// Entrée — un avis tel que remonté par le connecteur Google/Meta (déjà filtré par la RLS en réel).
// ————————————————————————————————————————————————————————————————
export type Review = {
  id: string;
  platform: ReviewPlatform;
  author: string; // nom d'affichage de l'auteur (public sur la plateforme)
  // Note en étoiles 1..5. null si la plateforme n'en fournit pas (ex. recommandation Meta binaire).
  rating?: number | null;
  // Sentiment EXPLICITE du connecteur, s'il en fournit un. Sinon on déduit de la note, sinon inconnu.
  sentiment?: Sentiment | null;
  // Corps de l'avis. JAMAIS analysé pour deviner un sentiment — affichage seulement.
  text?: string | null;
  status: ReviewStatus;
  postedAt: string; // ISO 8601
  // Posé par un humain à la validation. null tant que non répondu. Sert au délai de réponse.
  respondedAt?: string | null;
  // Un brouillon de réponse (reco IA/humaine) existe — JAMAIS publié automatiquement.
  hasDraft: boolean;
  // Lien direct vers l'avis sur sa plateforme, pour y répondre à la main. null ⇒ refus honnête.
  permalink?: string | null;
};

export type ReputationInput = {
  reviews: Review[];
  // Instant de référence pour le calcul du retard. null/absent ⇒ aucun retard affirmé (SLA non calculable).
  nowIso?: string | null;
};

// ————————————————————————————————————————————————————————————————
// Sortie
// ————————————————————————————————————————————————————————————————
export type ReviewRow = Review & {
  sentiment: Sentiment;
  sentimentSource: SentimentSource;
  respondedAt: string | null;
  // Âge en heures depuis la publication (null si nowIso absent ou date illisible — jamais fabriqué).
  ageHours: number | null;
  waiting: boolean; // nouveau|en_cours
  slaHours: number; // dépend du sentiment résolu
  // En attente ET au-delà du SLA. false si déjà traité, si nowIso absent, ou date illisible.
  overdue: boolean;
  // Avis négatif ET en attente : demande une réponse prioritaire (alerte du plan B14).
  alerte: boolean;
};

export type PlatformSummary = {
  platform: ReviewPlatform;
  label: string;
  total: number;
  waiting: number;
  overdue: number;
  alertes: number;
  ratedCount: number;
  // Moyenne des notes de CETTE plateforme, ou null si aucun avis noté (jamais fabriquée).
  avgRating: number | null;
};

export type ReputationView = {
  rows: ReviewRow[]; // triés : en attente d'abord, négatifs prioritaires, puis les plus anciens
  byPlatform: PlatformSummary[]; // ordre canonique REVIEW_PLATFORMS
  bySentiment: Record<Sentiment, number>;
  byStatus: Record<ReviewStatus, number>;
  totals: {
    total: number;
    waiting: number;
    overdue: number;
    repondu: number;
    ignore: number;
    withDraft: number;
    // Avis négatifs en attente — les alertes du plan B14.
    alertes: number;
    ratedCount: number;
    // Note moyenne globale sur les avis NOTÉS, ou null si aucun (jamais fabriquée).
    avgRating: number | null;
    // Taux de réponse : répondu / (avis traitables = total - ignorés), ou null si aucun traitable.
    responseRate: number | null;
  };
  // La note moyenne n'existe que s'il y a au moins un avis noté.
  ratingComputable: boolean;
  // Le retard n'est calculé que si un instant de référence est fourni. Sinon : non calculable.
  slaComputable: boolean;
};

// ————————————————————————————————————————————————————————————————
// Helpers purs
// ————————————————————————————————————————————————————————————————

// Convertit une date ISO en millisecondes, ou null si illisible. N'utilise Date QUE pour parser une
// chaîne DÉJÀ fournie (jamais l'horloge). NaN → null (on ne fabrique aucun délai à partir d'un rebut).
function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function emptyBySentiment(): Record<Sentiment, number> {
  return { positif: 0, neutre: 0, negatif: 0, inconnu: 0 };
}

function emptyByStatus(): Record<ReviewStatus, number> {
  return { nouveau: 0, en_cours: 0, repondu: 0, ignore: 0 };
}

function buildRow(review: Review, nowMs: number | null): ReviewRow {
  const { sentiment, source } = resolveSentiment(review);
  const slaHours = slaForSentiment(sentiment);
  const respondedAt = review.respondedAt ?? null;
  const waiting = isWaitingStatus(review.status);

  // Âge : uniquement si l'instant de référence ET la date de publication sont exploitables.
  const postedMs = parseIsoMs(review.postedAt);
  const ageHours =
    nowMs !== null && postedMs !== null ? Math.max(0, (nowMs - postedMs) / 3_600_000) : null;

  // Retard : en attente ET au-delà du SLA. Jamais pour un avis traité, jamais sans âge calculable.
  const overdue = waiting && ageHours !== null && ageHours > slaHours;
  // Alerte : avis négatif en attente (indépendant du SLA — un négatif frais est déjà une alerte).
  const alerte = waiting && sentiment === "negatif";

  return {
    ...review,
    sentiment,
    sentimentSource: source,
    respondedAt,
    ageHours,
    waiting,
    slaHours,
    overdue,
    alerte,
  };
}

// Ordre d'affichage : d'abord ce qui attend une action (nouveau, en_cours), puis le traité ; parmi
// l'attente, le NÉGATIF d'abord (alerte prioritaire), puis le moins qualifié ; à égalité, le plus
// ANCIEN d'abord (l'attente la plus longue remonte) ; départage stable par id.
const STATUS_ORDER: Record<ReviewStatus, number> = {
  nouveau: 0,
  en_cours: 1,
  repondu: 2,
  ignore: 3,
};

const SENTIMENT_SEVERITY: Record<Sentiment, number> = {
  negatif: 0,
  inconnu: 1,
  neutre: 2,
  positif: 3,
};

function compareRows(a: ReviewRow, b: ReviewRow): number {
  const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (s !== 0) return s;
  const sev = SENTIMENT_SEVERITY[a.sentiment] - SENTIMENT_SEVERITY[b.sentiment];
  if (sev !== 0) return sev;
  const am = parseIsoMs(a.postedAt);
  const bm = parseIsoMs(b.postedAt);
  // Les dates illisibles tombent en fin (elles ne peuvent pas revendiquer une ancienneté).
  if (am === null && bm === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (am === null) return 1;
  if (bm === null) return -1;
  if (am !== bm) return am - bm;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Moyenne des notes valides (1..5) d'un lot d'avis, ou null si aucune note (jamais fabriquée).
function averageRating(reviews: Pick<Review, "rating">[]): { avg: number | null; count: number } {
  let sum = 0;
  let count = 0;
  for (const r of reviews) {
    const v = r.rating;
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    if (v < 1 || v > 5) continue;
    sum += v;
    count += 1;
  }
  return { avg: count > 0 ? sum / count : null, count };
}

// ————————————————————————————————————————————————————————————————
// Construction de la vue
// ————————————————————————————————————————————————————————————————
export function buildReputationView(input: ReputationInput): ReputationView {
  const nowMs = parseIsoMs(input.nowIso);
  const slaComputable = nowMs !== null;

  const rows = input.reviews.map((r) => buildRow(r, nowMs)).sort(compareRows);

  const bySentiment = emptyBySentiment();
  const byStatus = emptyByStatus();
  for (const row of rows) {
    bySentiment[row.sentiment] += 1;
    byStatus[row.status] += 1;
  }

  const byPlatform: PlatformSummary[] = REVIEW_PLATFORMS.map((platform) => {
    const prows = rows.filter((r) => r.platform === platform);
    const { avg, count } = averageRating(prows);
    return {
      platform,
      label: PLATFORM_LABELS[platform],
      total: prows.length,
      waiting: prows.filter((r) => r.waiting).length,
      overdue: prows.filter((r) => r.overdue).length,
      alertes: prows.filter((r) => r.alerte).length,
      ratedCount: count,
      avgRating: avg,
    };
  });

  const { avg: avgRating, count: ratedCount } = averageRating(rows);
  const repondu = byStatus.repondu;
  const ignore = byStatus.ignore;
  const answerable = rows.length - ignore; // avis traitables (les ignorés ne comptent pas)
  const responseRate = answerable > 0 ? repondu / answerable : null;

  const totals = {
    total: rows.length,
    waiting: rows.filter((r) => r.waiting).length,
    overdue: rows.filter((r) => r.overdue).length,
    repondu,
    ignore,
    withDraft: rows.filter((r) => r.hasDraft).length,
    alertes: rows.filter((r) => r.alerte).length,
    ratedCount,
    avgRating,
    responseRate,
  };

  return {
    rows,
    byPlatform,
    bySentiment,
    byStatus,
    totals,
    ratingComputable: ratedCount > 0,
    slaComputable,
  };
}

// ————————————————————————————————————————————————————————————————
// Préparation d'un lien de RÉPONSE (aucune publication) — la « Valider & répondre » HUMAINE.
// ————————————————————————————————————————————————————————————————
//
// On répond à un avis SUR sa plateforme (Google Business / Meta) : l'API ne préremplit pas le texte.
// Ce module PRÉPARE donc l'ouverture de l'avis (permalink) que l'humain ouvre pour rédiger sa réponse
// à la main. Aucun texte n'est injecté (loi Evin : aucune mention d'alcool ajoutée par l'outil).
// Sans lien exploitable, refus honnête — jamais de publication fabriquée.
export type ReviewReplyPrep =
  | { ok: true; platform: ReviewPlatform; url: string }
  | { ok: false; reason: "aucun_lien" };

export function prepareReviewReplyLink(
  review: Pick<Review, "platform" | "permalink">,
): ReviewReplyPrep {
  const link = review.permalink?.trim() || null;
  if (link) return { ok: true, platform: review.platform, url: link };
  return { ok: false, reason: "aucun_lien" };
}

// ————————————————————————————————————————————————————————————————
// Formatage FR déterministe (aucune dépendance au fuseau/à l'horloge)
// ————————————————————————————————————————————————————————————————

// Âge d'attente en texte court ; null → « — » (non calculable, jamais fabriqué).
export function formatAge(ageHours: number | null): string {
  if (ageHours === null) return "—";
  if (ageHours < 1) return "< 1 h";
  if (ageHours < 48) return `${Math.floor(ageHours)} h`;
  return `${Math.floor(ageHours / 24)} j`;
}

// Note moyenne « x,y / 5 » (FR, virgule) ; null → « — » (aucun avis noté, jamais fabriquée).
export function formatRating(avg: number | null): string {
  if (avg === null) return "—";
  return `${avg.toFixed(1).replace(".", ",")} / 5`;
}

// Taux de réponse en pourcentage entier « x % » ; null → « — » (aucun avis traitable).
export function formatResponseRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)} %`;
}
