"use client";

// app/carte-manager-preview/page.tsx — ROUTE D'APERÇU ISOLÉE : GESTION DE CARTE back-office.
//
// Demande fondateur (2026-07-03) : un écran direction/manager MOBILE-FIRST pour piloter la carte —
//   (1) rendre un produit INDISPONIBLE / redisponible en 1 tap (rupture en pleine soirée) ;
//   (2) CRÉER un produit rapidement (nom, catégorie, format, prix, univers) ;
//   (3) MODIFIER prix / catégorie / format ; recherche + filtre par univers/catégorie.
// RLS write = admin/manager uniquement (migration 0010) — la garde reste côté base, pas cet écran.
//
// Périmètre volontairement étroit et SÛR (même discipline que les autres bancs -preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les toggles/créations/éditions mutent un BROUILLON LOCAL
//     en mémoire, jamais en base. La persistance réelle (update produits_bar) est un chunk séparé ;
//   · AUCUNE donnée inventée : les produits ci-dessous sont un EXTRAIT RÉEL de la carte (0032 côté
//     eden, 0010 côté terminus). Seuls les états de disponibilité affichés sont des EXEMPLES pour
//     démontrer le toggle — en production ils viennent de la colonne `disponible`.
//
// Cibles fondateur mobile-first : utilisable à une main (~390px), cibles tactiles ≥44px, tap→action,
// pas de hover-only. Ambiance Club One nuit + or (identique aux autres écrans équipes).

import { useMemo, useState } from "react";

import type { ProduitBar, ProductVenue } from "@/lib/caisseZ";
import { PRODUCT_VENUE_LABELS, formatEuro } from "@/lib/caisseZ";
import {
  type CarteFilter,
  type ProductDraft,
  carteStats,
  categoriesForVenue,
  draftFromProduit,
  emptyProductDraft,
  filterCatalogue,
  findDoublon,
  toggleDisponiblePatch,
  validateProductDraft,
} from "@/lib/cardManager";

// EXTRAIT RÉEL de la carte (prix/formats transcrits du PDF fondateur → CARTE_EDEN_2026.md pour eden ;
// 0010 pour terminus). Les `disponible=false` sont des EXEMPLES de rupture pour la démonstration.
const EXTRAIT_REEL: ProduitBar[] = [
  mk("e01", "eden", "Cuisine", "Planche de fromages", null, 22),
  mk("e02", "eden", "Cuisine", "Panini trois fromages", null, 7),
  mk("e03", "eden", "Apéritifs", "Spritz Apérol", "12cl", 9),
  mk("e04", "eden", "Apéritifs", "Gin Tonic", "15cl", 10),
  mk("e05", "eden", "Cocktails", "Mojito (fraise/passion/framboise)", null, 13, { disponible: false }),
  mk("e06", "eden", "Cocktails", "Long Island", null, 15),
  mk("e07", "eden", "Vodka & Tequila", "Tequila Volcan Blanco 40°", "4cl", 13, { a_verifier: true }),
  mk("e08", "eden", "Vodka & Tequila", "Tequila Don Julio 1942", "70cl", 390, { a_verifier: true }),
  mk("e09", "eden", "Rhum & Gin", "Gin Bombay Sapphire", "70cl", 130, { a_verifier: true }),
  mk("e10", "eden", "Champagnes & Grands Crus", "Champagne Moët & Chandon", "70cl", 80),
  mk("e11", "eden", "Champagnes & Grands Crus", "Champagne Dom Pérignon brut", "70cl", 390),
  mk("e12", "eden", "Bières", "Bière blonde 5° (pression)", "25cl", 5, { disponible: false }),
  mk("e13", "eden", "Bières", "Corona 0 (bouteille)", "33cl", 7),
  mk("e14", "eden", "Sans alcool", "Virgin Mojito (fraise/passion/framboise/mangue)", null, 8),
  mk("e15", "eden", "Boissons chaudes", "Espresso", null, 2.2),
  // Terminus (club) — mêmes produits, prix DIFFÉRENTS = les 2 cartes coexistent (normal).
  mk("t01", "terminus", "Vins & Champagnes", "Champagne Moët & Chandon", "75cl", 120),
  mk("t02", "terminus", "Vodka & Tequila", "Vodka Belvedere 40°", "70cl", 150),
];

