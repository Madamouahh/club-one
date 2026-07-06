-- 0057_cercle_floor_plan.sql — SUPPORT TECHNIQUE MULTI-ESPACE DU CERCLE (aucun plan officiel).
--
-- ⚠️ DÉCISION FONDATEUR (2026-07-07) : le plan de salle « 14 tables » précédemment proposé pour Le
-- Cercle N'EST PAS validé par le fondateur et a été conçu SANS plan réel (positions/capacités/types
-- spéculatifs). Il NE DOIT PAS être seedé comme donnée métier officielle.
--
-- Cette migration ne fait donc QUE garantir le SUPPORT TECHNIQUE multi-espace (la ligne d'univers
-- `cercle` existe et venue_tables sait accueillir des tables `venue='cercle'`), et n'insère
-- AUCUNE table de plan. Le layout spéculatif est déplacé, clairement marqué PROVISOIRE / NON VALIDÉ
-- FONDATEUR, dans `supabase/fixtures/cercle_floor_plan_PROVISIONAL.sql` (fixture LAB/preview UNIQUEMENT,
-- hors chaîne de migration). Il ne sera promu en plan officiel qu'après remise d'un plan réel par le
-- fondateur (positions/capacités/types exacts).
--
-- Additif strict, idempotent, réversible. Ne touche ni ne lit aucune ligne Éden/Terminus. RLS/grants
-- de venue_tables INCHANGÉS (posés en 0024).

begin;

-- ============================================================
-- SUPPORT TECHNIQUE — garantir l'univers « cercle » (déjà posé en 0004 ; défensif/idempotent).
-- ============================================================
-- venues.id est la PK ; ON CONFLICT DO NOTHING → n'écrase jamais la ligne existante de 0004.
-- venue_tables (0024) accepte déjà venue='cercle' via son CHECK — aucune structure à ajouter.
insert into public.venues (id, name, kind, tagline, sort_order) values
  ('cercle', 'Le Cercle', 'club_house', 'On n''y vient pas pour le nombre — pour l''ambiance.', 2)
on conflict (id) do nothing;

-- ============================================================
-- AUCUN SEED DE PLAN OFFICIEL — volontaire.
-- ============================================================
-- Le Cercle reste sans plan de salle officiel tant que le fondateur n'a pas fourni un plan réel.
-- Voir supabase/fixtures/cercle_floor_plan_PROVISIONAL.sql (NON validé, LAB/preview seulement).

commit;
