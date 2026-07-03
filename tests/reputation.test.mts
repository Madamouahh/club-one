import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_PLATFORMS,
  REVIEW_STATUSES,
  SENTIMENTS,
  SENTIMENT_SLA_HOURS,
  buildReputationView,
  canReplyReputation,
  canViewReputation,
  formatAge,
  formatRating,
  formatResponseRate,
  isWaitingStatus,
  prepareReviewReplyLink,
  ratingToSentiment,
  resolveSentiment,
  reviewPlatformLabel,
  reviewStatusLabel,
  sentimentLabel,
  slaForSentiment,
  type Review,
} from "../lib/reputation.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

const REF_NOW = "2026-07-03T20:00:00.000Z";

function review(over: Partial<Review> = {}): Review {
  return {
    id: over.id ?? "r",
    platform: over.platform ?? "google",
    author: over.author ?? "Auteur démo",
    rating: over.rating,
    sentiment: over.sentiment,
    text: over.text,
    status: over.status ?? "nouveau",
    postedAt: over.postedAt ?? "2026-07-03T18:00:00.000Z",
    respondedAt: over.respondedAt,
    hasDraft: over.hasDraft ?? false,
    permalink: over.permalink,
  };
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle : B14 = direction/com. admin/manager OUI ; le reste ⛔.
// ————————————————————————————————————————————————————————————————
test("canViewReputation : admin/manager OUI ; employés/promoteur NON", () => {
  assert.equal(canViewReputation("admin"), true);
  assert.equal(canViewReputation("manager"), true);
  for (const role of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canViewReputation(role), false, `${role} ne doit PAS voir la réputation`);
  }
});

test("canReplyReputation : admin/manager peuvent valider une réponse ; le reste NON", () => {
  assert.equal(canReplyReputation("admin"), true);
  assert.equal(canReplyReputation("manager"), true);
  for (const role of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canReplyReputation(role), false);
  }
});

test("les gardes couvrent tous les rôles connus sans exception", () => {
  for (const role of STAFF_ROLES) {
    assert.equal(typeof canViewReputation(role), "boolean");
    assert.equal(typeof canReplyReputation(role), "boolean");
  }
});

// ————————————————————————————————————————————————————————————————
// Étiquettes — chaque plateforme / sentiment / statut a un libellé.
// ————————————————————————————————————————————————————————————————
test("chaque plateforme/sentiment/statut connu a un libellé string", () => {
  for (const p of REVIEW_PLATFORMS) assert.equal(typeof reviewPlatformLabel(p), "string");
  for (const s of SENTIMENTS) assert.equal(typeof sentimentLabel(s), "string");
  for (const st of REVIEW_STATUSES) assert.equal(typeof reviewStatusLabel(st), "string");
});

// ————————————————————————————————————————————————————————————————
// Sentiment : déduit d'une note présente, JAMAIS deviné depuis le texte.
// ————————————————————————————————————————————————————————————————
test("ratingToSentiment : 1-2 négatif, 3 neutre, 4-5 positif", () => {
  assert.equal(ratingToSentiment(1), "negatif");
  assert.equal(ratingToSentiment(2), "negatif");
  assert.equal(ratingToSentiment(3), "neutre");
  assert.equal(ratingToSentiment(4), "positif");
  assert.equal(ratingToSentiment(5), "positif");
});

test("ratingToSentiment : note absente ou hors bornes → null (aucun sentiment fabriqué)", () => {
  assert.equal(ratingToSentiment(null), null);
  assert.equal(ratingToSentiment(undefined), null);
  assert.equal(ratingToSentiment(0), null);
  assert.equal(ratingToSentiment(6), null);
  assert.equal(ratingToSentiment(Number.NaN), null);
});

test("resolveSentiment : champ explicite prioritaire, source=explicit", () => {
  assert.deepEqual(resolveSentiment({ sentiment: "positif", rating: 1 }), {
    sentiment: "positif",
    source: "explicit",
  });
});

test("resolveSentiment : pas de champ explicite → déduit de la note, source=rating", () => {
  assert.deepEqual(resolveSentiment({ sentiment: null, rating: 2 }), {
    sentiment: "negatif",
    source: "rating",
  });
  assert.deepEqual(resolveSentiment({ sentiment: "inconnu", rating: 5 }), {
    sentiment: "positif",
    source: "rating",
  });
});

