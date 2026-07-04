-- 0034_carte_management_rpc.sql — GESTION DE CARTE DANS LE BACK (demande fondateur 2026-07-03)
-- + PREMIER CÂBLAGE RÉEL du journal d'audit 0033 (log_audit_event) sur des mutations sensibles.
--
-- Contexte fondateur (SESSION_PROMPT §a0, « GESTION DE CARTE DANS LE BACK ») : écran direction/manager
-- MOBILE-FIRST pour gérer les produits —
--   (1) rendre un produit INDISPONIBLE / redisponible en 1 tap (rupture EN PLEINE SOIRÉE, toggle
--       immédiat, DISTINCT de `actif=false` = retiré de la carte) ;
--   (2) CRÉER un produit rapidement (nom, catégorie, format, prix, univers/venue) ;
--   (3) MODIFIER prix / catégorie (et nom / format) d'un produit.
-- RLS write = admin/manager uniquement (déjà l'intention des policies 0010) ; ce fichier ajoute le
-- point d'entrée SERVEUR sanctionné qui, en plus d'appliquer la règle, LAISSE UNE TRACE d'audit.
--
-- La colonne `disponible` (0032) porte le toggle rupture ; la colonne `actif` (0010) porte le retrait
-- de carte. Ce module agit sur `disponible`, `prix_vente`, `categorie`, `nom`, `format`, `venue` ;
-- il ne touche PAS aux données fondateur manquantes (prix_achat / stock / seuil_alerte restent NULL,
-- à fournir hors session).
--
-- ── POURQUOI DES RPC SECURITY DEFINER PLUTÔT QUE L'ÉCRITURE DIRECTE ? ────────────────────────────
-- 0010 accorde déjà `insert, update` sur produits_bar à `authenticated` (borné admin/manager par RLS).
-- Ce module N'ENLÈVE PAS ce grant (aucune régression de l'ancien front) : il AJOUTE un chemin propre
-- qui garantit la TRACE d'audit (before/after) — un `update` direct ne journalise rien. Le durcissement
-- éventuel (révoquer l'écriture directe pour forcer le passage par ces RPC) serait un cutover façon 0009,
-- HORS PÉRIMÈTRE de cette session (documenté ici, non fait).
--
-- Propriétés de sécurité :
--   · SECURITY DEFINER + `set search_path = public` (règle 20) ; owner = postgres → l'écriture interne
--     contourne la RLS de produits_bar, MAIS chaque fonction refait un contrôle de rôle explicite
--     (fail-closed 42501 hors admin/manager, y compris rôle NULL / anon).
--   · l'ACTEUR de l'audit n'est jamais fourni par le client : log_audit_event l'estampille depuis la
--     session (auth.uid() → current_staff_role/username), inchangé par le passage en SECURITY DEFINER
--     (le GUC request.jwt.claims n'est pas altéré par le changement de rôle).
--   · GRANT EXECUTE limité à `authenticated` ; `anon` révoqué (jamais de gestion de carte publique).
--
-- Additif strict : `create or replace function`, aucune table/donnée touchée, aucun seed, aucun DROP
-- destructif. Idempotent (réexécutable). Le module SHIP sans créer aucune ligne produit.

begin;

-- ============================================================
-- Helper interne (non exposé) — garde de rôle admin/manager, fail-closed.
-- ============================================================
create or replace function public.assert_carte_manager()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'gestion de carte réservée à admin/manager (rôle courant: %)', coalesce(v_role, 'aucun')
      using errcode = '42501';
  end if;
end $$;

revoke all on function public.assert_carte_manager() from public;
grant execute on function public.assert_carte_manager() to authenticated;

-- ============================================================
-- 1) TOGGLE DISPONIBILITÉ — rupture / retour en 1 tap (EN SOIRÉE), tracé.
-- ============================================================
create or replace function public.set_produit_disponibilite_v1(
  p_id uuid,
  p_disponible boolean
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
    raise exception 'set_produit_disponibilite_v1: id requis' using errcode = '22023';
  end if;
  if p_disponible is null then
    raise exception 'set_produit_disponibilite_v1: disponible requis (true/false)' using errcode = '22023';
  end if;

  select * into v_row from public.produits_bar where id = p_id;
  if not found then
    raise exception 'set_produit_disponibilite_v1: produit introuvable (%)', p_id using errcode = 'P0002';
  end if;
  v_before := v_row.disponible;

  update public.produits_bar
     set disponible = p_disponible,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  perform public.log_audit_event(
    p_action        => 'carte.produit.disponibilite',
    p_resource_type => 'produits_bar',
    p_resource_id   => p_id::text,
    p_summary       => v_row.nom || coalesce(' (' || v_row.format || ')', '') ||
                       case when p_disponible then ' → REDISPONIBLE' else ' → INDISPONIBLE (rupture)' end,
    p_venue         => v_row.venue,
    p_before        => jsonb_build_object('disponible', v_before),
    p_after         => jsonb_build_object('disponible', v_row.disponible)
  );

  return v_row;
end $$;

revoke all on function public.set_produit_disponibilite_v1(uuid, boolean) from public;
grant execute on function public.set_produit_disponibilite_v1(uuid, boolean) to authenticated;

-- ============================================================
-- 2) CRÉATION RAPIDE — nom / catégorie / format / prix / univers, tracé.
-- ============================================================
create or replace function public.create_produit_v1(
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_venue text,
  p_format text default null
) returns public.produits_bar
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.produits_bar;
  v_nom text := btrim(coalesce(p_nom, ''));
  v_cat text := btrim(coalesce(p_categorie, ''));
  v_fmt text := nullif(btrim(coalesce(p_format, '')), '');
begin
  perform public.assert_carte_manager();

  if v_nom = '' then
    raise exception 'create_produit_v1: nom requis' using errcode = '22023';
  end if;
  if v_cat = '' then
    raise exception 'create_produit_v1: catégorie requise' using errcode = '22023';
  end if;
  if p_prix_vente is null or p_prix_vente < 0 then
    raise exception 'create_produit_v1: prix_vente requis et >= 0' using errcode = '22023';
  end if;
  if p_venue is null or p_venue not in ('eden', 'terminus', 'commun') then
    raise exception 'create_produit_v1: venue invalide (eden/terminus/commun attendu, reçu %)', coalesce(p_venue, 'NULL')
      using errcode = '22023';
  end if;

  -- Unicité par univers : l'index (venue, nom, format) laisse passer les NULL distincts → contrôle
  -- explicite `is not distinct from` pour attraper aussi les doublons à format NULL.
  if exists (
    select 1 from public.produits_bar
     where venue = p_venue and nom = v_nom and format is not distinct from v_fmt
  ) then
    raise exception 'create_produit_v1: ce produit existe déjà pour cet univers (% / % / %)',
      p_venue, v_nom, coalesce(v_fmt, '—') using errcode = '23505';
  end if;

  insert into public.produits_bar (venue, categorie, nom, format, prix_vente)
  values (p_venue, v_cat, v_nom, v_fmt, p_prix_vente)
  returning * into v_row;

  perform public.log_audit_event(
    p_action        => 'carte.produit.create',
    p_resource_type => 'produits_bar',
    p_resource_id   => v_row.id::text,
    p_summary       => 'Création ' || v_row.nom || coalesce(' (' || v_row.format || ')', '') ||
                       ' — ' || v_row.venue || ' · ' || to_char(v_row.prix_vente, 'FM999990.00') || ' €',
    p_venue         => v_row.venue,
    p_after         => jsonb_build_object(
                         'nom', v_row.nom, 'categorie', v_row.categorie, 'format', v_row.format,
                         'prix_vente', v_row.prix_vente, 'venue', v_row.venue
                       )
  );

  return v_row;
end $$;

revoke all on function public.create_produit_v1(text, text, numeric, text, text) from public;
grant execute on function public.create_produit_v1(text, text, numeric, text, text) to authenticated;

-- ============================================================
-- 3) MODIFICATION — prix / catégorie / nom / format, before/after tracés.
--    Remplacement complet des champs éditables (le formulaire mobile renvoie les 4 valeurs).
-- ============================================================
create or replace function public.update_produit_v1(
  p_id uuid,
  p_nom text,
  p_categorie text,
  p_prix_vente numeric,
  p_format text default null
) returns public.produits_bar
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.produits_bar;
  v_before jsonb;
  v_nom text := btrim(coalesce(p_nom, ''));
  v_cat text := btrim(coalesce(p_categorie, ''));
  v_fmt text := nullif(btrim(coalesce(p_format, '')), '');
