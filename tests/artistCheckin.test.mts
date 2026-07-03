import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_CHECKIN_ROLES,
  CHECKIN_STATUSES,
  canManageArtistCheckin,
  canViewArtistCheckin,
  checkinProgress,
  checkinStatusLabel,
  checkinSteps,
  isCheckinStatus,
  isReadyForStage,
  isTerminalStatus,
  sortForBoard,
  summarizeCheckins,
  validateCheckinDraft,
  type ArtistCheckin,
  type CheckinDraft,
} from "../lib/artistCheckin.ts";
import type { StaffRole } from "../lib/permissions.ts";

function checkin(over: Partial<ArtistCheckin> = {}): ArtistCheckin {
  return {
    id: over.id ?? "c1",
    event_id: over.event_id ?? null,
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    artist_name: over.artist_name ?? "DJ Test",
    slot_label: over.slot_label ?? null,
    status: over.status ?? "attendu",
    companions: over.companions ?? 0,
    dressing_room: over.dressing_room ?? null,
    contact: over.contact ?? null,
    rider_notes: over.rider_notes ?? null,
    material_notes: over.material_notes ?? null,
    arrived_at: over.arrived_at ?? null,
    soundcheck_at: over.soundcheck_at ?? null,
    tech_validated_at: over.tech_validated_at ?? null,
    tech_validated_by: over.tech_validated_by ?? null,
    notes: over.notes ?? null,
    auteur_username: over.auteur_username ?? "manuel",
    created_at: over.created_at ?? "2026-07-03T22:00:00Z",
    updated_at: over.updated_at ?? "2026-07-03T22:00:00Z",
  };
}

function draft(over: Partial<CheckinDraft> = {}): CheckinDraft {
  return {
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    artist_name: over.artist_name ?? "DJ Test",
    ...over,
  };
}

const ALL_ROLES: StaffRole[] = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
  "promoter",
];

// ————————————————————————————————————————————————————————————————
// Vocabulaires fermés
// ————————————————————————————————————————————————————————————————

test("CHECKIN_STATUSES : garde de type honnête", () => {
  assert.ok(isCheckinStatus("attendu"));
  assert.ok(isCheckinStatus("no_show"));
  assert.ok(!isCheckinStatus("inconnu"));
  assert.ok(!isCheckinStatus(""));
});

test("statuts terminaux : termine/no_show/annule seulement", () => {
  assert.ok(isTerminalStatus("termine"));
  assert.ok(isTerminalStatus("no_show"));
  assert.ok(isTerminalStatus("annule"));
  assert.ok(!isTerminalStatus("attendu"));
  assert.ok(!isTerminalStatus("en_scene"));
});

test("ARTIST_CHECKIN_ROLES : direction + sécurité, jamais server/compteur/promoteur", () => {
  assert.deepEqual([...ARTIST_CHECKIN_ROLES], ["admin", "manager", "security"]);
  assert.ok(!(ARTIST_CHECKIN_ROLES as readonly string[]).includes("server"));
  assert.ok(!(ARTIST_CHECKIN_ROLES as readonly string[]).includes("security_counter"));
  assert.ok(!(ARTIST_CHECKIN_ROLES as readonly string[]).includes("promoter"));
});

test("chaque statut a un libellé FR", () => {
  for (const s of CHECKIN_STATUSES) {
    assert.equal(typeof checkinStatusLabel(s), "string");
    assert.ok(checkinStatusLabel(s).length > 0);
  }
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — matrice A8
// ————————————————————————————————————————————————————————————————

test("canViewArtistCheckin : direction + sécurité seulement", () => {
  assert.ok(canViewArtistCheckin("admin"));
  assert.ok(canViewArtistCheckin("manager"));
  assert.ok(canViewArtistCheckin("security"));
  assert.ok(!canViewArtistCheckin("server"));
  assert.ok(!canViewArtistCheckin("security_counter"));
  assert.ok(!canViewArtistCheckin("promoter"));
});

test("canManageArtistCheckin : direction seule (sécurité = lecture seule)", () => {
  assert.ok(canManageArtistCheckin("admin"));
  assert.ok(canManageArtistCheckin("manager"));
  assert.ok(!canManageArtistCheckin("security"));
  for (const r of ["server", "security_counter", "promoter"] as StaffRole[]) {
    assert.ok(!canManageArtistCheckin(r));
  }
});

test("aucun rôle gérant hors périmètre lecture", () => {
  for (const r of ALL_ROLES) {
    if (canManageArtistCheckin(r)) assert.ok(canViewArtistCheckin(r));
  }
});

// ————————————————————————————————————————————————————————————————
// Validation du brouillon
// ————————————————————————————————————————————————————————————————

test("validateCheckinDraft : brouillon minimal valide (direction)", () => {
  assert.deepEqual(validateCheckinDraft(draft(), "manager"), { ok: true, errors: [] });
});

test("validateCheckinDraft : nom vide refusé", () => {
  const r = validateCheckinDraft(draft({ artist_name: "   " }), "manager");
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes("nom")));
});

test("validateCheckinDraft : date non ISO refusée", () => {
  const r = validateCheckinDraft(draft({ exploitation_date: "03/07/2026" }), "admin");
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes("date")));
});

