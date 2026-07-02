import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDelimited,
  assertOctotableHeader,
  normalizeOctotablePhone,
  mapOctotableRow,
  parseOctotableCustomers,
  dedupeCandidates,
  buildGuestUpsert,
  buildDryRunReport,
  runOctotableDryRun,
  OCTOTABLE_EXPECTED_HEADER,
  OCTOTABLE_SOURCE,
  OCTOTABLE_VENUE,
  OCTOTABLE_NEWSLETTER_CONSENT_SOURCE,
  type OctotableCandidate,
} from "../lib/octotableImport.ts";

// ————————————————————————————————————————————————————————————————
// TOUTES les données ci-dessous sont des FIXTURES DE TEST inventées (préfixe TEST_ sur les noms,
// numéros de la plage documentaire +33 6 39 XX XX XX). AUCUN vrai client n'est reproduit ici.
// ————————————————————————————————————————————————————————————————
const HEADER = OCTOTABLE_EXPECTED_HEADER.join(";");
// 22 colonnes : Prénom;Nom;Email;Téléphone;Préfixe;Date création;Langue;Bloqué;Visible;No show;
//               Allergènes;Types;Attributs;Newsletter;Date activ. newsletter;Notes;Adresse;Ville;CP;Dép;Pays;Notes adr.
function fixtureRow(o: {
  prenom?: string;
  nom?: string;
  email?: string;
  tel?: string;
  prefixe?: string;
  creation?: string;
  bloque?: string;
  noshow?: string;
  newsletter?: string;
  activ?: string;
}): string {
  return [
    o.prenom ?? "",
    o.nom ?? "",
    o.email ?? "",
    o.tel ?? "",
    o.prefixe ?? "",
    o.creation ?? "",
    "fr", // Langue
    o.bloque ?? "false",
    "true", // Visible
    o.noshow ?? "false",
    "", // Allergènes
    "", // Types de profil
    "", // Attributs marketing
    o.newsletter ?? "false",
    o.activ ?? "",
    "", "", "", "", "", "", "", // Notes → Notes d'adresse
  ].join(";");
}

// ————————————————————————————————————————————————————————————————
// parseDelimited — CSV robuste (BOM, CRLF, guillemets, délimiteur DANS un champ).
// ————————————————————————————————————————————————————————————————
test("parseDelimited gère CRLF et le BOM UTF-8", () => {
  const rows = parseDelimited("﻿a;b;c\r\n1;2;3\r\n", ";");
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseDelimited respecte les guillemets (délimiteur et saut de ligne inclus dans le champ)", () => {
  const rows = parseDelimited('a;"b;still b";c\n"multi\nline";x;y', ";");
  assert.deepEqual(rows, [["a", "b;still b", "c"], ["multi\nline", "x", "y"]]);
});

test("parseDelimited gère un guillemet échappé \"\"", () => {
  const rows = parseDelimited('"say ""hi""";end', ";");
  assert.deepEqual(rows, [['say "hi"', "end"]]);
});

// ————————————————————————————————————————————————————————————————
// assertOctotableHeader — refuse un en-tête qui a dérivé (jamais de mapping à l'aveugle).
// ————————————————————————————————————————————————————————————————
test("assertOctotableHeader accepte l'en-tête réel attendu", () => {
  assert.equal(assertOctotableHeader([...OCTOTABLE_EXPECTED_HEADER]).ok, true);
});

test("assertOctotableHeader refuse un en-tête réordonné", () => {
  const bad = [...OCTOTABLE_EXPECTED_HEADER];
  [bad[3], bad[4]] = [bad[4], bad[3]]; // Téléphone <-> Préfixe inversés
  assert.equal(assertOctotableHeader(bad).ok, false);
});

// ————————————————————————————————————————————————————————————————
// normalizeOctotablePhone — préfixe + numéro combinés, aucun numéro fabriqué.
// ————————————————————————————————————————————————————————————————
test("préfixe +33 + numéro national 0X → E.164", () => {
  assert.equal(normalizeOctotablePhone("+33", "0639000001"), "+33639000001");
});

test("préfixe +33 + mobile sans 0 (leading 6) → E.164", () => {
  assert.equal(normalizeOctotablePhone("+33", "639000002"), "+33639000002");
});

test("numéro déjà international dans la colonne téléphone : le préfixe est ignoré", () => {
  assert.equal(normalizeOctotablePhone("+33", "+352639000003"), "+352639000003");
});

test("préfixe étranger +44 + national → E.164 étranger", () => {
  assert.equal(normalizeOctotablePhone("+44", "07700900123"), "+447700900123");
});

test("téléphone non numérique (« Fixe ») → null, jamais inventé", () => {
  assert.equal(normalizeOctotablePhone("+33", "Fixe"), null);
});

test("téléphone vide → null", () => {
  assert.equal(normalizeOctotablePhone("+33", ""), null);
});

