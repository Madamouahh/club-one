-- phase0b_auth_preflight.sql
-- Verification lecture seule avant seed Auth et cutover RLS Phase 0b.

select 'staff_auth_id_column' as check_name,
       case when exists (
         select 1
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'staff_users'
            and column_name = 'auth_id'
            and data_type = 'uuid'
       ) then 'ok' else 'missing_or_wrong_type' end as status;

select 'manual_auth_provider_check' as check_name,
       'Supabase Auth public signups must be disabled or controlled before Phase A testing' as required_human_check,
       'SQL cannot fully verify provider settings; policies still deny Auth users not linked to staff_users.auth_id' as note;

select 'staff_count' as check_name, count(*)::text as value
from public.staff_users;

select 'staff_roles' as check_name,
       coalesce(role, '<null>') as role,
       count(*) as count
from public.staff_users
group by role
order by role;

select 'auth_users_count' as check_name, count(*)::text as value
from auth.users;

select 'clubone_auth_users_count' as check_name, count(*)::text as value
from auth.users
where lower(coalesce(email, '')) like '%@clubone.local';

select 'staff_without_auth_id' as check_name,
       username
from public.staff_users s
where nullif(to_jsonb(s)->>'auth_id', '') is null
order by username;

select 'staff_auth_id_without_auth_user' as check_name,
       s.username,
       to_jsonb(s)->>'auth_id' as auth_id
from public.staff_users s
left join auth.users u on u.id = nullif(to_jsonb(s)->>'auth_id', '')::uuid
where nullif(to_jsonb(s)->>'auth_id', '') is not null
  and u.id is null
order by s.username;

select 'clubone_auth_user_without_staff' as check_name,
       u.email
from auth.users u
left join public.staff_users s
  on lower(s.username) = lower(split_part(u.email, '@', 1))
where lower(coalesce(u.email, '')) like '%@clubone.local'
  and s.id is null
order by u.email;

select 'duplicate_staff_username' as check_name,
       lower(username) as username,
       count(*) as count
from public.staff_users
group by lower(username)
having count(*) > 1
order by lower(username);

select 'duplicate_staff_auth_id' as check_name,
       to_jsonb(s)->>'auth_id' as auth_id,
       count(*) as count
from public.staff_users s
where nullif(to_jsonb(s)->>'auth_id', '') is not null
group by to_jsonb(s)->>'auth_id'
having count(*) > 1
order by to_jsonb(s)->>'auth_id';

select 'helper_functions' as check_name,
       expected.function_name,
       case when p.oid is null then 'missing' else 'present' end as status,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as returns
from (values
  ('current_staff_role'),
  ('current_staff_username'),
  ('get_my_profile'),
  ('get_invite')
) as expected(function_name)
left join pg_proc p
  on p.pronamespace = 'public'::regnamespace
 and p.proname = expected.function_name
order by expected.function_name;

select 'expected_function_signatures' as check_name,
       expected.signature,
       case when to_regprocedure(expected.signature) is null then 'missing' else 'present' end as status
from (values
  ('public.current_staff_role()'),
  ('public.current_staff_username()'),
  ('public.get_my_profile()'),
  ('public.get_invite(text)')
) as expected(signature)
order by expected.signature;

select 'function_execute_privileges' as check_name,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('current_staff_role','current_staff_username','get_my_profile','get_invite')
order by p.proname, pg_get_function_identity_arguments(p.oid);

select 'rls_state' as check_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'staff_users',
    'club_tables',
    'entry_logs',
    'promoter_contacts',
    'promoter_guest_entries',
    'event_archives',
    'venues',
    'events'
  )
order by c.relname;

select 'pre_cutover_table_privileges' as check_name,
       tables.table_name,
       coalesce(string_agg(distinct anon.privilege_type, ', ' order by anon.privilege_type), '<none>') as anon_privileges,
       coalesce(string_agg(distinct auth.privilege_type, ', ' order by auth.privilege_type), '<none>') as authenticated_privileges,
       coalesce(cls.relrowsecurity, false) as rls_enabled
from (values
  ('club_tables'),
  ('entry_logs'),
  ('promoter_contacts'),
  ('promoter_guest_entries'),
  ('event_archives'),
  ('venues'),
  ('events'),
  ('staff_users')
) as tables(table_name)
left join pg_class cls
  on cls.relname = tables.table_name
 and cls.relnamespace = 'public'::regnamespace
left join information_schema.role_table_grants anon
  on anon.table_schema = 'public'
 and anon.table_name = tables.table_name
 and anon.grantee = 'anon'
left join information_schema.role_table_grants auth
  on auth.table_schema = 'public'
 and auth.table_name = tables.table_name
 and auth.grantee = 'authenticated'
