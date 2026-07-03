import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKLIST_CATEGORIES,
  CHECKLIST_PHASES,
  CHECKLIST_ROLES,
  buildLines,
  canCompleteItem,
  canManageChecklistItems,
  canViewChecklists,
  categoryLabel,
  groupByPhase,
  isChecklistCategory,
  isChecklistPhase,
  isChecklistPoste,
  linesForPoste,
  phaseLabel,
  progressByPhase,
  summarizeChecklist,
  validateItemDraft,
  type ChecklistCompletion,
  type ChecklistItem,
  type ChecklistItemDraft,
} from "../lib/checklists.ts";
import type { StaffRole } from "../lib/permissions.ts";

const ALL_ROLES: StaffRole[] = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
  "promoter",
];

function item(over: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: over.id ?? "i1",
    venue: over.venue ?? null,
    phase: over.phase ?? "ouverture",
    category: over.category ?? "secu",
    poste: over.poste ?? null,
    label: over.label ?? "Vérifier extincteurs",
    position: over.position ?? 0,
    active: over.active ?? true,
    auteur_username: over.auteur_username ?? "manuel",
    created_at: over.created_at ?? "2026-07-03T20:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-03T20:00:00.000Z",
  };
}

function completion(over: Partial<ChecklistCompletion> = {}): ChecklistCompletion {
  return {
    id: over.id ?? "c1",
    item_id: over.item_id ?? "i1",
    event_id: over.event_id ?? null,
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    note: over.note ?? null,
    done_by: over.done_by ?? "jeremy",
    done_at: over.done_at ?? "2026-07-03T21:00:00.000Z",
  };
}

function draft(over: Partial<ChecklistItemDraft> = {}): ChecklistItemDraft {
  return {
    phase: over.phase ?? "ouverture",
    category: over.category ?? "secu",
    label: over.label ?? "Vérifier extincteurs",
    poste: over.poste,
    venue: over.venue,
    position: over.position,
  };
}

// ————————————————————————————————————————————————————————————————
// Vocabulaire fermé
// ————————————————————————————————————————————————————————————————

test("CHECKLIST_CATEGORIES = les 10 catégories du master §2 (aucune inventée)", () => {
  assert.deepEqual([...CHECKLIST_CATEGORIES], [
    "secu",
    "caisse",
    "lumiere",
    "son",
    "nettoyage",
    "stocks",
    "tables",
    "issues",
    "signaletique",
    "captation",
  ]);
});

test("CHECKLIST_PHASES = ouverture/fermeture", () => {
  assert.deepEqual([...CHECKLIST_PHASES], ["ouverture", "fermeture"]);
});

test("CHECKLIST_ROLES exclut le promoteur (pas de poste d'ouverture/fermeture)", () => {
  assert.ok(!(CHECKLIST_ROLES as readonly string[]).includes("promoter"));
  assert.equal(CHECKLIST_ROLES.length, 5);
});

// ————————————————————————————————————————————————————————————————
// Gardes de type
// ————————————————————————————————————————————————————————————————

