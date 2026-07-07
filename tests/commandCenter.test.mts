import assert from "node:assert/strict";
import test from "node:test";

import {
  CC_DOMAINS,
  CC_DOMAIN_TAB,
  buildCommandCenter,
  canViewCommandCenter,
  commandCenterDomainTab,
  commandCenterDomainTitle,
  commandCenterSeverityLabel,
  type CommandCenterInput,
  type CountSignal,
} from "../lib/commandCenter.ts";
import { APP_TABS, STAFF_ROLES, type AppTab, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Garde de rôle : B1 = direction (admin + manager) uniquement
// ————————————————————————————————————————————————————————————————
test("canViewCommandCenter : direction (admin/manager) OUI ; employés/promoteur NON", () => {
  assert.equal(canViewCommandCenter("admin"), true);
  assert.equal(canViewCommandCenter("manager"), true);
  for (const role of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canViewCommandCenter(role), false, `${role} ne doit PAS voir B1`);
  }
});

test("canViewCommandCenter couvre tous les rôles connus sans exception", () => {
  for (const role of STAFF_ROLES) {
    assert.equal(typeof canViewCommandCenter(role), "boolean");
  }
});

// ————————————————————————————————————————————————————————————————
// Honnêteté de couverture : un cockpit sans aucun signal → tout « non branché »,
// jamais un faux zéro, jamais une alerte fabriquée.
// ————————————————————————————————————————————————————————————————
test("aucun signal → chaque domaine est non_connecte, overall non_connecte, 0 alerte", () => {
  const view = buildCommandCenter({ activeEvent: null });
  assert.equal(view.tiles.length, CC_DOMAINS.length);
  for (const tile of view.tiles) {
    assert.equal(tile.connected, false);
    assert.equal(tile.severity, "non_connecte");
  }
  assert.equal(view.coverage.total, CC_DOMAINS.length);
  assert.equal(view.coverage.connected, 0);
  assert.equal(view.coverage.notConnected, CC_DOMAINS.length);
  assert.equal(view.overall, "non_connecte");
  assert.equal(view.attentionCount, 0);
  assert.equal(view.critiqueCount, 0);
  assert.equal(view.event, null);
});

test("les tuiles sortent dans l'ordre canonique de CC_DOMAINS", () => {
  const view = buildCommandCenter({ activeEvent: null });
  assert.deepEqual(
    view.tiles.map((t) => t.key),
    [...CC_DOMAINS],
  );
});

// ————————————————————————————————————————————————————————————————
// Incidents : escalade/critique → critique ; actif → attention ; 0 → ok
// ————————————————————————————————————————————————————————————————
test("incidents escaladés → tuile critique", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    incidents: { actifs: 2, escalades: 1, critiquesActifs: 0 },
  });
  const t = view.tiles.find((x) => x.key === "incidents")!;
  assert.equal(t.connected, true);
  assert.equal(t.severity, "critique");
  assert.equal(view.critiqueCount, 1);
  assert.equal(view.overall, "critique");
});

test("incidents actifs sans escalade → attention", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    incidents: { actifs: 3, escalades: 0, critiquesActifs: 0 },
  });
  const t = view.tiles.find((x) => x.key === "incidents")!;
  assert.equal(t.severity, "attention");
  assert.equal(view.attentionCount, 1);
});

test("incidents à zéro → ok (branché mais rien à traiter, pas non_connecte)", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    incidents: { actifs: 0, escalades: 0, critiquesActifs: 0 },
  });
  const t = view.tiles.find((x) => x.key === "incidents")!;
  assert.equal(t.connected, true);
  assert.equal(t.severity, "ok");
});

// ————————————————————————————————————————————————————————————————
// Remplissage : complet → attention ; total 0 → vide (pas ok)
// ————————————————————————————————————————————————————————————————
test("remplissage complet → attention avec pourcentage", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    remplissage: { occupees: 44, total: 44 },
  });
  const t = view.tiles.find((x) => x.key === "remplissage")!;
  assert.equal(t.severity, "attention");
  assert.match(t.headline, /44\/44 \(100 %\)/);
});

test("remplissage sans table → vide, pas ok", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    remplissage: { occupees: 0, total: 0 },
  });
  const t = view.tiles.find((x) => x.key === "remplissage")!;
  assert.equal(t.severity, "vide");
});

// ————————————————————————————————————————————————————————————————
// Présence : sous-effectif → attention ; coût partiel signalé honnêtement
// ————————————————————————————————————————————————————————————————
test("présence sous-effectif ET coût partiel → attention + double détail honnête", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    presence: { presents: 4, attendus: 6, coutComplet: false },
  });
  const t = view.tiles.find((x) => x.key === "presence_staff")!;
  assert.equal(t.severity, "attention");
  assert.match(t.detail ?? "", /non pointé/);
  assert.match(t.detail ?? "", /coût staff partiel/);
});

