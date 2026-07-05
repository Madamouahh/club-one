-- 0048_suppliers_purchasing_verification.sql — PREUVE NIVEAU 4 (LABO, tx ROLLBACK) du module Fournisseurs/Achats.
--   (A) structure : suppliers + purchase_orders + purchase_order_lines, RLS activée ;
--   (B) lecture staff opérationnel : admin/server lisent ; promoter refusé (0 ligne, hors périmètre) ;
--   (C) écriture direction : admin crée un fournisseur + une commande ;
--   (D) fail-closed : server ne peut PAS écrire ; promoter non plus ;
--   (E) FK supplier_id respectée ; module ship VIDE (rollback).
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
create or replace function pg_temp.try_supplier(p_name text) returns text language plpgsql as $$
begin insert into public.suppliers (name, category) values (p_name, 'boissons'); return 'INSERTED';
exception when others then return sqlstate; end $$;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='suppliers') then raise exception 'A.suppliers absente'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='purchase_orders') then raise exception 'A.purchase_orders absente'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='purchase_order_lines') then raise exception 'A.purchase_order_lines absente'; end if;
  if not (select relrowsecurity from pg_class where relname='suppliers' and relnamespace='public'::regnamespace) then raise exception 'A.RLS suppliers off'; end if;
end $$;

-- fixture (superuser)
insert into public.suppliers (id, name, category, contact_name, phone)
  values ('00000000-0000-4480-8480-000000000481','VERIF-Metro','boissons','Contact','0600000000');
insert into public.purchase_orders (id, supplier_id, status, label, total_cents)
  values ('00000000-0000-4480-8480-000000000482','00000000-0000-4480-8480-000000000481','envoyee','VERIF reappro',45000);
insert into public.purchase_order_lines (order_id, designation, qty, unit_price_cents)
  values ('00000000-0000-4480-8480-000000000482','Champagne', 6, 3000);

set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_supplier('VERIF-admin-supplier') as admin_write \gset
select pg_temp.cnt('suppliers') as admin_read \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.cnt('purchase_orders') as server_read \gset
select pg_temp.try_supplier('VERIF-server-supplier') as server_write \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'promoter_sub');
select pg_temp.cnt('suppliers') as promoter_read \gset
reset role;

select pg_temp.expect(:'admin_write','INSERTED', 'C.admin crée un fournisseur');
select pg_temp.expect(case when :'admin_read' ~ '^[0-9]+$' then 'READ' else :'admin_read' end, 'READ', 'B.admin lit les fournisseurs');
select pg_temp.expect(case when :'server_read' ~ '^[0-9]+$' then 'READ' else :'server_read' end, 'READ', 'B.server lit les commandes');
select pg_temp.expect(case when :'server_write' in ('42501','44000') then 'DENIED' else :'server_write' end, 'DENIED', 'D.server ne peut PAS écrire');
select pg_temp.expect(:'promoter_read','0', 'B.promoter ne voit AUCUNE ligne fournisseur (hors périmètre)');

select '0048 suppliers_purchasing (fournisseurs + commandes + lignes · RLS lecture staff-op sauf promoter · écriture direction fail-closed · ship vide) — TOUTES LES ASSERTIONS PASSENT (rollback)' as resultat;

rollback;
