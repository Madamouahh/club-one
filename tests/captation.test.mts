import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTATION_ROLES,
  CAPTATION_STATUSES,
  VENUES,
  buildShotLines,
  canCaptureShot,
  canManageShotList,
  canViewCaptation,
  countByStatus,
  groupByVenue,
  isCaptationStatus,
  isVenue,
  statusLabel,
  summarizeCaptation,
  validateShotDraft,
  venueLabel,
  type ShotCapture,
  type ShotListDraft,
  type ShotListItem,
} from "../lib/captation.ts";
import type { StaffRole } from "../lib/permissions.ts";

const ALL_ROLES: StaffRole[] = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
  "promoter",
];

// ————————————————————————————————————————————————————————————————
// Fabriques de test (jamais de donnée réelle : seulement des fixtures explicitement de test)
// ————————————————————————————————————————————————————————————————

function makeItem(over: Partial<ShotListItem> = {}): ShotListItem {
  return {
    id: over.id ?? "item-1",
    venue: "venue" in over ? (over.venue ?? null) : "eden", // préserve un null explicite (toutes salles)
    label: over.label ?? "Plan test",
    sujet: over.sujet ?? null,
    format: over.format ?? null,
    heure_ideale: over.heure_ideale ?? null,
    prioritaire: over.prioritaire ?? false,
    position: over.position ?? 0,
    active: over.active ?? true,
    auteur_username: over.auteur_username ?? "manager",
    created_at: over.created_at ?? "2026-07-03T00:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-03T00:00:00.000Z",
  };
}

function makeCapture(over: Partial<ShotCapture> = {}): ShotCapture {
  return {
    id: over.id ?? "cap-1",
    item_id: over.item_id ?? "item-1",
    event_id: over.event_id ?? null,
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    status: over.status ?? "capture",
    dam_ref: over.dam_ref ?? null,
    note: over.note ?? null,
    updated_by: over.updated_by ?? "manager",
    updated_at: over.updated_at ?? "2026-07-03T01:00:00.000Z",
  };
}

// ————————————————————————————————————————————————————————————————
// Vocabulaire fermé
// ————————————————————————————————————————————————————————————————

test("statuts = cycle de vie fermé du master (à capturer → capturé → déposé)", () => {
  assert.deepEqual([...CAPTATION_STATUSES], ["a_capturer", "capture", "depose"]);
});

test("univers = ceux de venueTables (réutilisés, jamais redéfinis)", () => {
  assert.deepEqual([...VENUES], ["eden", "terminus", "cercle"]);
});

test("rôles captation = direction seule (créa absente du socle)", () => {
  assert.deepEqual([...CAPTATION_ROLES], ["admin", "manager"]);
});

// ————————————————————————————————————————————————————————————————
// Gardes de type
// ————————————————————————————————————————————————————————————————

test("isCaptationStatus : accepte le vocabulaire, refuse l'inconnu", () => {
  for (const s of CAPTATION_STATUSES) assert.equal(isCaptationStatus(s), true);
  assert.equal(isCaptationStatus("publie"), false);
  assert.equal(isCaptationStatus(""), false);
});

test("isVenue : accepte les 3 univers, refuse l'inconnu", () => {
  for (const v of VENUES) assert.equal(isVenue(v), true);
  assert.equal(isVenue("rooftop"), false);
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle (miroir RLS 0029) — direction seule
// ————————————————————————————————————————————————————————————————

test("canViewCaptation : admin/manager oui, tous les autres non", () => {
  for (const role of ALL_ROLES) {
    const expected = role === "admin" || role === "manager";
    assert.equal(canViewCaptation(role), expected, role);
  }
});

test("canManageShotList : direction seule", () => {
  for (const role of ALL_ROLES) {
    const expected = role === "admin" || role === "manager";
    assert.equal(canManageShotList(role), expected, role);
  }
});

test("canCaptureShot : direction sur plan actif ; jamais sur plan désactivé ; jamais hors direction", () => {
  assert.equal(canCaptureShot("manager", { active: true }), true);
  assert.equal(canCaptureShot("admin", { active: true }), true);
  assert.equal(canCaptureShot("manager", { active: false }), false);
  assert.equal(canCaptureShot("server", { active: true }), false);
  assert.equal(canCaptureShot("security", { active: true }), false);
  assert.equal(canCaptureShot("promoter", { active: true }), false);
});

// ————————————————————————————————————————————————————————————————
// Validation de brouillon
// ————————————————————————————————————————————————————————————————

test("validateShotDraft : brouillon nominal accepté (champs libres vides OK)", () => {
  const draft: ShotListDraft = { label: "Arrivée de l'artiste", venue: "eden" };
  assert.deepEqual(validateShotDraft(draft, "manager"), { ok: true, errors: [] });
});

test("validateShotDraft : libellé vide refusé", () => {
  const r = validateShotDraft({ label: "   " }, "manager");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("libellé")));
});

test("validateShotDraft : univers inconnu refusé, mais venue null accepté (toutes salles)", () => {
  assert.equal(validateShotDraft({ label: "x", venue: "rooftop" }, "manager").ok, false);
  assert.equal(validateShotDraft({ label: "x", venue: null }, "manager").ok, true);
});

test("validateShotDraft : position non entière ou négative refusée", () => {
  assert.equal(validateShotDraft({ label: "x", position: -1 }, "manager").ok, false);
  assert.equal(validateShotDraft({ label: "x", position: 1.5 }, "manager").ok, false);
  assert.equal(validateShotDraft({ label: "x", position: 3 }, "manager").ok, true);
});

