-- 0013_crm_clients_vip_verification.sql — preuve de comportement du SOCLE CRM CLIENTS VIP (0013) sur le LABO.
--
-- Exécuté dans une TRANSACTION annulée (rollback) : AUCUNE donnée de test ne persiste (le CRM ship VIDE).
-- Prouve, sur PostgreSQL réel, imposé par le MOTEUR (RLS/trigger — JAMAIS par l'UI) :
--   (A) CANTONNEMENT SELECT `guests` : admin/manager voient tout ; le promoteur ne voit QUE ses clients
--       (owner_promoter = son username) ; server / security / security_counter ne voient RIEN (base PII marketing).
--   (B) INSERT `guests` (with check) : un promoteur ne peut PAS créer un client au nom d'un AUTRE promoteur ;
--       il peut créer un client À SON nom.
--   (C) UPDATE `guests` : le promoteur modifie SON client ; l'UPDATE du client d'autrui touche 0 ligne (RLS).
--   (D) DELETE `guests` : direction seule (droit à l'effacement RGPD) ; le promoteur ne supprime rien.
--   (E) TRIGGER opt-out DÉFINITIF (guard_guest_optout) : une fois opt_out_at posé, sa remise à NULL est
--       REFUSÉE pour manager ET promoteur, AUTORISÉE pour admin seul (le STOP ne se dé-coche pas par erreur).
--   (F) VUE `guest_scores` (security_invoker=on) : exclut les clients opt-out (where opt_out_at is null) et
--       applique la RLS du rôle qui l'interroge (le promoteur n'y voit QUE ses clients).
--   (G) CANTONNEMENT `guest_visits` : suit la propriété du client sous-jacent (le promoteur voit les passages
--       de SES clients seuls ; server ne voit rien).
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
--
-- Fixtures = staff RÉELS du LABO ; téléphones de test +33600000094..099 (clairement de test), vérifiés ABSENTS
-- des 2050 guests LABO avant exécution (pré-check bloquant § ci-dessous → aucun vrai client touché).
-- sub des staff_users : identiques à 0025 (+ admin lab-admin-01 pour prouver l'exception opt-out).
-- NB : les variables psql (\gset / :'x') sont interpolées dans les SELECT normaux mais PAS dans les blocs
--      dollar-quotés ($$…$$) ; les assertions passent donc par des helpers pg_temp appelés depuis des SELECT.
--      pg_temp.try(sql) exécute un DML dynamique SOUS LE RÔLE COURANT (SECURITY INVOKER) et renvoie 'ok' ou
--      'error:<sqlstate>' — c'est ainsi qu'on prouve un REFUS RLS/trigger sans faire échouer toute la session.

begin;

\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set security_id '8177e05b-90fa-41d8-a2ba-2468acb296f7'
\set counter_id  '635c3963-868e-449e-b005-e895b933db15'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

-- ------------------------------------------------------------
-- Helpers (pg_temp = SECURITY INVOKER : l'exécution garde le rôle/jwt courant → la RLS s'applique).
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

-- Exécute un DML dynamique sous le rôle courant ; capture le refus au lieu de tuer la transaction.
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

-- Exécute un DML dynamique sous le rôle courant et renvoie le NOMBRE de lignes touchées (une RLS qui
-- filtre une ligne via sa clause USING donne 0 ligne touchée SANS lever d'erreur → il faut la compter).
create or replace function pg_temp.exec_count(p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n::text;
end $$;

-- ------------------------------------------------------------
-- PRÉ-CHECK bloquant : aucun des téléphones de test ne doit préexister (protège les 2050 vrais clients).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.guests
             where phone in ('+33600000094','+33600000095','+33600000096','+33600000097',
                             '+33600000098','+33600000099')) then
    raise exception 'PRÉ-CHECK : un téléphone de test préexiste en base — vérification ANNULÉE (ne pas toucher un vrai client)';
  end if;
end $$;

-- ------------------------------------------------------------
-- FIXTURES (créées en postgres = superuser → bypass RLS ; c'est le SETUP, pas la preuve).
--   94 = client du promoteur lab-promoter-01 (SON client)      95 = client d'un AUTRE promoteur (fictif)
--   96 = client direction (owner NULL)                          97 = client OPT-OUT (owner lab-promoter-01)
--   99 = client jetable pour la preuve « manager peut supprimer »
-- ------------------------------------------------------------
insert into public.guests (phone, first_name, last_name, owner_promoter, majorite_verifiee,
                           consent_service, consent_service_at, consent_service_text, opt_out_at) values
 ('+33600000094','TEST-A','Owned',   'lab-promoter-01',      true, true, now(), 'service', null),
 ('+33600000095','TEST-B','Autre',   'TEST-autre-promoteur', true, true, now(), 'service', null),
 ('+33600000096','TEST-C','Direction', null,                 true, true, now(), 'service', null),
 ('+33600000097','TEST-D','OptOut',  'lab-promoter-01',      true, true, now(), 'service', now()),
 ('+33600000099','TEST-E','Jetable',  null,                  true, true, now(), 'service', null);

select id as g_a from public.guests where phone='+33600000094' \gset
select id as g_b from public.guests where phone='+33600000095' \gset

-- Passages (RFM) : un « seated » sur le client du promoteur, un sur le client d'un autre.
insert into public.guest_visits (guest_id, exploitation_date, univers, status, spend_attributed, party_size) values
 (:'g_a'::uuid, date '2099-11-01', 'eden', 'seated', 500.00, 4),
 (:'g_b'::uuid, date '2099-11-01', 'eden', 'seated', 300.00, 3);

-- ============================================================
-- (A) CANTONNEMENT SELECT guests — compté sur le jeu de test STABLE (94..97) pour découpler des 2050 réels.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect((select count(*)::text from public.guests
   where phone in ('+33600000094','+33600000095','+33600000096','+33600000097')), '4', 'A/admin voit les 4 fixtures');

set local role authenticated; select pg_temp.act_as(:'manager_id');
select pg_temp.expect((select count(*)::text from public.guests
   where phone in ('+33600000094','+33600000095','+33600000096','+33600000097')), '4', 'A/manager voit les 4 fixtures');

-- Le promoteur possède 94 (client) ET 97 (opt-out) → il voit ses 2 clients, et AUCUN client d'autrui (95/96).
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect((select count(*)::text from public.guests
   where phone in ('+33600000094','+33600000097')), '2', 'A/promoteur voit SES 2 clients (94+97)');
select pg_temp.expect((select count(*)::text from public.guests
   where phone in ('+33600000095','+33600000096')), '0', 'A/promoteur ne voit AUCUN client d''autrui (95/96)');

set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect((select count(*)::text from public.guests
   where phone in ('+33600000094','+33600000095','+33600000096','+33600000097')), '0', 'A/server ne voit aucun client (PII)');
set local role authenticated; select pg_temp.act_as(:'security_id');
select pg_temp.expect((select count(*)::text from public.guests
   where phone in ('+33600000094','+33600000095','+33600000096','+33600000097')), '0', 'A/security ne voit aucun client (PII)');
set local role authenticated; select pg_temp.act_as(:'counter_id');
select pg_temp.expect((select count(*)::text from public.guests
   where phone in ('+33600000094','+33600000095','+33600000096','+33600000097')), '0', 'A/security_counter ne voit aucun client (PII)');

-- ============================================================
-- (B) INSERT guests (with check) — un promoteur ne crée jamais un client au nom d'un AUTRE.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect_err(pg_temp.try(
  'insert into public.guests(phone,first_name,owner_promoter,majorite_verifiee) '
  || 'values(''+33600000098'',''TEST-Usurp'',''TEST-autre-promoteur'',true)'),
  'B1 promoteur NE crée PAS un client au nom d''un autre');
select pg_temp.expect(pg_temp.try(
  'insert into public.guests(phone,first_name,owner_promoter,majorite_verifiee) '
  || 'values(''+33600000098'',''TEST-Own'',''lab-promoter-01'',true)'),
  'ok', 'B2 promoteur crée un client À SON nom');

-- ============================================================
-- (C) UPDATE guests — le promoteur modifie le sien (1 ligne) ; l'UPDATE du client d'autrui touche 0 ligne.
-- ============================================================
select pg_temp.expect(pg_temp.exec_count('update public.guests set notes=''rls-own'' where phone=''+33600000094'''),
  '1', 'C1 promoteur modifie SON client');
select pg_temp.expect(pg_temp.exec_count('update public.guests set notes=''rls-hack'' where phone=''+33600000095'''),
  '0', 'C2 UPDATE du client d''autrui touche 0 ligne (RLS)');

-- ============================================================
-- (D) DELETE guests — direction seule ; le promoteur ne supprime rien.
-- ============================================================
select pg_temp.expect(pg_temp.exec_count('delete from public.guests where phone=''+33600000094'''),
  '0', 'D1 promoteur NE supprime PAS (droit RGPD réservé direction)');
set local role authenticated; select pg_temp.act_as(:'manager_id');
select pg_temp.expect(pg_temp.exec_count('delete from public.guests where phone=''+33600000099'''),
  '1', 'D2 direction supprime (droit à l''effacement)');

-- ============================================================
-- (F) VUE guest_scores (security_invoker=on) — AVANT de lever l'opt-out en (E).
-- ============================================================
-- F1 : le client opt-out (97) est EXCLU de la vue, même vu par la direction.
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_scores s join public.guests g on g.id=s.guest_id where g.phone='+33600000097'),
  '0', 'F1 client opt-out exclu de guest_scores');
