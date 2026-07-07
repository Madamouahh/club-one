import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_STATUSES,
  artistStatusLabel,
  canManageArtists,
  canViewArtists,
  formatFee,
  isArtistStatus,
  sortArtists,
  summarizeArtists,
  validateArtistDraft,
  type Artist,
  type ArtistDraft,
} from "../lib/artists.ts";
import type { StaffRole } from "../lib/permissions.ts";

const ALL_ROLES: StaffRole[] = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
  "promoter",
];

function artist(over: Partial<Artist> = {}): Artist {
  return {
    id: over.id ?? "a1",
    stage_name: over.stage_name ?? "DJ Neon",
    legal_name: over.legal_name ?? null,
    email: over.email ?? null,
    phone: over.phone ?? null,
    style: over.style ?? null,
    fee_cents: over.fee_cents === undefined ? null : over.fee_cents,
    tech_requirements: over.tech_requirements ?? null,
    notes: over.notes ?? null,
    status: over.status ?? "active",
    created_by: over.created_by ?? "manuel",
    created_at: over.created_at ?? "2026-07-03T20:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-03T20:00:00.000Z",
  };
}

function draft(over: Partial<ArtistDraft> = {}): ArtistDraft {
  return {
    stage_name: over.stage_name ?? "DJ Neon",
    legal_name: over.legal_name,
    email: over.email,
    phone: over.phone,
    style: over.style,
    fee_cents: over.fee_cents,
    tech_requirements: over.tech_requirements,
    notes: over.notes,
  };
}

// ————————————————————————————————————————————————————————————————
// Vocabulaire fermé
// ————————————————————————————————————————————————————————————————

test("ARTIST_STATUSES = active/archived (aucun inventé)", () => {
  assert.deepEqual([...ARTIST_STATUSES], ["active", "archived"]);
});

test("isArtistStatus", () => {
  assert.ok(isArtistStatus("active"));
  assert.ok(isArtistStatus("archived"));
  assert.ok(!isArtistStatus("deleted"));
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle (miroir RLS direction-only 0069)
// ————————————————————————————————————————————————————————————————

test("canManageArtists : direction seule", () => {
  for (const r of ALL_ROLES) {
    assert.equal(canManageArtists(r), r === "admin" || r === "manager");
  }
});

test("canViewArtists : direction seule (répertoire non exposé aux rôles opérationnels)", () => {
  for (const r of ALL_ROLES) {
    assert.equal(canViewArtists(r), r === "admin" || r === "manager");
  }
});

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon
// ————————————————————————————————————————————————————————————————

test("validateArtistDraft : brouillon valide par un manager", () => {
  const v = validateArtistDraft(draft({ email: "book@neon.fr", fee_cents: 150000 }), "manager");
  assert.ok(v.ok, v.errors.join(", "));
});

test("validateArtistDraft : nom de scène vide refusé", () => {
  const v = validateArtistDraft(draft({ stage_name: "   " }), "admin");
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes("nom de scène")));
});

test("validateArtistDraft : cachet négatif ou décimal refusé, null/0 acceptés", () => {
  assert.ok(!validateArtistDraft(draft({ fee_cents: -1 }), "manager").ok);
  assert.ok(!validateArtistDraft(draft({ fee_cents: 12.5 }), "manager").ok);
  assert.ok(validateArtistDraft(draft({ fee_cents: 0 }), "manager").ok);
  assert.ok(validateArtistDraft(draft({ fee_cents: null }), "manager").ok);
  assert.ok(validateArtistDraft(draft({ fee_cents: undefined }), "manager").ok);
});

test("validateArtistDraft : email de forme invalide refusé, vide accepté", () => {
  const bad = validateArtistDraft(draft({ email: "pas-un-email" }), "manager");
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => e.includes("email")));
  assert.ok(validateArtistDraft(draft({ email: "" }), "manager").ok);
  assert.ok(validateArtistDraft(draft({ email: null }), "manager").ok);
});

test("validateArtistDraft : rôle non-direction refusé (server/security/promoteur)", () => {
  for (const r of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    const v = validateArtistDraft(draft(), r);
    assert.ok(!v.ok);
    assert.ok(v.errors.some((e) => e.includes("ce rôle ne peut pas")));
  }
});

test("validateArtistDraft : plusieurs erreurs cumulées", () => {
  const v = validateArtistDraft(draft({ stage_name: "", fee_cents: -5, email: "x" }), "server");
  assert.ok(!v.ok);
  assert.ok(v.errors.length >= 4);
});

// ————————————————————————————————————————————————————————————————
// formatFee (déterministe)
// ————————————————————————————————————————————————————————————————

test("formatFee : null → à confirmer (jamais un cachet fabriqué)", () => {
  assert.equal(formatFee(null), "à confirmer");
});

test("formatFee : valeur en centimes → euros fr-FR avec symbole", () => {
  const s = formatFee(150000);
  assert.ok(s.includes("500,00"), s);
  assert.ok(s.endsWith(" €"), s);
  assert.equal(formatFee(0), "0,00 €");
  assert.equal(formatFee(199), "1,99 €");
});

// ————————————————————————————————————————————————————————————————
// Tri
// ————————————————————————————————————————————————————————————————

test("sortArtists : actifs d'abord puis alpha par nom de scène, copie non mutante", () => {
  const list = [
    artist({ id: "1", stage_name: "Zorg", status: "active" }),
    artist({ id: "2", stage_name: "Alpha", status: "archived" }),
    artist({ id: "3", stage_name: "Beta", status: "active" }),
    artist({ id: "4", stage_name: "alba", status: "active" }),
  ];
  const sorted = sortArtists(list);
  assert.deepEqual(sorted.map((a) => a.id), ["4", "3", "1", "2"]);
  // non mutant : la liste d'origine garde son ordre
  assert.deepEqual(list.map((a) => a.id), ["1", "2", "3", "4"]);
});

// ————————————————————————————————————————————————————————————————
// Résumé
// ————————————————————————————————————————————————————————————————

test("summarizeArtists : liste vide → zéros (état vide honnête)", () => {
  assert.deepEqual(summarizeArtists([]), { total: 0, actifs: 0, archives: 0 });
});

test("summarizeArtists : compte actifs et archivés", () => {
  const list = [
    artist({ id: "1", status: "active" }),
    artist({ id: "2", status: "active" }),
    artist({ id: "3", status: "archived" }),
  ];
  assert.deepEqual(summarizeArtists(list), { total: 3, actifs: 2, archives: 1 });
});

// ————————————————————————————————————————————————————————————————
// Libellés FR
// ————————————————————————————————————————————————————————————————

test("artistStatusLabel : libellés FR déterministes", () => {
  assert.equal(artistStatusLabel("active"), "Actif");
  assert.equal(artistStatusLabel("archived"), "Archivé");
});
