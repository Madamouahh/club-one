-- 0035_carte_produit_actif_rpc_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0035 — RETRAIT / REMISE EN CARTE (`actif`)
-- + câblage du journal d'audit 0033 (action `carte.produit.actif`).
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) `set_produit_actif_v1` est SECURITY DEFINER + search_path=public + VOLATILE (elle écrit) ;
--       EXECUTE accordé à `authenticated`, RÉVOQUÉ à `anon` ;
--   (B) FAIL-CLOSED de rôle : une session `server` (ni admin ni manager) est refusée (42501) ;
--       NON-VACUITÉ : un `admin` réussit (NO_ERROR) — la garde distingue bien ;
--   (C) RETRAIT (admin) : `actif` réellement basculé à false sur la LIGNE produit + audit
--       `carte.produit.actif` before=true / after=false, acteur estampillé depuis la SESSION (admin) ;
--   (D) REMISE (admin) : re-bascule à true réellement observée sur la ligne + audit before=false/after=true
--       (support de réversibilité : l'aller ET le retour sont tracés) ;
--   (E) GARDES : `actif` NULL → 22023, produit introuvable → P0002 ;
--   (F) ACTEUR NON USURPABLE / stamping : un RETRAIT par un `manager` estampille actor_role='manager'
--       (contraste avec 'admin') — aucun paramètre d'acteur n'existe dans la RPC.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- subs des staff_users identiques à 0034 (LABO). Les variables psql (:'var'/\gset) NE SONT PAS
-- interpolées dans les blocs $$…$$ : bascules d'identité, captures d'erreur et assertions sur les
-- lignes passent par des helpers pg_temp appelés depuis des SELECT normaux (tradition 0033/0034).

begin;

\set admin_sub   '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_sub '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set server_sub  '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

-- Bascule d'identité (sub présent → auth.uid()=sub ; sub null → session authentifiée « anonyme »).
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

-- Attributs + grants d'une fonction (lus en postgres = métadonnées, pas RLS).
create or replace function pg_temp.assert_fn_hardened(p_name text, p_typesig text, p_expect_volatile boolean)
returns void language plpgsql as $$
declare v_secdef bool; v_sp bool; v_vol char; v_exec_auth bool; v_exec_anon bool; v_sig text; v_cnt int;
begin
  select count(*) into v_cnt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname=p_name;
  if v_cnt <> 1 then raise exception 'A.%: attendu 1 fonction, trouvé %', p_name, v_cnt; end if;
  select p.prosecdef, (p.proconfig @> array['search_path=public']), p.provolatile
    into v_secdef, v_sp, v_vol
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname=p_name;
  if not v_secdef then raise exception 'A.% pas SECURITY DEFINER', p_name; end if;
  if not v_sp then raise exception 'A.% search_path != public', p_name; end if;
  if p_expect_volatile and v_vol <> 'v' then raise exception 'A.% pas VOLATILE (%)', p_name, v_vol; end if;
  v_sig := format('public.%s(%s)', p_name, p_typesig);
  v_exec_auth := has_function_privilege('authenticated', v_sig, 'EXECUTE');
  v_exec_anon := has_function_privilege('anon',          v_sig, 'EXECUTE');
  if not v_exec_auth then raise exception 'A.% EXECUTE authenticated manquant', p_name; end if;
  if v_exec_anon    then raise exception 'A.% EXECUTE anon PRÉSENT (doit être révoqué)', p_name; end if;
end $$;

-- Wrapper d'erreur (SECURITY INVOKER : s'exécute avec les privilèges de l'appelant courant → éprouve
-- réellement le grant EXECUTE et le fail-closed interne de la RPC).
create or replace function pg_temp.try_actif(p_id uuid, p_actif boolean)
returns text language plpgsql as $$
begin perform public.set_produit_actif_v1(p_id,p_actif); return 'NO_ERROR';
exception when others then return sqlstate; end $$;

-- Assertions sur la ligne d'audit `carte.produit.actif` (lues en postgres = data, RLS contournée).
-- IMPORTANT : dans une SEULE transaction, now() (donc occurred_at) est CONSTANT → deux lignes d'audit
-- de la même (resource, action) partagent l'horodatage et « order by occurred_at desc » est ambigu.
-- On localise donc la ligne par sa PAIRE (before,after) — plus robuste ET plus fort : on prouve qu'une
-- entrée EXACTE existe (et une seule), puis on vérifie que SON acteur est le bon.
create or replace function pg_temp.assert_actif_audit(
  p_rid text, p_before boolean, p_after boolean, p_role text, p_user text
) returns void language plpgsql as $$
declare r public.audit_log%rowtype; v_cnt int;
begin
  select count(*) into v_cnt from public.audit_log
   where resource_id=p_rid and action='carte.produit.actif'
     and (before_data->>'actif')::boolean is not distinct from p_before
     and (after_data->>'actif')::boolean  is not distinct from p_after;
  if v_cnt <> 1 then
    raise exception 'actif.% : attendu 1 audit (before=%,after=%), trouvé %', p_rid, p_before, p_after, v_cnt;
  end if;
  select * into r from public.audit_log
   where resource_id=p_rid and action='carte.produit.actif'
     and (before_data->>'actif')::boolean is not distinct from p_before
     and (after_data->>'actif')::boolean  is not distinct from p_after;
  if r.actor_role is distinct from p_role then raise exception 'actif.% actor_role ATTENDU %, OBTENU %', p_rid, p_role, coalesce(r.actor_role,'NULL'); end if;
  if r.actor_username is distinct from p_user then raise exception 'actif.% actor_username ATTENDU %, OBTENU %', p_rid, p_user, coalesce(r.actor_username,'NULL'); end if;
  if r.resource_type is distinct from 'produits_bar' then raise exception 'actif.% resource_type != produits_bar', p_rid; end if;
