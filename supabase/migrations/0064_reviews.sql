-- 0064_reviews.sql — MODULE RÉPUTATION & AVIS (B14), backend réel de la SAISIE STAFF des avis.
--
-- Source de vérité UNIQUE : les avis clients (note, auteur, corps, plateforme d'origine, statut de
-- réponse). Le composant présentationnel (components/ReputationBoard + lib/reputation) ship VIDE tant
-- qu'aucun connecteur ne l'alimente ; cette table fournit le MODÈLE DE DONNÉES saisi à la main par la
-- direction, à la place du connecteur.
--
--   · `reviews` : un avis (source google/meta/tripadvisor/autre, note 1..5 facultative, auteur, corps,
--     date de l'avis, statut nouveau→repondu/ignore, texte de réponse rédigé à la main, auteur/horodatage).
--
-- ⚠️ CONNECTEUR EXTERNE (Google Business / Meta / Tripadvisor API) : AUCUNE API. Aucune synchronisation
--   automatique des avis tant que l'adaptateur (OAuth + rafraîchissement + anti-doublon) n'est pas branché
--   ET testé : PRÊT À CONNECTER — NON ACTIVÉ. Ici, avis SAISIS uniquement (staff-entry honnête). Aucune
--   réponse n'est publiée par la base (loi Evin : aucun texte injecté) ; `response` est le brouillon/texte
--   HUMAIN, `status='repondu'` n'est posé que par un geste humain via l'app.
--
-- PII : `author` = nom d'affichage public de l'avis ; e-réputation du complexe = donnée direction.
-- Lecture ET écriture réservées à la direction (admin/manager), fail-closed via current_staff_role().
-- Aucun accès staff-op / promoteur.
--
-- RLS fail-closed. Grants DML `authenticated` explicites (la RLS filtre). ⚠️ Supabase RÉ-ACCORDE anon
-- sur toute table neuve via DEFAULT PRIVILEGES → `revoke all ... from anon` OBLIGATOIRE (invariant 0009/
-- 0053 : anon = zéro grant de table). Additif / idempotent. Réversible.

begin;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'autre' check (source in ('google','meta','tripadvisor','autre')),
  -- Note en étoiles 1..5. NULL autorisé : certaines plateformes n'en fournissent pas (ex. recommandation
  -- binaire Meta) — jamais une note fabriquée pour combler l'absence.
  rating integer check (rating is null or (rating between 1 and 5)),
  author text not null,
  body text,
  review_date date,
  -- Pipeline de réponse. `repondu` n'est JAMAIS automatique : posé par un humain via l'app.
  status text not null default 'nouveau' check (status in ('nouveau','repondu','ignore')),
  -- Réponse HUMAINE rédigée à la main (brouillon ou texte publié sur la plateforme). Jamais injectée
  -- par l'outil (loi Evin : aucune mention d'alcool ajoutée automatiquement).
  response text,
  created_by text,                               -- username du staff saisisseur (facultatif)
  created_at timestamptz not null default now()
);

create index if not exists reviews_source_idx on public.reviews (source);
create index if not exists reviews_status_idx on public.reviews (status);
create index if not exists reviews_review_date_idx on public.reviews (review_date desc);
create index if not exists reviews_created_idx on public.reviews (created_at desc);

-- DML pour les sessions authentifiées ; la RLS ci-dessous cantonne réellement l'accès.
grant select, insert, update, delete on public.reviews to authenticated;

-- ⚠️ CRITIQUE : Supabase ré-accorde anon par DEFAULT PRIVILEGES sur toute table neuve. On révoque
-- explicitement (invariant : anon ne possède AUCUN grant de table dans public — cf. 0009 / 0053).
revoke all on public.reviews from anon;

alter table public.reviews enable row level security;

-- Lecture : direction (admin/manager) fail-closed (e-réputation + nom d'auteur = données direction/com).
drop policy if exists reviews_select_direction on public.reviews;
create policy reviews_select_direction on public.reviews
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager']));

-- Écriture (saisie / réponse humaine / changement de statut) : direction (admin/manager) fail-closed.
drop policy if exists reviews_write_direction on public.reviews;
create policy reviews_write_direction on public.reviews
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
