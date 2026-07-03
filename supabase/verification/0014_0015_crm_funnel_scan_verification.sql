-- 0014_0015_crm_funnel_scan_verification.sql — preuve de comportement du FUNNEL QR (0014) + SCAN PORTE (0015)
-- sur le LABO. Le funnel est le CŒUR de la capture client : un promoteur génère un lien/QR, le client
-- s'inscrit LUI-MÊME (RPC anon), reçoit un QR d'entrée personnel, et sa présence se constate au scan porte.
--
-- Exécuté dans une TRANSACTION annulée (ROLLBACK) : AUCUNE donnée de test ne persiste (le CRM ship VIDE).
-- Prouve, sur PostgreSQL réel, imposé par le MOTEUR (RLS/RPC/grants — JAMAIS par l'UI) :
--
--   (A) create_invite_link_v1 (authenticated) — CANTONNEMENT PAR RÔLE + provenance serveur :
--       promoteur/direction créent ; server & security REFUSÉS (unauthorized) ; team_vip SANS table
--       refusé (table_required) ; team_vip AVEC table accepté ; created_by vient du CONTEXTE SERVEUR
--       (current_staff_username), jamais d'un champ client.
--   (B) ISOLATION ANON — anon n'a AUCUN accès direct aux tables (invite_links/guest_passes/guests) ;
--       anon ne peut PAS exécuter create_invite_link_v1 ni scan_guest_pass_v1 (grant authenticated seul) ;
--       anon PEUT exécuter les deux seules RPC publiques (get_invite_link_public, register_guest_via_invite_v1).
--   (C) get_invite_link_public (anon) — vue SÛRE : lien valide → valid=true + champs d'affichage ;
--       la signature n'expose NI created_by NI donnée client ; token inconnu/vide → valid=false.
--   (D) register_guest_via_invite_v1 (anon) — LE CŒUR, toutes les gardes refaites en SQL :
--       (D1) le client s'inscrit LUI-MÊME sous le rôle DB `anon` (bout-en-bout) ; (D2) 18+ imposé à la
--       DATE DE LA SOIRÉE — un mineur ne crée AUCUNE ligne ; (D3) téléphone non-E.164 refusé ;
--       (D4) case marketing cochée sans texte → refus (preuve CNIL du texte exact) ; (D5) la case
--       marketing ne conditionne JAMAIS la délivrance du QR (entrée gratuite même sans opt-in) ;
--       (D6) idempotence : re-inscription même lien = MÊME QR, sans reconsommer le quota ; (D7) quota
--       épuisé refusé (link_exhausted) ; (D8) lien expiré refusé ; (D9) owner_promoter vient du LIEN
--       et n'est JAMAIS volé à un promoteur propriétaire d'un client déjà connu ; (D10) team_vip = hôte
--       (is_host) ; (D11) consentement marketing journalisé avec le texte exact.
--   (E) scan_guest_pass_v1 (0015) — SCAN PORTE : rôle porte imposé (admin/manager/security/counter) —
--       promoteur & server REFUSÉS ; 1ᵉʳ scan → pass=scanned + visite=seated (présence AUTO) + 1 entry_log
--       (compteur Flux juste) ; re-scan idempotent (aucun double comptage) ; QR inconnu / d'une autre
--       soirée (anti-recyclage) / annulé → refusés.
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Fixtures = staff RÉELS du LABO ; téléphones de test +33600000201..211 (clairement de test), vérifiés
-- ABSENTS des 2050 guests LABO avant exécution (pré-check bloquant → aucun vrai client touché).
-- Événement ACTIF du LABO requis (le funnel/scan lisent current_active_event_*). Modèle exact de 0013.
-- Textes de consentement NEUTRES (aucune mention d'alcool — loi Évin).

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

create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual, 'NULL');
  end if;
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'error:' || sqlstate;
end $$;

create or replace function pg_temp.expect_err(p_actual text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is null or p_actual not like 'error:%' then
    raise exception '% ATTENDU un REFUS, OBTENU "%"', p_label, coalesce(p_actual, 'NULL');
  end if;
end $$;

-- ------------------------------------------------------------
-- PRÉ-CHECK bloquant : aucun téléphone de test ne doit préexister (protège les 2050 vrais clients).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.guests
             where phone in ('+33600000201','+33600000202','+33600000203','+33600000204',
                             '+33600000205','+33600000206','+33600000207','+33600000208',
                             '+33600000209','+33600000210','+33600000211')) then
    raise exception 'PRÉ-CHECK : un téléphone de test préexiste — vérification ANNULÉE (ne pas toucher un vrai client)';
  end if;
end $$;

-- Événement actif requis (sinon le funnel/scan renverraient missing_active_event → test non concluant).
do $$
begin
  if public.current_active_event_id() is null or public.current_active_event_date() is null then
    raise exception 'PRÉ-CHECK : aucun événement actif sur le LABO — impossible de prouver le funnel';
  end if;
end $$;

-- ============================================================
-- (A) create_invite_link_v1 — cantonnement par rôle + created_by = contexte serveur.
-- ============================================================
-- A1 : le promoteur crée un lien guest_list eden (max 20 usages) — capture token/id.
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select code as a_gl_code, token as tok_gl, link_id as lid_gl
  from public.create_invite_link_v1('guest_list','eden',null,20,null) \gset
select pg_temp.expect(:'a_gl_code','ok','A1 promoteur crée un lien guest_list');

-- A1b : created_by est bien le username SERVEUR de l'émetteur, jamais un champ client.
reset role;
select pg_temp.expect((select created_by from public.invite_links where token=:'tok_gl'),
  'lab-promoter-01','A1b created_by = current_staff_username (contexte serveur)');

-- A2/A3 : server & security ne créent PAS de lien (unauthorized renvoyé par la RPC).
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect((select code from public.create_invite_link_v1('guest_list','eden',null,1,null)),
  'unauthorized','A2 server ne crée PAS de lien');
select pg_temp.act_as(:'security_id');
select pg_temp.expect((select code from public.create_invite_link_v1('guest_list','eden',null,1,null)),
  'unauthorized','A3 security ne crée PAS de lien');

-- A4 : team_vip SANS table = refusé ; A5 : team_vip AVEC table = accepté (admin) — capture tok_vip.
select pg_temp.act_as(:'admin_id');
select pg_temp.expect((select code from public.create_invite_link_v1('team_vip','eden',null,5,null)),
  'table_required','A4 team_vip sans table refusé (anti-gaming)');
select code as a_vip_code, token as tok_vip
  from public.create_invite_link_v1('team_vip','eden','T12',5,null) \gset
select pg_temp.expect(:'a_vip_code','ok','A5 team_vip avec table accepté');

-- A6 : liens de service pour les tests D — un lien à quota 1 et un lien expiré (admin).
select token as tok_q1  from public.create_invite_link_v1('guest_list','eden',null,1,null) \gset
select token as tok_exp from public.create_invite_link_v1('guest_list','eden',null,20, now() - interval '1 hour') \gset

-- ============================================================
-- (B) ISOLATION ANON — grants au niveau catalogue (ne dépend d'aucune UI).
-- ============================================================
reset role;
select pg_temp.expect(has_table_privilege('anon','public.invite_links','select')::text,'false',
  'B1 anon n''a AUCUN SELECT direct sur invite_links');
select pg_temp.expect(has_table_privilege('anon','public.guest_passes','select')::text,'false',
  'B2 anon n''a AUCUN SELECT direct sur guest_passes');
select pg_temp.expect(has_table_privilege('anon','public.guests','select')::text,'false',
  'B3 anon n''a AUCUN SELECT direct sur guests (PII)');
select pg_temp.expect(has_function_privilege('anon','public.create_invite_link_v1(text,text,text,integer,timestamptz)','execute')::text,'false',
  'B4 anon ne peut PAS exécuter create_invite_link_v1');
select pg_temp.expect(has_function_privilege('anon','public.scan_guest_pass_v1(text)','execute')::text,'false',
  'B5 anon ne peut PAS exécuter scan_guest_pass_v1 (scan = staff porte)');
select pg_temp.expect(has_function_privilege('anon','public.get_invite_link_public(text)','execute')::text,'true',
  'B6 anon PEUT lire un lien public (RPC sûre)');
select pg_temp.expect(has_function_privilege('anon','public.register_guest_via_invite_v1(text,text,text,text,date,boolean,text,boolean,text)','execute')::text,'true',
  'B7 anon PEUT s''inscrire lui-même (RPC funnel)');

-- ============================================================
-- (C) get_invite_link_public — vue SÛRE lue sous le rôle DB `anon`.
-- ============================================================
set local role anon; select pg_temp.as_anon();
select pg_temp.expect((select valid::text  from public.get_invite_link_public(:'tok_gl')),'true','C1 anon lit un lien valide');
select pg_temp.expect((select univers      from public.get_invite_link_public(:'tok_gl')),'eden','C1b univers exposé pour l''affichage');
select pg_temp.expect((select kind         from public.get_invite_link_public(:'tok_gl')),'guest_list','C1c kind exposé pour l''affichage');
select pg_temp.expect((select valid::text  from public.get_invite_link_public('token-inexistant-zzz')),'false','C2 token inconnu → valid=false');
select pg_temp.expect((select valid::text  from public.get_invite_link_public('')),'false','C3 token vide → valid=false');
reset role;

-- ============================================================
-- (D) register_guest_via_invite_v1 — LE CŒUR, sous le rôle DB `anon`.
-- ============================================================
-- Fixture (D9) : un client DÉJÀ connu, propriété d'un AUTRE promoteur (setup superuser, marqué TEST).
insert into public.guests(phone, first_name, last_name, owner_promoter, majorite_verifiee,
                          consent_service, consent_service_at, consent_service_text)
values ('+33600000210','TEST-Preexist','Autre','TEST-autre-promoteur', true, true, now(), 'service');

set local role anon; select pg_temp.as_anon();

-- D1 : le client s'inscrit LUI-MÊME (bout-en-bout sous rôle anon), marketing=FALSE → capture qr1.
select code as d1_code, qr_token as qr1 from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-Anon201','User','+33600000201', date '1990-01-01',
  true, 'J''accepte le service de réservation de Club One.', false, null) \gset
select pg_temp.expect(:'d1_code','ok','D1 anon s''inscrit LUI-MÊME (end-to-end sous rôle anon)');

-- D2 : mineur à la date de la soirée (né 2085) → refusé, AUCUNE ligne créée.
select pg_temp.expect((select code from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-Mineur','User','+33600000202', date '2085-01-01',
  true,'service', false, null)),'underage','D2 mineur refusé (L.3342-1, contrôle SQL)');

