// lib/auditJournal.ts — logique PURE du JOURNAL D'AUDIT global (module 0.5 du plan maître, Socle).
// Aucun accès réseau, aucune horloge (new Date()/Date.now() interdits — tout vient des entrées).
//
// 0.5 est l'AuditLog de la direction : « qui / quoi / quand, réversible » (CLUB_ONE_OS_MASTER §0,
// ligne « Journal d'audit global »). Il n'a PAS de table à lui dans ce module : il REÇOIT des
// événements d'audit DÉJÀ produits et DÉJÀ filtrés par la RLS (future table `audit_log`), et se
// contente de les classer, filtrer, trier et agréger pour un écran de pilotage direction.
//
// Règles dures (honnêteté), héritées de la gouvernance Club One :
//   · AUCUN événement fabriqué. Tant qu'aucune source d'audit réelle n'est branchée, le journal est
//     VIDE (aucune ligne inventée). Un « 0 » honnête, jamais une activité simulée.
//   · AUCUNE DÉDUCTION. La réversibilité (`reversible`) et l'annulation (`revertedAt`) VIENNENT de
//     l'événement enregistré — jamais devinées d'après l'action. Une action hors catalogue RBAC est
//     classée « non_classe » avec son libellé brut, jamais réinterprétée.
//   · L'ANNULATION est un GESTE HUMAIN à fort risque. Ce module ne révoque RIEN : `markReverted` est
//     un miroir d'UI immuable (comme applyArrival de resaBoard) ; l'autorité reste une future RPC
//     SECURITY DEFINER + la RLS. La garde de rôle est un confort d'UI, PAS une sécurité.

import type { StaffRole } from "./permissions.ts";
import type { Venue } from "./venueTables.ts";

