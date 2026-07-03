// tests/cardManager.test.mts — logique PURE de gestion de carte back-office (lib/cardManager.ts).
// Niveau de preuve : 2 (validation locale Node). Ne prouve PAS l'écriture RLS réelle en base.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProduitBar } from "../lib/caisseZ.ts";
import {
  isProduitProposable,
  carteConsommable,
  filterCatalogue,
  categoriesForVenue,
  toggleDisponiblePatch,
  validateProductDraft,
  emptyProductDraft,
  draftFromProduit,
  findDoublon,
  carteStats,
} from "../lib/cardManager.ts";

function p(over: Partial<ProduitBar> & { id: string; nom: string }): ProduitBar {
  return {
    categorie: "Apéritifs",
    format: null,
    prix_vente: 10,
    prix_achat: null,
    stock: null,
    seuil_alerte: null,
    fournisseur: null,
    actif: true,
    venue: "eden",
    disponible: true,
    a_verifier: false,
    ...over,
  };
}

const CATALOGUE: ProduitBar[] = [
  p({ id: "1", nom: "Spritz Apérol", categorie: "Apéritifs", format: "12cl", prix_vente: 9, venue: "eden" }),
  p({ id: "2", nom: "Tequila Don Julio 1942", categorie: "Vodka & Tequila", format: "70cl", prix_vente: 390, venue: "eden", a_verifier: true }),
  p({ id: "3", nom: "Mojito", categorie: "Cocktails", format: null, prix_vente: 13, venue: "eden", disponible: false }), // rupture
  p({ id: "4", nom: "Champagne Moët & Chandon", categorie: "Vins & Champagnes", format: "75cl", prix_vente: 120, venue: "terminus" }),
  p({ id: "5", nom: "Produit retiré", categorie: "Divers", format: null, prix_vente: 5, venue: "eden", actif: false }),
];

// ----------------------------------------------------------------------------
test("isProduitProposable : proposable seulement si actif ET disponible", () => {
  assert.equal(isProduitProposable(CATALOGUE[0]), true); // actif + dispo
  assert.equal(isProduitProposable(CATALOGUE[2]), false); // rupture
  assert.equal(isProduitProposable(CATALOGUE[4]), false); // retiré
  // disponible absent = true (défaut DB)
  assert.equal(isProduitProposable(p({ id: "x", nom: "X", disponible: undefined })), true);
});

test("carteConsommable : retire les inactifs, grise les indisponibles, garde le reste", () => {
  const c = carteConsommable(CATALOGUE);
  const ids = c.map((e) => e.produit.id);
  assert.deepEqual(ids, ["1", "2", "3", "4"]); // le retiré (5) est absent
  const mojito = c.find((e) => e.produit.id === "3")!;
  assert.equal(mojito.grise, true); // en rupture => grisé mais visible
  assert.equal(c.find((e) => e.produit.id === "1")!.grise, false);
});

// ----------------------------------------------------------------------------
test("filterCatalogue : filtre par univers", () => {
  const eden = filterCatalogue(CATALOGUE, { venue: "eden" });
  assert.deepEqual(eden.map((x) => x.id).sort(), ["1", "2", "3"]); // 5 masqué (inactif), 4 = terminus
  const terminus = filterCatalogue(CATALOGUE, { venue: "terminus" });
  assert.deepEqual(terminus.map((x) => x.id), ["4"]);
});

test("filterCatalogue : recherche insensible aux accents et à la casse", () => {
  assert.deepEqual(filterCatalogue(CATALOGUE, { query: "aperol" }).map((x) => x.id), ["1"]);
  assert.deepEqual(filterCatalogue(CATALOGUE, { query: "MOET" }).map((x) => x.id), ["4"]);
  assert.deepEqual(filterCatalogue(CATALOGUE, { query: "don julio" }).map((x) => x.id), ["2"]);
});

test("filterCatalogue : onlyIndisponibles = vue ruptures", () => {
  const rupt = filterCatalogue(CATALOGUE, { onlyIndisponibles: true });
  assert.deepEqual(rupt.map((x) => x.id), ["3"]);
});

test("filterCatalogue : includeInactifs révèle les produits retirés", () => {
  assert.equal(filterCatalogue(CATALOGUE, {}).some((x) => x.id === "5"), false);
  assert.equal(filterCatalogue(CATALOGUE, { includeInactifs: true }).some((x) => x.id === "5"), true);
});

