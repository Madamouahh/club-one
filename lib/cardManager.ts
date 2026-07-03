// lib/cardManager.ts — logique PURE de la GESTION DE CARTE back-office (demande fondateur 2026-07-03).
// Écran direction/manager MOBILE-FIRST pour piloter le catalogue produits_bar (migration 0032) :
//   1) rendre un produit INDISPONIBLE / redisponible en 1 tap (rupture en pleine soirée) — c'est
//      le champ `disponible`, DISTINCT de `actif` (actif=false = retiré de la carte pour de bon) ;
//   2) CRÉER un produit rapidement (nom, catégorie, format, prix, univers) ;
//   3) MODIFIER prix / catégorie / format d'un produit existant ;
//   4) rechercher + filtrer par univers et catégorie.
//
// Ce module ne fait AUCUN accès réseau : il valide/normalise la saisie et prépare les payloads
// insert/update. L'écriture Supabase (RLS write = admin/manager uniquement, cf. 0010) reste dans
// app/page.tsx / la route serveur. Rien n'est inventé : la logique s'applique au catalogue réel.

import type { ProduitBar, ProductVenue } from "./caisseZ.ts";
import { isProductVenue, round2 } from "./caisseZ.ts";

// ----------------------------------------------------------------------------
// Disponibilité effective : un produit n'est proposable (saisie, resa, mini-espace) que s'il est
// À LA FOIS actif (sur la carte) ET disponible (pas en rupture). `disponible` absent = true (défaut DB).
// ----------------------------------------------------------------------------
export function isProduitProposable(p: ProduitBar): boolean {
  return p.actif && p.disponible !== false;
}

// Ce que les écrans de CONSOMMATION (saisie ticket, réservation, mini-espace client) doivent afficher :
// les produits retirés (actif=false) disparaissent ; les indisponibles restent listables mais grisés.
export type CarteConsommableEntry = { produit: ProduitBar; grise: boolean };

export function carteConsommable(produits: ProduitBar[]): CarteConsommableEntry[] {
  return produits
    .filter((p) => p.actif) // retiré de la carte = absent partout
    .map((p) => ({ produit: p, grise: p.disponible === false }));
}

// ----------------------------------------------------------------------------
// Filtre / recherche du back-office (mobile : un champ de recherche + 2 selects + 1 switch).
// ----------------------------------------------------------------------------
export type CarteFilter = {
  venue?: ProductVenue | "all";
  categorie?: string | "all";
  query?: string;
  onlyIndisponibles?: boolean; // vue « ruptures en cours »
  includeInactifs?: boolean; // par défaut on masque les produits retirés
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // insensible aux accents
}

