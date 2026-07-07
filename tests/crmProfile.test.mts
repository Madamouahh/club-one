import assert from "node:assert/strict";
import test from "node:test";

import {
  GUEST_CSV_COLUMNS,
  NOTE_MAX_LENGTH,
  TAG_MAX_LENGTH,
  addTag,
  csvCellsToGuest,
  detectDuplicates,
  guestActionability,
  guestToCsvCells,
  isEmail,
  normalizeEmail,
  normalizeTag,
  spendSummary,
  validateNote,
  validateTag,
  type DedupCandidate,
  type Guest360,
  type GuestImportFields,
} from "../lib/crmProfile.ts";
import type { GuestScoreRow } from "../lib/crmClients.ts";

const TODAY = new Date("2026-07-02T12:00:00Z");

function scoreRow(over: Partial<GuestScoreRow> = {}): GuestScoreRow {
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

function g360(over: Partial<Guest360> = {}): Guest360 {
  return {
    guest_id: over.guest_id ?? "g1",
    first_name: over.first_name ?? "Alex",
    last_name: over.last_name ?? null,
    email: over.email ?? null,
    phone: over.phone ?? "+33612345678",
    birthday: over.birthday ?? null,
    owner_promoter: over.owner_promoter ?? null,
    consent_marketing: over.consent_marketing ?? false,
    opt_out: over.opt_out ?? false,
    visits_seated_total: over.visits_seated_total ?? 0,
    visits_booked_active: over.visits_booked_active ?? 0,
    no_shows_total: over.no_shows_total ?? 0,
    last_seated_date: over.last_seated_date ?? null,
    first_seen_date: over.first_seen_date ?? null,
    visits_with_spend: over.visits_with_spend ?? 0,
    spend_attributed_total: over.spend_attributed_total ?? null,
    spend_attributed_12m: over.spend_attributed_12m ?? null,
    spend_is_known: over.spend_is_known ?? false,
    reservation_requests_total: over.reservation_requests_total ?? 0,
    reservation_pending: over.reservation_pending ?? 0,
    reservation_approved: over.reservation_approved ?? 0,
    reservation_declined: over.reservation_declined ?? 0,
    reservation_cancelled: over.reservation_cancelled ?? 0,
    distinct_tables_requested: over.distinct_tables_requested ?? 0,
    last_request_at: over.last_request_at ?? null,
    tags: over.tags ?? [],
    notes_count: over.notes_count ?? 0,
  };
}

// ————— Email —————

test("normalizeEmail : trim + minuscule, rejette le format invalide (aucun email inventé)", () => {
  assert.equal(normalizeEmail("  Alex@Club.FR "), "alex@club.fr");
  assert.equal(normalizeEmail("plain"), null);
  assert.equal(normalizeEmail("a@b"), null); // pas de TLD
  assert.equal(normalizeEmail("a b@c.fr"), null); // espace
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(undefined), null);
});

test("isEmail valide un format simple", () => {
  assert.equal(isEmail("alex@club.fr"), true);
  assert.equal(isEmail("a@@b.fr"), false);
  assert.equal(isEmail("a@b.fr "), false);
});

// ————— Tags —————

test("normalizeTag : compacte, minuscule, borne la longueur", () => {
  assert.equal(normalizeTag("  Grand   Compte  "), "grand compte");
  assert.equal(normalizeTag("   "), null);
  assert.equal(normalizeTag("x".repeat(TAG_MAX_LENGTH + 1)), null);
});

test("validateTag : erreurs explicites (empty / too_long) + valeur normalisée", () => {
  assert.deepEqual(validateTag("  "), { ok: false, error: "empty" });
  assert.deepEqual(validateTag("x".repeat(TAG_MAX_LENGTH + 1)), { ok: false, error: "too_long" });
  assert.deepEqual(validateTag("  VIP Maison "), { ok: true, value: "vip maison" });
});

test("addTag : dédup (unique guest_id,tag) + tri déterministe", () => {
  const base = ["vip maison"];
  assert.deepEqual(addTag(base, "Allergie"), ["allergie", "vip maison"]);
  assert.deepEqual(addTag(base, "VIP Maison"), ["vip maison"]); // doublon normalisé ignoré
  assert.deepEqual(addTag(base, "   "), ["vip maison"]); // tag vide ignoré
});

