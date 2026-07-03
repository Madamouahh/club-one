-- 0025_table_reservation_requests.sql — FLUX CLIENT « DEMANDE DE RÉSA » (chunk 4 de PLAN_SALLE_EDEN).
--
-- Demande fondateur (spec PLAN_SALLE_EDEN_RESA_INTERACTIVE.md §3) : depuis le plan interactif, un CLIENT
-- tape une table LIBRE d'une soirée et envoie une DEMANDE de réservation (party_size, créneau). Ce n'est
-- PAS une confirmation automatique : la demande naît `pending` et un manager la VALIDE (ou la refuse)
-- dans Club One. La demande crée/rattache le client dans `guests` via le MÊME funnel que 0014 (2 cases de
-- consentement dégroupées à la 1re demande, blocage < 18 ans L.3342-1).
--
-- Additif strict au-dessus de 0013 (guests) / 0024 (venue_tables). AUCUN seed : la table ship VIDE
-- (aucune demande fabriquée). Une table + deux RPC :
--   · table_reservation_requests  : la file des demandes (pending → approved/declined/cancelled).
--   · request_table_reservation_v1 (anon)          : le client envoie SA demande (le cœur du flux).
--   · decide_table_reservation_v1  (authenticated) : un manager tranche (validation staff).
--
-- ⚠️ COUCHE D'OCCUPATION HONNÊTE : l'Eden (venue_tables, 44 tables) n'a PAS de statut live club_tables
-- (question de design 2b non tranchée). Cette migration NE PRÉTEND PAS connaître l'occupation physique.
-- La seule « disponibilité » qu'elle connaît est celle de la COUCHE DEMANDES : une table est « libre »
-- s'il n'existe aucune demande active (pending/approved) sur elle pour cette soirée. C'est une donnée
-- RÉELLE et auto-contenue (anti double-demande), jamais une fausse dispo physique.
--
-- SÉCURITÉ (règle 20-security-supabase) : la RPC anon est SECURITY DEFINER, search_path figé, GRANT
-- limité (jamais PUBLIC). anon n'a AUCUN accès direct à la table (tout passe par la RPC). Aucune règle
-- ne fait confiance au client : 18+ refait en SQL, la soirée est résolue par un slug PUBLIÉ (jamais un
-- event_id brut fourni par le client), owner_promoter n'est jamais volé, la validation reste manuelle.
--
-- ⚠️⚠️ SURFACE D'ABUS ANON (À TRAITER AVANT TOUTE PROD — voir rapport de session) : la demande anon
-- n'est gardée que par un slug public. Sans jeton signé par soirée / captcha / rate-limit, un acteur
-- pourrait saturer les tables de fausses demandes `pending`. Les index uniques partiels ci-dessous
-- limitent (1 demande active / table / soirée, 1 / client / soirée) mais ne suffisent PAS contre un
-- spam distribué. BLOQUANT pour la prod : anti-abus + revue security-architect requis avant exposition.
--
-- RGPD/Évin : consentement journalisé avec le TEXTE EXACT présenté (preuve CNIL) ; aucune colonne de
-- comportement ; aucun texte de message stocké/généré ici. LABO uniquement : migration NON exécutée
-- sur la base opérationnelle (règle 20 + 40).

begin;

