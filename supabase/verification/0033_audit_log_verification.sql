-- 0033_audit_log_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0033 — SOCLE 0.5 : JOURNAL D'AUDIT GLOBAL.
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée ; le module
-- SHIP VIDE), les invariants de sécurité qui font la valeur d'un journal d'audit :
--   (A) `log_audit_event` : VOLATILE (elle écrit) + SECURITY DEFINER + search_path=public ; EXECUTE
--       accordé à `authenticated`, RÉVOQUÉ à `anon` ;
--   (B) table `audit_log` : RLS activée ; `authenticated` a SELECT mais PAS insert/update/delete
--       (append-only côté privilège) ; `anon` n'a AUCUN privilège ;
--   (C) écriture fonctionnelle : un `admin` authentifié journalise via la RPC → uuid retourné, ligne
--       présente avec les champs métier stockés (action/resource/venue/before/after/metadata) ;
--   (D) ACTEUR NON USURPABLE : la RPC n'a aucun paramètre d'acteur ; `actor_username`/`actor_role`
--       reflètent la SESSION appelante — un appel `server` estampille 'server', un appel `admin`
--       estampille 'admin' (contraste prouvé) ;
--   (E) FAIL-CLOSED : une session authentifiée SANS mapping staff (auth.uid() null → rôle null) ne peut
--       PAS journaliser → 42501 ; NON-VACUITÉ : le même appel réussit pour un admin mappé ;
--   (F) garde d'entrée : action vide → 22023 ;
--   (G) LECTURE DIRECTION (RLS mord) : après insertion, un `admin` voit les lignes, un `manager` en voit
--       ZÉRO (fermé par RLS, pas par l'UI) — contraste = non-vacuité ;
--   (H) APPEND-ONLY au moteur (NON-VACUITÉ) : `authenticated` en INSERT / UPDATE / DELETE DIRECT sur
--       `audit_log` → insufficient_privilege (42501) : le journal est infalsifiable via l'app.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- subs des staff_users identiques à 0020/0023/0025 (LABO). NB : les variables psql (\gset) ne sont pas
-- interpolées dans les blocs $$…$$ ; les bascules d'identité et captures d'erreur passent par des
-- helpers pg_temp appelés depuis des SELECT normaux.

begin;

\set admin_sub   '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_sub '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set server_sub  '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

-- Bascule d'identité (comme 0020) : sub présent → auth.uid()=sub ; sub null → session authentifiée
-- « anonyme » (auth.uid() null) pour éprouver le fail-closed.
create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  if p_sub is null then
    perform set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true);
  end if;
end $$;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual,'NULL');
  end if;
end $$;

-- Enveloppe une tentative de journalisation et renvoie 'NO_ERROR' ou le SQLSTATE (SECURITY INVOKER :
-- s'exécute avec les privilèges de l'appelant courant → éprouve réellement le grant EXECUTE et le
-- fail-closed interne à la RPC).
create or replace function pg_temp.try_log(p_action text) returns text
language plpgsql as $$
begin
  perform public.log_audit_event(p_action, 'verif', 'x');
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end $$;

-- Enveloppent une écriture DIRECTE sur la table (doit être refusée à `authenticated` : append-only).
create or replace function pg_temp.try_direct_insert() returns text
language plpgsql as $$
begin
  insert into public.audit_log(action, actor_username, actor_role)
  values ('forge.direct', 'usurpateur', 'admin');
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end $$;

create or replace function pg_temp.try_direct_update() returns text
language plpgsql as $$
begin
  update public.audit_log set summary = 'altéré' where true;
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end $$;

create or replace function pg_temp.try_direct_delete() returns text
language plpgsql as $$
begin
  delete from public.audit_log where true;
  return 'NO_ERROR';
exception when others then
  return sqlstate;
end $$;

