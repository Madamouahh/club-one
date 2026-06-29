import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  APP_TABS,
  STAFF_ROLES,
  canAccessTable,
  canEditTable,
  canSeeAllPromoters,
  canUseCriticalAction,
  canViewTab,
  initialTabForRole,
  permissionsForRole,
  visibleTabsForRole,
  type AppTab,
  type PermissionTable,
  type PermissionUser,
  type StaffRole,
} from "../lib/permissions.ts";

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
  assert.deepEqual(STAFF_ROLES, [
    "admin",
    "manager",
    "server",
    "security",
    "security_counter",
    "promoter",
  ]);

  for (const role of STAFF_ROLES) {
    assert.equal(typeof permissionsForRole(role).canViewAllTables, "boolean");
    assert.ok(visibleTabsForRole(role).length > 0);
  }
});

test("tab visibility is centralized and role-specific", () => {
  const expected: Record<StaffRole, AppTab[]> = {
    admin: [...APP_TABS],
    manager: [...APP_TABS],
    server: ["plan", "reservations", "clients"],
    security: ["security"],
    security_counter: ["flux", "promoters"],
    promoter: ["plan", "reservations", "clients", "promoters", "stats"],
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
});

test("promoters see and edit all 18 tables, while servers keep their existing table scope", () => {
  assert.equal(allTables.filter((table) => canAccessTable(table, user("promoter", "mathias"))).length, 18);
  assert.equal(allTables.filter((table) => canEditTable(table, user("promoter", "mathias"))).length, 18);

  const serverVisible = allTables.filter((table) => canAccessTable(table, user("server", "jeremy")));
  assert.equal(serverVisible.length, 12);
  assert.ok(serverVisible.every((table) => !table.assignedTo || table.assignedTo === "jeremy" || table.assignedTo === "server"));
});

test("unlinked or missing auth profile has no table access", () => {
  assert.equal(canAccessTable({ assignedTo: "" }, null), false);
  assert.equal(canEditTable({ assignedTo: "" }, null), false);
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
  assert.equal(canSeeAllPromoters("security_counter"), true);
  assert.equal(canUseCriticalAction("security_counter", "canManageInvitations"), false);
});

test("front uses Supabase Auth/RPCs and has no direct staff_users fallback", () => {
  const pageSource = readFileSync(join(root, "app", "page.tsx"), "utf8");
  const inviteSource = readFileSync(join(root, "app", "invite", "[token]", "page.tsx"), "utf8");

  assert.match(pageSource, /supabase\.auth\.signInWithPassword/);
  assert.match(pageSource, /supabase\.auth\.getSession/);
  assert.match(pageSource, /supabase\.auth\.onAuthStateChange/);
  assert.match(pageSource, /supabase\.auth\.signOut/);
  assert.match(pageSource, /supabase\.rpc\("get_my_profile"\)/);
  assert.match(pageSource, /supabase\.rpc\("add_expense_v2"/);
  assert.match(pageSource, /supabase\.rpc\("check_in_invitation"/);
  assert.match(inviteSource, /supabase\.rpc\("get_invite"/);

  assert.doesNotMatch(pageSource, /\.from\(["']staff_users["']\)/);
  assert.doesNotMatch(pageSource, /staff-passwords\.local\.json/);
});
