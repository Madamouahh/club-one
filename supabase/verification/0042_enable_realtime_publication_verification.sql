-- 0042_enable_realtime_publication_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0042 — activation Realtime des 4 tables live.
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) les 4 tables auxquelles le front s'abonne (club_tables, entry_logs, promoter_contacts,
--       promoter_guest_entries) sont MEMBRES de la publication `supabase_realtime` ;
--   (B) NON-VACUITÉ / minimisation : aucune table PII HORS-périmètre n'a été publiée par erreur
--       (guests, staff_users, staff_members ne sont PAS dans supabase_realtime) ;
--   (C) idempotence structurelle : chacune des 4 n'apparaît qu'UNE fois (pas de double-ajout).
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- Lecture de catalogue uniquement (aucune écriture) → le rollback final est une simple hygiène.

begin;

do $$
declare
  v_expected text[] := array['club_tables','entry_logs','promoter_contacts','promoter_guest_entries'];
  v_forbidden text[] := array['guests','staff_users','staff_members'];
  v_table text;
  v_cnt int;
begin
  -- (A) chaque table attendue est publiée exactement une fois.
  foreach v_table in array v_expected loop
    select count(*) into v_cnt
    from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename=v_table;
    if v_cnt = 0 then
      raise exception 'A.% ABSENTE de supabase_realtime (le front s''abonne mais rien n''est publié)', v_table;
    end if;
    -- (C) pas de double-ajout.
    if v_cnt <> 1 then
      raise exception 'C.% publiée % fois (attendu 1)', v_table, v_cnt;
    end if;
  end loop;

  -- (B) aucune table PII hors-périmètre n'a été publiée.
  foreach v_table in array v_forbidden loop
    if exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
    ) then
      raise exception 'B.% PUBLIÉE en Realtime (hors-périmètre — minimisation violée)', v_table;
    end if;
  end loop;
end $$;

select '0042 enable_realtime_publication (4 tables live publiées · aucune table PII hors-périmètre · pas de double-ajout) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
