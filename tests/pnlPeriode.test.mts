import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateProduit,
  buildPnlPeriode,
  periodeMonthKey,
  type PnlPeriodeNight,
} from "../lib/pnlPeriode.ts";
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

// Une soirée = un jeu de lignes Z + un CA tables + des entrées.
function night(date: string, records: CaisseZRecord[], caTables = 0, entries = 0): PnlPeriodeNight {
  return { exploitationDate: date, caisseRecords: records, caTables, entries };
}

// ————————————————————————————————————————————————————————————————
// periodeMonthKey
// ————————————————————————————————————————————————————————————————

test("periodeMonthKey: extrait YYYY-MM, vide si illisible", () => {
  assert.equal(periodeMonthKey("2026-07-04"), "2026-07");
  assert.equal(periodeMonthKey("2026-12-31"), "2026-12");
  assert.equal(periodeMonthKey("nope"), "");
  assert.equal(periodeMonthKey(""), "");
});

// ————————————————————————————————————————————————————————————————
// aggregateProduit
// ————————————————————————————————————————————————————————————————

test("aggregateProduit: période vide → tout à 0 / null (état vide honnête)", () => {
  const p = aggregateProduit([]);
  assert.equal(p.soireesAvecZ, 0);
  assert.equal(p.produitTotal, 0);
  assert.equal(p.nbTicketsTotal, null);
  assert.equal(p.ecart, null);
  assert.equal(p.tauxSaisie, null);
  assert.equal(p.panierMoyen, null);
});

test("aggregateProduit: une nuit sans Z n'entre pas dans le produit (aucun 0 fantôme)", () => {
  const p = aggregateProduit([
    night("2026-07-04", [z({ venue: "eden", ca_ttc: 6000, familles: { bar: 6000 }, nb_tickets: 250 })], 4000, 300),
    night("2026-07-11", [], 0, 0), // pas de Z → ignorée du produit
  ]);
  assert.equal(p.soireesAvecZ, 1);
  assert.equal(p.produitTotal, 6000);
  assert.equal(p.entriesTotal, 300);
});

test("aggregateProduit: somme deux nuits chiffrées, ecart & taux au niveau période", () => {
  const p = aggregateProduit([
    night("2026-07-04", [z({ venue: "complexe", ca_ttc: 10000, familles: { bar: 8000, entrees: 2000 }, nb_tickets: 400 })], 6000, 350),
    night("2026-07-11", [z({ venue: "complexe", ca_ttc: 12000, familles: { bar: 9000, entrees: 3000 }, nb_tickets: 500 })], 4000, 400),
  ]);
  assert.equal(p.soireesAvecZ, 2);
  assert.equal(p.produitTotal, 22000);
  assert.equal(p.caBarTotal, 17000);
  assert.equal(p.caEntreesTotal, 5000);
  assert.equal(p.caTablesTotal, 10000);
  assert.equal(p.entriesTotal, 750);
  assert.equal(p.nbTicketsTotal, 900);
  assert.equal(p.ecart, 7000); // 17000 bar − 10000 tables
  // taux saisie = 10000 / 17000 ≈ 0.59
  assert.ok(p.tauxSaisie != null && Math.abs(p.tauxSaisie - 0.59) < 0.01);
  // panier moyen = 22000 / 750 ≈ 29.33
  assert.ok(p.panierMoyen != null && Math.abs(p.panierMoyen - 29.33) < 0.01);
});

test("aggregateProduit: ecart/taux null si aucune famille bar sur la période", () => {
  const p = aggregateProduit([
    night("2026-07-04", [z({ venue: "eden", ca_ttc: 5000, familles: { entrees: 5000 } })], 3000, 200),
  ]);
  assert.equal(p.produitTotal, 5000);
  assert.equal(p.caBarTotal, 0);
  assert.equal(p.ecart, null);
  assert.equal(p.tauxSaisie, null);
});

test("aggregateProduit: nbTicketsTotal null si aucune nuit ne renseigne ses tickets", () => {
  const p = aggregateProduit([
    night("2026-07-04", [z({ venue: "eden", ca_ttc: 5000, familles: { bar: 5000 } })], 0, 100),
  ]);
  assert.equal(p.nbTicketsTotal, null);
});

// ————————————————————————————————————————————————————————————————
// buildPnlPeriode — charges & résultat
// ————————————————————————————————————————————————————————————————

test("buildPnlPeriode: aucune charge branchée → résultat non complet, marge = produit avant charges", () => {
  const r = buildPnlPeriode({
    nights: [night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 6000, 300)],
  });
  assert.equal(r.produit.produitTotal, 10000);
  assert.equal(r.chargesConnues, 0);
  assert.equal(r.margeApresChargesConnues, 10000);
  assert.equal(r.resultatNetComplet, false);
  assert.equal(r.chargesEnAttente.length, 2); // staff + artistes en attente
});

test("buildPnlPeriode: staff branché & complet → déduit ; artistes non branché → pas net", () => {
  const r = buildPnlPeriode({
    nights: [night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 6000, 300)],
    staffCharge: 2500,
  });
  assert.equal(r.chargesConnues, 2500);
  assert.equal(r.margeApresChargesConnues, 7500);
  assert.equal(r.resultatNetComplet, false); // artistes toujours en attente
  const staff = r.charges.find((c) => c.key === "staff");
  assert.equal(staff?.wired, true);
  assert.equal(staff?.amount, 2500);
});

