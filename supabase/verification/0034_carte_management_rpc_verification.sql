-- 0034_carte_management_rpc_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0034 — GESTION DE CARTE DANS LE BACK
-- + PREMIER CÂBLAGE du journal d'audit 0033 sur des mutations de carte.
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) les 3 RPC (set_produit_disponibilite_v1 / create_produit_v1 / update_produit_v1) + le helper
--       assert_carte_manager sont SECURITY DEFINER + search_path=public + VOLATILE (elles écrivent) ;
--       EXECUTE accordé à `authenticated`, RÉVOQUÉ à `anon` ;
--   (B) FAIL-CLOSED de rôle : une session `server` (ni admin ni manager) est refusée sur les 3 RPC
--       (42501) ; NON-VACUITÉ : un `admin` réussit (NO_ERROR) — la garde distingue bien ;
--   (C) CRÉATION fonctionnelle (admin) : produit inséré + ligne d'audit `carte.produit.create` dont
--       l'ACTEUR est estampillé depuis la SESSION (admin), after_data fidèle, pas de before ;
--   (D) TOGGLE disponibilité (admin) : `disponible` réellement basculé sur la ligne produit + audit
--       `carte.produit.disponibilite` before=true / after=false (support de réversibilité) ;
--   (E) MODIFICATION (admin) : prix + catégorie réellement changés sur la ligne produit + audit
--       `carte.produit.update` before/after fidèles ;
--   (F) GARDES de validation (admin) : nom vide → 22023, venue invalide → 22023, prix < 0 → 22023,
--       doublon (venue,nom,format) → 23505, produit introuvable → P0002, renommage en collision → 23505 ;
--   (G) ACTEUR NON USURPABLE / stamping depuis la session : une création par un `manager` estampille
--       actor_role='manager' (contraste avec 'admin') — aucun paramètre d'acteur n'existe dans les RPC.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- subs des staff_users identiques à 0020/0023/0025/0033 (LABO). Les variables psql (:'var'/\gset) NE
-- SONT PAS interpolées dans les blocs $$…$$ : les bascules d'identité, captures d'erreur et assertions
-- sur les lignes passent par des helpers pg_temp appelés depuis des SELECT normaux (tradition 0033).

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
-- p_typesig = signature TYPES SEULS (ex. 'uuid, boolean') pour has_function_privilege ; la fonction est
-- localisée par NOM (un seul overload de chacune dans ce module).
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

-- Wrappers d'erreur (SECURITY INVOKER : s'exécutent avec les privilèges de l'appelant courant → éprouvent
-- réellement le grant EXECUTE et le fail-closed interne des RPC).
create or replace function pg_temp.try_create(p_nom text,p_cat text,p_prix numeric,p_venue text,p_fmt text)
returns text language plpgsql as $$
begin perform public.create_produit_v1(p_nom,p_cat,p_prix,p_venue,p_fmt); return 'NO_ERROR';
exception when others then return sqlstate; end $$;

create or replace function pg_temp.try_toggle(p_id uuid, p_disp boolean)
returns text language plpgsql as $$
begin perform public.set_produit_disponibilite_v1(p_id,p_disp); return 'NO_ERROR';
exception when others then return sqlstate; end $$;

create or replace function pg_temp.try_update(p_id uuid,p_nom text,p_cat text,p_prix numeric,p_fmt text)
returns text language plpgsql as $$
begin perform public.update_produit_v1(p_id,p_nom,p_cat,p_prix,p_fmt); return 'NO_ERROR';
exception when others then return sqlstate; end $$;

-- Assertions sur les lignes d'audit (lues en postgres = data, RLS contournée par le propriétaire).
create or replace function pg_temp.latest_audit(p_rid text, p_action text) returns public.audit_log
language plpgsql as $$
declare r public.audit_log%rowtype;
begin
  select * into r from public.audit_log
   where resource_id=p_rid and action=p_action
   order by occurred_at desc limit 1;
  if not found then raise exception 'audit manquant: resource=% action=%', p_rid, p_action; end if;
  return r;
end $$;