test("categoriesForVenue : catégories triées d'un univers", () => {
  assert.deepEqual(categoriesForVenue(CATALOGUE, "eden"), ["Apéritifs", "Cocktails", "Divers", "Vodka & Tequila"]);
  assert.deepEqual(categoriesForVenue(CATALOGUE, "terminus"), ["Vins & Champagnes"]);
});

// ----------------------------------------------------------------------------
test("toggleDisponiblePatch : bascule la disponibilité, patch minimal", () => {
  assert.deepEqual(toggleDisponiblePatch(CATALOGUE[0]), { id: "1", disponible: false }); // dispo -> rupture
  assert.deepEqual(toggleDisponiblePatch(CATALOGUE[2]), { id: "3", disponible: true }); // rupture -> dispo
  // absent = considéré true -> bascule vers false
  assert.deepEqual(toggleDisponiblePatch(p({ id: "z", nom: "Z", disponible: undefined })), { id: "z", disponible: false });
});

// ----------------------------------------------------------------------------
test("validateProductDraft : création valide, prix « 12,50 » accepté, format vide -> null", () => {
  const r = validateProductDraft({ nom: "Nouveau cocktail", categorie: "Cocktails", format: "", prixVente: "12,50", venue: "eden" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.payload, { nom: "Nouveau cocktail", categorie: "Cocktails", format: null, prix_vente: 12.5, venue: "eden" });
  }
});

test("validateProductDraft : rejette nom trop court / prix invalide / univers inconnu", () => {
  const r1 = validateProductDraft({ nom: "X", categorie: "Cocktails", format: "", prixVente: "10", venue: "eden" });
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.ok(r1.errors.nom);

  const r2 = validateProductDraft({ nom: "Valide", categorie: "Cocktails", format: "", prixVente: "abc", venue: "eden" });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.ok(r2.errors.prixVente);

  const r3 = validateProductDraft({ nom: "Valide", categorie: "Cocktails", format: "", prixVente: "10", venue: "mars" });
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.ok(r3.errors.venue);

  const r4 = validateProductDraft({ nom: "Valide", categorie: "", format: "", prixVente: "10", venue: "eden" });
  assert.equal(r4.ok, false);
  if (!r4.ok) assert.ok(r4.errors.categorie);
});

test("validateProductDraft : prix négatif et hors-limite refusés, trim appliqué", () => {
  assert.equal(validateProductDraft({ nom: "A", categorie: "C", format: "", prixVente: "-5", venue: "eden" }).ok, false);
  assert.equal(validateProductDraft({ nom: "A valide", categorie: "Cat", format: "", prixVente: "999999", venue: "eden" }).ok, false);
  const r = validateProductDraft({ nom: "  Café  ", categorie: "  Boissons chaudes ", format: " ", prixVente: " 2,20 ", venue: "eden" });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.payload, { nom: "Café", categorie: "Boissons chaudes", format: null, prix_vente: 2.2, venue: "eden" });
});

test("emptyProductDraft / draftFromProduit : aller-retour cohérent", () => {
  assert.deepEqual(emptyProductDraft("terminus"), { nom: "", categorie: "", format: "", prixVente: "", venue: "terminus" });
  const d = draftFromProduit(CATALOGUE[1]);
  assert.deepEqual(d, { nom: "Tequila Don Julio 1942", categorie: "Vodka & Tequila", format: "70cl", prixVente: "390", venue: "eden" });
});

// ----------------------------------------------------------------------------
test("findDoublon : détecte le même produit/format/univers, ignore l'id édité et l'autre univers", () => {
  // même nom/format existe côté eden (id 1)
  const dup = findDoublon(CATALOGUE, { nom: "spritz apérol", categorie: "X", format: "12cl", prix_vente: 9, venue: "eden" });
  assert.equal(dup?.id, "1");
  // même produit mais univers différent -> pas un doublon (les 2 cartes coexistent)
  assert.equal(findDoublon(CATALOGUE, { nom: "Spritz Apérol", categorie: "X", format: "12cl", prix_vente: 9, venue: "terminus" }), null);
  // en édition de l'id 1 lui-même -> pas de faux doublon
  assert.equal(findDoublon(CATALOGUE, { nom: "Spritz Apérol", categorie: "X", format: "12cl", prix_vente: 9, venue: "eden" }, "1"), null);
});

// ----------------------------------------------------------------------------
test("carteStats : comptage honnête disponibles / ruptures / retirés / à vérifier", () => {
  assert.deepEqual(carteStats(CATALOGUE), { total: 5, disponibles: 3, indisponibles: 1, inactifs: 1, aVerifier: 1 });
});