-- ============================================================
-- 1) TABLE_RESERVATION_REQUESTS — la file des demandes de résa (VIDE au départ).
-- ============================================================
create table if not exists public.table_reservation_requests (
  id uuid primary key default gen_random_uuid(),
  venue_table_id uuid not null references public.venue_tables(id) on delete restrict,
  guest_id uuid not null references public.guests(id) on delete cascade,
  event_id uuid references public.events(id),
  exploitation_date date not null,                  -- la soirée (chevauche minuit) — cohérent 0013/0014
  venue text not null check (venue in ('eden','terminus','cercle')), -- salle de la table demandée
  party_size integer not null check (party_size > 0),
  standing boolean not null default false,          -- table haute « debout » (groupe debout) — miroir de la table
  slot text,                                        -- créneau souhaité (texte court libre), optionnel
  guest_note text,                                  -- note du client (minimisation : neutre, jamais comportement)
  status text not null default 'pending'
    check (status in ('pending','approved','declined','cancelled')),
  owner_promoter text,                              -- hérité du guest à la demande (cantonnement RLS promoteur)
  decided_by text,                                  -- username du manager qui tranche (traçabilité)
  decided_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trr_guest_idx on public.table_reservation_requests(guest_id);
create index if not exists trr_table_idx on public.table_reservation_requests(venue_table_id);
create index if not exists trr_date_idx on public.table_reservation_requests(exploitation_date);
create index if not exists trr_status_idx on public.table_reservation_requests(status);
create index if not exists trr_owner_idx on public.table_reservation_requests(owner_promoter);

-- Anti-abus / anti double-demande (couche demandes, données réelles) :
--   · une seule demande ACTIVE (pending|approved) par TABLE et par soirée (= « table libre » honnête) ;
--   · une seule demande ACTIVE par CLIENT et par soirée (spec §3 : « une demande active par client par soirée »).
create unique index if not exists trr_one_active_per_table
  on public.table_reservation_requests(venue_table_id, exploitation_date)
  where status in ('pending','approved');

create unique index if not exists trr_one_active_per_guest
  on public.table_reservation_requests(guest_id, exploitation_date)
  where status in ('pending','approved');

-- ============================================================
-- 2) RLS — anon : AUCUN accès direct (tout passe par la RPC). Staff : cantonnement.
-- ============================================================
alter table public.table_reservation_requests enable row level security;
revoke all on public.table_reservation_requests from anon;
grant select, insert, update, delete on public.table_reservation_requests to authenticated;

-- Lecture : direction voit tout ; le promoteur voit les demandes de SES clients (owner_promoter = lui).
-- Les autres rôles (server/security/…) ne voient RIEN (la demande porte de la PII client).
drop policy if exists trr_read on public.table_reservation_requests;
create policy trr_read on public.table_reservation_requests for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter'
        and owner_promoter = public.current_staff_username())
  );

-- Insert direct : direction seule (fallback de saisie manuelle). Le chemin normal = la RPC anon.
drop policy if exists trr_insert on public.table_reservation_requests;
create policy trr_insert on public.table_reservation_requests for insert to authenticated
  with check (public.current_staff_role() in ('admin','manager'));

-- Décision (validation/refus) : direction seule. Le chemin normal = la RPC decide_table_reservation_v1.
drop policy if exists trr_update on public.table_reservation_requests;
create policy trr_update on public.table_reservation_requests for update to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (public.current_staff_role() in ('admin','manager'));

drop policy if exists trr_delete on public.table_reservation_requests;
create policy trr_delete on public.table_reservation_requests for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- ============================================================
-- 3) RPC request_table_reservation_v1 — LE CŒUR : le client envoie SA demande (anon).
--    Refait TOUTES les gardes en SQL (aucune confiance au client) :
--      · champs valides (prénom, E.164, DDN, party_size) ;
--      · soirée résolue par un SLUG PUBLIÉ (jamais un event_id brut du client) ;
--      · table existante, ACTIVE, et LIBRE au sens couche-demandes (aucune demande active dessus) ;
--      · party_size ≤ capacité SI la capacité est connue (null = à confirmer → aucun blocage inventé) ;
--      · 18+ à la date de la soirée (L.3342-1) — sinon AUCUNE entrée en base ;
--      · dédup par téléphone (upsert additif, jamais de vol d'owner, jamais de réveil d'opt-out) ;
--      · consentement journalisé (texte exact) ; le marketing ne conditionne JAMAIS la demande ;
--      · statut `pending` (jamais auto-confirmée) ; 1 demande active / client / soirée.
-- ============================================================
create or replace function public.request_table_reservation_v1(
  p_event_slug text,
  p_venue_table_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone_e164 text,
  p_birthday date,
  p_party_size integer,
  p_slot text,
  p_guest_note text,
  p_consent_service boolean,
  p_consent_service_text text,
  p_consent_marketing boolean,
  p_consent_marketing_text text
) returns table (ok boolean, code text, message text, request_id uuid, guest_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_slug text := nullif(btrim(coalesce(p_event_slug, '')), '');
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone_e164, '')), '');
  v_slot text := nullif(btrim(coalesce(p_slot, '')), '');
  v_note text := nullif(btrim(coalesce(p_guest_note, '')), '');
  v_party integer := p_party_size;
  v_svc boolean := coalesce(p_consent_service, false);
  v_mkt boolean := coalesce(p_consent_marketing, false);
  v_svc_text text := nullif(btrim(coalesce(p_consent_service_text, '')), '');
  v_mkt_text text := nullif(btrim(coalesce(p_consent_marketing_text, '')), '');
  v_now timestamptz := now();
  v_event record;
  v_table record;
  v_guest_id uuid;
  v_owner text;
  v_request_id uuid;
