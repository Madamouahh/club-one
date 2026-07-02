import assert from "node:assert/strict";
import test from "node:test";

import {
  CHARGE_CATEGORIES,
  CHARGE_STATUSES,
  artistesChargeAmount,
  artistesDataReady,
  chargeCost,
  isChargeCategorie,
  isChargeStatus,
  isCommitted,
  summarizeArtistesCharges,
  type SoireeCharge,
} from "../lib/artistesExtras.ts";

function charge(over: Partial<SoireeCharge> = {}): SoireeCharge {
  return {
    id: over.id ?? "c1",
    exploitation_date: over.exploitation_date ?? "2026-07-04",
    event_id: over.event_id ?? null,
    categorie: over.categorie ?? "dj",
    label: over.label ?? "DJ Test",
    montant_ttc: over.montant_ttc ?? null,
    statut: over.statut ?? "confirme",
    notes_direction: over.notes_direction ?? null,
    saisi_par: over.saisi_par ?? null,
  };
}

test("gardes de type : catégories et statuts reconnus / rejetés", () => {
  assert.equal(isChargeCategorie("dj"), true);
  assert.equal(isChargeCategorie("securite_externe"), true);
  assert.equal(isChargeCategorie("inconnu"), false);
  assert.equal(isChargeStatus("paye"), true);
  assert.equal(isChargeStatus("nimporte"), false);
  assert.equal(CHARGE_CATEGORIES.length, 7);
  assert.equal(CHARGE_STATUSES.length, 4);
});

test("isCommitted : seuls confirmé/payé engagent un coût", () => {
  assert.equal(isCommitted(charge({ statut: "confirme" })), true);
  assert.equal(isCommitted(charge({ statut: "paye" })), true);
  assert.equal(isCommitted(charge({ statut: "prevu" })), false);
  assert.equal(isCommitted(charge({ statut: "annule" })), false);
});

test("chargeCost : null si non engagé, null si engagé sans montant, sinon le montant", () => {
  assert.equal(chargeCost(charge({ statut: "prevu", montant_ttc: 500 })), null); // provisionnel
  assert.equal(chargeCost(charge({ statut: "confirme", montant_ttc: null })), null); // pas chiffré
  assert.equal(chargeCost(charge({ statut: "annule", montant_ttc: 500 })), null); // annulé
  assert.equal(chargeCost(charge({ statut: "confirme", montant_ttc: 500 })), 500);
  assert.equal(chargeCost(charge({ statut: "paye", montant_ttc: 250.5 })), 250.5);
});

test("summarizeArtistesCharges : aucune ligne → état vide honnête (coût null, non complet)", () => {
  const s = summarizeArtistesCharges("2026-07-04", []);
  assert.equal(s.lignesTotal, 0);
  assert.equal(s.engagees, 0);
  assert.equal(s.coutArtistes, null);
  assert.equal(s.coutComplet, false);
  assert.equal(artistesChargeAmount(s), null);
});

test("summarizeArtistesCharges : coût COMPLET si tous les engagés sont chiffrés", () => {
  const s = summarizeArtistesCharges("2026-07-04", [
    charge({ id: "a", statut: "confirme", montant_ttc: 800 }),
    charge({ id: "b", statut: "paye", montant_ttc: 200 }),
  ]);
  assert.equal(s.engagees, 2);
  assert.equal(s.engageesSansMontant, 0);
  assert.equal(s.coutArtistes, 1000);
  assert.equal(s.coutComplet, true);
  assert.equal(artistesChargeAmount(s), 1000); // branché au P&L
});

test("summarizeArtistesCharges : un engagé sans cachet → coût INCOMPLET, jamais branché tronqué", () => {
  const s = summarizeArtistesCharges("2026-07-04", [
    charge({ id: "a", statut: "confirme", montant_ttc: 800 }),
    charge({ id: "b", statut: "confirme", montant_ttc: null }),
  ]);
  assert.equal(s.engagees, 2);
  assert.equal(s.engageesSansMontant, 1);
  assert.equal(s.coutArtistes, 800); // ce qui est calculable est exposé…
  assert.equal(s.coutComplet, false); // …mais le coût n'est pas complet
  assert.equal(artistesChargeAmount(s), null); // le P&L ne branche jamais un coût partiel
});

test("summarizeArtistesCharges : les provisionnels et annulés ne comptent pas dans le coût", () => {
  const s = summarizeArtistesCharges("2026-07-04", [
    charge({ id: "a", statut: "confirme", montant_ttc: 500 }),
    charge({ id: "b", statut: "prevu", montant_ttc: 1000 }), // provisionnel
    charge({ id: "c", statut: "annule", montant_ttc: 9999 }), // annulé
  ]);
  assert.equal(s.engagees, 1);
  assert.equal(s.provisionnelles, 1);
  assert.equal(s.annulees, 1);
  assert.equal(s.lignesTotal, 2); // annulé exclu des lignes vivantes
  assert.equal(s.coutArtistes, 500);
  assert.equal(s.coutComplet, true);
  assert.equal(s.montantProvisionnel, 1000); // indicatif, hors P&L
});

test("summarizeArtistesCharges : ne mélange pas les soirées (filtre par date)", () => {
  const s = summarizeArtistesCharges("2026-07-04", [
    charge({ id: "a", exploitation_date: "2026-07-04", statut: "paye", montant_ttc: 300 }),
    charge({ id: "b", exploitation_date: "2026-07-05", statut: "paye", montant_ttc: 700 }),
  ]);
  assert.equal(s.engagees, 1);
  assert.equal(s.coutArtistes, 300);
});

test("artistesDataReady : reflet exact de ce que le fondateur a saisi", () => {
  const r = artistesDataReady([
    charge({ id: "a", statut: "confirme", montant_ttc: 500 }),
    charge({ id: "b", statut: "prevu", montant_ttc: null }),
    charge({ id: "c", statut: "paye", montant_ttc: 200 }),
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.engagees, 2); // confirme + paye
  assert.equal(r.withMontant, 2);
});
