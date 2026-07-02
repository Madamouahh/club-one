-- ============================================================
-- 0018 — CRM : exposer la PROVENANCE dans la vue guest_scores (segment « historique importé »)
-- ============================================================
-- CONTEXTE (suite de 0017 + import réel labo S16) : 2050 fiches OctoTable ont été importées
-- avec client_historique = true, MAIS l'export est un AGRÉGAT clients — il ne contient AUCUNE
-- visite datée (aucune ligne guest_visits n'est fabriquée ; first_seen_at n'est qu'un PROXY de
-- première venue). Résultat : dans guest_scores, ces clients ont visits_seated_total = 0.
--
-- BOGUE DE CLASSIFICATION que cette migration débloque côté code : classifyGuest() rangeait tout
-- client à 0 visite dans « prospect (jamais venu) ». Or un historique importé A RÉELLEMENT fréquenté
-- l'établissement — l'étiqueter « jamais venu » est une donnée FAUSSE (interdit : rien d'inventé,
-- états honnêtes). Il faut donc distinguer, côté SQL déjà, l'historique importé du vrai prospect
-- capté par le funnel.
--
-- CETTE MIGRATION : purement ADDITIVE. Elle ne fait que RECRÉER la vue guest_scores en exposant
-- trois colonnes de provenance déjà présentes sur guests (0017) : client_historique, first_seen_at,
-- source. AUCUNE donnée touchée, AUCUNE visite fabriquée, AUCUN scoring modifié côté SQL (le scoring
-- reste 100 % côté lib TS déterministe). security_invoker = on conservé → la RLS 0013 s'applique
-- toujours (un promoteur ne voit QUE ses clients ; les historiques OctoTable owner_promoter = NULL
-- restent visibles de la seule direction, comportement vérifié en S16).
--
-- NIVEAU DE PREUVE visé : validation SQL statique (3) → à exécuter sur le LABO isolé (4).
-- NON destructive, NON prod. Rollback : réappliquer la définition 0013 de la vue (colonnes en moins).
-- ============================================================

-- create or replace view : PostgreSQL exige que les colonnes existantes gardent le MÊME nom, type et
-- ORDRE, et que les nouvelles soient AJOUTÉES EN FIN. On conserve donc l'ordre 0013 à l'identique et
-- on ajoute client_historique / first_seen_at / source après univers_prefere.
create or replace view public.guest_scores
with (security_invoker = on) as
select
  g.id                                    as guest_id,
  g.first_name,
  g.last_name,
  g.owner_promoter,
  max(v.exploitation_date) filter (where v.status = 'seated')            as last_seated_date,
  count(*)     filter (where v.status = 'seated'
                         and v.exploitation_date >= (now()::date - 90))  as visits_seated_90d,
  count(*)     filter (where v.status = 'seated'
                         and v.exploitation_date >= (now()::date - 180)) as visits_seated_180d,
  count(*)     filter (where v.status = 'seated'
                         and v.exploitation_date >= (now()::date - 365)) as visits_seated_12m,
  sum(v.spend_attributed) filter (where v.status = 'seated'
                         and v.exploitation_date >= (now()::date - 365)) as spend_seated_12m,
  count(*)     filter (where v.status = 'seated')                        as visits_seated_total,
  count(*)     filter (where v.status = 'no_show')                       as no_shows_total,
  count(*)     filter (where v.status in ('seated','no_show'))           as visits_resolved_total,
  avg(v.party_size) filter (where v.status = 'seated')                   as avg_party_size,
  -- Univers préféré = salle la plus fréquentée en « seated ». Sous-requête corrélée (et non
  -- mode() WITHIN GROUP … FILTER, non supporté par PostgreSQL sur un agrégat ordonné).
  (select v2.univers
     from public.guest_visits v2
    where v2.guest_id = g.id and v2.status = 'seated'
    group by v2.univers
    order by count(*) desc, v2.univers
    limit 1)                                                             as univers_prefere,
  -- ── Provenance (0017) — NOUVELLES colonnes, ajoutées en fin (contrainte create or replace) ──
  -- client_historique : true = fiche importée d'un historique (a réellement fréquenté l'établissement
  --   avant), donc PAS un « prospect jamais venu » même si visits_seated_total = 0 (aucune visite datée).
  g.client_historique,
  -- first_seen_at : PROXY de la 1re venue (date de création côté source). PAS une visite datée.
  g.first_seen_at,
  -- source : 'octotable' | 'funnel' | 'reservation' | NULL. Distingue l'origine de la fiche.
  g.source
from public.guests g
left join public.guest_visits v on v.guest_id = g.id
where g.opt_out_at is null
-- g.id est la clé primaire de guests → les autres colonnes g.* sont fonctionnellement dépendantes et
-- pourraient être omises du GROUP BY ; on les liste explicitement (style 0013) pour la lisibilité.
group by g.id, g.first_name, g.last_name, g.owner_promoter,
         g.client_historique, g.first_seen_at, g.source;

-- ── GRANT explicite (durcissement + correctif d'un BOGUE LATENT de 0013) ──
-- Le front (fetchCrmData) interroge guest_scores sous le rôle `authenticated` (clé anon + JWT staff).
-- Or 0013 n'a JAMAIS accordé SELECT sur cette vue : il s'appuyait IMPLICITEMENT sur les « default
-- privileges » Supabase (alter default privileges … grant select … to authenticated), présents dans
-- un vrai projet mais PAS garantis sur un clone/labo. Constat vérifié sur le LABO : `authenticated`
-- n'avait aucun SELECT sur guest_scores → la vue y était illisible par le front (permission denied).
-- On rend donc l'accès EXPLICITE et indépendant de l'environnement. Aucune baisse de sécurité :
--   · security_invoker = on → la RLS de guests s'applique intégralement (cantonnement promoteur intact,
--     vérifié sur le LABO : admin voit 2050, promoteur voit 0 car owner_promoter = NULL) ;
--   · SELECT accordé à `authenticated` UNIQUEMENT (jamais anon, jamais PUBLIC) — cohérent avec le
--     GRANT explicite de 0013 sur la table guests. Idempotent (rejouable sans effet de bord).
grant select on public.guest_scores to authenticated;
revoke all on public.guest_scores from anon;