// ————— Notes —————

test("validateNote : non vide et borné", () => {
  assert.deepEqual(validateNote("  "), { ok: false, error: "empty" });
  assert.deepEqual(validateNote("x".repeat(NOTE_MAX_LENGTH + 1)), { ok: false, error: "too_long" });
  assert.deepEqual(validateNote("A prévenu qu'il arrive à 23h."), { ok: true });
});

// ————— Dépense honnête —————

test("spendSummary : dépense NULL surfacée honnêtement (jamais un 0 fabriqué)", () => {
  const unknown = spendSummary(g360({ spend_is_known: false, spend_attributed_total: null }));
  assert.deepEqual(unknown, { known: false, total: null, last12m: null, visitsWithSpend: 0 });

  const known = spendSummary(
    g360({
      spend_is_known: true,
      spend_attributed_total: 1500,
      spend_attributed_12m: 900,
      visits_with_spend: 3,
    }),
  );
  assert.deepEqual(known, { known: true, total: 1500, last12m: 900, visitsWithSpend: 3 });
});

// ————— Déduplication —————

test("detectDuplicates : regroupe par téléphone normalisé (formats FR équivalents)", () => {
  const candidates: DedupCandidate[] = [
    { guest_id: "a", phone: "06 12 34 56 78" },
    { guest_id: "b", phone: "+33612345678" },
    { guest_id: "c", phone: "0700000000" },
  ];
  const groups = detectDuplicates(candidates);
  const phoneGroups = groups.filter((gr) => gr.key === "phone");
  assert.equal(phoneGroups.length, 1);
  assert.equal(phoneGroups[0].value, "+33612345678");
  assert.deepEqual(phoneGroups[0].guestIds, ["a", "b"]);
});

test("detectDuplicates : regroupe par email et par nom (accents/casse ignorés)", () => {
  const candidates: DedupCandidate[] = [
    { guest_id: "a", email: "Alex@Club.FR", first_name: "Alex", last_name: "Dupré" },
    { guest_id: "b", email: "alex@club.fr", first_name: "ALEX", last_name: "dupre" },
    { guest_id: "c", first_name: "Sam", last_name: "Nom" },
  ];
  const groups = detectDuplicates(candidates);

  const emailGroup = groups.find((gr) => gr.key === "email");
  assert.ok(emailGroup);
  assert.equal(emailGroup?.value, "alex@club.fr");
  assert.deepEqual(emailGroup?.guestIds, ["a", "b"]);

  const nameGroup = groups.find((gr) => gr.key === "name");
  assert.ok(nameGroup);
  assert.equal(nameGroup?.value, "alex dupre");
  assert.deepEqual(nameGroup?.guestIds, ["a", "b"]);
});

test("detectDuplicates : aucun groupe quand tout est distinct (aucune fusion à l'aveugle)", () => {
  const candidates: DedupCandidate[] = [
    { guest_id: "a", phone: "0612345678", email: "a@x.fr", first_name: "A" },
    { guest_id: "b", phone: "0700000000", email: "b@x.fr", first_name: "B" },
  ];
  assert.deepEqual(detectDuplicates(candidates), []);
});

test("detectDuplicates : ordre déterministe (phone puis email puis name) et ids triés", () => {
  const candidates: DedupCandidate[] = [
    { guest_id: "z", phone: "0612345678", email: "dup@x.fr" },
    { guest_id: "a", phone: "0612345678", email: "dup@x.fr" },
  ];
  const groups = detectDuplicates(candidates);
  assert.deepEqual(
    groups.map((gr) => gr.key),
    ["phone", "email"],
  );
  assert.deepEqual(groups[0].guestIds, ["a", "z"]);
});

// ————— Import / Export CSV —————

test("GUEST_CSV_COLUMNS est l'ordre figé du contrat round-trip", () => {
  assert.deepEqual([...GUEST_CSV_COLUMNS], ["phone", "first_name", "last_name", "email", "birthday"]);
});

test("csvCellsToGuest : parse + normalise (téléphone FR → E.164, email minuscule)", () => {
  const r = csvCellsToGuest(["06 12 34 56 78", "Alex", "Dupont", "Alex@Club.FR", "1998-05-04"]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value, {
      phone: "+33612345678",
      first_name: "Alex",
      last_name: "Dupont",
      email: "alex@club.fr",
      birthday: "1998-05-04",
    });
  }
});

