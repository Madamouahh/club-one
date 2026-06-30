-- 0009_postflight_readonly.sql
-- Lecture seule. A lancer apres une future execution controlee de 0009.

select 'rls_enabled' as check_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in (
     'staff_users',
     'club_runtime_state',
     'club_tables',
     'entry_logs',
     'promoter_contacts',
     'promoter_guest_entries',
     'event_archives',
     'venues',
     'events'
   )
 order by c.relname;

select 'final_policies' as check_name,
       tablename,
       policyname,
       roles,
       cmd,
       qual,
       with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in (
     'club_tables',
     'entry_logs',
     'promoter_contacts',
     'promoter_guest_entries',
     'event_archives',
     'venues',
     'events'
   )
 order by tablename, policyname;

select 'transitional_policies_remaining' as check_name,
       tablename,
       policyname
  from pg_policies
 where schemaname = 'public'
   and policyname like 'co_phase0b_%'
 order by tablename, policyname;

select 'anon_table_grants' as check_name,
       table_name,
       privilege_type
  from information_schema.table_privileges
 where table_schema = 'public'
   and grantee = 'anon'
   and table_name in (
     'staff_users',
     'club_tables',
     'entry_logs',
     'promoter_contacts',
     'promoter_guest_entries',
     'event_archives',
     'venues',
     'events'
   )
 order by table_name, privilege_type;

select 'authenticated_staff_users_grants' as check_name,
       table_name,
       privilege_type
  from information_schema.table_privileges
 where table_schema = 'public'
   and grantee = 'authenticated'
   and table_name = 'staff_users'
 order by privilege_type;

select 'function_security' as check_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as return_type,
       case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security_mode,
       p.proconfig as config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'current_staff_role',
     'current_staff_username',
     'current_active_event_id',
     'current_active_event_date',
     'get_my_profile',
     'get_active_event_context',
     'get_security_table_snapshot',
     'list_activatable_club_events',
     'bootstrap_club_event_v2',
     'get_invite',
     'public_events',
     'add_expense',
     'add_expense_v2',
     'add_expense_v3',
     'add_entry_log_v2',
     'activate_club_event_v2',
     'close_club_event_v2',
     'check_in_invitation',
     'check_in_invitation_v2',
     'create_promoter_invitation_v2',
     'co_is_server_table_scope',
     'co_enforce_club_table_server_scope',
     'co_enforce_promoter_guest_entry_update'
   )
 order by p.proname, arguments;

select 'function_grants' as check_name,
       routine_name,
       grantee,
       privilege_type
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and routine_name in (
     'get_invite',
     'public_events',
     'add_expense',
     'add_expense_v2',
     'add_expense_v3',
     'add_entry_log_v2',
     'activate_club_event_v2',
     'bootstrap_club_event_v2',
     'close_club_event_v2',
     'list_activatable_club_events',
     'check_in_invitation',
     'check_in_invitation_v2',
     'create_promoter_invitation_v2'
   )
 order by routine_name, grantee;

select 'policy_matrix_markers' as check_name,
       tablename,
       policyname,
       case
         when policyname in ('pc_select_promoter_own','pc_insert_promoter_own','pc_update_promoter_own','pc_delete_promoter_own') then 'promoter_contacts_scoped'
         when policyname in ('pge_select_promoter_own','pge_insert_promoter_own','pge_update_promoter_own','pge_delete_promoter_own') then 'promoter_guest_entries_scoped'
         when policyname = 'club_tables_update_server' then 'server_tables_scoped'
         when policyname = 'entry_logs_insert_counter' then 'counter_flux_scoped'
         else 'other'
       end as expected_contract
  from pg_policies
 where schemaname = 'public'
   and policyname in (
     'pc_select_promoter_own',
     'pc_insert_promoter_own',
     'pc_update_promoter_own',
     'pc_delete_promoter_own',
     'pge_select_promoter_own',
     'pge_insert_promoter_own',
     'pge_update_promoter_own',
     'pge_delete_promoter_own',
     'club_tables_update_server',
     'entry_logs_insert_counter'
   )
 order by tablename, policyname;

select 'runtime_state' as check_name,
       count(*) as runtime_rows,
       count(*) filter (where active_event_id is null) as missing_active_event,
       count(*) filter (where bootstrap_completed_at is null) as bootstrap_not_completed,
       count(*) filter (where last_closed_event_id is not null) as has_last_closed_event
  from public.club_runtime_state;

select 'runtime_invalid_states' as check_name,
       crs.id,
       crs.active_event_id,
       crs.bootstrap_completed_at,
       crs.last_closed_event_id,
       e.status as active_event_status,
       case
         when crs.id is distinct from true then 'id_not_true'
         when crs.bootstrap_completed_at is null and crs.active_event_id is not null then 'active_without_bootstrap'
         when crs.bootstrap_completed_at is null and crs.last_closed_event_id is not null then 'last_closed_without_bootstrap'
         when crs.active_event_id is not null and crs.active_event_id = crs.last_closed_event_id then 'active_equals_last_closed'
         when e.status = 'archived' then 'active_event_archived'
         when e.status is not null and e.status not in ('draft','published') then 'active_event_not_activatable'
         else 'ok'
       end as status
  from public.club_runtime_state crs
  left join public.events e on e.id = crs.active_event_id
 where crs.id is distinct from true
    or (crs.bootstrap_completed_at is null and crs.active_event_id is not null)
    or (crs.bootstrap_completed_at is null and crs.last_closed_event_id is not null)
    or (crs.active_event_id is not null and crs.active_event_id = crs.last_closed_event_id)
    or e.status = 'archived'
    or (e.status is not null and e.status not in ('draft','published'));

select 'event_scope_gaps' as check_name,
       'club_tables_without_event_id' as item,
       count(*) as row_count
  from public.club_tables ct
 where not (to_jsonb(ct) ? 'event_id')
    or to_jsonb(ct)->>'event_id' is null
union all
select 'event_scope_gaps',
       'entry_logs_without_event_id',
       count(*)
  from public.entry_logs el
 where not (to_jsonb(el) ? 'event_id')
    or to_jsonb(el)->>'event_id' is null
union all
select 'event_scope_gaps',
       'entry_logs_without_event_date',
       count(*)
  from public.entry_logs el
 where not (to_jsonb(el) ? 'event_date')
    or to_jsonb(el)->>'event_date' is null
union all
select 'event_scope_gaps',
       'invitations_without_event_id',
       count(*)
  from public.promoter_guest_entries pge
 where not (to_jsonb(pge) ? 'event_id')
    or to_jsonb(pge)->>'event_id' is null;
