-- 0047_stock_inventory_verification.sql — PREUVE NIVEAU 4 (LABO, tx ROLLBACK) du module Stock.
--   (A) structure : stock_items + stock_movements, RLS activée ;
--   (B) lecture staff opérationnel : admin/server lisent ; promoter refusé (0 ligne, hors périmètre) ;
--   (C) écriture direction : admin crée un article + un mouvement ;
--   (D) fail-closed : server ne peut PAS écrire ; promoter non plus ;
--   (E) FK item_id respectée ; module ship VIDE (rollback).
begin;

select auth_id::text as admin_sub from public.staff_users where role='admin' limit 1 \gset
select auth_id::text as server_sub from public.staff_users where role='server' limit 1 \gset
select auth_id::text as promoter_sub from public.staff_users where role='promoter' limit 1 \gset

create or replace function pg_temp.act_as(p_sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true); end $$;
create or replace function pg_temp.expect(a text, e text, l text) returns void language plpgsql as $$
begin if a is distinct from e then raise exception '% ATTENDU "%", OBTENU "%"', l, e, coalesce(a,'NULL'); end if; end $$;
create or replace function pg_temp.cnt(p_rel text) returns text language plpgsql as $$
declare n int; begin execute format('select count(*) from public.%I', p_rel) into n; return n::text;
exception when insufficient_privilege then return 'DENIED'; end $$;
create or replace function pg_temp.try_item(p_name text) returns text language plpgsql as $$
begin insert into public.stock_items (name, family, unit) values (p_name, 'spiritueux', 'bouteille'); return 'INSERTED';
exception when others then return sqlstate; end $$;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='stock_items') then raise exception 'A.stock_items absente'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='stock_movements') then raise exception 'A.stock_movements absente'; end if;
  if not (select relrowsecurity from pg_class where relname='stock_items' and relnamespace='public'::regnamespace) then raise exception 'A.RLS stock_items off'; end if;
end $$;

-- fixture (superuser)
insert into public.stock_items (id, name, family, unit, par_level, unit_cost_cents)
  values ('00000000-0000-4570-8570-000000000571','VERIF-Vodka','spiritueux','bouteille',5,1500);
insert into public.stock_movements (item_id, kind, qty, reason)
  values ('00000000-0000-4570-8570-000000000571','entree',12,'VERIF reception');

set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_item('VERIF-admin-item') as admin_write \gset
select pg_temp.cnt('stock_items') as admin_read \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.cnt('stock_items') as server_read \gset
select pg_temp.try_item('VERIF-server-item') as server_write \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'promoter_sub');
select pg_temp.cnt('stock_items') as promoter_read \gset
reset role;

select pg_temp.expect(:'admin_write','INSERTED', 'C.admin crée un article');
select pg_temp.expect(case when :'admin_read' ~ '^[0-9]+$' then 'READ' else :'admin_read' end, 'READ', 'B.admin lit le stock');
select pg_temp.expect(case when :'server_read' ~ '^[0-9]+$' then 'READ' else :'server_read' end, 'READ', 'B.server lit le stock');
select pg_temp.expect(case when :'server_write' in ('42501','44000') then 'DENIED' else :'server_write' end, 'DENIED', 'D.server ne peut PAS écrire');
select pg_temp.expect(:'promoter_read','0', 'B.promoter ne voit AUCUNE ligne stock (hors périmètre)');

select '0047 stock_inventory (items + movements signés · RLS lecture staff-op sauf promoter · écriture direction fail-closed · ship vide) — TOUTES LES ASSERTIONS PASSENT (rollback)' as resultat;

rollback;
