import assert from "node:assert/strict";
import test from "node:test";

import {
  LEAD_CHANNELS,
  LEAD_PALIERS,
  buildLeadsPipeline,
  canManageLeads,
  canViewLeads,
  formatEurosFromCents,
  formatRoas,
  formatTaux,
  isPaidChannel,
  isValidPalier,
  leadChannelTitle,
  leadRentabiliteLabel,
  leadStageTitle,
} from "../lib/leadsPipeline.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Gardes de rôle : B12 = direction. admin pilote (✅➕), manager consulte (👁), reste ⛔.
// ————————————————————————————————————————————————————————————————
test("canViewLeads : admin/manager OUI ; employés/promoteur NON", () => {
  assert.equal(canViewLeads("admin"), true);
  assert.equal(canViewLeads("manager"), true);
  for (const role of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canViewLeads(role), false, `${role} ne doit PAS voir B12`);
  }
});

test("canManageLeads : SEUL l'admin pilote (saisie dépense/palier) ; manager consulte seulement", () => {
  assert.equal(canManageLeads("admin"), true);
  for (const role of ["manager", "server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canManageLeads(role), false, `${role} ne doit PAS piloter B12`);
  }
});

test("les gardes couvrent tous les rôles connus sans exception", () => {
  for (const role of STAFF_ROLES) {
    assert.equal(typeof canViewLeads(role), "boolean");
    assert.equal(typeof canManageLeads(role), "boolean");
  }
});

// ————————————————————————————————————————————————————————————————
// Honnêteté de couverture : sans aucune donnée → tous canaux non trackés, agrégats à zéro,
// ROAS global null (jamais fabriqué), 0 canal à couper.
// ————————————————————————————————————————————————————————————————
test("aucune entrée → chaque canal non tracké, totaux 0, roasGlobal null", () => {
  const view = buildLeadsPipeline({ activeEvent: null, channels: [] });
  assert.equal(view.rows.length, LEAD_CHANNELS.length);
  for (const row of view.rows) {
    assert.equal(row.tracked, false);
    for (const stage of Object.values(row.stages)) {
      assert.equal(stage, null); // null (non tracké), jamais 0
    }
    assert.equal(row.tauxLeadVersResa, null);
    assert.equal(row.roas, null);
  }
  assert.equal(view.totals.leads, 0);
  assert.equal(view.totals.resasConfirmees, 0);
  assert.equal(view.roasGlobal, null);
  assert.equal(view.coverage.tracked, 0);
  assert.equal(view.coverage.total, LEAD_CHANNELS.length);
  assert.equal(view.aCouperCount, 0);
  assert.equal(view.event, null);
});

test("les lignes sortent dans l'ordre canonique de LEAD_CHANNELS", () => {
  const view = buildLeadsPipeline({ activeEvent: null, channels: [] });
  assert.deepEqual(
    view.rows.map((r) => r.channel),
    [...LEAD_CHANNELS],
  );
});

// ————————————————————————————————————————————————————————————————
// Étapes mesurées vs non trackées : null ≠ 0, aucune métrique fabriquée.
// ————————————————————————————————————————————————————————————————
test("étape mesurée = number, clé absente = null (non tracké) — jamais 0 fabriqué", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "promoteur", stages: { leads: 12, resasConfirmees: 4 } }],
  });
  const row = view.rows.find((r) => r.channel === "promoteur")!;
  assert.equal(row.tracked, true);
  assert.equal(row.stages.leads, 12);
  assert.equal(row.stages.resasConfirmees, 4);
  assert.equal(row.stages.impressions, null); // non fourni → non tracké, PAS 0
  assert.equal(row.stages.venus, null);
});

test("taux calculé seulement entre étapes mesurées", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "qr", stages: { leads: 20, resasConfirmees: 5, venus: 4 } }],
  });
  const row = view.rows.find((r) => r.channel === "qr")!;
  assert.equal(row.tauxLeadVersResa, 5 / 20);
  assert.equal(row.tauxResaVersVenu, 4 / 5);
});

test("taux null si une extrémité non mesurée (jamais 0 fabriqué)", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "qr", stages: { resasConfirmees: 5 } }], // leads non mesuré
  });
  const row = view.rows.find((r) => r.channel === "qr")!;
  assert.equal(row.tauxLeadVersResa, null);
});

test("taux null si dénominateur = 0 (jamais division par zéro trompeuse)", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "qr", stages: { leads: 0, resasConfirmees: 0 } }],
  });
  const row = view.rows.find((r) => r.channel === "qr")!;
  assert.equal(row.tauxLeadVersResa, null);
});

// ————————————————————————————————————————————————————————————————
// Canaux payants : coût/lead, coût/résa, ROAS, rentabilité (« sinon on coupe »).
// ————————————————————————————————————————————————————————————————
test("campagne = canal payant ; les autres = gratuits", () => {
  assert.equal(isPaidChannel("campagne"), true);
  for (const c of ["qr", "promoteur", "google_business", "direct", "import"] as const) {
    assert.equal(isPaidChannel(c), false, `${c} doit être gratuit`);
  }
});

test("canal payant avec dépense + valeur → coût/lead, coût/résa, ROAS calculés", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [
      {
        channel: "campagne",
        stages: { leads: 100, resasConfirmees: 20 },
        spentCents: 30000, // 300 €
        palier: 300,
        valueCents: 90000, // 900 € de résa générée
      },
    ],
  });
  const row = view.rows.find((r) => r.channel === "campagne")!;
  assert.equal(row.paid, true);
  assert.equal(row.coutParLeadCents, 30000 / 100); // 3 €/lead
  assert.equal(row.coutParResaCents, 30000 / 20); // 15 €/résa
  assert.equal(row.roas, 90000 / 30000); // ×3
  assert.equal(row.rentabilite, "rentable"); // ROAS ≥ 2
  assert.equal(row.palier, 300);
});

