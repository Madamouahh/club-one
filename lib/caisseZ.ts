// lib/caisseZ.ts — logique PURE du module Caisse / Z de clôture (source-agnostique).
// Club One LIT le Z de caisse, il n'ENCAISSE jamais (loi anti-fraude NF525). Ce module ne fait
// AUCUN accès réseau : il valide/normalise la saisie manuelle du manager et prépare la ligne
// `caisse_z` (migration 0010). L'accès Supabase reste dans app/page.tsx (comme fetchEntryLogs).
// Tous les états vides sont HONNÊTES : rien n'est inventé, prix d'achat/stock restent NULL tant
// que le fondateur n'a pas fourni facture + inventaire.

export const CAISSE_VENUES = ["eden", "cercle", "terminus", "complexe"] as const;
export type VenueId = (typeof CAISSE_VENUES)[number];

export const VENUE_LABELS: Record<VenueId, string> = {
  eden: "Eden",
  cercle: "Le Cercle",
  terminus: "Terminus",
  complexe: "Complexe (global)",
};

export function isVenueId(value: string): value is VenueId {
  return (CAISSE_VENUES as readonly string[]).includes(value);
}

// Catalogue produits bar (seed réel 0010). prix_achat / stock à NULL = en attente des vrais chiffres.
export type ProduitBar = {
  id: string;
  categorie: string;
  nom: string;
  format: string | null;
  prix_vente: number;
  prix_achat: number | null;
  stock: number | null;
  seuil_alerte: number | null;
  fournisseur: string | null;
  actif: boolean;
};

// Ligne caisse_z telle qu'insérée/mise à jour (upsert sur (exploitation_date, venue)).
export type CaisseZRow = {
  exploitation_date: string;
  venue: VenueId;
  event_id: string | null;
  source: "manual";
  ca_ttc: number;
  nb_tickets: number | null;
  familles: Record<string, number>;
  paiements: Record<string, number>;
  offerts_ttc: number;
  commentaire: string | null;
  saisi_par: string | null;
};

// Ligne caisse_z telle que relue depuis la base (peut contenir un import auto plus tard).
export type CaisseZRecord = CaisseZRow & {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CaisseZFormValues = {
  exploitationDate: string;
  venue: VenueId;
  caBar: string;
  caEntrees: string;
  caVestiaire: string;
  cb: string;
  especes: string;
  nbTickets: string;
  offerts: string;
  commentaire: string;
};

export function emptyCaisseZForm(exploitationDate: string, venue: VenueId = "complexe"): CaisseZFormValues {
  return {
    exploitationDate,
    venue,
    caBar: "",
    caEntrees: "",
    caVestiaire: "",
    cb: "",
    especes: "",
    nbTickets: "",
    offerts: "",
    commentaire: "",
  };
}

// Pré-remplit le formulaire depuis un Z existant (relecture) — permet la correction (update).
export function formFromRecord(record: CaisseZRecord): CaisseFormFromRecord {
  const familles = record.familles || {};
  const paiements = record.paiements || {};
  return {
    exploitationDate: record.exploitation_date,
    venue: record.venue,
    caBar: numToField(familles.bar),
    caEntrees: numToField(familles.entrees),
    caVestiaire: numToField(familles.vestiaire),
    cb: numToField(paiements.cb),
    especes: numToField(paiements.especes),
    nbTickets: record.nb_tickets == null ? "" : String(record.nb_tickets),
    offerts: record.offerts_ttc ? numToField(record.offerts_ttc) : "",
    commentaire: record.commentaire || "",
  };
}
type CaisseFormFromRecord = CaisseZFormValues;

function numToField(value: number | undefined): string {
  if (value == null || value === 0) return "";
  return String(value);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type EuroParse =
  | { ok: true; value: number }
  | { ok: false; empty: true }
  | { ok: false; empty: false };

// Accepte "4210,50", "4 210.50", "" (vide). Refuse texte non numérique et valeurs négatives.
export function parseEuro(raw: string): EuroParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, empty: true };
  const cleaned = trimmed.replace(/\s/g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return { ok: false, empty: false };
  return { ok: true, value: round2(value) };
}

export type CountParse =
  | { ok: true; value: number }
  | { ok: false; empty: true }
  | { ok: false; empty: false };

export function parseCount(raw: string): CountParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, empty: true };
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return { ok: false, empty: false };
  return { ok: true, value };
}

export type BuildCaisseZResult =
  | { ok: true; row: CaisseZRow; ecart: number | null }
  | { ok: false; message: string };

