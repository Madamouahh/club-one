-- 0030_resa_request_anon_hardening_verification.sql — PREUVE NIVEAU 5 des 3 fixes de durcissement de la
-- RPC anon `request_table_reservation_v1` (migration 0030) sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (ROLLBACK) : la fonction 0030 est REDÉFINIE en tête de tx puis
-- REVERTÉE au rollback → le LABO retrouve la version 0025 (0030 NON persistée, en attente de revue
-- fondateur), AUCUNE fixture ne persiste (les 2050 vrais clients restent intacts).
--
-- Prouve, sur PostgreSQL réel, imposé par le MOTEUR (corps SECURITY DEFINER + rôle anon — jamais l'UI) :
--   F4  — COHÉRENCE SALLE : une table Eden demandée sur une soirée Terminus (publiée) → `venue_mismatch`
--         (0025 l'acceptait : pas de lecture de events.venue_id). Le chemin salle-cohérent → `ok`.
--   F2a — MINIMISATION : la RPC ne renvoie JAMAIS `guest_id` à l'anon (null sur ok, already_requested,
--         venue_mismatch…). L'identifiant interne stable n'est plus corrélable à un téléphone.
--   F1  — ANTI-FORGE RGPD : un appel anon avec le TÉLÉPHONE d'un client EXISTANT (consentements à false)
--         + des consentements=true et des textes fabriqués ne MODIFIE RIEN sur la fiche de la victime
--         (0025 élevait consent_service/marketing + majorité + textes + horodatages fabriqués).
--   NON-RÉGRESSION (fixtures venue-COHÉRENTES) : unknown_event / underage (aucune fiche mineur créée) /
--         table_taken / already_requested restent corrects.
--
-- ⚠️ Ce que 0030 NE traite PAS (reste BLOQUANT avant prod, DÉCISION FONDATEUR — non inventé ici) :
--    l'anti-abus de fond (saturation des tables par un anon avec des téléphones différents ; création de
--    la demande `pending` au nom d'un vrai client faute de preuve de propriété du numéro). Mécanisme à
--    trancher par le fondateur : captcha vs jeton signé par soirée vs rate-limit / OTP.
--
-- ⚠️ Constat annexe (finding de fixture) : le seul event publié du LABO (`lab-event-01`) a
--    venue_id='club-one-lab' alors que les 44 tables sont 'eden' — fixture venue-INCOHÉRENTE. La vérif
--    0025 s'appuyait dessus (A3='ok' sans garde salle) ; sous 0030, ce couple serait `venue_mismatch`
--    (comportement CORRECT). Cette preuve utilise donc des fixtures venue-COHÉRENTES (event TEST en 'eden').
--
-- Fixtures LABO (superuser, marquées TEST, ANNULÉES au rollback) : 2 events publiés TEST-0030-eden (eden)
-- / TEST-0030-terminus (terminus) au 2099-11-03 ; 1 « victime » guest existante +33600000303
-- (consentements à false) ; téléphones +33600000301/302/303 vérifiés ABSENTS des 2050 guests.
-- sub des staff_users : néant ici (le flux anon n'a pas besoin de staff ; decide_* est déjà prouvée par 0025).

begin;

-- ============================================================
-- 0) REDÉFINITION de la fonction 0030 (inline, DANS la tx → revertée au rollback).
--    Copie conforme de supabase/migrations/0030_resa_request_anon_hardening.sql (sans son begin/commit).
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

  select id, event_date, venue_id into v_event
    from public.events
   where slug = v_slug and status = 'published';
  if not found then
    return query select false, 'unknown_event', 'Soirée introuvable ou non publiée.', null::uuid, null::uuid, null::text; return;
  end if;

  select id, venue, standing, capacity, active into v_table
    from public.venue_tables
   where id = p_venue_table_id
   for update;
  if not found or not v_table.active then
    return query select false, 'table_unavailable', 'Cette table n''est pas disponible.', null::uuid, null::uuid, null::text; return;
  end if;

  if v_table.venue is distinct from v_event.venue_id then
    return query select false, 'venue_mismatch', 'Cette table n''appartient pas à la salle de cette soirée.', null::uuid, null::uuid, null::text; return;
  end if;

  if v_table.capacity is not null and v_party > v_table.capacity then
    return query select false, 'party_over_capacity', 'Le nombre de personnes dépasse la capacité de la table.', null::uuid, null::uuid, null::text; return;
  end if;

  if p_birthday > (v_event.event_date - interval '18 years') then
    return query select false, 'underage', 'Réservation réservée aux personnes majeures.', null::uuid, null::uuid, null::text; return;
  end if;

  if exists (
    select 1 from public.table_reservation_requests r
     where r.venue_table_id = v_table.id
       and r.exploitation_date = v_event.event_date
       and r.status in ('pending','approved')
  ) then
    return query select false, 'table_taken', 'Cette table fait déjà l''objet d''une demande.', null::uuid, null::uuid, null::text; return;
  end if;

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
      'reservation', null
    ) returning id into v_guest_id;
    v_owner := null;
  end if;

  if exists (
    select 1 from public.table_reservation_requests r
     where r.guest_id = v_guest_id
       and r.exploitation_date = v_event.event_date
       and r.status in ('pending','approved')
  ) then
    return query select false, 'already_requested', 'Vous avez déjà une demande en cours pour cette soirée.', null::uuid, null::uuid, null::text; return;
  end if;

  begin
    insert into public.table_reservation_requests (
      venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, standing,
      slot, guest_note, status, owner_promoter
    ) values (
      v_table.id, v_guest_id, v_event.id, v_event.event_date, v_table.venue, v_party, v_table.standing,
      v_slot, v_note, 'pending', v_owner
    ) returning id into v_request_id;
  exception when unique_violation then
    return query select false, 'request_conflict', 'Une demande concurrente vient d''être enregistrée.', null::uuid, null::uuid, null::text; return;
  end;

  return query select true, 'ok', 'Demande envoyée : un responsable la validera.', v_request_id, null::uuid, 'pending'; return;
