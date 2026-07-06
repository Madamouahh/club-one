-- 0053_revoke_anon_all_tables_verification.sql (renuméroté depuis 0054)
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception.
--
-- Vérifie, APRÈS 0054 :
--   A. anon n'a AUCUN grant de table dans public (invariant 0009 rétabli globalement) ;
--   B. les RPC anon légitimes restent exécutables (get_invite, public_events) — on ne casse pas le
--      site public ;
--   C. toutes les tables ayant (eu) des grants anon gardent la RLS activée (défense en profondeur).

begin;

do $$
declare v_n int;
begin
  -- A. anon = zéro grant de table
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='public' and grantee='anon';
  if v_n <> 0 then
    raise exception 'A: anon possède encore % grant(s) de table après 0054', v_n;
  end if;

  -- B. RPC publiques anon toujours exécutables (le site public ne doit pas casser)
  if not has_function_privilege('anon', 'public.get_invite(text)', 'EXECUTE') then
    raise exception 'B: anon a perdu EXECUTE sur get_invite (régression site public)';
  end if;
  if not has_function_privilege('anon', 'public.public_events()', 'EXECUTE') then
    raise exception 'B: anon a perdu EXECUTE sur public_events (régression site public)';
  end if;

  -- C. aucune table publique sans RLS (rien ne doit rester ouvert)
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false;
  if v_n <> 0 then
    raise exception 'C: % table(s) publique(s) sans RLS', v_n;
  end if;

  raise notice '0054 verification: A/B/C OK — anon zéro grant table, RPC publiques intactes, RLS partout.';
end;
$$;

rollback;
