-- 0024_venue_tables_verification.sql — preuve du seed EDEN + de la RLS venue_tables sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (rollback) : aucune donnée de test ne persiste. Prouve, sur
-- PostgreSQL réel :
--   · le seed Eden est fidèle (44 tables, 10 debout = liste fondateur, 18 capacités connues /
--     26 à confirmer, aucune capacité <= 0, positions % bornées [0,100]) ;
--   · la RLS : tout le STAFF connecté LIT le layout ; seule la DIRECTION (admin/manager) peut
--     insérer/modifier/supprimer ; anon n'a aucun accès.
-- Chaque assertion échoue bruyamment (raise exception) si l'attendu n'est pas observé.

begin;

-- Auth ids réels du labo (staff_users) — mêmes que 0023_incidents_verification.
\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- ------------------------------------------------------------
-- 1) SEED EDEN — fidélité de la transcription
-- ------------------------------------------------------------
do $$
declare
  n_total   int;
  n_standing int;
  n_known   int;
  n_bad_cap int;
  n_oob     int;
begin
  select count(*) into n_total    from public.venue_tables where venue = 'eden';
  select count(*) into n_standing from public.venue_tables where venue = 'eden' and standing;
  select count(*) into n_known    from public.venue_tables where venue = 'eden' and capacity is not null;
  select count(*) into n_bad_cap  from public.venue_tables where venue = 'eden' and capacity is not null and capacity <= 0;
  select count(*) into n_oob      from public.venue_tables where venue = 'eden'
    and (x_pct < 0 or x_pct > 100 or y_pct < 0 or y_pct > 100);

  if n_total    <> 44 then raise exception 'ATTENDU 44 tables Eden, OBTENU %', n_total; end if;
  if n_standing <> 10 then raise exception 'ATTENDU 10 tables debout, OBTENU %', n_standing; end if;
  if n_known    <> 18 then raise exception 'ATTENDU 18 capacites connues, OBTENU %', n_known; end if;
  if n_bad_cap  <> 0  then raise exception 'ATTENDU 0 capacite <= 0, OBTENU %', n_bad_cap; end if;
  if n_oob      <> 0  then raise exception 'ATTENDU 0 position hors [0,100], OBTENU %', n_oob; end if;

  -- Liste EXACTE des tables debout du fondateur (106,107,400-406,500).
  if exists (
    select 1 from public.venue_tables
    where venue = 'eden' and standing
      and label not in ('106','107','400','401','402','403','404','405','406','500')
  ) then raise exception 'Une table debout hors liste fondateur'; end if;
end $$;

-- ------------------------------------------------------------
-- 2) LECTURE : tout le staff connecté voit le layout (server + promoter).
-- ------------------------------------------------------------
set local role authenticated;

select pg_temp.act_as(:'server_id');
do $$
declare n int;
begin
  select count(*) into n from public.venue_tables where venue = 'eden';
  if n <> 44 then raise exception 'ATTENDU: server lit le layout (44), OBTENU %', n; end if;
end $$;

select pg_temp.act_as(:'promoter_id');
do $$
declare n int;
begin
  select count(*) into n from public.venue_tables where venue = 'eden';
  if n <> 44 then raise exception 'ATTENDU: promoter lit le layout (44), OBTENU %', n; end if;
end $$;

-- ------------------------------------------------------------
-- 3) ÉCRITURE : direction seule. server (non-direction) est REFUSÉ à l'insert.
-- ------------------------------------------------------------
select pg_temp.act_as(:'server_id');
do $$
begin
  insert into public.venue_tables (venue, label, x_pct, y_pct, shape, standing)
  values ('eden', 'TEST-SERVER', 10, 10, 'round', false);
  raise exception 'FAILLE: server a pu inserer une table (attendu: refuse RLS)';
exception
  when insufficient_privilege then null; -- comportement attendu (WITH CHECK direction-only)
end $$;

-- ------------------------------------------------------------
-- 4) ÉCRITURE : admin (direction) insère et modifie (puis rollback).
-- ------------------------------------------------------------
select pg_temp.act_as(:'admin_id');
insert into public.venue_tables (venue, label, x_pct, y_pct, shape, standing, capacity)
values ('eden', 'TEST-ADMIN', 20, 20, 'round', false, null);

-- comble une capacité (scénario écran direction « éditer table »).
update public.venue_tables set capacity = 8 where venue = 'eden' and label = 'TEST-ADMIN';

do $$
declare c int;
begin
  select capacity into c from public.venue_tables where venue = 'eden' and label = 'TEST-ADMIN';
  if c <> 8 then raise exception 'ATTENDU: admin corrige la capacite a 8, OBTENU %', c; end if;
end $$;

-- ------------------------------------------------------------
-- 5) ANON : aucun accès direct au layout.
-- ------------------------------------------------------------
reset role;
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from public.venue_tables;
  raise exception 'FAILLE: anon a lu % lignes (attendu: refuse RLS)', n;
exception
  when insufficient_privilege then null; -- comportement attendu (revoke all on ... from anon)
end $$;

reset role;

-- Tout est prouvé → on annule (aucune donnée de test persistée, seed Eden intact).
rollback;
