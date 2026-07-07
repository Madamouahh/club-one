import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  chooseActiveEventLifecycleAction,
} from "../lib/activeEvent.ts";
import {
  authorizeTableMutation,
  runAuthorizedMutation,
} from "../lib/authorizedOperations.ts";
import {
  restoreStaffSession,
  signInStaffUser,
  signOutStaffUser,
  subscribeStaffAuthState,
  type AuthSessionClient,
  type StaffProfile,
} from "../lib/authSession.ts";
import {
  APP_TABS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  canAccessTable,
  canAccessQrFromTab,
  canEditTable,
  canSeeAllPromoters,
  canUseCriticalAction,
  canViewTab,
  initialTabForRole,
  permissionsForRole,
  visibleTabsForRole,
  TAB_GROUPS,
  groupForTab,
  visibleTabsInGroup,
  visibleGroups,
  type AppTab,
  type PermissionTable,
  type PermissionUser,
  type StaffRole,
} from "../lib/permissions.ts";
import { securityRevenueByCanonicalRow } from "../lib/securityRevenue.ts";
import { canAccessIncidents } from "../lib/incidents.ts";

const root = process.cwd();

function user(role: StaffRole, username: string = role): PermissionUser {
  return { role, username };
}

const allTables: PermissionTable[] = Array.from({ length: 18 }, (_, index) => {
  const promoters = ["mathias", "quentin", "lawrence"];
  return {
    assignedTo:
      index < 6
        ? ""
        : index < 9
          ? "jeremy"
          : index < 12
            ? "server"
            : promoters[index % promoters.length],
  };
});

test("permission matrix covers the six staff roles", () => {
  const expectedMatrix = {
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
      // Décision fondateur (commit 83166f7) : le promoteur est cantonné à SES tables.
      // canViewAllTables=false + isAssignedToPromoterScope ; aucune visibilité inter-promoteurs.
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
  } satisfies typeof ROLE_PERMISSIONS;

  assert.deepEqual(STAFF_ROLES, [
    "admin",
    "manager",
    "server",
    "security",
    "security_counter",
    "promoter",
  ]);

  for (const role of STAFF_ROLES) {
    assert.deepEqual(permissionsForRole(role), expectedMatrix[role]);
  }
});

