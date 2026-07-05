// tests/commercial.test.mts — logique pure du module Commercial / privatisations (lib/commercial.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageCommercial,
  canViewCommercial,
  validateLeadDraft,
  validateQuoteDraft,
  pipelineSummary,
  conversionRate,
  quotesForLead,
  formatMoneyEuro,
  formatRatePct,
  type CommercialLead,
  type CommercialQuote,
} from "../lib/commercial.ts";

const leads: CommercialLead[] = [
  { id: "l1", contact_name: "Dupont", kind: "privatisation", status: "gagne", estimated_value_cents: 500000 },
  { id: "l2", contact_name: "Martin", kind: "entreprise", status: "devis", estimated_value_cents: 300000 }, // devis en option
  { id: "l3", contact_name: "Bernard", kind: "groupe", status: "qualifie", estimated_value_cents: 100000 },
  { id: "l4", contact_name: "Durand", kind: "anniversaire", status: "perdu", estimated_value_cents: 200000 },
  { id: "l5", contact_name: "Petit", kind: "autre", status: "nouveau", estimated_value_cents: null }, // valeur manquante
];
const quotes: CommercialQuote[] = [
  { id: "q1", lead_id: "l1", label: "Formule VIP", amount_cents: 500000, status: "accepte" },
  { id: "q2", lead_id: "l2", label: "Soirée entreprise", amount_cents: 300000, status: "option" },
];

test("gardes de rôle : direction seule gère ET consulte (promoteur/server exclus)", () => {
  assert.equal(canManageCommercial("admin"), true);
  assert.equal(canManageCommercial("manager"), true);
  assert.equal(canManageCommercial("server"), false);
  assert.equal(canManageCommercial("promoter"), false);
  assert.equal(canViewCommercial("admin"), true);
  assert.equal(canViewCommercial("server"), false);
  assert.equal(canViewCommercial("promoter"), false);
});

test("validateLeadDraft", () => {
  assert.equal(validateLeadDraft({ contact_name: "" }).ok, false);
  assert.equal(validateLeadDraft({ contact_name: "X", kind: "inconnu" }).ok, false);
  assert.equal(validateLeadDraft({ contact_name: "X", status: "zzz" }).ok, false);
  assert.equal(validateLeadDraft({ contact_name: "X", party_size: -3 }).ok, false);
  assert.equal(validateLeadDraft({ contact_name: "X", estimated_value_cents: -1 }).ok, false);
  assert.equal(validateLeadDraft({ contact_name: "Dupont", kind: "privatisation", status: "nouveau" }).ok, true);
});

test("validateQuoteDraft", () => {
  assert.equal(validateQuoteDraft({ lead_id: "" }).ok, false);
  assert.equal(validateQuoteDraft({ lead_id: "l1", label: "" }).ok, false);
  assert.equal(validateQuoteDraft({ lead_id: "l1", label: "VIP", amount_cents: 0 }).ok, false);
  assert.equal(validateQuoteDraft({ lead_id: "l1", label: "VIP", amount_cents: -5 }).ok, false);
  assert.equal(validateQuoteDraft({ lead_id: "l1", label: "VIP", amount_cents: 500000, status: "bad" }).ok, false);
  assert.equal(validateQuoteDraft({ lead_id: "l1", label: "VIP", amount_cents: 500000, status: "envoye" }).ok, true);
});

test("pipelineSummary : compte par statut", () => {
  const s = pipelineSummary(leads, quotes);
  assert.equal(s.total, 5);
  assert.equal(s.parStatut.gagne, 1);
  assert.equal(s.parStatut.devis, 1);
  assert.equal(s.parStatut.qualifie, 1);
  assert.equal(s.parStatut.perdu, 1);
  assert.equal(s.parStatut.nouveau, 1);
});

test("pipelineSummary : valeur pondérée honnête = gagnés + leads avec devis en option", () => {
  const s = pipelineSummary(leads, quotes);
  // l1 gagné 500000 + l2 (option, non perdu) 300000. l3 qualifié sans option NON compté,
  // l4 perdu NON compté, l5 valeur manquante NON compté.
  assert.equal(s.valeurPondereeCents, 500000 + 300000);
});

test("pipelineSummary : un devis en option sur un lead perdu ne compte pas", () => {
  const perduAvecOption: CommercialLead[] = [
    { id: "x1", contact_name: "Z", kind: "groupe", status: "perdu", estimated_value_cents: 400000 },
  ];
  const optQuote: CommercialQuote[] = [{ id: "qx", lead_id: "x1", label: "L", amount_cents: 400000, status: "option" }];
  assert.equal(pipelineSummary(perduAvecOption, optQuote).valeurPondereeCents, 0);
});

test("conversionRate : gagnés / (gagnés + perdus), en-cours ignorés", () => {
  // gagne=1, perdu=1 → 0.5
  assert.equal(conversionRate(leads), 0.5);
  // aucun tranché → null
  assert.equal(conversionRate([{ id: "a", contact_name: "A", kind: "autre", status: "nouveau" }]), null);
  assert.equal(conversionRate([]), null);
});

test("quotesForLead", () => {
  assert.equal(quotesForLead("l1", quotes).length, 1);
  assert.equal(quotesForLead("l2", quotes)[0].label, "Soirée entreprise");
  assert.equal(quotesForLead("inconnu", quotes).length, 0);
});

test("formatMoneyEuro : montant inconnu = tiret", () => {
  assert.equal(formatMoneyEuro(null), "—");
  assert.equal(formatMoneyEuro(undefined), "—");
  assert.match(formatMoneyEuro(500000), /5\s?000/);
});

test("formatRatePct : taux nul = tiret", () => {
  assert.equal(formatRatePct(null), "—");
  assert.equal(formatRatePct(0.5), "50 %");
});
