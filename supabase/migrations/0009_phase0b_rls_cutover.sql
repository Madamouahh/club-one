-- 0009_phase0b_rls_cutover.sql
-- PHASE 0b / Phase B - verrouillage RLS final event-scoped.
--
-- A appliquer uniquement apres 0008_event_scope_preparation.sql, activation
-- explicite d'un evenement actif et validation du front event-scoped.

begin;

do $$
declare
  v_unknown_roles text;
  v_duplicate_auth_id uuid;
  v_unmatched_auth_id uuid;
  v_active_event_id uuid;
  v_active_event_date date;
  v_bootstrap_completed_at timestamptz;
  v_last_closed_event_id uuid;
  v_active_event_status text;
  v_table_count int;
begin
  if to_regclass('public.staff_users') is null then raise exception 'Phase 0b cutover blocked: public.staff_users is missing'; end if;
  if to_regclass('public.club_runtime_state') is null then raise exception 'Phase 0b cutover blocked: public.club_runtime_state is missing'; end if;
  if to_regclass('public.club_tables') is null then raise exception 'Phase 0b cutover blocked: public.club_tables is missing'; end if;
  if to_regclass('public.entry_logs') is null then raise exception 'Phase 0b cutover blocked: public.entry_logs is missing'; end if;
  if to_regclass('public.promoter_contacts') is null then raise exception 'Phase 0b cutover blocked: public.promoter_contacts is missing'; end if;
  if to_regclass('public.promoter_guest_entries') is null then raise exception 'Phase 0b cutover blocked: public.promoter_guest_entries is missing'; end if;
  if to_regclass('public.event_archives') is null then raise exception 'Phase 0b cutover blocked: public.event_archives is missing'; end if;
  if to_regclass('public.events') is null then raise exception 'Phase 0b cutover blocked: public.events is missing'; end if;

  if (select count(*) from public.club_runtime_state) <> 1 then
    raise exception 'Phase 0b cutover blocked: club_runtime_state must contain exactly one row';
  end if;

  if exists (select 1 from public.club_runtime_state where id is distinct from true) then
    raise exception 'Phase 0b cutover blocked: club_runtime_state.id must be true';
  end if;

  select crs.active_event_id, crs.bootstrap_completed_at, crs.last_closed_event_id, e.event_date, e.status
    into v_active_event_id, v_bootstrap_completed_at, v_last_closed_event_id, v_active_event_date, v_active_event_status
    from public.club_runtime_state crs
    left join public.events e on e.id = crs.active_event_id
   where crs.id is true;

  if v_active_event_id is null or v_active_event_date is null then
    raise exception 'Phase 0b cutover blocked: active event is missing or invalid';
  end if;

  if v_bootstrap_completed_at is null then
    raise exception 'Phase 0b cutover blocked: bootstrap_completed_at is required before cutover';
  end if;

  if v_active_event_id = v_last_closed_event_id then
    raise exception 'Phase 0b cutover blocked: active_event_id cannot equal last_closed_event_id';
  end if;

  if v_active_event_status = 'archived' then
    raise exception 'Phase 0b cutover blocked: active event cannot be archived';
  end if;

  if v_active_event_status not in ('draft','published') then
    raise exception 'Phase 0b cutover blocked: active event status is not activatable: %', v_active_event_status;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'staff_users'
       and column_name = 'auth_id' and data_type = 'uuid'
  ) then
    raise exception 'Phase 0b cutover blocked: public.staff_users.auth_id uuid is missing';
  end if;

  if exists (select 1 from public.staff_users where auth_id is null) then
    raise exception 'Phase 0b cutover blocked: at least one staff account has auth_id IS NULL';
  end if;

  select s.auth_id into v_unmatched_auth_id
    from public.staff_users s
    left join auth.users u on u.id = s.auth_id
   where u.id is null
   limit 1;
  if v_unmatched_auth_id is not null then
    raise exception 'Phase 0b cutover blocked: staff auth_id % does not match auth.users', v_unmatched_auth_id;
  end if;

  select s.auth_id into v_duplicate_auth_id
    from public.staff_users s
   group by s.auth_id
  having count(*) > 1
   limit 1;
  if v_duplicate_auth_id is not null then
    raise exception 'Phase 0b cutover blocked: duplicate staff auth_id %', v_duplicate_auth_id;
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

  if to_regprocedure('public.current_staff_role()') is null then raise exception 'Phase 0b cutover blocked: public.current_staff_role() is missing'; end if;
  if to_regprocedure('public.current_staff_username()') is null then raise exception 'Phase 0b cutover blocked: public.current_staff_username() is missing'; end if;
  if to_regprocedure('public.current_active_event_id()') is null then raise exception 'Phase 0b cutover blocked: public.current_active_event_id() is missing'; end if;
  if to_regprocedure('public.current_active_event_date()') is null then raise exception 'Phase 0b cutover blocked: public.current_active_event_date() is missing'; end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'club_runtime_state'
       and column_name = 'bootstrap_completed_at' and data_type = 'timestamp with time zone'
  ) then
    raise exception 'Phase 0b cutover blocked: club_runtime_state.bootstrap_completed_at is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'club_runtime_state'
       and column_name = 'last_closed_event_id' and data_type = 'uuid'
  ) then
    raise exception 'Phase 0b cutover blocked: club_runtime_state.last_closed_event_id is missing';
  end if;

  if to_regprocedure('public.get_active_event_context()') is null then raise exception 'Phase 0b cutover blocked: public.get_active_event_context() is missing from 0008'; end if;
  if to_regprocedure('public.get_security_table_snapshot()') is null then raise exception 'Phase 0b cutover blocked: public.get_security_table_snapshot() is missing from 0008'; end if;
  if to_regprocedure('public.list_activatable_club_events()') is null then raise exception 'Phase 0b cutover blocked: public.list_activatable_club_events() is missing from 0008'; end if;
  if to_regprocedure('public.bootstrap_club_event_v2(uuid)') is null then raise exception 'Phase 0b cutover blocked: public.bootstrap_club_event_v2(uuid) is missing from 0008'; end if;
  if to_regprocedure('public.activate_club_event_v2(uuid)') is null then raise exception 'Phase 0b cutover blocked: public.activate_club_event_v2(uuid) is missing from 0008'; end if;
  if to_regprocedure('public.close_club_event_v2()') is null then raise exception 'Phase 0b cutover blocked: public.close_club_event_v2() is missing from 0008'; end if;
  if to_regprocedure('public.add_entry_log_v2(text)') is null then raise exception 'Phase 0b cutover blocked: public.add_entry_log_v2(text) is missing from 0008'; end if;
  if to_regprocedure('public.add_expense_v3(text,text,numeric,text)') is null then raise exception 'Phase 0b cutover blocked: public.add_expense_v3(text,text,numeric,text) is missing from 0008'; end if;
  if to_regprocedure('public.check_in_invitation_v2(text,text)') is null then raise exception 'Phase 0b cutover blocked: public.check_in_invitation_v2(text,text) is missing from 0008'; end if;
  if to_regprocedure('public.create_promoter_invitation_v2(text,uuid,text,text,text,text)') is null then raise exception 'Phase 0b cutover blocked: public.create_promoter_invitation_v2(text,uuid,text,text,text,text) is missing from 0008'; end if;
  if to_regprocedure('public.add_expense_v2(text,text,numeric,text)') is null then raise exception 'Phase 0b cutover blocked: legacy public.add_expense_v2(text,text,numeric,text) is missing before revoke'; end if;
  if to_regprocedure('public.check_in_invitation(text,text)') is null then raise exception 'Phase 0b cutover blocked: legacy public.check_in_invitation(text,text) is missing before revoke'; end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'event_archives'
       and indexname = 'event_archives_event_id_unique_idx'
       and indexdef ilike '%unique%'
  ) then
    raise exception 'Phase 0b cutover blocked: event_archives event_id unique index is missing';
  end if;

  if exists (
    select 1
      from public.event_archives
     where event_id is not null
     group by event_id
    having count(*) > 1
  ) then
    raise exception 'Phase 0b cutover blocked: event_archives contain duplicate event_id values';
  end if;

  if exists (
    select 1
      from public.event_archives ea
      join public.events e on e.id = ea.event_id
     where ea.event_id is not null
       and ea.event_date::date is distinct from e.event_date
  ) then
    raise exception 'Phase 0b cutover blocked: event_archives contain event/date mismatches';
  end if;

  select count(*) into v_table_count
    from public.club_tables
   where event_id = v_active_event_id
     and event_date::date = v_active_event_date;
  if v_table_count <> 18 then
    raise exception 'Phase 0b cutover blocked: expected 18 active club tables, found %', v_table_count;
  end if;

  if exists (select 1 from public.club_tables where event_id is null or event_id <> v_active_event_id) then
    raise exception 'Phase 0b cutover blocked: club_tables contain rows outside active event';
  end if;

  if exists (select 1 from public.entry_logs where event_id is null or event_date is null) then
    raise exception 'Phase 0b cutover blocked: entry_logs contain event scope gaps';
  end if;

  if exists (select 1 from public.promoter_guest_entries where event_id is null) then
    raise exception 'Phase 0b cutover blocked: promoter_guest_entries contain event scope gaps';
  end if;

  if exists (
    select 1
      from public.events e
     group by e.event_date
    having count(*) > 1
  ) then
    raise exception 'Phase 0b cutover blocked: ambiguous event dates remain';
  end if;