function mk(
  id: string,
  venue: ProductVenue,
  categorie: string,
  nom: string,
  format: string | null,
  prix_vente: number,
  over: Partial<ProduitBar> = {},
): ProduitBar {
  return {
    id,
    venue,
    categorie,
    nom,
    format,
    prix_vente,
    prix_achat: null,
    stock: null,
    seuil_alerte: null,
    fournisseur: null,
    actif: true,
    disponible: true,
    a_verifier: false,
    ...over,
  };
}

const GOLD = "#d9b46a";

export default function CarteManagerPreviewPage() {
  const [produits, setProduits] = useState<ProduitBar[]>(EXTRAIT_REEL);
  const [venue, setVenue] = useState<ProductVenue | "all">("eden");
  const [categorie, setCategorie] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [onlyIndispo, setOnlyIndispo] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: ProductDraft } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const stats = useMemo(() => carteStats(produits), [produits]);
  const cats = useMemo(() => categoriesForVenue(produits, venue), [produits, venue]);
  const visibles = useMemo(() => {
    const filter: CarteFilter = { venue, categorie, query, onlyIndisponibles: onlyIndispo };
    return filterCatalogue(produits, filter);
  }, [produits, venue, categorie, query, onlyIndispo]);

  function onToggle(p: ProduitBar) {
    const patch = toggleDisponiblePatch(p);
    setProduits((prev) => prev.map((x) => (x.id === patch.id ? { ...x, disponible: patch.disponible } : x)));
  }

  function openCreate() {
    const v: ProductVenue = venue === "all" ? "eden" : venue;
    setEditing({ id: null, draft: emptyProductDraft(v) });
    setFormError(null);
  }

  function openEdit(p: ProduitBar) {
    setEditing({ id: p.id, draft: draftFromProduit(p) });
    setFormError(null);
  }

  function saveDraft() {
    if (!editing) return;
    const res = validateProductDraft(editing.draft);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    const dup = findDoublon(produits, res.payload, editing.id ?? undefined);
    if (dup) {
      setFormError(`Doublon : « ${dup.nom} ${dup.format ?? ""} » existe déjà dans ${PRODUCT_VENUE_LABELS[res.payload.venue]}.`);
      return;
    }
    if (editing.id) {
      setProduits((prev) =>
        prev.map((x) => (x.id === editing.id ? { ...x, ...res.payload } : x)),
      );
    } else {
      setProduits((prev) => [
        { ...mk(`new-${prev.length + 1}`, res.payload.venue, res.payload.categorie, res.payload.nom, res.payload.format, res.payload.prix_vente) },
        ...prev,
      ]);
    }
    setEditing(null);
    setFormError(null);
  }

  return (
    <main style={{ maxWidth: 430, margin: "0 auto", minHeight: "100vh", background: "#0b0b0f", color: "#ece7db", fontFamily: "system-ui, sans-serif", padding: "16px 14px 60px" }}>
      <header style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: GOLD }}>Club One · Back-office</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "2px 0 4px" }}>Gestion de la carte</h1>
        <p style={{ fontSize: 12, color: "#9a948a", margin: 0 }}>
          Aperçu isolé — brouillon local, aucune écriture en base. Extrait RÉEL de la carte (eden 0032 / terminus 0010).
          Écriture réelle réservée à admin/manager (RLS).
        </p>
      </header>

      {/* Bandeau stats honnête */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Stat label="Produits" value={stats.total} />
        <Stat label="Disponibles" value={stats.disponibles} tone="#5bbf7a" />
        <Stat label="Ruptures" value={stats.indisponibles} tone="#e0894a" />
        <Stat label="À vérifier" value={stats.aVerifier} tone={GOLD} />
      </div>

      {/* Filtres */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher un produit…"
        style={{ width: "100%", minHeight: 44, boxSizing: "border-box", padding: "0 14px", borderRadius: 12, border: "1px solid #2a2a33", background: "#15151c", color: "#ece7db", fontSize: 15, marginBottom: 10 }}
      />
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <select value={venue} onChange={(e) => { setVenue(e.target.value as ProductVenue | "all"); setCategorie("all"); }} style={selectStyle}>
          <option value="all">Tous univers</option>
          <option value="eden">Eden (rooftop)</option>
          <option value="terminus">Terminus (club)</option>
          <option value="commun">Commun</option>
        </select>
        <select value={categorie} onChange={(e) => setCategorie(e.target.value)} style={selectStyle}>
          <option value="all">Toutes catégories</option>
          {cats.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 14, marginBottom: 6 }}>
        <input type="checkbox" checked={onlyIndispo} onChange={(e) => setOnlyIndispo(e.target.checked)} style={{ width: 20, height: 20 }} />
        Voir uniquement les ruptures en cours
      </label>

      <button onClick={openCreate} style={{ width: "100%", minHeight: 48, borderRadius: 12, border: `1px solid ${GOLD}`, background: "transparent", color: GOLD, fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
        + Créer un produit
      </button>

      {/* Liste */}
      <div style={{ fontSize: 11, color: "#6f6a60", marginBottom: 8 }}>{visibles.length} produit(s) affiché(s)</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {visibles.map((p) => {
          const dispo = p.disponible !== false;
          return (
            <li key={p.id} style={{ border: "1px solid #23232c", borderRadius: 14, background: dispo ? "#14141b" : "#1a1410", padding: "10px 12px", opacity: dispo ? 1 : 0.72 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <button onClick={() => openEdit(p)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", color: "inherit", padding: 0, cursor: "pointer" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>
                    {p.nom} {p.a_verifier && <span title="mapping à confirmer" style={{ color: GOLD, fontSize: 12 }}>⚠</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#8f8a80", marginTop: 2 }}>
                    {PRODUCT_VENUE_LABELS[p.venue ?? "terminus"]} · {p.categorie}{p.format ? ` · ${p.format}` : ""}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: GOLD, marginTop: 4 }}>{formatEuro(p.prix_vente)}</div>
                </button>
                <button
                  onClick={() => onToggle(p)}
                  style={{ minWidth: 96, minHeight: 44, borderRadius: 10, border: "1px solid", borderColor: dispo ? "#2f5b3d" : "#5b3d2f", background: dispo ? "#14261a" : "#26170f", color: dispo ? "#7fd69a" : "#e0894a", fontSize: 12, fontWeight: 700 }}
                >
                  {dispo ? "Dispo ✓" : "Rupture"}
                </button>
              </div>
            </li>
          );
        })}
        {visibles.length === 0 && (
          <li style={{ color: "#6f6a60", fontSize: 13, textAlign: "center", padding: 20 }}>Aucun produit pour ce filtre.</li>
        )}
      </ul>

      {/* Éditeur / créateur (bottom sheet simplifiée) */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: "#111118", borderTop: `2px solid ${GOLD}`, borderRadius: "18px 18px 0 0", padding: "18px 16px 26px", maxHeight: "88vh", overflowY: "auto" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 12px" }}>{editing.id ? "Modifier le produit" : "Nouveau produit"}</h2>
            <Field label="Nom">
              <input value={editing.draft.nom} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, nom: e.target.value } })} style={inputStyle} />
            </Field>
            <Field label="Catégorie">
              <input value={editing.draft.categorie} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, categorie: e.target.value } })} style={inputStyle} />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Format (optionnel)">
                <input value={editing.draft.format} placeholder="4cl, 70cl…" onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, format: e.target.value } })} style={inputStyle} />
              </Field>
              <Field label="Prix (€)">
                <input value={editing.draft.prixVente} inputMode="decimal" placeholder="12,50" onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, prixVente: e.target.value } })} style={inputStyle} />
              </Field>
            </div>
            <Field label="Univers (carte)">
              <select value={editing.draft.venue} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, venue: e.target.value } })} style={{ ...inputStyle, minHeight: 44 }}>
                <option value="eden">Eden (rooftop)</option>
                <option value="terminus">Terminus (club)</option>
                <option value="commun">Commun (2 cartes)</option>
              </select>
            </Field>
            {formError && <div style={{ color: "#e0894a", fontSize: 13, margin: "6px 0 2px" }}>{formError}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => setEditing(null)} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: "1px solid #2a2a33", background: "transparent", color: "#ccc5b8", fontSize: 15 }}>Annuler</button>
              <button onClick={saveDraft} style={{ flex: 2, minHeight: 48, borderRadius: 12, border: "none", background: GOLD, color: "#1a1408", fontSize: 15, fontWeight: 800 }}>{editing.id ? "Enregistrer" : "Créer"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const selectStyle: React.CSSProperties = { flex: 1, minHeight: 44, borderRadius: 10, border: "1px solid #2a2a33", background: "#15151c", color: "#ece7db", fontSize: 13, padding: "0 8px" };
const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 44, borderRadius: 10, border: "1px solid #2a2a33", background: "#15151c", color: "#ece7db", fontSize: 15, padding: "0 12px" };

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ flex: "1 1 68px", border: "1px solid #23232c", borderRadius: 10, padding: "6px 8px", background: "#121219" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: tone ?? "#ece7db" }}>{value}</div>
      <div style={{ fontSize: 10, color: "#8f8a80", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", flex: 1, marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "#9a948a", marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}