-- ============================================================
-- (A) Attributs + grants de log_audit_event (lus en postgres = métadonnées, pas RLS).
-- ============================================================
select
  p.provolatile as a_volatile,             -- 'v' (VOLATILE : elle écrit)
  p.prosecdef   as a_secdef,               -- true (SECURITY DEFINER)
  (p.proconfig @> array['search_path=public']) as a_searchpath
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'log_audit_event' \gset

select
  has_function_privilege('authenticated',
    'public.log_audit_event(text,text,text,text,text,uuid,jsonb,jsonb,jsonb)','EXECUTE') as a_exec_auth,
  has_function_privilege('anon',
    'public.log_audit_event(text,text,text,text,text,uuid,jsonb,jsonb,jsonb)','EXECUTE') as a_exec_anon \gset

-- ============================================================
-- (B) Privilèges de table + RLS activée.
-- ============================================================
select
  c.relrowsecurity as b_rls,
  has_table_privilege('authenticated','public.audit_log','SELECT') as b_auth_select,
  has_table_privilege('authenticated','public.audit_log','INSERT') as b_auth_insert,
  has_table_privilege('authenticated','public.audit_log','UPDATE') as b_auth_update,
  has_table_privilege('authenticated','public.audit_log','DELETE') as b_auth_delete,
  has_table_privilege('anon','public.audit_log','SELECT') as b_anon_select,
  has_table_privilege('anon','public.audit_log','INSERT') as b_anon_insert
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'audit_log' \gset

-- ============================================================
-- (C)+(D) Écriture fonctionnelle + acteur estampillé depuis la session (admin puis server).
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select public.log_audit_event(
  'table.assign', 'club_tables', 'VERIF-0033-T12',
  'assignation table (fixture 0033)', 'eden', null,
  '{"assigned_to":null}'::jsonb, '{"assigned_to":"mathias"}'::jsonb,
  '{"src":"verif"}'::jsonb
) as c_admin_id \gset

set local role authenticated; select pg_temp.act_as(:'server_sub');
select public.log_audit_event('expense.add', 'expenses', 'VERIF-0033-E1') as d_server_id \gset

-- (E) Fail-closed : session authentifiée sans sub → rôle null → refus (42501). NON-VACUITÉ : capture
--     aussi un appel admin VALIDE (doit renvoyer NO_ERROR) pour prouver que le wrapper distingue.
set local role authenticated; select pg_temp.act_as(null);
select pg_temp.try_log('should.fail') as e_nomap \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_log('should.pass') as e_admin_ok \gset

-- (F) Action vide → 22023.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_log('   ') as f_empty \gset

-- (G) Lecture RLS : admin voit les lignes fixtures, manager n'en voit AUCUNE.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select count(*)::text as g_admin_cnt
from public.audit_log where resource_id in ('VERIF-0033-T12','VERIF-0033-E1') \gset
set local role authenticated; select pg_temp.act_as(:'manager_sub');
select count(*)::text as g_manager_cnt
from public.audit_log where resource_id in ('VERIF-0033-T12','VERIF-0033-E1') \gset

-- (H) Append-only : INSERT / UPDATE / DELETE DIRECT sous `authenticated` → refus privilège.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_direct_insert() as h_insert \gset
select pg_temp.try_direct_update() as h_update \gset
select pg_temp.try_direct_delete() as h_delete \gset

reset role;

-- ------------------------------------------------------------
-- Assertions sur l'ÉTAT RÉEL des lignes estampillées (lues en postgres = data, RLS contournée par
-- le propriétaire) — prouve que l'acteur vient de la SESSION, pas du client (aucun param d'acteur).
-- ------------------------------------------------------------
create or replace function pg_temp.assert_row(p_resource_id text, p_username text, p_role text, p_action text)
returns void language plpgsql as $$
declare r public.audit_log%rowtype;
begin
  select * into r from public.audit_log where resource_id = p_resource_id;
  if not found then
    raise exception 'ligne d''audit % introuvable (l''écriture via RPC a échoué)', p_resource_id;
  end if;
  if r.actor_username is distinct from p_username then
    raise exception '% actor_username ATTENDU %, OBTENU %', p_resource_id, p_username, coalesce(r.actor_username,'NULL');
  end if;
  if r.actor_role is distinct from p_role then
    raise exception '% actor_role ATTENDU %, OBTENU %', p_resource_id, p_role, coalesce(r.actor_role,'NULL');
  end if;
  if r.action is distinct from p_action then
    raise exception '% action ATTENDU %, OBTENU %', p_resource_id, p_action, coalesce(r.action,'NULL');
  end if;
  if r.occurred_at is null then
    raise exception '% occurred_at NULL — le « quand » doit être estampillé', p_resource_id;
  end if;
