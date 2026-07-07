-- 0059_crm_enrichment_verification.sql — PREUVE NIVEAU 3 (SQL STATIQUE, tx ROLLBACK).
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception. Ne prouve PAS l'exécution runtime des
-- policies (niveau 4/5), seulement la présence structurelle attendue APRÈS 0059.
--
-- Vérifie :
--   A. guests.email : colonne text présente + contrainte de format guests_email_format_chk ;
--   B. guest_tags / guest_notes : tables présentes, RLS activée, unique(guest_id,tag) sur guest_tags ;
--   C. anon = ZÉRO grant sur guest_tags / guest_notes ; authenticated a bien les grants DML attendus ;
--   D. RPC guest_360_v1(uuid) : présente, SECURITY DEFINER, search_path figé, anon SANS execute,
--      authenticated AVEC execute (read-only staff-scoped).

begin;

do $$
declare v_n int; v_type text; v_secdef boolean; v_cfg text[];
begin
  -- A. guests.email --------------------------------------------------------------------------------
  select data_type into v_type from information_schema.columns
   where table_schema='public' and table_name='guests' and column_name='email';
  if v_type is null then raise exception 'A: guests.email absente'; end if;
  if v_type <> 'text' then raise exception 'A: guests.email attendu text, obtenu %', v_type; end if;

  if not exists (
    select 1 from pg_constraint
     where conname='guests_email_format_chk' and conrelid='public.guests'::regclass
  ) then raise exception 'A: contrainte guests_email_format_chk absente'; end if;

  -- B. tables + RLS + unique ----------------------------------------------------------------------
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='guest_tags') then
    raise exception 'B: table guest_tags absente'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='guest_notes') then
    raise exception 'B: table guest_notes absente'; end if;

  if not (select relrowsecurity from pg_class where oid='public.guest_tags'::regclass) then
    raise exception 'B: RLS off sur guest_tags'; end if;
  if not (select relrowsecurity from pg_class where oid='public.guest_notes'::regclass) then
    raise exception 'B: RLS off sur guest_notes'; end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid='public.guest_tags'::regclass and contype='u'
       and pg_get_constraintdef(oid) ilike '%(guest_id, tag)%'
  ) then raise exception 'B: unique(guest_id, tag) absent sur guest_tags'; end if;

  -- C. anon zéro grant ; authenticated grants DML --------------------------------------------------
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='public' and grantee='anon' and table_name in ('guest_tags','guest_notes');
  if v_n <> 0 then raise exception 'C: anon possède % grant(s) sur guest_tags/guest_notes', v_n; end if;

  if not has_table_privilege('authenticated','public.guest_tags','SELECT')
     or not has_table_privilege('authenticated','public.guest_tags','INSERT')
     or not has_table_privilege('authenticated','public.guest_tags','DELETE') then
    raise exception 'C: authenticated privé de SELECT/INSERT/DELETE sur guest_tags'; end if;
  if not has_table_privilege('authenticated','public.guest_notes','SELECT')
     or not has_table_privilege('authenticated','public.guest_notes','INSERT')
     or not has_table_privilege('authenticated','public.guest_notes','DELETE') then
    raise exception 'C: authenticated privé de SELECT/INSERT/DELETE sur guest_notes'; end if;

  -- D. RPC guest_360_v1 ----------------------------------------------------------------------------
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='guest_360_v1'
  ) then raise exception 'D: fonction guest_360_v1 absente'; end if;

  select p.prosecdef, p.proconfig into v_secdef, v_cfg
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='guest_360_v1' limit 1;
  if not v_secdef then raise exception 'D: guest_360_v1 n''est pas SECURITY DEFINER'; end if;
  if v_cfg is null or not (v_cfg && array['search_path=public']) then
    raise exception 'D: guest_360_v1 sans search_path figé (proconfig=%)', v_cfg; end if;

  if has_function_privilege('anon','public.guest_360_v1(uuid)','EXECUTE') then
    raise exception 'D: anon a EXECUTE sur guest_360_v1 (doit être authenticated-only)'; end if;
  if not has_function_privilege('authenticated','public.guest_360_v1(uuid)','EXECUTE') then
    raise exception 'D: authenticated privé d''EXECUTE sur guest_360_v1'; end if;

  raise notice '0059 verification: A/B/C/D OK — email+format, guest_tags/guest_notes RLS, anon zéro grant, guest_360_v1 SECURITY DEFINER authenticated-only.';
end $$;

rollback;