test("isChecklistPhase / isChecklistCategory / isChecklistPoste", () => {
  assert.ok(isChecklistPhase("ouverture"));
  assert.ok(!isChecklistPhase("milieu"));
  assert.ok(isChecklistCategory("captation"));
  assert.ok(!isChecklistCategory("boisson"));
  assert.ok(isChecklistPoste("server"));
  assert.ok(!isChecklistPoste("promoter"));
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle
// ————————————————————————————————————————————————————————————————

test("canViewChecklists : tous opérationnels oui, promoteur non", () => {
  for (const r of ALL_ROLES) {
    assert.equal(canViewChecklists(r), r !== "promoter");
  }
});

test("canManageChecklistItems : direction seule", () => {
  assert.ok(canManageChecklistItems("admin"));
  assert.ok(canManageChecklistItems("manager"));
  for (const r of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.ok(!canManageChecklistItems(r));
  }
});

test("canCompleteItem : direction coche tout ; employé coche sans-poste ou son poste ; promoteur jamais", () => {
  const nulPoste = item({ poste: null });
  const serverItem = item({ poste: "server" });
  const managerItem = item({ poste: "manager" });

  // Direction coche tout
  assert.ok(canCompleteItem("admin", managerItem));
  assert.ok(canCompleteItem("manager", serverItem));

  // Serveur : coche sans-poste + son poste, pas le poste manager
  assert.ok(canCompleteItem("server", nulPoste));
  assert.ok(canCompleteItem("server", serverItem));
  assert.ok(!canCompleteItem("server", managerItem));

  // Sécurité : coche sans-poste, pas l'item server
  assert.ok(canCompleteItem("security", nulPoste));
  assert.ok(!canCompleteItem("security", serverItem));

  // Promoteur : jamais
  assert.ok(!canCompleteItem("promoter", nulPoste));
});

test("canCompleteItem : un item désactivé n'est plus cochable, même par la direction", () => {
  const inactive = item({ poste: null, active: false });
  assert.ok(!canCompleteItem("admin", inactive));
  assert.ok(!canCompleteItem("server", inactive));
});

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon
// ————————————————————————————————————————————————————————————————

test("validateItemDraft : brouillon valide par un manager", () => {
  const v = validateItemDraft(draft({ poste: "server", position: 2 }), "manager");
  assert.ok(v.ok, v.errors.join(", "));
});

test("validateItemDraft : libellé vide refusé", () => {
  const v = validateItemDraft(draft({ label: "   " }), "manager");
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes("libellé")));
});

test("validateItemDraft : phase et catégorie inconnues refusées", () => {
  const v = validateItemDraft(draft({ phase: "milieu", category: "boisson" }), "admin");
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes("phase")));
  assert.ok(v.errors.some((e) => e.includes("catégorie")));
});

test("validateItemDraft : poste invalide refusé, null accepté", () => {
  assert.ok(!validateItemDraft(draft({ poste: "promoter" }), "manager").ok);
  assert.ok(validateItemDraft(draft({ poste: null }), "manager").ok);
});

test("validateItemDraft : position négative/décimale refusée", () => {
  assert.ok(!validateItemDraft(draft({ position: -1 }), "manager").ok);
  assert.ok(!validateItemDraft(draft({ position: 1.5 }), "manager").ok);
});

test("validateItemDraft : rôle non-gestionnaire refusé (server/promoteur)", () => {
  assert.ok(!validateItemDraft(draft(), "server").ok);
  assert.ok(!validateItemDraft(draft(), "promoter").ok);
});

// ————————————————————————————————————————————————————————————————
// buildLines (fusion items + coches)
// ————————————————————————————————————————————————————————————————

test("buildLines : associe la coche de la soirée, exclut les items inactifs", () => {
  const items = [
    item({ id: "a", label: "A" }),
    item({ id: "b", label: "B" }),
    item({ id: "c", label: "C", active: false }),
  ];
  const completions = [completion({ id: "cc", item_id: "a", done_by: "jeremy" })];
  const lines = buildLines(items, completions, "2026-07-03");
  assert.equal(lines.length, 2); // c inactif exclu
  const a = lines.find((l) => l.item.id === "a")!;
  const b = lines.find((l) => l.item.id === "b")!;
  assert.ok(a.done);
  assert.equal(a.doneBy, "jeremy");
  assert.ok(!b.done);
  assert.equal(b.doneBy, null);
});

test("buildLines : une coche d'une AUTRE soirée n'est pas associée", () => {
  const items = [item({ id: "a" })];
  const completions = [completion({ item_id: "a", exploitation_date: "2026-07-02" })];
  const lines = buildLines(items, completions, "2026-07-03");
  assert.ok(!lines[0].done);
});

// ————————————————————————————————————————————————————————————————
// groupByPhase
// ————————————————————————————————————————————————————————————————

