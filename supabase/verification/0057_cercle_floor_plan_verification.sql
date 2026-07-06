-- 0057_cercle_floor_plan_verification.sql
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Transaction ROLLBACK (aucune écriture ne persiste) ; chaque invariant = raise exception.
--
-- Prouve, APRÈS 0057 (PLAN DE SALLE DU CERCLE), sur PostgreSQL réel et en LECTURE :
--   A. l'univers « cercle » existe (venues) et a bien un layout (venue_tables) ;
--   B. le Cercle a 14 tables — un compte DISTINCT du Terminus (18) et de l'Éden (44) ;
--   C. la composition propre au Cercle : 8 canapés VIP + 4 hautes debout + 2 modulables, AUCUNE
--      olivier (donc distincte de la typologie Éden qui, elle, a des oliviers) ;
--   D. l'invariant structurel DEBOUT ⟺ capacité NULL (comme l'Éden) et capacités > 0 sinon NULL ;
--   E. toutes les positions du Cercle dans les bornes [0,100] et labels uniques ;
--   F. NON-RÉGRESSION : l'Éden garde ses 44 lignes (aucune ligne d'un autre univers modifiée/ajoutée
--      par cette migration ; le seed 0057 ne cible que venue='cercle').

begin;

-- ------------------------------------------------------------
-- A. Univers déclaré + layout présent.
-- ------------------------------------------------------------
do $$
declare v_n int;
begin
  if not exists (select 1 from public.venues where id = 'cercle') then
    raise exception 'A: ligne venues(cercle) absente';
  end if;

  select count(*) into v_n from public.venue_tables where venue = 'cercle';
  if v_n = 0 then
    raise exception 'A: aucune table venue_tables pour le Cercle (plan resté vide)';
  end if;
end $$;

-- ------------------------------------------------------------
-- B. Compte DISTINCT (14 ≠ 18 Terminus ≠ 44 Éden).
-- ------------------------------------------------------------
do $$
declare n_cercle int;
begin
  select count(*) into n_cercle from public.venue_tables where venue = 'cercle';
  if n_cercle <> 14 then
    raise exception 'B: ATTENDU 14 tables Cercle, OBTENU %', n_cercle;
  end if;
  if n_cercle in (18, 44) then
    raise exception 'B: compte Cercle (%) non distinct de Terminus(18)/Éden(44)', n_cercle;
  end if;
end $$;

-- ------------------------------------------------------------
-- C. Composition propre : 8 canapés + 4 hautes + 2 modulables, 0 olivier.
-- ------------------------------------------------------------
do $$
declare
  n_canape    int;
  n_haute     int;
  n_modulable int;
  n_olivier   int;
  n_total     int;
begin
  select count(*) into n_total from public.venue_tables where venue = 'cercle';

  select count(*) into n_canape from public.venue_tables
   where venue = 'cercle' and kind = 'canape' and shape = 'square' and not standing and capacity = 6;
  if n_canape <> 8 then raise exception 'C: ATTENDU 8 canapés VIP (carrés, cap 6), OBTENU %', n_canape; end if;

  select count(*) into n_haute from public.venue_tables
   where venue = 'cercle' and kind = 'haute' and standing and capacity is null;
  if n_haute <> 4 then raise exception 'C: ATTENDU 4 tables hautes debout (cap NULL), OBTENU %', n_haute; end if;

  select count(*) into n_modulable from public.venue_tables
   where venue = 'cercle' and kind = 'modulable' and not standing and capacity = 2;
  if n_modulable <> 2 then raise exception 'C: ATTENDU 2 alcôves modulables (cap 2), OBTENU %', n_modulable; end if;

  select count(*) into n_olivier from public.venue_tables
   where venue = 'cercle' and kind = 'olivier';
  if n_olivier <> 0 then raise exception 'C: le Cercle ne doit PAS avoir d''olivier (%), typologie non distincte', n_olivier; end if;

  if (n_canape + n_haute + n_modulable) <> n_total then
    raise exception 'C: INCOHÉRENCE kinds (%,%,%) ne totalisent pas % tables Cercle',
      n_canape, n_haute, n_modulable, n_total;
  end if;
end $$;

-- ------------------------------------------------------------
-- D. Invariant DEBOUT ⟺ capacité NULL + capacités valides (>0 sinon NULL, garanti aussi par le CHECK).
-- ------------------------------------------------------------
do $$
declare n_bad int;
begin
  select count(*) into n_bad from public.venue_tables
   where venue = 'cercle' and (standing <> (capacity is null));
  if n_bad <> 0 then
    raise exception 'D: % ligne(s) Cercle où standing != (capacity is null)', n_bad;
  end if;

  select count(*) into n_bad from public.venue_tables
   where venue = 'cercle' and capacity is not null and capacity <= 0;
  if n_bad <> 0 then
    raise exception 'D: % ligne(s) Cercle avec capacité <= 0', n_bad;
  end if;
end $$;

-- ------------------------------------------------------------
-- E. Positions dans le cadre [0,100] + labels uniques.
-- ------------------------------------------------------------
do $$
declare n_bad int; n_labels int; n_distinct int;
begin
  select count(*) into n_bad from public.venue_tables
   where venue = 'cercle' and (x_pct < 0 or x_pct > 100 or y_pct < 0 or y_pct > 100);
  if n_bad <> 0 then
    raise exception 'E: % table(s) Cercle hors cadre [0,100]', n_bad;
  end if;

  select count(*), count(distinct label) into n_labels, n_distinct
    from public.venue_tables where venue = 'cercle';
  if n_labels <> n_distinct then
    raise exception 'E: labels Cercle non uniques (% lignes, % labels distincts)', n_labels, n_distinct;
  end if;
end $$;

-- ------------------------------------------------------------
-- F. NON-RÉGRESSION — l'Éden garde ses 44 lignes (aucun autre univers touché par 0057).
-- ------------------------------------------------------------
do $$
declare n_eden int;
begin
  select count(*) into n_eden from public.venue_tables where venue = 'eden';
  if n_eden <> 44 then
    raise exception 'F: RÉGRESSION — Éden attendu 44 tables, OBTENU % (0057 aurait touché un autre univers)', n_eden;
  end if;
end $$;

select '0057 plan du Cercle (14 tables : 8 canapés VIP + 4 hautes debout + 2 modulables, 0 olivier ; distinct 18/44 ; invariant debout<=>cap NULL ; bornes OK ; Éden intact) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée modifiée)' as resultat;

rollback;