// ————————————————————————————————————————————————————————————————
// Catalogue d'actions — miroir EXACT de la matrice RBAC action.ressource (CLUB_ONE_OS_MASTER §0.2)
// ————————————————————————————————————————————————————————————————
export const AUDIT_ACTIONS = [
  "reservation.create",
  "table.assign",
  "entry.increment",
  "incident.sensitive.read",
  "content.publish",
  "campaign.launch",
  "analytics.financial.read",
  "user.manage",
  "settings.manage",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(v: unknown): v is AuditAction {
  return typeof v === "string" && (AUDIT_ACTIONS as readonly string[]).includes(v);
}

// ————————————————————————————————————————————————————————————————
// Catégories — regroupent les actions pour la surveillance direction.
//   operation      — exploitation de la soirée (résa, tables, entrées)
//   sensible       — lecture de données protégées (incidents sensibles, finances)
//   administration — publication, campagnes, comptes, réglages
//   non_classe     — action hors catalogue RBAC : jamais réinterprétée
// ————————————————————————————————————————————————————————————————
export const AUDIT_CATEGORIES = ["operation", "sensible", "administration", "non_classe"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

const ACTION_CATEGORY: Record<AuditAction, Exclude<AuditCategory, "non_classe">> = {
  "reservation.create": "operation",
  "table.assign": "operation",
  "entry.increment": "operation",
  "incident.sensitive.read": "sensible",
  "analytics.financial.read": "sensible",
  "content.publish": "administration",
  "campaign.launch": "administration",
  "user.manage": "administration",
  "settings.manage": "administration",
};

// Une action inconnue retombe honnêtement sur « non_classe » — jamais devinée.
export function resolveCategory(action: string): AuditCategory {
  return isAuditAction(action) ? ACTION_CATEGORY[action] : "non_classe";
}

const ACTION_LABELS: Record<AuditAction, string> = {
  "reservation.create": "Réservation créée",
  "table.assign": "Table attribuée",
  "entry.increment": "Entrée comptée",
  "incident.sensitive.read": "Incident sensible consulté",
  "content.publish": "Contenu publié",
  "campaign.launch": "Campagne lancée",
  "analytics.financial.read": "Données financières consultées",
  "user.manage": "Compte modifié",
  "settings.manage": "Réglage modifié",
};

// Libellé FR d'une action ; une action hors catalogue rend sa clé brute (aucune invention).
export function actionLabel(action: string): string {
  return isAuditAction(action) ? ACTION_LABELS[action] : action;
}

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  operation: "Exploitation",
  sensible: "Données sensibles",
  administration: "Administration",
  non_classe: "Non classé",
};

export function categoryLabel(category: AuditCategory): string {
  return CATEGORY_LABELS[category];
}

// Style d'affichage self-contained (hex) — aucune dépendance Tailwind dans la lib.
export type CategoryStyle = { label: string; stroke: string; text: string };

export const CATEGORY_STYLE: Record<AuditCategory, CategoryStyle> = {
  operation: { label: "Exploitation", stroke: "#38bdf8", text: "#bae6fd" },
  sensible: { label: "Données sensibles", stroke: "#f87171", text: "#fecaca" },
  administration: { label: "Administration", stroke: "#c084fc", text: "#e9d5ff" },
  non_classe: { label: "Non classé", stroke: "#94a3b8", text: "#e2e8f0" },
};

// ————————————————————————————————————————————————————————————————
// Garde de rôle — 0.5 = écran DIRECTION (CLUB_ONE_OS_MASTER §3.1 « 0.5 … Direction »)
// ————————————————————————————————————————————————————————————————
//
// Le journal d'audit expose « qui a fait quoi » sur toute la plateforme : réservé au palier direction
// (admin + manager), le même périmètre qui ouvre déjà le centre de commandement (B1). Les employés de
// soirée et le promoteur ne l'ouvrent jamais. Ce n'est PAS une sécurité (ce module ne lit aucune table
// propre) : la RLS de la future `audit_log` reste l'autorité ; ce prédicat reflète le périmètre côté UI.
export function canViewAuditJournal(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

// Déclenche l'annulation d'une action auditée : geste à fort risque réservé à l'admin (la direction
// stricte). Le manager consulte le journal mais n'annule pas. Réglable par le fondateur. Rappel : ce
// module n'annule RIEN — l'autorité reste une future RPC SECURITY DEFINER + la RLS.
export function canRevertAuditEvent(role: StaffRole | null | undefined): boolean {
  return role === "admin";
}

// ————————————————————————————————————————————————————————————————
// Événement d'audit — vient d'une source déjà filtrée par la RLS ; ce module ne le fabrique jamais.
// ————————————————————————————————————————————————————————————————
export type AuditEventRow = {
  id: string;
  at: string; // horodatage ISO 8601 — fourni par le serveur, JAMAIS fabriqué ici
  actor: string; // qui — identifiant du staff auteur de l'action
  actorRole: StaffRole | null; // rôle au moment de l'action (peut manquer → null honnête)
  action: string; // quoi — clé RBAC (hors catalogue → classée « non_classe », libellé brut conservé)
  targetLabel: string | null; // sur quoi — id/libellé de l'objet (peut manquer → null)
  venue: Venue | null; // établissement concerné (null = transverse / non renseigné)
  reversible: boolean; // l'action PEUT être annulée — vient du log, jamais deviné
  revertedAt: string | null; // déjà annulée ? ISO de l'annulation, sinon null
};

// Filtre optionnel — chaque critère absent ⇒ non filtrant.
export type AuditFilter = {
  action?: AuditAction | null;
  category?: AuditCategory | null;
  actor?: string | null;
  venue?: Venue | null;
  onlyReversible?: boolean; // ne garder que les actions annulables
  onlyReverted?: boolean; // ne garder que les actions déjà annulées
};

function isFilterActive(f: AuditFilter | undefined): boolean {
  if (!f) return false;
  return (
    f.action != null ||
    f.category != null ||
    f.actor != null ||
    f.venue != null ||
    f.onlyReversible === true ||
    f.onlyReverted === true
  );
}

// ————————————————————————————————————————————————————————————————
// Ligne enrichie de la vue
// ————————————————————————————————————————————————————————————————
export type AuditJournalRow = {
  event: AuditEventRow;
  category: AuditCategory;
  actionLabel: string;
  reverted: boolean; // = revertedAt effectif (event + overlay) non nul
  revertedAt: string | null; // annulation effective (overlay prioritaire sur l'événement)
};

// Résout l'annulation effective : un overlay d'UI (annulation en cours, pas encore persistée) prime sur
// l'événement enregistré. Aucune déduction : sans overlay ni champ, l'action n'est pas annulée.
function resolveRevertedAt(
  event: AuditEventRow,
  overlay: Readonly<Record<string, string>>,
): string | null {
  const pending = overlay[event.id];
  return pending ?? event.revertedAt;
}

// ————————————————————————————————————————————————————————————————
// Tri — le plus récent d'abord (at décroissant), départage stable par id (aucune entropie).
// ————————————————————————————————————————————————————————————————
function compareRows(a: AuditJournalRow, b: AuditJournalRow): number {
  if (a.event.at !== b.event.at) {
    // ISO → comparaison lexicographique = chronologique ; on inverse pour le plus récent d'abord.
    return a.event.at < b.event.at ? 1 : -1;
  }
  return a.event.id < b.event.id ? 1 : a.event.id > b.event.id ? -1 : 0;
}

export function sortForJournal(rows: readonly AuditJournalRow[]): AuditJournalRow[] {
  return [...rows].sort(compareRows);
}

// ————————————————————————————————————————————————————————————————
// Synthèse
// ————————————————————————————————————————————————————————————————
export type AuditActionCount = { action: string; label: string; count: number };

export type AuditJournalSummary = {
  total: number; // nb d'événements retenus (après filtre)
  byCategory: Record<AuditCategory, number>;
  byAction: AuditActionCount[]; // trié count décroissant, puis libellé
  reversibleCount: number; // actions annulables non encore annulées
  revertedCount: number; // actions déjà annulées
  sensitiveCount: number; // actions de catégorie « sensible » (surveillance directe direction)
  distinctActors: number; // nb d'auteurs distincts
};

export type AuditJournalView = {
  canView: boolean;
  canRevert: boolean;
  rows: AuditJournalRow[]; // filtrées + triées (plus récent d'abord) ; vide si aucun événement
  summary: AuditJournalSummary;
  filtered: boolean; // un filtre est actif
  totalBeforeFilter: number; // nb d'événements avant filtre (honnêteté : « X sur Y »)
};

function matchesFilter(row: AuditJournalRow, f: AuditFilter | undefined): boolean {
  if (!f) return true;
  if (f.action != null && row.event.action !== f.action) return false;
  if (f.category != null && row.category !== f.category) return false;
  if (f.actor != null && row.event.actor !== f.actor) return false;
  if (f.venue != null && row.event.venue !== f.venue) return false;
  if (f.onlyReversible === true && (!row.event.reversible || row.reverted)) return false;
  if (f.onlyReverted === true && !row.reverted) return false;
  return true;
}

export function buildAuditJournal(input: {
  role: StaffRole | null | undefined;
  events: readonly AuditEventRow[];
  filter?: AuditFilter;
  reverted?: Record<string, string>; // overlay d'annulations d'UI (id → ISO), non persistées
}): AuditJournalView {
  const canView = canViewAuditJournal(input.role);
  const canRevert = canRevertAuditEvent(input.role);
  const overlay = input.reverted ?? {};

  // Enrichissement (aucune source d'entropie) : catégorie + libellé + annulation effective.
  const enriched: AuditJournalRow[] = input.events.map((event) => {
    const revertedAt = resolveRevertedAt(event, overlay);
    return {
      event,
      category: resolveCategory(event.action),
      actionLabel: actionLabel(event.action),
      reverted: revertedAt !== null,
      revertedAt,
    };
  });

  const filter = input.filter;
  const kept = enriched.filter((row) => matchesFilter(row, filter));
  const sorted = sortForJournal(kept);

  const byCategory: Record<AuditCategory, number> = {
    operation: 0,
    sensible: 0,
    administration: 0,
    non_classe: 0,
  };
  const actionCounts = new Map<string, { label: string; count: number }>();
  const actors = new Set<string>();
  let reversibleCount = 0;
  let revertedCount = 0;

  for (const row of sorted) {
    byCategory[row.category] += 1;
    actors.add(row.event.actor);
    if (row.reverted) revertedCount += 1;
    else if (row.event.reversible) reversibleCount += 1;

    const prev = actionCounts.get(row.event.action);
    if (prev) prev.count += 1;
    else actionCounts.set(row.event.action, { label: row.actionLabel, count: 1 });
  }

  const byAction: AuditActionCount[] = [...actionCounts.entries()]
    .map(([action, v]) => ({ action, label: v.label, count: v.count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label, "fr")));

  return {
    canView,
    canRevert,
    rows: sorted,
    summary: {
      total: sorted.length,
      byCategory,
      byAction,
      reversibleCount,
      revertedCount,
      sensitiveCount: byCategory.sensible,
      distinctActors: actors.size,
    },
    filtered: isFilterActive(filter),
    totalBeforeFilter: enriched.length,
  };
}

// Marque une annulation d'audit de façon IMMUABLE (nouvelle map, aucune mutation). Miroir d'UI d'une
// future RPC d'annulation : l'AUTORITÉ reste le SQL (RLS direction + SECURITY DEFINER). L'appelant
// fournit l'horodatage (pureté : aucune horloge ici). Re-marquer le même id écrase la valeur.
export function markReverted(
  reverted: Readonly<Record<string, string>>,
  id: string,
  at: string,
): Record<string, string> {
  return { ...reverted, [id]: at };
}
