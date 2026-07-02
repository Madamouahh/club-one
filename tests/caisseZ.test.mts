import assert from "node:assert/strict";
import test from "node:test";

import {
  CAISSE_VENUES,
  buildCaisseZUpsert,
  catalogueDataReady,
  emptyCaisseZForm,
  formFromRecord,
  groupProduitsByCategorie,
  isVenueId,
  liveTotals,
  paiementsEcart,
  parseCount,
  parseEuro,
  round2,
  type CaisseZFormValues,
  type CaisseZRecord,
  type ProduitBar,
} from "../lib/caisseZ.ts";

function form(overrides: Partial<CaisseZFormValues> = {}): CaisseZFormValues {
  return { ...emptyCaisseZForm("2026-07-04", "complexe"), ...overrides };
}

test("parseEuro: accepte virgule, espaces et distingue vide/invalide", () => {
  assert.deepEqual(parseEuro("4210,50"), { ok: true, value: 4210.5 });
  assert.deepEqual(parseEuro("4 210.50"), { ok: true, value: 4210.5 });
  assert.deepEqual(parseEuro("0"), { ok: true, value: 0 });
  assert.deepEqual(parseEuro(""), { ok: false, empty: true });
  assert.deepEqual(parseEuro("   "), { ok: false, empty: true });
  assert.deepEqual(parseEuro("abc"), { ok: false, empty: false });
  assert.deepEqual(parseEuro("-5"), { ok: false, empty: false });
});

test("parseCount: entiers positifs seulement", () => {
  assert.deepEqual(parseCount("320"), { ok: true, value: 320 });
  assert.deepEqual(parseCount(""), { ok: false, empty: true });
  assert.deepEqual(parseCount("3.5"), { ok: false, empty: false });
  assert.deepEqual(parseCount("-1"), { ok: false, empty: false });
});

test("round2 évite les artefacts flottants", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(3508.755), 3508.76);
});

test("isVenueId verrouille les univers autorisés", () => {
  for (const v of CAISSE_VENUES) assert.equal(isVenueId(v), true);
  assert.equal(isVenueId("moon"), false);
});

test("buildCaisseZUpsert: refuse un Z sans aucun CA (état vide honnête, pas de 0€ fantôme)", () => {
  const result = buildCaisseZUpsert(form(), { eventId: null, saisiPar: "manager" });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /au moins un montant/i);
});

test("buildCaisseZUpsert: CA total = somme des familles, écart = paiements − CA", () => {
  const result = buildCaisseZUpsert(
    form({ caBar: "4210,50", caEntrees: "1830", cb: "4890", especes: "1150,50" }),
    { eventId: "evt-1", saisiPar: "manager" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.row.ca_ttc, 6040.5);
  assert.deepEqual(result.row.familles, { bar: 4210.5, entrees: 1830 });
  assert.deepEqual(result.row.paiements, { cb: 4890, especes: 1150.5 });
  assert.equal(result.row.event_id, "evt-1");
  assert.equal(result.row.saisi_par, "manager");
  assert.equal(result.row.source, "manual");
  // (4890 + 1150.50) − 6040.50 = 0 → caisse équilibrée
  assert.equal(result.ecart, 0);
});

test("buildCaisseZUpsert: écart null si aucun paiement saisi", () => {
  const result = buildCaisseZUpsert(form({ caBar: "1000" }), { eventId: null, saisiPar: null });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.ecart, null);
  assert.deepEqual(result.row.paiements, {});
});

test("buildCaisseZUpsert: montant famille invalide est signalé, pas ignoré", () => {
  const result = buildCaisseZUpsert(form({ caBar: "abc" }), { eventId: null, saisiPar: null });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /CA bar/i);
});

