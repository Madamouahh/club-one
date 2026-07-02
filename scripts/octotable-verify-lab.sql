-- scripts/octotable-verify-lab.sql — Vérification AGRÉGÉE post-import OctoTable (LABO).
-- ZÉRO PII : uniquement des comptes et des répartitions. Committable. Lecture seule (aucune écriture).
-- Exécution :  docker exec -i supabase_db_club-one-lab psql -U postgres -d postgres -f - < scripts/octotable-verify-lab.sql
--
-- Prouve, sur le LABO, ce que l'import DOIT garantir (à croiser avec le dry-run S15) :
--   · volume importé, · consentement des opt-ins conforme (source + horodatage, jamais opt-out),
--   · défauts sûrs (majorité non vérifiée, consent_marketing=false pour la grande masse),
--   · provenance homogène, · aucune anomalie de téléphone.

\pset footer off

select '1. total guests' as controle, count(*)::text as valeur from public.guests;

select '2. provenance octotable' as controle,
       count(*) filter (where source = 'octotable')::text as valeur
from public.guests;

select '3. client_historique=true' as controle,
       count(*) filter (where client_historique)::text as valeur
from public.guests;

select '4. venue=eden' as controle,
       count(*) filter (where venue = 'eden')::text as valeur
from public.guests;

-- Opt-ins marketing : chacun DOIT avoir source + horodatage de consentement, et JAMAIS d'opt-out.
select '5. consent_marketing=true' as controle, count(*)::text as valeur
from public.guests where consent_marketing;

select '5b. opt-in conformes (source octotable_newsletter + at non null + pas opt-out)' as controle,
       count(*)::text as valeur
from public.guests
where consent_marketing
  and consent_source = 'octotable_newsletter'
  and consent_marketing_at is not null
  and opt_out_at is null;

select '5c. opt-in NON conformes (doit être 0)' as controle, count(*)::text as valeur
from public.guests
where consent_marketing
  and (consent_source is distinct from 'octotable_newsletter'
       or consent_marketing_at is null
       or opt_out_at is not null);

-- Défauts sûrs : la masse non opt-in reste en consent_marketing=false ; majorité jamais vérifiée ici.
select '6. consent_marketing=false' as controle, count(*)::text as valeur
from public.guests where not consent_marketing;

select '7. majorite_verifiee=false (doit = total : pas de date de naissance dans l export)' as controle,
       count(*)::text as valeur
from public.guests where majorite_verifiee = false;

select '8. import_no_show=true' as controle, count(*)::text as valeur
from public.guests where import_no_show is true;

-- Anomalies téléphone : tout doit être E.164 (+ suivi de 8 à 15 chiffres). Doit = 0.
select '9. téléphones NON E.164 (doit être 0)' as controle, count(*)::text as valeur
from public.guests where phone !~ '^\+[1-9][0-9]{7,14}$';

-- owner_promoter : clientèle de l'établissement → aucun propriétaire promoteur.
select '10. owner_promoter renseigné (doit être 0)' as controle, count(*)::text as valeur
from public.guests where owner_promoter is not null;

-- Répartition proxy 1re venue (Date de création) par année — à croiser avec le dry-run.
select '11. année ' || coalesce(to_char(first_seen_at, 'YYYY'), 'inconnu') as controle,
       count(*)::text as valeur
from public.guests
group by 1
order by 1;
