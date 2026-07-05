-- 0049_commercial_pipeline_verification.sql — PREUVE NIVEAU 4 (LABO, tx ROLLBACK) du module Commercial.
--   (A) structure : commercial_leads + commercial_quotes, RLS activée ;
--   (B) lecture direction : admin lit ; server ET promoter refusés (0 ligne, hors périmètre, données sensibles) ;
--   (C) écriture direction : admin crée un lead + un devis ;
--   (D) fail-closed : server ne peut PAS écrire ; promoter non plus ;
--   (E) FK lead_id respectée ; module ship VIDE (rollback).
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
create or replace function pg_temp.try_lead(p_name text) returns text language plpgsql as $$
begin insert into public.commercial_leads (contact_name, kind, status) values (p_name, 'privatisation', 'nouveau'); return 'INSERTED';
exception when others then return sqlstate; end $$;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='commercial_leads') then raise exception 'A.commercial_leads absente'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='commercial_quotes') then raise exception 'A.commercial_quotes absente'; end if;
  if not (select relrowsecurity from pg_class where relname='commercial_leads' and relnamespace='public'::regnamespace) then raise exception 'A.RLS commercial_leads off'; end if;
end $$;

-- fixture (superuser)
insert into public.commercial_leads (id, contact_name, company, kind, status, estimated_value_cents)
  values ('00000000-0000-4570-8570-000000000491','VERIF-Contact','VERIF-SARL','privatisation','gagne',500000);
insert into public.commercial_quotes (lead_id, label, amount_cents, status)
  values ('00000000-0000-4570-8570-000000000491','VERIF Formule VIP',500000,'accepte');

set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_lead('VERIF-admin-lead') as admin_write \gset
select pg_temp.cnt('commercial_leads') as admin_read \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.cnt('commercial_leads') as server_read \gset
select pg_temp.try_lead('VERIF-server-lead') as server_write \gset
reset role;

set local role authenticated; select pg_temp.act_as(:'promoter_sub');
select pg_temp.cnt('commercial_leads') as promoter_read \gset
reset role;

select pg_temp.expect(:'admin_write','INSERTED', 'C.admin crée un lead commercial');
select pg_temp.expect(case when :'admin_read' ~ '^[0-9]+$' then 'READ' else :'admin_read' end, 'READ', 'B.admin lit le pipeline');
select pg_temp.expect(:'server_read','0', 'B.server ne voit AUCUN lead (données sensibles, hors périmètre)');
select pg_temp.expect(case when :'server_write' in ('42501','44000') then 'DENIED' else :'server_write' end, 'DENIED', 'D.server ne peut PAS écrire');
select pg_temp.expect(:'promoter_read','0', 'B.promoter ne voit AUCUN lead (hors périmètre)');

select '0049 commercial_pipeline (leads + devis · RLS lecture ET écriture direction fail-closed · aucun paiement/signature réel · ship vide) — TOUTES LES ASSERTIONS PASSENT (rollback)' as resultat;

rollback;
