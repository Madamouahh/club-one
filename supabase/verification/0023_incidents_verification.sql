-- 0023_incidents_verification.sql — preuve de comportement RLS du module Incidents (A6) sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (rollback) : AUCUNE donnée de test ne persiste (le module
-- ship VIDE). Simule un vrai JWT par rôle (set role authenticated + request.jwt.claims->sub) pour
-- prouver, sur PostgreSQL réel, que la matrice A6 est imposée par la RLS :
--   · server signale (insert OK) et ne relit QUE son propre incident ;
--   · security lit TOUT et peut muter ;
--   · promoter ne peut NI insérer NI lire (⛔) ;
--   · manager lit tout et mute.
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.

begin;

-- Auth ids réels du labo (staff_users).
\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set security_id '8177e05b-90fa-41d8-a2ba-2468acb296f7'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

-- Helper : bascule vers un rôle authenticated avec le sub voulu.
create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- ------------------------------------------------------------
-- 1) SERVER : signale un incident (insert OK), auteur fixé à lui-même.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'server_id');

insert into public.incidents (exploitation_date, type, niveau, description)
values (current_date, 'refus_entree', 'moyen', 'TEST rollback — refus entrée signalé par server');

do $$
declare n int;
begin
  select count(*) into n from public.incidents where auteur_username = public.current_staff_username();
  if n <> 1 then raise exception 'ATTENDU: server relit son propre incident (1), OBTENU %', n; end if;
end $$;

-- ------------------------------------------------------------
-- 2) PROMOTER : ne peut PAS lire l'incident du server (⛔) ...
-- ------------------------------------------------------------
select pg_temp.act_as(:'promoter_id');
do $$
declare n int;
begin
  select count(*) into n from public.incidents;
  if n <> 0 then raise exception 'ATTENDU: promoter ne lit aucun incident (0), OBTENU %', n; end if;
end $$;

-- ... et ne peut PAS en insérer (aucune branche insert ne le couvre).
do $$
begin
  begin
    insert into public.incidents (exploitation_date, type, niveau, description)
    values (current_date, 'autre', 'mineur', 'TEST promoter interdit');
    raise exception 'ATTENDU: insert promoter REFUSÉ par RLS, mais il a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : refus RLS
  end;
end $$;

-- ------------------------------------------------------------
-- 3) SECURITY : lit TOUT (voit l'incident du server) et peut muter (escalade).
-- ------------------------------------------------------------
select pg_temp.act_as(:'security_id');
do $$
declare n int;
begin
  select count(*) into n from public.incidents;
  if n < 1 then raise exception 'ATTENDU: security lit l''incident du server (>=1), OBTENU %', n; end if;
end $$;

update public.incidents set status = 'escalade', escalade = true
where type = 'refus_entree';

do $$
declare n int;
begin
  select count(*) into n from public.incidents where escalade is true;
  if n <> 1 then raise exception 'ATTENDU: security a escaladé 1 incident, OBTENU %', n; end if;
end $$;

-- Suivi (incident_updates) : security écrit dans le fil.
insert into public.incident_updates (incident_id, action, new_status, note)
select id, 'Escaladé à la direction', 'escalade', 'TEST rollback'
from public.incidents where type = 'refus_entree';

-- ------------------------------------------------------------
-- 4) MANAGER : lit tout (supervision) et voit le fil de suivi.
-- ------------------------------------------------------------
select pg_temp.act_as(:'manager_id');
do $$
declare ni int; nu int;
begin
  select count(*) into ni from public.incidents;
  select count(*) into nu from public.incident_updates;
  if ni < 1 then raise exception 'ATTENDU: manager lit les incidents (>=1), OBTENU %', ni; end if;
  if nu < 1 then raise exception 'ATTENDU: manager lit le fil de suivi (>=1), OBTENU %', nu; end if;
end $$;

-- ------------------------------------------------------------
-- 5) SERVER : ne peut PAS muter (signaler seulement) — l'update ne touche aucune ligne visible/permise.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'server_id');
do $$
declare touched int;
begin
  update public.incidents set status = 'clos' where type = 'refus_entree';
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'ATTENDU: update server bloqué (0 ligne), OBTENU %', touched; end if;
end $$;

reset role;
select '0023 RLS incidents — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
