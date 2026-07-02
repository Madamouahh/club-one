import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSENT_MARKETING_TEMPLATE,
  CONSENT_SERVICE_TEMPLATE,
  GUEST_SEGMENTS,
  SEGMENT_RULES,
  checkMessageEvin,
  classifyGuest,
  consentTextsReady,
  crmDataReady,
  daysSince,
  fillConsentText,
  isE164,
  isPurgeable,
  noShowRate,
  normalizeE164,
  prepareContactLink,
  spendThreshold,
  type GuestScoreRow,
} from "../lib/crmClients.ts";

function row(over: Partial<GuestScoreRow> = {}): GuestScoreRow {
  return {
    guest_id: over.guest_id ?? "g1",
    first_name: over.first_name ?? "Alex",
    last_name: over.last_name ?? null,
    owner_promoter: over.owner_promoter ?? null,
    last_seated_date: over.last_seated_date ?? null,
    visits_seated_90d: over.visits_seated_90d ?? 0,
    visits_seated_180d: over.visits_seated_180d ?? 0,
    visits_seated_12m: over.visits_seated_12m ?? 0,
    spend_seated_12m: over.spend_seated_12m ?? null,
    visits_seated_total: over.visits_seated_total ?? 0,
    no_shows_total: over.no_shows_total ?? 0,
    visits_resolved_total: over.visits_resolved_total ?? 0,
    avg_party_size: over.avg_party_size ?? null,
    univers_prefere: over.univers_prefere ?? null,
    client_historique: over.client_historique ?? false,
    first_seen_at: over.first_seen_at ?? null,
    source: over.source ?? null,
  };
}

const TODAY = new Date("2026-07-02T12:00:00Z");

// ————— Consentement : textes EXACTS + placeholders honnêtes —————

test("les gabarits de consentement contiennent les mentions légales clés (STOP, 3 ans, dégroupage)", () => {
  assert.ok(CONSENT_SERVICE_TEMPLATE.includes("confirmations liées à ma réservation"));
  assert.ok(CONSENT_MARKETING_TEMPLATE.includes("STOP"));
  assert.ok(CONSENT_MARKETING_TEMPLATE.includes("3 ans"));
  assert.ok(CONSENT_MARKETING_TEMPLATE.includes("{{raison_sociale}}"));
});

test("fillConsentText remplit les vraies valeurs et LAISSE le placeholder si la donnée manque", () => {
  const full = fillConsentText(CONSENT_MARKETING_TEMPLATE, {
    raisonSociale: "SARL Nuit",
    maxParMois: 4,
    lienPolitique: "https://ex.fr/rgpd",
  });
  assert.ok(full.includes("SARL Nuit"));
  assert.ok(full.includes("max 4 messages/mois"));
  assert.ok(full.includes("https://ex.fr/rgpd"));
  assert.ok(!full.includes("{{"));

  // Donnée fondateur absente → on N'INVENTE PAS de nom : le placeholder reste visible.
  const partial = fillConsentText(CONSENT_SERVICE_TEMPLATE, {});
  assert.ok(partial.includes("{{raison_sociale}}"));
});

test("consentTextsReady liste honnêtement ce qui manque", () => {
  assert.deepEqual(consentTextsReady({}).missing.sort(), ["lien", "max", "raison_sociale"]);
  assert.equal(
    consentTextsReady({ raisonSociale: "X", maxParMois: 3, lienPolitique: "u" }).ready,
    true,
  );
});

// ————— Loi Évin : garde anti-alcool —————

test("checkMessageEvin refuse tout terme d'alcool (accents/casse ignorés) et accepte un message soirée", () => {
  assert.equal(checkMessageEvin("Ta table t'attend samedi, ambiance au top !").ok, true);
  assert.equal(checkMessageEvin("Viens fêter avec nous, DJ Untel en live").ok, true);
  assert.equal(checkMessageEvin("Une bouteille de Champagne t'attend").ok, false);
  assert.equal(checkMessageEvin("CHAMPAGNE offert").ok, false);
  assert.equal(checkMessageEvin("Open bar ce soir").ok, false);
  assert.equal(checkMessageEvin("un mojito pour toi").ok, false);
  // frontière de mot : « vin » ne doit pas matcher « avoine » ni « vingt »
  assert.equal(checkMessageEvin("On t'attend à vingt heures").ok, true);
});

// ————— Téléphone E.164 —————

