#!/usr/bin/env bash
# labo_e2e_teardown.sh — nettoie TOUTES les fixtures E2E du LABO local et le port-forward.
# LABO UNIQUEMENT. Ne touche jamais la production. Zéro donnée métier résiduelle après exécution.
set -euo pipefail
CID=supabase_db_club-one-lab
GUEST_PHONE='+33600000061'

echo "== suppression des fixtures E2E (guest, events, tâches, attributions, requêtes) =="
docker exec -i "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
-- Attributions serveur créées pendant l'E2E (assignées par le compte de test admin).
delete from public.table_server_assignments where assigned_by in ('lab-admin-01','lab-manager-01');
-- Requêtes de réservation du guest de test.
delete from public.table_reservation_requests
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
-- Sous-objets du guest de test.
delete from public.guest_auth_attempts
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
delete from public.promo_redemptions
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
delete from public.guest_visits
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
delete from public.guest_tags
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
delete from public.guest_notes
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
-- Guest de test.
delete from public.guests where phone = '${GUEST_PHONE}';
-- Guests importés par l'E2E CRM (préfixe E2E-).
delete from public.guests where first_name like 'E2E-%' or last_name like 'E2E-%';
-- Events de fixture + tâches E2E.
delete from public.events where slug like 'e2e-fixture-%' or title like 'E2E-%';
delete from public.tasks where title like 'E2E-%';
-- Boards (Vague 4) : demandes/leads/avis créés en E2E.
delete from public.contact_requests where subject like 'E2E-%';
delete from public.lead_channel_stats where created_by in ('lab-admin-01','lab-manager-01') and created_at > now() - interval '1 day';
delete from public.reviews where author like 'E2E-%' or body like 'E2E-%';
-- Marketing E2E : codes promo + audiences de test.
delete from public.promo_redemptions where promo_code_id in (select id from public.promo_codes where code like 'E2E%');
delete from public.promo_codes where code like 'E2E%';
delete from public.message_queue where dedup_key like 'e2e%' or to_address = '+33600000099';
delete from public.campaign_audiences where segment_key like 'e2e%';
delete from public.campaign_audiences where campaign_id in (select id from public.marketing_campaigns where name like 'E2E%');
delete from public.marketing_campaigns where name like 'E2E%';
SQL
echo "   fixtures supprimées"

echo "== arrêt du port-forward labfwd54321 =="
docker rm -f labfwd54321 >/dev/null 2>&1 || true
echo "   forward supprimé"

echo ""
echo "TEARDOWN OK. Reste à ta main (LABO local, non secret) : les mots de passe de test sur auth.users"
echo "(lab-admin-01 etc. = E2ELabPass!23). Pour les neutraliser : UPDATE auth.users SET encrypted_password=NULL"
echo "WHERE email LIKE '%@clubone.local'; — ou laisser (LABO isolé, jamais prod)."
