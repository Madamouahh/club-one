-- bootstrap_launch_event_TEMPLATE.sql — TEMPLATE (prod, jour J). NE PAS exécuter tel quel.
--
-- ⚠️ AUCUNE VALEUR INVENTÉE. Le FONDATEUR fournit les valeurs (cf. docs/CUTOVER_DAY_HUMAN_PREFLIGHT.md
-- §« Événement de bootstrap prêt »). L'opérateur remplace chaque <PLACEHOLDER> puis exécute, APRÈS 0008
-- et AVANT 0009, la CRÉATION de l'événement de lancement — la prod a actuellement 0 event, donc le
-- bootstrap n'a rien à activer sans cette étape.
--
-- Contraintes : venue_id DOIT exister dans public.venues (la prod a 3 venues — le fondateur choisit
-- lequel) ; slug unique ; status ∈ ('draft','published') (jamais 'archived') ; event_date au format date.

-- 1) (Optionnel) vérifier les venues disponibles avant de choisir venue_id :
--    select id, name, kind from public.venues order by sort_order;

-- 2) Créer l'événement de lancement :
insert into public.events (id, venue_id, title, slug, event_date, start_time, status, created_by)
values (
  gen_random_uuid(),
  '<VENUE_ID>',            -- doit exister dans public.venues (ex. renvoyé par la requête ci-dessus)
  '<TITRE_SOIREE>',        -- nom exact de la soirée de lancement
  '<SLUG_URL_UNIQUE>',     -- minuscules + tirets, unique
  '<YYYY-MM-DD>'::date,    -- date de la soirée
  '<HEURE_DEBUT>',         -- texte libre, ex. '23:00' (peut être NULL)
  'published',             -- ou 'draft' — JAMAIS 'archived'
  '<RESPONSABLE>'          -- qui crée (traçabilité)
)
returning id, venue_id, title, slug, event_date, status;

-- 3) Noter l'`id` retourné : c'est le p_event_id du bootstrap
--    (bootstrap_club_event_v2('<cet id>'), exécuté par un admin authentifié — cf. runbook B3).
