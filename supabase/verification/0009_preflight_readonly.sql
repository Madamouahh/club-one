-- 0009_preflight_readonly.sql
-- Lecture seule. A lancer dans SQL Editor avant toute etude d'execution de 0009.

with expected_tables(table_name) as (
  values
    ('staff_users'),
    ('club_runtime_state'),
    ('club_tables'),
    ('entry_logs'),
    ('promoter_contacts'),
    ('promoter_guest_entries'),
    ('event_archives'),
    ('venues'),
    ('events')
)
select 'tables' as check_name,
       e.table_name,
       case when c.oid is null then 'missing' else 'present' end as status
  from expected_tables e
  left join pg_class c on c.relname = e.table_name
  left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
 order by e.table_name;

with expected_columns(table_name, column_name) as (
  values
    ('staff_users','auth_id'),
    ('club_runtime_state','active_event_id'),
    ('club_runtime_state','bootstrap_completed_at'),
    ('club_runtime_state','last_closed_event_id'),
    ('club_runtime_state','updated_at'),
    ('club_runtime_state','updated_by'),
    ('club_tables','id'),
    ('club_tables','assigned_to'),
    ('club_tables','expenses'),
    ('club_tables','event_id'),
    ('entry_logs','type'),
    ('entry_logs','staff_username'),
    ('entry_logs','event_date'),
    ('entry_logs','event_id'),
    ('promoter_contacts','promoter_username'),
    ('promoter_guest_entries','promoter_username'),
    ('promoter_guest_entries','qr_token'),
    ('promoter_guest_entries','checked_in'),
    ('promoter_guest_entries','checked_in_at'),
    ('promoter_guest_entries','checked_in_by'),
    ('promoter_guest_entries','event_date'),
    ('promoter_guest_entries','event_id'),
    ('event_archives','event_date'),
    ('event_archives','event_id')
)
select 'columns' as check_name,
       e.table_name,
       e.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.column_default,
       case when c.column_name is null then 'missing' else 'present' end as status
  from expected_columns e
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = e.table_name
   and c.column_name = e.column_name
 order by e.table_name, e.column_name;

