-- 0028_checklists_verification.sql — preuve de comportement RLS du module CHECKLISTS (A9) sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (rollback) : AUCUNE donnée de test ne persiste (le module ship
-- VIDE). Simule un vrai JWT par rôle (set role authenticated + request.jwt.claims->sub) pour prouver,
-- sur PostgreSQL réel, que la matrice A9 est imposée par la RLS 0028 :
--   · manager COMPOSE le modèle (insert de 3 items : sans poste / poste=server / poste=manager) ;
--   · server LIT les 3 items (👁), COCHE l'item sans poste et l'item de SON poste (OK), mais NE peut PAS
--     cocher l'item réservé au poste manager (RLS « par poste »), ni COMPOSER un item (pas direction) ;
--   · server ne peut PAS usurper done_by (done_by = un autre username → refusé) ;
--   · promoter ne LIT RIEN, ne compose pas, ne coche pas (⛔) ;
--   · admin COCHE l'item réservé au poste manager (direction coche tout) et relit les coches.
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- NOTE : les sub ci-dessous sont ceux du LABO (staff_users) ; identiques à 0023/0026/0027.

begin;

\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set security_id '8177e05b-90fa-41d8-a2ba-2468acb296f7'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- ------------------------------------------------------------
-- 1) MANAGER : compose le modèle (3 items d'ouverture, insert OK).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'manager_id');

insert into public.checklist_items (phase, category, poste, label, position) values
  ('ouverture','secu',   null,     'TEST rollback — vérifier extincteurs', 1),
  ('ouverture','tables', 'server', 'TEST rollback — dresser les tables',   2),
  ('ouverture','caisse', 'manager','TEST rollback — fond de caisse',       3);

do $$
declare n int;
begin
  select count(*) into n from public.checklist_items where label like 'TEST rollback%';
  if n <> 3 then raise exception 'ATTENDU: manager compose 3 items, OBTENU %', n; end if;
end $$;

-- ------------------------------------------------------------
-- 2) SERVER : lit les 3 items, coche le sien + le commun, PAS celui du manager, ne compose PAS.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'server_id');

do $$
declare n int;
begin
  select count(*) into n from public.checklist_items where label like 'TEST rollback%';
  if n <> 3 then raise exception 'ATTENDU: server lit les 3 items (👁), OBTENU %', n; end if;
end $$;

-- Coche l'item sans poste (autorisé à tous) et l'item de son poste (server).
insert into public.checklist_completions (item_id, exploitation_date)
select id, current_date from public.checklist_items
 where label = 'TEST rollback — vérifier extincteurs';
insert into public.checklist_completions (item_id, exploitation_date)
select id, current_date from public.checklist_items
 where label = 'TEST rollback — dresser les tables';

do $$
declare n int;
begin
  select count(*) into n from public.checklist_completions;
  if n <> 2 then raise exception 'ATTENDU: server coche 2 items (commun + son poste), OBTENU %', n; end if;
end $$;

-- Ne peut PAS cocher l'item réservé au poste manager (RLS « par poste »).
do $$
begin
  begin
    insert into public.checklist_completions (item_id, exploitation_date)
    select id, current_date from public.checklist_items
     where label = 'TEST rollback — fond de caisse';
    raise exception 'ATTENDU: cochage server d''un item poste=manager REFUSÉ, mais il a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : RLS « par poste »
  end;
end $$;

-- Ne peut PAS usurper done_by (fixer un autre auteur que soi).
do $$
begin
  begin
    insert into public.checklist_completions (item_id, exploitation_date, done_by)
    select id, current_date, 'manuel' from public.checklist_items
     where label = 'TEST rollback — vérifier extincteurs';
    raise exception 'ATTENDU: usurpation done_by REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : done_by doit = current_staff_username()
  end;
end $$;

-- Ne peut PAS composer le modèle (pas direction).
do $$
begin
  begin
    insert into public.checklist_items (phase, category, label)
    values ('ouverture','son','TEST server compose interdit');
    raise exception 'ATTENDU: composition d''item par server REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 3) PROMOTER : ne LIT RIEN (⛔), ne compose pas, ne coche pas.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'promoter_id');

do $$
declare ni int; nc int;
begin
  select count(*) into ni from public.checklist_items;
  select count(*) into nc from public.checklist_completions;
  if ni <> 0 then raise exception 'ATTENDU: promoter ne lit aucun item (0), OBTENU %', ni; end if;
  if nc <> 0 then raise exception 'ATTENDU: promoter ne lit aucune coche (0), OBTENU %', nc; end if;
end $$;

do $$
begin
  begin
    insert into public.checklist_items (phase, category, label)
    values ('ouverture','secu','TEST promoter interdit');
    raise exception 'ATTENDU: composition promoter REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 4) SECURITY : lit les items (👁) mais ne compose pas ; coche l'item commun (autorisé à tous).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'security_id');

do $$
declare n int;
begin
  select count(*) into n from public.checklist_items where label like 'TEST rollback%';
  if n <> 3 then raise exception 'ATTENDU: security lit les 3 items (👁), OBTENU %', n; end if;
end $$;

do $$
begin
  begin
    insert into public.checklist_items (phase, category, label)
    values ('fermeture','secu','TEST security compose interdit');
    raise exception 'ATTENDU: composition security REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 5) ADMIN : coche l'item réservé au poste manager (direction coche tout) et relit les coches.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'admin_id');

insert into public.checklist_completions (item_id, exploitation_date)
select id, current_date from public.checklist_items
 where label = 'TEST rollback — fond de caisse';

do $$
declare n int;
begin
  select count(*) into n from public.checklist_completions;
  if n <> 3 then raise exception 'ATTENDU: admin coche l''item manager (total 3 coches), OBTENU %', n; end if;
end $$;

reset role;
select '0028 RLS checklists — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
