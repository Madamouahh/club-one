-- 0008_phase0b_rls_cutover_emergency.sql
-- ROLLBACK TEMPORAIRE D'URGENCE - regression de securite controlee.
--
-- Objectif : revenir au pont RLS transitoire de 0003 si le cutover 0008 bloque
-- immediatement la production.
--
-- Ce script ne supprime aucune donnee, aucun compte Auth, aucune colonne et aucun
-- auth_id. Il ne rend jamais public.staff_users accessible directement.
-- A utiliser uniquement en incident bloquant, puis reappliquer un cutover corrige.

begin;

alter table public.staff_users enable row level security;
revoke all on public.staff_users from anon, authenticated;

grant execute on function public.get_invite(text) to anon, authenticated;
do $$
begin
  if to_regprocedure('public.public_events()') is not null then
    grant execute on function public.public_events() to anon, authenticated;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.club_tables') is not null then
    alter table public.club_tables enable row level security;
    grant select, insert, update on public.club_tables to authenticated;
    drop policy if exists co_phase0b_anon_club_tables_select on public.club_tables;
    drop policy if exists co_phase0b_anon_club_tables_insert on public.club_tables;
    drop policy if exists co_phase0b_anon_club_tables_update on public.club_tables;
    drop policy if exists co_phase0b_auth_club_tables_select on public.club_tables;
    drop policy if exists co_phase0b_auth_club_tables_insert on public.club_tables;
    drop policy if exists co_phase0b_auth_club_tables_update on public.club_tables;
    create policy co_phase0b_anon_club_tables_select on public.club_tables for select to anon using (true);
    create policy co_phase0b_anon_club_tables_insert on public.club_tables for insert to anon with check (true);
    create policy co_phase0b_anon_club_tables_update on public.club_tables for update to anon using (true) with check (true);
    create policy co_phase0b_auth_club_tables_select on public.club_tables
      for select to authenticated using (public.current_staff_role() is not null);
    create policy co_phase0b_auth_club_tables_insert on public.club_tables
      for insert to authenticated with check (public.current_staff_role() in ('admin','manager','server','promoter'));
    create policy co_phase0b_auth_club_tables_update on public.club_tables
      for update to authenticated
      using (public.current_staff_role() in ('admin','manager','server','promoter'))
      with check (public.current_staff_role() in ('admin','manager','server','promoter'));
  end if;

  if to_regclass('public.entry_logs') is not null then
    alter table public.entry_logs enable row level security;
    grant select, insert on public.entry_logs to authenticated;
    drop policy if exists co_phase0b_anon_entry_logs_select on public.entry_logs;
    drop policy if exists co_phase0b_anon_entry_logs_insert on public.entry_logs;
    drop policy if exists co_phase0b_auth_entry_logs_select on public.entry_logs;
    drop policy if exists co_phase0b_auth_entry_logs_insert on public.entry_logs;
    create policy co_phase0b_anon_entry_logs_select on public.entry_logs for select to anon using (true);
    create policy co_phase0b_anon_entry_logs_insert on public.entry_logs for insert to anon with check (true);
    create policy co_phase0b_auth_entry_logs_select on public.entry_logs
      for select to authenticated using (public.current_staff_role() is not null);
    create policy co_phase0b_auth_entry_logs_insert on public.entry_logs
      for insert to authenticated with check (staff_username = public.current_staff_username());
  end if;

  if to_regclass('public.promoter_contacts') is not null then
    alter table public.promoter_contacts enable row level security;
    grant select, insert on public.promoter_contacts to authenticated;
    drop policy if exists co_phase0b_anon_promoter_contacts_select on public.promoter_contacts;
    drop policy if exists co_phase0b_anon_promoter_contacts_insert on public.promoter_contacts;
    drop policy if exists co_phase0b_auth_promoter_contacts_select on public.promoter_contacts;
    drop policy if exists co_phase0b_auth_promoter_contacts_insert on public.promoter_contacts;
    create policy co_phase0b_anon_promoter_contacts_select on public.promoter_contacts for select to anon using (true);
    create policy co_phase0b_anon_promoter_contacts_insert on public.promoter_contacts for insert to anon with check (true);
    create policy co_phase0b_auth_promoter_contacts_select on public.promoter_contacts
      for select to authenticated using (public.current_staff_role() is not null);
    create policy co_phase0b_auth_promoter_contacts_insert on public.promoter_contacts
      for insert to authenticated with check (public.current_staff_role() in ('admin','manager','promoter'));
  end if;

  if to_regclass('public.promoter_guest_entries') is not null then
    alter table public.promoter_guest_entries enable row level security;
    grant select, insert, update on public.promoter_guest_entries to authenticated;
    drop policy if exists co_phase0b_anon_pge_select on public.promoter_guest_entries;
    drop policy if exists co_phase0b_anon_pge_insert on public.promoter_guest_entries;
    drop policy if exists co_phase0b_anon_pge_update on public.promoter_guest_entries;
    drop policy if exists co_phase0b_auth_pge_select on public.promoter_guest_entries;
    drop policy if exists co_phase0b_auth_pge_insert on public.promoter_guest_entries;
    drop policy if exists co_phase0b_auth_pge_update on public.promoter_guest_entries;
    create policy co_phase0b_anon_pge_select on public.promoter_guest_entries for select to anon using (true);
    create policy co_phase0b_anon_pge_insert on public.promoter_guest_entries for insert to anon with check (true);
    create policy co_phase0b_anon_pge_update on public.promoter_guest_entries for update to anon using (true) with check (true);
    create policy co_phase0b_auth_pge_select on public.promoter_guest_entries
      for select to authenticated using (public.current_staff_role() is not null);
    create policy co_phase0b_auth_pge_insert on public.promoter_guest_entries
      for insert to authenticated with check (public.current_staff_role() in ('admin','manager','promoter'));
    create policy co_phase0b_auth_pge_update on public.promoter_guest_entries
      for update to authenticated
      using (public.current_staff_role() in ('admin','manager','promoter','security','security_counter'))
      with check (public.current_staff_role() in ('admin','manager','promoter','security','security_counter'));
  end if;

  if to_regclass('public.event_archives') is not null then
    alter table public.event_archives enable row level security;
    grant insert on public.event_archives to authenticated;
    drop policy if exists co_phase0b_anon_event_archives_insert on public.event_archives;
    drop policy if exists co_phase0b_auth_event_archives_insert on public.event_archives;
    create policy co_phase0b_anon_event_archives_insert on public.event_archives for insert to anon with check (true);
    create policy co_phase0b_auth_event_archives_insert on public.event_archives
      for insert to authenticated with check (public.current_staff_role() in ('admin','manager'));
  end if;
end;
$$;

commit;