end;
$$;

create or replace function public.co_enforce_club_table_server_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_staff_role() = 'server' then
    if not public.co_is_server_table_scope(old.assigned_to) or not public.co_is_server_table_scope(new.assigned_to) then
      raise exception 'server cannot update a table outside server scope';
    end if;
    if coalesce(old.assigned_to, '') is distinct from coalesce(new.assigned_to, '') then
      raise exception 'server cannot change assigned_to';
    end if;
    if coalesce(old.linked_group_id, '') is distinct from coalesce(new.linked_group_id, '') then
      raise exception 'server cannot change table grouping';
    end if;
    if coalesce(old.linked_tables, array[]::text[]) is distinct from coalesce(new.linked_tables, array[]::text[]) then
      raise exception 'server cannot change table grouping';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.co_enforce_club_table_server_scope() from public;

drop trigger if exists co_enforce_club_table_server_scope_trg on public.club_tables;
create trigger co_enforce_club_table_server_scope_trg
  before update on public.club_tables
  for each row
  execute function public.co_enforce_club_table_server_scope();

create or replace function public.co_enforce_promoter_guest_entry_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_staff_role() = 'promoter' then
    if old.promoter_username is distinct from public.current_staff_username()
       or new.promoter_username is distinct from public.current_staff_username() then
      raise exception 'promoter cannot modify another promoter invitation';
    end if;
    if old.promoter_username is distinct from new.promoter_username then
      raise exception 'promoter cannot change promoter_username';
    end if;
    if old.event_id is distinct from new.event_id then
      raise exception 'promoter cannot change event_id';
    end if;
    if old.checked_in is distinct from new.checked_in
       or old.checked_in_at is distinct from new.checked_in_at
       or old.checked_in_by is distinct from new.checked_in_by then
      raise exception 'promoter cannot change QR check-in fields';
    end if;
    if old.qr_token is distinct from new.qr_token then
      raise exception 'promoter cannot change qr_token';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.co_enforce_promoter_guest_entry_update() from public;

