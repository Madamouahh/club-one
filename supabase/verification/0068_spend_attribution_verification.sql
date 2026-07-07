-- 0068_spend_attribution_verification.sql — PREUVE NIVEAU 3 (SQL STATIQUE, tx ROLLBACK).
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception. Ne prouve PAS l'exécution runtime des gardes
-- (niveau 4/5), seulement la présence structurelle attendue APRÈS 0068.
--
-- Vérifie :
--   A. RPC attribute_guest_spend_v1(uuid, date, int) présente avec la BONNE signature d'arguments ;
--   B. SECURITY DEFINER ;
--   C. search_path=public figé (proconfig) ;
--   D. retourne un scalaire numeric (pas une table) ;
--   E. EXECUTE accordé à authenticated, refusé à public/anon (fail-closed) ;
--   F. garde direction présente en SOURCE (admin/manager) + garde d'honnêteté (status 'seated' forcé) ;
--   G. la cible d'écriture guest_visits est bien sous RLS (la RPC ne l'a pas désactivée).

begin;

do $$
declare
  v_oid      oid;
  v_secdef   boolean;
  v_cfg      text[];
  v_rettype  text;
  v_src      text;
begin
  -- A. présence + signature exacte (types d'arguments : uuid, date, integer). oidvectortypes()
  --    ne renvoie que les TYPES (pas les noms) → comparaison stable inter-versions.
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'attribute_guest_spend_v1'
     and oidvectortypes(p.proargtypes) = 'uuid, date, integer';
  if v_oid is null then
    raise exception 'A: attribute_guest_spend_v1(uuid, date, int) absente ou signature inattendue';
  end if;

  -- B/C/D. attributs de sécurité + type de retour --------------------------------------------------
  select p.prosecdef, p.proconfig, pg_catalog.format_type(p.prorettype, null)
    into v_secdef, v_cfg, v_rettype
    from pg_proc p where p.oid = v_oid;

  if not v_secdef then
    raise exception 'B: attribute_guest_spend_v1 n''est pas SECURITY DEFINER';
  end if;

  if v_cfg is null
     or not exists (select 1 from unnest(v_cfg) c where c ilike 'search_path=%public%') then
    raise exception 'C: attribute_guest_spend_v1 sans search_path=public figé (proconfig=%)', v_cfg;
  end if;

  if v_rettype <> 'numeric' then
    raise exception 'D: attribute_guest_spend_v1 devrait retourner numeric (obtenu %)', v_rettype;
  end if;

  -- E. grants EXECUTE : authenticated OUI, anon/public NON -----------------------------------------
  if not has_function_privilege('authenticated',
        'public.attribute_guest_spend_v1(uuid, date, int)', 'EXECUTE') then
    raise exception 'E: authenticated privé d''EXECUTE sur attribute_guest_spend_v1';
  end if;
  if has_function_privilege('anon',
        'public.attribute_guest_spend_v1(uuid, date, int)', 'EXECUTE') then
    raise exception 'E: anon a EXECUTE sur attribute_guest_spend_v1 (doit être authenticated-only)';
  end if;

  -- F. gardes présentes en source (direction + honnêteté 'seated') ---------------------------------
  select pg_get_functiondef(v_oid) into v_src;
  if v_src not ilike '%not in (''admin'',''manager'')%' then
    raise exception 'F: garde direction (admin/manager) absente de la source';
  end if;
  if v_src not ilike '%''seated''%' then
    raise exception 'F: la RPC ne force pas status=''seated'' (dépense invisible dans guest_360_v1)';
  end if;
  if v_src not ilike '%on conflict (guest_id, exploitation_date, univers)%' then
    raise exception 'F: upsert idempotent (on conflict clé de visite) absent de la source';
  end if;

  -- G. la table cible guest_visits est bien sous RLS (non désactivée par la migration) -------------
  if not (select relrowsecurity from pg_class where oid = 'public.guest_visits'::regclass) then
    raise exception 'G: RLS off sur public.guest_visits (régression de sécurité)';
  end if;

  raise notice '0068 spend_attribution verification: A/B/C/D/E/F/G OK — RPC attribute_guest_spend_v1 SECURITY DEFINER, search_path figé, numeric, authenticated-only, garde direction + status seated + upsert, guest_visits sous RLS.';
end;
$$;

rollback;