-- F2 : la vue applique la RLS du rôle — le promoteur y voit SON client (94), pas celui d''autrui (95).
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_scores s join public.guests g on g.id=s.guest_id where g.phone='+33600000094'),
  '1', 'F2 promoteur voit SON client dans guest_scores');
select pg_temp.expect(
  (select count(*)::text from public.guest_scores s join public.guests g on g.id=s.guest_id where g.phone='+33600000095'),
  '0', 'F2 promoteur ne voit PAS le client d''autrui dans guest_scores');

-- ============================================================
-- (E) TRIGGER opt-out DÉFINITIF — remise de opt_out_at à NULL : refusée sauf admin.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'manager_id');
select pg_temp.expect_err(pg_temp.try('update public.guests set opt_out_at=null where phone=''+33600000097'''),
  'E1 manager NE peut PAS lever l''opt-out (STOP définitif)');
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect_err(pg_temp.try('update public.guests set opt_out_at=null where phone=''+33600000097'''),
  'E2 promoteur NE peut PAS lever l''opt-out');
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect(pg_temp.try('update public.guests set opt_out_at=null where phone=''+33600000097'''),
  'ok', 'E3 admin SEUL peut lever l''opt-out');

-- ============================================================
-- (G) CANTONNEMENT guest_visits — suit la propriété du client.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_visits v join public.guests g on g.id=v.guest_id where g.phone='+33600000094'),
  '1', 'G1 promoteur voit les passages de SON client');
select pg_temp.expect(
  (select count(*)::text from public.guest_visits v join public.guests g on g.id=v.guest_id where g.phone='+33600000095'),
  '0', 'G2 promoteur ne voit PAS les passages du client d''autrui');
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_visits), '0', 'G3 server ne voit aucun passage (PII)');

reset role;
select '0013 CRM socle — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée, aucun vrai client touché)' as resultat;

rollback;
