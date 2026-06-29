-- 0008_phase0b_rls_cutover.sql
-- PHASE 0b / Phase B - verrouillage RLS final.
--
-- A appliquer uniquement apres :
--   - 0003_phase0b_identity_and_rls.sql ;
--   - creation des comptes Supabase Auth ;
--   - liaison de tous les staff_users.auth_id ;
--   - validation des 10 connexions ;
--   - migrations 0004 a 0007 si elles font partie du deploiement.
--
-- Ce fichier ne supprime aucune donnee et ne supprime pas staff_users.password.

begin;

do $$
declare
  v_unknown_roles text;
  v_duplicate_auth_id uuid;
  v_unmatched_auth_id uuid;
begin
  if to_regclass('public.staff_users') is null then
    raise exception 'Phase 0b cutover blocked: public.staff_users is missing';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'staff_users'
       and column_name = 'auth_id'
       and data_type = 'uuid'
  ) then
    raise exception 'Phase 0b cutover blocked: public.staff_users.auth_id uuid is missing';
  end if;

  if not exists (select 1 from public.staff_users) then
    raise exception 'Phase 0b cutover blocked: no staff account exists';
  end if;

  if exists (select 1 from public.staff_users where auth_id is null) then
    raise exception 'Phase 0b cutover blocked: at least one staff account has auth_id IS NULL';
  end if;

  select s.auth_id
    into v_unmatched_auth_id
    from public.staff_users s
    left join auth.users u on u.id = s.auth_id
   where u.id is null
   limit 1;

  if v_unmatched_auth_id is not null then
    raise exception 'Phase 0b cutover blocked: staff auth_id % does not match auth.users', v_unmatched_auth_id;
  end if;

  select s.auth_id
    into v_duplicate_auth_id
    from public.staff_users s
   group by s.auth_id
  having count(*) > 1
   limit 1;

  if v_duplicate_auth_id is not null then
    raise exception 'Phase 0b cutover blocked: duplicate staff auth_id %', v_duplicate_auth_id;
  end if;

  if to_regprocedure('public.current_staff_role()') is null then
    raise exception 'Phase 0b cutover blocked: public.current_staff_role() is missing';
  end if;

  if to_regprocedure('public.current_staff_username()') is null then
    raise exception 'Phase 0b cutover blocked: public.current_staff_username() is missing';
  end if;

  if to_regprocedure('public.get_my_profile()') is null then
    raise exception 'Phase 0b cutover blocked: public.get_my_profile() is missing';
  end if;

  if to_regprocedure('public.get_invite(text)') is null then
    raise exception 'Phase 0b cutover blocked: public.get_invite(text) is missing';
  end if;

  if to_regprocedure('public.public_events()') is null then
    raise exception 'Phase 0b cutover blocked: public.public_events() is missing; apply 0004 first';
  end if;

  if to_regclass('public.club_tables') is null then
    raise exception 'Phase 0b cutover blocked: public.club_tables is missing';
  end if;

  if to_regclass('public.entry_logs') is null then
    raise exception 'Phase 0b cutover blocked: public.entry_logs is missing';
  end if;

  if to_regclass('public.promoter_contacts') is null then
    raise exception 'Phase 0b cutover blocked: public.promoter_contacts is missing';
  end if;

  if to_regclass('public.promoter_guest_entries') is null then
    raise exception 'Phase 0b cutover blocked: public.promoter_guest_entries is missing';
  end if;

  if to_regclass('public.event_archives') is null then
    raise exception 'Phase 0b cutover blocked: public.event_archives is missing';
  end if;

  if to_regclass('public.venues') is null then
    raise exception 'Phase 0b cutover blocked: public.venues is missing; apply 0004 first';
  end if;

  if to_regclass('public.events') is null then
    raise exception 'Phase 0b cutover blocked: public.events is missing; apply 0004 first';
  end if;

  select string_agg(coalesce(nullif(btrim(role), ''), '<empty>'), ', ')
    into v_unknown_roles
    from public.staff_users
   where nullif(btrim(coalesce(role, '')), '') is null
      or role not in ('admin','manager','server','security','security_counter','promoter')
   limit 1;

  if v_unknown_roles is not null then
    raise exception 'Phase 0b cutover blocked: unknown or empty staff role: %', v_unknown_roles;
  end if;
end;
$$;

-- staff_users remains inaccessible directly. Staff profile access goes through
-- public.get_my_profile() only.
alter table public.staff_users enable row level security;
revoke all on public.staff_users from anon, authenticated;

-- club_tables
alter table public.club_tables enable row level security;
revoke all on public.club_tables from anon;
grant select, insert, update, delete on public.club_tables to authenticated;
drop policy if exists co_phase0b_anon_club_tables_select on public.club_tables;
drop policy if exists co_phase0b_anon_club_tables_insert on public.club_tables;
drop policy if exists co_phase0b_anon_club_tables_update on public.club_tables;
drop policy if exists co_phase0b_auth_club_tables_select on public.club_tables;
drop policy if exists co_phase0b_auth_club_tables_insert on public.club_tables;
drop policy if exists co_phase0b_auth_club_tables_update on public.club_tables;
drop policy if exists club_tables_read on public.club_tables;
drop policy if exists club_tables_write on public.club_tables;
create policy club_tables_read on public.club_tables
  for select to authenticated using (public.current_staff_role() is not null);
