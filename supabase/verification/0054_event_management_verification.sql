-- 0054_event_management_verification.sql
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction rollback ; chaque invariant = raise exception. Preuve NIVEAU 3 (SQL statique) : vérifie
-- la STRUCTURE post-0054, pas le comportement runtime.
--
-- Vérifie, APRÈS 0054 :
--   A. les colonnes de planification existent sur public.events ;
--   B. la contrainte de statut inclut draft/published/open/closed/archived ;
--   C. les RPC create/update/duplicate/cancel + la garde de transition existent en SECURITY DEFINER,
--      search_path=public ;
--   D. les grants EXECUTE sont restreints (authenticated OUI ; public/anon NON) ;
--   E. la garde de transition renvoie les bonnes réponses sur quelques cas clés.

begin;

do $$
declare
  v_n int;
  v_col text;
  v_fn record;
  v_condef text;
begin
  -- A. colonnes de planification présentes
  foreach v_col in array array['artistes','horaire_debut','horaire_fin','espace','capacite','equipe','notes']
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='events' and column_name=v_col
    ) then
      raise exception 'A: colonne events.% absente apres 0054', v_col;
    end if;
  end loop;

  -- B. contrainte de statut fermée incluant les 5 valeurs
  select pg_get_constraintdef(c.oid) into v_condef
    from pg_constraint c
   where c.conrelid='public.events'::regclass and c.conname='events_status_check';
  if v_condef is null then
    raise exception 'B: contrainte events_status_check absente';
  end if;
  if v_condef not like '%draft%'
     or v_condef not like '%published%'
     or v_condef not like '%open%'
     or v_condef not like '%closed%'
     or v_condef not like '%archived%' then
    raise exception 'B: events_status_check ne couvre pas draft/published/open/closed/archived (def=%)', v_condef;
  end if;

  -- C. RPC présentes, SECURITY DEFINER, search_path=public
  for v_fn in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in ('create_event_v1','update_event_v1','duplicate_event_v1','cancel_event_v1','event_status_transition_allowed')
  loop
    -- event_status_transition_allowed est pure/immutable (pas SECURITY DEFINER) : on n'exige DEFINER
    -- que pour les 4 RPC d'écriture.
    if v_fn.proname <> 'event_status_transition_allowed' and not v_fn.prosecdef then
      raise exception 'C: % n''est pas SECURITY DEFINER', v_fn.proname;
    end if;
    if v_fn.proconfig is null or not (array['search_path=public'] <@ v_fn.proconfig) then
      raise exception 'C: % ne fixe pas search_path=public (proconfig=%)', v_fn.proname, v_fn.proconfig;
    end if;
  end loop;

  -- présence effective des 5 fonctions
  select count(distinct p.proname) into v_n
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('create_event_v1','update_event_v1','duplicate_event_v1','cancel_event_v1','event_status_transition_allowed');
  if v_n <> 5 then
    raise exception 'C: seulement %/5 fonctions 0054 presentes', v_n;
  end if;

  -- D. grants EXECUTE restreints : authenticated OUI, public/anon NON
  if not has_function_privilege('authenticated',
       'public.create_event_v1(text,text,date,text,text,text,text,text,integer,jsonb,text)', 'EXECUTE') then
    raise exception 'D: authenticated ne peut pas EXECUTE create_event_v1';
  end if;
  if not has_function_privilege('authenticated', 'public.cancel_event_v1(uuid)', 'EXECUTE') then
    raise exception 'D: authenticated ne peut pas EXECUTE cancel_event_v1';
  end if;
  if has_function_privilege('anon', 'public.create_event_v1(text,text,date,text,text,text,text,text,integer,jsonb,text)', 'EXECUTE') then
    raise exception 'D: anon possede EXECUTE sur create_event_v1 (fuite)';
  end if;
  if has_function_privilege('anon', 'public.duplicate_event_v1(uuid,date)', 'EXECUTE') then
    raise exception 'D: anon possede EXECUTE sur duplicate_event_v1 (fuite)';
  end if;

  -- E. garde de transition : quelques cas clés
  if not public.event_status_transition_allowed('draft','published') then
    raise exception 'E: draft->published devrait etre autorise';
  end if;
  if not public.event_status_transition_allowed('published','open') then
    raise exception 'E: published->open devrait etre autorise';
  end if;
  if public.event_status_transition_allowed('closed','open') then
    raise exception 'E: closed->open devrait etre interdit (terminal)';
  end if;
  if public.event_status_transition_allowed('draft','open') then
    raise exception 'E: draft->open devrait etre interdit (doit passer par published)';
  end if;
  if not public.event_status_transition_allowed('open','open') then
    raise exception 'E: no-op open->open devrait etre autorise';
  end if;

  raise notice '0054 verification: A/B/C/D/E OK — colonnes, contrainte statut, RPC DEFINER search_path, grants restreints, garde de transition.';
end;
$$;

rollback;
