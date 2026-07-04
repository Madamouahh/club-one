-- 0020_rh_self_confirm_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0020 — VUE SALARIÉ : confirmation de
-- présence « 1 tap » via la RPC SECURITY DEFINER `confirm_my_shift_v1(uuid)`.
--
-- Comble un TROU de la convention du dépôt (0020 était l'une des deux migrations ≥ 0010 sans fichier
-- de vérification — cf. docs/MIGRATIONS_REGISTRY.md §4 et tests/migrationsRegistry.test.mts, set
-- KNOWN_VERIF_GAPS_GTE_0010). Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune
-- donnée de test ne persiste ; le module RH ship VIDE, cf. 0011), le CONTRAT de surface de la RPC :
--   (A) authentification : session authentifiée SANS sub (auth.uid() null) → code `unauthorized` ;
--   (B) compte staff SANS fiche salarié rattachée (username sans staff_member) → code `no_member` ;
--   (C) transition unique planifie → confirme : un salarié confirme SON créneau → code `ok`,
--       la ligne passe à `confirme` ; SURFACE BORNÉE — seule la colonne status change (actual_start
--       reste NULL, planned_start inchangé : la RPC ne pointe pas, ne réhoraire pas) ;
--   (D) idempotence : re-confirmer un créneau déjà `confirme` → code `already`, sans nouvelle écriture ;
--   (E) créneau déjà traité par la direction (`present`) → code `not_confirmable`, ligne INCHANGÉE
--       (le pointage réel present/absent/retard reste prérogative direction, 0011) ;
--   (F) appartenance stricte : confirmer le créneau d'un AUTRE salarié → code `forbidden`, ligne
--       de l'autre INCHANGÉE (aucune fuite / écriture inter-salarié) ;
--   (G) créneau inexistant → code `not_found`.
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Fixtures LABO créées dans la transaction annulée : deux staff_members (username 'server' = le salarié
-- acteur, mappé au staff_user réel du labo ; 'lab-promoter-01' = un AUTRE salarié) + leurs shifts. subs
-- des staff_users identiques à 0023/0025/0026/0027/0028/0029.
-- NB : les variables psql (\gset) ne sont PAS interpolées dans les blocs dollar-quotés ($$…$$) ; les
--      assertions passent donc par des helpers pg_temp appelés depuis des SELECT normaux (interpolés).

begin;

\set admin_id   '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set server_sub '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

-- Bascule d'identité : sub présent → auth.uid() = sub ; sub null → session authentifiée « anonyme »
-- (auth.uid() null) pour éprouver la garde d'authentification de la RPC.
create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  if p_sub is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  end if;
end $$;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual, 'NULL');
  end if;
end $$;

-- Assertion d'ÉTAT RÉEL des lignes (interpolation psql impossible dans un bloc $$ : on passe les ids
-- en paramètres depuis un SELECT normal). Prouve la SURFACE BORNÉE de la RPC.
create or replace function pg_temp.assert_final_state(p_planifie uuid, p_present uuid, p_foreign uuid)
returns void language plpgsql as $$
declare
  v_status text;
  v_actual_start timestamptz;
  v_planned_start timestamptz;
begin
  -- (C) Le créneau confirmé est passé à `confirme`, SANS pointage (actual_start null) et SANS
  --     réhoraire (planned_start intact) : la RPC ne touche QUE status.
  select status, actual_start, planned_start into v_status, v_actual_start, v_planned_start
  from public.staff_shifts where id = p_planifie;
  if v_status <> 'confirme' then
    raise exception 'C état : créneau planifié attendu confirme, obtenu %', v_status;
  end if;
  if v_actual_start is not null then
    raise exception 'C surface : actual_start a été renseigné (%) — la RPC ne doit PAS pointer', v_actual_start;
  end if;
  if v_planned_start is distinct from timestamptz '2099-12-01 22:00+01' then
    raise exception 'C surface : planned_start modifié (%) — la RPC ne doit PAS réhorairer', v_planned_start;
  end if;

  -- (E) Le créneau `present` (pointage direction) est resté INCHANGÉ.
  select status into v_status from public.staff_shifts where id = p_present;
  if v_status <> 'present' then
    raise exception 'E état : créneau present altéré, obtenu %', v_status;
  end if;

  -- (F) Le créneau de l'AUTRE salarié n'a pas bougé (aucune écriture inter-salarié).
  select status into v_status from public.staff_shifts where id = p_foreign;
  if v_status <> 'planifie' then
    raise exception 'F état : créneau d''un autre salarié altéré, obtenu %', v_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- Fixtures (créées en tant que postgres, propriétaire — bypass RLS ; annulées au rollback).
-- ------------------------------------------------------------
-- Le salarié acteur : sa fiche a pour username 'server' → current_staff_username() du sub server.
insert into public.staff_members (username, full_name, poste, actif)
values ('server', 'FIXTURE Salarié (test 0020)', 'bar', true)
returning id as emp_member \gset