group by tables.table_name, cls.relrowsecurity
order by tables.table_name;

select 'pre_cutover_authenticated_bridge' as check_name,
       expected.table_name,
       expected.privilege_type,
       case
         when to_regclass('public.' || expected.table_name) is null then 'missing_table'
         when exists (
           select 1
             from information_schema.role_table_grants g
            where g.table_schema = 'public'
              and g.table_name = expected.table_name
              and g.grantee = 'authenticated'
              and g.privilege_type = expected.privilege_type
         ) then 'ok'
         else 'missing_authenticated_grant'
       end as status
from (values
  ('club_tables', 'SELECT'),
  ('club_tables', 'INSERT'),
  ('club_tables', 'UPDATE'),
  ('entry_logs', 'SELECT'),
  ('entry_logs', 'INSERT'),
  ('promoter_contacts', 'SELECT'),
  ('promoter_contacts', 'INSERT'),
  ('promoter_guest_entries', 'SELECT'),
  ('promoter_guest_entries', 'INSERT'),
  ('promoter_guest_entries', 'UPDATE'),
  ('event_archives', 'INSERT')
) as expected(table_name, privilege_type)
order by expected.table_name, expected.privilege_type;

select 'pre_cutover_front_auth_blocking_summary' as check_name,
       case when count(*) = 0 then 'ok' else 'blocking' end as status,
       count(*) as missing_required_authenticated_grants
from (values
  ('club_tables', 'SELECT'),
  ('club_tables', 'INSERT'),
  ('club_tables', 'UPDATE'),
  ('entry_logs', 'SELECT'),
  ('entry_logs', 'INSERT'),
  ('promoter_contacts', 'SELECT'),
  ('promoter_contacts', 'INSERT'),
  ('promoter_guest_entries', 'SELECT'),
  ('promoter_guest_entries', 'INSERT'),
  ('promoter_guest_entries', 'UPDATE'),
  ('event_archives', 'INSERT')
) as expected(table_name, privilege_type)
where to_regclass('public.' || expected.table_name) is not null
  and not exists (
    select 1
      from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.table_name = expected.table_name
       and g.grantee = 'authenticated'
       and g.privilege_type = expected.privilege_type
  );

select 'pre_cutover_unlinked_auth_protection' as check_name,
       expected.policyname,
       case
         when exists (
           select 1
             from pg_policies p
            where p.schemaname = 'public'
              and p.tablename = expected.tablename
              and p.policyname = expected.policyname
              and p.roles::text like '%authenticated%'
              and (coalesce(p.qual, '') like '%current_staff_role%' or coalesce(p.with_check, '') like '%current_staff_role%' or coalesce(p.with_check, '') like '%current_staff_username%')
         ) then 'ok'
         else 'missing_staff_link_policy'
       end as status
from (values
  ('club_tables', 'co_phase0b_auth_club_tables_select'),
  ('club_tables', 'co_phase0b_auth_club_tables_insert'),
  ('club_tables', 'co_phase0b_auth_club_tables_update'),
  ('entry_logs', 'co_phase0b_auth_entry_logs_select'),
  ('entry_logs', 'co_phase0b_auth_entry_logs_insert'),
  ('promoter_contacts', 'co_phase0b_auth_promoter_contacts_select'),
  ('promoter_contacts', 'co_phase0b_auth_promoter_contacts_insert'),
  ('promoter_guest_entries', 'co_phase0b_auth_pge_select'),
  ('promoter_guest_entries', 'co_phase0b_auth_pge_insert'),
  ('promoter_guest_entries', 'co_phase0b_auth_pge_update'),
  ('event_archives', 'co_phase0b_auth_event_archives_insert')
) as expected(tablename, policyname)
order by expected.tablename, expected.policyname;

select 'rls_policies' as check_name,
       schemaname,
       tablename,
       policyname,
       roles,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'staff_users',
    'club_tables',
    'entry_logs',
    'promoter_contacts',
    'promoter_guest_entries',
    'event_archives',
    'venues',
    'events'
  )
order by tablename, policyname;

select 'phase0b_transitional_policies' as check_name,
       tablename,
       policyname,
       roles,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
  and policyname like 'co_phase0b_%'
order by tablename, policyname;

select 'legacy_password_column' as check_name,
       case when exists (
         select 1
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'staff_users'
            and column_name = 'password'
       ) then 'present' else 'absent' end as status;

select 'legacy_password_non_null_count' as check_name,
       count(*)::text as value
from public.staff_users s
where to_jsonb(s) ? 'password'
  and nullif(to_jsonb(s)->>'password', '') is not null;
