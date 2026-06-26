-- 0000_inspect_schema.sql
-- À EXÉCUTER EN PREMIER (lecture seule). Ne modifie rien.
-- Objectif : confirmer le schéma réel AVANT d'appliquer les migrations,
-- car certaines colonnes (type de `staff_users.id`, contrainte unique sur
-- `username`, état RLS) ne sont pas vérifiables depuis le code.

-- 1) Colonnes de staff_users (vérifier le type de `id` et la présence de `password`)
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'staff_users'
order by ordinal_position;

-- 2) Contraintes (unique sur username ?)
select conname, contype, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.staff_users'::regclass;

-- 3) RLS activée ou non sur les tables sensibles ?
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relname in (
  'staff_users','club_tables','entry_logs',
  'promoter_contacts','promoter_guest_entries','event_archives'
)
order by relname;

-- 4) Politiques RLS existantes (probablement aucune)
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
