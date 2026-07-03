-- 0031_eden_plan_v2_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0031 — PLAN EDEN V2 (colonne kind + types/
-- capacités réels des 44 tables, corrections fondateur 2026-07-03 soir).
--
-- Comble un TROU de la convention du dépôt (0009→0030 ont chacune leur vérification ; 0031/0032 non).
-- Prouve, sur PostgreSQL réel et en LECTURE (transaction annulée — aucune écriture ne persiste) :
--   · le SCHÉMA additif (colonne kind + check kind in (canape,olivier,modulable,haute)) ;
--   · la TYPOLOGIE fondateur des 44 tables Eden :
--       – 100-105 = 6 canapés (assis, capacité 6) ;
--       – 200-205 = 6 tables oliviers (assis, capacité 6) ;
--       – 106/107/400-406/500 = 10 tables hautes DEBOUT (groupe, capacité NULL par NATURE) ;
--       – le reste = 22 tables 2 pers modulables (assis, capacité 2) ;
--   · l'invariant structurel : DEBOUT ⟺ capacité NULL (aucune table haute chiffrée, aucune table
--     assise sans capacité).
--
-- ⚠️ SUPERSEDE 0024_venue_tables_verification (§1) : ce fichier-là asserte « 18 capacités connues »,
--    l'état APRÈS 0024 SEUL. 0031 remplit les capacités (canapés/oliviers/modulables) → 34 connues,
--    10 NULL (les debout). Sur un labo à 0031+, l'assertion 18 de 0024 est OBSOLÈTE par conception :
--    0024 décrit l'état post-0024, ce fichier décrit l'état post-0031. NE PAS relancer 0024 §1 sur un
--    labo 0031+ (à trancher côté fondateur : conserver 0024 comme preuve historique vs l'amender).
--
-- Miroir code (niveau 3, autonome) : tests/venueTables.test.mts croise EDEN_SEED_V2 (lib) et le
-- monolithe. Ce fichier-ci prouve les LIGNES RÉELLES en base (niveau 4).

begin;

-- ------------------------------------------------------------
-- 1) SCHÉMA — colonne kind + check.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'venue_tables' and column_name = 'kind'
  ) then raise exception 'ATTENDU colonne venue_tables.kind absente'; end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.venue_tables'::regclass and conname = 'venue_tables_kind_check'
  ) then raise exception 'ATTENDU contrainte venue_tables_kind_check absente'; end if;
end $$;

-- check kind MORD : un kind inconnu est refusé (testé puis rollback implicite du sous-bloc).
do $$
begin
  update public.venue_tables set kind = 'trone' where venue = 'eden' and label = '700';
  raise exception 'FAILLE: kind « trone » accepté (attendu: check venue_tables_kind_check)';
exception
  when check_violation then null; -- comportement attendu
end $$;

-- ------------------------------------------------------------
-- 2) TYPOLOGIE — comptes, capacités et labels par kind.
-- ------------------------------------------------------------
do $$
declare
  n_total     int;
  n_canape    int;
  n_olivier   int;
  n_haute     int;
  n_modulable int;
begin
  select count(*) into n_total from public.venue_tables where venue = 'eden';
  if n_total <> 44 then raise exception 'ATTENDU 44 tables Eden, OBTENU %', n_total; end if;

  -- Canapés : 100-105, assis, capacité 6.
  select count(*) into n_canape from public.venue_tables
   where venue = 'eden' and kind = 'canape' and not standing and capacity = 6
     and label in ('100','101','102','103','104','105');
  if n_canape <> 6 then raise exception 'ATTENDU 6 canapés (100-105, assis, cap 6), OBTENU %', n_canape; end if;

  -- Oliviers : 200-205, assis, capacité 6.
  select count(*) into n_olivier from public.venue_tables
   where venue = 'eden' and kind = 'olivier' and not standing and capacity = 6
     and label in ('200','201','202','203','204','205');
  if n_olivier <> 6 then raise exception 'ATTENDU 6 oliviers (200-205, assis, cap 6), OBTENU %', n_olivier; end if;

  -- Hautes debout : 106,107,400-406,500, standing, capacité NULL.
  select count(*) into n_haute from public.venue_tables
   where venue = 'eden' and kind = 'haute' and standing and capacity is null
     and label in ('106','107','400','401','402','403','404','405','406','500');
  if n_haute <> 10 then raise exception 'ATTENDU 10 tables hautes debout (cap NULL), OBTENU %', n_haute; end if;

  -- Modulables : le reste (22), assis, capacité 2.
  select count(*) into n_modulable from public.venue_tables
   where venue = 'eden' and kind = 'modulable' and not standing and capacity = 2;
  if n_modulable <> 22 then raise exception 'ATTENDU 22 modulables (assis, cap 2), OBTENU %', n_modulable; end if;

  -- Somme exacte : aucun kind hors nomenclature, aucune table Eden sans kind.
  if (n_canape + n_olivier + n_haute + n_modulable) <> n_total then
    raise exception 'INCOHÉRENCE: kinds (%,%,%,%) ne totalisent pas % tables Eden',
      n_canape, n_olivier, n_haute, n_modulable, n_total;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3) INVARIANT STRUCTUREL — DEBOUT ⟺ capacité NULL.
-- ------------------------------------------------------------
do $$
declare n_bad int;
begin
  select count(*) into n_bad from public.venue_tables
   where venue = 'eden' and (standing <> (capacity is null));
  if n_bad <> 0 then
    raise exception 'INCOHÉRENCE DEBOUT/capacité: % lignes où standing != (capacity is null)', n_bad;
  end if;
end $$;

select '0031 plan Eden V2 (kind + typologie 6 canapés / 6 oliviers / 10 hautes debout / 22 modulables + invariant debout<=>cap NULL) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée modifiée)' as resultat;

rollback;