test("tab visibility is centralized and role-specific", () => {
  const expected: Record<StaffRole, AppTab[]> = {
    admin: [...APP_TABS],
    manager: [...APP_TABS],
    server: ["plan", "reservations", "clients", "monplanning", "incidents"],
    security: ["security", "monplanning", "incidents"],
    security_counter: ["flux", "monplanning", "incidents"],
    promoter: ["plan", "reservations", "clients", "promoters", "funnel", "crm", "demandesresa"],
  };

  for (const role of STAFF_ROLES) {
    assert.deepEqual(visibleTabsForRole(role), expected[role]);
    for (const tab of APP_TABS) {
      assert.equal(canViewTab(role, tab), expected[role].includes(tab));
    }
  }

  assert.equal(initialTabForRole("security"), "security");
  assert.equal(initialTabForRole("security_counter"), "flux");
  assert.equal(initialTabForRole("promoter"), "plan");
  assert.deepEqual(visibleTabsForRole("promoter"), ["plan", "reservations", "clients", "promoters", "funnel", "crm", "demandesresa"]);
  assert.deepEqual(visibleTabsForRole("security_counter"), ["flux", "monplanning", "incidents"]);

  // La caisse (Z de clôture, P&L) est strictement directionnelle : admin/manager uniquement,
  // en miroir de la RLS 0010 (caisse_z_direction_*). Aucun autre rôle ne doit voir l'onglet.
  for (const role of STAFF_ROLES) {
    const isDirection = role === "admin" || role === "manager";
    assert.equal(canViewTab(role, "caisse"), isDirection, `${role} caisse tab`);
    // Le P&L par soirée croise caisse_z + CA tables + entrées : même périmètre directionnel strict
    // que la caisse. Aucun manager de terrain, serveur, sécu ou promoteur ne voit les agrégats.
    assert.equal(canViewTab(role, "pnl"), isDirection, `${role} pnl tab`);
    // RH / Planning (B7) — vue direction/patronat : composition du planning, taux horaire (PII),
    // notes de direction. Onglet directionnel strict (miroir de la RLS 0011 staff_members/shifts).
    // La vue salarié (chacun voit SES shifts) sera un onglet distinct, pas encore livré.
    assert.equal(canViewTab(role, "rh"), isDirection, `${role} rh tab`);
    // Artistes & extras (B2/B3) — budget de soirée (cachets, coûts presta) directionnel strict,
    // miroir de la RLS 0012 (soiree_charges_direction_*). Un artiste peut voir « sa fiche » (E5,
    // hors périmètre), jamais le budget de la soirée. Aucun autre rôle ne voit l'onglet.
    assert.equal(canViewTab(role, "artistes"), isDirection, `${role} artistes tab`);
    // Funnel QR (CRM 0014) — génération des liens/QR d'invitation : direction ET promoteur (le
    // promoteur est cantonné à SES liens par la RLS invite_links). Fermé aux autres rôles (server,
    // security, security_counter) : ni la génération de liens ni la clientèle ne les concernent.
    const isFunnelRole = isDirection || role === "promoter";
    assert.equal(canViewTab(role, "funnel"), isFunnelRole, `${role} funnel tab`);
    // CRM V1 (call-list du mardi + segments/scoring) — même audience que le funnel : direction ET
    // promoteur (cantonné à SES clients par la RLS 0013 guests/guest_scores). Fermé aux autres rôles
    // (server, security, security_counter) qui n'accèdent pas à la base marketing.
    const isCrmRole = isDirection || role === "promoter";
    assert.equal(canViewTab(role, "crm"), isCrmRole, `${role} crm tab`);
    // « Mon planning » (RH vue salarié B7) : tous les rôles de l'effectif (la RLS 0011 cantonne à
    // sa propre fiche), SAUF le promoteur (pas dans l'effectif salarié, matrice B7). Direction incluse.
    const isSelfPlanningRole = role !== "promoter";
    assert.equal(canViewTab(role, "monplanning"), isSelfPlanningRole, `${role} monplanning tab`);
    // Boucle d'apprentissage CRM (spec §148-156) — croise le Z de caisse (CA réel) et les visites
    // clients pour comparer les soirées entre elles. Lecture stratégique directionnelle stricte
    // (CA réel + segmentation) ; aucun autre rôle ne voit l'onglet (ni promoteur, ni salarié).
    assert.equal(canViewTab(role, "apprentissage"), isDirection, `${role} apprentissage tab`);
    // Incidents (module A6, RLS 0023) — visibilité RESTREINTE : l'onglet suit EXACTEMENT canAccessIncidents
    // (direction + sécurité en lecture complète, server/compteur pour signaler). Promoteur/artiste : aucun
    // accès (⛔) — la RLS 0023 leur refuse toute ligne, l'UI ne doit pas non plus exposer l'onglet.
    assert.equal(canViewTab(role, "incidents"), canAccessIncidents(role), `${role} incidents tab`);
    // Le promoteur en particulier NE DOIT JAMAIS voir l'onglet Incidents (matrice A6 : promoteur ⛔).
    if (role === "promoter") {
      assert.equal(canViewTab(role, "incidents"), false, "promoter must never see incidents tab");
    }
  }
});

