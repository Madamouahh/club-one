import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateChannelStats,
  buildLeadsBoardView,
  isLeadChannel,
  validateLeadStatDraft,
  type LeadChannelStatRow,
  type LeadStatDraft,
} from "../lib/leadsBoard.ts";
import { LEAD_CHANNELS } from "../lib/leadsPipeline.ts";

// Fabrique une ligne brute (tous champs par défaut null = non tracké).
function row(over: Partial<LeadChannelStatRow>): LeadChannelStatRow {
  return {
    id: over.id ?? "r",
    event_id: over.event_id ?? null,
    channel: over.channel ?? "qr",
    period_start: over.period_start ?? null,
    period_end: over.period_end ?? null,
    impressions: over.impressions ?? null,
    leads: over.leads ?? null,
    resas_demandees: over.resas_demandees ?? null,
    resas_confirmees: over.resas_confirmees ?? null,
    venus: over.venus ?? null,
    spend_cents: over.spend_cents ?? null,
    created_by: over.created_by ?? null,
    created_at: over.created_at ?? "2026-07-01T00:00:00Z",
  };
}

// ————————————————————————————————————————————————————————————————
// isLeadChannel : garde de canal (liste fermée).
// ————————————————————————————————————————————————————————————————
test("isLeadChannel reconnaît les canaux de la liste fermée et rejette le reste", () => {
  for (const c of LEAD_CHANNELS) assert.equal(isLeadChannel(c), true);
  assert.equal(isLeadChannel("inconnu"), false);
  assert.equal(isLeadChannel(""), false);
});

// ————————————————————————————————————————————————————————————————
// aggregateChannelStats : somme des MESURÉS uniquement, null si jamais mesuré (jamais 0 fabriqué).
// ————————————————————————————————————————————————————————————————
test("aucune ligne → aucune entrée agrégée", () => {
  assert.deepEqual(aggregateChannelStats([]), []);
});

test("plusieurs lignes d'un canal → étapes sommées, null si aucune mesure", () => {
  const inputs = aggregateChannelStats([
    row({ id: "a", channel: "qr", leads: 10, resas_confirmees: 3 }),
    row({ id: "b", channel: "qr", leads: 5, venus: 2 }), // resas_confirmees non mesuré ici
  ]);
  assert.equal(inputs.length, 1);
  const qr = inputs[0]!;
  assert.equal(qr.channel, "qr");
  assert.equal(qr.stages?.leads, 15); // 10 + 5
  assert.equal(qr.stages?.resasConfirmees, 3); // mesuré sur la ligne a uniquement (clé camelCase du board)
  assert.equal(qr.stages?.venus, 2); // mesuré sur la ligne b uniquement
  // Étape jamais mesurée (impressions) reste null (non tracké), pas 0.
  assert.equal(qr.stages?.impressions, null);
});

test("mapping snake_case → camelCase des étapes du board", () => {
  const inputs = aggregateChannelStats([
    row({ channel: "promoteur", resas_demandees: 7, resas_confirmees: 4, venus: 3 }),
  ]);
  const p = inputs.find((i) => i.channel === "promoteur")!;
  assert.equal(p.stages?.resasDemandees, 7);
  assert.equal(p.stages?.resasConfirmees, 4);
  assert.equal(p.stages?.venus, 3);
  assert.equal(p.stages?.leads, null); // non mesuré → null
});

test("dépense sommée sur les lignes mesurées ; null si aucune", () => {
  const withSpend = aggregateChannelStats([
    row({ channel: "campagne", spend_cents: 30000 }),
    row({ channel: "campagne", spend_cents: 20000 }),
  ]);
  assert.equal(withSpend[0]!.spentCents, 50000);

  const noSpend = aggregateChannelStats([row({ channel: "campagne", leads: 5 })]);
  assert.equal(noSpend[0]!.spentCents, null); // jamais 0 fabriqué
});

test("canal inconnu (hors liste) est IGNORÉ, jamais agrégé", () => {
  const inputs = aggregateChannelStats([
    row({ channel: "hackzor", leads: 999 }),
    row({ channel: "qr", leads: 1 }),
  ]);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]!.channel, "qr");
});

