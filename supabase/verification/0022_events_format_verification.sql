-- 0022_events_format_verification.sql
-- Lecture seule. Postflight de 0022_events_format_learning.sql (colonne `format` sur events pour la
-- boucle d'apprentissage CRM). À lancer APRÈS l'application de 0022 sur une base non-production
-- (labo) ou, plus tard, en prod. Ne modifie RIEN.
--
-- Contexte : 0022 a été RÉELLEMENT appliquée puis ré-appliquée (idempotente) sur le labo
-- (docker supabase_db_club-one-lab) en session S23 — preuve niveau 4. La preuve runtime (UPDATE
-- d'une étiquette de test → relecture → ROLLBACK ; labo resté SANS étiquette, 0 format) est
-- consignée dans WORKLOG.md · S23.

-- 1) La colonne existe, est NULLABLE, de type text, SANS default (état honnête par défaut = NULL).
--    Attendu : data_type=text, is_nullable=YES, column_default=NULL.
select 'column_shape' as check_name,
       column_name,
       data_type,
       is_nullable,
       column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'events'
   and column_name = 'format';

-- 2) Le commentaire de documentation est présent (attendu : has_comment = true).
select 'column_comment' as check_name,
       col_description('public.events'::regclass,
         (select ordinal_position
            from information_schema.columns
           where table_schema = 'public' and table_name = 'events' and column_name = 'format')
       ) is not null as has_comment;

-- 3) La RLS d'events est INCHANGÉE : lecture staff (events_read/events_select_staff), écriture
--    admin/manager/promoter (events_write/events_insert_staff/events_update_staff), delete
--    admin/manager. 0022 n'ajoute AUCUNE policy — la colonne hérite de la RLS existante (0004).
select 'events_policies_unchanged' as check_name,
       policyname,
       cmd
  from pg_policies
 where schemaname = 'public'
   and tablename = 'events'
 order by policyname;

-- 4) Aucune ligne existante n'a été modifiée : toutes les soirées déjà en base ont format = NULL
--    tant que le fondateur n'a pas étiqueté (« sans étiquette, pas d'apprentissage »).
--    Attendu : with_format = 0 tant qu'aucune étiquette réelle n'a été saisie.
select 'no_row_touched' as check_name,
       count(*)       as total_events,
       count(format)  as with_format
  from public.events;
