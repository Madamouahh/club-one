import assert from "node:assert/strict";
import test from "node:test";

import {
  DB_REVIEW_STATUSES,
  REVIEW_SOURCES,
  dbReviewStatusLabel,
  isBoardPlatform,
  offBoardCount,
  recordToBoardReview,
  recordsToBoardReviews,
  reviewDateToIso,
  reviewSourceLabel,
  validateNewReview,
  type ReviewRecord,
} from "../lib/reviewsData.ts";
import { buildReputationView } from "../lib/reputation.ts";

const REF_NOW = "2026-07-07T20:00:00.000Z";

function record(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: over.id ?? "rec",
    source: over.source ?? "google",
    rating: over.rating ?? null,
    author: over.author ?? "Auteur démo",
    body: over.body ?? null,
    review_date: over.review_date ?? null,
    status: over.status ?? "nouveau",
    response: over.response ?? null,
    created_by: over.created_by ?? null,
    created_at: over.created_at ?? "2026-07-05T10:00:00.000Z",
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés + constantes
// ————————————————————————————————————————————————————————————————
test("sources/statuts persistés : constantes attendues (contrat migration 0064)", () => {
  assert.deepEqual([...REVIEW_SOURCES], ["google", "meta", "tripadvisor", "autre"]);
  assert.deepEqual([...DB_REVIEW_STATUSES], ["nouveau", "repondu", "ignore"]);
  assert.equal(reviewSourceLabel("google"), "Google Business");
  assert.equal(reviewSourceLabel("tripadvisor"), "Tripadvisor");
  assert.equal(dbReviewStatusLabel("repondu"), "Répondu");
});

test("isBoardPlatform : seuls google/meta sont modélisés par le board", () => {
  assert.equal(isBoardPlatform("google"), true);
  assert.equal(isBoardPlatform("meta"), true);
  assert.equal(isBoardPlatform("tripadvisor"), false);
  assert.equal(isBoardPlatform("autre"), false);
});

// ————————————————————————————————————————————————————————————————
// reviewDateToIso : parse une date fournie, jamais l'horloge ; rebut → null
// ————————————————————————————————————————————————————————————————
test("reviewDateToIso : date valide → ISO minuit UTC ; null/illisible → null", () => {
  assert.equal(reviewDateToIso("2026-07-01"), "2026-07-01T00:00:00.000Z");
  assert.equal(reviewDateToIso(null), null);
  assert.equal(reviewDateToIso(""), null);
  assert.equal(reviewDateToIso("pas-une-date"), null);
});

// ————————————————————————————————————————————————————————————————
// recordToBoardReview : mapping honnête DB → Review du board
// ————————————————————————————————————————————————————————————————
test("recordToBoardReview : google/meta mappés ; sentiment/permalink/respondedAt non fabriqués", () => {
  const b = recordToBoardReview(
    record({ id: "g1", source: "meta", rating: 4, body: "top", review_date: "2026-07-01" }),
  );
  assert.ok(b);
  assert.equal(b!.platform, "meta");
  assert.equal(b!.rating, 4);
  assert.equal(b!.text, "top");
  assert.equal(b!.sentiment, null); // jamais deviné ici — le board déduit de la note
  assert.equal(b!.permalink, null); // aucun lien fabriqué
  assert.equal(b!.respondedAt, null); // aucun instant de réponse fabriqué
  assert.equal(b!.postedAt, "2026-07-01T00:00:00.000Z");
});

test("recordToBoardReview : sans review_date, postedAt retombe sur created_at", () => {
  const b = recordToBoardReview(
    record({ review_date: null, created_at: "2026-07-05T10:00:00.000Z" }),
  );
  assert.equal(b!.postedAt, "2026-07-05T10:00:00.000Z");
});

test("recordToBoardReview : note null préservée (jamais fabriquée)", () => {
  const b = recordToBoardReview(record({ rating: null }));
  assert.equal(b!.rating, null);
});

test("recordToBoardReview : tripadvisor/autre → null (jamais déguisés en Google)", () => {
  assert.equal(recordToBoardReview(record({ source: "tripadvisor" })), null);
  assert.equal(recordToBoardReview(record({ source: "autre" })), null);
});

test("recordToBoardReview : hasDraft = réponse saisie ET pas encore répondu", () => {
  assert.equal(recordToBoardReview(record({ status: "nouveau", response: "brouillon" }))!.hasDraft, true);
  assert.equal(recordToBoardReview(record({ status: "nouveau", response: "   " }))!.hasDraft, false);
  assert.equal(recordToBoardReview(record({ status: "nouveau", response: null }))!.hasDraft, false);
  assert.equal(recordToBoardReview(record({ status: "repondu", response: "faite" }))!.hasDraft, false);
});

// ————————————————————————————————————————————————————————————————
// recordsToBoardReviews / offBoardCount : filtrage hors agrégat
// ————————————————————————————————————————————————————————————————
test("recordsToBoardReviews écarte les sources hors board ; offBoardCount les compte", () => {
  const recs = [
    record({ id: "a", source: "google" }),
    record({ id: "b", source: "meta" }),
    record({ id: "c", source: "tripadvisor" }),
    record({ id: "d", source: "autre" }),
  ];
  const boardRows = recordsToBoardReviews(recs);
  assert.equal(boardRows.length, 2);
  assert.deepEqual(boardRows.map((r) => r.id).sort(), ["a", "b"]);
  assert.equal(offBoardCount(recs), 2);
});

// ————————————————————————————————————————————————————————————————
// Intégration avec buildReputationView (lib/reputation)
// ————————————————————————————————————————————————————————————————
test("intégration : que des avis hors board → vue VIDE (aucune note fabriquée)", () => {
  const recs = [record({ source: "tripadvisor", rating: 5 }), record({ source: "autre", rating: 1 })];
  const view = buildReputationView({ reviews: recordsToBoardReviews(recs), nowIso: REF_NOW });
  assert.equal(view.totals.total, 0);
  assert.equal(view.ratingComputable, false);
  assert.equal(view.totals.avgRating, null);
});

test("intégration : agrégat google/meta calculé, statut ignoré exclu du taux", () => {
  const recs = [
    record({ id: "g1", source: "google", rating: 5, status: "nouveau" }),
    record({ id: "g2", source: "google", rating: 1, status: "repondu" }),
    record({ id: "m1", source: "meta", rating: 3, status: "ignore" }),
    record({ id: "t1", source: "tripadvisor", rating: 2, status: "nouveau" }),
  ];
  const view = buildReputationView({ reviews: recordsToBoardReviews(recs), nowIso: REF_NOW });
  assert.equal(view.totals.total, 3); // tripadvisor exclu du board
  assert.equal(view.ratingComputable, true);
  assert.equal(view.totals.avgRating, 3); // (5+1+3)/3
  // répondable = total - ignoré = 3 - 1 = 2 ; répondu = 1 → 50 %
  assert.equal(view.totals.responseRate, 0.5);
});

// ————————————————————————————————————————————————————————————————
// validateNewReview : garde-fous de la saisie staff
// ————————————————————————————————————————————————————————————————
test("validateNewReview : auteur requis", () => {
  const r = validateNewReview({ source: "google", rating: "", author: "  ", body: "", review_date: "" });
  assert.equal(r.ok, false);
});

test("validateNewReview : source inconnue refusée", () => {
  const r = validateNewReview({ source: "yelp", rating: "", author: "X", body: "", review_date: "" });
  assert.equal(r.ok, false);
});

test("validateNewReview : note entière 1-5 sinon refus ; vide accepté (note null)", () => {
  assert.equal(
    validateNewReview({ source: "google", rating: "0", author: "X", body: "", review_date: "" }).ok,
    false,
  );
  assert.equal(
    validateNewReview({ source: "google", rating: "6", author: "X", body: "", review_date: "" }).ok,
    false,
  );
  assert.equal(
    validateNewReview({ source: "google", rating: "4.5", author: "X", body: "", review_date: "" }).ok,
    false,
  );
  const empty = validateNewReview({ source: "google", rating: "", author: "X", body: "", review_date: "" });
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.value.rating, null);
});

test("validateNewReview : trim + body/date vides → null", () => {
  const r = validateNewReview({
    source: "meta",
    rating: "5",
    author: "  Jean  ",
    body: "   ",
    review_date: "",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.author, "Jean");
    assert.equal(r.value.body, null);
    assert.equal(r.value.review_date, null);
    assert.equal(r.value.rating, 5);
    assert.equal(r.value.source, "meta");
  }
});
