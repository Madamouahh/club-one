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
  if (role === "security") return ["security", "monplanning"];
  if (role === "security_counter") return ["flux", "monplanning"];
  if (role === "server") return ["plan", "reservations", "clients", "monplanning"];
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

export function canAccessQrFromTab(role: StaffRole, tab: AppTab): boolean {
  const permissions = permissionsForRole(role);
  if (!permissions.canCheckInQr) return false;
  if ((role === "admin" || role === "manager" || role === "security_counter") && tab === "flux") {
    return true;
  }
  return role === "security" && tab === "security";
}

export function isAssignedToServerScope(table: PermissionTable): boolean {
  return !table.assignedTo || table.assignedTo === "jeremy" || table.assignedTo === "server";
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
  if (user.role === "server") return isAssignedToServerScope(table);
  if (user.role === "promoter") return isAssignedToPromoterScope(table, user.username);
  return false;
}

export function canEditTable(table: PermissionTable, user: PermissionUser | null): boolean {
  if (!user) return false;
  const permissions = permissionsForRole(user.role);
  if (!permissions.canEditTables) return false;
  if (permissions.canViewAllTables) return true;
  if (user.role === "server") return isAssignedToServerScope(table);
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
