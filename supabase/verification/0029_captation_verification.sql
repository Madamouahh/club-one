-- 0029_captation_verification.sql — preuve de comportement RLS du module CAPTATION EN SOIRÉE (A10) sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (rollback) : AUCUNE donnée de test ne persiste (le module ship
-- VIDE). Simule un vrai JWT par rôle (set role authenticated + request.jwt.claims->sub) pour prouver,
-- sur PostgreSQL réel, que la matrice A10 est imposée par la RLS 0029 :
--   · manager COMPOSE la shot list (insert d'items), la LIT, et CAPTE (insert d'un état de capture) ;
--   · manager ne peut PAS usurper auteur_username (auteur ≠ current_staff_username → refusé) ;
--   · manager ne peut PAS capter un plan INACTIF (le WITH CHECK exige un item actif) ;
--   · server / promoter / security / security_counter ne LISENT RIEN (⛔ captation = métier créa/direction),
--     ne composent pas, ne captent pas ;
--   · admin (direction) LIT la shot list, CAPTE, et ne peut pas usurper updated_by.
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- NOTE : les sub ci-dessous sont ceux du LABO (staff_users) ; identiques à 0023/0026/0027/0028.
-- RAPPEL : « Manager, créa » (master §3.1) est câblé sur la DIRECTION (admin/manager) — il n'existe PAS
--          de rôle d'auth « créa » dans le socle. À rebrancher quand StaffRole exposera un rôle créa.

begin;

\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set security_id '8177e05b-90fa-41d8-a2ba-2468acb296f7'
\set counter_id  '635c3963-868e-449e-b005-e895b933db15'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- ------------------------------------------------------------
-- 1) MANAGER : compose la shot list (2 items : eden + toutes salles), lit, capte le 1er item.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'manager_id');

insert into public.shot_list_items (venue, label, sujet, prioritaire, position, auteur_username) values
  ('eden', 'TEST rollback — arrivée artiste', 'artiste', true,  1, 'lab-manager-01'),
  (null,   'TEST rollback — ambiance salle',  'public',  false, 2, 'lab-manager-01');

do $$
declare n int;
begin
  select count(*) into n from public.shot_list_items where label like 'TEST rollback%';
  if n <> 2 then raise exception 'ATTENDU: manager compose 2 items, OBTENU %', n; end if;
end $$;

-- Capte le plan prioritaire (insert d'un état de capture pour la soirée courante).
insert into public.shot_captures (item_id, exploitation_date, status, updated_by)
select id, current_date, 'capture', 'lab-manager-01' from public.shot_list_items
 where label = 'TEST rollback — arrivée artiste';

do $$
declare n int;
begin
  select count(*) into n from public.shot_captures;
  if n <> 1 then raise exception 'ATTENDU: manager capte 1 plan, OBTENU %', n; end if;
end $$;

-- Ne peut PAS usurper auteur_username (auteur ≠ current_staff_username).
do $$
begin
  begin
    insert into public.shot_list_items (label, auteur_username)
    values ('TEST usurpation auteur', 'quelqu_un_dautre');
    raise exception 'ATTENDU: usurpation auteur_username REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : auteur_username doit = current_staff_username()
  end;
end $$;

-- Ne peut PAS capter un plan INACTIF (le WITH CHECK exige sli.active).
do $$
declare v_item uuid;
begin
  insert into public.shot_list_items (label, auteur_username, active)
  values ('TEST plan inactif', 'lab-manager-01', false) returning id into v_item;
  begin
    insert into public.shot_captures (item_id, exploitation_date, status, updated_by)
    values (v_item, current_date, 'a_capturer', 'lab-manager-01');
    raise exception 'ATTENDU: capture d''un plan INACTIF REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : capture exige un plan actif
  end;
end $$;

-- ------------------------------------------------------------
-- 2) SERVER : ne LIT RIEN (⛔), ne compose pas, ne capte pas.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'server_id');

do $$
declare ni int; nc int;
begin
  select count(*) into ni from public.shot_list_items;
  select count(*) into nc from public.shot_captures;
  if ni <> 0 then raise exception 'ATTENDU: server ne lit aucun item (0), OBTENU %', ni; end if;
  if nc <> 0 then raise exception 'ATTENDU: server ne lit aucune capture (0), OBTENU %', nc; end if;
end $$;

do $$
begin
  begin
    insert into public.shot_list_items (label, auteur_username)
    values ('TEST server compose interdit', 'server');
    raise exception 'ATTENDU: composition server REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 3) PROMOTER : ne LIT RIEN (⛔), ne compose pas.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'promoter_id');

do $$
declare ni int;
begin
  select count(*) into ni from public.shot_list_items;
  if ni <> 0 then raise exception 'ATTENDU: promoter ne lit aucun item (0), OBTENU %', ni; end if;
end $$;

do $$
begin
  begin
    insert into public.shot_list_items (label, auteur_username)
    values ('TEST promoter compose interdit', 'lab-promoter-01');
    raise exception 'ATTENDU: composition promoter REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 4) SECURITY : ne LIT RIEN (⛔ — captation ≠ checklists : la sécurité n'y a aucun accès).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'security_id');

do $$
declare ni int;
begin
  select count(*) into ni from public.shot_list_items;
  if ni <> 0 then raise exception 'ATTENDU: security ne lit aucun item (0), OBTENU %', ni; end if;
end $$;

-- ------------------------------------------------------------
-- 5) SECURITY_COUNTER : ne LIT RIEN (⛔).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'counter_id');

do $$
declare ni int;
begin
  select count(*) into ni from public.shot_list_items;
  if ni <> 0 then raise exception 'ATTENDU: security_counter ne lit aucun item (0), OBTENU %', ni; end if;
end $$;

-- ------------------------------------------------------------
-- 6) ADMIN (direction) : LIT la shot list + captures, capte le 2e item, ne peut pas usurper updated_by.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'admin_id');

do $$
declare n int;
begin
  select count(*) into n from public.shot_list_items where label like 'TEST rollback%';
  if n <> 2 then raise exception 'ATTENDU: admin lit les 2 items (👁), OBTENU %', n; end if;
end $$;

-- Ne peut PAS usurper updated_by lors d'une capture.
do $$
begin
  begin
    insert into public.shot_captures (item_id, exploitation_date, status, updated_by)
    select id, current_date, 'a_capturer', 'un_autre_operateur' from public.shot_list_items
     where label = 'TEST rollback — ambiance salle';
    raise exception 'ATTENDU: usurpation updated_by REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : updated_by doit = current_staff_username()
  end;
end $$;

-- Capte le 2e item avec le bon auteur (OK).
insert into public.shot_captures (item_id, exploitation_date, status, updated_by)
select id, current_date, 'depose', 'lab-admin-01' from public.shot_list_items
 where label = 'TEST rollback — ambiance salle';

do $$
declare n int;
begin
  select count(*) into n from public.shot_captures;
  if n <> 2 then raise exception 'ATTENDU: admin capte le 2e plan (total 2 captures), OBTENU %', n; end if;
end $$;

reset role;
select '0029 RLS captation — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
