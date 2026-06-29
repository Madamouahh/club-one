-- Atomic operations preflight - read only
-- Run in Supabase SQL Editor before applying 0005, 0006, 0007.
-- This file is intentionally SELECT-only.

select '01_expected_tables' as section,
       expected.table_schema,
       expected.table_name,
       case when t.table_name is null then 'missing' else 'ok' end as status
from (
  values
    ('public', 'club_tables'),
    ('public', 'promoter_guest_entries'),
    ('public', 'entry_logs'),
    ('public', 'staff_users')
) as expected(table_schema, table_name)
left join information_schema.tables t
  on t.table_schema = expected.table_schema
 and t.table_name = expected.table_name
order by expected.table_name;

select '02_expected_columns' as section,
       expected.table_name,
       expected.column_name,
       expected.expected_type,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       case
         when c.column_name is null then 'missing'
         when expected.expected_type = 'any' then 'ok'
         when c.data_type = expected.expected_type then 'ok'
         when c.udt_name = expected.expected_type then 'ok'
         else 'type_mismatch'
       end as status
from (
  values
    ('club_tables', 'id', 'any'),
    ('club_tables', 'expenses', 'jsonb'),
    ('club_tables', 'status', 'any'),
    ('club_tables', 'updated_at', 'timestamp with time zone'),
    ('promoter_guest_entries', 'qr_token', 'text'),
    ('promoter_guest_entries', 'checked_in', 'boolean'),
    ('promoter_guest_entries', 'checked_in_at', 'timestamp with time zone'),
    ('promoter_guest_entries', 'checked_in_by', 'text'),
    ('promoter_guest_entries', 'event_date', 'date'),
    ('promoter_guest_entries', 'guest_name', 'text'),
    ('promoter_guest_entries', 'promoter_username', 'text'),
    ('entry_logs', 'type', 'text'),
    ('entry_logs', 'staff_username', 'text'),
    ('staff_users', 'auth_id', 'uuid')
) as expected(table_name, column_name, expected_type)
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = expected.table_name
 and c.column_name = expected.column_name
order by expected.table_name, expected.column_name;

select '03_expenses_column_type' as section,
       c.table_name,
       c.column_name,
       c.data_type,
       c.udt_name,
       case when c.data_type = 'jsonb' then 'ok' else 'blocking_type_mismatch' end as status
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'club_tables'
  and c.column_name = 'expenses';

select '04_existing_functions' as section,
       n.nspname as schema_name,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as return_type,
       case p.prosecdef when true then 'security_definer' else 'security_invoker' end as security_mode,
       p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'current_staff_username',
    'current_staff_role',
    'add_expense',
    'add_expense_v2',
    'check_in_invitation'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

select '05_function_presence_matrix' as section,
       expected.function_name,
       expected.expected_arguments,
       case when p.oid is null then 'missing_or_not_yet_present' else 'present' end as status,
       pg_get_function_result(p.oid) as return_type
from (
  values
    ('current_staff_username', ''),
    ('current_staff_role', ''),
    ('add_expense', 'p_table_id text, p_label text, p_amount numeric, p_date_key text'),
    ('add_expense_v2', 'p_table_id text, p_label text, p_amount numeric, p_date_key text'),
    ('check_in_invitation', 'p_token text, p_event_date text')
) as expected(function_name, expected_arguments)
left join pg_proc p
  on p.proname = expected.function_name
 and pg_get_function_identity_arguments(p.oid) = expected.expected_arguments
left join pg_namespace n
  on n.oid = p.pronamespace
 and n.nspname = 'public'
order by expected.function_name;

select '06_routine_execute_privileges' as section,
       routine_schema,
       routine_name,
       grantee,
       privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'current_staff_username',
    'current_staff_role',
    'add_expense',
    'add_expense_v2',
    'check_in_invitation'
  )
order by routine_name, grantee;

select '07_rls_enabled' as section,
       n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('club_tables', 'promoter_guest_entries', 'entry_logs', 'staff_users')
order by c.relname;

select '08_rls_policies' as section,
       schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('club_tables', 'promoter_guest_entries', 'entry_logs', 'staff_users')
order by tablename, policyname;

select '08b_security_phase_state' as section,
       'atomic_preflight_runs_before_0008' as note,
       'rls and anon rights can be transitional here; final security is verified by phase0b_post_cutover_verification.sql' as expected_interpretation;

select '09_staff_roles_present' as section,
       role,
       count(*) as staff_count,
       count(auth_id) as staff_with_auth_id
from public.staff_users
group by role
order by role;

select '10_staff_auth_id_summary' as section,
       count(*) as total_staff,
       count(auth_id) as with_auth_id,
       count(*) - count(auth_id) as missing_auth_id
from public.staff_users;

select '11_qr_quality_summary' as section,
       count(*) as total_invitations,
       count(*) filter (where qr_token is null) as qr_token_null,
       count(*) filter (where qr_token is not null and btrim(qr_token) = '') as qr_token_empty,
       count(*) filter (where checked_in is null) as checked_in_null
from public.promoter_guest_entries;

select '12_qr_duplicate_non_empty_tokens' as section,
       btrim(qr_token) as qr_token,
       count(*) as duplicate_count
from public.promoter_guest_entries
where qr_token is not null
  and btrim(qr_token) <> ''
group by btrim(qr_token)
having count(*) > 1
order by duplicate_count desc, qr_token;

select '13_qr_token_indexes' as section,
       schemaname,
       tablename,
       indexname,
       indexdef,
       case when indexname = 'promoter_guest_entries_qr_token_unique_idx' then 'target_unique_index' else 'existing_index' end as index_role