test("ROAS < 1 → « à couper » (dépense > valeur générée)", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "campagne", stages: { leads: 10 }, spentCents: 60000, valueCents: 30000 }],
  });
  const row = view.rows.find((r) => r.channel === "campagne")!;
  assert.equal(row.roas, 0.5);
  assert.equal(row.rentabilite, "a_couper");
  assert.equal(view.aCouperCount, 1);
});

test("ROAS entre 1 et 2 → « à surveiller »", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "campagne", spentCents: 60000, valueCents: 90000 }],
  });
  const row = view.rows.find((r) => r.channel === "campagne")!;
  assert.equal(row.roas, 1.5);
  assert.equal(row.rentabilite, "a_surveiller");
});

test("dépense non renseignée → coûts null, rentabilité non_mesurable (jamais de ROI inventé)", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "campagne", stages: { leads: 50 } }], // aucune dépense saisie
  });
  const row = view.rows.find((r) => r.channel === "campagne")!;
  assert.equal(row.spentCents, null);
  assert.equal(row.coutParLeadCents, null);
  assert.equal(row.roas, null);
  assert.equal(row.rentabilite, "non_mesurable");
});

test("canal gratuit → rentabilité « gratuit », dépense/palier forcés null même si fournis", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [
      // spentCents/palier fournis par erreur sur un canal gratuit : DOIVENT être ignorés.
      { channel: "promoteur", stages: { leads: 30, resasConfirmees: 10 }, spentCents: 99999, palier: 600 },
    ],
  });
  const row = view.rows.find((r) => r.channel === "promoteur")!;
  assert.equal(row.paid, false);
  assert.equal(row.spentCents, null);
  assert.equal(row.palier, null);
  assert.equal(row.rentabilite, "gratuit");
});

// ————————————————————————————————————————————————————————————————
// Totaux et complétude honnête.
// ————————————————————————————————————————————————————————————————
test("totaux : somme des valeurs MESURÉES uniquement (les null ignorés, pas comptés 0)", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [
      { channel: "qr", stages: { leads: 10, resasConfirmees: 3, venus: 2 } },
      { channel: "promoteur", stages: { leads: 20, resasConfirmees: 8 } }, // venus non mesuré
    ],
  });
  assert.equal(view.totals.leads, 30);
  assert.equal(view.totals.resasConfirmees, 11);
  assert.equal(view.totals.venus, 2); // seul le canal qr a mesuré les entrées
  assert.equal(view.coverage.tracked, 2);
});

test("spendComplete faux si un canal payant n'a pas de dépense saisie", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "campagne", stages: { leads: 40 } }], // pas de dépense
  });
  assert.equal(view.totals.spendComplete, false);
  assert.equal(view.roasGlobal, null); // incomplet → refuse tout chiffre trompeur
});

test("roasGlobal calculé quand dépense ET valeur complètes et dépense > 0", () => {
  const view = buildLeadsPipeline({
    activeEvent: { label: "Eden — démo", date: "2026-07-04", venue: "eden" },
    channels: [
      { channel: "campagne", spentCents: 30000, valueCents: 120000 },
      { channel: "qr", stages: { leads: 50 } }, // gratuit : n'affecte pas la complétude dépense
    ],
  });
  assert.equal(view.totals.spendComplete, true);
  assert.equal(view.totals.valueComplete, true);
  assert.equal(view.roasGlobal, 120000 / 30000); // ×4
  assert.deepEqual(view.event, { label: "Eden — démo", date: "2026-07-04", venue: "eden" });
});

test("aucun canal payant → complétude triviale et roasGlobal null (dépense 0)", () => {
  const view = buildLeadsPipeline({
    activeEvent: null,
    channels: [{ channel: "qr", stages: { leads: 10 } }],
  });
  assert.equal(view.totals.spendComplete, true);
  assert.equal(view.totals.spentCents, 0);
  assert.equal(view.roasGlobal, null); // pas de dépense → pas de ROAS fabriqué
});

// ————————————————————————————————————————————————————————————————
// Paliers, titres et formatage déterministe.
// ————————————————————————————————————————————————————————————————
test("paliers valides = 300 / 600 / 1200 uniquement", () => {
  for (const p of LEAD_PALIERS) assert.equal(isValidPalier(p), true);
  assert.equal(isValidPalier(500), false);
  assert.equal(isValidPalier(0), false);
});

test("titres de canal, d'étape et libellés de rentabilité définis et non vides", () => {
  for (const c of LEAD_CHANNELS) assert.ok(leadChannelTitle(c).length > 0);
  assert.ok(leadStageTitle("leads").length > 0);
  assert.equal(leadRentabiliteLabel("a_couper"), "À couper");
  assert.equal(leadRentabiliteLabel("gratuit"), "Gratuit");
});

test("formatage FR déterministe (euros, taux, ROAS) ; null → « — »", () => {
  assert.equal(formatEurosFromCents(30000), "300,00 €");
  assert.equal(formatTaux(0.25), "25 %");
  assert.equal(formatTaux(null), "—");
  assert.equal(formatRoas(null), "—");
  assert.match(formatRoas(3), /×3/);
});