test("resolveSentiment : ni champ ni note → inconnu, source=unknown (jamais deviné du texte)", () => {
  assert.deepEqual(resolveSentiment({ sentiment: null, rating: null }), {
    sentiment: "inconnu",
    source: "unknown",
  });
  assert.deepEqual(resolveSentiment({}), { sentiment: "inconnu", source: "unknown" });
});

// ————————————————————————————————————————————————————————————————
// Statuts + SLA
// ————————————————————————————————————————————————————————————————
test("isWaitingStatus : nouveau/en_cours en attente ; repondu/ignore traités", () => {
  assert.equal(isWaitingStatus("nouveau"), true);
  assert.equal(isWaitingStatus("en_cours"), true);
  assert.equal(isWaitingStatus("repondu"), false);
  assert.equal(isWaitingStatus("ignore"), false);
});

test("slaForSentiment : négatif 24 h (plus urgent), les autres 48 h", () => {
  assert.equal(slaForSentiment("negatif"), 24);
  assert.equal(slaForSentiment("neutre"), 48);
  assert.equal(slaForSentiment("positif"), 48);
  assert.equal(slaForSentiment("inconnu"), 48);
  for (const s of SENTIMENTS) assert.equal(SENTIMENT_SLA_HOURS[s], slaForSentiment(s));
});

// ————————————————————————————————————————————————————————————————
// Construction de la vue — âge / retard / alerte honnêtes
// ————————————————————————————————————————————————————————————————
test("buildReputationView : âge calculé contre nowIso", () => {
  const v = buildReputationView({
    reviews: [review({ id: "a", postedAt: "2026-07-03T18:00:00.000Z" })],
    nowIso: REF_NOW,
  });
  assert.equal(v.rows[0].ageHours, 2);
  assert.equal(v.slaComputable, true);
});

test("buildReputationView : sans nowIso, âge null et retard non calculable (jamais fabriqué)", () => {
  const v = buildReputationView({
    reviews: [review({ id: "a", rating: 1, status: "nouveau", postedAt: "2026-06-01T00:00:00.000Z" })],
  });
  assert.equal(v.slaComputable, false);
  assert.equal(v.rows[0].ageHours, null);
  assert.equal(v.rows[0].overdue, false, "aucun retard sans instant de référence");
  // Mais l'alerte (négatif en attente) NE dépend PAS du SLA : elle reste vraie.
  assert.equal(v.rows[0].alerte, true);
});

test("buildReputationView : négatif en attente au-delà de 24 h → en retard", () => {
  const v = buildReputationView({
    reviews: [review({ id: "a", rating: 1, status: "nouveau", postedAt: "2026-07-02T10:00:00.000Z" })],
    nowIso: REF_NOW, // ~34 h > SLA 24 h
  });
  assert.equal(v.rows[0].sentiment, "negatif");
  assert.equal(v.rows[0].overdue, true);
  assert.equal(v.rows[0].alerte, true);
});

test("buildReputationView : positif récent en attente → pas en retard, pas d'alerte", () => {
  const v = buildReputationView({
    reviews: [review({ id: "a", rating: 5, status: "nouveau", postedAt: "2026-07-03T18:00:00.000Z" })],
    nowIso: REF_NOW,
  });
  assert.equal(v.rows[0].overdue, false);
  assert.equal(v.rows[0].alerte, false);
});

test("buildReputationView : avis déjà répondu → jamais en retard ni en alerte", () => {
  const v = buildReputationView({
    reviews: [
      review({
        id: "a",
        rating: 1,
        status: "repondu",
        postedAt: "2026-06-01T00:00:00.000Z",
        respondedAt: "2026-06-01T05:00:00.000Z",
      }),
    ],
    nowIso: REF_NOW,
  });
  assert.equal(v.rows[0].overdue, false);
  assert.equal(v.rows[0].alerte, false);
  assert.equal(v.rows[0].waiting, false);
});