test("buildCaisseZUpsert: nb_tickets et offerts optionnels, commentaire vide → null", () => {
  const result = buildCaisseZUpsert(
    form({ caBar: "500", nbTickets: "120", offerts: "45", commentaire: "  " }),
    { eventId: null, saisiPar: "admin" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.row.nb_tickets, 120);
  assert.equal(result.row.offerts_ttc, 45);
  assert.equal(result.row.commentaire, null);
});

test("buildCaisseZUpsert: écart positif = excédent, négatif = manquant", () => {
  const excess = buildCaisseZUpsert(form({ caBar: "1000", cb: "1050" }), { eventId: null, saisiPar: null });
  const missing = buildCaisseZUpsert(form({ caBar: "1000", especes: "950" }), { eventId: null, saisiPar: null });
  assert.equal(excess.ok && excess.ecart, 50);
  assert.equal(missing.ok && missing.ecart, -50);
});

test("paiementsEcart: null si dictionnaire vide", () => {
  assert.equal(paiementsEcart(1000, {}), null);
  assert.equal(paiementsEcart(1000, { cb: 600, especes: 500 }), 100);
});

test("liveTotals suit la saisie en temps réel sans lever d'erreur", () => {
  assert.deepEqual(liveTotals(form({ caBar: "1000", caEntrees: "200", cb: "1300" })), {
    caTtc: 1200,
    paid: 1300,
    ecart: 100,
  });
  assert.deepEqual(liveTotals(form()), { caTtc: 0, paid: 0, ecart: null });
});

test("formFromRecord réhydrate la saisie pour correction (update)", () => {
  const record: CaisseZRecord = {
    id: "z-1",
    exploitation_date: "2026-07-04",
    venue: "eden",
    event_id: "evt-1",
    source: "manual",
    ca_ttc: 6040.5,
    nb_tickets: 120,
    familles: { bar: 4210.5, entrees: 1830 },
    paiements: { cb: 4890, especes: 1150.5 },
    offerts_ttc: 45,
    commentaire: "RAS",
    saisi_par: "manager",
  };
  const rebuilt = formFromRecord(record);
  assert.equal(rebuilt.venue, "eden");
  assert.equal(rebuilt.caBar, "4210.5");
  assert.equal(rebuilt.caVestiaire, "");
  assert.equal(rebuilt.nbTickets, "120");
  assert.equal(rebuilt.offerts, "45");
  assert.equal(rebuilt.commentaire, "RAS");

  // Round-trip : reconstruire la ligne depuis le formulaire réhydraté redonne les mêmes totaux.
  const back = buildCaisseZUpsert(rebuilt, { eventId: "evt-1", saisiPar: "manager" });
  assert.equal(back.ok, true);
  if (back.ok) assert.equal(back.row.ca_ttc, 6040.5);
});

const CATALOGUE: ProduitBar[] = [
  { id: "1", categorie: "Vodka & Tequila", nom: "Vodka 37.5°", format: "4cl", prix_vente: 10, prix_achat: null, stock: null, seuil_alerte: null, fournisseur: null, actif: true },
  { id: "2", categorie: "Vodka & Tequila", nom: "Vodka 37.5°", format: "70cl", prix_vente: 90, prix_achat: null, stock: null, seuil_alerte: null, fournisseur: null, actif: true },
  { id: "3", categorie: "Softs & Bière", nom: "Coca-Cola", format: null, prix_vente: 5, prix_achat: null, stock: null, seuil_alerte: null, fournisseur: null, actif: true },
];

test("groupProduitsByCategorie préserve l'ordre d'apparition du seed", () => {
  const groups = groupProduitsByCategorie(CATALOGUE);
  assert.deepEqual(groups.map((g) => g.categorie), ["Vodka & Tequila", "Softs & Bière"]);
  assert.equal(groups[0].produits.length, 2);
});

test("catalogueDataReady dit honnêtement combien de produits ont coût/stock (0 tant que rien fourni)", () => {
  assert.deepEqual(catalogueDataReady(CATALOGUE), { total: 3, withCost: 0, withStock: 0 });
});
