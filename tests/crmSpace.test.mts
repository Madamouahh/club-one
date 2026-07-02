import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSpaceToken,
  guestSpaceUrl,
  isPassLive,
  liveUpcomingPasses,
  normalizeSpacePayload,
  splitVisits,
  universLabel,
  visitStatusLabel,
  type SpacePass,
  type SpaceVisit,
} from "../lib/crmSpace.ts";

const UUID = "11111111-2222-3333-4444-555555555555";

function visit(over: Partial<SpaceVisit> = {}): SpaceVisit {
  return {
    exploitation_date: over.exploitation_date ?? "2026-07-04",
    univers: "univers" in over ? over.univers ?? null : "eden",
    status: over.status ?? "booked",
    is_host: over.is_host ?? false,
    event_title: "event_title" in over ? over.event_title ?? null : "Soirée test",
  };
}

function pass(over: Partial<SpacePass> = {}): SpacePass {
  return {
    qr_token: "qr_token" in over ? over.qr_token ?? null : "a".repeat(64),
    exploitation_date: over.exploitation_date ?? "2026-07-04",
    univers: "univers" in over ? over.univers ?? null : "eden",
    status: over.status ?? "issued",
    is_host: over.is_host ?? false,
    event_title: "event_title" in over ? over.event_title ?? null : "Soirée test",
  };
}

// ————————————————————————————————————————————————————————————————
// extractSpaceToken — n'accepte qu'un uuid ; tolère une URL collée ; rejette le reste.
// ————————————————————————————————————————————————————————————————

test("extractSpaceToken accepte un uuid brut", () => {
  assert.equal(extractSpaceToken(UUID), UUID);
});

test("extractSpaceToken met en minuscules et trim", () => {
  assert.equal(extractSpaceToken(`  ${UUID.toUpperCase()}  `), UUID);
});

test("extractSpaceToken extrait l'uuid d'une URL /espace/<token> avec query", () => {
  assert.equal(extractSpaceToken(`https://club.example/espace/${UUID}?x=1`), UUID);
});

test("extractSpaceToken rejette vide, null et forme non-uuid", () => {
  assert.equal(extractSpaceToken(""), null);
  assert.equal(extractSpaceToken(null), null);
  assert.equal(extractSpaceToken(undefined), null);
  assert.equal(extractSpaceToken("pas-un-uuid"), null);
  assert.equal(extractSpaceToken("a".repeat(64)), null); // un qr_token n'est PAS un space_token
});

// ————————————————————————————————————————————————————————————————
// normalizeSpacePayload — jamais d'exception ; found strict ; tableaux sûrs.
// ————————————————————————————————————————————————————————————————

test("normalizeSpacePayload gère les entrées non-objet et found absent/faux", () => {
  assert.deepEqual(normalizeSpacePayload(null), { found: false });
  assert.deepEqual(normalizeSpacePayload("x"), { found: false });
  assert.deepEqual(normalizeSpacePayload({}), { found: false });
  assert.deepEqual(normalizeSpacePayload({ found: false }), { found: false });
});

test("normalizeSpacePayload conserve prénom + tableaux quand found=true", () => {
  const out = normalizeSpacePayload({
    found: true,
    first_name: "Alex",
    visits: [visit()],
    passes: [pass()],
  });
  assert.equal(out.found, true);
  assert.equal(out.first_name, "Alex");
  assert.equal(out.visits?.length, 1);
  assert.equal(out.passes?.length, 1);
});

test("normalizeSpacePayload remplace des tableaux manquants par [] et prénom absent par null", () => {
  const out = normalizeSpacePayload({ found: true });
  assert.equal(out.first_name, null);
  assert.deepEqual(out.visits, []);
  assert.deepEqual(out.passes, []);
});

// ————————————————————————————————————————————————————————————————
// Libellés — connus traduits, inconnu → repli neutre (jamais d'affirmation fausse).
// ————————————————————————————————————————————————————————————————