test("promoters are cantoned to their own tables, while servers keep their existing table scope", () => {
  // Cantonnement promoteur (décision fondateur 83166f7) : un promoteur ne voit/édite QUE les tables
  // qui lui sont assignées (table.assignedTo === son username), jamais celles d'un autre promoteur.
  const mathiasVisible = allTables.filter((table) => canAccessTable(table, user("promoter", "mathias")));
  assert.equal(mathiasVisible.length, 2);
  assert.ok(mathiasVisible.every((table) => table.assignedTo === "mathias"));
  assert.equal(allTables.filter((table) => canEditTable(table, user("promoter", "mathias"))).length, 2);
  // Les tables non assignées ou d'un autre promoteur restent invisibles pour lui.
  assert.equal(allTables.filter((table) => canAccessTable(table, user("promoter", "quentin"))).length, 2);
  assert.equal(allTables.filter((table) => canAccessTable(table, user("promoter", "inconnu"))).length, 0);

  assert.equal(allTables.filter((table) => canAccessTable(table, user("security", "hanass"))).length, 0);
  assert.equal(allTables.filter((table) => canEditTable(table, user("security", "hanass"))).length, 0);
  assert.equal(allTables.filter((table) => canAccessTable(table, user("security_counter", "mohamed"))).length, 0);

  // Server = relation réelle (0045) : voit les tables NON ATTRIBUÉES + celles à SON propre username,
  // plus aucun nom en dur. Un server "jeremy" voit le non-attribué (6) + ses tables "jeremy" (3) = 9 ;
  // il ne voit PLUS les tables 'server' (elles ne sont pas les siennes).
  const serverJeremy = allTables.filter((table) => canAccessTable(table, user("server", "jeremy")));
  assert.equal(serverJeremy.length, 9);
  assert.ok(serverJeremy.every((table) => !table.assignedTo || table.assignedTo === "jeremy"));
  // Un server cantoné par SON username : "server" voit le non-attribué (6) + ses tables 'server' (3) = 9,
  // et jamais les tables "jeremy" — preuve que le périmètre suit l'identité, pas une liste figée.
  const serverServer = allTables.filter((table) => canAccessTable(table, user("server", "server")));
  assert.equal(serverServer.length, 9);
  assert.ok(serverServer.every((table) => !table.assignedTo || table.assignedTo === "server"));
});

test("unlinked or missing auth profile has no table access", () => {
  assert.equal(canAccessTable({ assignedTo: "" }, null), false);
  assert.equal(canEditTable({ assignedTo: "" }, null), false);
});

test("navigation hiérarchisée : chaque onglet appartient à exactement un groupe, groupes cohérents par rôle", () => {
  // Tout AppTab est mappé à un groupe qui le contient réellement (pas de fallback silencieux).
  for (const tab of APP_TABS) {
    const g = groupForTab(tab);
    const grp = TAB_GROUPS.find((x) => x.key === g)!;
    assert.ok((grp.tabs as readonly string[]).includes(tab), `${tab} doit être listé dans son groupe ${g}`);
  }
  // La direction voit plusieurs groupes non vides ; le promoteur en voit peu (cantonné).
  assert.ok(visibleGroups("admin").length >= 4, "la direction voit au moins 4 groupes");
  // Le promoteur (plan/reservations/clients/promoters/funnel/crm) : soirée + clients uniquement.
  const promoGroups = visibleGroups("promoter");
  assert.deepEqual(promoGroups.sort(), ["relation", "soiree"]);
  // Un onglet visible du groupe est bien un onglet visible du rôle.
  for (const t of visibleTabsInGroup("admin", "gestion")) {
    assert.ok(visibleTabsForRole("admin").includes(t));
  }
  // security_counter : flux (soirée) + monplanning (équipes) + incidents (ops).
  assert.deepEqual(visibleGroups("security_counter").sort(), ["equipes", "operations", "soiree"]);
});

test("critical actions match the front permission matrix", () => {
  const qrAllowed = new Set<StaffRole>(["admin", "manager", "security", "security_counter"]);
  const expenseAllowed = new Set<StaffRole>(["admin", "manager", "server", "promoter"]);
  const closeAllowed = new Set<StaffRole>(["admin", "manager"]);

  for (const role of STAFF_ROLES) {
    assert.equal(canUseCriticalAction(role, "canCheckInQr"), qrAllowed.has(role), `${role} QR`);
    assert.equal(canUseCriticalAction(role, "canAddExpense"), expenseAllowed.has(role), `${role} expense`);
    assert.equal(canUseCriticalAction(role, "canCloseEvent"), closeAllowed.has(role), `${role} close`);
  }

  assert.equal(canUseCriticalAction("promoter", "canAssignTables"), true);
  assert.equal(canSeeAllPromoters("security_counter"), false);
  assert.equal(canUseCriticalAction("security_counter", "canManageInvitations"), false);
  assert.equal(canUseCriticalAction("promoter", "canViewStats"), false);
});

test("QR scanner access paths match visible role tabs", () => {
  assert.equal(canAccessQrFromTab("admin", "flux"), true);
  assert.equal(canAccessQrFromTab("manager", "flux"), true);
  assert.equal(canAccessQrFromTab("security_counter", "flux"), true);
  assert.equal(canAccessQrFromTab("security", "security"), true);

  assert.equal(canAccessQrFromTab("promoter", "promoters"), false);
  assert.equal(canAccessQrFromTab("promoter", "flux"), false);
  assert.equal(canAccessQrFromTab("server", "flux"), false);
  assert.equal(canAccessQrFromTab("security", "flux"), false);
  assert.equal(canAccessQrFromTab("security_counter", "security"), false);
});

