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
delete from public.loyalty_ledger where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
delete from public.loyalty_accounts where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
delete from public.guest_visits
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
delete from public.guest_tags
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
delete from public.guest_notes
 where guest_id in (select id from public.guests where phone = '${GUEST_PHONE}');
-- Vague 7 (E5) : passes nominatifs émis en E2E (invite_link_id null) pour le guest de test.
delete from public.guest_passes
 where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'));
-- Vague 7 (E4) : guest DÉDIÉ à la demande de résa (phone +33600000062) + ses enfants FK.
delete from public.table_reservation_requests where guest_id in (select id from public.guests where phone = '+33600000062');
delete from public.guest_visits where guest_id in (select id from public.guests where phone = '+33600000062');
delete from public.guests where phone = '+33600000062';
-- Guest de test.
delete from public.guests where phone = '${GUEST_PHONE}';
-- Guests importés par l'E2E CRM (préfixe E2E-).
delete from public.guests where first_name like 'E2E-%' or last_name like 'E2E-%';
-- Events de fixture + tâches E2E.
delete from public.events where slug like 'e2e-fixture-%' or title like 'E2E-%';
delete from public.tasks where title like 'E2E-%';
-- Vague 8 (/staff + workflow RH) : notifs → shifts → membre de test (enfants FK avant parents).
delete from public.staff_notifications where staff_username in ('server','lab-manager-01');
delete from public.staff_shifts where staff_member_id in (select id from public.staff_members where username='server');
delete from public.staff_members where username='server';
-- Vague 7 (C5) : fiches artistes + rattachements créés en E2E.
delete from public.artist_event_links where created_by in ('lab-admin-01','lab-manager-01') and artist_id in (select id from public.artists where stage_name like 'E2E-%' or stage_name like 'L4-%');
delete from public.artists where stage_name like 'E2E-%' or stage_name like 'L4-%';
delete from public.checklist_items where label like 'E2E-%';
delete from public.shot_list_items where label like 'E2E-%';
delete from public.loyalty_ledger where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'));
delete from public.loyalty_accounts where guest_id in (select id from public.guests where phone in ('+33600000061','+33600000062','+33600000071','+33600000072'));
-- Boards (Vague 4) : demandes/leads/avis créés en E2E.
delete from public.contact_requests where subject like 'E2E-%' or subject like 'Demande de réservation%';
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
