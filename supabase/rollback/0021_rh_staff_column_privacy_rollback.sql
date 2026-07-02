-- ROLLBACK 0021_rh_staff_column_privacy.sql — retour à l'état ANTÉRIEUR (0011).
--
-- ⚠️ AVERTISSEMENT DE SÉCURITÉ : ce rollback RÉ-OUVRE le gap colonne-level confirmé en S20 —
-- un salarié pourra de nouveau lire taux_horaire + notes_direction de SA fiche en requête directe.
-- À n'utiliser qu'en mesure d'urgence si la 0021 casse un chemin direction, et à re-fermer aussitôt.
--
-- Restaure le grant SELECT table-wide de la 0011 et supprime la RPC direction.
-- Idempotent.

begin;

-- 1) Restaurer le SELECT table-wide (état 0011:66). Retire d'abord les grants colonne posés par 0021
--    (sinon ils coexistent sans nuire, mais on repart propre).
revoke select on public.staff_members from authenticated;
grant select, insert, update on public.staff_members to authenticated;

-- 2) Supprimer la RPC direction introduite par 0021.
drop function if exists public.list_staff_members_v1();

commit;

-- NB : après ce rollback, le client (app/page.tsx fetchStaffMembers) appelant list_staff_members_v1()
-- recevra une erreur "function does not exist" et retombera sur un tableau vide (état dégradé mais
-- non fuyant côté direction). Reverter aussi le changement client si le rollback doit être durable.