test("validateCheckinDraft : statut inconnu refusé", () => {
  const r = validateCheckinDraft(draft({ status: "en_orbite" }), "admin");
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes("statut")));
});

test("validateCheckinDraft : accompagnants négatif/décimal/NaN refusés, 0 accepté", () => {
  assert.ok(!validateCheckinDraft(draft({ companions: -1 }), "admin").ok);
  assert.ok(!validateCheckinDraft(draft({ companions: 2.5 }), "admin").ok);
  assert.ok(!validateCheckinDraft(draft({ companions: NaN }), "admin").ok);
  assert.ok(validateCheckinDraft(draft({ companions: 0 }), "admin").ok);
  assert.ok(validateCheckinDraft(draft({ companions: 3 }), "admin").ok);
});

test("validateCheckinDraft : sécurité ne peut pas créer (lecture seule)", () => {
  const r = validateCheckinDraft(draft(), "security");
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes("ne peut pas")));
});

test("validateCheckinDraft : server/promoteur refusés", () => {
  for (const r of ["server", "security_counter", "promoter"] as StaffRole[]) {
    assert.ok(!validateCheckinDraft(draft(), r).ok);
  }
});

// ————————————————————————————————————————————————————————————————
// Jalons / avancement
// ————————————————————————————————————————————————————————————————

test("checkinSteps : dérivés des timestamps, jamais inventés", () => {
  assert.deepEqual(checkinSteps(checkin()), {
    arrived: false,
    soundcheck: false,
    techValidated: false,
  });
  assert.deepEqual(
    checkinSteps(checkin({ arrived_at: "2026-07-03T23:00:00Z", soundcheck_at: "2026-07-03T23:30:00Z" })),
    { arrived: true, soundcheck: true, techValidated: false },
  );
});

test("checkinProgress : 0..3 selon les jalons", () => {
  assert.equal(checkinProgress(checkin()), 0);
  assert.equal(checkinProgress(checkin({ arrived_at: "x" })), 1);
  assert.equal(
    checkinProgress(checkin({ arrived_at: "x", soundcheck_at: "y", tech_validated_at: "z" })),
    3,
  );
});

test("isReadyForStage : 3 jalons ET pas annulé/no-show", () => {
  const full = { arrived_at: "x", soundcheck_at: "y", tech_validated_at: "z" };
  assert.ok(isReadyForStage(checkin({ ...full, status: "pret" })));
  assert.ok(!isReadyForStage(checkin({ ...full, status: "no_show" })));
  assert.ok(!isReadyForStage(checkin({ ...full, status: "annule" })));
  assert.ok(!isReadyForStage(checkin({ arrived_at: "x", status: "arrive" })));
});

// ————————————————————————————————————————————————————————————————
// Tri du tableau
// ————————————————————————————————————————————————————————————————

test("sortForBoard : actifs avant terminaux, non mutant", () => {
  const done = checkin({ id: "done", status: "termine", slot_label: "00h" });
  const active = checkin({ id: "active", status: "attendu", slot_label: "02h" });
  const input = [done, active];
  const out = sortForBoard(input);
  assert.equal(out[0].id, "active");
  assert.equal(out[1].id, "done");
  assert.deepEqual(input.map((c) => c.id), ["done", "active"]); // entrée intacte
});

test("sortForBoard : créneau connu avant créneau absent, puis ordre alphabétique", () => {
  const noSlot = checkin({ id: "noslot", slot_label: null });
  const late = checkin({ id: "late", slot_label: "03h" });
  const early = checkin({ id: "early", slot_label: "01h" });
  const out = sortForBoard([noSlot, late, early]);
  assert.deepEqual(out.map((c) => c.id), ["early", "late", "noslot"]);
});

// ————————————————————————————————————————————————————————————————
// Résumé — états vides HONNÊTES
// ————————————————————————————————————————————————————————————————

test("summarizeCheckins : liste vide → zéros (aucun artiste fabriqué)", () => {
  const s = summarizeCheckins([]);
  assert.equal(s.total, 0);
  assert.equal(s.arrives, 0);
  assert.equal(s.attendus, 0);
  assert.equal(s.prets, 0);
  assert.equal(s.noShow, 0);
  assert.equal(s.accompagnants, 0);
  for (const st of CHECKIN_STATUSES) assert.equal(s.parStatut[st], 0);
});

test("summarizeCheckins : comptes cohérents", () => {
  const full = { arrived_at: "x", soundcheck_at: "y", tech_validated_at: "z" };
  const s = summarizeCheckins([
    checkin({ id: "a", status: "attendu", companions: 2 }),
    checkin({ id: "b", status: "arrive", arrived_at: "x", companions: 1 }),
    checkin({ id: "c", ...full, status: "pret" }),
    checkin({ id: "d", status: "no_show" }),
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.attendus, 1);
  assert.equal(s.arrives, 2); // b + c ont arrived_at
  assert.equal(s.prets, 1); // c seulement
  assert.equal(s.noShow, 1);
  assert.equal(s.accompagnants, 3); // 2 + 1
  assert.equal(s.parStatut.attendu, 1);
  assert.equal(s.parStatut.pret, 1);
  assert.equal(s.parStatut.no_show, 1);
});
