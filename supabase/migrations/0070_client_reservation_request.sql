-- 0070_client_reservation_request.sql — DEMANDE DE RÉSERVATION CÔTÉ CLIENT AUTHENTIFIÉ (Vague 7, gap E4).
--
-- CONSTAT (audit E4) : la file de décision staff existe (table_reservation_requests 0025 + decide_… +
-- ReservationBoardTab), et un chemin PUBLIC anonyme existe (request_table_reservation_v1, grant anon) —
-- MAIS ce chemin public prend une identité BRUTE (nom/téléphone/date de naissance) et CRÉE un client :
-- c'est le formulaire public qui exige un captcha/OTP → resté DÉSACTIVÉ, classé décision fondateur.
-- Il MANQUE le chemin V1 : un client DÉJÀ ONBOARDÉ (porteur d'un space_token valide) qui demande une
-- table SANS ressaisir son identité, depuis son espace.
--
-- MODÈLE DE SÉCURITÉ (identique aux RPC d'espace get_guest_space_v2 / set_guest_preferences_v1) :
--   Un client n'a PAS de session Supabase Auth (pas de auth.uid()). Son authentification est la POSSESSION
--   d'un space_token (capacité porteur, expirante 180 j, révocable via revoke_guest_token_v1). La RPC est
--   donc SECURITY DEFINER, accordée à anon+authenticated, mais la PREMIÈRE chose qu'elle fait est de
--   RÉSOUDRE le token → guest (refus fail-closed si token nul/inconnu/expiré). Ce n'est donc PAS une route
--   anon NUE : c'est une route protégée par capacité (le porteur détenait déjà le jeton). Aucune identité
--   n'est acceptée du client : guest_id, nom, téléphone viennent TOUS de la ligne guests résolue par token.
--
-- HONNÊTETÉ / ANTI-ABUS réutilisés du socle 0025 : une demande naît `pending` (jamais auto-confirmée) ;
-- l'index unique partiel trr_one_active_per_guest garantit 1 seule demande active par client et par soirée
-- (violation → refus explicite « déjà une demande ») ; trr_one_active_per_table protège la table.
--
-- NOTIFICATION INBOX : chaque demande crée aussi un contact_request (requester_type='client', status
-- 'nouveau') → la demande remonte dans l'Inbox interne (0063) sans dépendre du board plan de salle.
--
-- SÉCURITÉ : SECURITY DEFINER + search_path=public figé. La RLS de table_reservation_requests (0025) et
-- de contact_requests (0063) reste active pour les accès directs. Idempotent / réversible.

begin;

-- ============================================================
-- request_table_reservation_as_guest_v1 — un client onboardé (space_token) demande une table.
--   Retourne jsonb { ok, code, message, request_id }.
-- ============================================================
create or replace function public.request_table_reservation_as_guest_v1(
  p_space_token   uuid,
  p_event_slug    text,
  p_venue_table_id uuid,
  p_party_size    int,
  p_slot          text,
  p_guest_note    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest    record;
  v_event    record;
  v_table    record;
  v_slot     text := nullif(btrim(coalesce(p_slot, '')), '');
  v_note     text := nullif(btrim(coalesce(p_guest_note, '')), '');
  v_req_id   uuid;
begin
  -- 1) AUTHENTIFICATION PAR CAPACITÉ : le space_token DOIT résoudre un client non expiré. FAIL-CLOSED.
  if p_space_token is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Accès requis.');
  end if;
  select g.id, g.first_name, g.phone, g.space_token_expires_at
    into v_guest
    from public.guests g
   where g.space_token = p_space_token;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Accès invalide.');
  end if;
  if v_guest.space_token_expires_at is not null and v_guest.space_token_expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'expired', 'message', 'Lien expiré — reconnectez-vous.');
  end if;

  -- 2) party_size entier strictement positif (jamais 0/négatif inventé).
  if p_party_size is null or p_party_size <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_party_size', 'message', 'Nombre de personnes invalide.');
  end if;

  -- 3) Soirée : résolue par slug, publiée, non passée (on ne demande pas une table d'une soirée finie).
  select e.id, e.venue_id, e.event_date, e.status, e.title
    into v_event
    from public.events e
   where e.slug = p_event_slug;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_event', 'message', 'Soirée introuvable.');
  end if;
  if v_event.status <> 'published' then
    return jsonb_build_object('ok', false, 'code', 'event_not_open', 'message', 'Soirée non ouverte aux demandes.');
  end if;
  if v_event.event_date < current_date then
    return jsonb_build_object('ok', false, 'code', 'event_past', 'message', 'Soirée déjà passée.');
  end if;

  -- 4) Table : existe, active, et du MÊME univers que la soirée (aucune table d'une autre salle).
  select t.id, t.venue, t.standing, t.active
    into v_table
    from public.venue_tables t
   where t.id = p_venue_table_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_table', 'message', 'Table introuvable.');
  end if;
  if not v_table.active then
    return jsonb_build_object('ok', false, 'code', 'table_inactive', 'message', 'Table indisponible.');
  end if;
  if v_table.venue is distinct from v_event.venue_id then
    return jsonb_build_object('ok', false, 'code', 'table_wrong_venue', 'message', 'Table hors de la salle de la soirée.');
  end if;

  -- 5) Insert de la DEMANDE (status pending, jamais confirmée). Les index uniques partiels 0025 arbitrent
  --    la concurrence : 1 demande active/client/soirée + 1 demande active/table/soirée.
  begin
    insert into public.table_reservation_requests
      (venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, standing, slot, guest_note, status)
    values
      (v_table.id, v_guest.id, v_event.id, v_event.event_date, v_table.venue, p_party_size,
       v_table.standing, v_slot, v_note, 'pending')
    returning id into v_req_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already_active',
      'message', 'Vous avez déjà une demande en cours pour cette soirée, ou cette table est déjà demandée.');
  end;

  -- 6) Notification Inbox interne (0063) : la demande remonte au staff même hors board plan de salle.
  insert into public.contact_requests (requester_type, full_name, phone, subject, message, status)
  values ('client', v_guest.first_name, v_guest.phone,
          'Demande de réservation — ' || coalesce(v_event.title, p_event_slug),
          coalesce(v_note, '') || ' (' || p_party_size::text || ' pers.)', 'nouveau');

  return jsonb_build_object('ok', true, 'code', 'created', 'message', 'Demande envoyée.', 'request_id', v_req_id);
