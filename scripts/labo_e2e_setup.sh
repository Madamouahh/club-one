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
SQL
echo "   guest token=${GUEST_TOKEN} pin=${GUEST_PIN} ; 3 events publiés (mois courant)"

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
echo ""
echo "SETUP OK. E2E: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8321 (build prod), token guest=${GUEST_TOKEN}"
