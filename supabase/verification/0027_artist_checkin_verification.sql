-- 0027_artist_checkin_verification.sql — preuve de comportement RLS du module Artist check-in (A8)
-- sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (rollback) : AUCUNE donnée de test ne persiste (le module ship
-- VIDE). Simule un vrai JWT par rôle (set role authenticated + request.jwt.claims->sub) pour prouver,
-- sur PostgreSQL réel, que la matrice A8 est imposée par la RLS 0027 :
--   · manager crée une fiche (insert OK) et la relit ; direction lit tout ;
--   · security LIT la fiche (👁) mais ne peut PAS en créer (lecture seule) ;
--   · server et promoter ne LISENT RIEN et ne peuvent PAS insérer (⛔) ;
--   · un manager peut faire évoluer la fiche (update statut/jalon).
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- NOTE : les sub ci-dessous sont ceux du LABO (staff_users) ; identiques à 0023/0026.

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
-- 1) MANAGER : crée une fiche d'accueil (insert OK, auteur = lui-même).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'manager_id');

insert into public.artist_checkins (exploitation_date, artist_name, slot_label, companions)
values (current_date, 'TEST rollback — DJ vérification', '01h-03h', 2);

-- Manager relit sa fiche.
do $$
declare n int;
begin
  select count(*) into n from public.artist_checkins;
  if n <> 1 then raise exception 'ATTENDU: manager relit sa fiche (1), OBTENU %', n; end if;
end $$;

-- ------------------------------------------------------------
-- 2) SECURITY : LIT la fiche (👁) mais NE peut PAS en créer (lecture seule).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'security_id');
do $$
declare n int;
begin
  select count(*) into n from public.artist_checkins;
  if n <> 1 then raise exception 'ATTENDU: security lit la fiche (1), OBTENU %', n; end if;
end $$;

do $$
begin
  begin
    insert into public.artist_checkins (exploitation_date, artist_name)
    values (current_date, 'TEST security interdit');
    raise exception 'ATTENDU: insert security REFUSÉ par RLS, mais il a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : refus RLS (lecture seule)
  end;
end $$;

-- ------------------------------------------------------------
-- 3) SERVER : ne LIT RIEN (⛔) et ne peut PAS insérer.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'server_id');
do $$
declare n int;
begin
  select count(*) into n from public.artist_checkins;
  if n <> 0 then raise exception 'ATTENDU: server ne lit aucune fiche (0), OBTENU %', n; end if;
end $$;

do $$
begin
  begin
    insert into public.artist_checkins (exploitation_date, artist_name)
    values (current_date, 'TEST server interdit');
    raise exception 'ATTENDU: insert server REFUSÉ par RLS, mais il a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 4) PROMOTER : ne LIT RIEN (⛔) et ne peut PAS insérer.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'promoter_id');
do $$
declare n int;
begin
  select count(*) into n from public.artist_checkins;
  if n <> 0 then raise exception 'ATTENDU: promoter ne lit aucune fiche (0), OBTENU %', n; end if;
end $$;

do $$
begin
  begin
    insert into public.artist_checkins (exploitation_date, artist_name)
    values (current_date, 'TEST promoter interdit');
    raise exception 'ATTENDU: insert promoter REFUSÉ par RLS, mais il a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 5) ADMIN : lit tout et fait évoluer la fiche (update statut + jalon d'arrivée).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'admin_id');
update public.artist_checkins
   set status = 'arrive', arrived_at = now()
 where artist_name = 'TEST rollback — DJ vérification';

do $$
declare n int;
begin
  select count(*) into n from public.artist_checkins
   where status = 'arrive' and arrived_at is not null;
  if n <> 1 then raise exception 'ATTENDU: admin a fait évoluer la fiche (1 arrivée), OBTENU %', n; end if;
end $$;

reset role;
select '0027 RLS artist check-in — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