-- Un AUTRE salarié (pour éprouver l'appartenance stricte) — username = staff_user promoter du labo.
insert into public.staff_members (username, full_name, poste, actif)
values ('lab-promoter-01', 'FIXTURE Autre salarié (test 0020)', 'accueil', true)
returning id as other_member \gset

-- Créneaux du salarié acteur (dates distinctes : unique (staff_member_id, exploitation_date)).
insert into public.staff_shifts (staff_member_id, exploitation_date, poste, planned_start, planned_end, status)
values (:'emp_member'::uuid, date '2099-12-01', 'bar',
        timestamptz '2099-12-01 22:00+01', timestamptz '2099-12-02 05:00+01', 'planifie')
returning id as shift_planifie \gset

insert into public.staff_shifts (staff_member_id, exploitation_date, poste, status)
values (:'emp_member'::uuid, date '2099-12-02', 'bar', 'confirme')
returning id as shift_confirme \gset

insert into public.staff_shifts (staff_member_id, exploitation_date, poste, status)
values (:'emp_member'::uuid, date '2099-12-03', 'bar', 'present')
returning id as shift_present \gset

-- Créneau d'un AUTRE salarié (le salarié acteur ne doit pas pouvoir le confirmer).
insert into public.staff_shifts (staff_member_id, exploitation_date, poste, status)
values (:'other_member'::uuid, date '2099-12-01', 'accueil', 'planifie')
returning id as shift_foreign \gset

-- ============================================================
-- Appels de la RPC sous le rôle applicatif `authenticated` (jamais postgres).
-- La RPC est SECURITY DEFINER : le corps s'exécute avec les privilèges du propriétaire, mais borne
-- lui-même l'action au créneau de l'appelant — le grant `authenticated` n'ouvre aucun accès transversal.
-- ============================================================

-- (A) Session authentifiée SANS sub → auth.uid() null → unauthorized.
set local role authenticated; select pg_temp.act_as(null);
select code as a_code from public.confirm_my_shift_v1(:'shift_planifie'::uuid) \gset

-- (B) Compte staff mappé (admin) mais SANS fiche salarié (aucun staff_member username 'lab-admin-01').
set local role authenticated; select pg_temp.act_as(:'admin_id');
select code as b_code from public.confirm_my_shift_v1(:'shift_planifie'::uuid) \gset

-- (C) Le salarié confirme SON créneau planifié → ok / confirme.
set local role authenticated; select pg_temp.act_as(:'server_sub');
select code as c_code, status as c_status from public.confirm_my_shift_v1(:'shift_planifie'::uuid) \gset

-- (D) Idempotence : re-confirmer un créneau déjà confirmé → already.
select code as d_code, status as d_status from public.confirm_my_shift_v1(:'shift_confirme'::uuid) \gset

-- (E) Créneau déjà pointé present par la direction → not_confirmable (non ré-ouvrable par le salarié).
select code as e_code, status as e_status from public.confirm_my_shift_v1(:'shift_present'::uuid) \gset

-- (F) Créneau d'un autre salarié → forbidden (appartenance stricte).
select code as f_code from public.confirm_my_shift_v1(:'shift_foreign'::uuid) \gset

-- (G) Créneau inexistant → not_found.
select code as g_code from public.confirm_my_shift_v1(gen_random_uuid()) \gset

reset role;

-- ------------------------------------------------------------
-- Assertions sur les CODES retournés (lues en postgres — data, pas RLS).
-- ------------------------------------------------------------
select pg_temp.expect(:'a_code', 'unauthorized',    'A (session sans sub)');
select pg_temp.expect(:'b_code', 'no_member',       'B (compte sans fiche salarié)');
select pg_temp.expect(:'c_code', 'ok',              'C.code (confirmation planifie→confirme)');
select pg_temp.expect(:'c_status', 'confirme',      'C.status');
select pg_temp.expect(:'d_code', 'already',         'D (idempotence)');
select pg_temp.expect(:'d_status', 'confirme',      'D.status');
select pg_temp.expect(:'e_code', 'not_confirmable', 'E (créneau déjà traité direction)');
select pg_temp.expect(:'e_status', 'present',       'E.status (renvoyé tel quel)');
select pg_temp.expect(:'f_code', 'forbidden',       'F (créneau d''un autre salarié)');
select pg_temp.expect(:'g_code', 'not_found',       'G (créneau inexistant)');

-- ------------------------------------------------------------
-- Assertions sur l'ÉTAT RÉEL des lignes après appels — SURFACE STRICTEMENT BORNÉE.
-- ------------------------------------------------------------
select pg_temp.assert_final_state(:'shift_planifie'::uuid, :'shift_present'::uuid, :'shift_foreign'::uuid);

select '0020 confirm_my_shift_v1 (unauthorized / no_member / ok+confirme surface bornée / already / not_confirmable / forbidden / not_found + lignes réelles inchangées hors transition) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