test("présence complète et coût complet → ok sans détail", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    presence: { presents: 6, attendus: 6, coutComplet: true },
  });
  const t = view.tiles.find((x) => x.key === "presence_staff")!;
  assert.equal(t.severity, "ok");
  assert.equal(t.detail, null);
});

// ————————————————————————————————————————————————————————————————
// Résa / captation / checklists / CA
// ————————————————————————————————————————————————————————————————
test("résas en attente → attention ; zéro → ok", () => {
  const a = buildCommandCenter({ activeEvent: null, resa: { pending: 2 } });
  assert.equal(a.tiles.find((x) => x.key === "resa_en_attente")!.severity, "attention");
  const b = buildCommandCenter({ activeEvent: null, resa: { pending: 0 } });
  assert.equal(b.tiles.find((x) => x.key === "resa_en_attente")!.severity, "ok");
});

test("CA partiel → détail d'honnêteté « PARTIEL » ; CA nul → vide", () => {
  const partial = buildCommandCenter({
    activeEvent: null,
    ca: { montantCents: 123456, complet: false },
  });
  const t = partial.tiles.find((x) => x.key === "ca_soiree")!;
  assert.equal(t.severity, "ok");
  assert.match(t.detail ?? "", /PARTIEL/);

  const empty = buildCommandCenter({ activeEvent: null, ca: { montantCents: 0, complet: true } });
  assert.equal(empty.tiles.find((x) => x.key === "ca_soiree")!.severity, "vide");
});

// ————————————————————————————————————————————————————————————————
// Agrégat : overall = pire sévérité PARMI LES BRANCHÉS ; les non_connecte ne polluent pas
// ————————————————————————————————————————————————————————————————
test("overall ignore les domaines non branchés et prend la pire sévérité branchée", () => {
  const view = buildCommandCenter({
    activeEvent: { label: "Eden — démo", date: "2026-07-04", venue: "eden" },
    incidents: { actifs: 1, escalades: 0, critiquesActifs: 0 }, // attention
    ca: { montantCents: 500000, complet: true }, // ok
    // tout le reste : non branché
  });
  assert.equal(view.overall, "attention");
  assert.equal(view.coverage.connected, 2);
  assert.equal(view.coverage.notConnected, CC_DOMAINS.length - 2);
  assert.deepEqual(view.event, { label: "Eden — démo", date: "2026-07-04", venue: "eden" });
});

test("une critique domine une attention dans overall", () => {
  const input: CommandCenterInput = {
    activeEvent: null,
    incidents: { actifs: 2, escalades: 1, critiquesActifs: 1 }, // critique
    resa: { pending: 5 }, // attention
  };
  const view = buildCommandCenter(input);
  assert.equal(view.overall, "critique");
  assert.equal(view.critiqueCount, 1);
  assert.equal(view.attentionCount, 1);
});

test("tous branchés en OK → overall ok (pas vide, pas non_connecte)", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    incidents: { actifs: 0, escalades: 0, critiquesActifs: 0 },
    resa: { pending: 0 },
  });
  assert.equal(view.overall, "ok");
});

// ————————————————————————————————————————————————————————————————
// Libellés
// ————————————————————————————————————————————————————————————————
test("libellés de domaine et de sévérité définis et non vides", () => {
  for (const d of CC_DOMAINS) {
    assert.ok(commandCenterDomainTitle(d).length > 0);
  }
  assert.equal(commandCenterSeverityLabel("critique"), "Critique");
  assert.equal(commandCenterSeverityLabel("non_connecte"), "Non branché");
});

// ————————————————————————————————————————————————————————————————
// Liste des 20 domaines RÉELS
// ————————————————————————————————————————————————————————————————
test("la liste comporte exactement 20 domaines dans l'ordre attendu", () => {
  assert.equal(CC_DOMAINS.length, 20);
  assert.deepEqual(
    [...CC_DOMAINS],
    [
      "incidents",
      "remplissage",
      "presence_staff",
      "resa_en_attente",
      "captation",
      "checklists",
      "ca_soiree",
      "evenements_a_venir",
      "taches",
      "leads_chauds",
      "avis_a_traiter",
      "campagnes",
      "contrats",
      "inbox",
      "artistes",
      "fidelite",
      "budget",
      "stock",
      "maintenance",
      "invitations",
    ],
  );
});

// ————————————————————————————————————————————————————————————————
// Routage au clic : CC_DOMAIN_TAB couvre les 20 clés et ne cible que des AppTab valides
// ————————————————————————————————————————————————————————————————
test("CC_DOMAIN_TAB couvre les 20 domaines et ne cible que des AppTab existants", () => {
  const validTabs = new Set<AppTab>(APP_TABS);
  assert.equal(Object.keys(CC_DOMAIN_TAB).length, CC_DOMAINS.length);
  for (const domain of CC_DOMAINS) {
    const tab = CC_DOMAIN_TAB[domain];
    assert.ok(tab, `${domain} doit router vers un onglet`);
    assert.ok(validTabs.has(tab), `${domain} → ${tab} doit être un AppTab valide`);
    // commandCenterDomainTab renvoie la même cible que la table de routage.
    assert.equal(commandCenterDomainTab(domain), tab);
  }
});