create or replace function pg_temp.assert_create_audit(
  p_rid text, p_venue text, p_nom text, p_prix numeric, p_role text, p_user text
) returns void language plpgsql as $$
declare r public.audit_log%rowtype;
begin
  r := pg_temp.latest_audit(p_rid, 'carte.produit.create');
  if r.actor_role is distinct from p_role then raise exception 'create.% actor_role ATTENDU %, OBTENU %', p_rid, p_role, coalesce(r.actor_role,'NULL'); end if;
  if r.actor_username is distinct from p_user then raise exception 'create.% actor_username ATTENDU %, OBTENU %', p_rid, p_user, coalesce(r.actor_username,'NULL'); end if;
  if r.resource_type is distinct from 'produits_bar' then raise exception 'create.% resource_type != produits_bar', p_rid; end if;
  if r.venue is distinct from p_venue then raise exception 'create.% venue ATTENDU %, OBTENU %', p_rid, p_venue, coalesce(r.venue,'NULL'); end if;
  if r.before_data is not null then raise exception 'create.% before_data doit être NULL (création)', p_rid; end if;
  if (r.after_data->>'nom') is distinct from p_nom then raise exception 'create.% after nom ATTENDU %, OBTENU %', p_rid, p_nom, r.after_data::text; end if;
  if (r.after_data->>'venue') is distinct from p_venue then raise exception 'create.% after venue faux (%)', p_rid, r.after_data::text; end if;
  if (r.after_data->>'prix_vente')::numeric is distinct from p_prix then raise exception 'create.% after prix ATTENDU %, OBTENU %', p_rid, p_prix, r.after_data::text; end if;
end $$;

create or replace function pg_temp.assert_toggle_audit(p_rid text, p_before boolean, p_after boolean)
returns void language plpgsql as $$
declare r public.audit_log%rowtype;
begin
  r := pg_temp.latest_audit(p_rid, 'carte.produit.disponibilite');
  if r.actor_role is distinct from 'admin' then raise exception 'toggle.% actor_role != admin (%)', p_rid, coalesce(r.actor_role,'NULL'); end if;
  if (r.before_data->>'disponible')::boolean is distinct from p_before then raise exception 'toggle.% before disponible ATTENDU %, OBTENU %', p_rid, p_before, r.before_data::text; end if;
  if (r.after_data->>'disponible')::boolean is distinct from p_after then raise exception 'toggle.% after disponible ATTENDU %, OBTENU %', p_rid, p_after, r.after_data::text; end if;
end $$;

create or replace function pg_temp.assert_update_audit(p_rid text, p_before_prix numeric, p_after_prix numeric, p_after_cat text)
returns void language plpgsql as $$
declare r public.audit_log%rowtype;
begin
  r := pg_temp.latest_audit(p_rid, 'carte.produit.update');
  if r.actor_role is distinct from 'admin' then raise exception 'update.% actor_role != admin (%)', p_rid, coalesce(r.actor_role,'NULL'); end if;
  if (r.before_data->>'prix_vente')::numeric is distinct from p_before_prix then raise exception 'update.% before prix ATTENDU %, OBTENU %', p_rid, p_before_prix, r.before_data::text; end if;
  if (r.after_data->>'prix_vente')::numeric is distinct from p_after_prix then raise exception 'update.% after prix ATTENDU %, OBTENU %', p_rid, p_after_prix, r.after_data::text; end if;
  if (r.after_data->>'categorie') is distinct from p_after_cat then raise exception 'update.% after categorie ATTENDU %, OBTENU %', p_rid, p_after_cat, r.after_data::text; end if;
end $$;

-- Username réellement mappé au manager (pour l'assertion de stamping G).
select username as manager_username from public.staff_users where auth_id = :'manager_sub' \gset

-- ============================================================
-- (A) Durcissement des 3 RPC + du helper.
-- ============================================================
select pg_temp.assert_fn_hardened('set_produit_disponibilite_v1', 'uuid, boolean',                 true);
select pg_temp.assert_fn_hardened('create_produit_v1',            'text, text, numeric, text, text', true);
select pg_temp.assert_fn_hardened('update_produit_v1',            'uuid, text, text, numeric, text', true);
select pg_temp.assert_fn_hardened('assert_carte_manager',         '',                                false);

-- ============================================================
-- (C) CRÉATION (admin) — fixture disponible pour le toggle ; capture de l'id.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.create_produit_v1('VERIF-0034-TOGGLE', 'TestCat', 5.00, 'eden', null)).id as cid_toggle \gset

-- (D) TOGGLE (admin) → disponible passe à false ; capture de l'état renvoyé.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.set_produit_disponibilite_v1(:'cid_toggle'::uuid, false)).disponible::text as tog_disp \gset

-- (E) MODIFICATION (admin) — fixture puis update prix+catégorie.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.create_produit_v1('VERIF-0034-UPD', 'CatA', 10.00, 'eden', '4cl')).id as cid_upd \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.update_produit_v1(:'cid_upd'::uuid, 'VERIF-0034-UPD', 'CatB', 12.50, '4cl')).prix_vente::text as upd_prix \gset

-- (G) STAMPING — création par un manager (contraste d'acteur).
set local role authenticated; select pg_temp.act_as(:'manager_sub');
select (public.create_produit_v1('VERIF-0034-MGR', 'CatM', 3.00, 'terminus', null)).id as cid_mgr \gset

-- Fixtures pour la collision de renommage (F).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.create_produit_v1('VERIF-0034-A', 'C', 1.00, 'eden', null)).id as cid_a \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select (public.create_produit_v1('VERIF-0034-B', 'C', 1.00, 'eden', null)).id as cid_b \gset

