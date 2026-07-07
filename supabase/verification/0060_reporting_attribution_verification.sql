-- 0060_reporting_attribution_verification.sql
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception. PREUVE STATIQUE (niveau 3) de 0060.
--
-- Vérifie, APRÈS 0060 :
--   A. table public.table_server_assignments présente ;
--   B. colonnes attendues (id uuid, event_id uuid not null, table_id text not null, table_label text,
--      server_username text not null, assigned_at, assigned_by text) ;
--   C. contrainte UNIQUE (event_id, table_id) ;
--   D. index attendus (event, server, table) ;
--   E. RLS activée sur table_server_assignments ;
--   F. policies attendues (direction all + serveur select) ;
--   G. grants DML authenticated = 4 ; anon = 0 (fail-closed) ;
--   H. fonction staff_roster_v1() présente, SECURITY DEFINER, search_path=public, EXECUTE à
--      authenticated et PAS à public/anon (fail-closed).

begin;

do $$
declare v_n int;
begin
  -- A. table présente
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='table_server_assignments') then
    raise exception 'A: table public.table_server_assignments absente';
  end if;

  -- B. colonnes attendues
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='table_server_assignments'
                   and column_name='id' and data_type='uuid') then
    raise exception 'B: colonne id uuid absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='table_server_assignments'
                   and column_name='event_id' and data_type='uuid' and is_nullable='NO') then
    raise exception 'B: colonne event_id uuid not null absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='table_server_assignments'
                   and column_name='table_id' and data_type='text' and is_nullable='NO') then
    raise exception 'B: colonne table_id text not null absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='table_server_assignments'
                   and column_name='table_label' and data_type='text') then
    raise exception 'B: colonne table_label text absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='table_server_assignments'
                   and column_name='server_username' and data_type='text' and is_nullable='NO') then
    raise exception 'B: colonne server_username text not null absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='table_server_assignments'
                   and column_name='assigned_at') then
    raise exception 'B: colonne assigned_at absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='table_server_assignments'
                   and column_name='assigned_by' and data_type='text') then
    raise exception 'B: colonne assigned_by text absente';
  end if;

  -- C. contrainte UNIQUE (event_id, table_id)
  if not exists (
    select 1 from pg_constraint
     where conrelid='public.table_server_assignments'::regclass and contype='u'
       and pg_get_constraintdef(oid) ilike '%(event_id, table_id)%'
  ) then
    raise exception 'C: contrainte UNIQUE (event_id, table_id) absente';
  end if;

  -- D. index attendus
  if not exists (select 1 from pg_indexes where schemaname='public'
                 and tablename='table_server_assignments' and indexname='table_server_assignments_event_idx') then
    raise exception 'D: index table_server_assignments_event_idx absent';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                 and tablename='table_server_assignments' and indexname='table_server_assignments_server_idx') then
    raise exception 'D: index table_server_assignments_server_idx absent';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                 and tablename='table_server_assignments' and indexname='table_server_assignments_table_idx') then
    raise exception 'D: index table_server_assignments_table_idx absent';
  end if;

  -- E. RLS activée
  if not (select relrowsecurity from pg_class
          where relname='table_server_assignments' and relnamespace='public'::regnamespace) then
    raise exception 'E: RLS non activée sur public.table_server_assignments';
  end if;

  -- F. policies attendues
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='table_server_assignments' and policyname='tsa_all_direction') then
    raise exception 'F: policy tsa_all_direction absente';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='table_server_assignments' and policyname='tsa_select_server') then
    raise exception 'F: policy tsa_select_server absente';
  end if;

  -- G. grants DML authenticated = 4 (SELECT/INSERT/UPDATE/DELETE)
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='public' and table_name='table_server_assignments' and grantee='authenticated'
     and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  if v_n <> 4 then
    raise exception 'G: authenticated devrait avoir 4 grants DML sur table_server_assignments (obtenu %)', v_n;
  end if;

  -- G. anon = zéro grant (fail-closed)
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='public' and table_name='table_server_assignments' and grantee='anon';
  if v_n <> 0 then
    raise exception 'G: anon possède % grant(s) sur table_server_assignments (doit être 0)', v_n;
  end if;

  -- H. fonction staff_roster_v1() : présente + SECURITY DEFINER + search_path=public
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='staff_roster_v1'
  ) then
    raise exception 'H: fonction public.staff_roster_v1() absente';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='staff_roster_v1' and p.prosecdef = true
  ) then
    raise exception 'H: staff_roster_v1() n''est pas SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='staff_roster_v1'
       and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                   where c ilike 'search_path=%public%')
  ) then
    raise exception 'H: staff_roster_v1() ne fixe pas search_path=public';
  end if;

  -- H. EXECUTE accordé à authenticated, refusé à public/anon (fail-closed)
  if not has_function_privilege('authenticated', 'public.staff_roster_v1()', 'EXECUTE') then
    raise exception 'H: authenticated devrait avoir EXECUTE sur staff_roster_v1()';
  end if;
  if has_function_privilege('anon', 'public.staff_roster_v1()', 'EXECUTE') then
    raise exception 'H: anon ne doit PAS avoir EXECUTE sur staff_roster_v1() (fail-closed)';
  end if;

  raise notice '0060 reporting_attribution verification: A/B/C/D/E/F/G/H OK — attribution serveur + roster role-authoritative conformes.';
end;
$$;

rollback;
