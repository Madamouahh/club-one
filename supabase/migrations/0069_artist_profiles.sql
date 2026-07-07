-- 0069_artist_profiles.sql — FICHE ARTISTE RÉUTILISABLE (Vague 7, gap C5 = « pas de création de fiche »).
--
-- CONSTAT (audit C5) : le module `artist_checkins` (0027) est un ACCUEIL PAR SOIRÉE (arrivée, loge,
-- balance, validation technique) — il fait AVANCER des jalons le soir même, mais il NE CRÉE PAS de fiche
-- artiste réutilisable. Aucune table ne porte le référentiel d'un artiste (coordonnées, style, cachet,
-- contraintes techniques, notes, historique des soirées). Ce squad livre ce référentiel manquant.
--
-- MODÈLE (source de vérité UNIQUE de l'artiste, indépendante d'une soirée) :
--   · `artists`             : identité de scène + identité légale, coordonnées, style, cachet (fee_cents),
--                             contraintes techniques, notes, statut de cycle de vie (active/archived).
--   · `artist_event_links`  : rattachement N-N artiste ↔ soirée (events) = l'HISTORIQUE des soirées d'un
--                             artiste + cachet éventuellement négocié pour CETTE soirée (fee_cents_override).
--
-- HONNÊTETÉ : rien n'est fabriqué. Un artiste sans cachet connu a fee_cents NULL (« à confirmer »),
-- jamais un 0 inventé. L'archivage NE SUPPRIME PAS : status='archived' conserve la fiche + son historique.
--
-- SÉCURITÉ (règle 20 + matrice §50 : la fiche artiste est un objet de DIRECTION) :
--   · RLS fail-closed. Seuls admin/manager lisent et écrivent (création, modification, archivage, liens).
--   · server/security/security_counter/promoter : AUCUN accès (ni lecture ni écriture).
--   · aucun accès anon (revoke explicite : neutralise les DEFAULT PRIVILEGES Supabase — invariant 0053).
--   · patron « table + RLS + DML direct authenticated » éprouvé (0055 tasks) : pas de RPC DEFINER — la RLS
--     EST l'autorité ; lib/artists.ts n'est qu'un miroir de validation côté UI, jamais une sécurité.
--
-- Additif / idempotent (create if not exists, repolicy). Réversible (drop policy/table).

begin;

-- ============================================================
-- artists — référentiel d'un artiste (indépendant d'une soirée).
-- ============================================================
create table if not exists public.artists (
  id                uuid primary key default gen_random_uuid(),
  stage_name        text not null,                    -- nom de scène (obligatoire)
  legal_name        text,                             -- identité légale (facultative)
  email             text,                             -- coordonnée e-mail (facultative)
  phone             text,                             -- coordonnée téléphone (facultative)
  style             text,                             -- style / genre musical (facultatif)
  fee_cents         integer check (fee_cents is null or fee_cents >= 0),  -- cachet EN CENTIMES (null = à confirmer)
  tech_requirements text,                             -- contraintes techniques (rider, matériel, balance)
  notes             text,                             -- notes internes direction
  status            text not null default 'active'
    check (status in ('active','archived')),          -- cycle de vie : active | archivée (jamais supprimée)
  created_by        text,                             -- username direction auteur
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists artists_status_idx on public.artists (status);
create index if not exists artists_stage_name_idx on public.artists (lower(stage_name));

-- ============================================================
-- artist_event_links — rattachement artiste ↔ soirée = historique + cachet négocié pour CETTE soirée.
-- ============================================================
create table if not exists public.artist_event_links (
  id               uuid primary key default gen_random_uuid(),
  artist_id        uuid not null references public.artists(id) on delete cascade,
  event_id         uuid not null references public.events(id) on delete cascade,
  slot_label       text,                              -- créneau (facultatif) : « 23h-01h », « warm-up »…
  fee_cents_override integer check (fee_cents_override is null or fee_cents_override >= 0), -- cachet spécifique à la soirée
  created_by       text,
  created_at       timestamptz not null default now(),
  unique (artist_id, event_id)                        -- un artiste rattaché UNE fois par soirée
);

create index if not exists ael_artist_idx on public.artist_event_links (artist_id);
create index if not exists ael_event_idx on public.artist_event_links (event_id);

-- ============================================================
-- Grants + neutralisation anon (invariant 0053) + RLS.
-- ============================================================
grant select, insert, update, delete on public.artists to authenticated;
grant select, insert, update, delete on public.artist_event_links to authenticated;
revoke all on public.artists from anon;
revoke all on public.artist_event_links from anon;

alter table public.artists enable row level security;
alter table public.artist_event_links enable row level security;

-- Direction (admin/manager) : accès complet aux fiches artistes.
drop policy if exists artists_all_direction on public.artists;
create policy artists_all_direction on public.artists
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

-- Direction (admin/manager) : accès complet aux rattachements artiste↔soirée.
drop policy if exists ael_all_direction on public.artist_event_links;
create policy ael_all_direction on public.artist_event_links
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