-- ============================================================
-- (B) FAIL-CLOSED de rôle : server refusé sur les 3 RPC ; admin réussit (non-vacuité).
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.try_create('VERIF-0034-SRV','C',1.00,'eden',null)      as b_srv_create \gset
select pg_temp.try_toggle(:'cid_toggle'::uuid, true)                  as b_srv_toggle \gset
select pg_temp.try_update(:'cid_upd'::uuid,'VERIF-0034-UPD','C',1.00,'4cl') as b_srv_update \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_create('VERIF-0034-OKV','C',1.00,'eden',null)      as b_admin_ok \gset

-- ============================================================
-- (F) GARDES de validation (admin authentifié → passe le rôle, éprouve les validations).
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_create('   ','C',1.00,'eden',null)                 as f_empty_nom \gset
select pg_temp.try_create('X','C',1.00,'mars',null)                   as f_bad_venue \gset
select pg_temp.try_create('X','C',-1.00,'eden',null)                  as f_neg_prix \gset
select pg_temp.try_create('VERIF-0034-TOGGLE','TestCat',5.00,'eden',null) as f_dup \gset
select pg_temp.try_toggle('00000000-0000-0000-0000-000000000000'::uuid, false) as f_tog_404 \gset
select pg_temp.try_update('00000000-0000-0000-0000-000000000000'::uuid,'X','C',1.00,null) as f_upd_404 \gset
select pg_temp.try_update(:'cid_b'::uuid,'VERIF-0034-A','C',1.00,null) as f_rename_collide \gset

reset role;

-- ------------------------------------------------------------
-- État RÉEL des lignes produit (lu en postgres = data) — prouve la mutation, pas seulement l'audit.
-- ------------------------------------------------------------
select disponible::text as prod_tog_disp from public.produits_bar where id = :'cid_toggle'::uuid \gset
select categorie as prod_upd_cat, prix_vente::text as prod_upd_prix from public.produits_bar where id = :'cid_upd'::uuid \gset

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- (B) fail-closed + non-vacuité
select pg_temp.expect(:'b_srv_create','42501',   'B.server CREATE refusé (42501)');
select pg_temp.expect(:'b_srv_toggle','42501',   'B.server TOGGLE refusé (42501)');
select pg_temp.expect(:'b_srv_update','42501',   'B.server UPDATE refusé (42501)');
select pg_temp.expect(:'b_admin_ok', 'NO_ERROR', 'B.non-vacuité : admin CREATE réussit');

-- (C) création : audit + acteur estampillé admin + mutation réelle
select pg_temp.assert_create_audit(:'cid_toggle','eden','VERIF-0034-TOGGLE',5.00,'admin','lab-admin-01');

-- (D) toggle : mutation réelle + audit before/after
select pg_temp.expect(:'tog_disp','false',      'D.RPC renvoie disponible=false');
select pg_temp.expect(:'prod_tog_disp','false', 'D.ligne produit réellement disponible=false');
select pg_temp.assert_toggle_audit(:'cid_toggle', true, false);

-- (E) update : mutation réelle + audit before/after
select pg_temp.expect(:'upd_prix','12.50',      'E.RPC renvoie prix_vente=12.50');
select pg_temp.expect(:'prod_upd_prix','12.50', 'E.ligne produit réellement prix=12.50');
select pg_temp.expect(:'prod_upd_cat','CatB',   'E.ligne produit réellement categorie=CatB');
select pg_temp.assert_update_audit(:'cid_upd', 10.00, 12.50, 'CatB');

-- (F) gardes de validation
select pg_temp.expect(:'f_empty_nom','22023',      'F.nom vide → 22023');
select pg_temp.expect(:'f_bad_venue','22023',      'F.venue invalide → 22023');
select pg_temp.expect(:'f_neg_prix','22023',       'F.prix < 0 → 22023');
select pg_temp.expect(:'f_dup','23505',            'F.doublon (venue,nom,format) → 23505');
select pg_temp.expect(:'f_tog_404','P0002',        'F.toggle produit introuvable → P0002');
select pg_temp.expect(:'f_upd_404','P0002',        'F.update produit introuvable → P0002');
select pg_temp.expect(:'f_rename_collide','23505', 'F.renommage en collision → 23505');

-- (G) stamping : la création manager estampille bien 'manager' (contraste avec admin ci-dessus)
select pg_temp.assert_create_audit(:'cid_mgr','terminus','VERIF-0034-MGR',3.00,'manager',:'manager_username');

select '0034 carte_management_rpc (3 RPC admin/manager fail-closed · mutations réelles disponible/prix/catégorie · audit carte.produit.* estampillé depuis la session · before/after réversibilité conservés · validations 22023/23505/P0002) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
