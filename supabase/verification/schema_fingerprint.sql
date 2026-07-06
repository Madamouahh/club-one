-- ============================================================================
-- Club One — EMPREINTE STRUCTURELLE COMPLÈTE (équivalence de schéma, données exclues)
--
-- Pur SQL, exécutable via MCP execute_sql / psql -f / éditeur Supabase. Retourne un md5 par catégorie
-- + des compteurs. Déterministe : n'utilise QUE des noms/définitions (jamais d'OID, de timestamp, ni
-- d'identifiant interne volatil). Deux schémas à structure identique → 17 md5 identiques.
--
-- Couvre : tables, colonnes(type/nullability/default), primary keys, foreign keys, unique, check,
-- indexes, signatures de fonctions, mode de sécurité + search_path, RLS activée, policies, grants,
-- publications Realtime, triggers.
-- ============================================================================
with
cols as (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', table_name, column_name, data_type, is_nullable, coalesce(column_default,'')), chr(10)
    order by table_name, ordinal_position),'')) h
  from information_schema.columns where table_schema='public'),
pk as (select md5(coalesce(string_agg(format('%s|%s', conrelid::regclass::text, pg_get_constraintdef(oid)), chr(10) order by conrelid::regclass::text, conname),'')) h
  from pg_constraint where connamespace='public'::regnamespace and contype='p'),
fk as (select md5(coalesce(string_agg(format('%s|%s|%s', conrelid::regclass::text, conname, pg_get_constraintdef(oid)), chr(10) order by conrelid::regclass::text, conname),'')) h
  from pg_constraint where connamespace='public'::regnamespace and contype='f'),
uniq as (select md5(coalesce(string_agg(format('%s|%s|%s', conrelid::regclass::text, conname, pg_get_constraintdef(oid)), chr(10) order by conrelid::regclass::text, conname),'')) h
  from pg_constraint where connamespace='public'::regnamespace and contype='u'),
chk as (select md5(coalesce(string_agg(format('%s|%s|%s', conrelid::regclass::text, conname, pg_get_constraintdef(oid)), chr(10) order by conrelid::regclass::text, conname),'')) h
  from pg_constraint where connamespace='public'::regnamespace and contype='c'),
idx as (select md5(coalesce(string_agg(indexdef, chr(10) order by indexname),'')) h from pg_indexes where schemaname='public'),
fns as (select md5(coalesce(string_agg(pg_get_functiondef(p.oid), chr(10) order by p.proname, pg_get_function_identity_arguments(p.oid)),'')) h
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
fnsec as (select md5(coalesce(string_agg(format('%s(%s)|secdef=%s|cfg=%s', p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, coalesce(array_to_string(p.proconfig,','),'')), chr(10)
    order by p.proname, pg_get_function_identity_arguments(p.oid)),'')) h
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
rls as (select md5(coalesce(string_agg(format('%s|%s|%s', c.relname, c.relrowsecurity, c.relforcerowsecurity), chr(10) order by c.relname),'')) h
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
pols as (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles::text, coalesce(qual,''), coalesce(with_check,'')), chr(10)
    order by tablename, policyname),'')) h from pg_policies where schemaname='public'),
grants as (select md5(coalesce(string_agg(format('%s|%s|%s', table_name, grantee, privilege_type), chr(10) order by table_name, grantee, privilege_type),'')) h
  from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')),
fgrants as (select md5(coalesce(string_agg(format('%s|%s', routine_name, grantee), chr(10) order by routine_name, grantee),'')) h
  from information_schema.routine_privileges where routine_schema='public' and grantee in ('anon','authenticated')),
pub as (select md5(coalesce(string_agg(tablename, ',' order by tablename),'')) h
  from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'),
trg as (select md5(coalesce(string_agg(format('%s|%s|%s', c.relname, t.tgname, pg_get_triggerdef(t.oid)), chr(10) order by c.relname, t.tgname),'')) h
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal)
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as functions,
  (select count(*) from pg_policies where schemaname='public') as policies,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) as triggers,
  (select h from cols) cols_md5, (select h from pk) pk_md5, (select h from fk) fk_md5, (select h from uniq) uniq_md5,
  (select h from chk) chk_md5, (select h from idx) idx_md5, (select h from fns) fns_md5, (select h from fnsec) fnsec_md5,
  (select h from rls) rls_md5, (select h from pols) pols_md5, (select h from grants) grants_md5, (select h from fgrants) fgrants_md5,
  (select h from pub) pub_md5, (select h from trg) trg_md5;
