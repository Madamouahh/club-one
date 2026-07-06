export const STAFF_ROLES = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
  "promoter",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const APP_TABS = [
  "plan",
  "reservations",
  "clients",
  "security",
  "flux",
  "promoters",
  "stats",
  "caisse",
  "pnl",
  "rh",
  "monplanning",
  "artistes",
  "funnel",
  "crm",
  "incidents",
  "checklist",
  "comms",
  "artistcheckin",
  "maintenance",
  "stock",
  "tasks",
  "suppliers",
  "commercial",
  "marketing",
  "budget",
  "agenda",
  "cockpit",
  "cockpitDirection",
  "admin",
  "apprentissage",
] as const;

export type AppTab = (typeof APP_TABS)[number];

export type PermissionUser = {
  username: string;
  role: StaffRole;
};

export type PermissionTable = {
  assignedTo?: string;
};

export type RolePermissions = {
  canViewAllTables: boolean;
  canEditTables: boolean;
  canAssignTables: boolean;
  canAddExpense: boolean;
  canManagePromoters: boolean;
  canManageInvitations: boolean;
  canCheckInQr: boolean;
  canViewSecurity: boolean;
  canViewFlux: boolean;
  canViewStats: boolean;
  canCloseEvent: boolean;
  canManageGlobal: boolean;
};

export const ROLE_PERMISSIONS: Record<StaffRole, RolePermissions> = {
  admin: {
    canViewAllTables: true,
    canEditTables: true,
    canAssignTables: true,
    canAddExpense: true,
    canManagePromoters: true,
    canManageInvitations: true,
    canCheckInQr: true,
    canViewSecurity: true,
    canViewFlux: true,
    canViewStats: true,
    canCloseEvent: true,
    canManageGlobal: true,
  },
  manager: {
    canViewAllTables: true,
    canEditTables: true,
    canAssignTables: true,
    canAddExpense: true,
    canManagePromoters: true,
    canManageInvitations: true,
    canCheckInQr: true,
    canViewSecurity: true,
    canViewFlux: true,
    canViewStats: true,
    canCloseEvent: true,
    canManageGlobal: true,
  },
  promoter: {
    canViewAllTables: false,
    canEditTables: true,
    canAssignTables: true,
    canAddExpense: true,
    canManagePromoters: true,
    canManageInvitations: true,
    canCheckInQr: false,
    canViewSecurity: false,
    canViewFlux: false,
    canViewStats: false,
    canCloseEvent: false,
    canManageGlobal: false,
  },
  server: {
    canViewAllTables: false,
    canEditTables: true,
    canAssignTables: false,
    canAddExpense: true,
    canManagePromoters: false,
    canManageInvitations: false,
    canCheckInQr: false,
    canViewSecurity: false,
    canViewFlux: false,
    canViewStats: false,
    canCloseEvent: false,
    canManageGlobal: false,
  },
  security: {
    canViewAllTables: false,
    canEditTables: false,
    canAssignTables: false,
    canAddExpense: false,
    canManagePromoters: false,
    canManageInvitations: false,
    canCheckInQr: true,
    canViewSecurity: true,
    canViewFlux: false,
    canViewStats: false,
    canCloseEvent: false,
    canManageGlobal: false,
  },
  security_counter: {
    canViewAllTables: false,
    canEditTables: false,
    canAssignTables: false,
    canAddExpense: false,
    canManagePromoters: false,
    canManageInvitations: false,
    canCheckInQr: true,
    canViewSecurity: false,
    canViewFlux: true,
    canViewStats: false,
    canCloseEvent: false,
    canManageGlobal: false,
  },
};

export function permissionsForRole(role: StaffRole): RolePermissions {
  return ROLE_PERMISSIONS[role];
}

export function initialTabForRole(role: StaffRole): AppTab {
  if (role === "security") return "security";
  if (role === "security_counter") return "flux";
  return "plan";
}

export function visibleTabsForRole(role: StaffRole): AppTab[] {
  // « Mon planning » (RH vue salarié B7) : chaque salarié voit SES créneaux + confirme sa présence
  // en 1 tap. Ouvert à tous les rôles SALARIÉS (la RLS 0011 cantonne à sa propre fiche/ses shifts),
  // SAUF le promoteur (matrice B7 : promoteur ⛔ pour la vue salarié — il n'est pas dans l'effectif).
  // Admin/manager l'ont aussi (matrice : direction 👁 soi) via le fallback [...APP_TABS] ci-dessous.
  // Onglet « Incidents » (module A6, migration 0023) : registre à visibilité RESTREINTE. La matrice A6
  // ouvre l'onglet à direction + sécurité (lecture complète + mutation) et à server/security_counter
  // (signaler + relire SES propres signalements) ; le promoteur et l'artiste n'y ont AUCUN accès (⛔).
  // La RLS 0023 reste l'autorité (aucun accès en base pour promoteur) ; ces listes reflètent la même
  // règle côté UI, cohérence verrouillée par tests/permissions.test.mts (miroir de canAccessIncidents).
  if (role === "security") return ["security", "monplanning", "incidents"];
  if (role === "security_counter") return ["flux", "monplanning", "incidents"];
  if (role === "server") return ["plan", "reservations", "clients", "monplanning", "incidents"];
  // Le promoteur génère ses liens/QR d'invitation (funnel CRM 0014) : onglet cantonné à SES liens (RLS).
  // Il pilote aussi SA call-list du mardi (onglet crm, CRM V1) : cantonné à SES clients par la RLS 0013.
  if (role === "promoter") return ["plan", "reservations", "clients", "promoters", "funnel", "crm"];
  // Direction (admin/manager) : tous les onglets, dont « apprentissage » (boucle d'apprentissage CRM).
  // Cet onglet croise le Z de caisse (CA réel) et les visites clients pour comparer les soirées entre
  // elles ; il n'apparaît dans AUCUNE liste de rôle explicite ci-dessus → direction-only par construction.
  return [...APP_TABS];
}

