-- 0073_referral_funnel.sql — CLÔTURE PARRAINAGE PROMOTEUR (Phase 3) : minimum manquant pour le funnel
-- bout-en-bout. Réutilise TOUT l'existant : invite_links (lien + created_by = promoteur + event/univers),
-- register_guest_via_invite_v1 (dédup + attribution owner_promoter + QR), table_reservation_requests,
-- guest_passes, contact_requests (Inbox), guest_visits. On n'ajoute QUE :
--   1. referral_events : journal APPEND-ONLY du seul événement non déjà persisté (LINK_OPENED) ;
--   2. log_referral_open_v1 : enregistre une ouverture de lien (anon+token, aucune donnée fabriquée) ;
--   3. onboard_referral_v1 : onboarding client via lien AVEC réservation PRÉREMPLIE (event/espace du lien),
--      en réutilisant register_guest_via_invite_v1 puis en créant la demande + la notif Inbox ;
--   4. promoter_funnel_v1 : funnel du promoteur, entièrement DÉRIVÉ de données réelles (aucune métrique
--      inventée), cantonné à SES données (current_staff_username), donc un promoteur ne voit que le sien.
--
-- Attribution : conservée par register_guest_via_invite_v1 (owner_promoter additif, jamais volé). Un lien
-- révoqué/expiré ne crée rien (register refuse). Usage unique/multiple géré par invite_links.max_uses.
-- SECURITY DEFINER + search_path figé. Idempotent / réversible.

begin;

-- ============================================================
-- 1. referral_events — journal APPEND-ONLY (LINK_OPENED). Minimisation : ni PII, ni identité client.
-- ============================================================
create table if not exists public.referral_events (
  id               uuid primary key default gen_random_uuid(),
  link_token       text not null,
  promoter_username text not null,       -- créateur du lien (invite_links.created_by)
  kind             text not null check (kind in ('link_opened')),
  event_id         uuid,
  created_at       timestamptz not null default now()
);
create index if not exists referral_events_promoter_idx on public.referral_events (promoter_username, created_at desc);
create index if not exists referral_events_token_idx on public.referral_events (link_token);

grant select on public.referral_events to authenticated;
revoke all on public.referral_events from anon;
alter table public.referral_events enable row level security;

-- Le promoteur lit SES événements ; la direction lit tout. Aucune écriture directe (RPC DEFINER seule).
drop policy if exists referral_events_read on public.referral_events;
create policy referral_events_read on public.referral_events
  for select to authenticated
  using (promoter_username = current_staff_username()
         or current_staff_role() = any (array['admin','manager']));

-- ============================================================
-- 2. log_referral_open_v1 — enregistre une ouverture de lien (idempotence non requise : chaque ouverture
--    réelle compte). Résout le lien pour rattacher le promoteur ; lien inconnu → aucun événement.
-- ============================================================
create or replace function public.log_referral_open_v1(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_link record;
begin
  select * into v_link from public.invite_links where token = nullif(btrim(coalesce(p_token,'')), '');
  if not found then return; end if;
  insert into public.referral_events (link_token, promoter_username, kind, event_id)
  values (v_link.token, v_link.created_by, 'link_opened', v_link.event_id);
end;
$$;

-- ============================================================
-- 3. onboard_referral_v1 — onboarding client via lien + RÉSERVATION PRÉREMPLIE. Réutilise
--    register_guest_via_invite_v1 (dédup + attribution + QR) puis crée la demande de résa liée
--    (event/univers du LIEN, table choisie) + la notification Inbox staff. Rien n'est ressaisi côté lien.
--    Retourne jsonb { ok, code, message, qr_token, guest_id, request_id }.
-- ============================================================
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
  -- Onboarding réutilisé (validation 18+/E.164/consentement, dédup téléphone, attribution promoteur, QR).
  select * into v_reg from public.register_guest_via_invite_v1(
    p_token, p_first_name, p_last_name, p_phone_e164, p_birthday,
    p_consent_service, p_consent_service_text, p_consent_marketing, p_consent_marketing_text);
  if not v_reg.ok then
    return jsonb_build_object('ok', false, 'code', v_reg.code, 'message', v_reg.message);
  end if;

  -- Contexte du lien (soirée + univers déjà portés par le lien — non ressaisis par le client).
  select * into v_link from public.invite_links where token = nullif(btrim(coalesce(p_token,'')), '');

  -- Réservation PRÉREMPLIE : dès qu'un nombre de personnes est fourni. La table est celle choisie par le
  -- client, sinon (préférence non exprimée) une table LIBRE de l'univers du lien est auto-sélectionnée
  -- (aucune double occupation : on écarte les tables déjà demandées/confirmées ce soir).
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
        -- Notification Inbox staff (source promoteur portée par owner_promoter de la demande).
        insert into public.contact_requests (requester_type, full_name, phone, subject, message, status)
        values ('client', p_first_name, p_phone_e164,
                'Demande de réservation (parrainage) — ' || coalesce(v_link.univers, ''),
                'Via ' || coalesce(v_link.created_by, 'promoteur') || ' · ' || p_party_size::text || ' pers.', 'nouveau');
      exception when unique_violation then
        v_req_id := null; -- déjà une demande active pour ce client/cette soirée ou cette table
      end;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', 'onboarded', 'message', 'Bienvenue — profil créé et QR émis.',
    'qr_token', v_reg.qr_token, 'guest_id', v_reg.guest_id, 'request_id', v_req_id);