drop trigger if exists co_enforce_promoter_guest_entry_update_trg on public.promoter_guest_entries;
create trigger co_enforce_promoter_guest_entry_update_trg
  before update on public.promoter_guest_entries
  for each row
  execute function public.co_enforce_promoter_guest_entry_update();

revoke all on function public.add_expense(text, text, numeric, text) from public;
revoke all on function public.add_expense(text, text, numeric, text) from anon, authenticated;
revoke all on function public.add_expense_v2(text, text, numeric, text) from public;
revoke all on function public.add_expense_v2(text, text, numeric, text) from anon, authenticated;
revoke all on function public.check_in_invitation(text, text) from public;
revoke all on function public.check_in_invitation(text, text) from anon, authenticated;
grant execute on function public.add_expense_v3(text, text, numeric, text) to authenticated;
grant execute on function public.check_in_invitation_v2(text, text) to authenticated;
grant execute on function public.create_promoter_invitation_v2(text, uuid, text, text, text, text) to authenticated;
grant execute on function public.add_entry_log_v2(text) to authenticated;
grant execute on function public.close_club_event_v2() to authenticated;
grant execute on function public.bootstrap_club_event_v2(uuid) to authenticated;
grant execute on function public.activate_club_event_v2(uuid) to authenticated;
grant execute on function public.get_active_event_context() to authenticated;
grant execute on function public.get_security_table_snapshot() to authenticated;
grant execute on function public.list_activatable_club_events() to authenticated;