-- D3 : téléphone non-E.164 → refusé.
select pg_temp.expect((select code from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-BadPhone','User','0612000000', date '1990-01-01',
  true,'service', false, null)),'phone_invalid','D3 téléphone non-E.164 refusé');

-- D4 : case marketing cochée SANS texte → refusé (preuve CNIL du texte exact présenté).
select pg_temp.expect((select code from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-NoText','User','+33600000211', date '1990-01-01',
  true,'service', true, null)),'consent_marketing_text_missing','D4 marketing sans texte refusé');

-- D6 : idempotence — re-inscription du MÊME téléphone sur le MÊME lien = MÊME QR, sans reconso.
select code as d6_code, qr_token as qr1b from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-Anon201','User','+33600000201', date '1990-01-01',
  true,'service', false, null) \gset
select pg_temp.expect(:'d6_code','already_registered','D6 re-inscription même lien = already_registered');
select pg_temp.expect(:'qr1b', :'qr1', 'D6b re-inscription renvoie le MÊME QR (aucun nouveau pass)');

-- D7 : quota épuisé — lien à 1 usage : 1ʳᵉ inscription OK, 2ᵉ (autre personne) refusée.
select pg_temp.expect((select code from public.register_guest_via_invite_v1(
  :'tok_q1','TEST-Q205','User','+33600000205', date '1990-01-01',
  true,'service', false, null)),'ok','D7a 1ʳᵉ inscription consomme le quota (1/1)');