test("validateShotDraft : rôle non-direction refusé", () => {
  const r = validateShotDraft({ label: "x" }, "server");
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("ne peut pas composer")));
});

// ————————————————————————————————————————————————————————————————
// Fusion plans + captures
// ————————————————————————————————————————————————————————————————

test("buildShotLines : plan sans capture → statut par défaut 'a_capturer'", () => {
  const lines = buildShotLines([makeItem()], [], "2026-07-03");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].status, "a_capturer");
  assert.equal(lines[0].damRef, null);
});

test("buildShotLines : associe la capture de la BONNE soirée", () => {
  const lines = buildShotLines(
    [makeItem()],
    [
      makeCapture({ exploitation_date: "2026-07-02", status: "depose" }),
      makeCapture({ exploitation_date: "2026-07-03", status: "capture", dam_ref: "DAM-42" }),
    ],
    "2026-07-03",
  );
  assert.equal(lines[0].status, "capture");
  assert.equal(lines[0].damRef, "DAM-42");
});

test("buildShotLines : plans inactifs exclus (historique préservé en base, hors liste courante)", () => {
  const lines = buildShotLines(
    [makeItem({ id: "a" }), makeItem({ id: "b", active: false })],
    [],
    "2026-07-03",
  );
  assert.deepEqual(lines.map((l) => l.item.id), ["a"]);
});

// ————————————————————————————————————————————————————————————————
// Regroupement par univers
// ————————————————————————————————————————————————————————————————

test("groupByVenue : ordre des univers, plans 'toutes salles' en dernier, univers vides omis", () => {
  const lines = buildShotLines(
    [
      makeItem({ id: "t", venue: "terminus" }),
      makeItem({ id: "e", venue: "eden" }),
      makeItem({ id: "n", venue: null }),
    ],
    [],
    "2026-07-03",
  );
  const groups = groupByVenue(lines);
  assert.deepEqual(groups.map((g) => g.venue), ["eden", "terminus", null]);
});

test("groupByVenue : dans un univers, prioritaires d'abord, puis position, puis libellé", () => {
  const lines = buildShotLines(
    [
      makeItem({ id: "z", venue: "eden", prioritaire: false, position: 0, label: "Zzz" }),
      makeItem({ id: "p", venue: "eden", prioritaire: true, position: 9, label: "Prio" }),
      makeItem({ id: "a", venue: "eden", prioritaire: false, position: 0, label: "Aaa" }),
    ],
    [],
    "2026-07-03",
  );
  const eden = groupByVenue(lines).find((g) => g.venue === "eden");
  assert.deepEqual(eden?.lines.map((l) => l.item.id), ["p", "a", "z"]);
});

test("groupByVenue : liste vide → aucun groupe (honnête)", () => {
  assert.deepEqual(groupByVenue([]), []);
});

// ————————————————————————————————————————————————————————————————
// Avancement & résumé (états vides honnêtes)
// ————————————————————————————————————————————————————————————————

test("countByStatus : liste vide → tous les compteurs à zéro", () => {
  assert.deepEqual(countByStatus([]), { a_capturer: 0, capture: 0, depose: 0 });
});

test("countByStatus : compte par statut réel", () => {
  const lines = buildShotLines(
    [makeItem({ id: "a" }), makeItem({ id: "b" }), makeItem({ id: "c" })],
    [
      makeCapture({ item_id: "a", status: "depose" }),
      makeCapture({ item_id: "b", status: "capture" }),
      // c : aucune capture → a_capturer
    ],
    "2026-07-03",
  );
  assert.deepEqual(countByStatus(lines), { a_capturer: 1, capture: 1, depose: 1 });
});

test("summarizeCaptation : liste vide → zéros, non complet (pas de division fabriquée)", () => {
  assert.deepEqual(summarizeCaptation([]), {
    total: 0,
    captured: 0,
    deposited: 0,
    remaining: 0,
    complete: false,
  });
});

test("summarizeCaptation : capturé compte capture + déposé ; complet ssi tout déposé", () => {
  const partial = buildShotLines(
    [makeItem({ id: "a" }), makeItem({ id: "b" })],
    [makeCapture({ item_id: "a", status: "depose" }), makeCapture({ item_id: "b", status: "capture" })],
    "2026-07-03",
  );
  const s1 = summarizeCaptation(partial);
  assert.equal(s1.captured, 2);
  assert.equal(s1.deposited, 1);
  assert.equal(s1.remaining, 0);
  assert.equal(s1.complete, false);

  const allDeposited = buildShotLines(
    [makeItem({ id: "a" }), makeItem({ id: "b" })],
    [makeCapture({ item_id: "a", status: "depose" }), makeCapture({ item_id: "b", status: "depose" })],
    "2026-07-03",
  );
  assert.equal(summarizeCaptation(allDeposited).complete, true);
});

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes
// ————————————————————————————————————————————————————————————————

test("statusLabel : libellés FR pour chaque statut", () => {
  assert.equal(statusLabel("a_capturer"), "À capturer");
  assert.equal(statusLabel("capture"), "Capturé");
  assert.equal(statusLabel("depose"), "Déposé au DAM");
});

test("venueLabel : libellés FR + 'Toutes salles' pour null", () => {
  assert.equal(venueLabel("eden"), "Eden");
  assert.equal(venueLabel("terminus"), "Terminus");
  assert.equal(venueLabel("cercle"), "Le Cercle");
  assert.equal(venueLabel(null), "Toutes salles");
});
