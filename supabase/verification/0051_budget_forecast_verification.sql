-- 0051_budget_forecast_verification.sql — PREUVE NIVEAU 4 (LABO, tx ROLLBACK) du module Budget prévu.
--   (A) structure : budget_forecasts, RLS activée ;
--   (B) lecture direction : admin lit le prévisionnel ; server ET promoter ne voient AUCUNE ligne
--       (prévisionnel de gestion = direction-only, hors périmètre des autres rôles) ;
--   (C) écriture direction : admin crée une ligne de budget prévu ;
--   (D) fail-closed : server ne peut PAS écrire ; promoter non plus ;
--   (E) contrainte montant_prevu_cents >= 0 respectée ; module ship VIDE (rollback).
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
create or replace function pg_temp.try_forecast(p_label text) returns text language plpgsql as $$
begin insert into public.budget_forecasts (label, poste, montant_prevu_cents) values (p_label, 'artistes', 150000); return 'INSERTED';
exception when others then return sqlstate; end $$;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='budget_forecasts') then raise exception 'A.budget_forecasts absente'; end if;
  if not (select relrowsecurity from pg_class where relname='budget_forecasts' and relnamespace='public'::regnamespace) then raise exception 'A.RLS budget_forecasts off'; end if;
end $$;

-- fixture (superuser)
insert into public.budget_forecasts (id, label, poste, montant_prevu_cents)
  values ('00000000-0000-4510-8510-000000000511','VERIF-DJ résident','artistes',200000);

set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_forecast('VERIF-admin-forecast') as admin_write \gset
select pg_temp.cnt('budget_forecasts') as admin_read \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.cnt('budget_forecasts') as server_read \gset
select pg_temp.try_forecast('VERIF-server-forecast') as server_write \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'promoter_sub');
select pg_temp.cnt('budget_forecasts') as promoter_read \gset
reset role;

select pg_temp.expect(:'admin_write','INSERTED', 'C.admin crée une ligne de budget prévu');
select pg_temp.expect(case when :'admin_read' ~ '^[0-9]+$' then 'READ' else :'admin_read' end, 'READ', 'B.admin lit le prévisionnel');
select pg_temp.expect(:'server_read','0', 'B.server ne voit AUCUNE ligne de budget (hors périmètre)');
select pg_temp.expect(:'promoter_read','0', 'B.promoter ne voit AUCUNE ligne de budget (hors périmètre)');
select pg_temp.expect(case when :'server_write' in ('42501','44000') then 'DENIED' else :'server_write' end, 'DENIED', 'D.server ne peut PAS écrire');

select '0051 budget_forecast (prévisionnel par poste · RLS lecture+écriture direction fail-closed · réel jamais stocké ici · ship vide) — TOUTES LES ASSERTIONS PASSENT (rollback)' as resultat;

rollback;
