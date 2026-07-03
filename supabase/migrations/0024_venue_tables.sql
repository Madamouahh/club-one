-- 0024_venue_tables.sql — PLAN DE SALLE (layout des tables par univers), STRUCTURE + seed EDEN.
--
-- Demande fondateur (2026-07-03, spec PLAN_SALLE_EDEN_RESA_INTERACTIVE.md) : créer le 2ᵉ plan de
-- salle — l'EDEN — sur le modèle de la version Terminus existante. Ce fichier pose la table de
-- référence du LAYOUT (positions/formes/capacités des tables) et seede les 44 tables de l'Eden
-- transcrites du screenshot OctoTable fourni par le fondateur.
--
-- Additif strict : ne touche à AUCUNE table existante (ni club_tables ni les univers).
-- venue_tables est une donnée de LAYOUT (aucune PII, aucun montant) : c'est le fond de plan, pas
-- l'état d'occupation d'une soirée (celui-ci reste dans club_tables / le CRM).
--
-- ⚠️ CAPACITÉS : illisibles en partie sur le screenshot → capacity NULL = « À CONFIRMER » (source de
-- vérité = plan OctoTable). Le seed NE FABRIQUE AUCUNE capacité (règle dure : rien d'inventé). Un
-- écran direction « éditer table » (chunk ultérieur) comblera les NULL avec les vraies valeurs SANS
-- redéploiement ; le seed est idempotent (ON CONFLICT DO NOTHING) → il ne réécrit jamais une capacité
-- saisie par la direction.
--
-- Coordonnées : centres approximatifs en PIXELS sur le screenshot 952×506, normalisés en POURCENTAGE
-- (x/952·100, y/506·100). Les pixels bruts restent visibles dans le VALUES ci-dessous (source
-- auditable) ; PostgreSQL calcule le pourcentage → aucun arrondi fait à la main.
--
-- Tables hautes « debout » (sans chaise, groupes debout — liste EXACTE du fondateur) :
--   106, 107, 400, 401, 402, 403, 404, 405, 406, 500.
--
-- RLS : venue_tables est un fond de plan lisible par tout le STAFF connecté (assignation/consultation) ;
-- l'ÉDITION (capacité, actif, debout) est réservée à la direction (admin/manager). anon reste FERMÉ
-- ici — le flux de résa CLIENT (Phase A, chunk ultérieur) exposera le layout via un accès public SÛR
-- (RPC/policy dédiée aux seules tables actives) au moment où ce flux existera, pas avant.

begin;

-- ============================================================
-- 1) VENUE_TABLES — le layout de référence d'un univers
-- ============================================================
create table if not exists public.venue_tables (
  id uuid primary key default gen_random_uuid(),
  venue text not null check (venue in ('eden', 'terminus', 'cercle')),
  label text not null,
  x_pct numeric(6, 3) not null check (x_pct >= 0 and x_pct <= 100),
  y_pct numeric(6, 3) not null check (y_pct >= 0 and y_pct <= 100),
  shape text not null check (shape in ('round', 'square')),
  standing boolean not null default false,          -- table haute sans chaise (groupe debout)
  capacity integer check (capacity is null or capacity > 0),  -- NULL = à confirmer (jamais inventée)
  active boolean not null default true,             -- retirée du plan sans être supprimée
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue, label)
);

create index if not exists venue_tables_venue_idx on public.venue_tables(venue);

-- ============================================================
-- 2) SEED EDEN — 44 tables (transcription du screenshot, capacités NULL si non lisibles)
-- ============================================================
-- Les pixels bruts (px, py) sont la source ; le % est dérivé par PostgreSQL (ref 952×506).
-- ON CONFLICT DO NOTHING : re-jouer la migration ne réécrit pas une capacité déjà corrigée en direction.
insert into public.venue_tables (venue, label, x_pct, y_pct, shape, standing, capacity)
select
  'eden',
  s.label,
  round((s.px / 952.0) * 100, 3),
  round((s.py / 506.0) * 100, 3),
  s.shape,
  s.standing,
  s.cap
