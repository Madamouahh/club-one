-- 0057_cercle_floor_plan_verification.sql
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction ROLLBACK (aucune écriture ne persiste) ; chaque invariant = raise exception.
--
-- CONTRAT CORRIGÉ (décision fondateur 2026-07-07) : 0057 ne seed AUCUN plan de salle officiel du
-- Cercle. Le plan « 14 tables » proposé n'est PAS validé fondateur (conçu sans plan réel) et a été
-- déplacé, marqué PROVISOIRE, en fixture hors chaîne (supabase/fixtures/). 0057 ne garantit QUE le
-- SUPPORT TECHNIQUE multi-espace. Cette vérification prouve, sur PostgreSQL réel et en LECTURE :
--   A. l'univers « cercle » existe (venues) — support technique présent ;
--   B. AUCUNE table de plan officielle pour le Cercle (venue_tables(cercle) = 0) — plan non validé ;
--   C. NON-RÉGRESSION : l'Éden garde ses 44 lignes (0057 ne touche aucun autre univers).

begin;

-- ------------------------------------------------------------
-- A. Univers déclaré (support technique multi-espace).
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.venues where id = 'cercle') then
    raise exception 'A: ligne venues(cercle) absente (support multi-espace requis)';
  end if;
end $$;

-- ------------------------------------------------------------
-- B. AUCUN plan officiel — le Cercle n'a pas de tables (plan non validé fondateur).
-- ------------------------------------------------------------
do $$
declare n_cercle int;
begin
  select count(*) into n_cercle from public.venue_tables where venue = 'cercle';
  if n_cercle <> 0 then
    raise exception 'B: venue_tables(cercle) devrait être VIDE après 0057 seul (plan non validé), OBTENU %', n_cercle;
  end if;
end $$;

-- ------------------------------------------------------------
-- C. NON-RÉGRESSION — l'Éden garde ses 44 lignes (aucun autre univers touché par 0057).
-- ------------------------------------------------------------
do $$
declare n_eden int;
begin
  select count(*) into n_eden from public.venue_tables where venue = 'eden';
  if n_eden <> 44 then
    raise exception 'C: RÉGRESSION — Éden attendu 44 tables, OBTENU % (0057 aurait touché un autre univers)', n_eden;
  end if;
end $$;

select '0057 support technique cercle présent, AUCUN plan officiel seedé (plan provisoire hors chaîne, non validé fondateur), Éden intact — ASSERTIONS PASSENT (rollback, aucune donnée modifiée)' as resultat;

rollback;