test("sans préfixe exploitable, on retombe sur la normalisation FR", () => {
  assert.equal(normalizeOctotablePhone("", "0639000004"), "+33639000004");
});

// ————————————————————————————————————————————————————————————————
// mapOctotableRow — mapping colonne → candidat.
// ————————————————————————————————————————————————————————————————
test("mapOctotableRow lit les bonnes colonnes (tél normalisé, flags, dates)", () => {
  const cols = fixtureRow({
    prenom: "TEST_Alice",
    nom: "TEST_Martin",
    email: "TEST_alice@example.test",
    tel: "0639000010",
    prefixe: "+33",
    creation: "2025-05-14 20:31:00",
    noshow: "true",
    newsletter: "true",
    activ: "2026-02-24",
  }).split(";");
  const c = mapOctotableRow(cols);
  assert.equal(c.firstName, "TEST_Alice");
  assert.equal(c.phone, "+33639000010");
  assert.equal(c.phonePresentButInvalid, false);
  assert.equal(c.newsletter, true);
  assert.equal(c.newsletterAt, "2026-02-24");
  assert.equal(c.noShow, true);
  assert.equal(c.firstSeenAt, "2025-05-14"); // horaire tronqué, date seule
});

test("mapOctotableRow marque un téléphone présent mais invalide", () => {
  const c = mapOctotableRow(fixtureRow({ tel: "Fixe", prefixe: "+33", email: "x@example.test" }).split(";"));
  assert.equal(c.phone, null);
  assert.equal(c.phonePresentButInvalid, true);
});

// ————————————————————————————————————————————————————————————————
// dedupeCandidates — union-find téléphone PUIS email (transitif).
// ————————————————————————————————————————————————————————————————
function cand(o: Partial<OctotableCandidate>): OctotableCandidate {
  return {
    firstName: "", lastName: "", email: "", phone: null, phonePresentButInvalid: false,
    newsletter: false, newsletterAt: null, noShow: false, blocked: false, firstSeenAt: null, ...o,
  };
}

