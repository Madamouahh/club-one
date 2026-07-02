import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPnlSoiree,
  pendingCharges,
  reconcileTables,
  summarizeCaisse,
  type CaisseSummary,
} from "../lib/pnlSoiree.ts";
import type { CaisseZRecord } from "../lib/caisseZ.ts";

function z(overrides: Partial<CaisseZRecord> = {}): CaisseZRecord {
  return {
    id: "z",
    exploitation_date: "2026-07-04",
    venue: "complexe",
    event_id: null,
    source: "manual",
    ca_ttc: 0,
    nb_tickets: null,
    familles: {},
    paiements: {},
    offerts_ttc: 0,
    commentaire: null,
    saisi_par: null,
    ...overrides,
  };
}

test("summarizeCaisse: aucun Z → état vide honnête (available=false, tout à 0)", () => {
  const s = summarizeCaisse([]);
  assert.equal(s.available, false);
  assert.equal(s.basis, "aucun");
  assert.equal(s.caTotal, 0);
  assert.equal(s.nbTickets, null);
  assert.equal(s.venuesCount, 0);
});

test("summarizeCaisse: une ligne complexe fait foi et prime sur les univers (pas de double comptage)", () => {
  const s = summarizeCaisse([
    z({ id: "g", venue: "complexe", ca_ttc: 10000, familles: { bar: 8000, entrees: 2000 }, nb_tickets: 400 }),
    z({ id: "e", venue: "eden", ca_ttc: 6000, familles: { bar: 6000 }, nb_tickets: 250 }),
  ]);
  assert.equal(s.basis, "complexe");
  assert.equal(s.venuesCount, 1);
  assert.equal(s.caTotal, 10000);
  assert.equal(s.caBar, 8000);
  assert.equal(s.caEntrees, 2000);
  assert.equal(s.nbTickets, 400);
});

test("summarizeCaisse: sans ligne complexe, somme les univers", () => {
  const s = summarizeCaisse([
    z({ id: "e", venue: "eden", ca_ttc: 6000, familles: { bar: 5000, entrees: 1000 }, nb_tickets: 250, offerts_ttc: 100 }),
    z({ id: "t", venue: "terminus", ca_ttc: 4000, familles: { bar: 3500, vestiaire: 500 }, nb_tickets: 180, offerts_ttc: 50 }),
  ]);
  assert.equal(s.basis, "par-univers");
  assert.equal(s.venuesCount, 2);
  assert.equal(s.caTotal, 10000);
  assert.equal(s.caBar, 8500);
  assert.equal(s.caEntrees, 1000);
  assert.equal(s.caVestiaire, 500);
  assert.equal(s.offerts, 150);
  assert.equal(s.nbTickets, 430);
});

test("summarizeCaisse: nbTickets reste null si aucun univers ne le renseigne", () => {
  const s = summarizeCaisse([z({ venue: "eden", ca_ttc: 5000, familles: { bar: 5000 } })]);
  assert.equal(s.nbTickets, null);
});

test("reconcileTables: écart bar caisse − CA tables = sous-saisie ; taux = couverture", () => {
  const caisse: CaisseSummary = {
    basis: "complexe",
    caTotal: 10000,
    caBar: 8000,
    caEntrees: 2000,
    caVestiaire: 0,
    offerts: 0,
    nbTickets: null,
    venuesCount: 1,
    available: true,
  };
  const rec = reconcileTables(caisse, 6000);
  assert.equal(rec.caBarCaisse, 8000);
  assert.equal(rec.caTables, 6000);
  assert.equal(rec.ecart, 2000); // 2000€ de bar non tapés par table
  assert.equal(rec.tauxSaisie, 0.75); // 75 % du bar comptable couvert par la saisie table
});

test("reconcileTables: pas de famille bar → rien à rapprocher (null, pas de division fantôme)", () => {
  const caisse = summarizeCaisse([z({ venue: "eden", ca_ttc: 2000, familles: { entrees: 2000 } })]);
  const rec = reconcileTables(caisse, 1500);
  assert.equal(rec.caBarCaisse, null);
  assert.equal(rec.ecart, null);
  assert.equal(rec.tauxSaisie, null);
});

test("pendingCharges: staff et artistes non branchés (amount null, wired false) — aucun coût inventé", () => {
  const charges = pendingCharges();
  assert.equal(charges.length, 2);
  assert.ok(charges.every((c) => c.amount === null && c.wired === false));
  assert.deepEqual(charges.map((c) => c.key), ["staff", "artistes"]);
});

test("buildPnlSoiree: sans Z, produit vide et résultat honnêtement indisponible", () => {
  const pnl = buildPnlSoiree({ exploitationDate: "2026-07-04", caisseRecords: [], caTables: 4200, entries: 300 });
  assert.equal(pnl.caisse.available, false);
  assert.equal(pnl.produitTotal, 0);
  assert.equal(pnl.margeApresChargesConnues, null); // pas de caisse → pas de marge
  assert.equal(pnl.panierParEntree, null);
  assert.equal(pnl.resultatNetComplet, false); // charges toujours en attente
  assert.equal(pnl.chargesEnAttente.length, 2);
});