select pg_temp.expect((select code from public.register_guest_via_invite_v1(
  :'tok_q1','TEST-Q206','User','+33600000206', date '1990-01-01',
  true,'service', false, null)),'link_exhausted','D7b quota épuisé refusé');

-- D8 : lien expiré → refusé (aucune ligne créée).
select pg_temp.expect((select code from public.register_guest_via_invite_v1(
  :'tok_exp','TEST-Exp207','User','+33600000207', date '1990-01-01',
  true,'service', false, null)),'link_expired','D8 lien expiré refusé');

-- D9 : owner_promoter NON volé — 210 est déjà à TEST-autre-promoteur ; l'inscription via un lien de
--      lab-promoter-01 réussit mais NE CHANGE PAS le propriétaire.
select pg_temp.expect((select code from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-Preexist','Autre','+33600000210', date '1990-01-01',
  true,'service', false, null)),'ok','D9 inscription d''un client déjà connu réussit');

-- D10 : team_vip → l'inscrit est HÔTE (capture qr_host).
select code as d10_code, qr_token as qr_host from public.register_guest_via_invite_v1(
  :'tok_vip','TEST-Host209','User','+33600000209', date '1990-01-01',
  true,'service', false, null) \gset
select pg_temp.expect(:'d10_code','ok','D10 inscription team_vip (hôte)');

