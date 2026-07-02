import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const cutoverPath = join(root, "supabase", "migrations", "0009_phase0b_rls_cutover.sql");
const eventPrepPath = join(root, "supabase", "migrations", "0008_event_scope_preparation.sql");
const cutover = readFileSync(cutoverPath, "utf8");
const eventPrep = readFileSync(eventPrepPath, "utf8");
const preflight = readFileSync(join(root, "supabase", "verification", "0009_preflight_readonly.sql"), "utf8");
const postflight = readFileSync(join(root, "supabase", "verification", "0009_postflight_readonly.sql"), "utf8");
const pageSource = readFileSync(join(root, "app", "page.tsx"), "utf8");
const activeEventSource = readFileSync(join(root, "lib", "activeEvent.ts"), "utf8");
const atomicOperations = readFileSync(join(root, "lib", "atomicOperations.ts"), "utf8");
const permissions = readFileSync(join(root, "lib", "permissions.ts"), "utf8");

function stripSqlComments(sql: string) {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function policyBlock(name: string) {
  const match = cutover.match(new RegExp(`create policy ${name}[\\s\\S]*?;`, "i"));
  assert.ok(match, `missing policy ${name}`);
  return match[0];
}

function functionBlockFrom(sql: string, name: string) {
  const match = sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, "i"));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

function eventPrepFunctionBlock(name: string) {
  return functionBlockFrom(eventPrep, name);
}

