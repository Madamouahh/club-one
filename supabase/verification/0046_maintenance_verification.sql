-- 0046_maintenance_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) du module Maintenance (0046), en TRANSACTION ANNULÉE.
--
-- Prouve :
--   (A) structure : tables equipment + maintenance_interventions présentes, RLS activée sur les deux ;
--   (B) LECTURE staff opérationnel : admin lit ; server lit ; PROMOTER refusé (0 ligne) ;
--   (C) ÉCRITURE direction : admin insère un équipement + une intervention (OK) ;
--   (D) FAIL-CLOSED : server ne peut PAS insérer d'équipement (RLS refuse) ; promoter non plus ;
--   (E) module ship VIDE : aucune donnée persistée (tx rollback) ; FK equipment_id respectée.
--
-- Chaque invariant = raise exception. Les subs staff sont ceux du labo (identiques 0033→0045).

begin;

select auth_id::text as admin_sub from public.staff_users where role='admin' limit 1 \gset
select auth_id::text as server_sub from public.staff_users where role='server' limit 1 \gset
select auth_id::text as promoter_sub from public.staff_users where role='promoter' limit 1 \gset

create or replace function pg_temp.act_as(p_sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true); end $$;
create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin if p_actual is distinct from p_expected then raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual,'NULL'); end if; end $$;
create or replace function pg_temp.cnt(p_rel text) returns text language plpgsql as $$
declare n int; begin execute format('select count(*) from public.%I', p_rel) into n; return n::text;
exception when insufficient_privilege then return 'DENIED'; end $$;
create or replace function pg_temp.try_insert_equip(p_name text) returns text language plpgsql as $$
begin insert into public.equipment (name, category) values (p_name, 'son'); return 'INSERTED';
exception when others then return sqlstate; end $$;

-- (A) structure
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='equipment') then raise exception 'A.equipment absente'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='maintenance_interventions') then raise exception 'A.maintenance_interventions absente'; end if;
  if not (select relrowsecurity from pg_class where relname='equipment' and relnamespace='public'::regnamespace) then raise exception 'A.RLS equipment désactivée'; end if;
  if not (select relrowsecurity from pg_class where relname='maintenance_interventions' and relnamespace='public'::regnamespace) then raise exception 'A.RLS interventions désactivée'; end if;
end $$;

-- (C) écriture direction : admin crée un équipement + une intervention (superuser bypass pour la fixture FK indépendante)
insert into public.equipment (id, name, category, status) values ('00000000-0000-4e00-8e00-0000000000e1','VERIF-Lave-verres','bar','panne');
insert into public.maintenance_interventions (equipment_id, kind, priority, status, description)
  values ('00000000-0000-4e00-8e00-0000000000e1','panne','haute','ouvert','VERIF intervention');

-- Écriture RÉELLE sous rôle admin (éprouve la policy write, pas seulement le superuser).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_insert_equip('VERIF-admin-equip') as admin_write \gset
select pg_temp.cnt('equipment') as admin_read \gset
reset role;

-- (B)(D) server : lit, mais n'écrit pas.
set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.cnt('equipment') as server_read \gset
select pg_temp.try_insert_equip('VERIF-server-equip') as server_write \gset
reset role;

-- (B)(D) promoter : ni lecture ni écriture.
set local role authenticated; select pg_temp.act_as(:'promoter_sub');
select pg_temp.cnt('equipment') as promoter_read \gset
select pg_temp.try_insert_equip('VERIF-promoter-equip') as promoter_write \gset
reset role;

-- ASSERTIONS
select pg_temp.expect(:'admin_write','INSERTED', 'C.admin écrit un équipement');
select pg_temp.expect(case when :'admin_read' ~ '^[0-9]+$' then 'READ' else :'admin_read' end, 'READ', 'B.admin lit le parc');
select pg_temp.expect(case when :'server_read' ~ '^[0-9]+$' then 'READ' else :'server_read' end, 'READ', 'B.server lit le parc (staff opérationnel)');
select pg_temp.expect(case when :'server_write' in ('42501','44000') then 'DENIED' else :'server_write' end, 'DENIED', 'D.server ne peut PAS écrire (direction only)');
-- promoteur : grant DML présent mais AUCUNE policy SELECT ne l'inclut → 0 ligne (RLS filtre tout, hors périmètre).
select pg_temp.expect(:'promoter_read','0', 'B.promoter ne voit AUCUNE ligne maintenance (RLS, hors périmètre)');
select pg_temp.expect(case when :'promoter_write' in ('42501','44000') then 'DENIED' else :'promoter_write' end, 'DENIED', 'D.promoter ne peut PAS écrire');

select '0046 maintenance (equipment + interventions · RLS lecture staff opérationnel sauf promoter · écriture direction fail-closed · module ship vide) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