end;
$$;
revoke all on function public.request_table_reservation_v1(text, uuid, text, text, text, date, integer, text, text, boolean, text, boolean, text) from public;
grant execute on function public.request_table_reservation_v1(text, uuid, text, text, text, date, integer, text, text, boolean, text, boolean, text) to anon, authenticated;

-- ============================================================
-- 1) Helpers d'assertion (pg_temp).
-- ============================================================
create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual, 'NULL');
  end if;
end $$;

create or replace function pg_temp.expect_no_guest(p_phone text) returns void
language plpgsql as $$
begin
  if exists (select 1 from public.guests where phone = p_phone) then
    raise exception 'ATTENDU aucun guest % créé, mais il existe', p_phone;
  end if;
end $$;

-- F1 : la fiche de la victime NE DOIT PAS avoir bougé après la tentative de forge anon.
create or replace function pg_temp.expect_victim_unchanged(p_guest uuid) returns void
language plpgsql as $$
declare g record;
begin
  select majorite_verifiee, consent_service, consent_service_at, consent_service_text,
         consent_marketing, consent_marketing_at, consent_marketing_text
    into g from public.guests where id = p_guest;
  if g.majorite_verifiee is distinct from false then
    raise exception 'F1 majorite_verifiee forgée : ATTENDU false, OBTENU %', g.majorite_verifiee; end if;
  if g.consent_service is distinct from false then
    raise exception 'F1 consent_service forgé : ATTENDU false, OBTENU %', g.consent_service; end if;
  if g.consent_service_at is not null then
    raise exception 'F1 consent_service_at forgé : ATTENDU NULL, OBTENU %', g.consent_service_at; end if;
  if g.consent_service_text is not null then
    raise exception 'F1 consent_service_text forgé : ATTENDU NULL, OBTENU "%"', g.consent_service_text; end if;
  if g.consent_marketing is distinct from false then
    raise exception 'F1 consent_marketing forgé : ATTENDU false, OBTENU %', g.consent_marketing; end if;
  if g.consent_marketing_at is not null then
    raise exception 'F1 consent_marketing_at forgé : ATTENDU NULL, OBTENU %', g.consent_marketing_at; end if;
  if g.consent_marketing_text is not null then
    raise exception 'F1 consent_marketing_text forgé : ATTENDU NULL, OBTENU "%"', g.consent_marketing_text; end if;