alter table public.staff_users enable row level security;
revoke all on public.staff_users from anon, authenticated;

alter table public.club_runtime_state enable row level security;
revoke all on public.club_runtime_state from anon, authenticated;

alter table public.club_tables enable row level security;
revoke all on public.club_tables from anon;
grant select, insert, update, delete on public.club_tables to authenticated;
drop policy if exists co_phase0b_anon_club_tables_select on public.club_tables;
drop policy if exists co_phase0b_anon_club_tables_insert on public.club_tables;
drop policy if exists co_phase0b_anon_club_tables_update on public.club_tables;
drop policy if exists co_phase0b_auth_club_tables_select on public.club_tables;
drop policy if exists co_phase0b_auth_club_tables_insert on public.club_tables;
drop policy if exists co_phase0b_auth_club_tables_update on public.club_tables;
drop policy if exists club_tables_select_ops on public.club_tables;
drop policy if exists club_tables_select_server on public.club_tables;
drop policy if exists club_tables_insert_admin_manager_promoter on public.club_tables;
drop policy if exists club_tables_update_admin_manager_promoter on public.club_tables;
drop policy if exists club_tables_update_server on public.club_tables;
drop policy if exists club_tables_delete_admin_manager on public.club_tables;
create policy club_tables_select_ops on public.club_tables
  for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager','promoter')
    and event_id = public.current_active_event_id()
  );
create policy club_tables_select_server on public.club_tables
  for select to authenticated
  using (
    public.current_staff_role() = 'server'
    and event_id = public.current_active_event_id()
    and public.co_is_server_table_scope(assigned_to)
  );
create policy club_tables_insert_admin_manager_promoter on public.club_tables
  for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager','promoter')
    and event_id = public.current_active_event_id()
    and event_date::date = public.current_active_event_date()
  );
create policy club_tables_update_admin_manager_promoter on public.club_tables
  for update to authenticated
  using (
    public.current_staff_role() in ('admin','manager','promoter')
    and event_id = public.current_active_event_id()
  )
  with check (
    public.current_staff_role() in ('admin','manager','promoter')
    and event_id = public.current_active_event_id()
    and event_date::date = public.current_active_event_date()
  );
create policy club_tables_update_server on public.club_tables
  for update to authenticated
  using (
    public.current_staff_role() = 'server'
    and event_id = public.current_active_event_id()
    and public.co_is_server_table_scope(assigned_to)
  )
  with check (
    public.current_staff_role() = 'server'
    and event_id = public.current_active_event_id()
    and event_date::date = public.current_active_event_date()
    and public.co_is_server_table_scope(assigned_to)
  );