test("denied table mutations never call the injected mutation", async () => {
  const table = { id: "A1", assignedTo: "" };
  const promoterTable = { id: "A2", assignedTo: "mathias" };

  async function attempt(authorization: ReturnType<typeof authorizeTableMutation>) {
    let mutationCallCount = 0;
    const result = await runAuthorizedMutation({
      authorization,
      mutate: () => {
        mutationCallCount += 1;
        return "mutated";
      },
    });
    return { result, mutationCallCount };
  }

  assert.equal((await attempt(authorizeTableMutation({ user: user("security"), currentTable: table, nextTable: table }))).mutationCallCount, 0);
  assert.equal((await attempt(authorizeTableMutation({ user: user("security_counter"), currentTable: table, nextTable: table }))).mutationCallCount, 0);
  assert.equal((await attempt(authorizeTableMutation({ user: user("server"), currentTable: promoterTable, nextTable: promoterTable }))).mutationCallCount, 0);
  assert.equal((await attempt(authorizeTableMutation({ user: user("server"), currentTable: table, nextTable: { assignedTo: "mathias" } }))).mutationCallCount, 0);
  assert.equal((await attempt({ ok: canUseCriticalAction("promoter", "canCheckInQr") })).mutationCallCount, 0);
  assert.equal((await attempt({ ok: false, message: "Action non autorisee pour ce role." })).mutationCallCount, 0);
  assert.equal((await attempt(authorizeTableMutation({ user: null, currentTable: table, nextTable: table }))).mutationCallCount, 0);

  const allowed = await attempt(authorizeTableMutation({ user: user("manager"), currentTable: table, nextTable: { assignedTo: "mathias" } }));
  assert.equal(allowed.mutationCallCount, 1);
  assert.deepEqual(allowed.result, { ok: true, data: "mutated" });
});

test("QR handler permission outcomes call the injected RPC only for authorized roles", async () => {
  async function attempt(role: StaffRole) {
    let mutationCallCount = 0;
    const result = await runAuthorizedMutation({
      authorization: { ok: canUseCriticalAction(role, "canCheckInQr") },
      mutate: () => {
        mutationCallCount += 1;
        return "checked";
      },
    });
    return { result, mutationCallCount };
  }

  assert.equal((await attempt("promoter")).mutationCallCount, 0);
  assert.equal((await attempt("server")).mutationCallCount, 0);

  const security = await attempt("security");
  assert.equal(security.mutationCallCount, 1);
  assert.deepEqual(security.result, { ok: true, data: "checked" });

  const counter = await attempt("security_counter");
  assert.equal(counter.mutationCallCount, 1);
  assert.deepEqual(counter.result, { ok: true, data: "checked" });
});

type TestProfile = StaffProfile;

function profile(role: StaffRole = "manager"): TestProfile {
  return {
    id: "staff-id",
    username: role,
    role,
    full_name: `Staff ${role}`,
  };
}

function fakeAuthClient(options: {
  session?: unknown | null;
  rpcData?: TestProfile | TestProfile[] | null;
  rpcError?: unknown;
  signInError?: unknown;
}) {
  let getSessionCallCount = 0;
  let rpcCallCount = 0;
  let signOutCallCount = 0;
  let signInCallCount = 0;
  let unsubscribeCallCount = 0;
  let authCallback: ((event: string, session: unknown | null) => void | Promise<void>) | null = null;

  const client: AuthSessionClient<TestProfile> = {
    auth: {
      async getSession() {
        getSessionCallCount += 1;
        return { data: { session: options.session ?? null } };
      },
      async signInWithPassword() {
        signInCallCount += 1;
        return { error: options.signInError };
      },
      async signOut() {
        signOutCallCount += 1;
      },
      onAuthStateChange(callback) {
        authCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                unsubscribeCallCount += 1;
              },
            },
          },
        };
      },
    },
    async rpc(name) {
      rpcCallCount += 1;
      assert.equal(name, "get_my_profile");
      return { data: options.rpcData, error: options.rpcError };
    },
  };

  return {
    client,
    counts: () => ({ getSessionCallCount, rpcCallCount, signOutCallCount, signInCallCount, unsubscribeCallCount }),
    emitAuth: async (event: string, session: unknown | null) => {
      assert.ok(authCallback);
      await authCallback(event, session);
    },
  };
}

