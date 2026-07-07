#!/usr/bin/env bash
# labo_e2e_setup.sh — prépare le LABO local (Docker club-one-lab) pour l'E2E Playwright.
# LABO UNIQUEMENT — jamais la production. Idempotent. Réversible via labo_e2e_teardown.sh.
#
# Fait : (1) port-forward Kong (host:8321 -> kong:8000, socat), (2) mots de passe de TEST sur les
# comptes staff du LABO, (3) fixtures marquées 'E2E-FIXTURE' (guest + PIN + events publiés + token).
# Aucune de ces données n'est un vrai secret. Tout est supprimé par le teardown.
set -euo pipefail

CID=supabase_db_club-one-lab
NET=supabase_network_club-one-lab
TESTPASS='E2ELabPass!23'
GUEST_TOKEN='11111111-1111-1111-1111-111111111111'
GUEST_PHONE='+33600000061'
GUEST_PIN='1234'
# Guest DÉDIÉ à la Vague 7 (E4 demande de résa) : token stable JAMAIS tourné par un autre spec
# (portal.spec fait tourner le token du guest principal via recover_guest_access_v1). Ordre-indépendant.
RESA_TOKEN='22222222-2222-2222-2222-222222222222'
RESA_PHONE='+33600000062'
RESA_PIN='1234'

echo "== 0. reset des données E2E précédentes (idempotence : chaque run part propre) =="
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
-- Ordre de suppression = ordre des dépendances FK (enfants avant parents).
delete from public.message_queue where dedup_key like 'e2e%' or to_address = '+33600000099';
delete from public.promo_redemptions where promo_code_id in (select id from public.promo_codes where code like 'E2E%');
delete from public.promo_codes where code like 'E2E%';
delete from public.campaign_audiences where segment_key like 'e2e%';
delete from public.campaign_audiences where campaign_id in (select id from public.marketing_campaigns where name like 'E2E%');
delete from public.table_server_assignments where assigned_by in ('lab-admin-01','lab-manager-01');
delete from public.contact_requests where subject like 'E2E-%' or subject like 'Demande de réservation%';
-- Vague 7 (E4/E5) : demandes de résa client + invitations nominatives de test → idempotence des runs.
delete from public.table_reservation_requests where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'));
delete from public.guest_passes where invite_link_id is null and guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'));
delete from public.tasks where title like 'E2E-%';
-- Vague 8 (/staff + workflow RH) : notifs → shifts → membre de test (enfants FK avant parents).
delete from public.staff_notifications where staff_username in ('server','lab-manager-01');
delete from public.staff_shifts where staff_member_id in (select id from public.staff_members where username='server');
delete from public.staff_members where username='server';
delete from public.checklist_items where label like 'E2E-%';
delete from public.shot_list_items where label like 'E2E-%';
-- Enfants de guests/events AVANT events/guests.
delete from public.loyalty_ledger where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'));
delete from public.loyalty_accounts where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'));
delete from public.guest_notes where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'));
delete from public.guest_visits where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'))
   or event_id in (select id from public.events where slug like 'e2e-fixture-%' or title like 'E2E-%');
-- Journal d'audit rattaché aux events de fixture (créé par les décisions de résa auditées) — avant les events.
delete from public.audit_log where event_id in (select id from public.events where slug like 'e2e-fixture-%' or title like 'E2E-%');
-- Maintenant events puis guests (plus aucun guest_visit ne les référence).
delete from public.events where slug like 'e2e-fixture-%' or title like 'E2E-%';
delete from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072') or first_name like 'E2E%';
SQL
echo "   données E2E précédentes purgées"

echo "== 1. port-forward Kong (socat host:8321 -> kong:8000) =="
if ! docker ps --format '{{.Names}}' | grep -q '^labfwd54321$'; then
  docker run -d --name labfwd54321 --network "$NET" -p 127.0.0.1:8321:8000 \
    alpine/socat:latest TCP-LISTEN:8000,fork,reuseaddr TCP:supabase_kong_club-one-lab:8000 >/dev/null
fi
for i in $(seq 1 10); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8321/auth/v1/health)" = "200" ] && break || sleep 1
done
echo "   forward OK (http $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8321/auth/v1/health))"

