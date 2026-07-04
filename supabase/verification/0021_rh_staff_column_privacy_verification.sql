-- 0021_rh_staff_column_privacy_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0021 — fermeture du gap COLONNE-LEVEL de la
-- 0011 : `taux_horaire` (PII paie) et `notes_direction` (réservé direction) ne sont plus lisibles par
-- le rôle partagé `authenticated` en accès table direct ; la vue DIRECTION complète passe par la RPC
-- SECURITY DEFINER `list_staff_members_v1()` gardée admin/manager.
--
-- Comble un TROU de la convention du dépôt (0021 était l'une des deux migrations ≥ 0010 sans fichier
-- de vérification — cf. docs/MIGRATIONS_REGISTRY.md §4). Prouve, sur PostgreSQL réel et en TRANSACTION
-- ANNULÉE (rollback — aucune donnée de test ne persiste ; le module RH ship VIDE, cf. 0011) :
--   (A) PRIVILÈGE COLONNE (indépendant des lignes) : `authenticated` N'A PLUS le SELECT sur
--       `taux_horaire` ni `notes_direction`, mais CONSERVE le SELECT sur les colonnes non sensibles
--       (id, username, full_name, poste, contrat_type, actif, created_at, updated_at) ;
--   (B) DÉFENSE EN PROFONDEUR : même la DIRECTION (manager), pourtant autorisée au niveau LIGNE par la
--       RLS 0011, ne peut PAS lire ces 2 colonnes en REQUÊTE DIRECTE (`permission denied` /
--       insufficient_privilege) — la restriction est portée par le MOTEUR, pas seulement par l'UI ;
--   (C) les colonnes non sensibles restent lisibles en direct par un compte authentifié (RLS 0011) ;
--   (D) la RPC `list_staff_members_v1()` RÉTABLIT la lecture des 2 colonnes UNIQUEMENT pour
--       admin/manager (SECURITY DEFINER) et renvoie l'état RÉEL (taux + notes de la fixture) ;
--   (E) FAIL-CLOSED : server / promoter / security / security_counter → `forbidden` (42501) ; un compte
--       `authenticated` SANS mapping staff_users (rôle NULL — le PIÈGE documenté dans 0021) → `forbidden`
--       AUSSI (la garde refuse explicitement uid null ET rôle null via coalesce, elle ne fuit rien) ;
--       `anon` n'a même pas l'EXECUTE (insufficient_privilege).
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Fixture LABO créée dans la transaction annulée : un staff_member avec taux_horaire + notes_direction
-- renseignés. subs des staff_users identiques à 0023/0025/0026/0027/0028/0029.
-- NB : les variables psql (\gset) ne sont PAS interpolées dans les blocs dollar-quotés ($$…$$) ; les
--      assertions passent donc par des helpers pg_temp appelés depuis des SELECT normaux (interpolés).

begin;

\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set security_id '8177e05b-90fa-41d8-a2ba-2468acb296f7'
\set counter_id  '635c3963-868e-449e-b005-e895b933db15'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'
-- uuid volontairement ABSENT de staff_users → current_staff_role() = NULL (le PIÈGE de la garde).
\set unmapped_id '00000000-0000-0000-0000-0000000000ff'

create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual, 'NULL');
  end if;
end $$;

