-- 0043_revoke_truncate_and_legacy_login_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0043 — durcissement TRUNCATE + login legacy.
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) S1 : PLUS AUCUNE table de base publique n'accorde TRUNCATE à `authenticated` ni à `anon` ;
--   (B) D2 : `verify_staff_login(text,text)` n'est plus EXECUTE par anon ni authenticated ;
--   (C) NON-VACUITÉ / non-sur-révocation : on n'a PAS cassé les accès légitimes — `authenticated`
--       conserve un SELECT (ex. sur `events`, exposé par RLS) et un grant de mutation applicative
--       (ex. INSERT sur `entry_logs`) ; la fonction verify_staff_login EXISTE toujours (non DROP,
--       réversible) — on a seulement retiré ses grants.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- Lecture de catalogue uniquement (aucune écriture) → le rollback final est une simple hygiène.

begin;

do $$
declare
  v_trunc_auth int;
  v_trunc_anon int;
  v_exec_anon bool;
  v_exec_auth bool;
  v_fn_exists bool;
  v_auth_select bool;
begin
  -- (A) S1 — TRUNCATE totalement révoqué pour les deux rôles applicatifs.
  select count(*) into v_trunc_auth
  from information_schema.role_table_grants
  where grantee='authenticated' and privilege_type='TRUNCATE' and table_schema='public';
  if v_trunc_auth <> 0 then
    raise exception 'A.authenticated conserve TRUNCATE sur % table(s) (attendu 0)', v_trunc_auth;
  end if;

  select count(*) into v_trunc_anon
  from information_schema.role_table_grants
  where grantee='anon' and privilege_type='TRUNCATE' and table_schema='public';
  if v_trunc_anon <> 0 then
    raise exception 'A.anon conserve TRUNCATE sur % table(s) (attendu 0)', v_trunc_anon;
  end if;

  -- (B) D2 — verify_staff_login n'est plus exécutable par anon/authenticated.
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='verify_staff_login'
  ) into v_fn_exists;
  if not v_fn_exists then
    raise exception 'B.verify_staff_login a été SUPPRIMÉE (attendu : conservée, grants seulement révoqués)';
  end if;
  v_exec_anon := has_function_privilege('anon',          'public.verify_staff_login(text,text)', 'EXECUTE');
  v_exec_auth := has_function_privilege('authenticated', 'public.verify_staff_login(text,text)', 'EXECUTE');
  if v_exec_anon then raise exception 'B.verify_staff_login EXECUTE anon PRÉSENT (doit être révoqué)'; end if;
  if v_exec_auth then raise exception 'B.verify_staff_login EXECUTE authenticated PRÉSENT (doit être révoqué)'; end if;

  -- (C) NON-VACUITÉ — on n'a pas sur-révoqué : authenticated garde des accès applicatifs légitimes.
  v_auth_select := has_table_privilege('authenticated', 'public.events', 'SELECT');
  if not v_auth_select then
    raise exception 'C.authenticated a PERDU SELECT sur events (sur-révocation — le REVOKE TRUNCATE a mordu trop large)';
  end if;
  if not has_table_privilege('authenticated', 'public.entry_logs', 'INSERT') then
    raise exception 'C.authenticated a PERDU INSERT sur entry_logs (sur-révocation)';
  end if;
end $$;

select '0043 revoke_truncate_and_legacy_login (TRUNCATE révoqué anon+authenticated sur toutes les tables · verify_staff_login non exécutable mais conservée · accès applicatifs légitimes intacts) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
