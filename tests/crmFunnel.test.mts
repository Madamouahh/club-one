import assert from "node:assert/strict";
import test from "node:test";

import {
  FUNNEL_UNIVERS,
  INVITE_KINDS,
  MIN_AGE_YEARS,
  PASS_STATUSES,
  ageOn,
  inviteAvailability,
  isAdult,
  registrationRefDate,
  validateInviteDraft,
  validateRegistration,
  type InviteLinkDraft,
  type PublicInviteLink,
  type RegistrationInput,
} from "../lib/crmFunnel.ts";

const REF = new Date(Date.UTC(2026, 6, 2)); // 2026-07-02 (date de référence de la soirée)

function reg(over: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    firstName: over.firstName ?? "Alex",
    lastName: over.lastName ?? null,
    phoneE164: "phoneE164" in over ? (over.phoneE164 ?? null) : "+33612345678",
    birthday: over.birthday ?? "1990-01-01",
    consentService: over.consentService ?? false,
    consentServiceText: over.consentServiceText ?? null,
    consentMarketing: over.consentMarketing ?? false,
    consentMarketingText: over.consentMarketingText ?? null,
  };
}

function link(over: Partial<PublicInviteLink> = {}): PublicInviteLink {
  return {
    valid: over.valid ?? true,
    kind: over.kind ?? "guest_list",
    univers: over.univers ?? "eden",
    eventTitle: over.eventTitle ?? "Soirée test",
    exploitationDate: over.exploitationDate ?? "2026-07-02",
    expiresAt: over.expiresAt ?? null,
    usesCount: over.usesCount ?? 0,
    maxUses: over.maxUses ?? 1,
  };
}

// ————————————————————————————————————————————————————————————————
// Contrôle d'âge (18+)
// ————————————————————————————————————————————————————————————————

test("ageOn : âge révolu, anniversaire pas encore passé retire une année", () => {
  // Né le 2008-07-03, référence 2026-07-02 → la veille du 18e anniversaire → 17 ans.
  assert.equal(ageOn("2008-07-03", REF), 17);
  // Né le 2008-07-02 → 18e anniversaire pile le jour de référence → 18 ans.
  assert.equal(ageOn("2008-07-02", REF), 18);
  // Né le 2008-07-01 → anniversaire passé → 18 ans.
  assert.equal(ageOn("2008-07-01", REF), 18);
});

test("ageOn : date illisible ou future → null (aucun âge inventé)", () => {
  assert.equal(ageOn("2020-02-31", REF), null); // 31 février n'existe pas
  assert.equal(ageOn("pas-une-date", REF), null);
  assert.equal(ageOn("2030-01-01", REF), null); // naissance après la référence
});

test("isAdult : frontière exacte des 18 ans", () => {
  assert.equal(isAdult("2008-07-02", REF), true); // pile 18 ans
  assert.equal(isAdult("2008-07-03", REF), false); // 17 ans et 364 jours
  assert.equal(isAdult("mauvais", REF), null);
  assert.equal(MIN_AGE_YEARS, 18);
});

// ————————————————————————————————————————————————————————————————
// Date de référence 18+ = la DATE DE LA SOIRÉE (miroir exact de la garde SQL de la RPC)
// ————————————————————————————————————————————————————————————————

test("registrationRefDate : utilise la date de soirée (pas aujourd'hui) ancrée à minuit UTC", () => {
  const fallback = new Date(Date.UTC(2030, 0, 1));
  const ref = registrationRefDate("2026-07-02", fallback);
  assert.equal(ref.getTime(), Date.UTC(2026, 6, 2));
  // Un mineur la veille de ses 18 ans à la date de soirée est bien refusé sur CETTE date de référence.
  assert.equal(isAdult("2008-07-03", ref), false);
  assert.equal(isAdult("2008-07-02", ref), true);
});

test("registrationRefDate : date absente ou illisible → fallback (jamais de date fabriquée)", () => {
  const fallback = new Date(Date.UTC(2026, 6, 2));
  assert.equal(registrationRefDate(null, fallback).getTime(), fallback.getTime());
  assert.equal(registrationRefDate("pas-une-date", fallback).getTime(), fallback.getTime());
  assert.equal(registrationRefDate("2026-02-31", fallback).getTime(), fallback.getTime()); // 31 fév inexistant
});

// ————————————————————————————————————————————————————————————————
// Validation d'inscription
// ————————————————————————————————————————————————————————————————

