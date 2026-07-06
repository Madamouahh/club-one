-- 0052_active_event_venue.sql — le contexte d'événement actif expose l'UNIVERS (venue).
-- (Renuméroté 0032 → 0052 au paquet de bascule prod pour lever la collision de numéro 0032 ;
--  contenu fonctionnel INCHANGÉ. Cette migration ne fait qu'un CREATE OR REPLACE de
--  get_active_event_context — aucune autre migration ne redéfinit cette fonction ni ne dépend de
--  l'ordre, donc l'appliquer en fin de chaîne donne un schéma final identique. produits_bar garde
--  0032 car 0010/0034/0035 en dépendent. cf. docs/MIGRATIONS_REGISTRY.md §3.)
--
-- Besoin fondateur (2026-07-04) : gérer l'EDEN dans l'appli « comme le Terminus ». Le front
-- choisit désormais le LAYOUT de plan (Terminus 18 tables / Eden 44 tables) selon l'univers de
-- la soirée active — il lui faut donc venue_id/venue_name dans get_active_event_context.
-- Additif strict : même fonction, mêmes colonnes existantes, 2 colonnes ajoutées en fin de
-- ligne (les lecteurs existants par nom de colonne ne cassent pas). Mêmes garanties :
-- STABLE SECURITY DEFINER, search_path public, aucune donnée nouvelle exposée au-delà du nom
-- d'univers (déjà public sur le site).

begin;

drop function if exists public.get_active_event_context();

create or replace function public.get_active_event_context()
 returns table(
   event_id uuid,
   event_date date,
   title text,
   bootstrap_completed boolean,
   bootstrap_completed_at timestamptz,
   last_closed_event_id uuid,
   venue_id text,
   venue_name text
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select e.id,
         e.event_date,
         e.title,
         crs.bootstrap_completed_at is not null,
         crs.bootstrap_completed_at,
         crs.last_closed_event_id,
         e.venue_id,
         v.name
    from public.club_runtime_state crs
    left join public.events e on e.id = crs.active_event_id
    left join public.venues v on v.id = e.venue_id
   where crs.id is true;
$function$;

-- Mêmes droits que la version précédente (0008) : exécutable par le staff authentifié uniquement.
revoke all on function public.get_active_event_context() from public, anon;
grant execute on function public.get_active_event_context() to authenticated;

commit;
