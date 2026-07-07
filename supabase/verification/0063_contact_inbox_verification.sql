-- 0063_contact_inbox_verification.sql
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception.
--
-- Vérifie, APRÈS 0063 :
--   A. la table contact_requests existe, RLS activée ;
--   B. colonnes attendues présentes avec le bon type ;
--   C. contraintes CHECK sur requester_type et status (valeurs exactes du pipeline) ;
--   D. grants DML `authenticated` présents ; anon = ZÉRO grant sur la table (invariant 0009/0053) ;
--   E. policies direction (select + all) présentes et cantonnées à admin/manager.

begin;

do $$
declare
  v_n int;
  v_def text;
begin
  -- A. table + RLS
  if to_regclass('public.contact_requests') is null then
    raise exception 'A: table public.contact_requests absente';
  end if;
  select count(*) into v_n from pg_class c join pg_namespace nsp on nsp.oid = c.relnamespace
   where nsp.nspname = 'public' and c.relname = 'contact_requests' and c.relrowsecurity = true;
  if v_n <> 1 then
    raise exception 'A: RLS non activée sur contact_requests';
  end if;

  -- B. colonnes attendues (nom : type)
  for v_def in
    select x from unnest(array[
      'id:uuid','requester_type:text','full_name:text','phone:text','email:text',
      'subject:text','message:text','status:text','assigned_to:text',
      'created_at:timestamp with time zone','updated_at:timestamp with time zone'
    ]) as x
  loop
    select count(*) into v_n from information_schema.columns
     where table_schema = 'public' and table_name = 'contact_requests'
       and column_name = split_part(v_def, ':', 1)
       and data_type = split_part(v_def, ':', 2);
    if v_n <> 1 then
      raise exception 'B: colonne/type manquant ou incorrect : %', v_def;
    end if;
  end loop;

  -- NOT NULL sur les colonnes structurantes
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'contact_requests'
     and column_name in ('requester_type','subject','status','created_at','updated_at')
     and is_nullable = 'NO';
  if v_n <> 5 then
    raise exception 'B: certaines colonnes structurantes ne sont pas NOT NULL (attendu 5, trouvé %)', v_n;
  end if;

  -- C. contrainte CHECK requester_type (les 4 profils)
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.contact_requests'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%requester_type%'
     and pg_get_constraintdef(oid) like '%client%'
     and pg_get_constraintdef(oid) like '%entreprise%'
     and pg_get_constraintdef(oid) like '%artiste%'
     and pg_get_constraintdef(oid) like '%autre%';
  if v_n < 1 then
    raise exception 'C: CHECK requester_type (client/entreprise/artiste/autre) absente';
  end if;

  -- C. contrainte CHECK status (pipeline nouveau/en_cours/traite/clos)
  select count(*) into v_n from pg_constraint
   where conrelid = 'public.contact_requests'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%status%'
     and pg_get_constraintdef(oid) like '%nouveau%'
     and pg_get_constraintdef(oid) like '%en_cours%'
     and pg_get_constraintdef(oid) like '%traite%'
     and pg_get_constraintdef(oid) like '%clos%';
  if v_n < 1 then
    raise exception 'C: CHECK status (nouveau/en_cours/traite/clos) absente';
  end if;

  -- D. grants authenticated (select/insert/update/delete)
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'contact_requests' and grantee = 'authenticated'
     and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  if v_n <> 4 then
    raise exception 'D: grants authenticated incomplets sur contact_requests (attendu 4, trouvé %)', v_n;
  end if;

  -- D. anon = ZÉRO grant (invariant 0009/0053 : Supabase DEFAULT PRIVILEGES révoqué)
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'contact_requests' and grantee = 'anon';
  if v_n <> 0 then
    raise exception 'D: anon possède % grant(s) sur contact_requests (revoke all from anon manquant)', v_n;
  end if;

  -- E. policies direction (select + all), cantonnées admin/manager
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'contact_requests'
     and policyname = 'contact_requests_select_direction'
     and qual like '%current_staff_role()%'
     and qual like '%admin%' and qual like '%manager%';
  if v_n <> 1 then
    raise exception 'E: policy select direction absente/incorrecte';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'contact_requests'
     and policyname = 'contact_requests_write_direction'
     and qual like '%current_staff_role()%'
     and with_check like '%current_staff_role()%'
     and with_check like '%admin%' and with_check like '%manager%';
  if v_n <> 1 then
    raise exception 'E: policy write direction absente/incorrecte';
  end if;

  raise notice '0063 verification: A/B/C/D/E OK — table+RLS, colonnes, CHECK, grants (anon=0), policies direction.';
end;
$$;

rollback;