test("validateRegistration : formulaire complet et majeur → ok", () => {
  const r = validateRegistration(reg(), REF);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("validateRegistration : mineur bloqué (underage), aucune inscription", () => {
  const r = validateRegistration(reg({ birthday: "2010-01-01" }), REF);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("underage"));
});

test("validateRegistration : prénom vide, tél non normalisable, DDN manquante", () => {
  const r = validateRegistration(
    reg({ firstName: "  ", phoneE164: null, birthday: "" }),
    REF,
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("first_name_required"));
  assert.ok(r.errors.includes("phone_invalid"));
  assert.ok(r.errors.includes("birthday_required"));
});

test("validateRegistration : la case marketing N'EST JAMAIS requise (entrée non conditionnée)", () => {
  // Marketing non coché : aucune erreur liée au marketing → le QR d'entrée sera bien délivré.
  const r = validateRegistration(reg({ consentMarketing: false }), REF);
  assert.equal(r.ok, true);
  assert.equal(
    r.errors.some((e) => e.startsWith("consent_marketing")),
    false,
  );
});

test("validateRegistration : case cochée sans texte exact → refus (consentement non journalisé)", () => {
  const rService = validateRegistration(
    reg({ consentService: true, consentServiceText: "  " }),
    REF,
  );
  assert.ok(rService.errors.includes("consent_service_text_missing"));

  const rMkt = validateRegistration(
    reg({ consentMarketing: true, consentMarketingText: null }),
    REF,
  );
  assert.ok(rMkt.errors.includes("consent_marketing_text_missing"));

  // Cases cochées AVEC leur texte exact → ok.
  const rOk = validateRegistration(
    reg({
      consentService: true,
      consentServiceText: "texte service exact",
      consentMarketing: true,
      consentMarketingText: "texte marketing exact",
    }),
    REF,
  );
  assert.equal(rOk.ok, true);
});

// ————————————————————————————————————————————————————————————————
// Disponibilité d'un lien d'invitation
// ————————————————————————————————————————————————————————————————

test("inviteAvailability : lien valide et libre → ouvert", () => {
  assert.deepEqual(inviteAvailability(link(), REF), { open: true });
});

test("inviteAvailability : lien inconnu → fermé (unknown)", () => {
  assert.deepEqual(inviteAvailability(null, REF), { open: false, reason: "unknown" });
  assert.deepEqual(inviteAvailability(link({ valid: false }), REF), {
    open: false,
    reason: "unknown",
  });
});

test("inviteAvailability : lien expiré → fermé (expired)", () => {
  const past = new Date(Date.UTC(2026, 6, 1)).toISOString();
  assert.deepEqual(inviteAvailability(link({ expiresAt: past }), REF), {
    open: false,
    reason: "expired",
  });
});

test("inviteAvailability : quota épuisé → fermé (exhausted)", () => {
  assert.deepEqual(inviteAvailability(link({ usesCount: 1, maxUses: 1 }), REF), {
    open: false,
    reason: "exhausted",
  });
  // Non épuisé quand il reste des usages.
  assert.deepEqual(inviteAvailability(link({ usesCount: 1, maxUses: 5 }), REF), { open: true });
});

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon de lien côté staff
// ————————————————————————————————————————————————————————————————

function draft(over: Partial<InviteLinkDraft> = {}): InviteLinkDraft {
  return {
    kind: over.kind ?? "guest_list",
    univers: over.univers ?? "eden",
    tableRef: over.tableRef ?? null,
    maxUses: over.maxUses ?? 1,
    expiresAt: over.expiresAt ?? null,
  };
}

test("validateInviteDraft : guest_list simple → ok", () => {
  assert.deepEqual(validateInviteDraft(draft()), { ok: true, errors: [] });
});

test("validateInviteDraft : team_vip exige une table", () => {
  const r = validateInviteDraft(draft({ kind: "team_vip", tableRef: null }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("table_required_for_team_vip"));

  const rOk = validateInviteDraft(draft({ kind: "team_vip", tableRef: "T12" }));
  assert.equal(rOk.ok, true);
});

test("validateInviteDraft : max_uses doit être un entier positif", () => {
  assert.ok(validateInviteDraft(draft({ maxUses: 0 })).errors.includes("max_uses_invalid"));
  assert.ok(validateInviteDraft(draft({ maxUses: -3 })).errors.includes("max_uses_invalid"));
  assert.ok(validateInviteDraft(draft({ maxUses: 2.5 })).errors.includes("max_uses_invalid"));
});

test("constantes miroir des CHECK 0014", () => {
  assert.deepEqual([...INVITE_KINDS], ["guest_list", "team_vip"]);
  assert.deepEqual([...FUNNEL_UNIVERS], ["eden", "cercle", "terminus"]);
  assert.deepEqual([...PASS_STATUSES], ["issued", "scanned", "expired", "cancelled"]);
});
