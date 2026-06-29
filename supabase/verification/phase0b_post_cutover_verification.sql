-- phase0b_post_cutover_verification.sql
-- Verification lecture seule apres 0008_phase0b_rls_cutover.sql.

select 'staff_auth_links' as check_name,
       count(*) as staff_count,
       count(*) filter (where nullif(to_jsonb(s)->>'auth_id', '') is not null) as linked_count
from public.staff_users s;

select 'staff_auth_links_missing' as check_name,
       username
from public.staff_users s
where nullif(to_jsonb(s)->>'auth_id', '') is null
order by username;

select 'staff_auth_links_without_auth_user' as check_name,
       s.username,
       to_jsonb(s)->>'auth_id' as auth_id
from public.staff_users s
left join auth.users u on u.id = nullif(to_jsonb(s)->>'auth_id', '')::uuid
where nullif(to_jsonb(s)->>'auth_id', '') is not null
  and u.id is null
order by s.username;

select 'helper_functions' as check_name,
       expected.function_name,
       case when p.oid is null then 'missing' else 'present' end as status,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as returns
from (values
  ('current_staff_role'),
  ('current_staff_username'),
  ('get_my_profile'),
  ('get_invite'),
  ('public_events'),
  ('add_expense'),
  ('add_expense_v2'),
  ('check_in_invitation')
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
  ('public.get_invite(text)'),
  ('public.public_events()'),
  ('public.add_expense(text,text,numeric,text)'),
  ('public.add_expense_v2(text,text,numeric,text)'),
  ('public.check_in_invitation(text,text)')
) as expected(signature)
order by expected.signature;

select 'rls_state' as check_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled
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

select 'rls_policies' as check_name,
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

select 'transitional_policies_remaining' as check_name,
       tablename,
       policyname,
       roles,
       cmd
from pg_policies
where schemaname = 'public'
  and policyname like 'co_phase0b_%'
order by tablename, policyname;

select 'anon_direct_table_grants' as check_name,
       table_schema,
       table_name,
       privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
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

select 'authenticated_required_table_grants' as check_name,
       expected.table_name,
       expected.privilege_type,
       case
         when exists (
           select 1
             from information_schema.role_table_grants g
            where g.table_schema = 'public'
              and g.table_name = expected.table_name
              and g.grantee = 'authenticated'
              and g.privilege_type = expected.privilege_type
         ) then 'ok'
         else 'missing'
       end as status
from (values
  ('club_tables', 'SELECT'),
  ('club_tables', 'INSERT'),
  ('club_tables', 'UPDATE'),
  ('club_tables', 'DELETE'),
  ('entry_logs', 'SELECT'),
  ('entry_logs', 'INSERT'),
  ('entry_logs', 'DELETE'),
  ('promoter_contacts', 'SELECT'),
  ('promoter_contacts', 'INSERT'),
  ('promoter_contacts', 'UPDATE'),
  ('promoter_contacts', 'DELETE'),
  ('promoter_guest_entries', 'SELECT'),
  ('promoter_guest_entries', 'INSERT'),
  ('promoter_guest_entries', 'UPDATE'),
  ('promoter_guest_entries', 'DELETE'),
  ('event_archives', 'SELECT'),
  ('event_archives', 'INSERT'),
  ('event_archives', 'UPDATE'),
  ('event_archives', 'DELETE'),
  ('venues', 'SELECT'),
  ('events', 'SELECT'),
  ('events', 'INSERT'),
  ('events', 'UPDATE'),
  ('events', 'DELETE')
) as expected(table_name, privilege_type)
order by expected.table_name, expected.privilege_type;

select 'post_cutover_blocking_summary' as check_name,
       case when count(*) = 0 then 'ok' else 'blocking' end as status,
       count(*) as blocking_items
from (
  select 'anon_direct_grant:' || table_name || ':' || privilege_type as item
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
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
  union all
  select 'transitional_policy_remaining:' || tablename || ':' || policyname
    from pg_policies
   where schemaname = 'public'
     and policyname like 'co_phase0b_%'
  union all
  select 'rls_disabled:' || c.relname
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
     and not c.relrowsecurity
) blockers;

select 'staff_users_direct_grants' as check_name,
       grantee,
       privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'staff_users'
  and grantee in ('anon','authenticated')
order by grantee, privilege_type;

select 'function_execute_privileges' as check_name,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'current_staff_role',
    'current_staff_username',
    'get_my_profile',
    'get_invite',
    'public_events',
    'add_expense',
    'add_expense_v2',
    'check_in_invitation'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

select 'expected_role_matrix' as check_name,
       *
from (values
  ('admin', 'club_tables read/write, entries read/delete, contacts guests archives events write'),
  ('manager', 'club_tables read/write, entries read/delete, contacts guests archives events write'),
  ('server', 'club_tables read/write, entries read, contacts guests events read'),
  ('security', 'entries read/insert own, guests read/write for QR'),
  ('security_counter', 'entries read/insert own, guests read/write for QR'),
  ('promoter', 'club_tables read/write, contacts guests events write')
) as matrix(role, expected_access);

select 'staff_users_has_no_direct_client_access_expected' as check_name,
       not exists (
         select 1
           from information_schema.role_table_grants
          where table_schema = 'public'
            and table_name = 'staff_users'
            and grantee in ('anon','authenticated')
       ) as ok;