end $$;

-- ============================================================
-- 2) Pré-check d'ABSENCE (aucune collision avec un vrai client / event).
-- ============================================================
select pg_temp.expect_no_guest('+33600000301');
select pg_temp.expect_no_guest('+33600000302');
select pg_temp.expect_no_guest('+33600000303');
do $$ begin
  if exists (select 1 from public.events where slug like 'TEST-0030-%') then
    raise exception 'pré-check : un event TEST-0030-* existe déjà';
  end if;
end $$;

-- ============================================================
-- 3) FIXTURES (superuser, avant tout passage en rôle anon).
-- ============================================================
insert into public.events (venue_id, title, slug, event_date, status)
values ('eden',     'TEST-0030 Eden',     'TEST-0030-eden',     date '2099-11-03', 'published'),
       ('terminus', 'TEST-0030 Terminus', 'TEST-0030-terminus', date '2099-11-03', 'published');

-- Victime : client EXISTANT, tous consentements à false, jamais vérifié majeur.
insert into public.guests (
  phone, first_name, last_name, birthday, majorite_verifiee,
  consent_service, consent_service_at, consent_service_text,
  consent_marketing, consent_marketing_at, consent_marketing_text,
  consent_source, owner_promoter, opt_out_at
) values (
  '+33600000303', 'TEST-0030-Victim', 'Cible', date '1990-01-01', false,
  false, null, null,
  false, null, null,
  'test', null, null
);

