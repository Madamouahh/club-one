-- 0074_invite_link_revocation.sql — RÉVOCATION EXPLICITE des liens de parrainage (distincte de l'expiration).
-- Ajoute au modèle existant (invite_links) sans second système :
--   1. colonnes revoked_at / revoked_by / revocation_reason (historique conservé) ;
--   2. revoke_invite_link_v1(link_id, reason) : promoteur → SES liens ; direction → tous ; autres rôles &
--      anon → refusés ; idempotent (déjà révoqué = succès sans réécriture) ;
--   3. get_invite_link_public expose `revoked` → l'UI /i affiche « lien révoqué » ;
--   4. onboard_referral_v1 refuse immédiatement un lien révoqué (avant register) → aucun guest, aucune
--      réservation, aucune consommation de max_uses, attribution inchangée, même si expires_at est futur.
-- register_guest_via_invite_v1 n'est atteint que via onboard_referral_v1 (seul appelant) → garde suffisante.
-- SECURITY DEFINER + search_path figé. Idempotent / réversible.

begin;

-- 1. Colonnes de révocation (nullable → réversible ; historique conservé). ---------------------
alter table public.invite_links add column if not exists revoked_at        timestamptz;
alter table public.invite_links add column if not exists revoked_by        text;
alter table public.invite_links add column if not exists revocation_reason text;

-- 2. revoke_invite_link_v1 — révocation contrôlée par rôle. ------------------------------------
create or replace function public.revoke_invite_link_v1(p_link_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.current_staff_username();
  v_role text := public.current_staff_role();
  v_link record;
begin
  if v_me is null or v_role is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  -- Seuls direction et promoteur peuvent révoquer (serveur/sécurité/compteur : jamais).
  if v_role not in ('admin', 'manager', 'promoter') then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Rôle non autorisé.');
  end if;
  select * into v_link from public.invite_links where id = p_link_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Lien introuvable.');
  end if;
  -- Le promoteur ne révoque QUE ses propres liens ; la direction révoque tous.
  if v_role = 'promoter' and v_link.created_by <> v_me then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Vous ne pouvez révoquer que vos propres liens.');
  end if;
  -- Idempotent : déjà révoqué → succès, historique NON réécrit.
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_revoked', 'message', 'Lien déjà révoqué.', 'revoked_at', v_link.revoked_at);
  end if;
  update public.invite_links
     set revoked_at = now(), revoked_by = v_me, revocation_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_link_id;
  return jsonb_build_object('ok', true, 'code', 'revoked', 'message', 'Lien révoqué.');
end;
$$;

-- 3. get_invite_link_public — expose `revoked` (l'UI affiche « lien révoqué » distinctement). ---
-- La signature de retour change (colonne `revoked` ajoutée) → DROP obligatoire avant recréation.
drop function if exists public.get_invite_link_public(text);
create or replace function public.get_invite_link_public(p_token text)
returns table(valid boolean, kind text, univers text, event_title text, exploitation_date date,
              expires_at timestamptz, uses_count integer, max_uses integer, revoked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
begin
  if v_token is null then
    return query select false, null::text, null::text, null::text, null::date, null::timestamptz, 0, 0, false; return;
  end if;
  return query
    select true, l.kind, l.univers, e.title, l.exploitation_date, l.expires_at, l.uses_count, l.max_uses,
           (l.revoked_at is not null)
      from public.invite_links l
      left join public.events e on e.id = l.event_id
     where l.token = v_token;
  if not found then
    return query select false, null::text, null::text, null::text, null::date, null::timestamptz, 0, 0, false;
  end if;
end;
$$;

-- 4. onboard_referral_v1 — refuse immédiatement un lien révoqué (avant register). ---------------
create or replace function public.onboard_referral_v1(
  p_token text, p_first_name text, p_last_name text, p_phone_e164 text, p_birthday date,
  p_consent_service boolean, p_consent_service_text text, p_consent_marketing boolean, p_consent_marketing_text text,
  p_party_size int, p_slot text, p_venue_table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg record;
  v_link record;
  v_table record;
  v_req_id uuid;
begin
  -- RÉVOCATION : contrôle AVANT toute écriture (avant register) → aucun guest, aucune résa, aucune
  -- consommation de max_uses, même si expires_at est futur.
  select * into v_link from public.invite_links where token = nullif(btrim(coalesce(p_token, '')), '');
  if found and v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'link_revoked', 'message', 'Ce lien a été révoqué.');
  end if;

  -- Onboarding réutilisé (validation 18+/E.164/consentement, dédup téléphone, attribution promoteur, QR).
  select * into v_reg from public.register_guest_via_invite_v1(
    p_token, p_first_name, p_last_name, p_phone_e164, p_birthday,
    p_consent_service, p_consent_service_text, p_consent_marketing, p_consent_marketing_text);
  if not v_reg.ok then
    return jsonb_build_object('ok', false, 'code', v_reg.code, 'message', v_reg.message);
  end if;

  -- Réservation PRÉREMPLIE : dès qu'un nombre de personnes est fourni. Table choisie par le client,
  -- sinon table LIBRE de l'univers du lien auto-sélectionnée (aucune double occupation).
  if p_party_size is not null and p_party_size > 0 then
    if p_venue_table_id is not null then
      select t.id, t.venue, t.standing into v_table from public.venue_tables t where t.id = p_venue_table_id and t.active;
    else
      select t.id, t.venue, t.standing into v_table
        from public.venue_tables t
       where t.venue = v_link.univers and t.active
         and not exists (select 1 from public.table_reservation_requests r
                          where r.venue_table_id = t.id and r.exploitation_date = v_link.exploitation_date
                            and r.status in ('pending','approved'))
       order by t.label limit 1;
    end if;
    if found and v_table.venue = v_link.univers then
      begin
        insert into public.table_reservation_requests
          (venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, standing, slot, guest_note, status, owner_promoter)
        values
          (v_table.id, v_reg.guest_id, v_link.event_id, v_link.exploitation_date, v_table.venue, p_party_size,
           v_table.standing, nullif(btrim(coalesce(p_slot,'')), ''), null, 'pending', v_link.created_by)
        returning id into v_req_id;
        insert into public.contact_requests (requester_type, full_name, phone, subject, message, status)
        values ('client', p_first_name, p_phone_e164,
                'Demande de réservation (parrainage) — ' || coalesce(v_link.univers, ''),
                'Via ' || coalesce(v_link.created_by, 'promoteur') || ' · ' || p_party_size::text || ' pers.', 'nouveau');
      exception when unique_violation then
        v_req_id := null;
      end;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', 'onboarded', 'message', 'Bienvenue — profil créé et QR émis.',
    'qr_token', v_reg.qr_token, 'guest_id', v_reg.guest_id, 'request_id', v_req_id);
end;
$$;

-- 5. Grants. get_invite_link_public : recréée → grants rétablis (lecture publique /i, anon+authenticated).
--    revoke_invite_link_v1 : staff (authenticated) uniquement ; jamais anon.
revoke all on function public.get_invite_link_public(text) from public;
grant execute on function public.get_invite_link_public(text) to anon, authenticated;
revoke all on function public.revoke_invite_link_v1(uuid, text) from public;
grant execute on function public.revoke_invite_link_v1(uuid, text) to authenticated;

commit;