create policy club_tables_delete_admin_manager on public.club_tables
  for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

alter table public.entry_logs enable row level security;
revoke all on public.entry_logs from anon;
grant select, delete on public.entry_logs to authenticated;
drop policy if exists co_phase0b_anon_entry_logs_select on public.entry_logs;
drop policy if exists co_phase0b_anon_entry_logs_insert on public.entry_logs;
drop policy if exists co_phase0b_auth_entry_logs_select on public.entry_logs;
drop policy if exists co_phase0b_auth_entry_logs_insert on public.entry_logs;
drop policy if exists entry_logs_select_ops on public.entry_logs;
drop policy if exists entry_logs_insert_counter on public.entry_logs;
drop policy if exists entry_logs_delete_admin_manager on public.entry_logs;
create policy entry_logs_select_ops on public.entry_logs
  for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager','security_counter')
    and event_id = public.current_active_event_id()
  );
create policy entry_logs_delete_admin_manager on public.entry_logs
  for delete to authenticated using (public.current_staff_role() in ('admin','manager'));

alter table public.promoter_contacts enable row level security;
revoke all on public.promoter_contacts from anon;
grant select, insert, update, delete on public.promoter_contacts to authenticated;
drop policy if exists co_phase0b_anon_promoter_contacts_select on public.promoter_contacts;
drop policy if exists co_phase0b_anon_promoter_contacts_insert on public.promoter_contacts;
drop policy if exists co_phase0b_auth_promoter_contacts_select on public.promoter_contacts;
drop policy if exists co_phase0b_auth_promoter_contacts_insert on public.promoter_contacts;
drop policy if exists pc_select_admin_manager on public.promoter_contacts;
drop policy if exists pc_select_promoter_own on public.promoter_contacts;
drop policy if exists pc_insert_admin_manager on public.promoter_contacts;
drop policy if exists pc_insert_promoter_own on public.promoter_contacts;
drop policy if exists pc_update_admin_manager on public.promoter_contacts;
drop policy if exists pc_update_promoter_own on public.promoter_contacts;
drop policy if exists pc_delete_admin_manager on public.promoter_contacts;
drop policy if exists pc_delete_promoter_own on public.promoter_contacts;
create policy pc_select_admin_manager on public.promoter_contacts for select to authenticated using (public.current_staff_role() in ('admin','manager'));
create policy pc_select_promoter_own on public.promoter_contacts for select to authenticated using (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username());
create policy pc_insert_admin_manager on public.promoter_contacts for insert to authenticated with check (public.current_staff_role() in ('admin','manager'));
create policy pc_insert_promoter_own on public.promoter_contacts for insert to authenticated with check (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username());
create policy pc_update_admin_manager on public.promoter_contacts for update to authenticated using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));
create policy pc_update_promoter_own on public.promoter_contacts for update to authenticated using (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username()) with check (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username());
create policy pc_delete_admin_manager on public.promoter_contacts for delete to authenticated using (public.current_staff_role() in ('admin','manager'));
create policy pc_delete_promoter_own on public.promoter_contacts for delete to authenticated using (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username());

