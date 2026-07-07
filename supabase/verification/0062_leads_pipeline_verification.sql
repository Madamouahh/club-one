-- 0062_leads_pipeline_verification.sql
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception. Preuve SQL STATIQUE (niveau 3) uniquement :
-- vérifie la STRUCTURE (table, colonnes, RLS, policies, grants, anon-zéro, contrainte channel), pas le
-- comportement RLS réel (niveau 4).
--
-- Vérifie, APRÈS 0062 :
--   A. table public.lead_channel_stats existe et a RLS ACTIVÉE ;
--   B. colonnes attendues présentes (funnel nullable + spend_cents + méta) ;
--   C. policies direction (select + all) présentes ;
--   D. authenticated a select/insert/update/delete ; anon a ZÉRO grant sur cette table ;
--   E. contrainte channel (liste fermée qr/promoteur/campagne/google_business/direct/import) présente.

begin;

do $$
declare
  v_n int;
  v_col text;
begin
  -- A. table + RLS
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'lead_channel_stats' and c.relkind = 'r';
  if v_n <> 1 then
    raise exception 'A: table public.lead_channel_stats absente';
  end if;

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'lead_channel_stats' and c.relrowsecurity = true;
  if v_n <> 1 then
    raise exception 'A: RLS non activée sur lead_channel_stats';
  end if;

  -- B. colonnes attendues
  foreach v_col in array array[
    'id','event_id','channel','period_start','period_end',
    'impressions','leads','resas_demandees','resas_confirmees','venus',
    'spend_cents','created_by','created_at'
  ]
  loop
    select count(*) into v_n from information_schema.columns
     where table_schema = 'public' and table_name = 'lead_channel_stats' and column_name = v_col;
    if v_n <> 1 then
      raise exception 'B: colonne manquante lead_channel_stats.%', v_col;
    end if;
  end loop;

  -- Funnel + spend NULLABLE (null = non tracké, jamais 0 fabriqué)
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'lead_channel_stats'
     and column_name in ('impressions','leads','resas_demandees','resas_confirmees','venus','spend_cents')
     and is_nullable = 'NO';
  if v_n <> 0 then
    raise exception 'B: % colonne(s) funnel/spend NOT NULL (doivent rester nullable = non tracké)', v_n;
  end if;

  -- C. policies direction (select + all)
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'lead_channel_stats'
     and policyname = 'lead_channel_stats_select_direction' and cmd = 'SELECT';
  if v_n <> 1 then
    raise exception 'C: policy lead_channel_stats_select_direction (SELECT) absente';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'lead_channel_stats'
     and policyname = 'lead_channel_stats_write_direction' and cmd = 'ALL';
  if v_n <> 1 then
    raise exception 'C: policy lead_channel_stats_write_direction (ALL) absente';
  end if;

  -- D. grants authenticated (select/insert/update/delete)
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'lead_channel_stats' and grantee = 'authenticated'
     and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  if v_n <> 4 then
    raise exception 'D: authenticated devrait avoir 4 grants (SELECT/INSERT/UPDATE/DELETE), trouvé %', v_n;
  end if;

  -- D. anon = ZÉRO grant sur cette table
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'lead_channel_stats' and grantee = 'anon';
  if v_n <> 0 then
    raise exception 'D: anon possède % grant(s) sur lead_channel_stats (doit être 0)', v_n;
  end if;

  -- E. contrainte channel (liste fermée)
  select count(*) into v_n from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = c.relnamespace
   where nsp.nspname = 'public' and c.relname = 'lead_channel_stats' and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%channel%'
     and pg_get_constraintdef(con.oid) ilike '%qr%'
     and pg_get_constraintdef(con.oid) ilike '%campagne%'
     and pg_get_constraintdef(con.oid) ilike '%import%';
  if v_n < 1 then
    raise exception 'E: contrainte CHECK channel (liste fermée) absente';
  end if;

  raise notice '0062 verification: A/B/C/D/E OK — table+RLS, colonnes, policies direction, grants authenticated, anon zéro, check channel.';
end;
$$;

rollback;
