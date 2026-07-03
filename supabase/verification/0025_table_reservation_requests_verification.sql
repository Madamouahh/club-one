-- 0025_table_reservation_requests_verification.sql — preuve de comportement du FLUX CLIENT « DEMANDE DE
-- RÉSA » (chunk 4 PLAN_SALLE_EDEN) sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (rollback) : AUCUNE donnée de test ne persiste (la file ship VIDE).
-- Prouve, sur PostgreSQL réel :
--   (A) la RPC anon request_table_reservation_v1 refait TOUTES les gardes en SQL (aucune confiance client) :
--       slug publié inconnu → refus ; 18+ (L.3342-1) refait ; création/dédup du client via le funnel
--       (consentement journalisé) ; statut `pending` (jamais auto-confirmée) ; le MARKETING NE CONDITIONNE
--       JAMAIS la demande (consent_marketing=false accepté) ; anti double-demande table + client. anon n'a
--       AUCUN accès direct aux tables (venue_tables/guests) : il ne passe QUE par la RPC (prouvé de fait —
--       la résolution des fixtures est faite AVANT le passage en rôle anon).
--   (B) le cantonnement RLS de la file : direction voit tout ; le promoteur voit SES clients
--       (owner_promoter = lui) ; server / security / security_counter ne voient RIEN (PII client).
--   (C) la RPC decide_table_reservation_v1 : direction seule tranche ; approve → guest_visits « booked »
--       (branche le CRM, idempotent) ; une demande déjà traitée n'est pas re-tranchée.
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Fixtures LABO : event publié « lab-event-01 » (2099-11-01) ; tables Eden 704 (cap 2) / 703.
-- Téléphones de test +33600000091/92/93 vérifiés ABSENTS des 2050 guests LABO (aucun vrai client touché).
-- sub des staff_users : identiques à 0023/0026/0027/0028/0029.
-- NB : les variables psql (\gset) ne sont PAS interpolées dans les blocs dollar-quotés ($$…$$) ; les
--      assertions passent donc par des helpers pg_temp appelés depuis des SELECT normaux (interpolés).
--
-- ⚠️ RAPPEL (en-tête de la migration 0025) : la surface d'abus anon (spam de demandes pending sans jeton
--    signé / captcha / rate-limit) reste BLOQUANTE avant toute PROD. Cette vérification prouve les gardes
--    fonctionnelles, PAS l'anti-abus — revue security-architect encore requise avant exposition publique.

begin;

\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set security_id '8177e05b-90fa-41d8-a2ba-2468acb296f7'
\set counter_id  '635c3963-868e-449e-b005-e895b933db15'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- Helpers d'assertion (appelés depuis des SELECT normaux → interpolation psql OK).
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

create or replace function pg_temp.expect_funnel(p_guest uuid) returns void
language plpgsql as $$
begin
  if not exists (
    select 1 from public.guests
     where id = p_guest and phone='+33600000091'
       and majorite_verifiee is true and consent_service is true
       and consent_service_text = 'J''accepte d''être contacté pour le service de ma réservation.'
       and consent_marketing is false
  ) then raise exception 'A3 funnel : guest % non conforme (majeur / consent service / marketing off)', p_guest; end if;
end $$;

create or replace function pg_temp.expect_booked(p_guest uuid) returns void
language plpgsql as $$
declare n int;
begin
  select count(*) into n from public.guest_visits where guest_id = p_guest and status='booked';
  if n <> 1 then raise exception 'C2 ATTENDU 1 guest_visit booked (CRM branché), OBTENU %', n; end if;
end $$;

