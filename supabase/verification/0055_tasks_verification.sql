-- 0055_tasks_verification.sql
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception. PREUVE STATIQUE (niveau 3) du module Tâches.
--
-- Vérifie, APRÈS 0055 :
--   A. table public.tasks présente ;
--   B. colonnes attendues présentes avec le bon type / not null ;
--   C. contraintes CHECK status ∈ {todo,doing,done,cancelled} et priority ∈ {low,normal,high} ;
--   D. index attendus (status, assignee_username, due_date, event_id) ;
--   E. RLS activée sur public.tasks ;
--   F. policies attendues présentes (direction all + assigné select + assigné update) ;
--   G. grants DML (select/insert/update/delete) à authenticated ; anon = zéro grant (fail-closed).

begin;

do $$
declare v_n int;
begin
  -- A. table présente
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='tasks') then
    raise exception 'A: table public.tasks absente';
  end if;

  -- B. colonnes attendues
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='id' and data_type='uuid') then
    raise exception 'B: colonne id uuid absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='title'
                   and data_type='text' and is_nullable='NO') then
    raise exception 'B: colonne title text not null absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='description' and data_type='text') then
    raise exception 'B: colonne description text absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='assignee_username' and data_type='text') then
    raise exception 'B: colonne assignee_username text absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='assigned_by' and data_type='text') then
    raise exception 'B: colonne assigned_by text absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='due_date' and data_type='date') then
    raise exception 'B: colonne due_date date absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='status'
                   and data_type='text' and is_nullable='NO') then
    raise exception 'B: colonne status text not null absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='priority'
                   and data_type='text' and is_nullable='NO') then
    raise exception 'B: colonne priority text not null absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='event_id' and data_type='uuid') then
    raise exception 'B: colonne event_id uuid absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='created_at') then
    raise exception 'B: colonne created_at absente';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tasks' and column_name='updated_at') then
    raise exception 'B: colonne updated_at absente';
  end if;

  -- C. contraintes CHECK status / priority (présence des valeurs attendues dans la définition)
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.tasks'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%todo%'
      and pg_get_constraintdef(oid) ilike '%doing%'
      and pg_get_constraintdef(oid) ilike '%done%'
      and pg_get_constraintdef(oid) ilike '%cancelled%'
  ) then
    raise exception 'C: CHECK status (todo/doing/done/cancelled) absente';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.tasks'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%priority%'
      and pg_get_constraintdef(oid) ilike '%low%'
      and pg_get_constraintdef(oid) ilike '%normal%'
      and pg_get_constraintdef(oid) ilike '%high%'
  ) then
    raise exception 'C: CHECK priority (low/normal/high) absente';
  end if;

  -- D. index attendus
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='tasks' and indexname='tasks_status_idx') then
    raise exception 'D: index tasks_status_idx absent';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='tasks' and indexname='tasks_assignee_idx') then
    raise exception 'D: index tasks_assignee_idx absent';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='tasks' and indexname='tasks_due_date_idx') then
    raise exception 'D: index tasks_due_date_idx absent';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='tasks' and indexname='tasks_event_idx') then
    raise exception 'D: index tasks_event_idx absent';
  end if;

  -- E. RLS activée
  if not (select relrowsecurity from pg_class where relname='tasks' and relnamespace='public'::regnamespace) then
    raise exception 'E: RLS non activée sur public.tasks';
  end if;

  -- F. policies attendues
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_all_direction') then
    raise exception 'F: policy tasks_all_direction absente';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_select_assignee') then
    raise exception 'F: policy tasks_select_assignee absente';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_update_assignee') then
    raise exception 'F: policy tasks_update_assignee absente';
  end if;

  -- G. grants DML à authenticated
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='public' and table_name='tasks' and grantee='authenticated'
     and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  if v_n <> 4 then
    raise exception 'G: authenticated devrait avoir SELECT/INSERT/UPDATE/DELETE sur tasks (obtenu % grant(s))', v_n;
  end if;

  -- G. anon = zéro grant (fail-closed)
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='public' and table_name='tasks' and grantee='anon';
  if v_n <> 0 then
    raise exception 'G: anon possède % grant(s) sur tasks (doit être 0)', v_n;
  end if;

  raise notice '0055 tasks verification: A/B/C/D/E/F/G OK — table+colonnes+CHECK+index+RLS+policies+grants conformes.';
end;
$$;

rollback;
