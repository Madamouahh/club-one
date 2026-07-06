-- 0052_active_event_venue_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0052_active_event_venue — la RPC
-- `get_active_event_context()` expose désormais l'UNIVERS (venue_id + venue_name) pour que le front
-- choisisse le LAYOUT de plan (Terminus 18 / Eden 44) selon l'univers de la soirée active.
--
-- (Renuméroté 0032 → 0052 au paquet de bascule prod : lève la collision de numéro 0032 ; produits_bar
-- garde 0032 car 0010/0034/0035 en dépendent. cf. docs/MIGRATIONS_REGISTRY.md §3.) Contenu inchangé :
-- il prouve l'ajout venue au contexte d'événement (surface additive, STABLE+SECDEF, grant
-- authenticated-only, résolution venue_name depuis venues.name, singleton NULL-safe).
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée de test ne persiste) :
--   (A) SURFACE ADDITIVE STRICTE : la signature OUT est EXACTEMENT les 6 colonnes de la 0008
--       (event_id, event_date, title, bootstrap_completed, bootstrap_completed_at, last_closed_event_id)
--       PRÉSERVÉES DANS L'ORDRE, + venue_id / venue_name AJOUTÉES EN FIN — les lecteurs par nom de
--       colonne de l'ancien front ne cassent pas (garantie « additif strict » du header de la migration) ;
--   (B) ATTRIBUTS de sécurité conservés : STABLE, SECURITY DEFINER, search_path = public (durcissement
--       obligatoire d'une fonction SECURITY DEFINER, cf. .claude/rules/20) ;
--   (C) GRANT (niveau privilège) : `authenticated` a l'EXECUTE, `anon` ne l'a PAS (revoke public/anon
--       de la migration ; l'univers du contexte reste réservé au staff authentifié) ;
--   (D) FAIL-CLOSED à l'exécution : un appel réel sous le rôle `anon` lève insufficient_privilege ;
--       sous `authenticated` il réussit — la barrière est portée par le MOTEUR, pas par l'UI ;
--   (E) COMPORTEMENT sur événement actif : venue_id / venue_name sont RÉSOLUS depuis la ligne `venues`
--       jointe (venue_name = venues.name), et les 6 colonnes de base restent correctes (event_id/title/
--       bootstrap) — additif sans régression ;
--   (F) NON-VACUITÉ / preuve du JOIN vivant : renommer l'univers en transaction change immédiatement
--       venue_name renvoyé (une implémentation qui figerait le nom échouerait ici) ;
--   (G) SINGLETON sans événement actif : active_event_id = NULL → la fonction renvoie TOUJOURS
--       EXACTEMENT 1 ligne (le contexte lifecycle, `where crs.id`), event_id / venue_id / venue_name
--       NULL (left join), bootstrap_completed conservé — le front lit le contexte pour choisir
--       bootstrap vs activate même hors soirée (cf. .claude/rules/50, cycle de vie événementiel).
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Fixtures LABO (venue + event) créées DANS la transaction annulée ; active_event_id repointé puis
-- restauré par le rollback. La fonction ignore les claims JWT (contexte serveur pur) : les tests de
-- rôle passent par `set local role` sans sub — le GRANT est l'unique contrôle d'accès, et c'est lui
-- qui est éprouvé.
-- NB : les variables psql (\gset) ne sont PAS interpolées dans les blocs dollar-quotés ($$…$$) ; les
--      assertions passent donc par des helpers pg_temp appelés depuis des SELECT normaux (interpolés).

begin;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual, 'NULL');
  end if;
end $$;

create or replace function pg_temp.expect_bool(p_actual boolean, p_expected boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU %, OBTENU %', p_label, p_expected, coalesce(p_actual::text, 'NULL');
  end if;
end $$;

-- L'appel de get_active_event_context() DOIT être refusé (insufficient_privilege) pour le rôle courant.
-- Un succès = FAILLE. (Appelée sous le rôle déjà positionné par le caller.)
create or replace function pg_temp.expect_exec_denied(p_label text) returns void
language plpgsql as $$
declare n int;
begin
  select count(*) into n from public.get_active_event_context();
  raise exception 'FAILLE %: get_active_event_context exécutable (% lignes) — attendu insufficient_privilege', p_label, n;
exception
  when insufficient_privilege then null; -- 42501 = comportement attendu
end $$;

-- ============================================================
-- (A) SURFACE ADDITIVE — signature OUT : 6 de 0008 préservées en tête, venue_id/venue_name en fin.
-- ============================================================
do $$
declare names text[];
begin
  select p.proargnames into names
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_active_event_context';

  if names is distinct from array[
       'event_id','event_date','title','bootstrap_completed','bootstrap_completed_at',
       'last_closed_event_id','venue_id','venue_name'] then
    raise exception 'A/signature OUT inattendue: %', names;
  end if;

  -- Les 6 colonnes de la 0008, dans l'ordre, en tête (l'ancien front lit par nom → ne casse pas).
  if names[1:6] is distinct from array[
       'event_id','event_date','title','bootstrap_completed','bootstrap_completed_at',
       'last_closed_event_id'] then
    raise exception 'A/les 6 colonnes 0008 ne sont pas préservées en tête: %', names[1:6];
  end if;

  -- venue_id / venue_name AJOUTÉES en fin (positions 7 et 8).
  if names[7] <> 'venue_id' or names[8] <> 'venue_name' then
    raise exception 'A/venue_id/venue_name pas ajoutées en fin: %', names[7:8];
  end if;
end $$;

-- ============================================================
-- (B) ATTRIBUTS — STABLE, SECURITY DEFINER, search_path = public.
-- ============================================================
do $$
declare v_vol char; v_sec boolean; v_cfg text[];
begin
  select p.provolatile, p.prosecdef, p.proconfig into v_vol, v_sec, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_active_event_context';

  if v_vol <> 's' then raise exception 'B/attendu STABLE, obtenu volatilité "%"', v_vol; end if;
  if not v_sec then raise exception 'B/attendu SECURITY DEFINER'; end if;
  if v_cfg is null or not ('search_path=public' = any(v_cfg)) then
    raise exception 'B/search_path=public absent du proconfig: %', v_cfg;
  end if;
end $$;

-- ============================================================
-- (C) GRANT — authenticated a l'EXECUTE, anon ne l'a PAS.
-- ============================================================
select pg_temp.expect_bool(
  has_function_privilege('authenticated', 'public.get_active_event_context()', 'EXECUTE'),
  true, 'C/authenticated a EXECUTE');
select pg_temp.expect_bool(
  has_function_privilege('anon', 'public.get_active_event_context()', 'EXECUTE'),
  false, 'C/anon N''A PAS EXECUTE (revoke)');

-- ============================================================
-- (D) FAIL-CLOSED à l'exécution — anon refusé au moteur ; non-vacuité de la garde sous authenticated.
-- ============================================================
set local role anon;
select pg_temp.expect_exec_denied('D/anon');
reset role;

-- Non-vacuité : sous authenticated (autorisé) la garde expect_exec_denied DOIT lever FAILLE
-- (la fonction s'exécute) → preuve qu'elle distingue réellement autorisé/refusé, sans passer à vide.
set local role authenticated;
do $$
begin
  perform pg_temp.expect_exec_denied('NONVAC/authenticated');
  raise exception 'NON-VACUITÉ CASSÉE: expect_exec_denied n''a pas levé sous authenticated (autorisé)';
exception
  when others then
    if sqlerrm like 'FAILLE%' then null; -- attendu : la garde a bien détecté l'exécution réussie
    else raise; end if;
end $$;
reset role;

-- ------------------------------------------------------------
-- Fixtures (créées en tant que postgres — annulées au rollback) : un univers + une soirée l'utilisant,
-- pointée comme événement actif du singleton runtime.
-- ------------------------------------------------------------
insert into public.venues (id, name, kind)
values ('zz-fixture-venue-0032', 'FIXTURE Univers 0032', 'rooftop');

insert into public.events (venue_id, title, event_date, status)
values ('zz-fixture-venue-0032', 'FIXTURE Soirée 0032', '2099-12-31', 'published')
returning id as fx_ev_id \gset

-- On mémorise l'événement actif courant pour ne rien inférer, puis on pointe la fixture.
select active_event_id::text as prev_active from public.club_runtime_state where id \gset
update public.club_runtime_state set active_event_id = :'fx_ev_id'::uuid where id;

-- ============================================================
-- (E) COMPORTEMENT — événement actif : venue résolu + colonnes de base correctes.
-- ============================================================
set local role authenticated;
select venue_id            as e_vid,
       venue_name          as e_vname,
       title               as e_title,
       event_id::text      as e_evid,
       bootstrap_completed as e_boot
  from public.get_active_event_context() \gset
reset role;

select pg_temp.expect(:'e_vid',   'zz-fixture-venue-0032', 'E/venue_id résolu depuis events.venue_id');
select pg_temp.expect(:'e_vname', 'FIXTURE Univers 0032',  'E/venue_name résolu depuis venues.name');
select pg_temp.expect(:'e_title', 'FIXTURE Soirée 0032',   'E/title (colonne 0008) préservé');
select pg_temp.expect(:'e_evid',  :'fx_ev_id',             'E/event_id (colonne 0008) = event actif');
select pg_temp.expect(:'e_boot',  't',                     'E/bootstrap_completed vrai (labo bootstrapé)');

-- ============================================================
-- (F) NON-VACUITÉ / JOIN VIVANT — renommer l'univers change venue_name renvoyé.
-- ============================================================
update public.venues set name = 'FIXTURE Univers 0032 RENOMMÉ' where id = 'zz-fixture-venue-0032';
set local role authenticated;
select venue_name as f_vname from public.get_active_event_context() \gset
reset role;
select pg_temp.expect(:'f_vname', 'FIXTURE Univers 0032 RENOMMÉ',
  'F/venue_name suit venues.name (join live, pas une copie figée)');

-- ============================================================
-- (G) SINGLETON — sans événement actif : 1 ligne, event/venue NULL, bootstrap conservé.
-- ============================================================
update public.club_runtime_state set active_event_id = null where id;
set local role authenticated;
-- NB : pas de cast ::text ici — boolean::text vaut 'true'/'false' en SQL, alors que \gset capture
-- l'AFFICHAGE psql d'un booléen ('t'/'f'). On laisse donc psql formater (cohérent avec e_boot ci-dessus).
select count(*)                       as g_n,
       max(event_id::text) is null    as g_evnull,
       max(venue_id)       is null    as g_vidnull,
       max(venue_name)     is null    as g_vnamenull,
       bool_and(bootstrap_completed)  as g_boot
  from public.get_active_event_context() \gset
reset role;

select pg_temp.expect(:'g_n',        '1', 'G/singleton renvoie exactement 1 ligne sans event actif');
select pg_temp.expect(:'g_evnull',   't', 'G/event_id NULL sans event actif');
select pg_temp.expect(:'g_vidnull',  't', 'G/venue_id NULL sans event actif (left join)');
select pg_temp.expect(:'g_vnamenull','t', 'G/venue_name NULL sans event actif (left join)');
select pg_temp.expect(:'g_boot',     't', 'G/bootstrap_completed reste lisible (contexte lifecycle)');

select '0032 active_event_venue (surface additive 6+2 / STABLE+SECDEF+search_path / grant authenticated-only / anon fail-closed moteur / venue_id+venue_name résolus depuis venues.name / join vivant / singleton NULL-safe sans event actif) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