select 'constraints' as check_name,
       conrelid::regclass::text as table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) as definition
  from pg_constraint
 where connamespace = 'public'::regnamespace
   and conrelid::regclass::text in (
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
 order by table_name, conname;

select 'indexes' as check_name,
       schemaname,
       tablename,
       indexname,
       indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename in (
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
 order by tablename, indexname;

select 'rls' as check_name,
       n.nspname as schema_name,
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

select 'policies' as check_name,
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
   and tablename in (
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
 order by tablename, policyname;

select 'grants' as check_name,
       table_schema,
       table_name,
       grantee,
       privilege_type
  from information_schema.table_privileges
 where table_schema = 'public'
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
 order by table_name, grantee, privilege_type;

select 'functions' as check_name,
       n.nspname as schema_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as return_type,
       case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security_mode,
       p.proconfig as config,
       r.rolname as owner_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
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
       routine_schema,
       routine_name,
       grantee,
       privilege_type
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and routine_name in (
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
     'create_promoter_invitation_v2'
   )
 order by routine_name, grantee;

select 'auth_links' as check_name,
       count(*) as total_staff,
       count(*) filter (where auth_id is null) as missing_auth_id,
       count(*) filter (where auth_id is not null) as linked_auth_id
  from public.staff_users;

select 'auth_id_duplicates' as check_name,
       auth_id,
       count(*) as row_count
  from public.staff_users
 where auth_id is not null
 group by auth_id
having count(*) > 1
 order by row_count desc, auth_id;

select 'auth_id_unmatched' as check_name,
       s.username,
       s.auth_id
  from public.staff_users s
  left join auth.users u on u.id = s.auth_id
 where s.auth_id is not null
   and u.id is null
 order by s.username;

select 'unknown_roles' as check_name,
       username,
       role
  from public.staff_users
 where nullif(btrim(coalesce(role, '')), '') is null
    or role not in ('admin','manager','server','security','security_counter','promoter')
 order by username;

select 'club_tables_count' as check_name,
       count(*) as row_count
  from public.club_tables;

select 'unknown_assignments' as check_name,
       assigned_to,
       count(*) as row_count
  from public.club_tables
 where nullif(btrim(coalesce(assigned_to, '')), '') is not null
   and assigned_to not in (select username from public.staff_users)
   and assigned_to not in ('server','jeremy')
 group by assigned_to
 order by assigned_to;

select 'contacts_without_valid_promoter' as check_name,
       promoter_username,
       count(*) as row_count
  from public.promoter_contacts pc
 where nullif(btrim(coalesce(promoter_username, '')), '') is null
    or not exists (
      select 1 from public.staff_users s
       where s.username = pc.promoter_username
         and s.role = 'promoter'
    )
 group by promoter_username
 order by promoter_username;

select 'invitations_without_valid_promoter' as check_name,
       promoter_username,
       count(*) as row_count
  from public.promoter_guest_entries pge
 where nullif(btrim(coalesce(promoter_username, '')), '') is null
    or not exists (
      select 1 from public.staff_users s
       where s.username = pge.promoter_username
         and s.role = 'promoter'
    )
 group by promoter_username
 order by promoter_username;

select 'qr_quality' as check_name,
       count(*) as total_invitations,
       count(*) filter (where qr_token is null) as null_tokens,
       count(*) filter (where qr_token is not null and btrim(qr_token) = '') as empty_tokens,
       count(*) filter (where checked_in is null) as null_checked_in
  from public.promoter_guest_entries;

select 'qr_duplicates' as check_name,
       btrim(qr_token) as qr_token,
       count(*) as row_count
  from public.promoter_guest_entries
 where qr_token is not null
   and btrim(qr_token) <> ''
 group by btrim(qr_token)
having count(*) > 1
 order by row_count desc, qr_token;

select 'events_today' as check_name,
       event_date,
       status,
       count(*) as row_count
  from public.events
 where event_date = current_date
 group by event_date, status
 order by status;

select 'runtime_state' as check_name,
       count(*) as runtime_rows,
       count(*) filter (where active_event_id is null) as missing_active_event,
       count(*) filter (where bootstrap_completed_at is null) as bootstrap_not_completed,
       count(*) filter (where last_closed_event_id is not null) as has_last_closed_event
  from public.club_runtime_state;

select 'runtime_active_event' as check_name,
       crs.active_event_id,
       crs.bootstrap_completed_at,
       crs.last_closed_event_id,
       e.event_date,
       e.title,
       case when e.id is null then 'missing_event' else 'ok' end as status
  from public.club_runtime_state crs
  left join public.events e on e.id = crs.active_event_id;

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

select 'event_archive_duplicates' as check_name,
       event_id,
       count(*) as row_count
  from public.event_archives
 where event_id is not null
 group by event_id
having count(*) > 1
 order by row_count desc, event_id;

select 'event_date_duplicates' as check_name,
       event_date,
       count(*) as row_count
  from public.events
 group by event_date
having count(*) > 1
 order by event_date;

select 'archive_date_duplicates' as check_name,
       event_date::date as event_date,
       count(*) as row_count
  from public.event_archives
 where event_date is not null
 group by event_date::date
having count(*) > 1
 order by event_date;

with event_date_counts as (
  select event_date, count(*) as event_count
    from public.events
   group by event_date
),
archive_date_counts as (
  select event_date::date as event_date, count(*) as archive_count
    from public.event_archives
   where event_date is not null
   group by event_date::date
)
select 'archives_attachable_without_event_id' as check_name,
       ea.event_date::date as event_date,
       count(*) as row_count
  from public.event_archives ea
  join event_date_counts edc on edc.event_date = ea.event_date::date and edc.event_count = 1
  join archive_date_counts adc on adc.event_date = ea.event_date::date and adc.archive_count = 1
 where ea.event_id is null
 group by ea.event_date::date
 order by event_date;

with event_date_counts as (
  select event_date, count(*) as event_count
    from public.events
   group by event_date
),
archive_date_counts as (
  select event_date::date as event_date, count(*) as archive_count
    from public.event_archives
   where event_date is not null
   group by event_date::date
)
select 'archives_ambiguous_without_event_id' as check_name,
       ea.event_date::date as event_date,
       coalesce(edc.event_count, 0) as matching_events,
       coalesce(adc.archive_count, 0) as archives_for_date,
       count(*) as row_count
  from public.event_archives ea
  left join event_date_counts edc on edc.event_date = ea.event_date::date
  left join archive_date_counts adc on adc.event_date = ea.event_date::date
 where ea.event_id is null
   and (
     coalesce(edc.event_count, 0) <> 1
     or coalesce(adc.archive_count, 0) <> 1
   )
 group by ea.event_date::date, edc.event_count, adc.archive_count
 order by event_date;

select 'archives_event_date_mismatch' as check_name,
       ea.event_id,
       ea.event_date::date as archive_event_date,
       e.event_date as event_event_date
  from public.event_archives ea
  join public.events e on e.id = ea.event_id
 where ea.event_id is not null
   and ea.event_date::date is distinct from e.event_date
 order by ea.event_date::date, ea.event_id;

select 'known_event_statuses' as check_name,
       status,
       count(*) as row_count
  from public.events
 group by status
 order by status;

select 'expense_quality' as check_name,
       count(*) filter (where expenses is null) as null_expenses,
       count(*) filter (where expenses is not null and jsonb_typeof(expenses) <> 'array') as non_array_expenses
  from public.club_tables;

select 'human_cutover_checklist' as check_name, item
  from (values
    ('[ ] ancien front fonctionne apres 0008 avant bootstrap'),
    ('[ ] interface de premier bootstrap'),
    ('[ ] bootstrap unique'),
    ('[ ] interface activation visible admin/manager'),
    ('[ ] bootstrap reussi'),
    ('[ ] 18 tables rattachees'),
    ('[ ] cloture'),
    ('[ ] activation suivante distincte'),
    ('[ ] depenses v3'),
    ('[ ] flux v2'),
    ('[ ] invitations v2'),
    ('[ ] QR v2'),
    ('[ ] snapshot securite sans double comptage'),
    ('[ ] cloture atomique'),
    ('[ ] ancienne RPC revoquee seulement par 0009')
  ) as checklist(item);
