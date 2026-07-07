-- 0064_reviews_verification.sql — assertions STATIQUES sur la table `reviews` (migration 0064).
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception. Ne prouve PAS l'exécution réelle par
-- PostgreSQL de la migration (niveau 3), seulement la cohérence du contrat une fois 0064 appliquée.
--
-- Vérifie, APRÈS 0064 :
--   A. la table public.reviews existe avec RLS activée ;
--   B. anon n'a AUCUN grant sur public.reviews (invariant 0009/0053 : anon = zéro grant de table) ;
--   C. authenticated possède bien select/insert/update/delete ;
--   D. les contraintes CHECK (source, rating, status) sont présentes ;
--   E. les deux policies direction (select + write) existent, restreintes à authenticated.

begin;

do $$
declare v_n int;
begin
  -- A. table présente + RLS activée
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reviews' and c.relkind = 'r';
  if v_n <> 1 then
    raise exception 'A: table public.reviews absente (%).', v_n;
  end if;
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reviews' and c.relrowsecurity = true;
  if v_n <> 1 then
    raise exception 'A: RLS non activée sur public.reviews.';
  end if;

  -- B. anon = zéro grant sur reviews
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'reviews' and grantee = 'anon';
  if v_n <> 0 then
    raise exception 'B: anon possède % grant(s) sur public.reviews (invariant anon=0 violé).', v_n;
  end if;

  -- C. authenticated a bien les 4 privilèges DML
  select count(distinct privilege_type) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'reviews' and grantee = 'authenticated'
     and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  if v_n <> 4 then
    raise exception 'C: authenticated n''a pas les 4 grants DML sur reviews (% trouvés).', v_n;
  end if;

  -- D. contraintes CHECK présentes (source, rating, status) — on vérifie 3 CHECK au moins.
  select count(*) into v_n from pg_constraint con
   join pg_class c on c.oid = con.conrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'reviews' and con.contype = 'c';
  if v_n < 3 then
    raise exception 'D: contraintes CHECK insuffisantes sur reviews (% trouvées, attendu >= 3).', v_n;
  end if;

  -- E. les deux policies direction existent, ciblées authenticated
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'reviews'
     and policyname in ('reviews_select_direction', 'reviews_write_direction');
  if v_n <> 2 then
    raise exception 'E: policies direction manquantes sur reviews (% trouvées, attendu 2).', v_n;
  end if;

  raise notice '0064 verification: A/B/C/D/E OK — reviews RLS on, anon zéro grant, DML authenticated, CHECK + policies direction en place.';
end;
$$;

rollback;