create policy club_tables_write on public.club_tables
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager','server','promoter'))
  with check (public.current_staff_role() in ('admin','manager','server','promoter'));

-- entry_logs
alter table public.entry_logs enable row level security;
revoke all on public.entry_logs from anon;
grant select, insert, delete on public.entry_logs to authenticated;
drop policy if exists co_phase0b_anon_entry_logs_select on public.entry_logs;
drop policy if exists co_phase0b_anon_entry_logs_insert on public.entry_logs;
drop policy if exists co_phase0b_auth_entry_logs_select on public.entry_logs;
drop policy if exists co_phase0b_auth_entry_logs_insert on public.entry_logs;
drop policy if exists entry_logs_read on public.entry_logs;
drop policy if exists entry_logs_insert on public.entry_logs;
drop policy if exists entry_logs_delete on public.entry_logs;
create policy entry_logs_read on public.entry_logs
  for select to authenticated using (public.current_staff_role() is not null);
create policy entry_logs_insert on public.entry_logs
  for insert to authenticated
  with check (staff_username = public.current_staff_username());
create policy entry_logs_delete on public.entry_logs
  for delete to authenticated using (public.current_staff_role() in ('admin','manager'));

-- promoter_contacts
alter table public.promoter_contacts enable row level security;
revoke all on public.promoter_contacts from anon;
grant select, insert, update, delete on public.promoter_contacts to authenticated;
drop policy if exists co_phase0b_anon_promoter_contacts_select on public.promoter_contacts;
drop policy if exists co_phase0b_anon_promoter_contacts_insert on public.promoter_contacts;
drop policy if exists co_phase0b_auth_promoter_contacts_select on public.promoter_contacts;
drop policy if exists co_phase0b_auth_promoter_contacts_insert on public.promoter_contacts;
drop policy if exists pc_read on public.promoter_contacts;
drop policy if exists pc_write on public.promoter_contacts;
create policy pc_read on public.promoter_contacts
  for select to authenticated using (public.current_staff_role() is not null);
create policy pc_write on public.promoter_contacts
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager','promoter'))
  with check (public.current_staff_role() in ('admin','manager','promoter'));

-- promoter_guest_entries. Public invite reads must go through get_invite(text).
alter table public.promoter_guest_entries enable row level security;
revoke all on public.promoter_guest_entries from anon;
grant select, insert, update, delete on public.promoter_guest_entries to authenticated;
drop policy if exists co_phase0b_anon_pge_select on public.promoter_guest_entries;
drop policy if exists co_phase0b_anon_pge_insert on public.promoter_guest_entries;
drop policy if exists co_phase0b_anon_pge_update on public.promoter_guest_entries;
drop policy if exists co_phase0b_auth_pge_select on public.promoter_guest_entries;
drop policy if exists co_phase0b_auth_pge_insert on public.promoter_guest_entries;
drop policy if exists co_phase0b_auth_pge_update on public.promoter_guest_entries;
drop policy if exists pge_read on public.promoter_guest_entries;
drop policy if exists pge_write on public.promoter_guest_entries;
create policy pge_read on public.promoter_guest_entries
  for select to authenticated using (public.current_staff_role() is not null);
create policy pge_write on public.promoter_guest_entries
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager','promoter','security','security_counter'))
  with check (public.current_staff_role() in ('admin','manager','promoter','security','security_counter'));

-- event_archives
alter table public.event_archives enable row level security;
revoke all on public.event_archives from anon;
grant select, insert, update, delete on public.event_archives to authenticated;
drop policy if exists co_phase0b_anon_event_archives_insert on public.event_archives;
drop policy if exists co_phase0b_auth_event_archives_insert on public.event_archives;
drop policy if exists ea_rw on public.event_archives;
create policy ea_rw on public.event_archives
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (public.current_staff_role() in ('admin','manager'));

-- venues / events from 0004_events_model.sql
alter table public.venues enable row level security;
alter table public.events enable row level security;
revoke all on public.venues from anon;
revoke all on public.events from anon;
grant select on public.venues to authenticated;
grant select, insert, update, delete on public.events to authenticated;
drop policy if exists venues_read on public.venues;
drop policy if exists events_read on public.events;
drop policy if exists events_write on public.events;
create policy venues_read on public.venues
  for select to authenticated using (public.current_staff_role() is not null);
create policy events_read on public.events
  for select to authenticated using (public.current_staff_role() is not null);
create policy events_write on public.events
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager','promoter'))
  with check (public.current_staff_role() in ('admin','manager','promoter'));

-- Defense in depth: no direct anonymous table access. Public pages must use
-- controlled SECURITY DEFINER RPCs such as get_invite(text) and public_events().
revoke all on all tables in schema public from anon;
grant execute on function public.get_invite(text) to anon, authenticated;
grant execute on function public.public_events() to anon, authenticated;

commit;
