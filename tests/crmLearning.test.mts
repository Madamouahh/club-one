import assert from "node:assert/strict";
import test from "node:test";

import {
  COVERAGE_MIN_CONFIDENCE,
  FORMAT_UNLABELED,
  RETENTION_WINDOW_DAYS,
  buildFormatMonthlyRollup,
  buildSoireeUniversMetrics,
  daysBetween,
  isLearningUnivers,
  isoToEpochDay,
  summarizeLearningHonesty,
  type BuildLearningInput,
  type LearningVisit,
} from "../lib/crmLearning.ts";
import type { CaisseZRecord } from "../lib/caisseZ.ts";

function z(overrides: Partial<CaisseZRecord> = {}): CaisseZRecord {
  return {
    id: "z",
    exploitation_date: "2026-06-06",
    venue: "eden",
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

function v(overrides: Partial<LearningVisit> = {}): LearningVisit {
  return {
    guest_id: "g",
    exploitation_date: "2026-06-06",
    univers: "eden",
    status: "seated",
    spend_attributed: null,
    ...overrides,
  };
}

function build(overrides: Partial<BuildLearningInput> = {}) {
  return buildSoireeUniversMetrics({
    caisseRecords: [],
    visits: [],
    today: "2026-07-03",
    ...overrides,
  });
}

// ————————————————————————————————————————————————————————————————
// Utilitaires de date
// ————————————————————————————————————————————————————————————————

test("isoToEpochDay parse une date ISO et rejette le format invalide", () => {
  assert.equal(isoToEpochDay("1970-01-01"), 0);
  assert.equal(isoToEpochDay("1970-01-02"), 1);
  assert.equal(isoToEpochDay("2026-06-06"), isoToEpochDay("2026-06-06"));
  assert.equal(isoToEpochDay("2026-6-6"), null);
  assert.equal(isoToEpochDay("pas une date"), null);
  assert.equal(isoToEpochDay(""), null);
});

test("daysBetween compte les jours entiers et propage l'invalidité", () => {
  assert.equal(daysBetween("2026-06-06", "2026-07-06"), 30);
  assert.equal(daysBetween("2026-06-06", "2026-06-06"), 0);
  assert.equal(daysBetween("2026-07-06", "2026-06-06"), -30);
  assert.equal(daysBetween("bad", "2026-06-06"), null);
});

test("isLearningUnivers exclut 'complexe' (non ventilable par salle)", () => {
  assert.equal(isLearningUnivers("eden"), true);
  assert.equal(isLearningUnivers("terminus"), true);
  assert.equal(isLearningUnivers("complexe"), false);
  assert.equal(isLearningUnivers("inconnu"), false);
});

// ————————————————————————————————————————————————————————————————
// Couverture — le garde-fou d'honnêteté
// ————————————————————————————————————————————————————————————————

test("couverture = spend identifié / CA réel, verdict 'confident' au-dessus du seuil", () => {
  const cells = build({
    caisseRecords: [z({ ca_ttc: 1000 })],
    visits: [
      v({ guest_id: "a", spend_attributed: 120 }),
      v({ guest_id: "b", spend_attributed: 80 }),
    ],
  });
  assert.equal(cells.length, 1);
  const c = cells[0];
  assert.equal(c.caReel, 1000);
  assert.equal(c.spendIdentifie, 200);
  assert.equal(c.coverage, 0.2);
  assert.ok(c.coverage! >= COVERAGE_MIN_CONFIDENCE);
  assert.equal(c.coverageVerdict, "confident");
  assert.equal(c.visitsSeated, 2);
  assert.equal(c.visitsSpendIdentified, 2);
});

test("sous 15 % de couverture le verdict est 'tables-only' (on ne conclut pas sur la soirée)", () => {
  const cells = build({
    caisseRecords: [z({ ca_ttc: 1000 })],
    visits: [v({ guest_id: "a", spend_attributed: 100 })], // 10 % < 15 %
  });
  assert.equal(cells[0].coverage, 0.1);
  assert.equal(cells[0].coverageVerdict, "tables-only");
});

test("pas de Z par univers → CA réel null, couverture null, verdict 'no-data' (jamais 0 inventé)", () => {
  const cells = build({
    // Seule une ligne 'complexe' existe : non ventilable par salle.
    caisseRecords: [z({ venue: "complexe", ca_ttc: 5000 })],
    visits: [v({ guest_id: "a", spend_attributed: 300 })],
  });
  assert.equal(cells.length, 1);
  assert.equal(cells[0].caReel, null);
  assert.equal(cells[0].coverage, null);
  assert.equal(cells[0].coverageVerdict, "no-data");
  assert.equal(cells[0].spendIdentifie, 300);
});

test("CA réel présent sans aucune table identifiée → couverture 0 %, cellule émise quand même", () => {
  const cells = build({ caisseRecords: [z({ ca_ttc: 800 })], visits: [] });
  assert.equal(cells.length, 1);
  assert.equal(cells[0].caReel, 800);
  assert.equal(cells[0].spendIdentifie, 0);
  assert.equal(cells[0].coverage, 0);
  assert.equal(cells[0].coverageVerdict, "tables-only");
  assert.equal(cells[0].nbNouveaux, 0);
});

test("seuls les 'seated' comptent : no_show / booked ignorés en présence et en spend", () => {
  const cells = build({
    caisseRecords: [z({ ca_ttc: 1000 })],
    visits: [
      v({ guest_id: "a", status: "seated", spend_attributed: 200 }),
      v({ guest_id: "b", status: "no_show", spend_attributed: 999 }),
      v({ guest_id: "c", status: "booked" }),
      v({ guest_id: "d", status: "cancelled" }),
    ],
  });
  assert.equal(cells[0].visitsSeated, 1);
  assert.equal(cells[0].spendIdentifie, 200);
});

// ————————————————————————————————————————————————————————————————
// Nouveaux captés & rétention J+30
// ————————————————————————————————————————————————————————————————

test("nouveau capté = 1re présence de l'histoire ; une venue ultérieure ne recompte pas", () => {
  const cells = build({
    caisseRecords: [z({ exploitation_date: "2026-06-06" }), z({ exploitation_date: "2026-06-13" })],
    visits: [
      v({ guest_id: "a", exploitation_date: "2026-06-06" }), // 1re venue de a
      v({ guest_id: "a", exploitation_date: "2026-06-13" }), // retour, pas un nouveau
      v({ guest_id: "b", exploitation_date: "2026-06-13" }), // 1re venue de b
    ],
  });
  const j06 = cells.find((c) => c.exploitationDate === "2026-06-06")!;
  const j13 = cells.find((c) => c.exploitationDate === "2026-06-13")!;
  assert.equal(j06.nbNouveaux, 1); // a
  assert.equal(j13.nbNouveaux, 1); // b seulement
});

test("un client seated dans deux salles la même nuit n'est nouveau que dans une cellule", () => {
  const cells = build({
    visits: [
      v({ guest_id: "a", univers: "cercle" }),
      v({ guest_id: "a", univers: "eden" }),
    ],
  });
  const total = cells.reduce((s, c) => s + c.nbNouveaux, 0);
  assert.equal(total, 1);
  // Départage déterministe : eden précède cercle dans l'ordre canonique.
  assert.equal(cells.find((c) => c.univers === "eden")!.nbNouveaux, 1);
  assert.equal(cells.find((c) => c.univers === "cercle")!.nbNouveaux, 0);
});

test("retour J+30 : revenu dans la fenêtre = returned ; fenêtre = 30 jours inclus", () => {
  assert.equal(RETENTION_WINDOW_DAYS, 30);
  const cells = build({
    today: "2026-07-20",
    visits: [
      v({ guest_id: "a", exploitation_date: "2026-06-06" }), // capté
      v({ guest_id: "a", exploitation_date: "2026-07-06" }), // J+30 pile → revenu
      v({ guest_id: "b", exploitation_date: "2026-06-06" }), // capté, ne revient pas
    ],
  });
  const j06 = cells.find((c) => c.exploitationDate === "2026-06-06")!;
  assert.equal(j06.nbNouveaux, 2);
  assert.equal(j06.retention.eligible, 2);
  assert.equal(j06.retention.returned, 1);
  assert.equal(j06.retention.pending, 0);
  assert.equal(j06.retention.rate, 0.5);
});

test("retour J+31 est HORS fenêtre (strictement > 30 j ne compte pas)", () => {
  const cells = build({
    today: "2026-08-01",
    visits: [
      v({ guest_id: "a", exploitation_date: "2026-06-06" }),
      v({ guest_id: "a", exploitation_date: "2026-07-07" }), // J+31
    ],
  });
  const j06 = cells.find((c) => c.exploitationDate === "2026-06-06")!;
  assert.equal(j06.retention.returned, 0);
  assert.equal(j06.retention.rate, 0);
});

test("fenêtre J+30 non écoulée → pending, pas éligible, rate null (verdict différé honnête)", () => {
  const cells = build({
    today: "2026-06-20", // 14 jours après le 06 → fenêtre pas écoulée
    visits: [v({ guest_id: "a", exploitation_date: "2026-06-06" })],
  });
  const j06 = cells.find((c) => c.exploitationDate === "2026-06-06")!;
  assert.equal(j06.retention.pending, 1);
  assert.equal(j06.retention.eligible, 0);
  assert.equal(j06.retention.returned, 0);
  assert.equal(j06.retention.rate, null);
});

// ————————————————————————————————————————————————————————————————
// Rollup mensuel par format
// ————————————————————————————————————————————————————————————————

test("rollup mensuel : sans étiquette, tout tombe dans le seau FORMAT_UNLABELED (labeled=false)", () => {
  const cells = build({
    caisseRecords: [z({ ca_ttc: 1000 })],
    visits: [v({ guest_id: "a", spend_attributed: 300 })],
  });
  const rollup = buildFormatMonthlyRollup(cells);
  assert.equal(rollup.length, 1);
  assert.equal(rollup[0].month, "2026-06");
  assert.equal(rollup[0].format, FORMAT_UNLABELED);
  assert.equal(rollup[0].labeled, false);
});

test("rollup mensuel : groupe par (mois, format), moyennes exposent leur base", () => {
  const formatFor = (_d: string, u: string) => (u === "eden" ? "techno" : null);
  const cells = build({
    caisseRecords: [
      z({ exploitation_date: "2026-06-06", venue: "eden", ca_ttc: 1000 }),
      z({ exploitation_date: "2026-06-13", venue: "eden", ca_ttc: 2000 }),
    ],
    visits: [
      v({ guest_id: "a", exploitation_date: "2026-06-06", univers: "eden", spend_attributed: 300 }),
      v({ guest_id: "b", exploitation_date: "2026-06-13", univers: "eden", spend_attributed: 800 }),
    ],
    formatFor,
  });
  const rollup = buildFormatMonthlyRollup(cells);
  const techno = rollup.find((r) => r.format === "techno")!;
  assert.equal(techno.labeled, true);
  assert.equal(techno.nbSoirees, 2);
  assert.equal(techno.caMoyen, 1500); // (1000 + 2000) / 2
  assert.equal(techno.caCellsCount, 2);
  assert.equal(techno.nouveauxTotal, 2);
  // Couverture : (0.3 + 0.4) / 2 = 0.35
  assert.equal(techno.couvertureMoyenne, 0.35);
  assert.equal(techno.couvertureCellsCount, 2);
});

test("rollup : caMoyen null quand aucune cellule n'a de CA réel (base = 0)", () => {
  const cells = build({
    caisseRecords: [z({ venue: "complexe", ca_ttc: 5000 })],
    visits: [v({ guest_id: "a", spend_attributed: 100 })],
    formatFor: () => "house",
  });
  const rollup = buildFormatMonthlyRollup(cells);
  assert.equal(rollup[0].caMoyen, null);
  assert.equal(rollup[0].caCellsCount, 0);
  assert.equal(rollup[0].couvertureMoyenne, null);
});

// ————————————————————————————————————————————————————————————————
// Synthèse d'honnêteté
// ————————————————————————————————————————————————————————————————

test("summarizeLearningHonesty : ready=false tant qu'aucune cellule confiante+étiquetée", () => {
  const cells = build({
    caisseRecords: [z({ ca_ttc: 1000 })],
    visits: [v({ guest_id: "a", spend_attributed: 100 })], // 10 % → tables-only, non étiqueté
  });
  const h = summarizeLearningHonesty(cells);
  assert.equal(h.cellsTotal, 1);
  assert.equal(h.cellsWithCoverage, 1);
  assert.equal(h.cellsConfident, 0);
  assert.equal(h.cellsTablesOnly, 1);
  assert.equal(h.cellsUnlabeled, 1);
  assert.equal(h.coverageGlobal, 0.1);
  assert.equal(h.ready, false);
});

test("summarizeLearningHonesty : ready=true avec ≥1 cellule confiante ET ≥1 étiquetée", () => {
  const cells = build({
    caisseRecords: [z({ ca_ttc: 1000, venue: "eden" })],
    visits: [
      v({ guest_id: "a", spend_attributed: 300 }),
      v({ guest_id: "b", spend_attributed: 200 }),
    ],
    formatFor: () => "techno",
  });
  const h = summarizeLearningHonesty(cells);
  assert.equal(h.cellsConfident, 1);
  assert.equal(h.cellsUnlabeled, 0);
  assert.equal(h.coverageGlobal, 0.5);
  assert.equal(h.ready, true);
});

test("summarizeLearningHonesty : coverageGlobal ignore les cellules sans Z (base honnête)", () => {
  const cells = build({
    caisseRecords: [z({ ca_ttc: 1000, venue: "eden" })],
    visits: [
      v({ guest_id: "a", univers: "eden", spend_attributed: 300 }),
      // cellule cercle : présence mais pas de Z → n'entre pas dans coverageGlobal
      v({ guest_id: "b", univers: "cercle", spend_attributed: 999 }),
    ],
  });
  const h = summarizeLearningHonesty(cells);
  assert.equal(h.cellsWithCoverage, 1);
  assert.equal(h.coverageGlobal, 0.3); // 300 / 1000, la cellule cercle exclue
});
