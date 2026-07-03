-- 0026_internal_comms_verification.sql — preuve de comportement RLS du module Comm interne (A7) sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (rollback) : AUCUNE donnée de test ne persiste (le module
-- ship VIDE). Simule un vrai JWT par rôle (set role authenticated + request.jwt.claims->sub) pour
-- prouver, sur PostgreSQL réel, que la matrice A7 est imposée par la RLS :
--   · manager poste une ANNONCE (insert OK) ; server ne peut PAS poster d'annonce ;
--   · server poste un message court (OK) et lit le broadcast + son propre message ;
--   · un message ciblé 'security' est invisible au server, visible au security ;
--   · promoter ne peut NI insérer NI lire (⛔) ;
--   · les accusés de lecture s'insèrent et l'auteur voit qui a lu.
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- NOTE : les sub ci-dessous sont ceux du LABO (staff_users) ; identiques à 0023_incidents_verification.

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
-- 1) MANAGER : poste une ANNONCE (broadcast) — insert OK, auteur = lui-même.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'manager_id');

insert into public.internal_messages (exploitation_date, kind, body)
values (current_date, 'annonce', 'TEST rollback — briefing de soirée (annonce manager)');

-- ------------------------------------------------------------
-- 2) SERVER : NE peut PAS poster d'annonce (WITH CHECK), MAIS peut poster un message court.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'server_id');

do $$
begin
  begin
    insert into public.internal_messages (exploitation_date, kind, body)
    values (current_date, 'annonce', 'TEST server interdit annonce');
    raise exception 'ATTENDU: annonce par server REFUSÉE par RLS, mais elle a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : refus RLS
  end;
end $$;

insert into public.internal_messages (exploitation_date, kind, body)
values (current_date, 'message', 'TEST rollback — message court du server');

-- Server lit le broadcast (annonce manager) + son propre message → au moins 2 lignes visibles.
do $$
declare n int;
begin
  select count(*) into n from public.internal_messages;
  if n < 2 then raise exception 'ATTENDU: server lit broadcast + son message (>=2), OBTENU %', n; end if;
end $$;

-- ------------------------------------------------------------
-- 3) MANAGER : poste un message CIBLÉ sur 'security' (invisible au server).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'manager_id');

insert into public.internal_messages (exploitation_date, kind, body, target_role)
values (current_date, 'alerte', 'TEST rollback — alerte réservée sécurité', 'security');

-- server ne voit PAS le message ciblé sécurité.
set local role authenticated;
select pg_temp.act_as(:'server_id');
do $$
declare n int;
begin
  select count(*) into n from public.internal_messages where target_role = 'security';
  if n <> 0 then raise exception 'ATTENDU: server ne voit pas l''alerte ciblée sécurité (0), OBTENU %', n; end if;
end $$;

-- security voit le message ciblé sécurité.
set local role authenticated;
select pg_temp.act_as(:'security_id');
do $$
declare n int;
begin
  select count(*) into n from public.internal_messages where target_role = 'security';
  if n <> 1 then raise exception 'ATTENDU: security voit l''alerte ciblée (1), OBTENU %', n; end if;
end $$;

-- ------------------------------------------------------------
-- 4) PROMOTER : ne lit RIEN (⛔) et ne peut PAS insérer.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'promoter_id');
do $$
declare n int;
begin
  select count(*) into n from public.internal_messages;
  if n <> 0 then raise exception 'ATTENDU: promoter ne lit aucun message (0), OBTENU %', n; end if;
end $$;

do $$
begin
  begin
    insert into public.internal_messages (exploitation_date, kind, body)
    values (current_date, 'message', 'TEST promoter interdit');
    raise exception 'ATTENDU: insert promoter REFUSÉ par RLS, mais il a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 5) ACCUSÉS DE LECTURE : server accuse réception de l'annonce ; manager (auteur) voit l'accusé.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'server_id');
insert into public.internal_message_reads (message_id)
select id from public.internal_messages where kind = 'annonce';

set local role authenticated;
select pg_temp.act_as(:'manager_id');
do $$
declare n int;
begin
  select count(*) into n
  from public.internal_message_reads r
  join public.internal_messages m on m.id = r.message_id
  where m.kind = 'annonce';
  if n <> 1 then raise exception 'ATTENDU: manager voit 1 accusé sur son annonce, OBTENU %', n; end if;
end $$;

reset role;
select '0026 RLS comm interne — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