begin
  -- 3.1 Validation des champs (mêmes règles que lib/resaRequest, refaites en SQL) ---------------
  if v_first is null then
    return query select false, 'first_name_required', 'Le prénom est obligatoire.', null::uuid, null::uuid, null::text; return;
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return query select false, 'phone_invalid', 'Numéro de téléphone invalide.', null::uuid, null::uuid, null::text; return;
  end if;
  if p_birthday is null then
    return query select false, 'birthday_required', 'La date de naissance est obligatoire.', null::uuid, null::uuid, null::text; return;
  end if;
  if v_party is null or v_party <= 0 then
    return query select false, 'party_size_invalid', 'Le nombre de personnes est invalide.', null::uuid, null::uuid, null::text; return;
  end if;
  if v_svc and v_svc_text is null then
    return query select false, 'consent_service_text_missing', 'Texte de consentement manquant.', null::uuid, null::uuid, null::text; return;
  end if;
  if v_mkt and v_mkt_text is null then
    return query select false, 'consent_marketing_text_missing', 'Texte de consentement manquant.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.2 Résolution de la soirée par SLUG PUBLIÉ (jamais un event_id brut du client) --------------
  select id, event_date into v_event
    from public.events
   where slug = v_slug and status = 'published';
  if not found then
    return query select false, 'unknown_event', 'Soirée introuvable ou non publiée.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.3 Résolution de la table : existante + ACTIVE. Verrou pour sérialiser la garde de dispo. ---
  select id, venue, standing, capacity, active into v_table
    from public.venue_tables
   where id = p_venue_table_id
   for update;
  if not found or not v_table.active then
    return query select false, 'table_unavailable', 'Cette table n''est pas disponible.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.4 Capacité : ne bloque QUE si elle est connue (null = à confirmer → aucun blocage inventé). -
  if v_table.capacity is not null and v_party > v_table.capacity then
    return query select false, 'party_over_capacity', 'Le nombre de personnes dépasse la capacité de la table.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.5 Contrôle 18+ à la DATE DE LA SOIRÉE (L.3342-1) — refait en SQL. ---------------------------
  if p_birthday > (v_event.event_date - interval '18 years') then
    return query select false, 'underage', 'Réservation réservée aux personnes majeures.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.6 Table LIBRE au sens couche-demandes : aucune demande active (pending|approved) dessus. ----
  if exists (
    select 1 from public.table_reservation_requests r
     where r.venue_table_id = v_table.id
       and r.exploitation_date = v_event.event_date
       and r.status in ('pending','approved')
  ) then
    return query select false, 'table_taken', 'Cette table fait déjà l''objet d''une demande.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.7 Dédup par téléphone : crée OU met à jour le client de façon ADDITIVE (jamais de vol d'owner,
  --     jamais de rétrogradation d'un opt-in, jamais de réveil d'un opt-out). -----------------------
  select id, owner_promoter into v_guest_id, v_owner from public.guests where phone = v_phone;
  if v_guest_id is null then
    insert into public.guests (
      phone, first_name, last_name, birthday, majorite_verifiee,
      consent_service, consent_service_at, consent_service_text,
      consent_marketing, consent_marketing_at, consent_marketing_text,
      consent_source, owner_promoter
    ) values (
      v_phone, v_first, v_last, p_birthday, true,
      v_svc, case when v_svc then v_now end, v_svc_text,
      v_mkt, case when v_mkt then v_now end, v_mkt_text,
      'reservation', null                                -- self-résa client : pas de promoteur émetteur
    ) returning id into v_guest_id;
    v_owner := null;
  else
    update public.guests g set
      majorite_verifiee = true,
      consent_service = g.consent_service or v_svc,
      consent_service_at = case when v_svc and g.consent_service_at is null then v_now else g.consent_service_at end,
      consent_service_text = case when v_svc and g.consent_service_text is null then v_svc_text else g.consent_service_text end,
      consent_marketing = g.consent_marketing or (v_mkt and g.opt_out_at is null),
      consent_marketing_at = case when v_mkt and g.opt_out_at is null and g.consent_marketing_at is null then v_now else g.consent_marketing_at end,
      consent_marketing_text = case when v_mkt and g.opt_out_at is null and g.consent_marketing_text is null then v_mkt_text else g.consent_marketing_text end,
      updated_at = v_now
    where g.id = v_guest_id;
  end if;

  -- 3.8 Une seule demande ACTIVE par client par soirée (spec §3). ---------------------------------
  if exists (
    select 1 from public.table_reservation_requests r
     where r.guest_id = v_guest_id
       and r.exploitation_date = v_event.event_date
       and r.status in ('pending','approved')
  ) then
    return query select false, 'already_requested', 'Vous avez déjà une demande en cours pour cette soirée.', null::uuid, v_guest_id, null::text; return;
  end if;

  -- 3.9 Insert de la demande (pending). Les index uniques partiels sont le filet anti-concurrence.
  begin
    insert into public.table_reservation_requests (
      venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, standing,
      slot, guest_note, status, owner_promoter
    ) values (
      v_table.id, v_guest_id, v_event.id, v_event.event_date, v_table.venue, v_party, v_table.standing,
      v_slot, v_note, 'pending', v_owner
    ) returning id into v_request_id;
  exception when unique_violation then
    -- Course perdue sur un des index partiels (table déjà prise, ou client déjà en demande).
    return query select false, 'request_conflict', 'Une demande concurrente vient d''être enregistrée.', null::uuid, v_guest_id, null::text; return;
  end;

  return query select true, 'ok', 'Demande envoyée : un responsable la validera.', v_request_id, v_guest_id, 'pending'; return;