test("normalizeE164 : formats FR → +33, international conservé, rejette l'inconnu (aucun numéro inventé)", () => {
  assert.equal(normalizeE164("06 12 34 56 78"), "+33612345678");
  assert.equal(normalizeE164("0612345678"), "+33612345678");
  assert.equal(normalizeE164("+33612345678"), "+33612345678");
  assert.equal(normalizeE164("33612345678"), "+33612345678");
  assert.equal(normalizeE164("612345678"), "+33612345678");
  assert.equal(normalizeE164("+44 7911 123456"), "+447911123456");
  assert.equal(normalizeE164("abc"), null);
  assert.equal(normalizeE164(""), null);
  assert.equal(normalizeE164("123"), null);
});

test("isE164 valide le format canonique", () => {
  assert.equal(isE164("+33612345678"), true);
  assert.equal(isE164("0612345678"), false);
  assert.equal(isE164("+0612"), false);
});

// ————— Scoring RFM —————

test("noShowRate : null si aucune visite résolue, sinon ratio", () => {
  assert.equal(noShowRate(row()), null);
  assert.equal(noShowRate(row({ no_shows_total: 1, visits_resolved_total: 4 })), 0.25);
});

test("daysSince calcule un delta en jours (UTC)", () => {
  assert.equal(daysSince("2026-06-02", TODAY), 30);
  assert.equal(daysSince(null, TODAY), null);
  assert.equal(daysSince("pas-une-date", TODAY), null);
});

test("spendThreshold : null sous la cohorte minimale (pas de seuil top-10% fabriqué)", () => {
  assert.equal(spendThreshold([row({ spend_seated_12m: 500 })]), null);
  const cohort = [100, 200, 300, 400, 1000, 5000].map((s, i) =>
    row({ guest_id: `g${i}`, spend_seated_12m: s }),
  );
  const th = spendThreshold(cohort);
  assert.ok(th != null && th >= 1000);
});

test("classifyGuest : prospect si jamais assis ET non historique (aucun client fidèle fabriqué)", () => {
  const c = classifyGuest(row({ visits_seated_total: 0 }), {
    today: TODAY,
    spendThreshold: 1000,
  });
  assert.equal(c.segment, "prospect");
});

test("classifyGuest : historique importé (0 visite datée mais client_historique) ≠ prospect « jamais venu »", () => {
  // 2050 fiches OctoTable importées (S16) : client_historique=true, aucune ligne guest_visits →
  // visits_seated_total = 0. Les étiqueter « jamais venu » serait FAUX (ils ont fréquenté avant).
  const c = classifyGuest(
    row({ visits_seated_total: 0, client_historique: true, source: "octotable", first_seen_at: "2025-03-01" }),
    { today: TODAY, spendThreshold: 1000 },
  );
  assert.equal(c.segment, "historique");
  assert.notEqual(c.segment, "prospect");
});

test("classifyGuest : un historique importé QUI REVIENT (visite datée seated) reprend un segment RFM normal", () => {
  // Dès qu'une vraie visite datée existe, le client sort de « historique » et est scoré normalement :
  // le flag client_historique ne « colle » jamais un client à un segment vide.
  const c = classifyGuest(
    row({
      visits_seated_total: 1,
      visits_seated_180d: 1,
      last_seated_date: "2026-06-25",
      client_historique: true,
    }),
    { today: TODAY, spendThreshold: 1000 },
  );
  assert.notEqual(c.segment, "historique");
  assert.notEqual(c.segment, "prospect");
  assert.equal(c.segment, "occasional");
});

test("classifyGuest : VIP = top spend + ≥3 visites/180j + no-show < 20%", () => {
  const vip = classifyGuest(
    row({
      visits_seated_total: 5,
      visits_seated_180d: 4,
      spend_seated_12m: 3000,
      no_shows_total: 0,
      visits_resolved_total: 5,
      last_seated_date: "2026-06-20",
    }),
    { today: TODAY, spendThreshold: 1000 },
  );
  assert.equal(vip.segment, "vip");
  assert.equal(vip.isTopSpender, true);

  // Même dépense mais trop de no-show → PAS VIP.
  const noisy = classifyGuest(
    row({
      visits_seated_total: 5,
      visits_seated_180d: 4,
      spend_seated_12m: 3000,
      no_shows_total: 3,
      visits_resolved_total: 8,
      last_seated_date: "2026-06-20",
    }),
    { today: TODAY, spendThreshold: 1000 },
  );
  assert.notEqual(noisy.segment, "vip");
});

test("classifyGuest : sans seuil de dépense (cohorte trop petite) → jamais VIP", () => {
  const c = classifyGuest(
    row({
      visits_seated_total: 5,
      visits_seated_180d: 4,
      spend_seated_12m: 9999,
      last_seated_date: "2026-06-20",
      visits_resolved_total: 5,
    }),
    { today: TODAY, spendThreshold: null },
  );
  assert.notEqual(c.segment, "vip");
});