test("buildReputationView : date de publication illisible → âge null, pas de retard fabriqué", () => {
  const v = buildReputationView({
    reviews: [review({ id: "a", rating: 1, status: "nouveau", postedAt: "pas-une-date" })],
    nowIso: REF_NOW,
  });
  assert.equal(v.rows[0].ageHours, null);
  assert.equal(v.rows[0].overdue, false);
});

// ————————————————————————————————————————————————————————————————
// Note moyenne : sur les avis NOTÉS uniquement, null si aucun (jamais fabriquée)
// ————————————————————————————————————————————————————————————————
test("buildReputationView : moyenne sur les notes présentes, ignore les avis sans note", () => {
  const v = buildReputationView({
    reviews: [
      review({ id: "a", rating: 4 }),
      review({ id: "b", rating: 2 }),
      review({ id: "c", rating: null }), // sans note → ignoré du calcul
    ],
    nowIso: REF_NOW,
  });
  assert.equal(v.totals.ratedCount, 2);
  assert.equal(v.totals.avgRating, 3);
  assert.equal(v.ratingComputable, true);
});

test("buildReputationView : aucun avis noté → moyenne null, ratingComputable false", () => {
  const v = buildReputationView({
    reviews: [review({ id: "a", rating: null, sentiment: "positif" })],
    nowIso: REF_NOW,
  });
  assert.equal(v.totals.avgRating, null);
  assert.equal(v.totals.ratedCount, 0);
  assert.equal(v.ratingComputable, false);
});

// ————————————————————————————————————————————————————————————————
// Compteurs, alertes, taux de réponse
// ————————————————————————————————————————————————————————————————
test("buildReputationView : compteurs globaux et alertes", () => {
  const v = buildReputationView({
    reviews: [
      review({ id: "a", rating: 1, status: "nouveau" }), // négatif en attente → alerte
      review({ id: "b", rating: 2, status: "en_cours" }), // négatif en attente → alerte
      review({ id: "c", rating: 5, status: "repondu", respondedAt: REF_NOW }),
      review({ id: "d", rating: 3, status: "ignore" }),
      review({ id: "e", rating: 4, status: "nouveau", hasDraft: true }),
    ],
    nowIso: REF_NOW,
  });
  assert.equal(v.totals.total, 5);
  assert.equal(v.totals.waiting, 3); // a, b, e
  assert.equal(v.totals.alertes, 2); // a, b
  assert.equal(v.totals.repondu, 1);
  assert.equal(v.totals.ignore, 1);
  assert.equal(v.totals.withDraft, 1);
  // Taux de réponse : répondu / (total - ignorés) = 1/4
  assert.equal(v.totals.responseRate, 0.25);
});

test("buildReputationView : que des ignorés → responseRate null (aucun traitable)", () => {
  const v = buildReputationView({
    reviews: [review({ id: "a", status: "ignore" }), review({ id: "b", status: "ignore" })],
    nowIso: REF_NOW,
  });
  assert.equal(v.totals.responseRate, null);
});

test("buildReputationView : bySentiment et byStatus comptent tout", () => {
  const v = buildReputationView({
    reviews: [
      review({ id: "a", rating: 1 }),
      review({ id: "b", rating: 3 }),
      review({ id: "c", rating: 5 }),
      review({ id: "d", rating: null }), // inconnu
    ],
    nowIso: REF_NOW,
  });
  assert.deepEqual(v.bySentiment, { positif: 1, neutre: 1, negatif: 1, inconnu: 1 });
  assert.equal(v.byStatus.nouveau, 4);
});

// ————————————————————————————————————————————————————————————————
// Résumé par plateforme
// ————————————————————————————————————————————————————————————————
test("buildReputationView : byPlatform en ordre canonique, moyenne par plateforme", () => {
  const v = buildReputationView({
    reviews: [
      review({ id: "a", platform: "google", rating: 4 }),
      review({ id: "b", platform: "google", rating: 2, status: "nouveau" }),
      review({ id: "c", platform: "meta", rating: null, sentiment: "positif" }),
    ],
    nowIso: REF_NOW,
  });
  assert.deepEqual(
    v.byPlatform.map((p) => p.platform),
    ["google", "meta"],
  );
  const google = v.byPlatform.find((p) => p.platform === "google")!;
  assert.equal(google.total, 2);
  assert.equal(google.ratedCount, 2);
  assert.equal(google.avgRating, 3); // (4+2)/2
  const meta = v.byPlatform.find((p) => p.platform === "meta")!;
  assert.equal(meta.total, 1);
  assert.equal(meta.ratedCount, 0);
  assert.equal(meta.avgRating, null, "Meta sans note → moyenne null, jamais fabriquée");
});

