-- cercle_floor_plan_PROVISIONAL.sql
-- =====================================================================================
-- ⚠️⚠️⚠️  PROVISIONAL — NOT FOUNDER VALIDATED  ⚠️⚠️⚠️
-- =====================================================================================
-- Ce plan de salle « 14 tables » du Cercle est SPÉCULATIF : positions, capacités et types de tables
-- ont été inventés SANS plan réel du fondateur. Il N'EST PAS un plan officiel et NE DOIT JAMAIS être
-- présenté comme opérationnel ni appliqué à un environnement de production.
--
-- Usage AUTORISÉ : LABO / preview UNIQUEMENT, pour exercer le support technique multi-espace (rendu,
-- sélecteur d'espace, occupation) en attendant un plan réel. Ce fichier est HORS de la chaîne de
-- migration (dossier supabase/fixtures/, jamais chargé par migrate/db push).
--
-- Pour promouvoir un plan OFFICIEL : le fondateur fournit le plan réel → on crée une NOUVELLE migration
-- numérotée avec les valeurs validées → ce fichier est supprimé.
-- =====================================================================================

begin;

insert into public.venues (id, name, kind, tagline, sort_order) values
  ('cercle', 'Le Cercle', 'club_house', 'On n''y vient pas pour le nombre — pour l''ambiance.', 2)
on conflict (id) do nothing;

-- Layout PROVISOIRE (non validé) — un cercle central (piste/DJ) ceinturé de VIP.
insert into public.venue_tables (venue, label, x_pct, y_pct, shape, standing, capacity, kind)
select 'cercle', s.label, s.x_pct, s.y_pct, s.shape, s.standing, s.capacity, s.kind
from (values
  ('S1', 80.000::numeric, 50.000::numeric, 'square', false, 6,    'canape'),
  ('S2', 71.213::numeric, 73.334::numeric, 'square', false, 6,    'canape'),
  ('S3', 50.000::numeric, 83.000::numeric, 'square', false, 6,    'canape'),
  ('S4', 28.787::numeric, 73.334::numeric, 'square', false, 6,    'canape'),
  ('S5', 20.000::numeric, 50.000::numeric, 'square', false, 6,    'canape'),
  ('S6', 28.787::numeric, 26.666::numeric, 'square', false, 6,    'canape'),
  ('S7', 50.000::numeric, 17.000::numeric, 'square', false, 6,    'canape'),
  ('S8', 71.213::numeric, 26.666::numeric, 'square', false, 6,    'canape'),
  ('H1',  9.000::numeric, 12.000::numeric, 'round',  true,  null, 'haute'),
  ('H2', 91.000::numeric, 12.000::numeric, 'round',  true,  null, 'haute'),
  ('H3',  9.000::numeric, 88.000::numeric, 'round',  true,  null, 'haute'),
  ('H4', 91.000::numeric, 88.000::numeric, 'round',  true,  null, 'haute'),
  ('A1',  6.000::numeric, 50.000::numeric, 'round',  false, 2,    'modulable'),
  ('A2', 94.000::numeric, 50.000::numeric, 'round',  false, 2,    'modulable')
) as s(label, x_pct, y_pct, shape, standing, capacity, kind)
on conflict (venue, label) do nothing;

commit;
