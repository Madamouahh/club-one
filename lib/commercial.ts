// lib/commercial.ts — logique métier PURE du module Commercial / privatisations (0049). 100% testable.
// Pipeline de leads commerciaux (groupes, anniversaires, privatisations, entreprises) + devis.
// AUCUN paiement / signature réel : les devis sont des DOCUMENTS de suivi (PRÊT À CONNECTER — NON ACTIVÉ).

import type { StaffRole } from "./permissions.ts";

export const LEAD_KINDS = ["groupe", "anniversaire", "privatisation", "entreprise", "autre"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export const LEAD_STATUSES = ["nouveau", "qualifie", "devis", "gagne", "perdu"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const QUOTE_STATUSES = ["option", "envoye", "accepte", "refuse"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export type CommercialLead = {
  id: string;
  contact_name: string;
  company?: string | null;
  kind: string;
  status: string;
  phone?: string | null;
  email?: string | null;
  party_size?: number | null;
  event_date_wanted?: string | null;
  estimated_value_cents?: number | null;
  source?: string | null;
  owner_username?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

export type CommercialQuote = {
  id: string;
  lead_id: string;
  label: string;
  amount_cents: number;
  status: string;
  valid_until?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

// Données commerciales sensibles : lecture + écriture direction UNIQUEMENT (pas promoter/server).
export function canManageCommercial(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}
export function canViewCommercial(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

export function validateLeadDraft(d: {
  contact_name?: string | null;
  kind?: string | null;
  status?: string | null;
  party_size?: number | null;
  estimated_value_cents?: number | null;
}): { ok: boolean; message: string } {
  if (!d.contact_name || !d.contact_name.trim()) return { ok: false, message: "Nom du contact requis." };
  if (d.kind && !LEAD_KINDS.includes(d.kind as LeadKind)) return { ok: false, message: "Type de demande inconnu." };
  if (d.status && !LEAD_STATUSES.includes(d.status as LeadStatus)) return { ok: false, message: "Statut inconnu." };
  if (d.party_size != null && (!Number.isFinite(d.party_size) || d.party_size < 0))
    return { ok: false, message: "Nombre de personnes invalide." };
  if (d.estimated_value_cents != null && (!Number.isFinite(d.estimated_value_cents) || d.estimated_value_cents < 0))
    return { ok: false, message: "Valeur estimée invalide." };
  return { ok: true, message: "" };
}

export function validateQuoteDraft(d: {
  lead_id?: string | null;
  label?: string | null;
  amount_cents?: number | null;
  status?: string | null;
}): { ok: boolean; message: string } {
  if (!d.lead_id || !d.lead_id.trim()) return { ok: false, message: "Lead requis." };
  if (!d.label || !d.label.trim()) return { ok: false, message: "Libellé du devis requis." };
  if (d.amount_cents == null || !Number.isFinite(d.amount_cents) || d.amount_cents <= 0)
    return { ok: false, message: "Montant invalide." };
  if (d.status && !QUOTE_STATUSES.includes(d.status as QuoteStatus)) return { ok: false, message: "Statut de devis inconnu." };
  return { ok: true, message: "" };
}

export type PipelineSummary = {
  parStatut: Record<LeadStatus, number>;
  total: number;
  // Valeur pondérée HONNÊTE : valeur estimée des leads GAGNÉS (certaine) + ceux avec un devis en OPTION
  // (probable). On ne gonfle pas avec les statuts amont ni les valeurs manquantes.
  valeurPondereeCents: number;
};

export function pipelineSummary(leads: CommercialLead[], quotes: CommercialQuote[]): PipelineSummary {
  const parStatut: Record<LeadStatus, number> = { nouveau: 0, qualifie: 0, devis: 0, gagne: 0, perdu: 0 };
  for (const l of leads) {
    if ((LEAD_STATUSES as readonly string[]).includes(l.status)) parStatut[l.status as LeadStatus] += 1;
  }
  const leadsWithOption = new Set(
    quotes.filter((q) => q.status === "option").map((q) => q.lead_id),
  );
  const valeurPondereeCents = leads.reduce((s, l) => {
    const v = l.estimated_value_cents;
    if (v == null || !Number.isFinite(v) || v < 0) return s;
    if (l.status === "gagne") return s + v;
    if (leadsWithOption.has(l.id) && l.status !== "perdu") return s + v;
    return s;
  }, 0);
  return { parStatut, total: leads.length, valeurPondereeCents };
}

// Taux de conversion honnête : gagnés / (gagnés + perdus). Les leads encore en cours ne comptent pas
// (ni au numérateur ni au dénominateur) — on ne mesure que les affaires TRANCHÉES. Null si aucune tranchée.
export function conversionRate(leads: CommercialLead[]): number | null {
  const gagnes = leads.filter((l) => l.status === "gagne").length;
  const perdus = leads.filter((l) => l.status === "perdu").length;
  const closed = gagnes + perdus;
  if (closed === 0) return null;
  return gagnes / closed;
}

export function quotesForLead(leadId: string, quotes: CommercialQuote[]): CommercialQuote[] {
  return quotes.filter((q) => q.lead_id === leadId);
}

export function formatMoneyEuro(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

export function formatRatePct(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)} %`;
}