export function canViewTab(role: StaffRole, tab: AppTab): boolean {
  return visibleTabsForRole(role).includes(tab);
}

// ── Navigation hiérarchisée (programme gestion complète, Squad I) ────────────────────────────────
// 6 groupes métier pour éviter une barre plate illisible quand le nombre de modules dépasse ~16. Les
// clés d'onglets FUTURES (checklist, comms, commercial, suppliers, marketing, budget, cockpitDirection)
// sont listées ici mais n'apparaissent que lorsqu'elles rejoignent APP_TABS (intersection ci-dessous).
export const TAB_GROUPS = [
  { key: "soiree", label: "Soirée", tabs: ["plan", "reservations", "clients", "security", "flux", "promoters", "stats"] },
  { key: "equipes", label: "Équipes", tabs: ["rh", "monplanning", "artistes", "artistcheckin"] },
  { key: "operations", label: "Ops", tabs: ["incidents", "maintenance", "stock", "tasks", "checklist", "comms"] },
  { key: "relation", label: "Clients", tabs: ["crm", "funnel", "commercial"] },
  { key: "gestion", label: "Gestion", tabs: ["caisse", "pnl", "suppliers", "marketing", "budget"] },
  { key: "direction", label: "Direction", tabs: ["cockpit", "cockpitDirection", "agenda", "apprentissage", "admin"] },
] as const;

export type TabGroupKey = (typeof TAB_GROUPS)[number]["key"];

// Le groupe d'un onglet (fallback 'soiree' si non mappé — ne devrait jamais arriver, gardé par test).
export function groupForTab(tab: AppTab): TabGroupKey {
  for (const g of TAB_GROUPS) {
    if ((g.tabs as readonly string[]).includes(tab)) return g.key;
  }
  return "soiree";
}

// Onglets d'un groupe VISIBLES pour ce rôle (intersection : seuls les onglets réellement dans APP_TABS
// et autorisés au rôle apparaissent).
export function visibleTabsInGroup(role: StaffRole, group: TabGroupKey): AppTab[] {
  const visible = visibleTabsForRole(role);
  const g = TAB_GROUPS.find((x) => x.key === group);
  if (!g) return [];
  return visible.filter((t) => (g.tabs as readonly string[]).includes(t));
}

// Groupes non vides pour ce rôle (ceux à afficher dans la nav principale).
export function visibleGroups(role: StaffRole): TabGroupKey[] {
  return TAB_GROUPS.filter((g) => visibleTabsInGroup(role, g.key).length > 0).map((g) => g.key);
}

export function canAccessQrFromTab(role: StaffRole, tab: AppTab): boolean {
  const permissions = permissionsForRole(role);
  if (!permissions.canCheckInQr) return false;
  if ((role === "admin" || role === "manager" || role === "security_counter") && tab === "flux") {
    return true;
  }
  return role === "security" && tab === "security";
}

// Périmètre server = table NON ATTRIBUÉE **ou** attribuée à CE server (relation réelle avec le staff
// authentifié, alignée sur la migration 0045). Plus aucun nom en dur ('jeremy'/'server' supprimés) :
// un server est cantoné par SON propre username, ce qui couvre le compte partagé 'server' comme de
// futurs comptes individuels.
export function isAssignedToServerScope(table: PermissionTable, username: string): boolean {
  return !table.assignedTo || table.assignedTo === username;
}

// Un promoteur ne voit QUE ses propres tables (celles qu'il a amenées) : table.assignedTo === son username.
// Décision fondateur : le promoteur est cantonné à son périmètre, aucune visibilité inter-promoteurs.
export function isAssignedToPromoterScope(
  table: PermissionTable,
  username: string,
): boolean {
  return !!table.assignedTo && table.assignedTo === username;
}

export function canAccessTable(table: PermissionTable, user: PermissionUser | null): boolean {
  if (!user) return false;
  const permissions = permissionsForRole(user.role);
  if (permissions.canViewAllTables) return true;
  if (user.role === "server") return isAssignedToServerScope(table, user.username);
  if (user.role === "promoter") return isAssignedToPromoterScope(table, user.username);
  return false;
}

export function canEditTable(table: PermissionTable, user: PermissionUser | null): boolean {
  if (!user) return false;
  const permissions = permissionsForRole(user.role);
  if (!permissions.canEditTables) return false;
  if (permissions.canViewAllTables) return true;
  if (user.role === "server") return isAssignedToServerScope(table, user.username);
  if (user.role === "promoter") return isAssignedToPromoterScope(table, user.username);
  return false;
}

export function canSeeAllPromoters(role: StaffRole): boolean {
  const permissions = permissionsForRole(role);
  return permissions.canManagePromoters && role !== "promoter";
}

export function canUseCriticalAction(role: StaffRole, action: keyof RolePermissions): boolean {
  return permissionsForRole(role)[action];
}