test("universLabel et visitStatusLabel : connus traduits, inconnu neutre", () => {
  assert.equal(universLabel("eden"), "Eden");
  assert.equal(universLabel("cercle"), "Cercle");
  assert.equal(universLabel(null), "Soirée");
  assert.equal(universLabel("mystere"), "Soirée");
  assert.equal(visitStatusLabel("seated"), "Vous y étiez");
  assert.equal(visitStatusLabel("no_show"), "Non honoré");
  assert.equal(visitStatusLabel("inconnu"), "—");
});

test("isPassLive : seul issued est présentable comme QR utilisable", () => {
  assert.equal(isPassLive("issued"), true);
  assert.equal(isPassLive("scanned"), false);
  assert.equal(isPassLive("expired"), false);
  assert.equal(isPassLive("cancelled"), false);
  assert.equal(isPassLive(null), false);
});

// ————————————————————————————————————————————————————————————————
// splitVisits — à-venir/passé déterministe vs refDate ; visite du jour = à venir.
// ————————————————————————————————————————————————————————————————

test("splitVisits classe et trie visites autour de refDate", () => {
  const visits = [
    visit({ exploitation_date: "2026-06-01" }),
    visit({ exploitation_date: "2026-07-04" }), // = refDate → à venir
    visit({ exploitation_date: "2026-08-10" }),
    visit({ exploitation_date: "2026-05-20" }),
  ];
  const { upcoming, past } = splitVisits(visits, "2026-07-04");
  assert.deepEqual(
    upcoming.map((v) => v.exploitation_date),
    ["2026-07-04", "2026-08-10"],
  );
  assert.deepEqual(
    past.map((v) => v.exploitation_date),
    ["2026-06-01", "2026-05-20"],
  );
});

test("splitVisits : aucune visite → deux tableaux vides (état honnête)", () => {
  const { upcoming, past } = splitVisits([], "2026-07-04");
  assert.deepEqual(upcoming, []);
  assert.deepEqual(past, []);
});

// ————————————————————————————————————————————————————————————————
// liveUpcomingPasses — QR encore utilisables (issued) sur soirées non passées.
// ————————————————————————————————————————————————————————————————

test("liveUpcomingPasses ne garde que issued sur soirées >= refDate, triés proche→lointain", () => {
  const passes = [
    pass({ qr_token: "old", exploitation_date: "2026-06-01", status: "issued" }), // passé
    pass({ qr_token: "used", exploitation_date: "2026-08-01", status: "scanned" }), // déjà scanné
    pass({ qr_token: "b", exploitation_date: "2026-08-10", status: "issued" }),
    pass({ qr_token: "a", exploitation_date: "2026-07-04", status: "issued" }),
  ];
  const live = liveUpcomingPasses(passes, "2026-07-04");
  assert.deepEqual(
    live.map((p) => p.qr_token),
    ["a", "b"],
  );
});

test("liveUpcomingPasses ignore un pass présentable dont le serveur a masqué le jeton (qr_token null)", () => {
  // Mitigation amplification (0019) : le serveur ne renvoie PAS le jeton d'un pass non présentable ; on ne
  // doit jamais tenter d'afficher un QR sans jeton, même si status/date le laisseraient passer.
  const passes = [
    pass({ qr_token: null, exploitation_date: "2026-08-10", status: "issued" }),
    pass({ qr_token: "ok", exploitation_date: "2026-08-11", status: "issued" }),
  ];
  const live = liveUpcomingPasses(passes, "2026-07-04");
  assert.deepEqual(
    live.map((p) => p.qr_token),
    ["ok"],
  );
});

// ————————————————————————————————————————————————————————————————
// guestSpaceUrl — construit l'URL, normalise le slash final, encode le jeton.
// ————————————————————————————————————————————————————————————————

test("guestSpaceUrl construit /espace/<token> sans double slash", () => {
  assert.equal(guestSpaceUrl("https://club.example/", UUID), `https://club.example/espace/${UUID}`);
  assert.equal(guestSpaceUrl("https://club.example", UUID), `https://club.example/espace/${UUID}`);
});