test("classifyGuest : one-shot gros ticket, dormant, régulier, occasionnel", () => {
  const oneShot = classifyGuest(
    row({ visits_seated_total: 1, spend_seated_12m: 2000, last_seated_date: "2026-06-28" }),
    { today: TODAY, spendThreshold: 1000 },
  );
  assert.equal(oneShot.segment, "one_shot");

  const dormant = classifyGuest(
    row({ visits_seated_total: 4, visits_seated_180d: 0, last_seated_date: "2026-04-01" }),
    { today: TODAY, spendThreshold: 1000 },
  );
  assert.equal(dormant.segment, "dormant");
  assert.ok((dormant.daysSinceLastSeated ?? 0) >= SEGMENT_RULES.dormantMinDays);

  const regular = classifyGuest(
    row({ visits_seated_total: 3, visits_seated_180d: 3, last_seated_date: "2026-06-25" }),
    { today: TODAY, spendThreshold: 1000 },
  );
  assert.equal(regular.segment, "regular");

  const occasional = classifyGuest(
    row({ visits_seated_total: 1, visits_seated_180d: 1, last_seated_date: "2026-06-25" }),
    { today: TODAY, spendThreshold: 1000 },
  );
  assert.equal(occasional.segment, "occasional");
});

test("classifyGuest : flag anniversaire ce mois-ci (additionnel, pas un segment exclusif)", () => {
  const c = classifyGuest(
    row({ visits_seated_total: 3, visits_seated_180d: 3, last_seated_date: "2026-06-25" }),
    { today: TODAY, spendThreshold: 1000, birthdayMonth: 7 },
  );
  assert.equal(c.birthdayThisMonth, true);
  assert.equal(c.segment, "regular");

  const other = classifyGuest(row({ visits_seated_total: 1 }), {
    today: TODAY,
    spendThreshold: 1000,
    birthdayMonth: 3,
  });
  assert.equal(other.birthdayThisMonth, false);
});

test("les 7 segments primaires sont figés (dont « historique » importé, 0018)", () => {
  assert.equal(GUEST_SEGMENTS.length, 7);
  assert.ok(GUEST_SEGMENTS.includes("historique"));
  assert.ok(GUEST_SEGMENTS.includes("prospect"));
});

// ————— Préparation wa.me : toutes les gardes —————

test("prepareContactLink : construit un lien wa.me quand tout est conforme", () => {
  const r = prepareContactLink(
    { phoneE164: "+33612345678", optOut: false, consentMarketing: true, purpose: "marketing" },
    "Ta table t'attend samedi !",
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.url.startsWith("https://wa.me/33612345678?text="));
    assert.ok(r.url.includes(encodeURIComponent("Ta table t'attend samedi !")));
  }
});

test("prepareContactLink : refuse opt-out, absence de consentement marketing, Évin, numéro manquant, message vide", () => {
  const base = {
    phoneE164: "+33612345678",
    optOut: false,
    consentMarketing: true,
    purpose: "marketing" as const,
  };
  assert.deepEqual(prepareContactLink({ ...base, optOut: true }, "Salut"), {
    ok: false,
    reason: "opt_out",
  });
  assert.deepEqual(prepareContactLink({ ...base, consentMarketing: false }, "Salut"), {
    ok: false,
    reason: "no_consent",
  });
  assert.deepEqual(prepareContactLink(base, "Champagne offert"), { ok: false, reason: "evin" });
  assert.deepEqual(prepareContactLink({ ...base, phoneE164: null }, "Salut"), {
    ok: false,
    reason: "no_phone",
  });
  assert.deepEqual(prepareContactLink(base, "   "), { ok: false, reason: "empty_message" });
});

test("prepareContactLink : un message de SERVICE ne requiert pas le consentement marketing", () => {
  const r = prepareContactLink(
    { phoneE164: "+33612345678", optOut: false, consentMarketing: false, purpose: "service" },
    "Ta table est prête, entrée côté rue.",
  );
  assert.equal(r.ok, true);
});

// ————— Purge RGPD & état vide —————

test("isPurgeable : > 3 ans après dernier contact entrant, jamais à l'aveugle", () => {
  assert.equal(isPurgeable("2022-01-01T00:00:00Z", TODAY), true);
  assert.equal(isPurgeable("2025-01-01T00:00:00Z", TODAY), false);
  assert.equal(isPurgeable(null, TODAY), false);
});

test("crmDataReady reflète l'état réel (base vide = 0)", () => {
  assert.deepEqual(crmDataReady([]), { total: 0, withSpend: 0, seatedAtLeastOnce: 0 });
  assert.deepEqual(
    crmDataReady([
      row({ visits_seated_total: 2, spend_seated_12m: 500 }),
      row({ guest_id: "g2", visits_seated_total: 0 }),
    ]),
    { total: 2, withSpend: 1, seatedAtLeastOnce: 1 },
  );
});