-- D11 : consentement marketing journalisé avec le texte EXACT.
select pg_temp.expect((select code from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-Mkt208','User','+33600000208', date '1990-01-01',
  true,'service', true,'J''accepte de recevoir les actualités de Club One par message.')),
  'ok','D11 inscription avec opt-in marketing');

-- Passes pour la section scan (E) : deux inscriptions supplémentaires sur tok_gl (wrong_event, cancelled).
select code as d_w_code, qr_token as qr_wrong from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-Wrong203','User','+33600000203', date '1990-01-01', true,'service', false, null) \gset
select pg_temp.expect(:'d_w_code','ok','D(scan-setup) inscription 203 → pass wrong_event');
select code as d_c_code, qr_token as qr_cancel from public.register_guest_via_invite_v1(
  :'tok_gl','TEST-Cancel204','User','+33600000204', date '1990-01-01', true,'service', false, null) \gset
select pg_temp.expect(:'d_c_code','ok','D(scan-setup) inscription 204 → pass cancelled');

reset role;

-- --- Inspections d'état (superuser : voit tout ; c'est de l'inspection, pas la preuve de sécurité) ---
-- D5 : la case marketing NE conditionne PAS le QR — 201 a marketing=false ET un pass free_entry=true.
select pg_temp.expect((select consent_marketing::text from public.guests where phone='+33600000201'),'false',
  'D5a 201 opt-in marketing = false');
select pg_temp.expect((select count(*)::text from public.guest_passes p join public.guests g on g.id=p.guest_id
  where g.phone='+33600000201' and p.free_entry),'1','D5b 201 a bien un QR entrée gratuite (marketing non requis)');

-- D2 : aucun mineur en base.
select pg_temp.expect((select count(*)::text from public.guests where phone='+33600000202'),'0',
  'D2b mineur : AUCUNE ligne guest créée');
-- D8 : lien expiré → aucune ligne 207.
select pg_temp.expect((select count(*)::text from public.guests where phone='+33600000207'),'0',
  'D8b lien expiré : AUCUNE ligne guest créée');

-- D6 : quota tok_gl consommé exactement 5 fois (201,203,204,208,210 ; re-inscription 201 = 0 conso).
select pg_temp.expect((select uses_count::text from public.invite_links where token=:'tok_gl'),'5',
  'D6c quota tok_gl = 5 (idempotence : re-inscription ne reconsomme pas)');

-- D9 : propriété non volée.
select pg_temp.expect((select owner_promoter from public.guests where phone='+33600000210'),'TEST-autre-promoteur',
  'D9b owner_promoter NON volé (reste au promoteur d''origine)');

-- D10 : hôte + source qr_team.
select pg_temp.expect((select is_host::text from public.guest_passes where qr_token=:'qr_host'),'true',
  'D10b pass 209 = hôte');