test("csvCellsToGuest : refuse téléphone invalide, prénom manquant, email/date incohérents", () => {
  assert.deepEqual(csvCellsToGuest(["", "Alex", "", "", ""]), {
    ok: false,
    errors: ["phone_required"],
  });
  assert.deepEqual(csvCellsToGuest(["abc", "Alex", "", "", ""]), {
    ok: false,
    errors: ["phone_invalid"],
  });
  assert.deepEqual(csvCellsToGuest(["0612345678", "  ", "", "", ""]), {
    ok: false,
    errors: ["first_name_required"],
  });
  assert.deepEqual(csvCellsToGuest(["0612345678", "Alex", "", "not-an-email", ""]), {
    ok: false,
    errors: ["email_invalid"],
  });
  assert.deepEqual(csvCellsToGuest(["0612345678", "Alex", "", "", "2020-02-31"]), {
    ok: false,
    errors: ["birthday_invalid"],
  });
  assert.deepEqual(csvCellsToGuest(["0612345678", "Alex", ""]), {
    ok: false,
    errors: ["wrong_column_count"],
  });
});

test("import/export CSV : round-trip déterministe (cells → guest → cells identiques)", () => {
  const fields: GuestImportFields = {
    phone: "+33612345678",
    first_name: "Alex",
    last_name: "Dupont",
    email: "alex@club.fr",
    birthday: "1998-05-04",
  };
  const cells = guestToCsvCells(fields);
  const back = csvCellsToGuest(cells);
  assert.equal(back.ok, true);
  if (back.ok) {
    assert.deepEqual(back.value, fields);
    assert.deepEqual(guestToCsvCells(back.value), cells);
  }
});

test("guestToCsvCells : null → chaîne vide, dans l'ordre des colonnes", () => {
  assert.deepEqual(
    guestToCsvCells({
      phone: "+33612345678",
      first_name: "Alex",
      last_name: null,
      email: null,
      birthday: null,
    }),
    ["+33612345678", "Alex", "", "", ""],
  );
});

// ————— Usabilité d'un segment —————

test("guestActionability : contactable + service, mais pas de marketing sans consentement", () => {
  const a = guestActionability(
    scoreRow({ visits_seated_total: 3, visits_seated_180d: 3, last_seated_date: "2026-06-25" }),
    { today: TODAY, spendThreshold: 1000 },
    { phoneE164: "+33612345678", optOut: false, consentMarketing: false },
  );
  assert.equal(a.segment, "regular");
  assert.equal(a.contactable, true);
  assert.equal(a.canService, true);
  assert.equal(a.canMarket, false);
  assert.deepEqual(a.missingForMarketing, ["no_consent"]);
});

test("guestActionability : opt-out et absence de numéro bloquent tout contact", () => {
  const optOut = guestActionability(
    scoreRow({ visits_seated_total: 1 }),
    { today: TODAY, spendThreshold: 1000 },
    { phoneE164: "+33612345678", optOut: true, consentMarketing: true },
  );
  assert.equal(optOut.contactable, false);
  assert.equal(optOut.canService, false);
  assert.equal(optOut.canMarket, false);
  assert.ok(optOut.missingForMarketing.includes("opt_out"));

  const noPhone = guestActionability(
    scoreRow({ visits_seated_total: 1 }),
    { today: TODAY, spendThreshold: 1000 },
    { phoneE164: null, optOut: false, consentMarketing: true },
  );
  assert.equal(noPhone.contactable, false);
  assert.deepEqual(noPhone.missingForMarketing, ["no_phone"]);
});

test("guestActionability : consentement + numéro + pas d'opt-out → marketing OK, flag anniversaire remonté", () => {
  const a = guestActionability(
    scoreRow({ visits_seated_total: 3, visits_seated_180d: 3, last_seated_date: "2026-06-25" }),
    { today: TODAY, spendThreshold: 1000, birthdayMonth: 7 },
    { phoneE164: "+33612345678", optOut: false, consentMarketing: true },
  );
  assert.equal(a.canMarket, true);
  assert.deepEqual(a.missingForMarketing, []);
  assert.equal(a.birthdayThisMonth, true);
});
