// tests/marketingUi.test.mts — logique PURE des helpers UI Marketing (lib/marketingUi.ts).
// Ciblage audiences (F1), dérivation d'états outbox (F5), libellé remise (F4). Aucun rendu React testé.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesSegment,
  evaluateSegment,
  buildRecipients,
  consentStateOf,
  outboxSummary,
  recipientStatusFromMessage,
  statusLabel,
  statusTone,
  formatDiscountLabel,
  type GuestRecord,
  type SegmentCriteria,
} from "../lib/marketingUi.ts";
import type { QueuedMessage } from "../lib/messaging/types.ts";

const guests: GuestRecord[] = [
  {
    id: "vip",
    consent_marketing: true,
    opt_out_at: null,
    visits_count: 8,
    last_visit_at: "2026-06-20",
    total_spend_cents: 120000,
    tags: ["vip", "eden"],
  },
  {
    id: "dormant",
    consent_marketing: true,
    opt_out_at: null,
    visits_count: 2,
    last_visit_at: "2025-11-01",
    total_spend_cents: 8000,
    tags: ["cercle"],
  },
  {
    id: "no_consent",
    consent_marketing: false,
    opt_out_at: null,
    visits_count: 5,
    last_visit_at: "2026-06-25",
    total_spend_cents: 40000,
    tags: ["eden"],
  },
  {
    id: "stopped",
    consent_marketing: true,
    opt_out_at: "2026-01-10",
    visits_count: 10,
    last_visit_at: "2026-06-30",
    total_spend_cents: 200000,
    tags: ["vip"],
  },
];

test("matchesSegment : critère absent = ignoré (segment vide matche tout)", () => {
  assert.equal(matchesSegment(guests[0], null), true);
  assert.equal(matchesSegment(guests[0], {}), true);
});

test("matchesSegment : min_visits / min_spend_cents (bornes numériques)", () => {
  assert.equal(matchesSegment(guests[0], { min_visits: 5 }), true);
  assert.equal(matchesSegment(guests[1], { min_visits: 5 }), false);
  assert.equal(matchesSegment(guests[1], { min_spend_cents: 10000 }), false);
  assert.equal(matchesSegment(guests[0], { min_spend_cents: 10000 }), true);
  // champ absent côté guest → 0 → ne satisfait pas une borne min positive.
  assert.equal(matchesSegment({ id: "x" }, { min_visits: 1 }), false);
});

test("matchesSegment : fenêtre de dernière visite (récents vs dormants)", () => {
  const recents: SegmentCriteria = { last_visit_after: "2026-06-01" };
  assert.equal(matchesSegment(guests[0], recents), true);
  assert.equal(matchesSegment(guests[1], recents), false);
  const dormants: SegmentCriteria = { last_visit_before: "2026-01-01" };
  assert.equal(matchesSegment(guests[1], dormants), true);
  assert.equal(matchesSegment(guests[0], dormants), false);
  // last_visit_at absent ne satisfait aucune borne temporelle.
  assert.equal(matchesSegment({ id: "x" }, recents), false);
});

test("matchesSegment : consentement + opt-out", () => {
  assert.equal(matchesSegment(guests[2], { requires_consent: true }), false);
  assert.equal(matchesSegment(guests[0], { requires_consent: true }), true);
  assert.equal(matchesSegment(guests[3], { exclude_opted_out: true }), false);
  assert.equal(matchesSegment(guests[0], { exclude_opted_out: true }), true);
});

test("matchesSegment : tags_any (au moins un tag commun)", () => {
  assert.equal(matchesSegment(guests[0], { tags_any: ["vip"] }), true);
  assert.equal(matchesSegment(guests[1], { tags_any: ["vip"] }), false);
  assert.equal(matchesSegment(guests[1], { tags_any: ["vip", "cercle"] }), true);
});

test("evaluateSegment : segment marketing joignable (consent + non STOP + récent)", () => {
  const seg: SegmentCriteria = {
    requires_consent: true,
    exclude_opted_out: true,
    last_visit_after: "2026-06-01",
  };
  const res = evaluateSegment(guests, seg).map((g) => g.id);
  // vip: ok ; dormant: trop ancien ; no_consent: pas de consent ; stopped: opt-out.
  assert.deepEqual(res, ["vip"]);
});

test("buildRecipients : dédup par guest, statut initial pending, campaign_id porté", () => {
  const dupes = [guests[0], guests[0], guests[1]];
  const recs = buildRecipients("camp-1", dupes, { requires_consent: true });
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0], { campaign_id: "camp-1", guest_id: "vip", status: "pending" });
  assert.ok(recs.every((r) => r.status === "pending"));
});

test("consentStateOf : projection guest → ConsentState pour lib/messaging.enqueue", () => {
  assert.deepEqual(consentStateOf(guests[0]), {
    guest_id: "vip",
    consent_marketing: true,
    opt_out_at: null,
  });
  assert.deepEqual(consentStateOf(guests[3]), {
    guest_id: "stopped",
    consent_marketing: true,
    opt_out_at: "2026-01-10",
  });
});

test("outboxSummary : compte par statut + total", () => {
  const q: Pick<QueuedMessage, "status">[] = [
    { status: "queued" },
    { status: "queued" },
    { status: "sent" },
    { status: "skipped" },
    { status: "opted_out" },
    { status: "failed" },
  ];
  const s = outboxSummary(q);
  assert.equal(s.total, 6);
  assert.equal(s.queued, 2);
  assert.equal(s.sent, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.opted_out, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.sending, 0);
});

test("recipientStatusFromMessage : miroir message_queue → campaign_recipients", () => {
  assert.equal(recipientStatusFromMessage("queued"), "queued");
  assert.equal(recipientStatusFromMessage("sending"), "queued");
  assert.equal(recipientStatusFromMessage("sent"), "sent");
  assert.equal(recipientStatusFromMessage("skipped"), "skipped");
  assert.equal(recipientStatusFromMessage("failed"), "skipped");
  assert.equal(recipientStatusFromMessage("opted_out"), "opted_out");
  assert.equal(recipientStatusFromMessage(null), "pending");
  assert.equal(recipientStatusFromMessage(undefined), "pending");
});

test("statusLabel / statusTone : libellés FR honnêtes (sent = DRY_RUN)", () => {
  assert.match(statusLabel("sent"), /DRY_RUN/);
  assert.equal(statusLabel("opted_out"), "Opt-out (STOP)");
  assert.equal(statusTone("sent"), "text-emerald-300");
  assert.equal(statusTone("failed"), "text-red-400");
});

test("formatDiscountLabel : pourcentage borné à 100, montant en euros", () => {
  assert.equal(formatDiscountLabel({ discount_type: "percent", discount_value_cents: 20 }), "-20 %");
  assert.equal(formatDiscountLabel({ discount_type: "percent", discount_value_cents: 250 }), "-100 %");
  assert.match(formatDiscountLabel({ discount_type: "amount", discount_value_cents: 1500 }), /15/);
});