export function filterCatalogue(produits: ProduitBar[], filter: CarteFilter): ProduitBar[] {
  const q = filter.query ? norm(filter.query.trim()) : "";
  return produits.filter((p) => {
    if (!filter.includeInactifs && !p.actif) return false;
    if (filter.venue && filter.venue !== "all" && p.venue !== filter.venue) return false;
    if (filter.categorie && filter.categorie !== "all" && p.categorie !== filter.categorie) return false;
    if (filter.onlyIndisponibles && p.disponible !== false) return false;
    if (q) {
      const hay = norm(`${p.nom} ${p.format ?? ""} ${p.categorie}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Liste ordonnée des catégories présentes pour un univers (alimente le select de filtre / création).
export function categoriesForVenue(produits: ProduitBar[], venue: ProductVenue | "all"): string[] {
  const set = new Set<string>();
  for (const p of produits) {
    if (venue !== "all" && p.venue !== venue) continue;
    set.add(p.categorie);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

// ----------------------------------------------------------------------------
// Toggle disponibilité (1 tap). Retourne le patch minimal à écrire (update ciblé sur l'id).
// ----------------------------------------------------------------------------
export type DisponiblePatch = { id: string; disponible: boolean };

export function toggleDisponiblePatch(p: ProduitBar): DisponiblePatch {
  return { id: p.id, disponible: !(p.disponible !== false) };
}

// ----------------------------------------------------------------------------
// Création / modification d'un produit. Saisie brute (champs texte du formulaire mobile) → payload
// validé. Le prix accepte « 12,50 » ou « 12.50 ». Format vide → NULL (produit sans format, ex. planche).
// ----------------------------------------------------------------------------
export type ProductDraft = {
  nom: string;
  categorie: string;
  format: string; // vide = null
  prixVente: string; // « 12,50 »
  venue: string; // eden / terminus / commun
};

export function emptyProductDraft(venue: ProductVenue = "eden"): ProductDraft {
  return { nom: "", categorie: "", format: "", prixVente: "", venue };
}

export function draftFromProduit(p: ProduitBar): ProductDraft {
  return {
    nom: p.nom,
    categorie: p.categorie,
    format: p.format ?? "",
    prixVente: p.prix_vente.toString().replace(".", ","),
    venue: p.venue ?? "terminus",
  };
}

// Payload d'écriture (colonnes produits_bar). prix_achat/stock NON gérés ici (restent à l'inventaire).
export type ProductWritePayload = {
  nom: string;
  categorie: string;
  format: string | null;
  prix_vente: number;
  venue: ProductVenue;
};

export type ValidateProductResult =
  | { ok: true; payload: ProductWritePayload }
  | { ok: false; errors: Partial<Record<keyof ProductDraft, string>>; message: string };

const MAX_PRIX = 100000; // garde-fou saisie (une bouteille prestige plafonne bien en-dessous)

export function validateProductDraft(draft: ProductDraft): ValidateProductResult {
  const errors: Partial<Record<keyof ProductDraft, string>> = {};

  const nom = draft.nom.trim();
  if (nom.length < 2) errors.nom = "Nom trop court (2 caractères min).";
  if (nom.length > 200) errors.nom = "Nom trop long.";

  const categorie = draft.categorie.trim();
  if (categorie.length < 2) errors.categorie = "Catégorie requise.";

  const format = draft.format.trim();
  const formatValue = format === "" ? null : format;
  if (format.length > 40) errors.format = "Format trop long.";

  if (!isProductVenue(draft.venue)) {
    errors.venue = "Univers invalide.";
  }

  let prix_vente = 0;
  const rawPrix = draft.prixVente.trim().replace(/\s/g, "").replace(",", ".");
  if (rawPrix === "") {
    errors.prixVente = "Prix requis.";
  } else {
    const n = Number(rawPrix);
    if (!Number.isFinite(n) || n < 0) {
      errors.prixVente = "Prix invalide.";
    } else if (n > MAX_PRIX) {
      errors.prixVente = "Prix hors limite.";
    } else {
      prix_vente = round2(n);
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: "Corrige les champs signalés." };
  }

  return {
    ok: true,
    payload: {
      nom,
      categorie,
      format: formatValue,
      prix_vente,
      venue: draft.venue as ProductVenue,
    },
  };
}

// Détecte un doublon (même univers + même nom + même format) AVANT écriture — l'unicité DB
// (produits_bar_venue_nom_format_key, 0032) est la source de vérité, mais un contrôle côté UI
// évite un aller-retour et donne un message clair. `excludeId` = le produit en cours d'édition.
export function findDoublon(
  produits: ProduitBar[],
  payload: ProductWritePayload,
  excludeId?: string,
): ProduitBar | null {
  const key = (nom: string, format: string | null, venue: ProductVenue | undefined) =>
    `${venue ?? "terminus"}|${norm(nom)}|${norm(format ?? "")}`;
  const target = key(payload.nom, payload.format, payload.venue);
  return (
    produits.find((p) => p.id !== excludeId && key(p.nom, p.format, p.venue) === target) ?? null
  );
}

// Comptage honnête pour l'en-tête de l'écran (ne masque rien).
export type CarteStats = {
  total: number;
  disponibles: number;
  indisponibles: number;
  inactifs: number;
  aVerifier: number;
};

export function carteStats(produits: ProduitBar[]): CarteStats {
  let disponibles = 0;
  let indisponibles = 0;
  let inactifs = 0;
  let aVerifier = 0;
  for (const p of produits) {
    if (!p.actif) inactifs += 1;
    else if (p.disponible === false) indisponibles += 1;
    else disponibles += 1;
    if (p.a_verifier) aVerifier += 1;
  }
  return { total: produits.length, disponibles, indisponibles, inactifs, aVerifier };
}
