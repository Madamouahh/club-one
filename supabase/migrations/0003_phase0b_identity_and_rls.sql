-- 0003_phase0b_identity_and_rls.sql
-- PHASE 0b — Identité réelle (Supabase Auth) + RLS sur TOUTES les tables.
-- Ferme la lecture/écriture anonyme de la base (cf. audit 0bis : tout était ouvert).
--
-- ⚠️ ORDRE D'APPLICATION (voir SECURITY_PHASE0B.md) :
--   1. Lancer scripts/seed-auth-users.mjs (crée les users Auth + remplit auth_id) ;
--   2. Déployer le nouveau code (login Supabase Auth) et vérifier la connexion ;
--   3. SEULEMENT ALORS exécuter ce fichier (il bloque l'accès anonyme).
-- L'exécuter AVANT le déploiement casserait l'app déployée (qui opère encore en anon).
-- À faire hors soirée. Faire une sauvegarde de la base avant (Supabase → Database → Backups).

-- ───────────────────────── 1) Lien d'identité ─────────────────────────
alter table public.staff_users add column if not exists auth_id uuid unique;

-- ───────────────────────── 2) Helpers ─────────────────────────
-- Rôle du staff courant d'après le JWT. SECURITY DEFINER : lit staff_users malgré la RLS.
create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.staff_users where auth_id = auth.uid();
$$;
revoke all on function public.current_staff_role() from public;
grant execute on function public.current_staff_role() to authenticated;

-- Username du staff courant — sert à forcer l'attribution des journaux (anti-usurpation).
create or replace function public.current_staff_username()
returns text language sql stable security definer set search_path = public as $$
  select username from public.staff_users where auth_id = auth.uid();
$$;
revoke all on function public.current_staff_username() from public;
grant execute on function public.current_staff_username() to authenticated;

-- Profil du staff courant (utilisé par l'app au login / restauration de session).
-- Évite d'exposer la table staff_users : seul le profil du JWT est renvoyé, sans le mot de passe.
create or replace function public.get_my_profile()
returns table (id text, username text, role text, full_name text)
language sql stable security definer set search_path = public as $$
  select id::text, username, role, full_name
    from public.staff_users where auth_id = auth.uid();
$$;
revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

-- Invitation publique : 1 ligne par token, sans exposer toute la table (page /invite anonyme).
create or replace function public.get_invite(p_token text)
returns table (
  guest_name text, promoter_username text, event_date text,
  access_mode text, payment_status text, checked_in boolean, qr_token text
) language sql stable security definer set search_path = public as $$
  select guest_name, promoter_username, event_date::text,
         access_mode, payment_status, checked_in, qr_token
    from public.promoter_guest_entries
   where qr_token = p_token
   limit 1;
$$;
revoke all on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;

-- ───────────────────────── 3) RLS tables opérationnelles ─────────────────────────
-- staff_users : reste verrouillée (0002). On n'ajoute AUCUN accès direct ; tout passe par les RPC.

-- club_tables
alter table public.club_tables enable row level security;
revoke all on public.club_tables from anon;
grant select, insert, update, delete on public.club_tables to authenticated;
drop policy if exists club_tables_read on public.club_tables;
drop policy if exists club_tables_write on public.club_tables;
create policy club_tables_read on public.club_tables
  for select to authenticated using (true);
create policy club_tables_write on public.club_tables
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager','server','promoter'))
  with check (public.current_staff_role() in ('admin','manager','server','promoter'));

-- entry_logs
alter table public.entry_logs enable row level security;
revoke all on public.entry_logs from anon;
grant select, insert, delete on public.entry_logs to authenticated;
drop policy if exists entry_logs_read on public.entry_logs;
drop policy if exists entry_logs_insert on public.entry_logs;
drop policy if exists entry_logs_delete on public.entry_logs;
create policy entry_logs_read on public.entry_logs
  for select to authenticated using (true);
-- Anti-usurpation : on ne peut journaliser QUE sous son propre username (lié au JWT).
create policy entry_logs_insert on public.entry_logs
  for insert to authenticated
  with check (staff_username = public.current_staff_username());
create policy entry_logs_delete on public.entry_logs
  for delete to authenticated using (public.current_staff_role() in ('admin','manager'));

-- promoter_contacts
alter table public.promoter_contacts enable row level security;
revoke all on public.promoter_contacts from anon;
grant select, insert, update, delete on public.promoter_contacts to authenticated;
drop policy if exists pc_read on public.promoter_contacts;
drop policy if exists pc_write on public.promoter_contacts;
create policy pc_read on public.promoter_contacts
  for select to authenticated using (true);
create policy pc_write on public.promoter_contacts
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager','promoter'))
  with check (public.current_staff_role() in ('admin','manager','promoter'));

-- promoter_guest_entries (lecture publique RETIRÉE → via get_invite)
alter table public.promoter_guest_entries enable row level security;
revoke all on public.promoter_guest_entries from anon;
grant select, insert, update, delete on public.promoter_guest_entries to authenticated;
drop policy if exists pge_read on public.promoter_guest_entries;
drop policy if exists pge_write on public.promoter_guest_entries;
create policy pge_read on public.promoter_guest_entries
  for select to authenticated using (true);
create policy pge_write on public.promoter_guest_entries
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager','promoter','security','security_counter'))
  with check (public.current_staff_role() in ('admin','manager','promoter','security','security_counter'));

-- event_archives (admin/manager)
alter table public.event_archives enable row level security;
revoke all on public.event_archives from anon;
grant select, insert, update, delete on public.event_archives to authenticated;
drop policy if exists ea_rw on public.event_archives;
create policy ea_rw on public.event_archives
  for all to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (public.current_staff_role() in ('admin','manager'));

-- ───────────────────────── 3bis) Filet de sécurité anti-anon ─────────────────────────
-- Au cas où une table publique aurait été oubliée ci-dessus : on retire tout accès anon
-- sur l'ensemble du schéma public (l'app est authentifiée ; /invite passe par get_invite).
revoke all on all tables in schema public from anon;

-- DURCISSEMENT À TESTER (NON appliqué — peut impacter la validation QR / module promoteur) :
-- aujourd'hui pc_read / pge_read sont `using (true)` => tout staff lit tous les contacts/invités
-- (téléphone compris). Pour limiter la lecture horizontale entre promoteurs, remplacer par ex. :
--   using (current_staff_role() in ('admin','manager')
--          or promoter_username = public.current_staff_username())
-- ⚠️ vérifier d'abord que security_counter peut toujours valider un QR (lecture par token) :
-- prévoir une RPC dédiée (style get_invite) si on restreint pge_read. À faire en fenêtre de test.

-- ───────────────────────── 4) Vérifications (après application) ─────────────────────────
-- Contrôle d'exhaustivité : lister toute table publique encore lisible par anon (doit être vide) :
--   select table_name from information_schema.role_table_grants
--   where table_schema='public' and grantee='anon';
-- Avec la clé ANON, ceci doit renvoyer 0 ligne / 401 :
--   select * from club_tables;            -- bloqué
--   select * from promoter_guest_entries; -- bloqué
-- Avec un JWT authentifié (staff connecté), la lecture doit fonctionner.
-- La page /invite doit fonctionner via rpc get_invite (anon).
