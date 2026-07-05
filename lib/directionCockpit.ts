// lib/directionCockpit.ts — logique PURE du cockpit DIRECTION (agrégat décisionnel). 100% testable.
// AUCUNE table propre (D-01) : le View lit les sources existantes (déjà filtrées par leur RLS) + réutilise
// les summaries des modules ; ce fichier ne fait que l'ASSEMBLAGE de haut niveau + l'honnêteté de complétude.

export type Frequentation = { entrees: number; sorties: number; present: number };
export function frequentation(entryLogs: { type: string }[]): Frequentation {
  const entrees = entryLogs.filter((e) => e.type === "entry").length;
  const sorties = entryLogs.filter((e) => e.type === "exit").length;
  return { entrees, sorties, present: Math.max(0, entrees - sorties) };
}

// Marge = CA − coûts CONNUS. Toujours marquée `estimation` : tant que tous les postes (JDC, personnel
// réel…) ne sont pas connectés, ce n'est PAS un résultat comptable (D-02, honnêteté §finance).
export type MarginEstimate = { caCents: number; coutsConnusCents: number; margeCents: number; estimation: true };
export function estimatedMargin(caCents: number, knownCostsCents: number): MarginEstimate {
  return { caCents, coutsConnusCents: knownCostsCents, margeCents: caCents - knownCostsCents, estimation: true };
}

export type AlertLevel = "critique" | "attention" | "ok";
export function globalAlertLevel(a: {
  incidentsCritiques: number;
  stockRuptures: number;
  maintenanceUrgente: number;
}): AlertLevel {
  if (a.incidentsCritiques > 0 || a.maintenanceUrgente > 0) return "critique";
  if (a.stockRuptures > 0) return "attention";
  return "ok";
}

export type PendingDecision = { label: string; count: number };
export function pendingDecisions(x: {
  resaPending: number;
  leadsNouveaux: number;
  campaignsBrouillon: number;
}): PendingDecision[] {
  const out: PendingDecision[] = [];
  if (x.resaPending > 0) out.push({ label: "Demandes de réservation à décider", count: x.resaPending });
  if (x.leadsNouveaux > 0) out.push({ label: "Leads commerciaux à qualifier", count: x.leadsNouveaux });
  if (x.campaignsBrouillon > 0) out.push({ label: "Campagnes en brouillon", count: x.campaignsBrouillon });
  return out;
}

export function formatEuro(cents: number | null | undefined): string {
  if (cents == null) return "NON RENSEIGNÉ";
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