test("auth matrix keeps security table access disabled", () => {
  assert.match(permissions, /security:\s*\{[\s\S]*?canViewAllTables:\s*false/);
  assert.doesNotMatch(permissions, /security:\s*\{[\s\S]*?canViewAllTables:\s*true/);
});

test("migration order and runtime singleton are explicit", () => {
  assert.match(eventPrepPath, /0008_event_scope_preparation\.sql$/);
  assert.match(cutoverPath, /0009_phase0b_rls_cutover\.sql$/);
  assert.match(eventPrep, /create table if not exists public\.club_runtime_state/);
  assert.match(eventPrep, /constraint club_runtime_state_singleton check \(id\)/);
  assert.match(eventPrep, /active_event_id uuid references public\.events\(id\)/);
  assert.match(cutover, /club_runtime_state must contain exactly one row/);
  assert.match(cutover, /active event is missing or invalid/);
});

test("0008 installs every RPC required by the new front before cutover", () => {
  const requiredIn0008 = [
    "get_active_event_context",
    "get_security_table_snapshot",
    "list_activatable_club_events",
    "bootstrap_club_event_v2",
    "activate_club_event_v2",
    "close_club_event_v2",
    "add_entry_log_v2",
    "add_expense_v3",
    "check_in_invitation_v2",
    "create_promoter_invitation_v2",
  ];

  for (const name of requiredIn0008) {
    assert.match(eventPrep, new RegExp(`create or replace function public\\.${name}\\b`, "i"));
  }

  for (const rpcName of [
    "get_active_event_context",
    "get_security_table_snapshot",
    "list_activatable_club_events",
    "bootstrap_club_event_v2",
    "activate_club_event_v2",
    "close_club_event_v2",
    "add_entry_log_v2",
    "add_expense_v3",
    "check_in_invitation_v2",
    "create_promoter_invitation_v2",
  ]) {
    assert.match(eventPrep, new RegExp(`public\\.${rpcName}`, "i"), `${rpcName} must exist before 0009`);
  }
});

test("event preparation backfill is deterministic by unique event date", () => {
  assert.match(eventPrep, /with unique_event_dates as \([\s\S]*group by event_date[\s\S]*having count\(\*\) = 1[\s\S]*\)/i);
  assert.match(eventPrep, /unique_archive_dates as \([\s\S]*from public\.event_archives[\s\S]*having count\(\*\) = 1[\s\S]*\)/i);
  assert.doesNotMatch(eventPrep, /update public\.[\w_]+[\s\S]*from public\.events e[\s\S]*where[\s\S]*event_date = e\.event_date/i);
  assert.match(eventPrep, /duplicate event_archives\.event_id values must be resolved before unique index creation/);
  assert.ok(eventPrep.indexOf("duplicate event_archives.event_id values must be resolved before unique index creation") < eventPrep.indexOf("create unique index if not exists event_archives_event_id_unique_idx"));
});

test("front adopts active event context and clears it on sign out", () => {
  assert.match(activeEventSource, /get_active_event_context/);
  assert.match(activeEventSource, /list_activatable_club_events/);
  assert.match(activeEventSource, /bootstrap_club_event_v2/);
  assert.match(activeEventSource, /activate_club_event_v2/);
  assert.match(activeEventSource, /close_club_event_v2/);
  assert.match(pageSource, /loadActiveEventRuntimeContext\(supabase\)/);
  assert.match(activeEventSource, /bootstrapCompleted: row\?\.bootstrap_completed === true/);
  assert.match(activeEventSource, /lastClosedEventId: row\?\.last_closed_event_id/);
  assert.match(pageSource, /setActiveEvent\(null\)/);
  assert.match(pageSource, /requireActiveEvent\(activeEvent\)/);
  assert.match(pageSource, /ActiveEventBootstrapView/);
  assert.match(pageSource, /role === "admin" \|\| role === "manager"/);
});

test("front writes operational data with event scope or event-scoped RPCs", () => {
  assert.match(pageSource, /function toDbRow\(table: ClubTable, activeEvent: ActiveEventContext\)/);
  assert.match(pageSource, /event_id: activeEvent\.eventId/);
  assert.match(pageSource, /supabase\.rpc\("add_entry_log_v2", \{ p_type: type \}\)/);
  assert.match(pageSource, /supabase\.rpc\("add_expense_v3"/);
  assert.match(pageSource, /supabase\.rpc\("check_in_invitation_v2"/);
  assert.match(pageSource, /supabase\.rpc\("create_promoter_invitation_v2"/);
  // Invariant de sécurité : le front ne FABRIQUE jamais de jeton QR côté client (il vient toujours du
  // serveur, gen_random_uuid). Le scan à la porte (scan_guest_pass_v1, 0015) passe un jeton DÉJÀ
  // SCANNÉ pour validation — même schéma que check_in_invitation_v2 — après filtrage par
  // extractPassToken (jamais une fabrication) : c'est légitime, ce n'est pas une génération.
  assert.doesNotMatch(pageSource, /createQrToken|crypto\.randomUUID\(\)/);
  assert.match(pageSource, /supabase\.rpc\("scan_guest_pass_v1", \{ p_qr_token: token \}\)/);
  assert.match(pageSource, /extractPassToken\(rawToken\)/);
  assert.doesNotMatch(pageSource, /\.from\("entry_logs"\)\.insert/);
  assert.doesNotMatch(pageSource, /\.from\("promoter_guest_entries"\)\.insert/);
  assert.match(pageSource, /closeClubEvent\(supabase\)/);
  assert.doesNotMatch(pageSource, /\.from\("event_archives"\)\.insert/);
  assert.doesNotMatch(pageSource, /await resetAll\(\);[\s\S]*clotur/i);
});

test("SecurityView uses RPC projection and not direct club table access", () => {
  const securitySnapshot = eventPrepFunctionBlock("get_security_table_snapshot");
  const returnedColumns = securitySnapshot.match(/returns table \(([\s\S]*?)\)\nlanguage sql/i)?.[1] || "";

  assert.match(activeEventSource, /get_security_table_snapshot/);
  assert.match(pageSource, /loadSecurityTableSnapshot\(supabase\)/);
  assert.match(securitySnapshot, /returns table \([\s\S]*revenue_total numeric[\s\S]*\)/i);
  assert.doesNotMatch(returnedColumns, /assigned_to|booker|linked_tables|expenses/);
  assert.match(securitySnapshot, /canonical_groups/);
  assert.match(securitySnapshot, /case when st\.id = cg\.canonical_id then coalesce\(gr\.total, 0\) else 0 end as revenue_total/);
  assert.doesNotMatch(policyBlock("club_tables_select_ops"), /'security'/);
});

test("server and promoter policies remain scoped by role, username, and active event", () => {
  assert.match(policyBlock("club_tables_select_server"), /event_id = public\.current_active_event_id\(\)/);
  assert.match(policyBlock("club_tables_update_server"), /public\.co_is_server_table_scope\(assigned_to\)/);

  for (const policy of [
    "pc_select_promoter_own",
    "pc_insert_promoter_own",
    "pc_update_promoter_own",
    "pc_delete_promoter_own",
    "pge_select_promoter_own",
    "pge_update_promoter_own",
    "pge_delete_promoter_own",
  ]) {
    const block = policyBlock(policy);
    assert.match(block, /public\.current_staff_role\(\)\s*=\s*'promoter'/);
    assert.match(block, /promoter_username = public\.current_staff_username\(\)/);
  }
});

test("add_expense_v3 checks active event id and date while legacy v2 is not redefined", () => {
  const block = eventPrepFunctionBlock("add_expense_v3");
  assert.match(block, /v_active_event_id := public\.current_active_event_id\(\)/);
  assert.match(block, /v_active_event_date := public\.current_active_event_date\(\)/);
  assert.match(block, /v_date is distinct from v_active_event_date/);
  assert.match(block, /ct\.event_id = v_active_event_id/);
  assert.match(block, /ct\.event_date::date = v_active_event_date/);
  assert.doesNotMatch(eventPrep, /create or replace function public\.add_expense_v2/i);

  for (const parameter of ["p_table_id", "p_label", "p_amount", "p_date_key"]) {
    assert.match(block, new RegExp(`\\b${parameter}\\b`));
    assert.match(atomicOperations, new RegExp(`${parameter}:`));
  }
});

test("check_in_invitation_v2 and entry logs use active event scope while legacy QR is not redefined", () => {
  const checkIn = eventPrepFunctionBlock("check_in_invitation_v2");
  const entryLog = eventPrepFunctionBlock("add_entry_log_v2");

  assert.match(checkIn, /pge\.event_id = v_active_event_id/);
  assert.match(checkIn, /pge\.event_date::date = v_active_event_date/);
  assert.match(checkIn, /insert into public\.entry_logs \(type, staff_username, event_id, event_date\)/);
  assert.doesNotMatch(eventPrep, /create or replace function public\.check_in_invitation\(/i);
  assert.match(entryLog, /v_event_id := public\.current_active_event_id\(\)/);
  assert.match(entryLog, /insert into public\.entry_logs \(type, staff_username, event_id, event_date\)/);
  assert.match(entryLog, /v_role not in \('admin','manager','security_counter'\)/);
});

test("create_promoter_invitation_v2 generates QR token server-side", () => {
  const invitation = eventPrepFunctionBlock("create_promoter_invitation_v2");

  assert.match(invitation, /create or replace function public\.create_promoter_invitation_v2\(\s*p_promoter_username text,\s*p_contact_id uuid,\s*p_guest_name text,\s*p_phone text,\s*p_access_mode text,\s*p_payment_status text\s*\)/i);
  assert.doesNotMatch(invitation, /p_qr_token/i);
  assert.match(invitation, /v_token := gen_random_uuid\(\)::text/);
  assert.match(invitation, /where s\.username = v_promoter_username[\s\S]*and s\.role = 'promoter'/);
  assert.match(invitation, /return query select true, 'ok', 'Invitation creee\.', v_invitation_id, v_token/);
});

test("sensitive RPC grants are explicit and PUBLIC is revoked", () => {
  for (const signature of [
    "public.add_expense_v3(text, text, numeric, text)",
    "public.check_in_invitation_v2(text, text)",
    "public.create_promoter_invitation_v2(text, uuid, text, text, text, text)",
    "public.add_entry_log_v2(text)",
    "public.get_security_table_snapshot()",
    "public.activate_club_event_v2(uuid)",
    "public.bootstrap_club_event_v2(uuid)",
    "public.close_club_event_v2()",
    "public.list_activatable_club_events()",
  ]) {
    assert.match(eventPrep, new RegExp(`revoke all on function ${signature.replace(/[().]/g, "\\$&")}`, "i"));
  }

  assert.doesNotMatch(cutover, /grant execute on function public\.check_in_invitation\(text, text\) to anon/i);
});

test("bootstrap and close lifecycle contracts are staged before cutover", () => {
  const bootstrap = eventPrepFunctionBlock("bootstrap_club_event_v2");
  const activate = eventPrepFunctionBlock("activate_club_event_v2");
  const close = eventPrepFunctionBlock("close_club_event_v2");

  assert.match(eventPrep, /bootstrap_completed_at timestamptz/);
  assert.match(eventPrep, /last_closed_event_id uuid/);
  assert.match(eventPrep, /club_runtime_state contains multiple rows/);
  assert.match(eventPrep, /club_runtime_state\.id must be true/);
  assert.match(eventPrep, /active_event_id cannot point to an archived event/);
  assert.match(eventPrep, /values \(true, null, null, null, null\)/);
  assert.match(bootstrap, /v_role not in \('admin','manager'\)/);
  assert.match(bootstrap, /v_table_count <> 18/);
  assert.match(bootstrap, /bootstrap_completed_at::text/);
  assert.match(bootstrap, /event_archived/);
  assert.match(bootstrap, /event_not_activatable/);
  assert.match(bootstrap, /ambiguous_live_dates/);
  assert.match(bootstrap, /bootstrap_completed_at = now\(\)/);
  assert.match(activate, /v_bootstrap_completed_at is null/);
  assert.match(activate, /event_archived/);
  assert.match(activate, /event_not_activatable/);
  assert.match(activate, /same_as_last_closed_event/);
  assert.match(activate, /event_still_active/);
  assert.match(activate, /live_state_not_reset/);
  assert.match(close, /for update/);
  assert.match(close, /insert into public\.event_archives/);
  assert.match(close, /already_archived/);
  assert.match(close, /set active_event_id = null/);
  assert.match(close, /last_closed_event_id = v_event_id/);
  assert.match(close, /status = 'archived'/);
  assert.ok(close.indexOf("insert into public.event_archives") < close.indexOf("update public.events"));
  assert.ok(close.indexOf("update public.events") < close.indexOf("update public.club_tables"));
  assert.ok(close.indexOf("update public.club_tables") < close.indexOf("update public.club_runtime_state"));
  assert.match(pageSource, /chooseActiveEventLifecycleAction/);
  assert.doesNotMatch(pageSource, /bootstrap_already_done/);
  assert.doesNotMatch(pageSource, /selectedEventId\s*\|\|\s*events\[0\]/);
});

test("0009 verifies pre-cutover RPCs instead of redefining front dependencies", () => {
  for (const signature of [
    "public.get_active_event_context()",
    "public.get_security_table_snapshot()",
    "public.list_activatable_club_events()",
    "public.bootstrap_club_event_v2(uuid)",
    "public.activate_club_event_v2(uuid)",
    "public.close_club_event_v2()",
    "public.add_entry_log_v2(text)",
    "public.add_expense_v3(text,text,numeric,text)",
    "public.check_in_invitation_v2(text,text)",
    "public.create_promoter_invitation_v2(text,uuid,text,text,text,text)",
  ]) {
    assert.match(cutover, new RegExp(`to_regprocedure\\('${signature.replace(/[().]/g, "\\$&")}'\\)`, "i"));
  }

  for (const rpcName of [
    "get_active_event_context",
    "get_security_table_snapshot",
    "activate_club_event_v2",
    "add_entry_log_v2",
    "add_expense_v3",
    "check_in_invitation_v2",
    "create_promoter_invitation_v2",
  ]) {
    assert.doesNotMatch(cutover, new RegExp(`create or replace function public\\.${rpcName}\\b`, "i"));
  }

  assert.match(cutover, /revoke all on function public\.add_expense_v2\(text, text, numeric, text\) from anon, authenticated/i);
  assert.match(cutover, /revoke all on function public\.check_in_invitation\(text, text\) from anon, authenticated/i);
  assert.match(cutover, /active event cannot be archived/i);
  assert.match(cutover, /event_archives contain duplicate event_id values/i);
});

test("event writes cannot omit event_id after cutover policies", () => {
  assert.match(policyBlock("club_tables_insert_admin_manager_promoter"), /event_id = public\.current_active_event_id\(\)/);
  assert.match(policyBlock("club_tables_update_admin_manager_promoter"), /event_id = public\.current_active_event_id\(\)/);
  assert.doesNotMatch(cutover, /create policy pge_insert_/);
  assert.doesNotMatch(cutover, /create policy ea_insert_/);
  assert.doesNotMatch(cutover, /grant select, insert, update, delete on public\.promoter_guest_entries to authenticated/i);
  assert.doesNotMatch(cutover, /grant select, insert, update, delete on public\.event_archives to authenticated/i);
  assert.doesNotMatch(cutover, /grant select, insert, delete on public\.entry_logs to authenticated/i);
});

test("preflight and postflight scripts are read-only", () => {
  for (const [name, sql] of [["preflight", preflight], ["postflight", postflight]] as const) {
    const body = stripSqlComments(sql);
    for (const forbidden of ["ALTER", "UPDATE", "INSERT", "DELETE", "DROP", "CREATE", "GRANT", "REVOKE", "TRUNCATE", "CALL", "EXECUTE"]) {
      assert.doesNotMatch(body, new RegExp(`\\b${forbidden}\\b`, "i"), `${name} contains ${forbidden}`);
    }
    assert.match(body, /\bselect\b/i);
  }
});