from (values
  ('704',  37, 142, 'round',  false, 2),
  ('703',  70, 135, 'round',  false, null),
  ('702', 112, 140, 'square', false, 2),
  ('701', 155, 140, 'round',  false, 2),
  ('700', 192, 143, 'round',  false, 2),
  ('405', 265, 143, 'round',  true,  null),
  ('406', 268, 180, 'round',  true,  null),
  ('404', 320, 157, 'round',  true,  null),
  ('403', 360, 157, 'round',  true,  null),
  ('402', 412, 158, 'round',  true,  4),
  ('401', 458, 157, 'round',  true,  4),
  ('400', 500, 157, 'round',  true,  4),
  ('606',  14, 228, 'round',  false, null),
  ('605',  62, 263, 'round',  false, null),
  ('604',  88, 260, 'round',  false, null),
  ('603', 117, 262, 'round',  false, null),
  ('602', 157, 265, 'round',  false, null),
  ('601', 185, 265, 'round',  false, null),
  ('600', 212, 268, 'round',  false, 2),
  ('505',  38, 355, 'round',  false, null),
  ('504',  65, 358, 'round',  false, null),
  ('503',  95, 355, 'round',  false, null),
  ('502', 118, 358, 'round',  false, null),
  ('501', 152, 355, 'round',  false, null),
  ('500', 205, 349, 'round',  true,  null),
  ('304', 268, 355, 'round',  false, null),
  ('303', 305, 352, 'round',  false, null),
  ('302', 342, 355, 'round',  false, null),
  ('301', 381, 357, 'round',  false, null),
  ('300', 430, 353, 'round',  false, null),
  ('205', 520, 297, 'round',  false, 6),
  ('203', 585, 297, 'round',  false, null),
  ('201', 635, 296, 'round',  false, null),
  ('204', 530, 345, 'round',  false, 5),
  ('202', 598, 345, 'round',  false, 6),
  ('200', 652, 343, 'round',  false, 6),
  ('107', 712, 283, 'round',  true,  4),
  ('106', 757, 285, 'round',  true,  null),
  ('100', 868, 218, 'square', false, 4),
  ('101', 868, 252, 'square', false, 6),
  ('102', 866, 285, 'square', false, 6),
  ('103', 866, 320, 'square', false, 6),
  ('104', 866, 355, 'square', false, 6),
  ('105', 822, 352, 'square', false, null)
) as s(label, px, py, shape, standing, cap)
on conflict (venue, label) do nothing;

-- ============================================================
-- 3) RLS — layout lisible par le staff ; édition réservée à la direction ; anon fermé
-- ============================================================
alter table public.venue_tables enable row level security;
revoke all on public.venue_tables from anon;
grant select on public.venue_tables to authenticated;
grant insert, update, delete on public.venue_tables to authenticated;

-- Lecture : tout le staff connecté voit le fond de plan (assignation, consultation, vue tables).
-- Aucune donnée sensible ici → pas de cantonnement par rôle sur la lecture du LAYOUT.
drop policy if exists venue_tables_read on public.venue_tables;
create policy venue_tables_read on public.venue_tables for select to authenticated
  using (true);

-- Édition (capacité réelle, actif/inactif, debout, ajout/retrait d'une table) : direction seule.
drop policy if exists venue_tables_insert on public.venue_tables;
create policy venue_tables_insert on public.venue_tables for insert to authenticated
  with check (public.current_staff_role() in ('admin', 'manager'));

drop policy if exists venue_tables_update on public.venue_tables;
create policy venue_tables_update on public.venue_tables for update to authenticated
  using (public.current_staff_role() in ('admin', 'manager'))
  with check (public.current_staff_role() in ('admin', 'manager'));

drop policy if exists venue_tables_delete on public.venue_tables;
create policy venue_tables_delete on public.venue_tables for delete to authenticated
  using (public.current_staff_role() in ('admin', 'manager'));

commit;