end;
$$;

-- ============================================================
-- cancel_reservation_request_as_guest_v1 — le client annule SA demande tant qu'elle est `pending`.
-- ============================================================
create or replace function public.cancel_reservation_request_as_guest_v1(
  p_space_token uuid,
  p_request_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid;
  v_exp      timestamptz;
  v_updated  int;
begin
  if p_space_token is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Accès requis.');
  end if;
  select g.id, g.space_token_expires_at into v_guest_id, v_exp
    from public.guests g where g.space_token = p_space_token;
  if v_guest_id is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Accès invalide.');
  end if;
  if v_exp is not null and v_exp < now() then
    return jsonb_build_object('ok', false, 'code', 'expired', 'message', 'Lien expiré.');
  end if;

  -- Annulation possible UNIQUEMENT sur SA demande encore `pending` (une demande déjà décidée est figée).
  update public.table_reservation_requests
     set status = 'cancelled', updated_at = now()
   where id = p_request_id and guest_id = v_guest_id and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_cancellable',
      'message', 'Demande introuvable ou déjà traitée.');
  end if;
  return jsonb_build_object('ok', true, 'code', 'cancelled', 'message', 'Demande annulée.');
end;
$$;

-- ============================================================
-- list_requestable_tables_v1 — le client (token) liste les tables DEMANDABLES d'une soirée.
--   Lecture seule, token-gardée (aucun accès direct anon à venue_tables → anon-zéro préservé sur la table).
--   Rend l'état « couche demandes » de chaque table active : free / requested / confirmed (jamais une
--   fausse occupation physique). Aucune PII.
-- ============================================================
create or replace function public.list_requestable_tables_v1(
  p_space_token uuid,
  p_event_slug  text
)
returns table (id uuid, label text, venue text, standing boolean, capacity int, availability text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid;
  v_exp      timestamptz;
  v_venue    text;
  v_date     date;
begin
  -- Garde de capacité : token valide non expiré (sinon aucune donnée).
  if p_space_token is null then return; end if;
  select g.id, g.space_token_expires_at into v_guest_id, v_exp
    from public.guests g where g.space_token = p_space_token;
  if v_guest_id is null then return; end if;
  if v_exp is not null and v_exp < now() then return; end if;

  -- Soirée publiée non passée.
  select e.venue_id, e.event_date into v_venue, v_date
    from public.events e where e.slug = p_event_slug and e.status = 'published';
  if v_venue is null or v_date < current_date then return; end if;

  return query
    select t.id, t.label, t.venue, t.standing, t.capacity,
           case
             when act.confirmed then 'confirmed'
             when act.requested then 'requested'
             else 'free'
           end as availability
      from public.venue_tables t
      left join lateral (
        select bool_or(r.status = 'approved') as confirmed,
               bool_or(r.status = 'pending')  as requested
          from public.table_reservation_requests r
         where r.venue_table_id = t.id and r.exploitation_date = v_date
           and r.status in ('pending','approved')
      ) act on true
     where t.venue = v_venue and t.active
     order by t.label;
end;
$$;

-- ============================================================
-- list_my_reservation_requests_v1 — le client (token) voit SES demandes (statut visible côté client).
--   Lecture seule token-gardée ; ne renvoie QUE les demandes du client résolu par le token. Aucune PII
--   d'autrui. Jointures libellé table + titre soirée (jamais fabriqués).
-- ============================================================
create or replace function public.list_my_reservation_requests_v1(p_space_token uuid)
returns table (
  id uuid, event_title text, exploitation_date date, table_label text,
  party_size int, standing boolean, slot text, status text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare v_guest_id uuid; v_exp timestamptz;
begin
  if p_space_token is null then return; end if;
  select g.id, g.space_token_expires_at into v_guest_id, v_exp
    from public.guests g where g.space_token = p_space_token;
  if v_guest_id is null then return; end if;
  if v_exp is not null and v_exp < now() then return; end if;

  return query
    select r.id, e.title, r.exploitation_date, t.label,
           r.party_size, r.standing, r.slot, r.status, r.created_at
      from public.table_reservation_requests r
      left join public.events e on e.id = r.event_id
      left join public.venue_tables t on t.id = r.venue_table_id
     where r.guest_id = v_guest_id
     order by r.created_at desc;
end;
$$;

-- ============================================================
-- Grants : anon + authenticated (route protégée par CAPACITÉ space_token, comme get_guest_space_v2).
-- L'autorisation réelle est FAIT DANS la fonction (résolution du token) — jamais une route anon nue.
-- ============================================================
revoke all on function public.request_table_reservation_as_guest_v1(uuid, text, uuid, int, text, text) from public;
grant execute on function public.request_table_reservation_as_guest_v1(uuid, text, uuid, int, text, text) to anon, authenticated;

revoke all on function public.cancel_reservation_request_as_guest_v1(uuid, uuid) from public;
grant execute on function public.cancel_reservation_request_as_guest_v1(uuid, uuid) to anon, authenticated;

revoke all on function public.list_requestable_tables_v1(uuid, text) from public;
grant execute on function public.list_requestable_tables_v1(uuid, text) to anon, authenticated;

revoke all on function public.list_my_reservation_requests_v1(uuid) from public;
grant execute on function public.list_my_reservation_requests_v1(uuid) to anon, authenticated;

commit;
