-- 0016_crm_no_show_cloture_verification.sql — preuve de comportement du RÈGLEMENT DES PRÉSENCES À LA
-- CLÔTURE (migration 0016) sur le LABO. À la clôture (close_club_event_v2, re-déclarée en 0016), toute
-- invitation restée EN ATTENTE de présence (booked/confirmed jamais scannée) devient no_show, et tout
-- QR d'entrée délivré mais jamais scanné (issued) devient expired — le tout DANS la même transaction
-- atomique que l'archivage/reset (règle 50 : la clôture est une opération unique).
--
-- Exécuté dans une TRANSACTION annulée (ROLLBACK) : AUCUNE donnée de test ne persiste. Cette clôture de
-- test archive l'événement actif du LABO et remet à zéro ses 18 tables — le ROLLBACK restaure TOUT.
--
-- Prouve, sur PostgreSQL réel, imposé par le MOTEUR (RLS/RPC/grants — JAMAIS par l'UI) :
--
--   (A) CANTONNEMENT PAR RÔLE (level 5) — close_club_event_v2 réservée à la DIRECTION :
--       server / security / security_counter / promoteur → unauthorized SANS muter (l'événement reste
--       actif, aucun archive, aucune visite touchée). Miroir exact de la garde SQL
--       « v_role not in ('admin','manager') ».
--   (B) CLÔTURE PAR LA DIRECTION — un MANAGER (rôle direction non-admin) clôture avec succès ; closed_by
--       vient du CONTEXTE SERVEUR (current_staff_username = lab-manager-01), jamais d'un champ client.
--   (C) RÈGLEMENT DES PRÉSENCES borné à la soirée qui se clôture (event_id = v_event_id) :
--       (C1) guest_visits booked   → no_show   ; (C2) confirmed → no_show ;
--       (C3) seated    INCHANGÉ (présence constatée au scan 0015 jamais réécrite) ;
--       (C4) cancelled INCHANGÉ (désinscription jamais réveillée) ;
--       (C5) guest_passes issued   → expired   ; (C6) scanned INCHANGÉ ; (C7) cancelled INCHANGÉ ;
--       (C8) une visite d'une AUTRE soirée reste booked (bornage : jamais touchée) ;
--       (C9) un pass  d'une AUTRE soirée reste issued (bornage : jamais touché).
--   (D) CLÔTURE COMPLÈTE inchangée vs 0008 : événement → archived ; 1 ligne event_archives ;
--       active_event_id → null ; last_closed_event_id → l'événement clôturé ; les 18 tables réinitialisées.
--   (E) ONE-SHOT / idempotence — 2ᵉ clôture (même admin) après coup → missing_active_event (plus rien à
--       clôturer, aucune double-archive).
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Fixtures = staff RÉELS du LABO ; téléphones de test +33600000301..308 (clairement de test), vérifiés
-- ABSENTS des 2050 guests LABO avant exécution (pré-check bloquant → aucun vrai client touché).
-- Événement ACTIF du LABO requis avec ses 18 tables (sinon invalid_table_count). Modèle exact de 0013/0014.

begin;

\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set security_id '8177e05b-90fa-41d8-a2ba-2468acb296f7'
\set counter_id  '635c3963-868e-449e-b005-e895b933db15'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

-- ------------------------------------------------------------
-- Helpers (pg_temp = SECURITY INVOKER : garde le rôle/jwt courant → RLS/grants s'appliquent).
-- ------------------------------------------------------------
create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual, 'NULL');
  end if;
end $$;

-- ------------------------------------------------------------
-- PRÉ-CHECK bloquant : aucun téléphone de test ne doit préexister (protège les vrais clients du LABO).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.guests
             where phone in ('+33600000301','+33600000302','+33600000303','+33600000304',
                             '+33600000305','+33600000306','+33600000307','+33600000308')) then
    raise exception 'PRÉ-CHECK : un téléphone de test préexiste — vérification ANNULÉE (ne pas toucher un vrai client)';
  end if;
end $$;

-- Événement actif requis avec ses 18 tables (sinon close renverrait missing_active_event / invalid_table_count).
do $$
declare v_active uuid; v_n int;
begin
  v_active := public.current_active_event_id();
  if v_active is null or public.current_active_event_date() is null then
    raise exception 'PRÉ-CHECK : aucun événement actif sur le LABO — impossible de prouver la clôture';
  end if;
  select count(*) into v_n from public.club_tables where event_id = v_active;
  if v_n <> 18 then
    raise exception 'PRÉ-CHECK : l''événement actif n''a pas 18 tables (%) — close refuserait (invalid_table_count)', v_n;
  end if;
