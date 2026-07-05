-- 0050_marketing_campaigns_verification.sql — PREUVE NIVEAU 4 (LABO, tx ROLLBACK) du module Marketing.
--   (A) structure : marketing_campaigns, RLS activée ;
--   (B) lecture direction : admin lit ; server refusé (0 ligne, hors périmètre) ; promoter refusé ;
--   (C) écriture direction : admin crée une campagne ;
--   (D) fail-closed : server ne peut PAS écrire ; promoter non plus ;
--   (E) module ship VIDE (rollback).
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
create or replace function pg_temp.try_campaign(p_name text) returns text language plpgsql as $$
begin insert into public.marketing_campaigns (name, channel, status) values (p_name, 'instagram', 'active'); return 'INSERTED';
exception when others then return sqlstate; end $$;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='marketing_campaigns') then raise exception 'A.marketing_campaigns absente'; end if;
  if not (select relrowsecurity from pg_class where relname='marketing_campaigns' and relnamespace='public'::regnamespace) then raise exception 'A.RLS marketing_campaigns off'; end if;
end $$;

-- fixture (superuser)
insert into public.marketing_campaigns (id, name, channel, budget_cents, spent_cents, status, attributed_revenue_cents, attributed_reservations)
  values ('00000000-0000-4570-8570-000000000501','VERIF-Insta-Juillet','instagram',50000,30000,'active',180000,12);

set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_campaign('VERIF-admin-campaign') as admin_write \gset
select pg_temp.cnt('marketing_campaigns') as admin_read \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.cnt('marketing_campaigns') as server_read \gset
select pg_temp.try_campaign('VERIF-server-campaign') as server_write \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'promoter_sub');
select pg_temp.cnt('marketing_campaigns') as promoter_read \gset
reset role;

select pg_temp.expect(:'admin_write','INSERTED', 'C.admin crée une campagne');
select pg_temp.expect(case when :'admin_read' ~ '^[0-9]+$' then 'READ' else :'admin_read' end, 'READ', 'B.admin lit les campagnes');
select pg_temp.expect(:'server_read','0', 'B.server ne voit AUCUNE campagne (hors périmètre)');
select pg_temp.expect(case when :'server_write' in ('42501','44000') then 'DENIED' else :'server_write' end, 'DENIED', 'D.server ne peut PAS écrire');
select pg_temp.expect(:'promoter_read','0', 'B.promoter ne voit AUCUNE campagne (hors périmètre)');

select '0050 marketing_campaigns (campagnes acquisition · RLS lecture+écriture direction fail-closed · pub externe NON ACTIVÉE · ship vide) — TOUTES LES ASSERTIONS PASSENT (rollback)' as resultat;

rollback;
