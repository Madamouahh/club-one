// tests/marketing.test.mts — logique pure du module Marketing (lib/marketing.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageMarketing,
  canViewMarketing,
  validateCampaignDraft,
  campaignRoas,
  campaignCac,
  marketingSummary,
  formatEuro,
  formatRoas,
  type Campaign,
} from "../lib/marketing.ts";

const campaigns: Campaign[] = [
  {
    id: "insta",
    name: "Insta Juillet",
    channel: "instagram",
    budget_cents: 50000,
    spent_cents: 30000,
    status: "active",
    attributed_revenue_cents: 180000,
    attributed_reservations: 12,
  },
  {
    id: "tiktok",
    name: "TikTok teaser",
    channel: "tiktok",
    budget_cents: 20000,
    spent_cents: 0, // aucune dépense → ROAS null (honnête)
    status: "brouillon",
    attributed_revenue_cents: 0,
    attributed_reservations: 0,
  },
];

test("gardes de rôle : seule la direction gère ET voit le marketing", () => {
  assert.equal(canManageMarketing("admin"), true);
  assert.equal(canManageMarketing("manager"), true);
  assert.equal(canManageMarketing("server"), false);
  assert.equal(canViewMarketing("admin"), true);
  assert.equal(canViewMarketing("server"), false);
  assert.equal(canViewMarketing("promoter"), false);
});

test("validateCampaignDraft", () => {
  assert.equal(validateCampaignDraft({ name: "" }).ok, false);
  assert.equal(validateCampaignDraft({ name: "X", channel: "myspace" }).ok, false);
  assert.equal(validateCampaignDraft({ name: "X", budget_cents: -5 }).ok, false);
  assert.equal(validateCampaignDraft({ name: "X", spent_cents: -1 }).ok, false);
  assert.equal(validateCampaignDraft({ name: "Insta", channel: "instagram", budget_cents: 50000 }).ok, true);
});

test("campaignRoas : CA / dépensé ; null si aucune dépense réelle", () => {
  assert.equal(campaignRoas(campaigns[0]), 180000 / 30000); // 6×
  assert.equal(campaignRoas(campaigns[1]), null); // spent 0 → pas de faux ratio
});

test("campaignCac : dépensé / réservations attribuées ; null si aucune réservation", () => {
  assert.equal(campaignCac(campaigns[0]), 30000 / 12); // 2500 cents = 25 €
  assert.equal(campaignCac(campaigns[1]), null); // 0 réservation → pas de division vide
});

test("marketingSummary : totaux + ROAS global honnête", () => {
  const s = marketingSummary(campaigns);
  assert.equal(s.totalCampagnes, 2);
  assert.equal(s.actives, 1);
  assert.equal(s.budgetTotalCents, 70000);
  assert.equal(s.depenseTotalCents, 30000);
  assert.equal(s.caAttribueTotalCents, 180000);
  assert.equal(s.reservationsAttribuees, 12);
  assert.equal(s.roasGlobal, 180000 / 30000);
});

test("marketingSummary : ROAS global null quand aucune dépense (honnête)", () => {
  const s = marketingSummary([campaigns[1]]);
  assert.equal(s.depenseTotalCents, 0);
  assert.equal(s.roasGlobal, null);
});

test("formatEuro / formatRoas : valeur manquante = tiret", () => {
  assert.equal(formatEuro(null), "—");
  assert.match(formatEuro(30000), /300/);
  assert.equal(formatRoas(null), "—");
  assert.match(formatRoas(6), /6/);
});