// Construit la ligne caisse_z depuis la saisie manuelle. Le CA total TTC est la SOMME des familles
// (aucune double saisie d'un total séparé). L'écart de caisse = (CB + espèces) − CA total : c'est
// le rapprochement qui révèle un manquant/excédent. Retourne ecart=null si aucun paiement saisi.
export function buildCaisseZUpsert(
  form: CaisseZFormValues,
  context: { eventId: string | null; saisiPar: string | null },
): BuildCaisseZResult {
  if (!form.exploitationDate.trim()) {
    return { ok: false, message: "Date de soirée manquante." };
  }
  if (!isVenueId(form.venue)) {
    return { ok: false, message: "Univers invalide." };
  }

  const familles: Record<string, number> = {};
  const familyFields: [keyof CaisseZFormValues, string, string][] = [
    ["caBar", "bar", "CA bar"],
    ["caEntrees", "entrees", "CA entrées"],
    ["caVestiaire", "vestiaire", "Vestiaire"],
  ];
  for (const [field, key, label] of familyFields) {
    const parsed = parseEuro(form[field]);
    if (parsed.ok) {
      if (parsed.value > 0) familles[key] = parsed.value;
    } else if (!parsed.empty) {
      return { ok: false, message: `Montant « ${label} » invalide.` };
    }
  }

  const caTtc = round2(Object.values(familles).reduce((sum, v) => sum + v, 0));
  if (caTtc <= 0) {
    return { ok: false, message: "Saisir au moins un montant de CA (bar ou entrées)." };
  }

  const paiements: Record<string, number> = {};
  const paymentFields: [keyof CaisseZFormValues, string, string][] = [
    ["cb", "cb", "CB"],
    ["especes", "especes", "Espèces"],
  ];
  for (const [field, key, label] of paymentFields) {
    const parsed = parseEuro(form[field]);
    if (parsed.ok) {
      if (parsed.value > 0) paiements[key] = parsed.value;
    } else if (!parsed.empty) {
      return { ok: false, message: `Montant « ${label} » invalide.` };
    }
  }

  let nbTickets: number | null = null;
  const ticketsParsed = parseCount(form.nbTickets);
  if (ticketsParsed.ok) {
    nbTickets = ticketsParsed.value;
  } else if (!ticketsParsed.empty) {
    return { ok: false, message: "Nombre de tickets invalide." };
  }

  let offerts = 0;
  const offertsParsed = parseEuro(form.offerts);
  if (offertsParsed.ok) {
    offerts = offertsParsed.value;
  } else if (!offertsParsed.empty) {
    return { ok: false, message: "Montant « Offerts » invalide." };
  }

  const commentaire = form.commentaire.trim() || null;
  const ecart = paiementsEcart(caTtc, paiements);

  return {
    ok: true,
    ecart,
    row: {
      exploitation_date: form.exploitationDate,
      venue: form.venue,
      event_id: context.eventId,
      source: "manual",
      ca_ttc: caTtc,
      nb_tickets: nbTickets,
      familles,
      paiements,
      offerts_ttc: offerts,
      commentaire,
      saisi_par: context.saisiPar,
    },
  };
}

// Écart de rapprochement caisse : (CB + espèces) − CA total TTC. null si aucun paiement renseigné.
export function paiementsEcart(caTtc: number, paiements: Record<string, number>): number | null {
  const keys = Object.keys(paiements);
  if (keys.length === 0) return null;
  const paid = keys.reduce((sum, k) => sum + (paiements[k] || 0), 0);
  return round2(paid - caTtc);
}

// Total live du formulaire (affichage temps réel avant enregistrement), sans validation stricte.
export function liveTotals(form: CaisseZFormValues): { caTtc: number; paid: number; ecart: number | null } {
  const fam = ["caBar", "caEntrees", "caVestiaire"] as const;
  const pay = ["cb", "especes"] as const;
  const caTtc = round2(fam.reduce((sum, f) => {
    const p = parseEuro(form[f]);
    return sum + (p.ok ? p.value : 0);
  }, 0));
  let anyPaid = false;
  const paid = round2(pay.reduce((sum, f) => {
    const p = parseEuro(form[f]);
    if (p.ok) anyPaid = true;
    return sum + (p.ok ? p.value : 0);
  }, 0));
  return { caTtc, paid, ecart: anyPaid ? round2(paid - caTtc) : null };
}

export function formatEuro(value: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

// Regroupe le catalogue par catégorie en préservant l'ordre d'apparition (ordre du seed).
export function groupProduitsByCategorie(produits: ProduitBar[]): { categorie: string; produits: ProduitBar[] }[] {
  const order: string[] = [];
  const map = new Map<string, ProduitBar[]>();
  for (const p of produits) {
    if (!map.has(p.categorie)) {
      map.set(p.categorie, []);
      order.push(p.categorie);
    }
    map.get(p.categorie)!.push(p);
  }
  return order.map((categorie) => ({ categorie, produits: map.get(categorie)! }));
}

// Vrai seulement si le fondateur a fourni prix d'achat ET stock : sinon marge/valorisation indisponibles.
export function catalogueDataReady(produits: ProduitBar[]): { withCost: number; withStock: number; total: number } {
  return {
    total: produits.length,
    withCost: produits.filter((p) => p.prix_achat != null).length,
    withStock: produits.filter((p) => p.stock != null).length,
  };
}
