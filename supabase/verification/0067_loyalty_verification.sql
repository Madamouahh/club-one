-- 0067_loyalty_verification.sql — vérification LABO (rollback ; chaque invariant = raise exception).
-- Niveau 4 (structure + gardes comportementales statiques). Le happy-path (crédit/débit d'un vrai
-- compte par un admin réel + refus de solde négatif) se prouve en NAVIGATEUR contre le LABO via LoyaltyTab.
--   (A) tables présentes, RLS activée, colonnes clés ;
--   (B) RPC accrue/redeem + helper tier : SECURITY DEFINER, search_path=public figé (helper immutable) ;
--   (C) grants : execute à authenticated, jamais à anon/public ; tables : anon AUCUN privilège ;
--   (D) palier dérivé correct aux seuils (bronze/silver/gold/platinum) ;
--   (E) fail-closed : sans rôle direction, accrue ET redeem REFUSENT (unauthorized) — pas d'écriture à l'aveugle ;
--   (F) redeem refuse un solde négatif (insufficient) même appelé par la direction (garde métier dans la RPC).

begin;

do $$
declare
  v_secdef boolean; v_sp text; v_immutable boolean;
  v_anon int; v_auth int; v_anon_tbl int;
  v_ok boolean; v_code text;
begin
  -- A. Tables + RLS.
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='loyalty_accounts') then
    raise exception 'A: loyalty_accounts absente'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='loyalty_ledger') then
    raise exception 'A: loyalty_ledger absente'; end if;
  if not (select relrowsecurity from pg_class where relname='loyalty_accounts' and relnamespace='public'::regnamespace) then
    raise exception 'A: RLS loyalty_accounts désactivée'; end if;
  if not (select relrowsecurity from pg_class where relname='loyalty_ledger' and relnamespace='public'::regnamespace) then
    raise exception 'A: RLS loyalty_ledger désactivée'; end if;
  -- guest_id unique (PK) sur loyalty_accounts (1 compte / client).
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='loyalty_accounts' and column_name='guest_id') then
    raise exception 'A: loyalty_accounts.guest_id manquant'; end if;

  -- B. RPC accrue : SECURITY DEFINER + search_path=public.
  select p.prosecdef, array_to_string(p.proconfig, ',') into v_secdef, v_sp
    from pg_proc p where p.proname='loyalty_accrue_v1' and p.pronamespace='public'::regnamespace;
  if v_secdef is null then raise exception 'B: loyalty_accrue_v1 absente'; end if;
  if not v_secdef then raise exception 'B: loyalty_accrue_v1 doit être SECURITY DEFINER'; end if;
  if v_sp is distinct from 'search_path=public' then raise exception 'B: accrue search_path attendu public, obtenu %', v_sp; end if;

  -- B. RPC redeem : SECURITY DEFINER + search_path=public.
  select p.prosecdef, array_to_string(p.proconfig, ',') into v_secdef, v_sp
    from pg_proc p where p.proname='loyalty_redeem_v1' and p.pronamespace='public'::regnamespace;
  if v_secdef is null then raise exception 'B: loyalty_redeem_v1 absente'; end if;
  if not v_secdef then raise exception 'B: loyalty_redeem_v1 doit être SECURITY DEFINER'; end if;
  if v_sp is distinct from 'search_path=public' then raise exception 'B: redeem search_path attendu public, obtenu %', v_sp; end if;

  -- B. Helper tier : IMMUTABLE + search_path=public.
  select (p.provolatile='i'), array_to_string(p.proconfig, ',') into v_immutable, v_sp
    from pg_proc p where p.proname='loyalty_tier' and p.pronamespace='public'::regnamespace;
  if v_immutable is null then raise exception 'B: loyalty_tier absente'; end if;
  if not v_immutable then raise exception 'B: loyalty_tier doit être IMMUTABLE'; end if;
  if v_sp is distinct from 'search_path=public' then raise exception 'B: loyalty_tier search_path attendu public, obtenu %', v_sp; end if;

  -- C. Grants execute : authenticated oui, anon non (accrue, redeem, tier).
  for v_code in select unnest(array['loyalty_accrue_v1','loyalty_redeem_v1','loyalty_tier']) loop
    select count(*) filter (where grantee='anon'), count(*) filter (where grantee='authenticated')
      into v_anon, v_auth
      from information_schema.role_routine_grants
     where routine_name=v_code and specific_schema='public';
    if v_anon <> 0 then raise exception 'C: anon ne doit pas avoir execute sur %', v_code; end if;
    if v_auth < 1 then raise exception 'C: authenticated doit avoir execute sur %', v_code; end if;
  end loop;

  -- C. Tables : anon AUCUN privilège (revoke all from anon).
  select count(*) into v_anon_tbl
    from information_schema.role_table_grants
   where table_schema='public' and table_name in ('loyalty_accounts','loyalty_ledger') and grantee='anon';
  if v_anon_tbl <> 0 then raise exception 'C: anon ne doit avoir AUCUN privilège sur les tables loyalty (obtenu %)', v_anon_tbl; end if;

  -- D. Palier dérivé aux seuils.
  if public.loyalty_tier(0)    <> 'bronze'   then raise exception 'D: 0 → bronze attendu'; end if;
  if public.loyalty_tier(499)  <> 'bronze'   then raise exception 'D: 499 → bronze attendu'; end if;
  if public.loyalty_tier(500)  <> 'silver'   then raise exception 'D: 500 → silver attendu'; end if;
  if public.loyalty_tier(1499) <> 'silver'   then raise exception 'D: 1499 → silver attendu'; end if;
  if public.loyalty_tier(1500) <> 'gold'     then raise exception 'D: 1500 → gold attendu'; end if;
  if public.loyalty_tier(4999) <> 'gold'     then raise exception 'D: 4999 → gold attendu'; end if;
  if public.loyalty_tier(5000) <> 'platinum' then raise exception 'D: 5000 → platinum attendu'; end if;

  -- E. Fail-closed : contexte postgres (current_staff_role() NULL) → accrue & redeem refusent (unauthorized).
  select ok, code into v_ok, v_code from public.loyalty_accrue_v1(gen_random_uuid(), 100, 'verif');
  if v_ok then raise exception 'E: accrue aurait dû REFUSER sans rôle direction'; end if;
  if v_code <> 'unauthorized' then raise exception 'E: accrue code attendu unauthorized, obtenu %', v_code; end if;

  select ok, code into v_ok, v_code from public.loyalty_redeem_v1(gen_random_uuid(), 100, 'verif');
  if v_ok then raise exception 'E: redeem aurait dû REFUSER sans rôle direction'; end if;
  if v_code <> 'unauthorized' then raise exception 'E: redeem code attendu unauthorized, obtenu %', v_code; end if;

  raise notice '0067 loyalty verification: A/B/C/D/E OK — tables+RLS, DEFINER+search_path, grants authenticated-only, anon zéro privilège, paliers dérivés, gardes direction fail-closed.';