test("le routage cible les onglets réels attendus", () => {
  assert.equal(commandCenterDomainTab("remplissage"), "plan");
  assert.equal(commandCenterDomainTab("ca_soiree"), "pnl");
  assert.equal(commandCenterDomainTab("resa_en_attente"), "demandesresa");
  assert.equal(commandCenterDomainTab("invitations"), "promoters");
  assert.equal(commandCenterDomainTab("artistes"), "artistcheckin");
});

// ————————————————————————————————————————————————————————————————
// Événements à venir
// ————————————————————————————————————————————————————————————————
test("événements à venir : N>0 → ok avec le prochain ; 0 → vide", () => {
  const some = buildCommandCenter({
    activeEvent: null,
    evenements: { aVenir: 3, prochain: { label: "Nuit Techno", date: "2026-07-11" } },
  });
  const t = some.tiles.find((x) => x.key === "evenements_a_venir")!;
  assert.equal(t.connected, true);
  assert.equal(t.severity, "ok");
  assert.match(t.headline, /3 à venir/);
  assert.match(t.detail ?? "", /Nuit Techno/);

  const none = buildCommandCenter({ activeEvent: null, evenements: { aVenir: 0, prochain: null } });
  assert.equal(none.tiles.find((x) => x.key === "evenements_a_venir")!.severity, "vide");
});

// ————————————————————————————————————————————————————————————————
// Builder générique tileCount : vide / attention / ok
// ————————————————————————————————————————————————————————————————
test("tileCount : total<=0 → vide (Aucun(e))", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    taches: { value: 0, total: 0, detailOtherwise: "aucune tâche" },
  });
  const t = view.tiles.find((x) => x.key === "taches")!;
  assert.equal(t.connected, true);
  assert.equal(t.severity, "vide");
  assert.equal(t.headline, "Aucun(e)");
  assert.equal(t.detail, "aucune tâche");
});

test("tileCount : emptyWhenZero rend vide même sans total", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    leads_chauds: { value: 0, emptyWhenZero: true, detailOtherwise: "aucun lead chaud" },
  });
  const t = view.tiles.find((x) => x.key === "leads_chauds")!;
  assert.equal(t.severity, "vide");
  assert.equal(t.headline, "Aucun(e)");
});

test("tileCount : attentionWhen → attention avec détail dédié", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    stock: {
      value: 4,
      attentionWhen: true,
      detailWhenAttention: "4 références sous le seuil",
      detailOtherwise: "stock OK",
    },
  });
  const t = view.tiles.find((x) => x.key === "stock")!;
  assert.equal(t.severity, "attention");
  assert.equal(t.headline, "4");
  assert.equal(t.detail, "4 références sous le seuil");
});

test("tileCount : sans attention → ok, avec total, unit et detailOtherwise", () => {
  const view = buildCommandCenter({
    activeEvent: null,
    budget: {
      value: 12000,
      total: 20000,
      unit: "€",
      detailOtherwise: "sous budget",
    } satisfies CountSignal,
  });
  const t = view.tiles.find((x) => x.key === "budget")!;
  assert.equal(t.severity, "ok");
  assert.equal(t.headline, "12000/20000 €");
  assert.equal(t.detail, "sous budget");
});

// ————————————————————————————————————————————————————————————————
// Tous les signaux fournis → 20/20 branchés (l'intégrateur alimente tout depuis page.tsx)
// ————————————————————————————————————————————————————————————————
test("tous les signaux fournis → coverage.connected === 20, aucun non branché", () => {
  const generic: CountSignal = { value: 1, detailOtherwise: "ok" };
  const full: CommandCenterInput = {
    activeEvent: { label: "Eden", date: "2026-07-07", venue: "eden" },
    incidents: { actifs: 0, escalades: 0, critiquesActifs: 0 },
    remplissage: { occupees: 10, total: 44 },
    presence: { presents: 6, attendus: 6, coutComplet: true },
    resa: { pending: 0 },
    captation: { aFaire: 0, total: 5 },
    checklists: { ouverts: 0, total: 8 },
    ca: { montantCents: 500000, complet: true },
    evenements: { aVenir: 2, prochain: { label: "Nuit", date: "2026-07-11" } },
    taches: generic,
    leads_chauds: generic,
    avis_a_traiter: generic,
    campagnes: generic,
    contrats: generic,
    inbox: generic,
    artistes: generic,
    fidelite: generic,
    budget: generic,
    stock: generic,
    maintenance: generic,
    invitations: generic,
  };
  const view = buildCommandCenter(full);
  assert.equal(view.coverage.connected, 20);
  assert.equal(view.coverage.total, 20);
  assert.equal(view.coverage.notConnected, 0);
  for (const tile of view.tiles) {
    assert.equal(tile.connected, true, `${tile.key} doit être branché`);
    assert.notEqual(tile.severity, "non_connecte");
  }
});
