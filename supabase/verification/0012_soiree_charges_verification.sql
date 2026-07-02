-- 0012_soiree_charges_verification.sql
-- Lecture seule. Postflight de 0012_soiree_charges_artistes.sql (2ᵉ charge du P&L : coûts artistes/extras).
-- À lancer APRÈS l'application de 0012 sur une base non-production (labo) ou, plus tard, en prod.
-- Ne modifie RIEN. Aucune donnée n'est écrite : les colonnes de résultat ci-dessous documentent
-- l'état ATTENDU (voir les commentaires « attendu : »).
--
-- Contexte : 0012 a été RÉELLEMENT appliquée puis ré-appliquée (idempotente) sur le labo
-- (docker supabase_db_club-one-lab) en session S22 — preuve niveau 4. La preuve adversariale
-- (INSERT/SELECT/UPDATE/DELETE par direction ok ; refus RLS pour un rôle non-direction ; anon
-- permission denied ; base restée VIDE après ROLLBACK) est consignée dans WORKLOG.md · S22.

-- 1) La table existe et RLS est activée (attendu : rls_enabled = true).
select 'table_and_rls' as check_name,
       c.relname       as table_name,
       c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = 'soiree_charges';

-- 2) Les 4 policies DIRECTION (une par commande). Attendu : SELECT/INSERT/UPDATE/DELETE, toutes
--    gardées current_staff_role() in ('admin','manager') → le budget de soirée n'est jamais
--    exposé aux autres rôles (server/security/promoter).
select 'direction_policies' as check_name,
       policyname,
       cmd,
       qual,
       with_check
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'soiree_charges'
 order by cmd, policyname;

-- 3) Grants applicatifs de la migration. Attendu : `authenticated` possède SELECT/INSERT/UPDATE/DELETE
--    (l'accès réel reste borné par la RLS direction ci-dessus) ; `anon` n'apparaît PAS (revoke all).
--    NB systémique (hors périmètre 0012) : la plateforme Supabase accorde aussi par défaut
--    TRUNCATE/TRIGGER/REFERENCES à `authenticated` sur TOUTE table de `public` (pg_default_acl) ;
--    non atteignable via PostgREST (aucun endpoint TRUNCATE) — condition pré-existante commune à
--    caisse_z / club_tables / guests / staff_members, à traiter au niveau schéma, pas dans 0012.
select 'app_grants' as check_name,
       grantee,
       string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name   = 'soiree_charges'
   and grantee in ('authenticated', 'anon')
 group by grantee
 order by grantee;

-- 4) Contrôle explicite anon = fermé. Attendu : 0 ligne (anon n'a aucun privilège sur la table).
select 'anon_closed' as check_name,
       count(*) as anon_privilege_count
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name   = 'soiree_charges'
   and grantee = 'anon';

-- 5) Contraintes CHECK métier (catégorie, statut, montant >= 0). Attendu : 3 CHECK présentes.
select 'check_constraints' as check_name,
       conname,
       pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.soiree_charges'::regclass
   and contype = 'c'
 order by conname;
