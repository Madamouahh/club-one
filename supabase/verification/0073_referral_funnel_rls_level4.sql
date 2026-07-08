-- 0073_referral_funnel_rls_level4.sql — PREUVE NIVEAU 4 (RLS RÉELLE, LABO) de la migration 0073.
-- Exécute réellement la chaîne + commute les rôles PostgreSQL avec les claims JWT des comptes LABO
-- (impersonation), en transaction ROLLBACK. Prouve, avec des résultats SQL réels :
--   1. promoteur voit UNIQUEMENT son funnel ;
--   2. autre promoteur (p-02) ne voit RIEN des données de p-01 (funnel + referral_events) ;
--   3. direction (manager) voit TOUS les referral_events ;
--   4. serveur : funnel refusé + aucun referral_event visible ;
--   5. anon : zéro accès direct (SELECT table + EXECUTE funnel révoqués) ;
--   6. surface : seules log/onboard restent exécutables par anon (token-gardées), jamais le funnel ;
--   7. aucune fuite via la fonction SECURITY DEFINER (funnel cantonné à current_staff_username).
-- auth_id LABO : p01=72b72390… p02=cd4d46d2… manager=4a8e3c3c… server=36e6aeb1…
-- NB : fichier spécifique au LABO (auth_id réels) — jamais exécuté en production.

begin;
create temp table t(k text, v text) on commit drop; grant all on t to anon, authenticated;

-- --- Activité réelle de promoteur-01 : un lien + un onboarding (owner_promoter = lab-promoter-01) ---
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','72b72390-32bc-4bda-b489-f0b95ed22288','role','authenticated')::text, true);
do $$ declare r record; begin
  select * into r from public.create_invite_link_v1('guest_list','eden',null,5,null);
  if not r.ok then raise exception 'setup FAIL lien: %', r.message; end if;
  insert into t values ('token', r.token);
end $$;
reset role;
set local role anon; select set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
do $$ declare tok text := (select v from t where k='token'); begin
  perform public.log_referral_open_v1(tok);
  perform public.onboard_referral_v1(tok,'RLS','Proof','+33699111222','1990-01-01', true,'consentement', false, null, 2, null, null);
end $$;
reset role;

-- 1. promoteur-01 : SON funnel > 0 + lit SES referral_events
set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','72b72390-32bc-4bda-b489-f0b95ed22288','role','authenticated')::text, true);
do $$ declare f jsonb; n int; begin
  f := public.promoter_funnel_v1();
  if (f->>'link_created')::int < 1 or (f->>'profile_completed')::int < 1 then raise exception 'FAIL p01 funnel vide: %', f; end if;
  select count(*) into n from public.referral_events where promoter_username='lab-promoter-01';
  if n < 1 then raise exception 'FAIL p01 ne lit pas ses events'; end if;
  raise notice '1 OK p01 : funnel own (profils=%, liens=%), referral_events own=%', f->>'profile_completed', f->>'link_created', n;
end $$;
reset role;

-- 2. promoteur-02 : SON funnel = 0 + NE voit PAS les referral_events de p-01 (RLS)
set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','cd4d46d2-7502-4a60-a682-10f6d4d83628','role','authenticated')::text, true);
do $$ declare f jsonb; n_all int; n_p01 int; begin
  f := public.promoter_funnel_v1();
  if (f->>'link_created')::int <> 0 or (f->>'profile_completed')::int <> 0 then raise exception 'FAIL p02 voit des données p01: %', f; end if;
  select count(*) into n_all from public.referral_events;
  select count(*) into n_p01 from public.referral_events where promoter_username='lab-promoter-01';
  if n_p01 <> 0 then raise exception 'FAIL fuite RLS : p02 lit % events de p01', n_p01; end if;
  raise notice '2 OK p02 : funnel own=0, referral_events visibles=% dont p01=% (masqués)', n_all, n_p01;
end $$;
reset role;

-- 3. direction (manager) : voit TOUS les referral_events (dont ceux de p-01)
set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','4a8e3c3c-38df-414a-a3c7-53cfc733fb25','role','authenticated')::text, true);
do $$ declare n int; begin
  select count(*) into n from public.referral_events where promoter_username='lab-promoter-01';
  if n < 1 then raise exception 'FAIL direction ne voit pas les events de p01'; end if;
  raise notice '3 OK direction : voit les referral_events de tous les promoteurs (p01=% visibles)', n;
end $$;
reset role;

-- 4. serveur : funnel refusé (rôle non autorisé) + aucun referral_event visible
set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub','36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a','role','authenticated')::text, true);
do $$ declare f jsonb; n int; begin
  f := public.promoter_funnel_v1();
  if (f->>'ok')::boolean then raise exception 'FAIL serveur a accès au funnel: %', f; end if;
  select count(*) into n from public.referral_events;
  if n <> 0 then raise exception 'FAIL serveur lit % referral_events', n; end if;
  raise notice '4 OK serveur : funnel refusé (code=%), referral_events visibles=0', f->>'code';
end $$;
reset role;

-- 5+6+7. anon zéro accès + surface + pas de fuite SECURITY DEFINER (privilèges statiques)
do $$ declare a_sel boolean; a_fn boolean; a_log boolean; a_onb boolean; leaks int; begin
  a_sel := has_table_privilege('anon','public.referral_events','SELECT');
  a_fn  := has_function_privilege('anon','public.promoter_funnel_v1()','EXECUTE');
  a_log := has_function_privilege('anon','public.log_referral_open_v1(text)','EXECUTE');
  a_onb := has_function_privilege('anon','public.onboard_referral_v1(text,text,text,text,date,boolean,text,boolean,text,int,text,uuid)','EXECUTE');
  if a_sel then raise exception 'FAIL anon SELECT referral_events'; end if;
  if a_fn then raise exception 'FAIL anon EXECUTE promoter_funnel_v1'; end if;
  if not a_log or not a_onb then raise exception 'FAIL log/onboard doivent rester exécutables par anon (token-gardés)'; end if;
  select count(*) into leaks from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='promoter_funnel_v1' and pg_get_functiondef(p.oid) not ilike '%current_staff_username()%';
  if leaks <> 0 then raise exception 'FAIL funnel ne se cantonne pas à current_staff_username'; end if;
  raise notice '5-7 OK : anon SELECT=% funnel=% (fail-closed) ; log/onboard anon=%/% (token-gardés) ; funnel own-scope (aucune fuite DEFINER)', a_sel, a_fn, a_log, a_onb;
end $$;
rollback;