end $$;

-- Capture l'événement actif + un AUTRE événement (pour prouver le bornage event_id = v_event_id).
select public.current_active_event_id()   as active_event,
       public.current_active_event_date() as active_date \gset
select id as other_event, event_date as other_date
  from public.events where id <> :'active_event' limit 1 \gset

-- ============================================================
-- FIXTURES (superuser, clairement marquées TEST) : 8 clients, chacun un scénario de statut.
-- Aucune donnée réelle : téléphones de test, prénoms préfixés TEST-.
-- ============================================================
insert into public.guests(phone, first_name, last_name, majorite_verifiee,
                          consent_service, consent_service_at, consent_service_text)
values
  ('+33600000301','TEST-Booked','Actif',   true, true, now(), 'service'),
  ('+33600000302','TEST-Confirm','Actif',  true, true, now(), 'service'),
  ('+33600000303','TEST-Seated','Actif',   true, true, now(), 'service'),
  ('+33600000304','TEST-Cancel','Actif',   true, true, now(), 'service'),
  ('+33600000305','TEST-Scanned','Actif',  true, true, now(), 'service'),
  ('+33600000306','TEST-PassCxl','Actif',  true, true, now(), 'service'),
  ('+33600000307','TEST-Booked','Autre',   true, true, now(), 'service'),
  ('+33600000308','TEST-Issued','Autre',   true, true, now(), 'service');

-- Visites de la soirée ACTIVE : booked, confirmed, seated, cancelled.
insert into public.guest_visits(guest_id, event_id, exploitation_date, univers, status, is_host, created_by)
select g.id, :'active_event', date :'active_date', 'eden',
       case g.phone when '+33600000301' then 'booked'
                    when '+33600000302' then 'confirmed'
                    when '+33600000303' then 'seated'
                    when '+33600000304' then 'cancelled' end,
       false, 'TEST'
  from public.guests g where g.phone in ('+33600000301','+33600000302','+33600000303','+33600000304');

-- Une visite d'une AUTRE soirée (booked) — doit rester INTOUCHÉE par la clôture de la soirée active.
insert into public.guest_visits(guest_id, event_id, exploitation_date, univers, status, is_host, created_by)
select g.id, :'other_event', date :'other_date', 'eden', 'booked', false, 'TEST'
  from public.guests g where g.phone = '+33600000307';

-- Pass d'entrée de la soirée ACTIVE : issued (301), scanned (305), cancelled (306).
insert into public.guest_passes(guest_id, event_id, exploitation_date, univers, qr_token, status, free_entry, is_host, scanned_at, scanned_by)
select g.id, :'active_event', date :'active_date', 'eden',
       'test-pass-' || right(g.phone,3),
       case g.phone when '+33600000301' then 'issued'
                    when '+33600000305' then 'scanned'
                    when '+33600000306' then 'cancelled' end,
       true, false,
       case g.phone when '+33600000305' then now() else null end,
       case g.phone when '+33600000305' then 'lab-security-01' else null end
  from public.guests g where g.phone in ('+33600000301','+33600000305','+33600000306');

-- Un pass d'une AUTRE soirée (issued) — doit rester INTOUCHÉ.
insert into public.guest_passes(guest_id, event_id, exploitation_date, univers, qr_token, status, free_entry, is_host)
select g.id, :'other_event', date :'other_date', 'eden', 'test-pass-308', 'issued', true, false
  from public.guests g where g.phone = '+33600000308';

-- ============================================================
-- (A) CANTONNEMENT PAR RÔLE — non-direction refusés SANS mutation.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect((select code from public.close_club_event_v2()),'unauthorized','A1 server ne clôture PAS');
select pg_temp.act_as(:'security_id');
select pg_temp.expect((select code from public.close_club_event_v2()),'unauthorized','A2 security ne clôture PAS');
select pg_temp.act_as(:'counter_id');
select pg_temp.expect((select code from public.close_club_event_v2()),'unauthorized','A3 security_counter ne clôture PAS');
select pg_temp.act_as(:'promoter_id');
select pg_temp.expect((select code from public.close_club_event_v2()),'unauthorized','A4 promoteur ne clôture PAS');

-- A5 : aucune mutation après les 4 refus — événement toujours actif, aucun archive, visite 301 toujours booked.
reset role;
select pg_temp.expect((public.current_active_event_id() = :'active_event')::text,'true','A5a événement toujours ACTIF après refus');
select pg_temp.expect((select count(*)::text from public.event_archives where event_id=:'active_event'),'0','A5b aucun archive après refus');
select pg_temp.expect((select v.status from public.guest_visits v join public.guests g on g.id=v.guest_id where g.phone='+33600000301'),'booked','A5c visite 301 intacte (booked) après refus');