test("buildPnlSoiree: avec Z, marge = CA caisse (charges non branchées) mais résultat NON complet", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 8000, entrees: 2000 }, nb_tickets: 400 })],
    caTables: 6000,
    entries: 400,
  });
  assert.equal(pnl.produitTotal, 10000);
  assert.equal(pnl.chargesConnues, 0);
  // marge AVANT charges non branchées = CA caisse ; le libellé côté UI dit clairement "avant charges".
  assert.equal(pnl.margeApresChargesConnues, 10000);
  assert.equal(pnl.resultatNetComplet, false); // RH + artistes toujours à brancher
  assert.equal(pnl.panierParEntree, 25); // 10000 / 400
  assert.equal(pnl.reconciliation.ecart, 2000);
});

test("buildPnlSoiree: producteur RH branché sans taux (staffCharge=null) → charge staff wired mais en attente", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 8000, entrees: 2000 } })],
    caTables: 6000,
    entries: 400,
    staffCharge: null, // producteur RH branché mais coût non complet (aucun taux horaire réel)
  });
  const staff = pnl.charges.find((c) => c.key === "staff");
  assert.equal(staff?.wired, true); // le producteur RH est branché (chemin de données réel)
  assert.equal(staff?.amount, null); // mais aucun coût fabriqué tant que la masse n'est pas complète
  assert.equal(pnl.chargesConnues, 0);
  assert.equal(pnl.margeApresChargesConnues, 10000); // rien de déduit : coût staff pas encore chiffré
  assert.equal(pnl.resultatNetComplet, false); // staff sans montant + artistes non branché
  assert.deepEqual(pnl.chargesEnAttente.map((c) => c.key), ["staff", "artistes"]);
});

test("buildPnlSoiree: coût staff complet injecté → déduit du produit, mais résultat pas encore complet (artistes)", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 8000, entrees: 2000 } })],
    caTables: 6000,
    entries: 400,
    staffCharge: 1200, // masse horaire complète (taux réels fournis) → coût staff chiffré
  });
  const staff = pnl.charges.find((c) => c.key === "staff");
  assert.equal(staff?.wired, true);
  assert.equal(staff?.amount, 1200);
  assert.equal(pnl.chargesConnues, 1200);
  assert.equal(pnl.margeApresChargesConnues, 8800); // 10000 − 1200 (coût staff déduit)
  assert.equal(pnl.resultatNetComplet, false); // artistes/extras toujours non branchés
  assert.deepEqual(pnl.chargesEnAttente.map((c) => c.key), ["artistes"]);
});

test("buildPnlSoiree: producteur artistes branché sans cachet (artistesCharge=null) → wired mais en attente", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 10000 } })],
    caTables: 6000,
    entries: 400,
    artistesCharge: null, // producteur booking branché mais coût non complet (un engagé sans cachet)
  });
  const artistes = pnl.charges.find((c) => c.key === "artistes");
  assert.equal(artistes?.wired, true);
  assert.equal(artistes?.amount, null);
  assert.equal(pnl.chargesConnues, 0);
  assert.equal(pnl.resultatNetComplet, false); // staff non branché + artistes sans montant
});

test("buildPnlSoiree: coût artistes complet injecté → déduit du produit (2ᵉ charge)", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 10000 } })],
    caTables: 6000,
    entries: 400,
    artistesCharge: 1500, // postes engagés tous chiffrés → coût artistes complet
  });
  const artistes = pnl.charges.find((c) => c.key === "artistes");
  assert.equal(artistes?.wired, true);
  assert.equal(artistes?.amount, 1500);
  assert.equal(pnl.chargesConnues, 1500);
  assert.equal(pnl.margeApresChargesConnues, 8500); // 10000 − 1500
  assert.equal(pnl.resultatNetComplet, false); // staff toujours non branché
  assert.deepEqual(pnl.chargesEnAttente.map((c) => c.key), ["staff"]);
});

test("buildPnlSoiree: staff ET artistes complets → résultat net ENFIN complet (les 2 charges branchées)", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 8000, entrees: 2000 } })],
    caTables: 6000,
    entries: 400,
    staffCharge: 1200,
    artistesCharge: 1500,
  });
  assert.equal(pnl.chargesConnues, 2700); // 1200 + 1500
  assert.equal(pnl.margeApresChargesConnues, 7300); // 10000 − 2700 = résultat net réel
  assert.equal(pnl.chargesEnAttente.length, 0);
  assert.equal(pnl.resultatNetComplet, true); // enfin un résultat net complet, jamais fabriqué avant
});

test("buildPnlSoiree: sans artistesCharge (undefined), la charge artistes reste baseline non branchée", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 8000 } })],
    caTables: 6000,
    entries: 400,
    staffCharge: 1200, // seul le staff est branché
  });
  const artistes = pnl.charges.find((c) => c.key === "artistes");
  assert.equal(artistes?.wired, false); // rétrocompatible : producteur artistes non passé
  assert.deepEqual(pnl.chargesEnAttente.map((c) => c.key), ["artistes"]);
});

test("buildPnlSoiree: sans staffCharge (undefined), baseline inchangée (staff non branché)", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 8000 } })],
    caTables: 6000,
    entries: 400,
  });
  const staff = pnl.charges.find((c) => c.key === "staff");
  assert.equal(staff?.wired, false); // rétrocompatible : aucun producteur passé
  assert.equal(pnl.chargesEnAttente.length, 2);
});

test("buildPnlSoiree: panierParEntree null si aucune entrée (pas de division par zéro)", () => {
  const pnl = buildPnlSoiree({
    exploitationDate: "2026-07-04",
    caisseRecords: [z({ venue: "eden", ca_ttc: 5000, familles: { bar: 5000 } })],
    caTables: 0,
    entries: 0,
  });
  assert.equal(pnl.panierParEntree, null);
});
