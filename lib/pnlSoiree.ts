// lib/pnlSoiree.ts — logique PURE du P&L par soirée (source-agnostique, aucun accès réseau).
//
// Le P&L croise trois sources DÉJÀ existantes du produit :
//   1. caisse_z (Z de clôture, migration 0010) → le PRODUIT comptable (Club One LIT la caisse,
//      il n'encaisse jamais — loi NF525) ;
//   2. club_tables → le CA des tables saisi en soirée (dépenses tapées par table) ;
//   3. entry_logs → le nombre d'entrées (fréquentation).
//
// Deux CHARGES nourriront le résultat net : le coût staff (RH · pointage B7) et les coûts
// artistes/extras (Événement · booking B2/B3). Aucune des deux n'est encore branchée : elles
// restent HONNÊTEMENT à null (amount=null, wired=false). Le résultat net n'est donc PAS affiché
// comme "définitif" tant que ces briques ne sont pas livrées — on ne fabrique aucun 0 fantôme.
//
// Le moat Club One : le CA par table permet de rapprocher le CA "bar" du Z (vérité comptable) avec
// le CA des tables saisi dans l'appli. L'écart révèle la sous-saisie (dépenses non tapées) — 95 %
// des clubs ne savent pas faire ce rapprochement.

import { round2, type CaisseZRecord } from "./caisseZ.ts";

// ————————————————————————————————————————————————————————————————
// Synthèse caisse (agrège les lignes caisse_z d'une même soirée)
// ————————————————————————————————————————————————————————————————

// Base retenue pour totaliser le CA caisse d'une soirée :
//   - "complexe"    : une ligne globale "complexe" existe → elle fait foi (les lignes par univers
//                     seraient un double comptage) ;
//   - "par-univers" : pas de ligne "complexe" → on somme les lignes eden/cercle/terminus ;
//   - "aucun"       : aucun Z saisi pour cette soirée (état vide honnête).
export type CaisseBasis = "complexe" | "par-univers" | "aucun";

export type CaisseSummary = {
  basis: CaisseBasis;
  caTotal: number; // CA TTC total (0 si aucun Z)
  caBar: number; // famille "bar" (0 si absente)
  caEntrees: number; // famille "entrees"
  caVestiaire: number; // famille "vestiaire"
  offerts: number; // offerts TTC (non-CA, suivi séparé)
  nbTickets: number | null; // somme des tickets si renseignés, sinon null
  venuesCount: number; // nb de lignes retenues (1 si base "complexe")
  available: boolean; // false = aucun Z → tout état aval est honnêtement vide
};

// Agrège les lignes caisse_z d'une soirée. Si une ligne "complexe" (globale) est présente, elle
// prime et les lignes par univers sont ignorées pour ne pas double-compter le même CA.
export function summarizeCaisse(records: CaisseZRecord[]): CaisseSummary {
  const complexe = records.find((r) => r.venue === "complexe");
  const scope = complexe ? [complexe] : records.filter((r) => r.venue !== "complexe");
  const basis: CaisseBasis = complexe ? "complexe" : scope.length ? "par-univers" : "aucun";

  const famille = (key: string) => round2(scope.reduce((sum, r) => sum + (r.familles?.[key] || 0), 0));
  const tickets = scope.map((r) => r.nb_tickets).filter((n): n is number => n != null);

  return {
    basis,
    caTotal: round2(scope.reduce((sum, r) => sum + (r.ca_ttc || 0), 0)),
    caBar: famille("bar"),
    caEntrees: famille("entrees"),
    caVestiaire: famille("vestiaire"),
    offerts: round2(scope.reduce((sum, r) => sum + (r.offerts_ttc || 0), 0)),
    nbTickets: tickets.length ? tickets.reduce((sum, n) => sum + n, 0) : null,
    venuesCount: scope.length,
    available: scope.length > 0,
  };
}

// ————————————————————————————————————————————————————————————————
// Rapprochement moat : CA bar (caisse) vs CA tables (Club One)
// ————————————————————————————————————————————————————————————————

export type TablesReconciliation = {
  caBarCaisse: number | null; // famille "bar" du Z, null si non renseignée
  caTables: number; // CA des tables saisi dans Club One
  ecart: number | null; // caBarCaisse − caTables ; >0 = tables sous-saisies
  tauxSaisie: number | null; // caTables / caBarCaisse ∈ [0..] ; couverture de la saisie table
};

// Rapproche le CA "bar" du Z (comptable) et le CA des tables saisi en soirée. En principe
// caTables ≤ caBarCaisse (le bar comptable inclut aussi le comptoir hors table) : un écart positif
// mesure ce qui n'a pas été tapé par table. null si la caisse n'a pas de famille "bar" (rien à
// rapprocher — on n'invente pas de base).
export function reconcileTables(caisse: CaisseSummary, caTables: number): TablesReconciliation {
  const caBar = caisse.caBar > 0 ? caisse.caBar : null;
  const tables = round2(Math.max(caTables, 0));
  return {
    caBarCaisse: caBar,
    caTables: tables,
    ecart: caBar == null ? null : round2(caBar - tables),
    tauxSaisie: caBar == null ? null : round2(tables / caBar),
  };
}

// ————————————————————————————————————————————————————————————————
// Charges (non encore branchées — états honnêtes)
// ————————————————————————————————————————————————————————————————