-- ============================================================
-- (B) CLÔTURE PAR LA DIRECTION — un MANAGER (direction non-admin) clôture.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'manager_id');
select ok as b_ok, code as b_code, event_id as b_evt from public.close_club_event_v2() \gset
select pg_temp.expect(:'b_code','ok','B1 le manager (direction) clôture avec succès');
select pg_temp.expect(:'b_ok','t','B1b ok=true (\gset stocke le booléen "t")');
select pg_temp.expect(:'b_evt',:'active_event','B1c l''événement clôturé = l''événement qui était actif');
reset role;

-- ============================================================
-- (C) RÈGLEMENT DES PRÉSENCES — borné à la soirée clôturée.
-- ============================================================
-- C1/C2 : booked & confirmed → no_show (lapin).
select pg_temp.expect((select v.status from public.guest_visits v join public.guests g on g.id=v.guest_id where g.phone='+33600000301'),'no_show','C1 booked → no_show');
select pg_temp.expect((select v.status from public.guest_visits v join public.guests g on g.id=v.guest_id where g.phone='+33600000302'),'no_show','C2 confirmed → no_show');
-- C3/C4 : seated & cancelled INCHANGÉS (jamais réécrire une présence constatée ni une désinscription).
select pg_temp.expect((select v.status from public.guest_visits v join public.guests g on g.id=v.guest_id where g.phone='+33600000303'),'seated','C3 seated INCHANGÉ');
select pg_temp.expect((select v.status from public.guest_visits v join public.guests g on g.id=v.guest_id where g.phone='+33600000304'),'cancelled','C4 cancelled INCHANGÉ');
-- C5 : pass issued → expired ; C6/C7 : scanned & cancelled INCHANGÉS.
select pg_temp.expect((select p.status from public.guest_passes p join public.guests g on g.id=p.guest_id where g.phone='+33600000301'),'expired','C5 pass issued → expired');
select pg_temp.expect((select p.status from public.guest_passes p join public.guests g on g.id=p.guest_id where g.phone='+33600000305'),'scanned','C6 pass scanned INCHANGÉ');
select pg_temp.expect((select p.status from public.guest_passes p join public.guests g on g.id=p.guest_id where g.phone='+33600000306'),'cancelled','C7 pass cancelled INCHANGÉ');
-- C8/C9 : une AUTRE soirée n'est JAMAIS touchée (bornage event_id = v_event_id).
select pg_temp.expect((select v.status from public.guest_visits v join public.guests g on g.id=v.guest_id where g.phone='+33600000307'),'booked','C8 visite d''une AUTRE soirée reste booked (bornage)');
select pg_temp.expect((select p.status from public.guest_passes p join public.guests g on g.id=p.guest_id where g.phone='+33600000308'),'issued','C9 pass d''une AUTRE soirée reste issued (bornage)');

-- ============================================================
-- (D) CLÔTURE COMPLÈTE — inchangée vs 0008.
-- ============================================================
select pg_temp.expect((select status from public.events where id=:'active_event'),'archived','D1 événement → archived');
select pg_temp.expect((select count(*)::text from public.event_archives where event_id=:'active_event'),'1','D2 exactement 1 ligne event_archives');
select pg_temp.expect((select closed_by from public.event_archives where event_id=:'active_event'),'lab-manager-01','D2b closed_by = contexte serveur (manager)');
select pg_temp.expect((public.current_active_event_id() is null)::text,'true','D3 active_event_id → null');
select pg_temp.expect((select last_closed_event_id::text from public.club_runtime_state where id is true),:'active_event','D4 last_closed_event_id = événement clôturé');
select pg_temp.expect((select count(*)::text from public.club_tables where event_id=:'active_event'),'0','D5 les 18 tables réinitialisées (event_id null)');

-- ============================================================
-- (E) ONE-SHOT / idempotence — 2ᵉ clôture après coup refusée (plus rien à clôturer).
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect((select code from public.close_club_event_v2()),'missing_active_event','E1 2ᵉ clôture → missing_active_event (one-shot)');
reset role;
select pg_temp.expect((select count(*)::text from public.event_archives where event_id=:'active_event'),'1','E2 toujours 1 seul archive (aucune double-archive)');

select '0016 NO_SHOW/EXPIRED À LA CLÔTURE — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée, aucun vrai client touché, LABO restauré)' as resultat;

rollback;