end;
$$;
revoke all on function public.request_table_reservation_v1(text, uuid, text, text, text, date, integer, text, text, boolean, text, boolean, text) from public;
grant execute on function public.request_table_reservation_v1(text, uuid, text, text, text, date, integer, text, text, boolean, text, boolean, text) to anon, authenticated;

-- ============================================================
-- 4) RPC decide_table_reservation_v1 — un manager VALIDE ou REFUSE une demande (authenticated).
--    approve → statut approved + upsert guest_visits « booked » (branche le flux dans le CRM,
--    idempotent) ; decline → statut declined + motif. Seule direction (admin/manager). Atomique.
-- ============================================================
create or replace function public.decide_table_reservation_v1(
  p_request_id uuid,
  p_decision text,
  p_decline_reason text
) returns table (ok boolean, code text, message text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_decision text := nullif(btrim(coalesce(p_decision, '')), '');
  v_reason text := nullif(btrim(coalesce(p_decline_reason, '')), '');
  v_req record;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorisé.', null::text; return;
  end if;
  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Validation réservée à la direction.', null::text; return;
  end if;
  if v_decision not in ('approve','decline') then
    return query select false, 'invalid_decision', 'Décision invalide.', null::text; return;
  end if;

  select * into v_req from public.table_reservation_requests where id = p_request_id for update;
  if not found then
    return query select false, 'unknown_request', 'Demande introuvable.', null::text; return;
  end if;
  if v_req.status <> 'pending' then
    return query select false, 'not_pending', 'Cette demande a déjà été traitée.', v_req.status; return;
  end if;

  if v_decision = 'approve' then
    update public.table_reservation_requests
       set status = 'approved', decided_by = v_username, decided_at = v_now, updated_at = v_now
     where id = v_req.id;
    -- Branche le flux dans le CRM : une visite « booked » (idempotente sur la clé unique 0013).
    insert into public.guest_visits (
      guest_id, event_id, exploitation_date, univers, status, party_size, is_host, created_by
    ) values (
      v_req.guest_id, v_req.event_id, v_req.exploitation_date, v_req.venue, 'booked', v_req.party_size, true, 'resa_request'
    ) on conflict (guest_id, exploitation_date, univers) do nothing;
    return query select true, 'approved', 'Demande validée.', 'approved'; return;
  else
    update public.table_reservation_requests
       set status = 'declined', decided_by = v_username, decided_at = v_now, decline_reason = v_reason, updated_at = v_now
     where id = v_req.id;
    return query select true, 'declined', 'Demande refusée.', 'declined'; return;
  end if;
end;
$$;
revoke all on function public.decide_table_reservation_v1(uuid, text, text) from public;
grant execute on function public.decide_table_reservation_v1(uuid, text, text) to authenticated;

commit;