// ————————————————————————————————————————————————————————————————
// buildLeadsBoardView : bout en bout jusqu'à la vue du board (réutilise buildLeadsPipeline).
// ————————————————————————————————————————————————————————————————
test("buildLeadsBoardView : vide → tous canaux non trackés, roasGlobal null", () => {
  const view = buildLeadsBoardView([], null);
  assert.equal(view.rows.length, LEAD_CHANNELS.length);
  for (const r of view.rows) assert.equal(r.tracked, false);
  assert.equal(view.roasGlobal, null);
  assert.equal(view.event, null);
});

test("buildLeadsBoardView : lignes réelles → funnel agrégé et totaux mesurés", () => {
  const view = buildLeadsBoardView(
    [
      row({ channel: "qr", leads: 20, resas_confirmees: 6, venus: 5 }),
      row({ channel: "promoteur", leads: 10, resas_confirmees: 4 }),
    ],
    { label: "Eden — démo", date: "2026-07-04", venue: "eden" },
  );
  assert.equal(view.totals.leads, 30);
  assert.equal(view.totals.resasConfirmees, 10);
  assert.equal(view.totals.venus, 5); // seul qr a mesuré les entrées
  assert.equal(view.coverage.tracked, 2);
  assert.deepEqual(view.event, { label: "Eden — démo", date: "2026-07-04", venue: "eden" });
});

test("buildLeadsBoardView : campagne avec dépense mais SANS valeur → ROAS non mesurable (jamais inventé)", () => {
  const view = buildLeadsBoardView(
    [row({ channel: "campagne", leads: 50, resas_confirmees: 10, spend_cents: 60000 })],
    null,
  );
  const campagne = view.rows.find((r) => r.channel === "campagne")!;
  assert.equal(campagne.paid, true);
  assert.equal(campagne.spentCents, 60000);
  assert.equal(campagne.roas, null); // pas de valeur générée en 0062 → non mesurable
  assert.equal(campagne.rentabilite, "non_mesurable");
  // Coûts calculables car dépense + étapes mesurées.
  assert.equal(campagne.coutParLeadCents, 60000 / 50);
  assert.equal(campagne.coutParResaCents, 60000 / 10);
});

// ————————————————————————————————————————————————————————————————
// validateLeadStatDraft : garde-fous de saisie.
// ————————————————————————————————————————————————————————————————
function draft(over: Partial<LeadStatDraft>): LeadStatDraft {
  return {
    channel: over.channel ?? "qr",
    period_start: over.period_start ?? null,
    period_end: over.period_end ?? null,
    impressions: over.impressions ?? null,
    leads: over.leads ?? null,
    resas_demandees: over.resas_demandees ?? null,
    resas_confirmees: over.resas_confirmees ?? null,
    venus: over.venus ?? null,
    spend_cents: over.spend_cents ?? null,
  };
}

test("draft valide avec au moins une valeur", () => {
  assert.deepEqual(validateLeadStatDraft(draft({ leads: 10 })), { ok: true });
  assert.deepEqual(validateLeadStatDraft(draft({ spend_cents: 30000 })), { ok: true });
});

test("draft rejeté : canal invalide", () => {
  const r = validateLeadStatDraft(draft({ channel: "inconnu", leads: 1 }));
  assert.equal(r.ok, false);
});

test("draft rejeté : entièrement vide (rien à enregistrer)", () => {
  const r = validateLeadStatDraft(draft({}));
  assert.equal(r.ok, false);
});

test("draft rejeté : valeur négative ou non entière", () => {
  assert.equal(validateLeadStatDraft(draft({ leads: -3 })).ok, false);
  assert.equal(validateLeadStatDraft(draft({ leads: 2.5 })).ok, false);
  assert.equal(validateLeadStatDraft(draft({ spend_cents: NaN })).ok, false);
});

test("draft rejeté : fin de période avant le début", () => {
  const r = validateLeadStatDraft(
    draft({ leads: 1, period_start: "2026-07-10", period_end: "2026-07-01" }),
  );
  assert.equal(r.ok, false);
});

test("draft accepté : période cohérente", () => {
  const r = validateLeadStatDraft(
    draft({ leads: 1, period_start: "2026-07-01", period_end: "2026-07-10" }),
  );
  assert.equal(r.ok, true);
});