select pg_temp.expect((select consent_source from public.guests where phone='+33600000209'),'qr_team',
  'D10c source 209 = qr_team');

-- D11 : texte de consentement journalisé à l'identique + horodaté.
select pg_temp.expect((select consent_marketing::text from public.guests where phone='+33600000208'),'true',
  'D11b 208 opt-in marketing = true');
select pg_temp.expect((select consent_marketing_text from public.guests where phone='+33600000208'),
  'J''accepte de recevoir les actualités de Club One par message.','D11c texte marketing journalisé à l''identique');
select pg_temp.expect((select (consent_marketing_at is not null)::text from public.guests where phone='+33600000208'),'true',
  'D11d consent_marketing_at horodaté');

-- Visite « booked » créée à l'inscription (avant scan) pour 201.
select pg_temp.expect((select status from public.guest_visits v join public.guests g on g.id=v.guest_id
  where g.phone='+33600000201'),'booked','D(visite) 201 = booked avant scan');

-- ============================================================
-- (E) scan_guest_pass_v1 (0015) — SCAN PORTE.
-- ============================================================
-- Scaffolding (superuser, clairement marqué) : casser volontairement 2 passes pour tester les refus.
update public.guest_passes set event_id = null where qr_token=:'qr_wrong';   -- → wrong_event (null is distinct from actif)
update public.guest_passes set status   = 'cancelled'      where qr_token=:'qr_cancel';    -- → pass_cancelled
select count(*) as base_el from public.entry_logs \gset

-- E1/E2 : rôle porte imposé — promoteur & server (hors rôle porte) refusés, sans muter le pass.
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect((select code from public.scan_guest_pass_v1(:'qr1')),'unauthorized','E1 promoteur (hors porte) refusé');
select pg_temp.act_as(:'server_id');
select pg_temp.expect((select code from public.scan_guest_pass_v1(:'qr1')),'unauthorized','E2 server (hors porte) refusé');

-- E3 : 1ᵉʳ scan valide par security → présence AUTO.
select pg_temp.act_as(:'security_id');
select pg_temp.expect((select code from public.scan_guest_pass_v1(:'qr1')),'ok','E3 security scanne → entrée validée');
reset role;
select pg_temp.expect((select status from public.guest_passes where qr_token=:'qr1'),'scanned','E3a pass → scanned');
select pg_temp.expect((select scanned_by from public.guest_passes where qr_token=:'qr1'),'lab-security-01','E3b scanned_by = portier');
select pg_temp.expect((select status from public.guest_visits v join public.guests g on g.id=v.guest_id
  where g.phone='+33600000201'),'seated','E3c visite → seated (présence AUTO)');
select pg_temp.expect((select count(*)::text from public.entry_logs),(:base_el + 1)::text,'E3d +1 entry_log (compteur Flux juste)');

-- E4 : re-scan idempotent (aucun double comptage).
set local role authenticated; select pg_temp.act_as(:'security_id');
select pg_temp.expect((select code from public.scan_guest_pass_v1(:'qr1')),'already_scanned','E4 re-scan idempotent');
reset role;
select pg_temp.expect((select count(*)::text from public.entry_logs),(:base_el + 1)::text,'E4a re-scan ne double PAS le compteur');

-- E5/E6/E7 : QR inconnu / d'une autre soirée (anti-recyclage) / annulé → refusés.
set local role authenticated; select pg_temp.act_as(:'security_id');
select pg_temp.expect((select code from public.scan_guest_pass_v1('qr-inexistant-zzz')),'unknown_pass','E5 QR inconnu refusé');
select pg_temp.expect((select code from public.scan_guest_pass_v1(:'qr_wrong')),'wrong_event','E6 QR d''une autre soirée refusé (anti-recyclage)');
select pg_temp.expect((select code from public.scan_guest_pass_v1(:'qr_cancel')),'pass_cancelled','E7 QR annulé refusé');

reset role;
select '0014+0015 FUNNEL QR + SCAN PORTE — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée, aucun vrai client touché)' as resultat;

rollback;