// ————————————————————————————————————————————————————————————————
// Tri : en attente d'abord, négatifs prioritaires, plus anciens ensuite
// ————————————————————————————————————————————————————————————————
test("buildReputationView : les négatifs en attente remontent avant les positifs, traités en bas", () => {
  const v = buildReputationView({
    reviews: [
      review({ id: "pos", rating: 5, status: "nouveau", postedAt: "2026-07-03T19:00:00.000Z" }),
      review({ id: "done", rating: 1, status: "repondu", respondedAt: REF_NOW, postedAt: "2026-07-03T10:00:00.000Z" }),
      review({ id: "neg", rating: 1, status: "nouveau", postedAt: "2026-07-03T19:30:00.000Z" }),
    ],
    nowIso: REF_NOW,
  });
  assert.deepEqual(
    v.rows.map((r) => r.id),
    ["neg", "pos", "done"],
  );
});

// ————————————————————————————————————————————————————————————————
// Préparation du lien de réponse — jamais de publication, refus honnête sans lien
// ————————————————————————————————————————————————————————————————
test("prepareReviewReplyLink : permalink présent → ok avec l'URL de la plateforme", () => {
  const prep = prepareReviewReplyLink({ platform: "google", permalink: "https://g.page/r/xxx" });
  assert.deepEqual(prep, { ok: true, platform: "google", url: "https://g.page/r/xxx" });
});

test("prepareReviewReplyLink : aucun lien → refus honnête (jamais de publication fabriquée)", () => {
  assert.deepEqual(prepareReviewReplyLink({ platform: "meta", permalink: null }), {
    ok: false,
    reason: "aucun_lien",
  });
  assert.deepEqual(prepareReviewReplyLink({ platform: "meta", permalink: "   " }), {
    ok: false,
    reason: "aucun_lien",
  });
});

// ————————————————————————————————————————————————————————————————
// Formatage FR déterministe
// ————————————————————————————————————————————————————————————————
test("formatAge : seuils heures/jours, null → « — »", () => {
  assert.equal(formatAge(null), "—");
  assert.equal(formatAge(0.5), "< 1 h");
  assert.equal(formatAge(5), "5 h");
  assert.equal(formatAge(50), "2 j");
});

test("formatRating : « x,y / 5 » avec virgule FR, null → « — »", () => {
  assert.equal(formatRating(null), "—");
  assert.equal(formatRating(4.25), "4,3 / 5");
  assert.equal(formatRating(3), "3,0 / 5");
});

test("formatResponseRate : pourcentage entier, null → « — »", () => {
  assert.equal(formatResponseRate(null), "—");
  assert.equal(formatResponseRate(0.25), "25 %");
  assert.equal(formatResponseRate(1), "100 %");
});

// ————————————————————————————————————————————————————————————————
// État vide honnête — le module ship VIDE sans avis réel
// ————————————————————————————————————————————————————————————————
test("buildReputationView : aucun avis → tout à zéro, aucune note/alerte fabriquée", () => {
  const v = buildReputationView({ reviews: [], nowIso: REF_NOW });
  assert.equal(v.totals.total, 0);
  assert.equal(v.totals.alertes, 0);
  assert.equal(v.totals.avgRating, null);
  assert.equal(v.totals.responseRate, null);
  assert.equal(v.ratingComputable, false);
  assert.equal(v.rows.length, 0);
  // Les plateformes restent listées (structure), à zéro, sans moyenne fabriquée.
  assert.equal(v.byPlatform.length, REVIEW_PLATFORMS.length);
  for (const p of v.byPlatform) {
    assert.equal(p.total, 0);
    assert.equal(p.avgRating, null);
  }
});
