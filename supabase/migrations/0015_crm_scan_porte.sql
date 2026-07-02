-- 0015_crm_scan_porte.sql — SCAN À LA PORTE du QR d'entrée (V0, spec MODULE_CRM_CLIENTS_VIP.md §V0, pt 5).
-- « À la porte : le staff scanne le QR → entrée loggée → la présence (seated) se constate
--   automatiquement, plus de saisie manuelle. Non-scanné à la fermeture = no_show. »
--
-- Additif strict au-dessus de 0013 (guests/guest_visits) et 0014 (guest_passes). AUCUN seed : la base
-- ship VIDE. Une seule RPC staff dédiée :
--   · scan_guest_pass_v1(qr_token) : le portier scanne le QR d'entrée personnel d'un client inscrit.
--
-- SÉCURITÉ (règle 20-security-supabase) : SECURITY DEFINER (bypasse la RLS guest_passes qui n'autorise
-- l'update direct qu'à la direction — le scan est le chemin normal du portier), search_path figé,
-- GRANT EXECUTE limité à authenticated (jamais PUBLIC), rôle re-vérifié EN SQL (jamais confiance au
-- client). Rôles autorisés = ceux du contrôle d'accès à la porte, identiques à check_in_invitation_v2 :
-- admin, manager, security, security_counter (les rôles canCheckInQr côté front).
--
-- COHÉRENCE AVEC L'EXISTANT : comme check_in_invitation_v2 (QR d'invitation promoteur), un premier
-- scan réussi insère AUSSI une ligne entry_logs('entry') → le compteur de Flux reste juste (le portier
-- scanne AU LIEU de cliquer +1). Le re-scan est idempotent : ni double présence, ni double comptage.
--
-- HONNÊTETÉ DES DONNÉES : aucune présence fabriquée. Seul un QR réellement émis (guest_passes.issued)
-- pour la SOIRÉE ACTIVE bascule en seated. Un QR d'une autre soirée est refusé (wrong_event), jamais
-- « recyclé ». La présence (guest_visits.seated) est la seule vérité ; le passage en no_show des
-- non-scannés est une opération de CLÔTURE distincte (chunk ultérieur), pas ce scan.

begin;

-- ============================================================
-- RPC scan_guest_pass_v1 — le portier scanne le QR d'entrée d'un client inscrit via le funnel.
--   Refait TOUTES les gardes en SQL :
--     · rôle porte (admin/manager/security/security_counter) ;
--     · soirée ACTIVE requise ; le pass DOIT appartenir à la soirée active (anti-recyclage) ;
--     · pass verrouillé FOR UPDATE (sûr en concurrence — deux portiers ne comptent pas deux fois) ;
--     · idempotence : un pass déjà scanné renvoie l'info du 1ᵉʳ scan sans rien redoubler ;
--     · premier scan : pass→scanned, visite→seated (présence auto), +1 entry_logs (compteur juste).
-- ============================================================
create or replace function public.scan_guest_pass_v1(p_qr_token text)
returns table (
  ok boolean,
  code text,
  message text,
  first_name text,
  univers text,
  is_host boolean,
  scanned_at timestamptz,
  scanned_by text
)
language plpgsql
security definer
set search_path = public
as $$
-- Les colonnes de sortie (univers, first_name, is_host, scanned_at, scanned_by) portent le même nom
-- que des colonnes de tables manipulées ici. On n'accède JAMAIS aux OUT par leur nom nu (on renvoie
-- toujours des expressions qualifiées v_pass.* / v_first) ; « use_column » lève l'ambiguïté en faveur
-- de la colonne — comportement voulu dans le ON CONFLICT et les INSERT (cf. register_guest_via_invite_v1).
#variable_conflict use_column
declare
  v_token text := nullif(btrim(coalesce(p_qr_token, '')), '');
  v_role text;
  v_username text;
  v_event_id uuid;
  v_event_date date;
  v_pass record;
  v_first text;
  v_now timestamptz := now();