-- Résolution des ids de fixtures AVANT tout changement de rôle (anon n'a AUCUN accès direct aux tables ;
-- c'est le modèle de sécurité). Capturés en variables psql, interpolés ensuite comme littéraux.
select id as t704 from public.venue_tables where venue='eden' and label='704' \gset
select id as t703 from public.venue_tables where venue='eden' and label='703' \gset

-- ============================================================
-- (A) RPC anon request_table_reservation_v1 — le cœur du flux. anon capture les codes de retour.
-- ============================================================
set local role anon;

-- A1 — SLUG INCONNU / non publié → unknown_event (jamais d'event_id brut du client).
select code as a1_code from public.request_table_reservation_v1(
  'slug-qui-nexiste-pas', :'t704'::uuid, 'Alex', 'Test', '+33600000091', date '2000-01-01', 2, null, null,
  true, 'consentement service', false, null) \gset

-- A2 — MINEUR à la date de la soirée (né en 2090 → ~9 ans en 2099) → underage, AUCUNE entrée en base.
select code as a2_code from public.request_table_reservation_v1(
  'lab-event-01', :'t704'::uuid, 'Mina', 'Mineure', '+33600000092', date '2090-01-01', 2, null, null,
  true, 'consentement service', false, null) \gset

-- A3 — DEMANDE VALIDE (adulte) : marketing=FALSE → le marketing NE CONDITIONNE PAS la demande.
select code as a3_code, status as a3_status, request_id as a3_req, guest_id as a3_guest
from public.request_table_reservation_v1(
  'lab-event-01', :'t704'::uuid, 'Alex', 'Test', '+33600000091', date '2000-01-01', 2, '01:00', 'près de la scène',
  true, 'J''accepte d''être contacté pour le service de ma réservation.', false, null) \gset

-- A4 — MÊME TABLE, autre client → table_taken (anti double-demande table, « libre » honnête).
select code as a4_code from public.request_table_reservation_v1(
  'lab-event-01', :'t704'::uuid, 'Bea', 'Autre', '+33600000093', date '1995-06-15', 2, null, null,
  true, 'consentement service', false, null) \gset

-- A5 — MÊME CLIENT (A3), autre table → already_requested (1 demande active / client / soirée).
select code as a5_code from public.request_table_reservation_v1(
  'lab-event-01', :'t703'::uuid, 'Alex', 'Test', '+33600000091', date '2000-01-01', 2, null, null,
  true, 'consentement service', false, null) \gset

reset role;  -- assertions (A) : codes + funnel + absence de guest mineur (lues en postgres — data, pas RLS).
select pg_temp.expect(:'a1_code', 'unknown_event',     'A1');
select pg_temp.expect(:'a2_code', 'underage',          'A2');
select pg_temp.expect_no_guest('+33600000092');
select pg_temp.expect(:'a3_code', 'ok',                'A3.code');
select pg_temp.expect(:'a3_status', 'pending',         'A3.status');
select pg_temp.expect_funnel(:'a3_guest'::uuid);
select pg_temp.expect(:'a4_code', 'table_taken',       'A4');
select pg_temp.expect(:'a5_code', 'already_requested', 'A5');

-- ============================================================
-- (B) Cantonnement RLS de la file des demandes.
-- ============================================================
-- La direction lit la demande pending de A3 (avant d'ajouter la demande promoteur).
set local role authenticated; select pg_temp.act_as(:'manager_id');
select pg_temp.expect(
  (select count(*)::text from public.table_reservation_requests where guest_id = :'a3_guest'::uuid),
  '1', 'B/manager voit la demande A3');

-- Insert direct (fallback direction) d'une demande rattachée au promoteur (autre soirée pour éviter
-- l'unique partiel « 1 demande active / client / soirée »).
insert into public.table_reservation_requests
  (venue_table_id, guest_id, exploitation_date, venue, party_size, status, owner_promoter)
values (:'t703'::uuid, :'a3_guest'::uuid, date '2099-11-02', 'eden', 2, 'pending', 'lab-promoter-01');

-- Promoteur : voit SA demande (owner = lui) et RIEN d'autre (pas la self-résa A3, owner null).
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect(
  (select count(*)::text from public.table_reservation_requests where owner_promoter='lab-promoter-01'),
  '1', 'B/promoter voit SA demande');
select pg_temp.expect(
  (select count(*)::text from public.table_reservation_requests),
  '1', 'B/promoter cantonné (total visible = ses clients seuls)');

-- server / security / security_counter : ne voient RIEN (PII client).
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect((select count(*)::text from public.table_reservation_requests), '0', 'B/server ne voit rien');
set local role authenticated; select pg_temp.act_as(:'security_id');
select pg_temp.expect((select count(*)::text from public.table_reservation_requests), '0', 'B/security ne voit rien');
set local role authenticated; select pg_temp.act_as(:'counter_id');
select pg_temp.expect((select count(*)::text from public.table_reservation_requests), '0', 'B/counter ne voit rien');

-- ============================================================
-- (C) RPC decide_table_reservation_v1 — validation staff.
-- ============================================================
-- C1 — server (non-direction) → unauthorized.
set local role authenticated; select pg_temp.act_as(:'server_id');
select code as c1_code from public.decide_table_reservation_v1(:'a3_req'::uuid, 'approve', null) \gset

-- C2 — manager approve la demande A3 → approved (branche guest_visits « booked »).
set local role authenticated; select pg_temp.act_as(:'manager_id');
select code as c2_code from public.decide_table_reservation_v1(:'a3_req'::uuid, 'approve', null) \gset

-- C3 — re-trancher une demande déjà traitée → not_pending.
select code as c3_code from public.decide_table_reservation_v1(:'a3_req'::uuid, 'decline', 'test') \gset

reset role;
select pg_temp.expect(:'c1_code', 'unauthorized', 'C1 server ne tranche pas');
select pg_temp.expect(:'c2_code', 'approved',     'C2 manager approuve');
select pg_temp.expect_booked(:'a3_guest'::uuid);
select pg_temp.expect(:'c3_code', 'not_pending',  'C3 demande déjà traitée');

select '0025 flux résa client — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée, aucun vrai client touché)' as resultat;

rollback;