end $$;

-- Vérifie que l'instantané before/after (support de réversibilité) est bien conservé sur la ligne admin.
create or replace function pg_temp.assert_snapshot(p_resource_id text) returns void
language plpgsql as $$
declare r public.audit_log%rowtype;
begin
  select * into r from public.audit_log where resource_id = p_resource_id;
  if r.before_data is null or r.after_data is null then
    raise exception '% before/after_data NULL — l''instantané de réversibilité doit être conservé', p_resource_id;
  end if;
  if (r.after_data->>'assigned_to') is distinct from 'mathias' then
    raise exception '% after_data non conservé fidèlement (obtenu %)', p_resource_id, r.after_data::text;
  end if;
end $$;

-- (A)
select pg_temp.expect(:'a_volatile', 'v',    'A.volatile (log_audit_event écrit → VOLATILE)');
select pg_temp.expect(:'a_secdef',   't',    'A.security_definer');
select pg_temp.expect(:'a_searchpath','t',   'A.search_path=public');
select pg_temp.expect(:'a_exec_auth','t',    'A.execute authenticated accordé');
select pg_temp.expect(:'a_exec_anon','f',    'A.execute anon révoqué');
-- (B)
select pg_temp.expect(:'b_rls',        't', 'B.RLS activée sur audit_log');
select pg_temp.expect(:'b_auth_select','t', 'B.authenticated SELECT accordé');
select pg_temp.expect(:'b_auth_insert','f', 'B.authenticated INSERT refusé (append-only)');
select pg_temp.expect(:'b_auth_update','f', 'B.authenticated UPDATE refusé (append-only)');
select pg_temp.expect(:'b_auth_delete','f', 'B.authenticated DELETE refusé (append-only)');
select pg_temp.expect(:'b_anon_select','f', 'B.anon SELECT refusé');
select pg_temp.expect(:'b_anon_insert','f', 'B.anon INSERT refusé');
-- (C)+(D) acteur estampillé depuis la session
select pg_temp.assert_row('VERIF-0033-T12', 'lab-admin-01', 'admin',  'table.assign');
select pg_temp.assert_row('VERIF-0033-E1',  'server',       'server', 'expense.add');
select pg_temp.assert_snapshot('VERIF-0033-T12');
-- (E) fail-closed + non-vacuité
select pg_temp.expect(:'e_nomap',   '42501',    'E.session sans mapping staff → refus');
select pg_temp.expect(:'e_admin_ok','NO_ERROR', 'E.non-vacuité : admin mappé journalise bien');
-- (F)
select pg_temp.expect(:'f_empty', '22023', 'F.action vide → refus');
-- (G) RLS lecture direction
select pg_temp.expect(:'g_admin_cnt',  '2', 'G.admin voit les 2 lignes fixtures');
select pg_temp.expect(:'g_manager_cnt','0', 'G.manager ne voit AUCUNE ligne (RLS direction-only)');
-- (H) append-only au moteur
select pg_temp.expect(:'h_insert', '42501', 'H.INSERT direct authenticated refusé');
select pg_temp.expect(:'h_update', '42501', 'H.UPDATE direct authenticated refusé');
select pg_temp.expect(:'h_delete', '42501', 'H.DELETE direct authenticated refusé');

select '0033 audit_log (append-only infalsifiable · acteur estampillé serveur non usurpable · lecture RLS direction-only · fail-closed sans mapping · action requise · instantané réversibilité conservé) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