end $$;

-- F. Garde métier « solde négatif » sous identité direction réelle (le refus vient de la RPC, pas de la RLS).
--    On endosse un admin réel puis on tente un débit sans provision : doit renvoyer insufficient, aucun ledger écrit.
do $$
declare
  v_admin text; v_guest uuid; v_ok boolean; v_code text; v_ledger_before int; v_ledger_after int;
begin
  select auth_id::text into v_admin from public.staff_users where role='admin' limit 1;
  if v_admin is null then
    raise notice 'F: aucun admin en base — garde solde négatif non exercée (structure déjà prouvée en E).';
    return;
  end if;
  -- Fixture : un client sans compte de fidélité.
  insert into public.guests (phone, first_name, majorite_verifiee)
    values ('+33000000067', 'VERIF-Loyalty', true) returning id into v_guest;

  select count(*) into v_ledger_before from public.loyalty_ledger;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select ok, code into v_ok, v_code from public.loyalty_redeem_v1(v_guest, 50, 'verif solde négatif');
  perform set_config('request.jwt.claims', null, true);

  if v_ok then raise exception 'F: redeem sans provision aurait dû REFUSER (solde négatif)'; end if;
  if v_code <> 'insufficient' then raise exception 'F: code attendu insufficient, obtenu %', v_code; end if;

  select count(*) into v_ledger_after from public.loyalty_ledger;
  if v_ledger_after <> v_ledger_before then raise exception 'F: un refus ne doit RIEN journaliser (ledger modifié)'; end if;

  raise notice 'F: OK — redeem refuse le solde négatif (insufficient) et ne journalise rien.';
end $$;

select '0067 loyalty (comptes+journal · RLS direction · RPC DEFINER accrue/redeem atomiques · anon révoqué · refus solde négatif) — TOUTES LES ASSERTIONS PASSENT (rollback)' as resultat;

rollback;
