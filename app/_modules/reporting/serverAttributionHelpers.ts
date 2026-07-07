// app/_modules/reporting/serverAttributionHelpers.ts — logique PURE de l'attribution serveur↔table
// (migration 0060, table table_server_assignments). 100% testable, aucun accès réseau.
//
// Le jeu de serveurs ASSIGNABLES est role-authoritative : dérivé du ROSTER (staff_roster_v1), SEULS les
// usernames de rôle `server` sont assignables — plus aucun nom en dur, plus aucune heuristique. Une
// attribution vers un username qui n'est PAS serveur au roster est incohérente et signalée.
//
// La contrainte UNIQUE(event_id, table_id) en base interdit qu'une table soit attribuée à deux serveurs.
// Ces helpers reflètent la même règle côté UI (détection de conflit, action create/update/noop) mais la
// base reste l'autorité : ces fonctions ne remplacent JAMAIS la contrainte SQL.

import type { StaffRosterEntry, ServerTableAssignment } from "@/lib/serverReports";

// Normalise un identifiant : chaîne non vide (trim), sinon null (jamais de clé « vide »).
export function cleanId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// Ensemble des usernames de rôle EXACTEMENT `server` au roster (autorité de rôle, fail-closed).
// Trié (fr), sans doublon : c'est la liste des serveurs sélectionnables dans l'UI.
export function assignableServers(roster: StaffRosterEntry[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const entry of roster || []) {
    const username = cleanId(entry?.username);
    if (username && entry?.role === "server") set.add(username);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

// Un username donné est-il assignable (serveur au roster) ? Fail-closed : inconnu → false.
export function isAssignableServer(
  roster: StaffRosterEntry[] | null | undefined,
  username: string | null | undefined,
): boolean {
  const clean = cleanId(username);
  if (!clean) return false;
  return assignableServers(roster).includes(clean);
}

// Map table_id → server_username. Une table ne peut avoir qu'un serveur (contrainte UNIQUE) ; en cas
// d'état incohérent en base (doublon), la DERNIÈRE valeur lue l'emporte pour l'affichage — les conflits
// sont exposés séparément par detectConflicts().
export function buildAssignmentMap(
  assignments: ServerTableAssignment[] | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of assignments || []) {
    const tableId = cleanId(a?.table_id);
    const server = cleanId(a?.server_username);
    if (!tableId || !server) continue;
    map.set(tableId, server);
  }
  return map;
}

// Serveur attribué à une table (ou null si non attribuée / entrée illisible).
export function serverForTable(
  assignments: ServerTableAssignment[] | null | undefined,
  tableId: string | null | undefined,
): string | null {
  const id = cleanId(tableId);
  if (!id) return null;
  return buildAssignmentMap(assignments).get(id) ?? null;
}

// table_ids en état INCOHÉRENT : une même table attribuée à PLUS D'UN serveur distinct (double
// attribution). Ne devrait jamais arriver grâce à la contrainte UNIQUE ; sert de garde d'affichage.
// Retourne la liste triée, sans doublon.
export function detectConflicts(
  assignments: ServerTableAssignment[] | null | undefined,
): string[] {
  const serversByTable = new Map<string, Set<string>>();
  for (const a of assignments || []) {
    const tableId = cleanId(a?.table_id);
    const server = cleanId(a?.server_username);
    if (!tableId || !server) continue;
    const prev = serversByTable.get(tableId) || new Set<string>();
    prev.add(server);
    serversByTable.set(tableId, prev);
  }
  const conflicts: string[] = [];
  for (const [tableId, servers] of serversByTable) {
    if (servers.size > 1) conflicts.push(tableId);
  }
  return conflicts.sort((a, b) => a.localeCompare(b, "fr"));
}

// Action à réaliser pour attribuer `server` à `tableId`, compte tenu de l'état courant :
//   · "noop"   — la table est déjà attribuée à CE serveur (rien à faire) ;
//   · "update" — la table est attribuée à un AUTRE serveur (changement = upsert on conflict) ;
//   · "create" — la table n'est pas encore attribuée (insert / upsert).
// Sert à afficher la bonne intention (Attribuer vs Changer) ; l'écriture réelle passe TOUJOURS par un
// upsert on (event_id, table_id) côté base, qui absorbe create et update sans double attribution.
export type AssignmentAction = "create" | "update" | "noop";

export function assignmentAction(
  assignments: ServerTableAssignment[] | null | undefined,
  tableId: string | null | undefined,
  server: string | null | undefined,
): AssignmentAction {
  const id = cleanId(tableId);
  const target = cleanId(server);
  if (!id || !target) return "create";
  const current = serverForTable(assignments, id);
  if (current == null) return "create";
  return current === target ? "noop" : "update";
}