end;
$$;

-- ============================================================
-- 4. promoter_funnel_v1 — funnel du promoteur COURANT, entièrement dérivé du réel (aucune métrique inventée).
--    Cantonné à SES données (current_staff_username) : un promoteur ne consulte jamais un autre funnel.
-- ============================================================
create or replace function public.promoter_funnel_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.current_staff_username();
  v_role text := public.current_staff_role();
  v_links int; v_opens int; v_profiles int; v_req int; v_appr int; v_passes int; v_scanned int; v_returned int;
begin
  if v_me is null or v_role is null or v_role not in ('admin','manager','promoter') then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  select count(*) into v_links from public.invite_links where created_by = v_me;
  select count(*) into v_opens from public.referral_events where promoter_username = v_me and kind = 'link_opened';
  select count(*) into v_profiles from public.guests where owner_promoter = v_me;
  select count(*) into v_req from public.table_reservation_requests r
    where r.guest_id in (select id from public.guests where owner_promoter = v_me);
  select count(*) into v_appr from public.table_reservation_requests r
    where r.status = 'approved' and r.guest_id in (select id from public.guests where owner_promoter = v_me);
  select count(*) into v_passes from public.guest_passes p
    where p.guest_id in (select id from public.guests where owner_promoter = v_me);
  select count(*) into v_scanned from public.guest_passes p
    where p.status = 'scanned' and p.guest_id in (select id from public.guests where owner_promoter = v_me);
  select count(*) into v_returned from (
    select v.guest_id from public.guest_visits v
     where v.status = 'seated' and v.guest_id in (select id from public.guests where owner_promoter = v_me)
     group by v.guest_id having count(*) >= 2
  ) x;

  return jsonb_build_object('ok', true,
    'link_created', v_links, 'link_opened', v_opens, 'profile_completed', v_profiles,
    'reservation_requested', v_req, 'reservation_approved', v_appr, 'pass_issued', v_passes,
    'checked_in', v_scanned, 'client_returned', v_returned);
end;
$$;

-- ============================================================
-- Grants : onboarding/log = anon+authenticated (route protégée par le token) ; funnel = authenticated (staff).
-- ============================================================
revoke all on function public.log_referral_open_v1(text) from public;
grant execute on function public.log_referral_open_v1(text) to anon, authenticated;
revoke all on function public.onboard_referral_v1(text, text, text, text, date, boolean, text, boolean, text, int, text, uuid) from public;
grant execute on function public.onboard_referral_v1(text, text, text, text, date, boolean, text, boolean, text, int, text, uuid) to anon, authenticated;
revoke all on function public.promoter_funnel_v1() from public;
grant execute on function public.promoter_funnel_v1() to authenticated;

commit;