-- Résolution des ids AVANT set role anon (anon n'a aucun accès direct aux tables).
select id as t704   from public.venue_tables where venue='eden' and label='704' \gset
select id as t703   from public.venue_tables where venue='eden' and label='703' \gset
select id as t107   from public.venue_tables where venue='eden' and label='107' \gset
select id as victim from public.guests where phone='+33600000303' \gset

-- ============================================================
-- 4) Appels ANON (le cœur : l'anon ne capte QUE les codes de retour, jamais guest_id).
-- ============================================================
set local role anon;

-- (1) F4 — table Eden demandée sur une soirée TERMINUS publiée → venue_mismatch (aucun effet de bord).
select code as f4mm_code,
       case when guest_id is null then 'NULL' else 'LEAK' end as f4mm_gid
from public.request_table_reservation_v1(
  'TEST-0030-terminus', :'t704'::uuid, 'Zoe', 'Test', '+33600000301', date '2000-01-01', 2, null, null,
  true, 'consentement service', false, null) \gset

-- (2) F4-ok + F2a — même table sur la BONNE salle (eden) → ok, pending, guest_id NON renvoyé.
select code as ok_code, status as ok_status,
       case when guest_id is null then 'NULL' else 'LEAK' end as ok_gid
from public.request_table_reservation_v1(
  'TEST-0030-eden', :'t704'::uuid, 'Zoe', 'Test', '+33600000301', date '2000-01-01', 2, '01:00', 'près scène',
  true, 'J''accepte d''être contacté pour le service de ma réservation.', false, null) \gset

-- (3) F2a — même client, autre table → already_requested, guest_id NON renvoyé (pas d'oracle par id).
select code as areq_code,
       case when guest_id is null then 'NULL' else 'LEAK' end as areq_gid
from public.request_table_reservation_v1(
  'TEST-0030-eden', :'t703'::uuid, 'Zoe', 'Test', '+33600000301', date '2000-01-01', 2, null, null,
  true, 'consentement service', false, null) \gset

-- (4) F1 — FORGE : téléphone de la VICTIME existante + consentements=true + textes fabriqués.
--     La demande peut naître (impersonation = anti-abus gated), mais la fiche victime NE DOIT PAS bouger.
select code as forge_code,
       case when guest_id is null then 'NULL' else 'LEAK' end as forge_gid
from public.request_table_reservation_v1(
  'TEST-0030-eden', :'t703'::uuid, 'PEU', 'IMPORTE', '+33600000303', date '1990-01-01', 2, null, null,
  true, 'TEXTE-SERVICE-FORGE', true, 'TEXTE-MARKETING-FORGE') \gset

-- (5) NON-RÉGRESSION table_taken — 704 déjà pris (par le client 301) ; le guest 302 NE DOIT PAS naître.
select code as taken_code from public.request_table_reservation_v1(
  'TEST-0030-eden', :'t704'::uuid, 'Bea', 'Autre', '+33600000302', date '1995-06-15', 2, null, null,
  true, 'consentement service', false, null) \gset

-- (6) NON-RÉGRESSION underage — mineur à la date de la soirée → underage ; guest 302 tjs absent.
select code as under_code from public.request_table_reservation_v1(
  'TEST-0030-eden', :'t107'::uuid, 'Mina', 'Mineure', '+33600000302', date '2090-01-01', 2, null, null,
  true, 'consentement service', false, null) \gset

-- (7) NON-RÉGRESSION unknown_event — slug non publié → unknown_event.
select code as unknown_code from public.request_table_reservation_v1(
  'slug-qui-nexiste-pas', :'t107'::uuid, 'Zoe', 'Test', '+33600000302', date '2000-01-01', 2, null, null,
  true, 'consentement service', false, null) \gset

reset role;

-- ============================================================
-- 5) ASSERTIONS (lues en superuser : data + fiche victime).
-- ============================================================
select pg_temp.expect(:'f4mm_code', 'venue_mismatch',    'F4  table Eden sur soirée Terminus → venue_mismatch');
select pg_temp.expect(:'f4mm_gid',  'NULL',              'F2a venue_mismatch ne renvoie pas guest_id');
select pg_temp.expect(:'ok_code',   'ok',                'F4  salle cohérente → ok');
select pg_temp.expect(:'ok_status', 'pending',           'F4  demande créée en pending');
select pg_temp.expect(:'ok_gid',    'NULL',              'F2a succès ne renvoie pas guest_id');
select pg_temp.expect(:'areq_code', 'already_requested', 'anti double-demande client');
select pg_temp.expect(:'areq_gid',  'NULL',              'F2a already_requested ne renvoie pas guest_id (anti-oracle)');
select pg_temp.expect(:'forge_code','ok',                'F1  la demande naît (impersonation = anti-abus gated)');
select pg_temp.expect(:'forge_gid', 'NULL',              'F2a forge ne renvoie pas guest_id');
select pg_temp.expect_victim_unchanged(:'victim'::uuid);  -- ← LE CŒUR F1
select pg_temp.expect(:'taken_code','table_taken',       'non-régression table_taken');
select pg_temp.expect_no_guest('+33600000302');           -- ni table_taken ni underage/unknown ne créent 302
select pg_temp.expect(:'under_code','underage',          'non-régression underage');
select pg_temp.expect(:'unknown_code','unknown_event',   'non-régression unknown_event');

select '0030 durcissement anon (F4 venue_mismatch / F2a no-guest_id / F1 anti-forge consentement) — TOUTES LES ASSERTIONS PASSENT (rollback, 0030 non persistée, aucun vrai client touché)' as resultat;

rollback;