test("auth session restore succeeds only with a linked profile", async () => {
  const fake = fakeAuthClient({ session: { access_token: "fake" }, rpcData: profile("manager") });
  const restored = await restoreStaffSession(fake.client);

  assert.equal(restored?.role, "manager");
  assert.deepEqual(fake.counts(), {
    getSessionCallCount: 1,
    rpcCallCount: 1,
    signOutCallCount: 0,
    signInCallCount: 0,
    unsubscribeCallCount: 0,
  });
});

test("auth session restore with no session does not fetch profile", async () => {
  const fake = fakeAuthClient({ session: null, rpcData: profile("manager") });
  const restored = await restoreStaffSession(fake.client);

  assert.equal(restored, null);
  assert.equal(fake.counts().rpcCallCount, 0);
  assert.equal(fake.counts().signOutCallCount, 0);
});

test("unlinked auth user is signed out and never receives a default role", async () => {
  for (const rpcData of [null, []]) {
    const fake = fakeAuthClient({ session: { access_token: "fake" }, rpcData });
    const restored = await restoreStaffSession(fake.client);

    assert.equal(restored, null);
    assert.equal(fake.counts().rpcCallCount, 1);
    assert.equal(fake.counts().signOutCallCount, 1);
  }

  const errorFake = fakeAuthClient({ session: { access_token: "fake" }, rpcError: new Error("missing profile") });
  assert.equal(await restoreStaffSession(errorFake.client), null);
  assert.equal(errorFake.counts().signOutCallCount, 1);
});

test("sign in and sign out lifecycle uses Supabase Auth without local fallback", async () => {
  const fake = fakeAuthClient({ rpcData: profile("admin") });
  const signedIn = await signInStaffUser(fake.client, " ADMIN ", " fake-password ");
  assert.equal(signedIn?.role, "admin");
  assert.equal(fake.counts().signInCallCount, 1);
  assert.equal(fake.counts().rpcCallCount, 1);

  const signedOut = await signOutStaffUser(fake.client);
  assert.deepEqual(signedOut, {
    user: null,
    activeTab: "plan",
    clearUserData: true,
  });
  assert.equal(fake.counts().signOutCallCount, 1);
});

test("auth state subscription loads linked users, clears sign-out, and cleans up", async () => {
  const fake = fakeAuthClient({ rpcData: profile("security") });
  const seen: Array<TestProfile | null> = [];
  const unsubscribe = subscribeStaffAuthState(fake.client, (nextProfile) => {
    seen.push(nextProfile);
  });

  await fake.emitAuth("SIGNED_IN", { access_token: "fake" });
  await fake.emitAuth("SIGNED_OUT", null);
  unsubscribe();

  assert.equal(seen[0]?.role, "security");
  assert.equal(seen[1], null);
  assert.equal(fake.counts().rpcCallCount, 1);
  assert.equal(fake.counts().unsubscribeCallCount, 1);
});