test("deux fiches même téléphone → 1 personne", () => {
  const merged = dedupeCandidates([
    cand({ firstName: "TEST_A", phone: "+33639000020", email: "a@example.test" }),
    cand({ firstName: "TEST_A2", phone: "+33639000020", email: "a2@example.test" }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].mergedCount, 2);
});

test("dédup transitive : tél partagé puis email partagé relient 3 fiches", () => {
  // f1 et f2 partagent le tél ; f2 et f3 partagent l'email → les 3 = 1 personne.
  const merged = dedupeCandidates([
    cand({ phone: "+33639000021", email: "p1@example.test" }),
    cand({ phone: "+33639000021", email: "shared@example.test" }),
    cand({ phone: "+33639000099", email: "shared@example.test" }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].mergedCount, 3);
});

test("la fusion garde la newsletter=true, la plus ancienne date d'activation et la 1ʳᵉ venue la plus ancienne", () => {
  const merged = dedupeCandidates([
    cand({ phone: "+33639000030", newsletter: false, firstSeenAt: "2025-08-01" }),
    cand({ phone: "+33639000030", newsletter: true, newsletterAt: "2026-03-01", firstSeenAt: "2025-05-01" }),
    cand({ phone: "+33639000030", newsletter: true, newsletterAt: "2026-02-01", firstSeenAt: "2026-01-01" }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].newsletter, true);
  assert.equal(merged[0].newsletterAt, "2026-02-01"); // la plus ancienne activation avérée
  assert.equal(merged[0].firstSeenAt, "2025-05-01"); // proxy 1ʳᵉ venue = la plus ancienne création
});

test("une fiche sans téléphone est dédupliquée par email seul", () => {
  const merged = dedupeCandidates([
    cand({ phone: null, email: "only@example.test" }),
    cand({ phone: null, email: "ONLY@example.test" }), // casse ignorée
  ]);
  assert.equal(merged.length, 1);
});

// ————————————————————————————————————————————————————————————————
// buildGuestUpsert — provenance + consentement.
// ————————————————————————————————————————————————————————————————
test("upsert par défaut : consent_marketing=false, source/venue/historique posés", () => {
  const row = buildGuestUpsert({
    firstName: "TEST_Bob", lastName: "TEST_D", email: "b@example.test", phone: "+33639000040",
    newsletter: false, newsletterAt: null, noShow: false, blocked: false, firstSeenAt: "2025-06-01", mergedCount: 1,
  });
  assert.ok(row);
  assert.equal(row!.consent_marketing, false);
  assert.equal(row!.consent_source, null);
  assert.equal(row!.source, OCTOTABLE_SOURCE);
  assert.equal(row!.venue, OCTOTABLE_VENUE);
  assert.equal(row!.client_historique, true);
  assert.equal(row!.majorite_verifiee, false); // non vérifiable depuis l'export — honnête
  assert.equal(row!.owner_promoter, null);
});

test("upsert opt-in newsletter : consent_marketing=true + source + horodatage = preuve", () => {
  const row = buildGuestUpsert({
    firstName: "TEST_Chloe", lastName: "", email: "c@example.test", phone: "+33639000041",
    newsletter: true, newsletterAt: "2026-02-24", noShow: false, blocked: false, firstSeenAt: "2025-07-01", mergedCount: 1,
  });
  assert.equal(row!.consent_marketing, true);
  assert.equal(row!.consent_marketing_at, "2026-02-24");
  assert.equal(row!.consent_source, OCTOTABLE_NEWSLETTER_CONSENT_SOURCE);
});

test("upsert d'une fiche sans téléphone → null (non importable, guests.phone NOT NULL)", () => {
  const row = buildGuestUpsert({
    firstName: "TEST_NoPhone", lastName: "", email: "np@example.test", phone: null,
    newsletter: false, newsletterAt: null, noShow: false, blocked: false, firstSeenAt: null, mergedCount: 1,
  });
  assert.equal(row, null);
});

test("prénom absent → « — » (colonne NOT NULL), jamais un nom inventé", () => {
  const row = buildGuestUpsert({
    firstName: "", lastName: "", email: "e@example.test", phone: "+33639000042",
    newsletter: false, newsletterAt: null, noShow: false, blocked: false, firstSeenAt: null, mergedCount: 1,
  });
  assert.equal(row!.first_name, "—");
});

// ————————————————————————————————————————————————————————————————
// Pipeline complet + rapport de dry-run (chiffres agrégés, zéro PII).
// ————————————————————————————————————————————————————————————————
test("runOctotableDryRun : bout en bout sur un mini-export TEST", () => {
  const csv = [
    HEADER,
    fixtureRow({ prenom: "TEST_A", tel: "0639000050", prefixe: "+33", email: "a@example.test", creation: "2025-05-01", newsletter: "true", activ: "2026-02-24" }),
    fixtureRow({ prenom: "TEST_A", tel: "0639000050", prefixe: "+33", email: "a2@example.test", creation: "2025-06-01" }), // doublon (même tél)
    fixtureRow({ prenom: "TEST_B", tel: "0639000051", prefixe: "+33", email: "b@example.test", creation: "2026-01-10", noshow: "true" }),
    fixtureRow({ prenom: "TEST_C", tel: "Fixe", prefixe: "+33", email: "c@example.test", creation: "2025-09-01" }), // tél invalide → email seul
    fixtureRow({ prenom: "TEST_D", tel: "", prefixe: "", email: "d@example.test", creation: "2025-10-01" }), // sans tél → email seul
    fixtureRow({ prenom: "TEST_X", tel: "0639000052", prefixe: "+33", email: "x@example.test", creation: "2025-03-01", bloque: "true" }), // bloqué → exclu
  ].join("\n");

  const { report, upserts } = runOctotableDryRun(csv);
  assert.equal(report.headerOk, true);
  assert.equal(report.rowsRead, 6);
  assert.equal(report.uniquePeople, 5); // A+A fusionnés
  assert.equal(report.duplicatesMerged, 1);
  assert.equal(report.importable, 2); // A et B (C/D sans tél, X bloqué)
  assert.equal(report.notImportableEmailOnly, 2); // C (tél invalide) + D (sans tél)
  assert.equal(report.blockedExcluded, 1); // X
  assert.equal(report.marketingOptIn, 1); // A
  assert.equal(report.noShowFlagged, 1); // B
  assert.equal(report.phonePresentButInvalid, 1); // C « Fixe »
  assert.equal(upserts.length, 2); // seuls les importables produisent une ligne guests
  // Le bloqué ne doit JAMAIS se retrouver dans les upserts.
  assert.ok(upserts.every((u) => u.phone !== "+33639000052"));
});

test("buildDryRunReport ventile la 1ʳᵉ venue (proxy) par année", () => {
  const candidates = [
    cand({ phone: "+33639000060", firstSeenAt: "2025-05-01" }),
    cand({ phone: "+33639000061", firstSeenAt: "2025-08-01" }),
    cand({ phone: "+33639000062", firstSeenAt: "2026-01-01" }),
  ];
  const merged = dedupeCandidates(candidates);
  const report = buildDryRunReport(candidates, merged, { ok: true });
  assert.equal(report.firstSeenByYear["2025"], 2);
  assert.equal(report.firstSeenByYear["2026"], 1);
});

test("parseOctotableCustomers ignore les lignes entièrement vides", () => {
  const csv = [HEADER, "", fixtureRow({ prenom: "TEST_Z", tel: "0639000070", prefixe: "+33" }), ""].join("\n");
  const { candidates } = parseOctotableCustomers(csv);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].firstName, "TEST_Z");
});