end $$;

-- Username réellement mappé au manager (pour l'assertion de stamping F).
select username as manager_username from public.staff_users where auth_id = :'manager_sub' \gset

-- ============================================================
-- (A) Durcissement de la RPC.
-- ============================================================
select pg_temp.assert_fn_hardened('set_produit_actif_v1', 'uuid, boolean', true);

-- ============================================================
-- (C) RETRAIT (admin) — fixture puis bascule actif=false ; capture de l'état renvoyé par la RPC.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.create_produit_v1('VERIF-0035-RETRAIT', 'TestCat', 5.00, 'eden', null)).id as cid_retrait \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.set_produit_actif_v1(:'cid_retrait'::uuid, false)).actif::text as retrait_actif \gset

-- (D) REMISE (admin) — fixture retirée dès la création puis remise à actif=true.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.create_produit_v1('VERIF-0035-REMISE', 'TestCat', 5.00, 'eden', null)).id as cid_remise \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.set_produit_actif_v1(:'cid_remise'::uuid, false)).actif::text as remise_off \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.set_produit_actif_v1(:'cid_remise'::uuid, true)).actif::text as remise_actif \gset

-- (F) STAMPING — retrait par un manager (contraste d'acteur).
set local role authenticated; select pg_temp.act_as(:'manager_sub');
select (public.create_produit_v1('VERIF-0035-MGR', 'CatM', 3.00, 'terminus', null)).id as cid_mgr \gset
set local role authenticated; select pg_temp.act_as(:'manager_sub');
select (public.set_produit_actif_v1(:'cid_mgr'::uuid, false)).actif::text as mgr_actif \gset

-- ============================================================
-- (B) FAIL-CLOSED de rôle : server refusé ; admin réussit (non-vacuité).
--   NB : le server VISE cid_retrait mais est REFUSÉ (42501) → aucune mutation, cid_retrait reste false.
--   L'admin non-vacuité VISE une fixture DÉDIÉE (jamais relue en état final) pour ne pas perturber
--   les assertions d'état des lignes (C)/(D).
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.create_produit_v1('VERIF-0035-OKV', 'C', 1.00, 'eden', null)).id as cid_okv \gset
set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.try_actif(:'cid_retrait'::uuid, true)  as b_srv_actif \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_actif(:'cid_okv'::uuid, false)     as b_admin_ok \gset

-- ============================================================
-- (E) GARDES de validation (admin authentifié → passe le rôle, éprouve les validations).
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_actif(:'cid_retrait'::uuid, null)                        as e_null_actif \gset
select pg_temp.try_actif('00000000-0000-0000-0000-000000000000'::uuid, false) as e_404 \gset

reset role;

-- ------------------------------------------------------------
-- État RÉEL des lignes produit (lu en postgres = data) — prouve la mutation, pas seulement l'audit.
-- ------------------------------------------------------------
select actif::text as prod_retrait_actif from public.produits_bar where id = :'cid_retrait'::uuid \gset
select actif::text as prod_remise_actif  from public.produits_bar where id = :'cid_remise'::uuid \gset

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- (A) déjà asserté ci-dessus (assert_fn_hardened lève si non conforme).

-- (B) fail-closed + non-vacuité
select pg_temp.expect(:'b_srv_actif','42501',   'B.server RETRAIT/REMISE refusé (42501)');
select pg_temp.expect(:'b_admin_ok', 'NO_ERROR', 'B.non-vacuité : admin réussit');

-- (C) retrait : mutation réelle + audit before=true/after=false + acteur estampillé admin
select pg_temp.expect(:'retrait_actif','false',      'C.RPC renvoie actif=false');
select pg_temp.expect(:'prod_retrait_actif','false', 'C.ligne produit réellement actif=false (retirée de la carte)');
select pg_temp.assert_actif_audit(:'cid_retrait', true, false, 'admin', 'lab-admin-01');

-- (D) remise : aller-retour réel + audit before=false/after=true (réversibilité)
select pg_temp.expect(:'remise_off','false',        'D.retrait initial actif=false');
select pg_temp.expect(:'remise_actif','true',       'D.RPC renvoie actif=true après remise');
select pg_temp.expect(:'prod_remise_actif','true',  'D.ligne produit réellement actif=true (remise en carte)');
select pg_temp.assert_actif_audit(:'cid_remise', false, true, 'admin', 'lab-admin-01');

-- (E) gardes de validation
select pg_temp.expect(:'e_null_actif','22023', 'E.actif NULL → 22023');
select pg_temp.expect(:'e_404','P0002',        'E.produit introuvable → P0002');

-- (F) stamping : le retrait manager estampille bien 'manager' (contraste avec admin ci-dessus)
select pg_temp.assert_actif_audit(:'cid_mgr', true, false, 'manager', :'manager_username');

select '0035 carte_produit_actif_rpc (retrait/remise en carte admin/manager fail-closed · mutation réelle de `actif` distincte de `disponible` · audit carte.produit.actif estampillé depuis la session · before/after réversibilité aller-retour · validations 22023/P0002) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
