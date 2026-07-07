-- 0071_client_invitation_pass.sql — INVITATION CLIENT ÉMISE PAR LE STAFF (Vague 7, gap E5).
--
-- CONSTAT (audit E5) : l'infrastructure de pass existe (guest_passes : qr_token unique, status
-- issued/scanned/expired/cancelled, is_host, free_entry) et le SCAN de porte est complet
-- (scan_guest_pass_v1 : soirée active requise, anti-recyclage, IDEMPOTENT sur re-scan → aucun double
-- comptage, refus des pass annulés). Le portail client AFFICHE déjà les pass (get_guest_space_v2 →
-- passes[], QR présentable pour un pass issued+futur). Il MANQUE les DEUX bouts staff :
--   1. ÉMETTRE une invitation nominative (rattacher un client + une soirée → un pass QR) ;
--   2. RÉVOQUER (annuler) une invitation encore non utilisée.
-- Ce squad livre exactement ces deux RPC ; scan/validation/anti-double/affichage existent déjà.
--
-- RATTACHEMENT : le pass est nominatif (guest_id) ET daté (event_id → univers + exploitation_date de la
-- soirée). invite_link_id reste NULL (invitation directe, pas via lien de liste). L'unicité
-- (guest_id, invite_link_id) tolère plusieurs NULL ; on ajoute une GARDE applicative anti-doublon :
-- un seul pass ACTIF (issued|scanned) par (client, soirée) — on ne réémet pas une invitation déjà émise.
--
-- QR : généré CÔTÉ POSTGRES (gen_random_uuid concaténés), jamais fourni par le client — même principe
-- que create_invite_link_v1 / create_promoter_invitation_v2. Expiration NATURELLE : le QR n'est présenté
-- (get_guest_space_v2) et scanné (scan_guest_pass_v1 : soirée active) que pour sa soirée ; une invitation
-- pour une soirée passée n'est jamais émise (garde event_date >= today).
--
-- PERMISSIONS : émission = admin/manager/promoter (le promoteur invite ses contacts) ; révocation =
-- direction (admin/manager). Gardes FAIL-CLOSED (role NULL/hors périmètre → refus). SECURITY DEFINER +
-- search_path figé. EXECUTE réservé à authenticated (jamais anon). Idempotent / réversible.

begin;

-- ============================================================
-- issue_guest_pass_v1 — le staff émet une invitation nominative (client + soirée) → pass QR.
--   Retourne jsonb { ok, code, message, pass_id, qr_token, first_name }.
-- ============================================================
create or replace function public.issue_guest_pass_v1(
  p_guest_id   uuid,
  p_event_id   uuid,
  p_is_host    boolean,
  p_free_entry boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text := public.current_staff_role();
  v_event   record;
  v_first   text;
  v_token   text;
  v_pass_id uuid;
  v_attempt int;
begin
  -- 1) Garde staff FAIL-CLOSED (émission : direction + promoteur).
  if auth.uid() is null or v_role is null or v_role not in ('admin','manager','promoter') then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Utilisateur non autorisé.');
  end if;

  -- 2) Soirée : existe, non passée (on n'émet pas une invitation pour une soirée finie).
  select e.id, e.venue_id, e.event_date, e.title into v_event
    from public.events e where e.id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_event', 'message', 'Soirée introuvable.');
  end if;
  if v_event.event_date < current_date then
    return jsonb_build_object('ok', false, 'code', 'event_past', 'message', 'Soirée déjà passée.');
  end if;

  -- 3) Client : existe.
  select g.first_name into v_first from public.guests g where g.id = p_guest_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_guest', 'message', 'Client introuvable.');
  end if;

  -- 4) Anti-doublon : un seul pass ACTIF (issued|scanned) par (client, soirée).
  if exists (
    select 1 from public.guest_passes gp
     where gp.guest_id = p_guest_id and gp.event_id = p_event_id and gp.status in ('issued','scanned')
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_issued',
      'message', 'Une invitation active existe déjà pour ce client et cette soirée.');
  end if;

  -- 5) Émission : QR généré côté serveur, insert status issued.
  for v_attempt in 1..5 loop
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    begin
      insert into public.guest_passes
        (guest_id, invite_link_id, event_id, exploitation_date, univers, qr_token, status, free_entry, is_host)
      values
        (p_guest_id, null, v_event.id, v_event.event_date, v_event.venue_id, v_token, 'issued',
         coalesce(p_free_entry, false), coalesce(p_is_host, false))
      returning id into v_pass_id;
      exit;
    exception when unique_violation then
      v_token := null;  -- collision improbable de qr_token → nouvelle tentative
    end;
  end loop;
  if v_pass_id is null then
    return jsonb_build_object('ok', false, 'code', 'token_collision', 'message', 'Échec de génération du QR, réessayez.');
  end if;

  return jsonb_build_object('ok', true, 'code', 'issued', 'message', 'Invitation émise.',
    'pass_id', v_pass_id, 'qr_token', v_token, 'first_name', v_first);
end;
$$;

-- ============================================================
-- cancel_guest_pass_v1 — la direction révoque une invitation ENCORE non utilisée (status issued).
--   Un pass déjà scanné (présence enregistrée) n'est PAS annulable (on ne réécrit pas l'histoire).
-- ============================================================
create or replace function public.cancel_guest_pass_v1(p_pass_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text := public.current_staff_role();
  v_status text;
begin
  -- Garde direction FAIL-CLOSED (révocation = admin/manager).
  if auth.uid() is null or v_role is null or v_role not in ('admin','manager') then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Utilisateur non autorisé.');
  end if;

  select gp.status into v_status from public.guest_passes gp where gp.id = p_pass_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_pass', 'message', 'Invitation introuvable.');
  end if;
  if v_status = 'scanned' then
    return jsonb_build_object('ok', false, 'code', 'already_used', 'message', 'Invitation déjà utilisée — non annulable.');
  end if;
  if v_status = 'cancelled' then
    return jsonb_build_object('ok', true, 'code', 'already_cancelled', 'message', 'Invitation déjà annulée.');
  end if;

  update public.guest_passes set status = 'cancelled' where id = p_pass_id;
  return jsonb_build_object('ok', true, 'code', 'cancelled', 'message', 'Invitation annulée.');
end;
$$;

-- ============================================================
-- Grants : authenticated uniquement (opérations STAFF). Jamais anon.
-- ============================================================
revoke all on function public.issue_guest_pass_v1(uuid, uuid, boolean, boolean) from public;
grant execute on function public.issue_guest_pass_v1(uuid, uuid, boolean, boolean) to authenticated;

revoke all on function public.cancel_guest_pass_v1(uuid) from public;
grant execute on function public.cancel_guest_pass_v1(uuid) to authenticated;

commit;
