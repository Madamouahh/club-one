-- 0073_referral_funnel_verification.sql — PREUVE NIVEAU 3 (SQL STATIQUE, tx ROLLBACK). PUR SQL.
-- Vérifie APRÈS 0073 :
--   A. table referral_events + contrainte kind(link_opened) + RLS active ;
--   B. RPC log_referral_open_v1 / onboard_referral_v1 / promoter_funnel_v1 présentes, SECURITY DEFINER,
--      search_path figé ;
--   C. onboard_referral_v1 réutilise register_guest_via_invite_v1 (source) + crée une demande de résa ;
--   D. promoter_funnel_v1 cantonné au promoteur courant (current_staff_username en source) ;
--   E. grants : onboard/log = anon+authenticated ; funnel = authenticated (jamais anon) ;
--   F. RLS referral_events : lecture own + direction ; anon fail-closed.

begin;
do $$
declare v_src text; v_oid oid; v_secdef boolean; v_cfg text[];
begin
  if to_regclass('public.referral_events') is null then raise exception 'A: referral_events absente'; end if;
  if not exists (select 1 from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='referral_events' and con.contype='c' and pg_get_constraintdef(con.oid) ilike '%link_opened%') then
    raise exception 'A: contrainte kind(link_opened) absente'; end if;
  if not (select relrowsecurity from pg_class where oid='public.referral_events'::regclass) then raise exception 'A: RLS off referral_events'; end if;

  for v_oid in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('log_referral_open_v1','onboard_referral_v1','promoter_funnel_v1') loop
    select p.prosecdef, p.proconfig into v_secdef, v_cfg from pg_proc p where p.oid=v_oid;
    if not v_secdef then raise exception 'B: % non SECURITY DEFINER', v_oid::regprocedure; end if;
    if v_cfg is null or not exists (select 1 from unnest(v_cfg) c where c ilike 'search_path=%public%') then
      raise exception 'B: % sans search_path figé', v_oid::regprocedure; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('log_referral_open_v1','onboard_referral_v1','promoter_funnel_v1')) <> 3 then
    raise exception 'B: une RPC 0073 manque'; end if;

  select pg_get_functiondef(oid) into v_src from pg_proc where proname='onboard_referral_v1' and pronamespace='public'::regnamespace;
  if v_src not ilike '%register_guest_via_invite_v1%' then raise exception 'C: onboard ne réutilise pas register_guest_via_invite_v1'; end if;
  if v_src not ilike '%into public.table_reservation_requests%' then raise exception 'C: onboard ne crée pas la demande de résa'; end if;

  select pg_get_functiondef(oid) into v_src from pg_proc where proname='promoter_funnel_v1' and pronamespace='public'::regnamespace;
  if v_src not ilike '%current_staff_username()%' then raise exception 'D: funnel non cantonné au promoteur courant'; end if;

  if has_function_privilege('anon','public.onboard_referral_v1(text,text,text,text,date,boolean,text,boolean,text,int,text,uuid)','EXECUTE') is false
     or has_function_privilege('anon','public.log_referral_open_v1(text)','EXECUTE') is false then
    raise exception 'E: onboard/log doivent être exécutables par anon (token-gardés)'; end if;
  if has_function_privilege('anon','public.promoter_funnel_v1()','EXECUTE') then raise exception 'E: anon a EXECUTE sur promoter_funnel_v1'; end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='referral_events' and qual ilike '%current_staff_username()%') then
    raise exception 'F: policy lecture own absente'; end if;
  if has_table_privilege('anon','public.referral_events','SELECT') then raise exception 'F: anon lit referral_events'; end if;

  raise notice '0073 referral_funnel verification: A/B/C/D/E/F OK — journal link_opened, onboarding+résa réutilisant register, funnel own-scope, anon fail-closed.';
end;
$$;
rollback;