test("buildPnlPeriode: staff branché mais cumul incomplet (null) → non déduit, en attente", () => {
  const r = buildPnlPeriode({
    nights: [night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 0, 300)],
    staffCharge: null, // branché mais coût de période non complet
  });
  assert.equal(r.chargesConnues, 0);
  assert.equal(r.margeApresChargesConnues, 10000); // produit avant charges
  const staff = r.charges.find((c) => c.key === "staff");
  assert.equal(staff?.wired, true);
  assert.equal(staff?.amount, null);
  assert.ok(r.chargesEnAttente.some((c) => c.key === "staff"));
});

test("buildPnlPeriode: staff ET artistes complets → résultat net complet", () => {
  const r = buildPnlPeriode({
    nights: [night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 0, 300)],
    staffCharge: 2000,
    artistesCharge: 1500,
  });
  assert.equal(r.chargesConnues, 3500);
  assert.equal(r.margeApresChargesConnues, 6500);
  assert.equal(r.resultatNetComplet, true);
  assert.equal(r.chargesEnAttente.length, 0);
});

test("buildPnlPeriode: aucun Z → marge null (jamais un 0 trompeur), même avec charge branchée", () => {
  const r = buildPnlPeriode({
    nights: [night("2026-07-04", [], 0, 0)],
    staffCharge: 2000,
    artistesCharge: 1000,
  });
  assert.equal(r.produit.soireesAvecZ, 0);
  assert.equal(r.margeApresChargesConnues, null);
});

// ————————————————————————————————————————————————————————————————
// buildPnlPeriode — couverture Z (honnêteté)
// ————————————————————————————————————————————————————————————————

test("buildPnlPeriode: soirée opérée (staff présent) sans Z → couverture incomplète, date exposée", () => {
  const r = buildPnlPeriode({
    nights: [
      night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 0, 300),
      night("2026-07-11", [], 0, 0), // opérée mais sans Z
    ],
    operatedDates: ["2026-07-04", "2026-07-11"],
  });
  assert.equal(r.couvertureZComplete, false);
  assert.deepEqual(r.soireesOpereesSansZ, ["2026-07-11"]);
});

test("buildPnlPeriode: toutes les soirées opérées ont un Z → couverture complète", () => {
  const r = buildPnlPeriode({
    nights: [night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 0, 300)],
    operatedDates: ["2026-07-04"],
  });
  assert.equal(r.couvertureZComplete, true);
  assert.deepEqual(r.soireesOpereesSansZ, []);
});

// ————————————————————————————————————————————————————————————————
// buildPnlPeriode — récap mensuel
// ————————————————————————————————————————————————————————————————

test("buildPnlPeriode: découpage mensuel trié, coût staff mensuel joint par monthKey", () => {
  const r = buildPnlPeriode({
    nights: [
      night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 0, 300),
      night("2026-07-11", [z({ ca_ttc: 12000, familles: { bar: 12000 } })], 0, 350),
      night("2026-06-27", [z({ ca_ttc: 8000, familles: { bar: 8000 } })], 0, 200),
    ],
    monthlyStaffCharges: { "2026-06": 1500, "2026-07": 4000 },
  });
  assert.equal(r.months.length, 2);
  assert.equal(r.months[0].month, "2026-06"); // trié croissant
  assert.equal(r.months[0].produit.produitTotal, 8000);
  assert.equal(r.months[0].staffCharge, 1500);
  assert.equal(r.months[0].margeApresStaff, 6500);
  assert.equal(r.months[0].staffDeduit, true);
  assert.equal(r.months[1].month, "2026-07");
  assert.equal(r.months[1].produit.produitTotal, 22000);
  assert.equal(r.months[1].staffCharge, 4000);
  assert.equal(r.months[1].margeApresStaff, 18000);
});

test("buildPnlPeriode: mois sans coût staff (null) → marge = produit avant staff, staffDeduit=false", () => {
  const r = buildPnlPeriode({
    nights: [night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 0, 300)],
    monthlyStaffCharges: { "2026-07": null },
  });
  assert.equal(r.months[0].staffCharge, null);
  assert.equal(r.months[0].staffDeduit, false);
  assert.equal(r.months[0].margeApresStaff, 10000);
});

test("buildPnlPeriode: nuit à date illisible ignorée du récap mensuel (aucun mois inventé)", () => {
  const r = buildPnlPeriode({
    nights: [
      night("2026-07-04", [z({ ca_ttc: 10000, familles: { bar: 10000 } })], 0, 300),
      night("bad-date", [z({ ca_ttc: 5000, familles: { bar: 5000 } })], 0, 100),
    ],
  });
  assert.equal(r.months.length, 1);
  assert.equal(r.months[0].month, "2026-07");
  // Le produit global agrège quand même les deux Z (le produit ne dépend pas de la lisibilité du mois).
  assert.equal(r.produit.produitTotal, 15000);
});