export type PnlChargeKey = "staff" | "artistes";

export type PnlCharge = {
  key: PnlChargeKey;
  label: string;
  amount: number | null; // null = source non branchée (aucun montant inventé)
  source: string; // brique qui fournira le chiffre
  wired: boolean; // true seulement quand la brique alimente réellement ce montant
};

// Charges du P&L par soirée, baseline « aucun producteur branché » : staff (B7) et artistes (B2/B3)
// restent à null tant qu'aucune brique ne les alimente. C'est l'état par défaut ; buildPnlSoiree
// remplace la charge staff dès que le producteur RH (lib/rhPlanning) lui passe un montant.
export function pendingCharges(): PnlCharge[] {
  return [
    {
      key: "staff",
      label: "Coût staff (masse horaire)",
      amount: null,
      source: "RH · pointage (B7) — non branché",
      wired: false,
    },
    {
      key: "artistes",
      label: "Coûts artistes & extras",
      amount: null,
      source: "Événement · booking (B2/B3) — non branché",
      wired: false,
    },
  ];
}

// Branche le producteur RH (lib/rhPlanning · staffChargeAmount) sur la charge « staff ». Le
// producteur est considéré BRANCHÉ dès qu'une valeur est fournie (même null) : le code chemine
// réellement du pointage vers le P&L. Le montant reste honnêtement null tant que la masse horaire
// n'est pas COMPLÈTE (un présent sans taux/heures) — on ne branche jamais un coût partiel.
function applyStaffCharge(charges: PnlCharge[], staffCharge: number | null): PnlCharge[] {
  return charges.map((c) =>
    c.key === "staff"
      ? { ...c, amount: staffCharge, source: "RH · pointage (B7)", wired: true }
      : c,
  );
}

// Branche le producteur artistes/extras (lib/artistesExtras · artistesChargeAmount) sur la charge
// « artistes ». Même discipline que le coût staff : BRANCHÉ dès qu'une valeur est fournie (même
// null) ; montant honnêtement null tant qu'un poste engagé n'est pas chiffré — jamais de coût partiel.
function applyArtistesCharge(charges: PnlCharge[], artistesCharge: number | null): PnlCharge[] {
  return charges.map((c) =>
    c.key === "artistes"
      ? { ...c, amount: artistesCharge, source: "Événement · booking (B2/B3)", wired: true }
      : c,
  );
}

// ————————————————————————————————————————————————————————————————
// P&L par soirée (assemblage)
// ————————————————————————————————————————————————————————————————

export type PnlInput = {
  exploitationDate: string;
  caisseRecords: CaisseZRecord[];
  caTables: number; // CA live des tables (stats.revenue de page.tsx)
  entries: number; // nb d'entrées (entry_logs type "entry")
  // Coût staff issu du producteur RH (rhPlanning · staffChargeAmount). undefined = producteur RH
  // absent (baseline non branchée) ; null = producteur branché mais coût non complet (aucun taux/
  // pointage) ; number = coût staff complet de la soirée. On ne fabrique jamais ce montant ici.
  staffCharge?: number | null;
  // Coût artistes/extras issu du producteur booking (artistesExtras · artistesChargeAmount). Même
  // convention : undefined = non branché ; null = branché mais coût incomplet (un engagé sans
  // montant) ; number = coût artistes complet de la soirée. Jamais fabriqué ici.
  artistesCharge?: number | null;
};

export type PnlSoiree = {
  exploitationDate: string;
  caisse: CaisseSummary;
  reconciliation: TablesReconciliation;
  entries: number;
  produitTotal: number; // CA caisse (comptable) ; 0 si aucun Z
  charges: PnlCharge[];
  chargesConnues: number; // somme des charges réellement branchées (0 aujourd'hui)
  chargesEnAttente: PnlCharge[]; // charges non branchées (honnêteté du P&L)
  margeApresChargesConnues: number | null; // produit − chargesConnues ; null si aucun Z
  resultatNetComplet: boolean; // true seulement quand PLUS aucune charge en attente
  panierParEntree: number | null; // produitTotal / entries ; null si donnée manquante
};

export function buildPnlSoiree(input: PnlInput): PnlSoiree {
  const caisse = summarizeCaisse(input.caisseRecords);
  let charges = pendingCharges();
  if (input.staffCharge !== undefined) charges = applyStaffCharge(charges, input.staffCharge);
  if (input.artistesCharge !== undefined) charges = applyArtistesCharge(charges, input.artistesCharge);
  const chargesEnAttente = charges.filter((c) => !c.wired || c.amount == null);
  const chargesConnues = round2(
    charges
      .filter((c) => c.wired && c.amount != null)
      .reduce((sum, c) => sum + (c.amount as number), 0),
  );
  const produitTotal = caisse.caTotal;
  const entries = Math.max(input.entries, 0);

  return {
    exploitationDate: input.exploitationDate,
    caisse,
    reconciliation: reconcileTables(caisse, input.caTables),
    entries,
    produitTotal,
    charges,
    chargesConnues,
    chargesEnAttente,
    margeApresChargesConnues: caisse.available ? round2(produitTotal - chargesConnues) : null,
    resultatNetComplet: chargesEnAttente.length === 0,
    panierParEntree: caisse.available && entries > 0 ? round2(produitTotal / entries) : null,
  };
}