begin
  -- 1) Authentification + rôle porte (jamais confiance au client) --------------------------------
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorisé.',
      null::text, null::text, null::boolean, null::timestamptz, null::text; return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager','security','security_counter') then
    return query select false, 'unauthorized', 'Utilisateur non autorisé.',
      null::text, null::text, null::boolean, null::timestamptz, null::text; return;
  end if;

  -- 2) QR non vide -------------------------------------------------------------------------------
  if v_token is null then
    return query select false, 'invalid_token', 'QR vide ou invalide.',
      null::text, null::text, null::boolean, null::timestamptz, null::text; return;
  end if;

  -- 3) Soirée active requise ---------------------------------------------------------------------
  v_event_id := public.current_active_event_id();
  v_event_date := public.current_active_event_date();
  if v_event_id is null or v_event_date is null then
    return query select false, 'missing_active_event', 'Aucun événement actif.',
      null::text, null::text, null::boolean, null::timestamptz, null::text; return;
  end if;

  -- 4) Verrouille le pass (sûr en concurrence) ---------------------------------------------------
  select * into v_pass from public.guest_passes gp where gp.qr_token = v_token for update;
  if not found then
    return query select false, 'unknown_pass', 'QR inconnu.',
      null::text, null::text, null::boolean, null::timestamptz, null::text; return;
  end if;

  -- Prénom (affichage porte) — lecture directe autorisée dans le contexte DEFINER.
  select g.first_name into v_first from public.guests g where g.id = v_pass.guest_id;

  -- 5) Le pass doit appartenir à la SOIRÉE ACTIVE (anti-recyclage d'un vieux QR) -----------------
  if v_pass.event_id is distinct from v_event_id then
    return query select false, 'wrong_event', 'QR valide mais pas pour cette soirée.',
      v_first, v_pass.univers, v_pass.is_host, null::timestamptz, null::text; return;
  end if;

  -- 6) Pass annulé = refus explicite -------------------------------------------------------------
  if v_pass.status = 'cancelled' then
    return query select false, 'pass_cancelled', 'QR annulé.',
      v_first, v_pass.univers, v_pass.is_host, null::timestamptz, null::text; return;
  end if;

  -- 7) Déjà scanné = idempotent (on renvoie l'info du 1ᵉʳ scan, aucun double comptage) -----------
  if v_pass.status = 'scanned' then
    return query select true, 'already_scanned', 'Déjà entré (présence déjà enregistrée).',
      v_first, v_pass.univers, v_pass.is_host, v_pass.scanned_at, v_pass.scanned_by; return;
  end if;

  -- 8) Premier scan valide (status = 'issued') : présence constatée -------------------------------
  update public.guest_passes
     set status = 'scanned', scanned_at = v_now, scanned_by = v_username
   where id = v_pass.id;

  -- Présence automatique : la visite « booked » (créée à l'inscription) passe « seated ». Upsert
  -- défensif si la visite manquait (aucune présence fabriquée : elle existe car le pass existe).
  insert into public.guest_visits (guest_id, event_id, exploitation_date, univers, status, is_host, created_by)
  values (v_pass.guest_id, v_pass.event_id, v_pass.exploitation_date, v_pass.univers, 'seated', v_pass.is_host, 'door_scan')
  on conflict (guest_id, exploitation_date, univers)
  do update set status = 'seated', updated_at = v_now;

  -- Compteur de Flux juste : +1 entrée (même convention que check_in_invitation_v2).
  insert into public.entry_logs (type, staff_username, event_id, event_date)
  values ('entry', v_username, v_event_id, v_event_date);

  return query select true, 'ok', 'Entrée validée — présence enregistrée.',
    v_first, v_pass.univers, v_pass.is_host, v_now, v_username;
end;
$$;
revoke all on function public.scan_guest_pass_v1(text) from public;
grant execute on function public.scan_guest_pass_v1(text) to authenticated;

commit;
