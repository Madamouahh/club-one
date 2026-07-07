-- 0066_staff_performance_verification.sql — assertions STATIQUES sur la vue `staff_performance_v1` (0066).
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception. Ne prouve PAS l'exécution réelle par
-- PostgreSQL (niveau 3), seulement la cohérence du contrat une fois 0066 appliquée SUR 0011 + 0003.
--
-- Vérifie, APRÈS 0066 :
--   A. la vue public.staff_performance_v1 existe (relkind = 'v') ;
--   B. elle est bien security_invoker = true (pas de vue « SECURITY DEFINER » masquant la RLS 0011) ;
--   C. anon n'a AUCUN grant sur la vue (invariant 0009/0053 : anon = zéro grant) ;
--   D. authenticated possède le grant SELECT ;
--   E. la vue expose bien les colonnes de faits attendues (comptages + presence_rate) ;
--   F. la garde direction current_staff_role() est présente dans la définition de la vue ;
--   G. la vue dépend réellement de staff_shifts ET staff_members (elle agrège les faits 0011).

begin;

do $$
declare v_n int;
declare v_def text;
begin
  -- A. vue présente
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'staff_performance_v1' and c.relkind = 'v';
  if v_n <> 1 then
    raise exception 'A: vue public.staff_performance_v1 absente (%).', v_n;
  end if;

  -- B. security_invoker = true (reloptions contient 'security_invoker=true')
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'staff_performance_v1'
     and c.reloptions @> array['security_invoker=true'];
  if v_n <> 1 then
    raise exception 'B: staff_performance_v1 n''est pas security_invoker=true (RLS 0011 non appliquée à l''appelant).';
  end if;

  -- C. anon = zéro grant sur la vue
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'staff_performance_v1' and grantee = 'anon';
  if v_n <> 0 then
    raise exception 'C: anon possède % grant(s) sur staff_performance_v1 (invariant anon=0 violé).', v_n;
  end if;

  -- D. authenticated a bien SELECT
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'staff_performance_v1'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if v_n <> 1 then
    raise exception 'D: authenticated n''a pas le grant SELECT sur staff_performance_v1 (% trouvés).', v_n;
  end if;

  -- E. colonnes de faits attendues présentes (comptages honnêtes + taux)
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'staff_performance_v1'
     and column_name in (
       'staff_member_id','username','full_name','poste','actif',
       'shifts_total','shifts_planned','shifts_confirmed','shifts_present',
       'shifts_late','shifts_absent','shifts_cancelled','attendance_recorded',
       'presence_rate','last_shift_date'
     );
  if v_n <> 15 then
    raise exception 'E: colonnes de faits manquantes sur staff_performance_v1 (% / 15 trouvées).', v_n;
  end if;

  -- F. garde direction dans la définition de la vue (current_staff_role restreint à admin/manager)
  v_def := pg_get_viewdef('public.staff_performance_v1'::regclass, true);
  if position('current_staff_role' in v_def) = 0 then
    raise exception 'F: garde current_staff_role() absente de la définition de staff_performance_v1.';
  end if;

  -- G. dépendances réelles : la vue lit staff_shifts ET staff_members (agrégation des faits 0011)
  select count(distinct dep.relname) into v_n
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v on v.oid = r.ev_class
    join pg_class dep on dep.oid = d.refobjid
    join pg_namespace nv on nv.oid = v.relnamespace
    join pg_namespace nd on nd.oid = dep.relnamespace
   where nv.nspname = 'public' and v.relname = 'staff_performance_v1'
     and nd.nspname = 'public' and dep.relname in ('staff_shifts','staff_members')
     and d.deptype = 'n';
  if v_n <> 2 then
    raise exception 'G: staff_performance_v1 ne dépend pas des 2 tables 0011 attendues (% trouvées).', v_n;
  end if;

  raise notice '0066 verification: A/B/C/D/E/F/G OK — vue assiduité security_invoker, anon zéro grant, SELECT authenticated, colonnes de faits, garde direction, dépendances 0011.';
end;
$$;

rollback;
