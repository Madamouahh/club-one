-- 0021_rh_staff_column_privacy.sql — RH / Planning (B7) : fermeture du gap COLONNE-LEVEL de la 0011.
--
-- Contexte (constat prod-bloquant confirmé au niveau 4 en S20) : la 0011 protège staff_members par une
-- RLS ROW-LEVEL (staff_members_read : direction OU username = current_staff_username()). Or direction et
-- salarié partagent le MÊME rôle DB `authenticated`, et les grants de colonne ne distinguent pas ces deux
-- profils. Conséquence : un salarié pouvait lire `taux_horaire` (PII paie) et `notes_direction` (réservé
-- direction) de SA propre fiche par une REQUÊTE DIRECTE (clé anon + son JWT) — la RLS l'autorise, elle ne
-- borne que les LIGNES, pas les COLONNES. Le correctif client de S20 (fetchMyStaffMember en colonnes
-- explicites) retire la fuite du chemin UI mais NE ferme PAS la requête directe.
--
-- Fix durable :
--   1) RÉVOQUER le SELECT COLONNE de `taux_horaire` et `notes_direction` pour le rôle `authenticated` :
--      plus aucun compte staff (direction incluse) ne peut lire ces 2 colonnes en accès table direct.
--   2) EXPOSER la vue DIRECTION (répertoire complet, taux + notes) via une RPC SECURITY DEFINER gardée
--      `admin`/`manager`. La distinction direction/salarié — impossible au niveau des grants colonne
--      (même rôle DB) — est portée par la RPC via current_staff_role(), modèle 0020.
--
-- Additif strict, non destructif :
--   · aucune table, colonne, contrainte ni policy existante n'est supprimée ou modifiée ;
--   · l'INSERT direction (app : .insert() sans .select() → PostgREST return=minimal, aucun RETURNING sur
--     ces colonnes) reste fonctionnel ; l'UPDATE direction (grant update table-level conservé) aussi ;
--   · la vue SALARIÉ (fetchMyStaffMember) sélectionne déjà des colonnes explicites SANS taux/notes → OK ;
--   · la vue DIRECTION (fetchStaffMembers) passe de .select("*") à la RPC list_staff_members_v1().
--
-- RGPD / droit du travail : le taux horaire et les notes de direction sont des données RH sensibles ;
-- leur accès est désormais borné à la direction au niveau du MOTEUR (défense en profondeur), plus
-- seulement au niveau de l'UI.

begin;

-- ============================================================
-- 1) Restriction COLONNE-LEVEL du SELECT pour le rôle partagé `authenticated`.
--    ⚠️ PIÈGE PostgreSQL (vérifié au niveau 4 sur le labo) : la 0011 a fait
--    `grant select on staff_members to authenticated`, soit un privilège SELECT *table-wide*.
--    Un `revoke select (taux_horaire, notes_direction) ...` sur un rôle qui détient le SELECT
--    table-wide est un NO-OP : le privilège effectif reste plein (has_column_privilege = true).
--    La seule méthode correcte pour restreindre au niveau colonne est donc :
--      (a) révoquer le SELECT table-wide, puis
--      (b) re-granter le SELECT UNIQUEMENT sur les colonnes non sensibles.
--    On NE touche PAS aux grants INSERT/UPDATE (write direction). La RLS row-level (0011) continue
--    de borner les LIGNES (direction = tout, salarié = sa ligne) ; ce bloc borne les COLONNES.
--    Idempotent : revoke table-wide répété = no-op ; grant colonnes répété = no-op.
-- ============================================================
revoke select on public.staff_members from authenticated;
grant select (
  id, username, full_name, poste, contrat_type, actif, created_at, updated_at
) on public.staff_members to authenticated;

-- ============================================================
-- 2) RPC vue DIRECTION — répertoire COMPLET (incluant taux_horaire + notes_direction), admin/manager seuls.
--    SECURITY DEFINER : le corps s'exécute avec les privilèges du propriétaire (qui garde le SELECT
--    colonne), ce qui rétablit la lecture des 2 colonnes UNIQUEMENT à travers cette porte gardée.
--    La garde de rôle est explicite (raise exception) — ce n'est jamais l'UI qui protège.
-- ============================================================
create or replace function public.list_staff_members_v1()
returns setof public.staff_members
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Garde FAIL-CLOSED (modèle 0020). ⚠️ current_staff_role() renvoie NULL pour un compte
  -- `authenticated` sans mapping staff_users (auth non rattachée, signup non lié). Un test naïf
  -- `if role not in ('admin','manager')` s'évaluerait à NULL → le raise NE s'exécuterait PAS →
  -- la fonction SECURITY DEFINER (propriétaire, bypass RLS) fuiterait TOUT le répertoire (taux +
  -- notes) à ce compte non mappé. On refuse donc explicitement uid null ET rôle null via coalesce.
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(public.current_staff_role(), '') not in ('admin','manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- On ne fabrique aucune ligne : la fonction renvoie l'état réel de la table (VIDE tant que le
  -- fondateur n'a pas fourni la liste du personnel).
  return query
    select *
    from public.staff_members
    order by actif desc, full_name asc;
end;
$$;

-- Surface d'exécution : comptes staff authentifiés uniquement (jamais anon). La garde de rôle interne
-- limite l'usage réel à admin/manager ; le grant `authenticated` n'ouvre aucun accès transversal.
revoke all on function public.list_staff_members_v1() from public;
grant execute on function public.list_staff_members_v1() to authenticated;

commit;