echo "== 2. mots de passe de TEST sur les comptes staff du LABO =="
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
update auth.users
   set encrypted_password = extensions.crypt('${TESTPASS}', extensions.gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
 where email in ('lab-admin-01@clubone.local','lab-manager-01@clubone.local',
                 'lab-promoter-01@clubone.local','server@clubone.local',
                 'lab-security-01@clubone.local','lab-counter-01@clubone.local');
SQL
echo "   6 comptes de test prêts (mdp: ${TESTPASS})"

echo "== 3. fixtures E2E (guest + PIN + events publiés) — marquées E2E-FIXTURE =="
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
-- Guest de test avec token valide + expiry futur + PIN bcrypt.
insert into public.guests (phone, first_name, last_name, majorite_verifiee, space_token, space_token_expires_at, access_pin_hash)
values ('${GUEST_PHONE}', 'E2E', 'FIXTURE', true, '${GUEST_TOKEN}'::uuid, now() + interval '180 days',
        extensions.crypt('${GUEST_PIN}', extensions.gen_salt('bf')))
on conflict (phone) do update
   set space_token = excluded.space_token,
       space_token_expires_at = excluded.space_token_expires_at,
       access_pin_hash = excluded.access_pin_hash;

-- Guest DÉDIÉ Vague 7 (E4) : token stable, jamais tourné par un autre spec.
insert into public.guests (phone, first_name, last_name, majorite_verifiee, space_token, space_token_expires_at, access_pin_hash)
values ('${RESA_PHONE}', 'E2E', 'RESA', true, '${RESA_TOKEN}'::uuid, now() + interval '180 days',
        extensions.crypt('${RESA_PIN}', extensions.gen_salt('bf')))
on conflict (phone) do update
   set space_token = excluded.space_token,
       space_token_expires_at = excluded.space_token_expires_at,
       access_pin_hash = excluded.access_pin_hash;

-- Events publiés du mois courant pour les 3 univers (agenda client + filtres + détail).
insert into public.events (venue_id, title, slug, event_date, status, description)
values ('eden','E2E-FIXTURE Eden','e2e-fixture-eden', date_trunc('month', current_date) + interval '14 days', 'published','Soiree test Eden'),
       ('cercle','E2E-FIXTURE Cercle','e2e-fixture-cercle', date_trunc('month', current_date) + interval '15 days', 'published','Soiree test Cercle'),
       ('terminus','E2E-FIXTURE Terminus','e2e-fixture-terminus', date_trunc('month', current_date) + interval '16 days', 'published','Soiree test Terminus')
on conflict (slug) do update set status = 'published', event_date = excluded.event_date;
-- Une soirée PASSÉE (pour l'attribution de dépense : univers résolu, date non future).
insert into public.events (venue_id, title, slug, event_date, status, description)
values ('eden','E2E-FIXTURE Past','e2e-fixture-past', '2026-07-01'::date, 'published','Soiree passee test')
on conflict (slug) do update set event_date = '2026-07-01'::date, status = 'published';
SQL
echo "   guest token=${GUEST_TOKEN} pin=${GUEST_PIN} ; 3 events futurs + 1 passé (attribution dépense)"

echo "== 3b. doublons CRM (même email) + historique sur le doublon, pour la fusion =="
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
-- Deux fiches partageant le même email → détectées comme doublon ; la plus ancienne est conservée.
insert into public.guests (phone, first_name, last_name, email, majorite_verifiee, created_at)
values ('+33600000071', 'E2E-DUP', 'KEEP', 'dupe@e2e.test', true, now() - interval '2 days'),
       ('+33600000072', 'E2E-DUP', 'DROP', 'dupe@e2e.test', true, now() - interval '1 day')
on conflict (phone) do update set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name;
-- Une note interne sur le DOUBLON (drop) : doit migrer vers la fiche conservée (keep) après fusion.
insert into public.guest_notes (guest_id, body, author)
select id, 'E2E note sur le doublon (doit migrer vers keep)', 'lab-admin-01'
from public.guests where phone = '+33600000072'
on conflict do nothing;
SQL
echo "   doublons E2E-DUP KEEP/DROP (email dupe@e2e.test) + 1 note sur DROP"

echo "== 3c. campagne marketing de test (pour audiences/promo) =="
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.marketing_campaigns (name, channel, status, created_by)
values ('E2E-Campaign', 'autre', 'brouillon', 'lab-admin-01')
on conflict do nothing;
SQL
echo "   campagne E2E-Campaign"

echo "== 3d. fixtures salarié Vague 8 (membre 'server' + shift publié + notification critique) =="
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
-- Le trigger d'audit de staff_shifts (0041) exige un acteur staff identifié (log_audit_event). Le setup
-- tourne en postgres : on pose les claims JWT du manager LABO pour que l'auteur soit résolu (comme Supabase).
select set_config('request.jwt.claims', '{"sub":"4a8e3c3c-38df-414a-a3c7-53cfc733fb25","role":"authenticated"}', false);
-- Salarié de test (username = compte auth LABO 'server' → /staff résout le profil et SES shifts par RLS).
insert into public.staff_members (username, full_name, poste, contrat_type, actif)
values ('server', 'Serveur Test', 'Serveur VIP', 'extra', true)
on conflict (username) do update set full_name = excluded.full_name, poste = excluded.poste, actif = true;

-- Shift PUBLIÉ à venir (planifie → confirmable depuis /staff). Date du mois courant + 18 j.
insert into public.staff_shifts (staff_member_id, exploitation_date, poste, planned_start, planned_end, status, published_at)
select sm.id, (date_trunc('month', current_date) + interval '18 days')::date, 'Serveur carré VIP',
       (date_trunc('month', current_date) + interval '18 days')::date + time '23:30',
       (date_trunc('month', current_date) + interval '19 days')::date + time '05:00', 'planifie', now()
from public.staff_members sm where sm.username = 'server'
on conflict (staff_member_id, exploitation_date) do update set status = 'planifie', published_at = now();

-- Notification CRITIQUE à action explicite (arrivée anticipée) attachée à ce shift.
insert into public.staff_notifications (staff_username, type, title, body, severity, requires_action, status, shift_id)
select 'server', 'early_start', 'Arrivée anticipée demandée',
       'Arrivée avancée à 21h30 (au lieu de 23h30). Motif : briefing et installation.', 'critical', true, 'confirmation_requise', ss.id
from public.staff_shifts ss join public.staff_members sm on sm.id = ss.staff_member_id
where sm.username = 'server' and ss.exploitation_date = (date_trunc('month', current_date) + interval '18 days')::date
limit 1;

-- Shift DU JOUR déjà CONFIRMÉ (statut « en service ») → active le bouton « OUVRIR LE MODE SOIRÉE » (handoff /ops).
insert into public.staff_shifts (staff_member_id, exploitation_date, poste, planned_start, planned_end, status, published_at)
select sm.id, current_date, 'Serveur carré VIP',
       current_date + time '23:30', (current_date + interval '1 day')::date + time '05:00', 'confirme', now()
from public.staff_members sm where sm.username = 'server'
on conflict (staff_member_id, exploitation_date) do update set status = 'confirme', published_at = now();

-- Shift BROUILLON (published_at NULL) → publication depuis /dashboard Personnel (Phase 2).
insert into public.staff_shifts (staff_member_id, exploitation_date, poste, planned_start, status)
select sm.id, (date_trunc('month', current_date) + interval '25 days')::date, 'Runner',
       (date_trunc('month', current_date) + interval '25 days')::date + time '22:00', 'planifie'
from public.staff_members sm where sm.username = 'server'
on conflict (staff_member_id, exploitation_date) do nothing;

-- Demande de réservation PENDING → décision staff (accepter/refuser) depuis /dashboard Relation client (Phase 2).
-- Guest ISOLÉ (E2E-DUP KEEP, +33600000071) pour ne pas entrer en conflit avec le parcours E4 (guest dédié).
insert into public.table_reservation_requests (venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, standing, status)
select vt.id, g.id, e.id, e.event_date, 'eden', 4, vt.standing, 'pending'
from public.guests g, public.events e, public.venue_tables vt
where g.phone = '+33600000071' and e.slug = 'e2e-fixture-eden' and vt.venue = 'eden' and vt.active
order by vt.label desc limit 1
on conflict do nothing;
SQL
echo "   salarié 'server' + shift publié + notif critique"
echo ""
echo "SETUP OK. E2E: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8321 (build prod), token guest=${GUEST_TOKEN}"
