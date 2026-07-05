// lib/maintenance.ts — logique métier PURE du module Maintenance (0046).
// Aucun accès réseau/DB : validation, tri, agrégat, formatage. 100% testable (tests/maintenance.test.mts).
// Source de vérité : tables equipment + maintenance_interventions (0046). Pilotage DIRECTION (admin/manager).

import type { StaffRole } from "./permissions.ts";

export const EQUIPMENT_STATUSES = ["ok", "a_surveiller", "panne", "hs", "en_maintenance"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_CATEGORIES = ["son", "lumiere", "froid", "bar", "securite", "batiment", "general"] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const INTERVENTION_KINDS = ["panne", "reparation", "preventif", "controle"] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const INTERVENTION_PRIORITIES = ["basse", "normale", "haute", "urgente"] as const;
export type InterventionPriority = (typeof INTERVENTION_PRIORITIES)[number];

export const INTERVENTION_STATUSES = ["ouvert", "en_cours", "resolu", "annule"] as const;
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number];

export type Equipment = {
  id: string;
  name: string;
  category: string;
  location?: string | null;
  venue?: string | null;
  status: string;
  notes?: string | null;
};

export type MaintenanceIntervention = {
  id: string;
  equipment_id: string;
  kind: string;
  priority: string;
  status: string;
  description?: string | null;
  reported_by?: string | null;
  assigned_to?: string | null;
  provider?: string | null;
  cost_cents?: number | null;
  due_date?: string | null;
  event_id?: string | null;
  opened_at?: string | null;
  resolved_at?: string | null;
};

// Seuls admin/manager pilotent la maintenance (aligné RLS 0046). Le staff opérationnel la CONSULTE.
export function canManageMaintenance(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}
export function canViewMaintenance(role: StaffRole): boolean {
  return role !== "promoter"; // staff opérationnel ; promoteur hors périmètre (RLS le confirme)
}

export function isOpenIntervention(i: MaintenanceIntervention): boolean {
  return i.status === "ouvert" || i.status === "en_cours";
}

const PRIORITY_RANK: Record<string, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 };
const STATUS_LABELS: Record<string, string> = {
  ok: "OK", a_surveiller: "À surveiller", panne: "En panne", hs: "Hors service", en_maintenance: "En maintenance",
  ouvert: "Ouvert", en_cours: "En cours", resolu: "Résolu", annule: "Annulé",
};
export function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s;
}

// Validation d'un brouillon d'intervention (miroir des gardes serveur ; ne remplace pas la RLS).
export function validateInterventionDraft(draft: {
  equipment_id?: string | null;
  kind?: string | null;
  priority?: string | null;
  cost_cents?: number | null;
}): { ok: boolean; message: string } {
  if (!draft.equipment_id || !draft.equipment_id.trim()) {
    return { ok: false, message: "Équipement requis." };
  }
  if (draft.kind && !INTERVENTION_KINDS.includes(draft.kind as InterventionKind)) {
    return { ok: false, message: "Type d'intervention inconnu." };
  }
  if (draft.priority && !INTERVENTION_PRIORITIES.includes(draft.priority as InterventionPriority)) {
    return { ok: false, message: "Priorité inconnue." };
  }
  if (draft.cost_cents != null && (!Number.isFinite(draft.cost_cents) || draft.cost_cents < 0)) {
    return { ok: false, message: "Coût invalide." };
  }
  return { ok: true, message: "" };
}

// Tri : interventions ouvertes d'abord, par priorité (urgente→basse), puis les plus anciennes ouvertes.
export function sortInterventions(list: MaintenanceIntervention[]): MaintenanceIntervention[] {
  return [...list].sort((a, b) => {
    const ao = isOpenIntervention(a) ? 0 : 1;
    const bo = isOpenIntervention(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const ap = PRIORITY_RANK[a.priority] ?? 9;
    const bp = PRIORITY_RANK[b.priority] ?? 9;
    if (ap !== bp) return ap - bp;
    return (a.opened_at ?? "").localeCompare(b.opened_at ?? "");
  });
}

export type MaintenanceSummary = {
  parcTotal: number;
  enPanne: number;
  horsService: number;
  interventionsOuvertes: number;
  urgentes: number;
  coutOuvertCents: number;
};

// Agrégat pour le cockpit (honnête : coût = somme des coûts RENSEIGNÉS des interventions ouvertes).
export function maintenanceSummary(
  equipment: Equipment[],
  interventions: MaintenanceIntervention[],
): MaintenanceSummary {
  const open = interventions.filter(isOpenIntervention);
  return {
    parcTotal: equipment.length,
    enPanne: equipment.filter((e) => e.status === "panne").length,
    horsService: equipment.filter((e) => e.status === "hs").length,
    interventionsOuvertes: open.length,
    urgentes: open.filter((i) => i.priority === "urgente").length,
    coutOuvertCents: open.reduce((sum, i) => sum + (i.cost_cents ?? 0), 0),
  };
}

export function formatCostEuro(cents: number | null | undefined): string {
  if (cents == null) return "—"; // honnêteté : coût non renseigné, jamais 0 € inventé
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
