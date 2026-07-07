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

echo "== 0. reset des données E2E précédentes (idempotence : chaque run part propre) =="
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
-- Ordre de suppression = ordre des dépendances FK (enfants avant parents).
delete from public.message_queue where dedup_key like 'e2e%' or to_address = '+33600000099';
delete from public.promo_redemptions where promo_code_id in (select id from public.promo_codes where code like 'E2E%');
delete from public.promo_codes where code like 'E2E%';
delete from public.campaign_audiences where segment_key like 'e2e%';
delete from public.campaign_audiences where campaign_id in (select id from public.marketing_campaigns where name like 'E2E%');
delete from public.table_server_assignments where assigned_by in ('lab-admin-01','lab-manager-01');
delete from public.contact_requests where subject like 'E2E-%';
delete from public.tasks where title like 'E2E-%';
delete from public.checklist_items where label like 'E2E-%';
delete from public.shot_list_items where label like 'E2E-%';
-- Enfants de guests/events AVANT events/guests.
delete from public.loyalty_ledger where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000071','+33600000072'));
delete from public.loyalty_accounts where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000071','+33600000072'));
delete from public.guest_notes where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000071','+33600000072'));
delete from public.guest_visits where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000071','+33600000072'))
   or event_id in (select id from public.events where slug like 'e2e-fixture-%' or title like 'E2E-%');
-- Maintenant events puis guests (plus aucun guest_visit ne les référence).
delete from public.events where slug like 'e2e-fixture-%' or title like 'E2E-%';
delete from public.guests where phone in ('+33600000061','+33600000071','+33600000072') or first_name like 'E2E%';
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
                 'lab-promoter-01@clubone.local','server@clubone.local');
SQL
echo "   4 comptes de test prêts (mdp: ${TESTPASS})"

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
echo ""
echo "SETUP OK. E2E: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8321 (build prod), token guest=${GUEST_TOKEN}"
