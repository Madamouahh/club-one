-- 0003_phase0b_identity_and_rls.sql
-- PHASE 0b / Phase A - preparation Supabase Auth + pont RLS transitoire.
--
-- Ordre obligatoire :
--   1. Appliquer cette migration.
--   2. Executer le pre-vol Phase A.
--   3. Creer/lier les comptes Auth via scripts/seed-auth-users.mjs.
--   4. Tester le front Auth rapidement.
--   5. Appliquer 0008 dans la meme fenetre de maintenance.
--
-- Cette migration active une RLS transitoire sur les tables operationnelles :
--   - anon conserve uniquement les actions historiques necessaires a l'ancien front ;
--   - authenticated doit correspondre a un staff lie par staff_users.auth_id ;
--   - staff_users n'est jamais exposee directement ;
--   - 0008 supprime ces policies transitoires et applique la separation finale par role.
--
-- La colonne legacy staff_users.password n'est pas supprimee dans ce lot.

begin;

alter table public.staff_users add column if not exists auth_id uuid;
create unique index if not exists staff_users_auth_id_unique_idx
  on public.staff_users (auth_id)
  where auth_id is not null;

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.role
    from public.staff_users s
   where s.auth_id = auth.uid();
$$;
revoke all on function public.current_staff_role() from public;
grant execute on function public.current_staff_role() to authenticated;

create or replace function public.current_staff_username()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.username
    from public.staff_users s
   where s.auth_id = auth.uid();
$$;
revoke all on function public.current_staff_username() from public;
grant execute on function public.current_staff_username() to authenticated;

create or replace function public.get_my_profile()
returns table (id text, username text, role text, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id::text, s.username, s.role, s.full_name
    from public.staff_users s
   where s.auth_id = auth.uid();
$$;
revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

create or replace function public.get_invite(p_token text)
returns table (
  guest_name text,
  promoter_username text,
  event_date text,
  access_mode text,
  payment_status text,
  checked_in boolean,
  qr_token text
)
language sql
stable
security definer
set search_path = public
as $$
  select pge.guest_name,
         pge.promoter_username,
         pge.event_date::text,
         pge.access_mode,
         pge.payment_status,
         pge.checked_in,
         pge.qr_token
    from public.promoter_guest_entries pge
   where pge.qr_token = p_token
   limit 1;
$$;
revoke all on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;

-- Pont RLS transitoire avant cutover.
-- Les GRANT ouvrent les privileges de table, mais les policies authenticated
-- ci-dessous refusent tout utilisateur Auth non lie a public.staff_users.auth_id.
-- Les policies anon reproduisent uniquement les operations historiques utiles a
-- l'ancien front et sont supprimees explicitement par 0008.
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
    create policy co_phase0b_anon_club_tables_select on public.club_tables
      for select to anon using (true);
    create policy co_phase0b_anon_club_tables_insert on public.club_tables
      for insert to anon with check (true);
    create policy co_phase0b_anon_club_tables_update on public.club_tables
      for update to anon using (true) with check (true);
    create policy co_phase0b_auth_club_tables_select on public.club_tables
      for select to authenticated using (public.current_staff_role() is not null);
    create policy co_phase0b_auth_club_tables_insert on public.club_tables
      for insert to authenticated
      with check (public.current_staff_role() in ('admin','manager','server','promoter'));
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
    create policy co_phase0b_anon_entry_logs_select on public.entry_logs
      for select to anon using (true);
    create policy co_phase0b_anon_entry_logs_insert on public.entry_logs
      for insert to anon with check (true);
    create policy co_phase0b_auth_entry_logs_select on public.entry_logs
      for select to authenticated using (public.current_staff_role() is not null);
    create policy co_phase0b_auth_entry_logs_insert on public.entry_logs
      for insert to authenticated
      with check (staff_username = public.current_staff_username());
  end if;

  if to_regclass('public.promoter_contacts') is not null then
    alter table public.promoter_contacts enable row level security;
    grant select, insert on public.promoter_contacts to authenticated;
    drop policy if exists co_phase0b_anon_promoter_contacts_select on public.promoter_contacts;
    drop policy if exists co_phase0b_anon_promoter_contacts_insert on public.promoter_contacts;
    drop policy if exists co_phase0b_auth_promoter_contacts_select on public.promoter_contacts;
    drop policy if exists co_phase0b_auth_promoter_contacts_insert on public.promoter_contacts;
    create policy co_phase0b_anon_promoter_contacts_select on public.promoter_contacts
      for select to anon using (true);
    create policy co_phase0b_anon_promoter_contacts_insert on public.promoter_contacts
      for insert to anon with check (true);
    create policy co_phase0b_auth_promoter_contacts_select on public.promoter_contacts
      for select to authenticated using (public.current_staff_role() is not null);
    create policy co_phase0b_auth_promoter_contacts_insert on public.promoter_contacts
      for insert to authenticated
      with check (public.current_staff_role() in ('admin','manager','promoter'));
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
    create policy co_phase0b_anon_pge_select on public.promoter_guest_entries
      for select to anon using (true);
    create policy co_phase0b_anon_pge_insert on public.promoter_guest_entries
      for insert to anon with check (true);
    create policy co_phase0b_anon_pge_update on public.promoter_guest_entries
      for update to anon using (true) with check (true);
    create policy co_phase0b_auth_pge_select on public.promoter_guest_entries
      for select to authenticated using (public.current_staff_role() is not null);
    create policy co_phase0b_auth_pge_insert on public.promoter_guest_entries
      for insert to authenticated
      with check (public.current_staff_role() in ('admin','manager','promoter'));
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
    create policy co_phase0b_anon_event_archives_insert on public.event_archives
      for insert to anon with check (true);
    create policy co_phase0b_auth_event_archives_insert on public.event_archives
      for insert to authenticated
      with check (public.current_staff_role() in ('admin','manager'));
  end if;
end;
$$;

commit;
