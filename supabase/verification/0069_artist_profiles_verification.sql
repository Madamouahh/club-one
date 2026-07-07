-- 0069_artist_profiles_verification.sql — PREUVE NIVEAU 3 (SQL STATIQUE, tx ROLLBACK).
-- PUR SQL (aucune méta-commande psql). Transaction rollback ; chaque invariant = raise exception.
--
-- Vérifie APRÈS 0069 :
--   A. tables artists + artist_event_links présentes ;
--   B. colonnes clés d'artists (stage_name not null, status check active/archived, fee_cents >= 0) ;
--   C. FK artist_event_links → artists/events + unicité (artist_id, event_id) ;
--   D. RLS ACTIVE sur les deux tables ;
--   E. policy direction (admin/manager) présente en USING + WITH CHECK sur les deux ;
--   F. anon SANS aucun privilège (fail-closed) ; authenticated a le DML.

begin;

do $$
declare
  v_check text;
begin
  -- A. présence des tables --------------------------------------------------------------------------
  if to_regclass('public.artists') is null then
    raise exception 'A: table public.artists absente';
  end if;
  if to_regclass('public.artist_event_links') is null then
    raise exception 'A: table public.artist_event_links absente';
  end if;

  -- B. stage_name NOT NULL --------------------------------------------------------------------------
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='artists' and column_name='stage_name' and is_nullable='YES'
  ) then
    raise exception 'B: artists.stage_name devrait être NOT NULL';
  end if;

  -- B. status check (active/archived) ---------------------------------------------------------------
  select pg_get_constraintdef(con.oid) into v_check
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='artists' and con.contype='c'
     and pg_get_constraintdef(con.oid) ilike '%status%archived%';
  if v_check is null then
    raise exception 'B: contrainte status in (active,archived) absente sur artists';
  end if;

  -- B. fee_cents >= 0 -------------------------------------------------------------------------------
  if not exists (
    select 1 from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='artists' and con.contype='c'
       and pg_get_constraintdef(con.oid) ilike '%fee_cents%>= 0%'
  ) then
    raise exception 'B: contrainte fee_cents >= 0 absente sur artists';
  end if;

  -- C. FK + unicité (artist_id, event_id) -----------------------------------------------------------
  if not exists (
    select 1 from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='artist_event_links' and con.contype='f'
       and pg_get_constraintdef(con.oid) ilike '%references%artists%'
  ) then
    raise exception 'C: FK artist_event_links.artist_id → artists absente';
  end if;
  if not exists (
    select 1 from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='artist_event_links' and con.contype='f'
       and pg_get_constraintdef(con.oid) ilike '%references%events%'
  ) then
    raise exception 'C: FK artist_event_links.event_id → events absente';
  end if;
  if not exists (
    select 1 from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='artist_event_links' and con.contype='u'
       and pg_get_constraintdef(con.oid) ilike '%(artist_id, event_id)%'
  ) then
    raise exception 'C: unicité (artist_id, event_id) absente sur artist_event_links';
  end if;

  -- D. RLS active sur les deux tables ---------------------------------------------------------------
  if not (select relrowsecurity from pg_class where oid='public.artists'::regclass) then
    raise exception 'D: RLS off sur public.artists';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.artist_event_links'::regclass) then
    raise exception 'D: RLS off sur public.artist_event_links';
  end if;

  -- E. policy direction (admin/manager) présente en USING + WITH CHECK -------------------------------
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='artists'
      and qual ilike '%admin%' and qual ilike '%manager%'
      and with_check ilike '%admin%' and with_check ilike '%manager%'
  ) then
    raise exception 'E: policy direction (USING+WITH CHECK admin/manager) absente sur artists';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='artist_event_links'
      and qual ilike '%admin%' and qual ilike '%manager%'
      and with_check ilike '%admin%' and with_check ilike '%manager%'
  ) then
    raise exception 'E: policy direction (USING+WITH CHECK admin/manager) absente sur artist_event_links';
  end if;

  -- F. anon fail-closed / authenticated a le DML ----------------------------------------------------
  if has_table_privilege('anon', 'public.artists', 'SELECT')
     or has_table_privilege('anon', 'public.artists', 'INSERT')
     or has_table_privilege('anon', 'public.artist_event_links', 'SELECT')
     or has_table_privilege('anon', 'public.artist_event_links', 'INSERT') then
    raise exception 'F: anon a un privilège sur artists/artist_event_links (doit être fail-closed)';
  end if;
  if not has_table_privilege('authenticated', 'public.artists', 'INSERT')
     or not has_table_privilege('authenticated', 'public.artist_event_links', 'INSERT') then
    raise exception 'F: authenticated privé du DML sur artists/artist_event_links';
  end if;

  raise notice '0069 artist_profiles verification: A/B/C/D/E/F OK — artists + artist_event_links, RLS active, direction-only, anon fail-closed.';
end;
$$;

rollback;
