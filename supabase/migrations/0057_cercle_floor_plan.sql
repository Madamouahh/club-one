-- 0057_cercle_floor_plan.sql — PLAN DE SALLE DU CERCLE (layout propre à l'univers), seed idempotent.
--
-- Contexte (audit G5, HIGH) : parmi les 3 univers, seuls l'ÉDEN (44 tables, seed 0024 + typologie
-- 0031) et le TERMINUS (18 tables, plan legacy) ont un plan. LE CERCLE était DÉCLARÉ mais VIDE : la
-- ligne venues('cercle','Le Cercle','club_house') existe depuis 0004, mais AUCUNE table dans
-- venue_tables. Cette migration donne au Cercle son PROPRE modèle de salle — pas un clone graphique
-- du Terminus, mais un layout à son identité : club house INTIMISTE et HAUT DE GAMME (tagline 0004
-- « on n'y vient pas pour le nombre — pour l'ambiance »).
--
-- Parti pris — un CERCLE central (piste / DJ) ceinturé de VIP :
--   · 8 salons canapés VIP (6 pers, carrés) en ANNEAU autour du centre — le cœur du lieu ;
--   · 4 tables HAUTES debout aux quatre coins (mezzanine / abords du bar), sans capacité assise ;
--   · 2 ALCÔVES intimes (tables 2 pers modulables) sur les flancs.
-- → 14 tables : DISTINCT des 18 du Terminus et des 44 de l'Éden, composition propre (aucune olivier ;
--   centre de gravité sur le canapé VIP).
--
-- Additif strict, réversible : n'insère QUE des lignes venue='cercle' ; ne TOUCHE ni ne LIT aucune
-- ligne Éden/Terminus. Réutilise le schéma venue_tables tel qu'établi par 0024 (structure + CHECK) et
-- 0031 (colonne kind). Idempotent : ON CONFLICT (venue,label) DO NOTHING → re-jouer la migration ne
-- réécrit jamais une valeur éventuellement corrigée en direction (écran « éditer table »).
--
-- ⚠️ CAPACITÉS : jamais fabriquées à la louche. Elles découlent de la DÉFINITION du type d'assise
-- (canapé = 6 pers · modulable = 2 pers · haute = debout → capacity NULL PAR NATURE). Invariant
-- conservé comme l'Éden : DEBOUT ⟺ capacity NULL.
--
-- Repère : le Cercle n'a pas de screenshot source → positions définies DIRECTEMENT en POURCENTAGE
-- [0,100] (viewBox-agnostique). Valeurs literales identiques à lib/cercleFloorPlan.ts CERCLE_SEED
-- (source unique, croisée par tests/cercleFloorPlan.test.mts et la vérification SQL 0057).
--
-- RLS / grants : INCHANGÉS. venue_tables porte déjà sa RLS et ses policies (0024) — cette migration
-- n'ajoute que des DONNÉES de fond de plan, aucune structure ni droit.

begin;

-- ============================================================
-- 0) UNIVERS — garantir la ligne « cercle » (déjà posée en 0004 ; défensif et idempotent)
-- ============================================================
-- venues.id est la PK ; ON CONFLICT DO NOTHING → n'écrase jamais la ligne existante de 0004.
insert into public.venues (id, name, kind, tagline, sort_order) values
  ('cercle', 'Le Cercle', 'club_house', 'On n''y vient pas pour le nombre — pour l''ambiance.', 2)
on conflict (id) do nothing;

-- ============================================================
-- 1) SEED CERCLE — 14 tables (layout propre, positions en % déjà normalisées)
-- ============================================================
-- Les x_pct/y_pct sont DÉJÀ en pourcentage (le Cercle n'a pas de screenshot pixel comme l'Éden).
-- ON CONFLICT (venue,label) DO NOTHING : re-jouer ne réécrit pas une capacité corrigée en direction.
insert into public.venue_tables (venue, label, x_pct, y_pct, shape, standing, capacity, kind)
select 'cercle', s.label, s.x_pct, s.y_pct, s.shape, s.standing, s.capacity, s.kind
from (values
  -- Anneau central — 8 salons canapés VIP (6 pers), carrés (sens horaire autour du centre 50,50).
  ('S1', 80.000::numeric, 50.000::numeric, 'square', false, 6,    'canape'),
  ('S2', 71.213::numeric, 73.334::numeric, 'square', false, 6,    'canape'),
  ('S3', 50.000::numeric, 83.000::numeric, 'square', false, 6,    'canape'),
  ('S4', 28.787::numeric, 73.334::numeric, 'square', false, 6,    'canape'),
  ('S5', 20.000::numeric, 50.000::numeric, 'square', false, 6,    'canape'),
  ('S6', 28.787::numeric, 26.666::numeric, 'square', false, 6,    'canape'),
  ('S7', 50.000::numeric, 17.000::numeric, 'square', false, 6,    'canape'),
  ('S8', 71.213::numeric, 26.666::numeric, 'square', false, 6,    'canape'),
  -- Mezzanine — 4 tables hautes debout (groupe, capacité NULL par nature), aux quatre coins.
  ('H1',  9.000::numeric, 12.000::numeric, 'round',  true,  null, 'haute'),
  ('H2', 91.000::numeric, 12.000::numeric, 'round',  true,  null, 'haute'),
  ('H3',  9.000::numeric, 88.000::numeric, 'round',  true,  null, 'haute'),
  ('H4', 91.000::numeric, 88.000::numeric, 'round',  true,  null, 'haute'),
  -- Alcôves — 2 tables intimes 2 pers modulables, sur les flancs gauche/droit.
  ('A1',  6.000::numeric, 50.000::numeric, 'round',  false, 2,    'modulable'),
  ('A2', 94.000::numeric, 50.000::numeric, 'round',  false, 2,    'modulable')
) as s(label, x_pct, y_pct, shape, standing, capacity, kind)
on conflict (venue, label) do nothing;

commit;