test("groupByPhase : ordre du vocabulaire, catégories vides omises, tri par position", () => {
  const items = [
    item({ id: "1", phase: "fermeture", category: "caisse", label: "Z", position: 1 }),
    item({ id: "2", phase: "ouverture", category: "secu", label: "b", position: 2 }),
    item({ id: "3", phase: "ouverture", category: "secu", label: "a", position: 1 }),
  ];
  const lines = buildLines(items, [], "2026-07-03");
  const groups = groupByPhase(lines);
  // ouverture avant fermeture (ordre du vocabulaire)
  assert.equal(groups[0].phase, "ouverture");
  assert.equal(groups[1].phase, "fermeture");
  // dans ouverture/secu : tri par position (a avant b)
  const secu = groups[0].groups.find((g) => g.category === "secu")!;
  assert.deepEqual(secu.lines.map((l) => l.item.label), ["a", "b"]);
  // aucune catégorie vide fabriquée
  assert.equal(groups[0].groups.length, 1);
});

test("groupByPhase : liste vide → aucune phase (pas de section fabriquée)", () => {
  assert.deepEqual(groupByPhase([]), []);
});

// ————————————————————————————————————————————————————————————————
// linesForPoste
// ————————————————————————————————————————————————————————————————

test("linesForPoste : direction voit tout, employé voit sans-poste + son poste", () => {
  const items = [
    item({ id: "n", poste: null }),
    item({ id: "s", poste: "server" }),
    item({ id: "m", poste: "manager" }),
  ];
  const lines = buildLines(items, [], "2026-07-03");
  assert.equal(linesForPoste(lines, "admin").length, 3);
  const serverView = linesForPoste(lines, "server").map((l) => l.item.id).sort();
  assert.deepEqual(serverView, ["n", "s"]);
});

// ————————————————————————————————————————————————————————————————
// progress & summary
// ————————————————————————————————————————————————————————————————

test("progressByPhase : compte cochés/total par phase, phase vide → 0/0", () => {
  const items = [
    item({ id: "1", phase: "ouverture" }),
    item({ id: "2", phase: "ouverture" }),
  ];
  const completions = [completion({ item_id: "1" })];
  const lines = buildLines(items, completions, "2026-07-03");
  const prog = progressByPhase(lines);
  const ouv = prog.find((p) => p.phase === "ouverture")!;
  const fer = prog.find((p) => p.phase === "fermeture")!;
  assert.deepEqual([ouv.total, ouv.done], [2, 1]);
  assert.deepEqual([fer.total, fer.done], [0, 0]);
});

test("summarizeChecklist : liste vide → zéros, complete=false (pas de division par zéro)", () => {
  const s = summarizeChecklist([]);
  assert.deepEqual(s, { total: 0, done: 0, remaining: 0, complete: false });
});

test("summarizeChecklist : tout coché → complete=true", () => {
  const items = [item({ id: "1" }), item({ id: "2" })];
  const completions = [completion({ item_id: "1" }), completion({ id: "c2", item_id: "2" })];
  const lines = buildLines(items, completions, "2026-07-03");
  const s = summarizeChecklist(lines);
  assert.deepEqual(s, { total: 2, done: 2, remaining: 0, complete: true });
});

test("summarizeChecklist : partiellement coché → complete=false, remaining correct", () => {
  const items = [item({ id: "1" }), item({ id: "2" })];
  const lines = buildLines(items, [completion({ item_id: "1" })], "2026-07-03");
  const s = summarizeChecklist(lines);
  assert.deepEqual(s, { total: 2, done: 1, remaining: 1, complete: false });
});

// ————————————————————————————————————————————————————————————————
// Libellés FR
// ————————————————————————————————————————————————————————————————

test("phaseLabel / categoryLabel : libellés FR déterministes pour tout le vocabulaire", () => {
  for (const p of CHECKLIST_PHASES) assert.ok(phaseLabel(p).length > 0);
  for (const c of CHECKLIST_CATEGORIES) assert.ok(categoryLabel(c).length > 0);
  assert.equal(categoryLabel("captation"), "Contenus à capturer");
  assert.equal(phaseLabel("fermeture"), "Fermeture");
});
