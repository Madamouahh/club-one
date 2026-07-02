-- 0017_octotable_import_provenance.sql — Provenance d'import CRM (OctoTable & assimilés).
-- ADDITIF STRICT au-dessus de 0013 (guests). N'ajoute que des colonnes NULLABLES / avec DEFAULT
-- non destructif : aucune ligne existante n'est modifiée, aucune contrainte existante touchée,
-- AUCUN seed (la base ship VIDE — les vrais clients viennent de l'export réel du fondateur).
--
-- Contexte : le fondateur a déposé l'export de la base CLIENTS OctoTable (rooftop EDEN). On amorce
-- le CRM avec de VRAIS clients (intérêt légitime, art. 6.1.f RGPD — voir IMPORT_OCTOTABLE.md), en
-- gardant la trace de la provenance pour l'audit CNIL et pour ne jamais confondre un client capté
-- au funnel avec un client importé d'un historique de réservations.
--
-- Ce que ces colonnes disent (et ne disent pas) :
--   · source            : d'où vient la fiche ('octotable', 'funnel', 'reservation'…). NULL = inconnu.
--   · venue             : établissement d'origine de la donnée ('eden'…). Distinct de guest_visits.univers
--                         (qui est la salle d'une visite concrète) : ici c'est la PROVENANCE de la fiche.
--   · client_historique : true = importé d'un historique (a réellement fréquenté l'établissement avant
--                         le CRM) ; base de l'exception « client existant / services analogues » (L.34-5).
--   · first_seen_at     : date de création de la fiche côté source (OctoTable « Date de création »).
--                         PROXY de la première venue — PAS une visite datée : on n'a pas l'historique
--                         résa par résa dans cet export, donc on ne fabrique AUCUNE ligne guest_visits.
--   · import_no_show    : flag no-show agrégé tel que fourni par la source (OctoTable « No show »).
--                         Conservé comme métadonnée ; NULL = information non fournie (jamais false inventé).
--
-- RGPD/minimisation : on n'ajoute AUCUNE colonne adresse/allergène/note libre (vides dans l'export
-- et hors finalité marketing). Le consentement reste porté par les colonnes de 0013 (consent_marketing
-- + consent_source + consent_marketing_at) : les opt-ins newsletter documentés y sont journalisés,
-- tout le reste importe avec consent_marketing = false (aucun envoi sans GO fondateur).
--
-- La RLS de guests (0013) s'applique inchangée à ces colonnes (pas de nouvelle policy nécessaire).

begin;

alter table public.guests add column if not exists source text;
alter table public.guests add column if not exists venue text;
alter table public.guests add column if not exists client_historique boolean not null default false;
alter table public.guests add column if not exists first_seen_at date;
alter table public.guests add column if not exists import_no_show boolean;

-- Index léger : cibler rapidement une cohorte importée (ex. « les historiques EDEN OctoTable »)
-- sans scanner toute la table lors des futurs recalculs de scoring / segments d'amorçage.
create index if not exists guests_source_idx on public.guests(source) where source is not null;
create index if not exists guests_historique_idx on public.guests(client_historique) where client_historique;

commit;