from pg_indexes
where schemaname = 'public'
  and tablename = 'promoter_guest_entries'
  and indexdef ilike '%qr_token%'
order by indexname;

select '14_expenses_quality_summary' as section,
       count(*) as total_tables,
       count(*) filter (where expenses is null) as expenses_null,
       count(*) filter (where expenses is not null and jsonb_typeof(expenses) <> 'array') as expenses_not_json_array
from public.club_tables;

select '15_expenses_incompatible_rows' as section,
       id,
       jsonb_typeof(expenses) as expenses_json_type,
       expenses
from public.club_tables
where expenses is not null
  and jsonb_typeof(expenses) <> 'array'
order by id;

select '16_blocking_summary' as section,
       check_name,
       status,
       details
from (
  select 'missing_expected_table' as check_name,
         case when count(*) = 0 then 'ok' else 'blocking' end as status,
         string_agg(table_name, ', ' order by table_name) as details
  from (
    select expected.table_name
    from (
      values ('club_tables'), ('promoter_guest_entries'), ('entry_logs'), ('staff_users')
    ) as expected(table_name)
    left join information_schema.tables t
      on t.table_schema = 'public'
     and t.table_name = expected.table_name
    where t.table_name is null
  ) missing

  union all

  select 'club_tables_expenses_not_jsonb',
         case when max(case when c.data_type = 'jsonb' then 1 else 0 end) = 1 then 'ok' else 'blocking' end,
         coalesce(max(c.data_type || '/' || c.udt_name), 'missing')
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'club_tables'
    and c.column_name = 'expenses'

  union all

  select 'duplicate_non_empty_qr_tokens',
         case when count(*) = 0 then 'ok' else 'blocking' end,
         coalesce(string_agg(qr_token || ' x' || duplicate_count::text, ', ' order by qr_token), 'none')
  from (
    select btrim(qr_token) as qr_token, count(*) as duplicate_count
    from public.promoter_guest_entries
    where qr_token is not null
      and btrim(qr_token) <> ''
    group by btrim(qr_token)
    having count(*) > 1
  ) d

  union all

  select 'missing_staff_helpers',
         case when count(*) = 2 then 'ok' else 'blocking' end,
         'present=' || count(*)::text || '/2'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('current_staff_username', 'current_staff_role')

  union all

  select 'missing_authenticated_table_privileges_for_invoker_rpcs',
         case when count(*) = 0 then 'ok' else 'blocking' end,
         coalesce(string_agg(table_name || ':' || privilege_type, ', ' order by table_name, privilege_type), 'none')
  from (
    select expected.table_name, expected.privilege_type
    from (
      values
        ('club_tables', 'UPDATE'),
        ('promoter_guest_entries', 'SELECT'),
        ('promoter_guest_entries', 'UPDATE'),
        ('entry_logs', 'INSERT')
    ) as expected(table_name, privilege_type)
    where to_regclass('public.' || expected.table_name) is not null
      and not exists (
        select 1
          from information_schema.role_table_grants g
         where g.table_schema = 'public'
           and g.table_name = expected.table_name
           and g.grantee = 'authenticated'
           and g.privilege_type = expected.privilege_type
      )
  ) missing_privileges
) checks
order by check_name;

select '17_readiness_summary' as section,
       readiness_name,
       status,
       details
from (
  select 'atomic_ready' as readiness_name,
         case when count(*) = 0 then 'ok' else 'blocking' end as status,
         coalesce(string_agg(issue, ', ' order by issue), 'none') as details
  from (
    select 'missing_table:' || expected.table_name as issue
    from (values ('club_tables'), ('promoter_guest_entries'), ('entry_logs'), ('staff_users')) as expected(table_name)
    left join information_schema.tables t
      on t.table_schema = 'public'
     and t.table_name = expected.table_name
    where t.table_name is null
    union all
    select 'club_tables.expenses_not_jsonb'
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'club_tables'
      and c.column_name = 'expenses'
      and c.data_type <> 'jsonb'
    union all
    select 'duplicate_qr_token'
    from (
      select btrim(qr_token) as qr_token
      from public.promoter_guest_entries
      where qr_token is not null
        and btrim(qr_token) <> ''
      group by btrim(qr_token)
      having count(*) > 1
      limit 1
    ) d
    union all
    select 'missing_authenticated_privilege:' || expected.table_name || ':' || expected.privilege_type
    from (
      values
        ('club_tables', 'UPDATE'),
        ('promoter_guest_entries', 'SELECT'),
        ('promoter_guest_entries', 'UPDATE'),
        ('entry_logs', 'INSERT')
    ) as expected(table_name, privilege_type)
    where to_regclass('public.' || expected.table_name) is not null
      and not exists (
        select 1
          from information_schema.role_table_grants g
         where g.table_schema = 'public'
           and g.table_name = expected.table_name
           and g.grantee = 'authenticated'
           and g.privilege_type = expected.privilege_type
      )
  ) atomic_issues

  union all

  select 'phase0b_cutover_ready',
         case when count(*) = 0 then 'ok' else 'blocking' end,
         coalesce(string_agg(issue, ', ' order by issue), 'none')
  from (
    select 'staff_without_auth_id' as issue
    where exists (
      select 1
        from public.staff_users
       where auth_id is null
    )
    union all
    select 'missing_helper:' || expected.signature
    from (values
      ('public.current_staff_username()'),
      ('public.current_staff_role()')
    ) as expected(signature)
    where to_regprocedure(expected.signature) is null
  ) cutover_issues

  union all

  select 'post_cutover_security_verified',
         'not_applicable_before_0008',
         'run supabase/verification/phase0b_post_cutover_verification.sql after 0008'
) readiness
order by readiness_name;
