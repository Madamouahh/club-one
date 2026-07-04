-- 0035_carte_produit_actif_rpc.sql — RETRAIT / REMISE EN CARTE D'UN PRODUIT (colonne `actif`), tracé.
--
-- Complète la gestion de carte 0034 (demande fondateur 2026-07-03, SESSION_PROMPT §a0). 0034 a câblé
-- trois RPC de gestion — toggle `disponible` (rupture EN SOIRÉE), création, modification — mais AUCUNE
-- ne pilote la colonne `actif` (0010), pourtant explicitement DISTINCTE de `disponible` dans la demande
-- fondateur : « rendre un produit indisponible/redisponible … DISTINCT de actif=retiré de la carte ».
--
--   · `disponible=false` (0034) → rupture temporaire : le produit reste À LA CARTE, momentanément grisé ;
--   · `actif=false`      (ici)  → RETRAIT de la carte : le produit sort du catalogue proposé (référence
--                                  conservée pour l'historique — jamais de DELETE).
--
-- Sans cette RPC, le seul moyen de retirer un produit était l'`update` direct sur `produits_bar` (grant
-- 0010, borné admin/manager par RLS) — qui NE LAISSE AUCUNE TRACE d'audit. Ce fichier ajoute le chemin
-- serveur sanctionné qui applique la règle de rôle ET journalise le retrait/la remise (before/after).
--
-- Propriétés de sécurité (identiques à 0034, même helper) :
--   · SECURITY DEFINER + `set search_path = public` (règle 20) ; contrôle de rôle explicite réutilisé
--     via `assert_carte_manager()` (fail-closed 42501 hors admin/manager, y compris rôle NULL / anon) ;
--   · l'ACTEUR de l'audit n'est jamais fourni par le client : `log_audit_event` l'estampille depuis la
--     session (aucun paramètre d'acteur) ;
--   · GRANT EXECUTE limité à `authenticated` ; `anon` révoqué (jamais de gestion de carte publique).
--
-- Additif strict : `create or replace function`, une seule NOUVELLE fonction, aucune table/donnée/RPC
-- existante touchée, aucun seed, aucun DROP destructif. Idempotent (réexécutable). Le grant direct
-- insert/update de 0010 reste en place (ancien front intact) — le durcissement éventuel (forcer le
-- passage par les RPC auditées) resterait un cutover façon 0009, HORS PÉRIMÈTRE (documenté, non fait).

begin;

-- ============================================================
-- RETRAIT / REMISE EN CARTE — bascule de `actif`, tracée (before/after → réversibilité).
--   actif=false → retiré de la carte ; actif=true → remis en carte. Distinct du toggle `disponible`.
-- ============================================================
create or replace function public.set_produit_actif_v1(
  p_id uuid,
  p_actif boolean
) returns public.produits_bar
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.produits_bar;
  v_before boolean;
begin
  perform public.assert_carte_manager();

  if p_id is null then
    raise exception 'set_produit_actif_v1: id requis' using errcode = '22023';
  end if;
  if p_actif is null then
    raise exception 'set_produit_actif_v1: actif requis (true/false)' using errcode = '22023';
  end if;

  select * into v_row from public.produits_bar where id = p_id;
  if not found then
    raise exception 'set_produit_actif_v1: produit introuvable (%)', p_id using errcode = 'P0002';
  end if;
  v_before := v_row.actif;

  update public.produits_bar
     set actif = p_actif,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  perform public.log_audit_event(
    p_action        => 'carte.produit.actif',
    p_resource_type => 'produits_bar',
    p_resource_id   => p_id::text,
    p_summary       => v_row.nom || coalesce(' (' || v_row.format || ')', '') ||
                       case when p_actif then ' → REMIS EN CARTE' else ' → RETIRÉ DE LA CARTE' end,
    p_venue         => v_row.venue,
    p_before        => jsonb_build_object('actif', v_before),
    p_after         => jsonb_build_object('actif', v_row.actif)
  );

  return v_row;
end $$;

revoke all on function public.set_produit_actif_v1(uuid, boolean) from public;
grant execute on function public.set_produit_actif_v1(uuid, boolean) to authenticated;

commit;