test("front uses Supabase Auth/RPCs and has no direct staff_users fallback", () => {
  const pageSource = readFileSync(join(root, "app", "page.tsx"), "utf8");
  const authSource = readFileSync(join(root, "lib", "authSession.ts"), "utf8");
  const qrPanelSource = readFileSync(join(root, "components", "QrCheckInPanel.tsx"), "utf8");
  const inviteSource = readFileSync(join(root, "app", "invite", "[token]", "page.tsx"), "utf8");

  assert.match(pageSource, /signInStaffUser/);
  assert.match(pageSource, /restoreStaffSession/);
  assert.match(pageSource, /subscribeStaffAuthState/);
  assert.match(pageSource, /signOutStaffUser/);
  assert.match(authSource, /signInWithPassword/);
  assert.match(authSource, /getSession/);
  assert.match(authSource, /onAuthStateChange/);
  assert.match(authSource, /signOut/);
  assert.match(authSource, /client\.rpc\("get_my_profile"\)/);
  assert.match(pageSource, /supabase\.rpc\("add_expense_v3"/);
  assert.match(pageSource, /supabase\.rpc\("check_in_invitation_v2"/);
  assert.match(pageSource, /supabase\.rpc\("create_promoter_invitation_v2"/);
  // Funnel CRM (0014) : la génération d'un lien/QR passe par la RPC create_invite_link_v1 (token +
  // soirée active fixés côté serveur), jamais par un insert direct qui fabriquerait un token client.
  assert.match(pageSource, /supabase\.rpc\("create_invite_link_v1"/);
  // Le front ne FABRIQUE jamais de jeton QR (toujours généré côté serveur). Le scan à la porte
  // (scan_guest_pass_v1, 0015) transmet un jeton DÉJÀ SCANNÉ pour validation, filtré par
  // extractPassToken — ce n'est pas une génération, donc p_qr_token en entrée est légitime.
  assert.doesNotMatch(pageSource, /createQrToken|crypto\.randomUUID\(\)/);
  assert.match(inviteSource, /supabase\.rpc\("get_invite"/);
  assert.equal((qrPanelSource.match(/export function QrCheckInPanel/g) || []).length, 1);
  assert.match(pageSource, /function FluxView[\s\S]*<QrCheckInPanel onValidateQr=\{onValidateQr\}/);
  assert.match(pageSource, /function SecurityView[\s\S]*<QrCheckInPanel onValidateQr=\{onValidateQr\} compact/);
  assert.equal((qrPanelSource.match(/function QrCameraScanner/g) || []).length, 1);
  assert.equal((pageSource.match(/<QrCheckInPanel/g) || []).length, 2);

  assert.doesNotMatch(pageSource, /\.from\(["']staff_users["']\)/);
  assert.doesNotMatch(authSource, /\.from\(["']staff_users["']\)/);
  assert.doesNotMatch(pageSource, /staff-passwords\.local\.json/);
  assert.doesNotMatch(authSource, /staff-passwords\.local\.json/);
  assert.doesNotMatch(pageSource, /localStorage/);
  assert.doesNotMatch(authSource, /localStorage/);
});

test("active event lifecycle decision never falls back across phases", () => {
  assert.equal(chooseActiveEventLifecycleAction({ role: "admin", bootstrapCompleted: false }), "bootstrap");
  assert.equal(chooseActiveEventLifecycleAction({ role: "manager", bootstrapCompleted: true }), "activate");
  assert.equal(chooseActiveEventLifecycleAction({ role: "promoter", bootstrapCompleted: false }), "none");
  assert.equal(chooseActiveEventLifecycleAction({ role: "security", bootstrapCompleted: true }), "none");
});

test("security revenue projection keeps grouped totals on one canonical row", () => {
  const revenue = securityRevenueByCanonicalRow([
    { id: "A1", expenses: [{ amount: 120 }] },
    { id: "B1", linkedGroupId: "G1", linkedTables: ["B2"], expenses: [{ amount: 50 }] },
    { id: "B2", linkedGroupId: "G1", linkedTables: ["B1"], expenses: [] },
    { id: "C1", linkedGroupId: "G2", linkedTables: ["C2", "C3"], expenses: [{ amount: 10 }] },
    { id: "C2", linkedGroupId: "G2", linkedTables: ["C1", "C3"], expenses: [{ amount: 20 }] },
    { id: "C3", linkedGroupId: "G2", linkedTables: ["C1", "C2"], expenses: [{ amount: 30 }] },
    { id: "D1", linkedGroupId: "G3", linkedTables: ["D2"], expenses: [{ amount: 40 }] },
    { id: "D2", linkedGroupId: "G3", linkedTables: ["D1"], expenses: [{ amount: 40 }] },
    { id: "E1", expenses: [] },
  ]);

  assert.deepEqual(revenue, {
    A1: 120,
    B1: 50,
    B2: 0,
    C1: 60,
    C2: 0,
    C3: 0,
    D1: 80,
    D2: 0,
    E1: 0,
  });
});

test("security revenue projection handles asymmetric groups deterministically", () => {
  const revenue = securityRevenueByCanonicalRow([
    { id: "A", linkedTables: ["B"], expenses: [{ amount: 100 }] },
    { id: "B", linkedTables: [], expenses: [{ amount: 50 }] },
  ]);

  assert.deepEqual(revenue, {
    A: 100,
    B: 50,
  });
});