create or replace function pg_temp.expect_bool(p_actual boolean, p_expected boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU %, OBTENU %', p_label, p_expected, coalesce(p_actual::text, 'NULL');
  end if;
end $$;

-- La RPC list_staff_members_v1() DOIT lever forbidden (42501) pour le rôle courant. Un succès = FAILLE.
-- (Appelée sous le rôle/identité déjà positionnés par le caller.)
create or replace function pg_temp.expect_list_forbidden(p_label text) returns void
language plpgsql as $$
declare n int;
begin
  select count(*) into n from public.list_staff_members_v1();
  raise exception 'FAILLE %: list_staff_members_v1 a RÉUSSI (% lignes) — attendu forbidden 42501', p_label, n;
exception
  when insufficient_privilege then null; -- 42501 = comportement attendu
end $$;

-- La lecture DIRECTE d'une colonne sensible DOIT être refusée (permission denied for column).
create or replace function pg_temp.expect_column_denied(p_col text, p_label text) returns void
language plpgsql as $$
begin
  execute format('select %I from public.staff_members limit 1', p_col);
  raise exception 'FAILLE %: colonne %I lisible en direct — attendu insufficient_privilege', p_label, p_col;
exception
  when insufficient_privilege then null; -- permission denied for column = attendu
end $$;

-- ------------------------------------------------------------
-- Fixture (créée en tant que postgres — bypass RLS ; annulée au rollback).
-- ------------------------------------------------------------
insert into public.staff_members (username, full_name, poste, contrat_type, taux_horaire, actif, notes_direction)
values ('zz-fixture-dir-0021', 'FIXTURE Direction (test 0021)', 'manager', 'cdi', 25.50, true, 'note confidentielle direction')
returning id as fx_id \gset

-- ============================================================
-- (A) PRIVILÈGE COLONNE — au niveau du grant, indépendant des lignes.
-- ============================================================
select pg_temp.expect_bool(
  has_column_privilege('authenticated', 'public.staff_members', 'taux_horaire', 'SELECT'),
  false, 'A/taux_horaire non lisible par authenticated');
select pg_temp.expect_bool(
  has_column_privilege('authenticated', 'public.staff_members', 'notes_direction', 'SELECT'),
  false, 'A/notes_direction non lisible par authenticated');
-- Colonnes non sensibles : conservées.
select pg_temp.expect_bool(
  has_column_privilege('authenticated', 'public.staff_members', 'full_name', 'SELECT'),
  true, 'A/full_name lisible par authenticated');
select pg_temp.expect_bool(
  has_column_privilege('authenticated', 'public.staff_members', 'username', 'SELECT'),
  true, 'A/username lisible par authenticated');
select pg_temp.expect_bool(
  has_column_privilege('authenticated', 'public.staff_members', 'poste', 'SELECT'),
  true, 'A/poste lisible par authenticated');

-- ============================================================
-- (B) DÉFENSE EN PROFONDEUR — même la direction ne lit pas ces colonnes en direct.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'manager_id');
select pg_temp.expect_column_denied('taux_horaire', 'B/manager direct');
select pg_temp.expect_column_denied('notes_direction', 'B/manager direct');

-- ============================================================
-- (C) Colonnes non sensibles lisibles en direct par un compte authentifié (RLS 0011).
-- ============================================================
-- La direction (manager) voit toutes les lignes → lit full_name de la fixture sans erreur.
select full_name as c_name from public.staff_members where id = :'fx_id'::uuid \gset

-- ============================================================
-- (D) RPC vue DIRECTION — RÉTABLIT taux + notes pour admin/manager (SECURITY DEFINER).
-- ============================================================
-- manager : lit la fixture AVEC taux_horaire (impossible en direct, cf. B) → preuve du rétablissement.
select taux_horaire::text as d_manager_taux, notes_direction as d_manager_notes
from public.list_staff_members_v1() where id = :'fx_id'::uuid \gset

-- admin : idem (les deux profils direction).
set local role authenticated; select pg_temp.act_as(:'admin_id');
select count(*)::text as d_admin_count from public.list_staff_members_v1() where id = :'fx_id'::uuid \gset

-- ============================================================
-- (E) FAIL-CLOSED — non-direction et compte non mappé refusés ; anon sans execute.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect_list_forbidden('E/server');
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect_list_forbidden('E/promoter');
set local role authenticated; select pg_temp.act_as(:'security_id');
select pg_temp.expect_list_forbidden('E/security');
set local role authenticated; select pg_temp.act_as(:'counter_id');
select pg_temp.expect_list_forbidden('E/counter');
-- Le PIÈGE : compte authenticated SANS mapping staff_users → rôle NULL → doit AUSSI être refusé.
set local role authenticated; select pg_temp.act_as(:'unmapped_id');
select pg_temp.expect_list_forbidden('E/unmapped (rôle NULL)');
-- anon : n'a même pas l'EXECUTE (grant authenticated only).
set local role anon;
select pg_temp.expect_list_forbidden('E/anon (aucun execute)');

reset role;

-- ------------------------------------------------------------
-- Assertions sur les valeurs capturées (lues en postgres — data, pas RLS).
-- ------------------------------------------------------------
select pg_temp.expect(:'c_name', 'FIXTURE Direction (test 0021)', 'C/full_name direct lisible');
select pg_temp.expect(:'d_manager_taux', '25.50', 'D/manager RPC lit taux via SECURITY DEFINER');
select pg_temp.expect(:'d_manager_notes', 'note confidentielle direction', 'D/manager RPC lit notes');
select pg_temp.expect(:'d_admin_count', '1', 'D/admin RPC voit la fixture');

select '0021 staff column privacy (grant colonne révoqué taux/notes / défense en profondeur direction / non sensibles OK / RPC direction rétablit taux+notes / fail-closed server-promoter-security-counter-unmapped-anon) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
