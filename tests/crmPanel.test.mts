import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCsvImportReport,
  buildGuestCsv,
  buildMergePreview,
  filterGuests,
  guestMatchesQuery,
  isHeaderRow,
  isIsoDateString,
  parseCsv,
  phoneWouldChange,
  toCsvField,
  type MergePreviewGuest,
  type SearchableGuest,
} from "../app/_modules/crm/crmPanelHelpers.ts";
import { detectDuplicates, type DedupCandidate } from "../lib/crmProfile.ts";

// ————— parseCsv —————

test("parseCsv : lignes simples séparées par virgule + saut de ligne", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("parseCsv : gère \\r\\n, BOM et ligne finale sans saut", () => {
  assert.deepEqual(parseCsv("﻿x,y\r\n1,2\r\n3,4"), [
    ["x", "y"],
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("parseCsv : champs entre guillemets avec virgule, saut et guillemet échappé", () => {
  assert.deepEqual(parseCsv('"a,b","c\nd","e""f"'), [["a,b", "c\nd", 'e"f']]);
});

test("parseCsv : cellules vides préservées + pas de ligne fantôme en fin", () => {
  assert.deepEqual(parseCsv("a,,c\n"), [["a", "", "c"]]);
});

// ————— isHeaderRow —————

test("isHeaderRow : reconnaît l'en-tête du contrat (insensible casse), rejette le reste", () => {
  assert.equal(isHeaderRow(["phone", "first_name", "last_name", "email", "birthday"]), true);
  assert.equal(isHeaderRow(["Phone", "First_Name", "Last_Name", "Email", "Birthday"]), true);
  assert.equal(isHeaderRow(["+33612345678", "Alex", "", "", ""]), false);
  assert.equal(isHeaderRow(["phone", "first_name"]), false);
});

// ————— buildCsvImportReport —————

test("buildCsvImportReport : saute l'en-tête, valide/rejette par ligne, saute les lignes vides", () => {
  const parsed = parseCsv(
    [
      "phone,first_name,last_name,email,birthday",
      "06 12 34 56 78,Alex,Dupont,Alex@Club.FR,1998-05-04",
      "abc,Bob,,,", // téléphone invalide
      ",,,,", // ligne vide → ignorée
      "0700000000,,,,", // prénom manquant
    ].join("\n"),
  );
  const report = buildCsvImportReport(parsed);
  assert.equal(report.headerSkipped, true);
  assert.equal(report.validCount, 1);
  assert.equal(report.errorCount, 2);
  assert.equal(report.rows.length, 3);

  const ok = report.rows.find((r) => r.ok);
  assert.ok(ok && ok.ok);
  if (ok && ok.ok) {
    assert.deepEqual(ok.value, {
      phone: "+33612345678",
      first_name: "Alex",
      last_name: "Dupont",
      email: "alex@club.fr",
      birthday: "1998-05-04",
    });
  }

  const badPhone = report.rows.find((r) => !r.ok && r.errors.includes("phone_invalid"));
  assert.ok(badPhone);
  const noName = report.rows.find((r) => !r.ok && r.errors.includes("first_name_required"));
  assert.ok(noName);
});

test("buildCsvImportReport : sans en-tête, la 1re ligne de données est traitée (pas sautée)", () => {
  const parsed = parseCsv("06 12 34 56 78,Alex,,,");
  const report = buildCsvImportReport(parsed);
  assert.equal(report.headerSkipped, false);
  assert.equal(report.validCount, 1);
});

// ————— Export CSV —————

test("toCsvField : n'échappe que si nécessaire (virgule / guillemet / saut)", () => {
  assert.equal(toCsvField("Alex"), "Alex");
  assert.equal(toCsvField("Nom, Prénom"), '"Nom, Prénom"');
  assert.equal(toCsvField('a"b'), '"a""b"');
});

test("buildGuestCsv : en-tête figé + round-trip (export → parse → import identique)", () => {
  const csv = buildGuestCsv([
    { phone: "+33612345678", first_name: "Alex", last_name: "Dupont", email: "alex@club.fr", birthday: "1998-05-04" },
    { phone: "+33700000000", first_name: "Bob", last_name: null, email: null, birthday: null },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "phone,first_name,last_name,email,birthday");
  assert.equal(lines.length, 3);

  const report = buildCsvImportReport(parseCsv(csv));
  assert.equal(report.headerSkipped, true);
  assert.equal(report.validCount, 2);
  assert.equal(report.errorCount, 0);
});

// ————— Filtre de recherche —————

const GUESTS: SearchableGuest[] = [
  { first_name: "Aléxandre", last_name: "Dupré", email: "alex@club.fr", phone: "+33612345678" },
  { first_name: "Bob", last_name: "Martin", email: null, phone: "+33700000000" },
];

test("guestMatchesQuery : prénom insensible aux accents/casse", () => {
  assert.equal(guestMatchesQuery(GUESTS[0], "alexandre"), true);
  assert.equal(guestMatchesQuery(GUESTS[0], "DUPRE"), true);
  assert.equal(guestMatchesQuery(GUESTS[0], "martin"), false);
});

test("guestMatchesQuery : email et téléphone (par chiffres, formats équivalents)", () => {
  assert.equal(guestMatchesQuery(GUESTS[0], "alex@club"), true);
  assert.equal(guestMatchesQuery(GUESTS[0], "06 12 34"), true);
  assert.equal(guestMatchesQuery(GUESTS[0], "0612345678"), true);
  assert.equal(guestMatchesQuery(GUESTS[1], "612345678"), false);
});

test("filterGuests : requête vide → liste complète ; sinon sous-ensemble", () => {
  assert.equal(filterGuests(GUESTS, "  ").length, 2);
  assert.deepEqual(
    filterGuests(GUESTS, "bob").map((g) => g.first_name),
    ["Bob"],
  );
});

// ————— Date & téléphone —————

test("isIsoDateString : accepte une date canonique, rejette l'incohérente", () => {
  assert.equal(isIsoDateString("1998-05-04"), true);
  assert.equal(isIsoDateString("2020-02-31"), false);
  assert.equal(isIsoDateString("04/05/1998"), false);
});

test("phoneWouldChange : détecte un vrai changement de clé de dédup (formats FR équivalents = pas de changement)", () => {
  assert.equal(phoneWouldChange("+33612345678", "06 12 34 56 78"), false);
  assert.equal(phoneWouldChange("+33612345678", "0700000000"), true);
  assert.equal(phoneWouldChange("+33612345678", "pas un numéro"), false); // invalide → non traité comme changement
});

// ————— Aperçu de fusion —————

function pg(over: Partial<MergePreviewGuest> = {}): MergePreviewGuest {
  return {
    id: over.id ?? "a",
    first_name: over.first_name ?? "Alex",
    last_name: over.last_name ?? null,
    email: over.email ?? null,
    phone: over.phone ?? "+33612345678",
    birthday: over.birthday ?? null,
    created_at: over.created_at ?? null,
  };
}

test("buildMergePreview : garde la fiche la plus ancienne et remplit les cases vides (non destructif)", () => {
  const older = pg({ id: "b", created_at: "2025-01-01T00:00:00Z", last_name: "Dupont", email: null });
  const newer = pg({ id: "a", created_at: "2026-01-01T00:00:00Z", last_name: null, email: "alex@club.fr" });
  const map = new Map([
    [older.id, older],
    [newer.id, newer],
  ]);
  const candidates: DedupCandidate[] = [
    { guest_id: "a", phone: "+33612345678" },
    { guest_id: "b", phone: "+33612345678" },
  ];
  const group = detectDuplicates(candidates).find((g) => g.key === "phone");
  assert.ok(group);
  const preview = buildMergePreview(group!, map);
  assert.ok(preview);
  assert.equal(preview!.primaryId, "b"); // la plus ancienne
  assert.deepEqual(preview!.mergedIds, ["a"]);
  assert.equal(preview!.resulting.last_name, "Dupont"); // du primaire
  assert.equal(preview!.resulting.email, "alex@club.fr"); // case vide remplie par l'autre fiche
  assert.deepEqual(preview!.conflicts, []);
});

test("buildMergePreview : signale les conflits (valeurs non vides divergentes), sans rien écrire", () => {
  const g1 = pg({ id: "a", created_at: "2025-01-01T00:00:00Z", first_name: "Alex" });
  const g2 = pg({ id: "b", created_at: "2026-01-01T00:00:00Z", first_name: "Alexandre" });
  const map = new Map([
    [g1.id, g1],
    [g2.id, g2],
  ]);
  const group = detectDuplicates([
    { guest_id: "a", phone: "+33612345678" },
    { guest_id: "b", phone: "+33612345678" },
  ]).find((g) => g.key === "phone");
  const preview = buildMergePreview(group!, map);
  assert.ok(preview);
  assert.equal(preview!.primaryId, "a");
  assert.equal(preview!.resulting.first_name, "Alex");
  assert.equal(preview!.conflicts.length, 1);
  assert.deepEqual(preview!.conflicts[0], {
    field: "first_name",
    primary: "Alex",
    incoming: "Alexandre",
    incomingId: "b",
  });
});

test("buildMergePreview : retourne null si moins de deux fiches connues (rien à fusionner)", () => {
  const only = pg({ id: "a" });
  const map = new Map([[only.id, only]]);
  const group = { key: "phone" as const, value: "+33612345678", guestIds: ["a", "b"] };
  assert.equal(buildMergePreview(group, map), null);
});
