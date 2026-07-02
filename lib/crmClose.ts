// lib/crmClose.ts — logique PURE du RÈGLEMENT DES PRÉSENCES À LA CLÔTURE (spec MODULE_CRM_CLIENTS_VIP.md §V0).
// Aucun accès réseau. MIROIR côté TypeScript de l'ajout de la migration 0016 à close_club_event_v2 :
// quand la soirée se clôture, une invitation qui n'a JAMAIS été scannée à la porte devient un no-show,
// et le pass d'entrée resté « issued » (jamais présenté) devient « expired » (l'événement est archivé,
// ce QR ne pourra plus jamais être validé). Le vrai enforcement est ATOMIQUE en SQL, dans la RPC de
// clôture ; ces fonctions ne servent qu'à documenter la règle et à empêcher toute dérive SQL/TS.
//
// Règle dure : on ne fabrique aucune présence. Un « seated » constaté au scan RESTE seated ; un
// « cancelled » (désinscription) RESTE cancelled. Seuls les états ENCORE EN ATTENTE de présence
// (« booked » = inscrit, « confirmed » = confirmé J-1) basculent en no-show. Le no-show alimente
// le taux de no-show du scoring (vue guest_scores : no_shows_total / visits_resolved_total).

// ————————————————————————————————————————————————————————————————
// Statuts d'une visite (guest_visits.status, CHECK de la migration 0013).
// ————————————————————————————————————————————————————————————————
export type VisitStatus = "booked" | "confirmed" | "seated" | "no_show" | "cancelled";

// Les états « en attente de présence » au moment de la clôture : personne inscrite/confirmée qui
// n'a PAS été vue à la porte. Ce sont EXACTEMENT ceux que 0016 fait basculer en no_show.
export const VISIT_STATUSES_PENDING_AT_CLOSE = ["booked", "confirmed"] as const;

// ————————————————————————————————————————————————————————————————
// Résolution du statut d'une visite à la clôture de la soirée.
// ————————————————————————————————————————————————————————————————
// Miroir exact du UPDATE de 0016 :
//   update guest_visits set status='no_show'
//    where event_id = <soirée close> and status in ('booked','confirmed');
// Tout autre statut (seated présent, no_show déjà résolu, cancelled) est laissé INCHANGÉ :
// on ne réécrit jamais une présence constatée ni une désinscription.
export function resolveVisitStatusAtClose(status: VisitStatus): VisitStatus {
  return (VISIT_STATUSES_PENDING_AT_CLOSE as readonly string[]).includes(status)
    ? "no_show"
    : status;
}

// ————————————————————————————————————————————————————————————————
// Statuts d'un pass d'entrée (guest_passes.status, CHECK de la migration 0014).
// ————————————————————————————————————————————————————————————————
export type PassStatus = "issued" | "scanned" | "expired" | "cancelled";

// Résolution du statut d'un pass à la clôture. Un pass resté « issued » (délivré mais jamais scanné)
// devient « expired » : la soirée est archivée, le scan à la porte (0015) refuserait de toute façon
// ce QR (garde wrong_event). Un pass « scanned » (présence faite), « expired » ou « cancelled » reste
// INCHANGÉ. Miroir du 2ᵉ UPDATE de 0016 (nettoyage de cohérence, aucune donnée fabriquée).
export function resolvePassStatusAtClose(status: PassStatus): PassStatus {
  return status === "issued" ? "expired" : status;
}