begin
  perform public.assert_carte_manager();

  if p_id is null then
    raise exception 'update_produit_v1: id requis' using errcode = '22023';
  end if;
  if v_nom = '' then
    raise exception 'update_produit_v1: nom requis' using errcode = '22023';
  end if;
  if v_cat = '' then
    raise exception 'update_produit_v1: catégorie requise' using errcode = '22023';
  end if;
  if p_prix_vente is null or p_prix_vente < 0 then
    raise exception 'update_produit_v1: prix_vente requis et >= 0' using errcode = '22023';
  end if;

  select * into v_row from public.produits_bar where id = p_id;
  if not found then
    raise exception 'update_produit_v1: produit introuvable (%)', p_id using errcode = 'P0002';
  end if;
  v_before := jsonb_build_object(
    'nom', v_row.nom, 'categorie', v_row.categorie, 'format', v_row.format, 'prix_vente', v_row.prix_vente
  );

  -- Conflit d'unicité si le renommage/format entre en collision avec un AUTRE produit du même univers.
  if exists (
    select 1 from public.produits_bar
     where venue = v_row.venue and nom = v_nom and format is not distinct from v_fmt and id <> p_id
  ) then
    raise exception 'update_produit_v1: un autre produit du même univers porte déjà ce nom/format (% / %)',
      v_nom, coalesce(v_fmt, '—') using errcode = '23505';
  end if;

  update public.produits_bar
     set nom = v_nom,
         categorie = v_cat,
         format = v_fmt,
         prix_vente = p_prix_vente,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  perform public.log_audit_event(
    p_action        => 'carte.produit.update',
    p_resource_type => 'produits_bar',
    p_resource_id   => p_id::text,
    p_summary       => 'Modification ' || v_row.nom || coalesce(' (' || v_row.format || ')', ''),
    p_venue         => v_row.venue,
    p_before        => v_before,
    p_after         => jsonb_build_object(
                         'nom', v_row.nom, 'categorie', v_row.categorie, 'format', v_row.format,
                         'prix_vente', v_row.prix_vente
                       )
  );

  return v_row;
end $$;

revoke all on function public.update_produit_v1(uuid, text, text, numeric, text) from public;
grant execute on function public.update_produit_v1(uuid, text, text, numeric, text) to authenticated;

commit;