alter table public.promoter_guest_entries enable row level security;
revoke all on public.promoter_guest_entries from anon;
grant select, update, delete on public.promoter_guest_entries to authenticated;
drop policy if exists co_phase0b_anon_pge_select on public.promoter_guest_entries;
drop policy if exists co_phase0b_anon_pge_insert on public.promoter_guest_entries;
drop policy if exists co_phase0b_anon_pge_update on public.promoter_guest_entries;
drop policy if exists co_phase0b_auth_pge_select on public.promoter_guest_entries;
drop policy if exists co_phase0b_auth_pge_insert on public.promoter_guest_entries;
drop policy if exists co_phase0b_auth_pge_update on public.promoter_guest_entries;
drop policy if exists pge_select_admin_manager on public.promoter_guest_entries;
drop policy if exists pge_select_promoter_own on public.promoter_guest_entries;
drop policy if exists pge_insert_admin_manager on public.promoter_guest_entries;
drop policy if exists pge_insert_promoter_own on public.promoter_guest_entries;
drop policy if exists pge_update_admin_manager on public.promoter_guest_entries;
drop policy if exists pge_update_promoter_own on public.promoter_guest_entries;
drop policy if exists pge_delete_admin_manager on public.promoter_guest_entries;
drop policy if exists pge_delete_promoter_own on public.promoter_guest_entries;
create policy pge_select_admin_manager on public.promoter_guest_entries for select to authenticated using (public.current_staff_role() in ('admin','manager') and event_id = public.current_active_event_id());
create policy pge_select_promoter_own on public.promoter_guest_entries for select to authenticated using (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username() and event_id = public.current_active_event_id());
create policy pge_update_admin_manager on public.promoter_guest_entries for update to authenticated using (public.current_staff_role() in ('admin','manager') and event_id = public.current_active_event_id()) with check (public.current_staff_role() in ('admin','manager') and event_id = public.current_active_event_id() and event_date::date = public.current_active_event_date());
create policy pge_update_promoter_own on public.promoter_guest_entries for update to authenticated using (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username() and event_id = public.current_active_event_id()) with check (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username() and event_id = public.current_active_event_id() and event_date::date = public.current_active_event_date());
create policy pge_delete_admin_manager on public.promoter_guest_entries for delete to authenticated using (public.current_staff_role() in ('admin','manager'));
create policy pge_delete_promoter_own on public.promoter_guest_entries for delete to authenticated using (public.current_staff_role() = 'promoter' and promoter_username = public.current_staff_username() and event_id = public.current_active_event_id());

alter table public.event_archives enable row level security;
revoke all on public.event_archives from anon;
grant select on public.event_archives to authenticated;
drop policy if exists co_phase0b_anon_event_archives_insert on public.event_archives;
drop policy if exists co_phase0b_auth_event_archives_insert on public.event_archives;
drop policy if exists ea_select_admin_manager on public.event_archives;
drop policy if exists ea_insert_admin_manager on public.event_archives;
drop policy if exists ea_update_admin_manager on public.event_archives;
drop policy if exists ea_delete_admin_manager on public.event_archives;
create policy ea_select_admin_manager on public.event_archives for select to authenticated using (public.current_staff_role() in ('admin','manager'));

alter table public.venues enable row level security;
alter table public.events enable row level security;
revoke all on public.venues from anon;
revoke all on public.events from anon;
grant select on public.venues to authenticated;
grant select, insert, update, delete on public.events to authenticated;
drop policy if exists venues_select_staff on public.venues;
drop policy if exists events_select_staff on public.events;
drop policy if exists events_insert_staff on public.events;
drop policy if exists events_update_staff on public.events;
drop policy if exists events_delete_admin_manager on public.events;
create policy venues_select_staff on public.venues for select to authenticated using (public.current_staff_role() is not null);
create policy events_select_staff on public.events for select to authenticated using (public.current_staff_role() is not null);
create policy events_insert_staff on public.events for insert to authenticated with check (public.current_staff_role() in ('admin','manager'));
create policy events_update_staff on public.events for update to authenticated using (public.current_staff_role() in ('admin','manager')) with check (public.current_staff_role() in ('admin','manager'));
create policy events_delete_admin_manager on public.events for delete to authenticated using (public.current_staff_role() in ('admin','manager'));

revoke all on all tables in schema public from anon;
revoke all on function public.get_invite(text) from public;
revoke all on function public.public_events() from public;
grant execute on function public.get_invite(text) to anon, authenticated;
grant execute on function public.public_events() to anon, authenticated;

commit;
