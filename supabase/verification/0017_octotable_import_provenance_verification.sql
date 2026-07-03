-- 0017_octotable_import_provenance_verification.sql — preuve de comportement du module PROVENANCE
-- D'IMPORT CRM (migration 0017_octotable_import_provenance.sql) sur le LABO. 0017 est un ADDITIF STRICT
-- au-dessus de 0013 (guests) : il n'ajoute que des colonnes de provenance (source, venue,
-- client_historique, first_seen_at, import_no_show) et deux index partiels. Il N'AJOUTE AUCUNE policy —
-- la RLS de guests (0013) s'applique INCHANGÉE à ces colonnes. Ce script prouve donc deux choses :
--   1) la STRUCTURE/les DÉFAUTS de provenance sont exacts (schéma + index partiels) ;
--   2) la RLS 0013 cantonne bien une fiche PORTANT une provenance d'import (anon fermé, direction voit
--      tout, promoteur cantonné à SES clients, autres rôles = rien) — c.-à-d. importer un client ne crée
--      aucune fuite ni aucun droit marketing implicite.
--
-- CONTEXTE LABO : la base guests du LABO contient DÉJÀ ~2050 VRAIS clients importés de l'export OctoTable
-- réel du fondateur (import non-prod, art. 6.1.f — voir IMPORT_OCTOTABLE.md). Ces lignes sont traitées
-- ici en LECTURE SEULE (invariants de provenance) et ne sont JAMAIS modifiées. Les fixtures d'écriture
-- sont des lignes de TEST clairement marquées (téléphones +3360000017x, prénoms 'TEST-0017-…'), vérifiées
-- ABSENTES avant exécution (pré-check bloquant), et la transaction entière est ANNULÉE (ROLLBACK).
--
-- Prouve, sur PostgreSQL réel, imposé par le MOTEUR (schéma + RLS/grants — JAMAIS par l'UI) :
--
--   (S) SCHÉMA DE PROVENANCE — client_historique NOT NULL default false ; source / venue / first_seen_at /
--       import_no_show NULLABLES sans default (NULL = « information non fournie », jamais un false inventé) ;
--       les deux index partiels (guests_source_idx WHERE source IS NOT NULL ; guests_historique_idx WHERE
--       client_historique) existent avec le bon prédicat.
--   (D) DÉFAUTS À L'INSERT — une fiche « funnel » insérée SANS colonnes de provenance obtient
--       client_historique = false (default), import_no_show / source / venue / first_seen_at = NULL
--       (aucune valeur fabriquée).
--   (P) PROVENANCE FIDÈLE — une fiche importée (source='octotable', venue='eden', client_historique=true,
--       first_seen_at, import_no_show=true) conserve exactement ces valeurs ; et surtout consent_marketing
--       reste false → importer un client ne donne JAMAIS un consentement marketing (aucun envoi implicite).
--   (R) INVARIANTS SUR LES 2050 VRAIS CLIENTS IMPORTÉS (lecture seule, 0 mutation) — toute ligne
--       source='octotable' porte venue='eden' ET client_historique=true (0 exception) ; tout opt-in
--       marketing importé porte un horodatage (0 opt-in sans consent_marketing_at → journalisation CNIL
--       intacte) ; import_no_show est renseigné pour CHAQUE ligne importée (0 NULL → le flag vient bien
--       de la source, il n'est ni fabriqué ni forcé à false).
--   (L) RLS 0013 INCHANGÉE APPLIQUÉE À DES FICHES DE PROVENANCE D'IMPORT :
--       (L1) anon TOTALEMENT FERMÉ (revoke all from anon → select guests refusé, 42501) ;
--       (L2) direction (admin) VOIT les 4 fiches de test importées ;
--       (L3) promoteur lab-promoter-01 CANTONNÉ : voit SA fiche importée (owner = lui), PAS celle d'un
--            autre promoteur, PAS celle de la direction (owner NULL) → 1 seule visible sur 4 ;
--       (L4) server / security / security_counter ne voient AUCUNE fiche importée (base PII marketing).
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Modèle exact de 0010/0013/0016.

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

-- Exécute p_sql et EXIGE un refus par le moteur (insufficient_privilege / 42501 : grant manquant OU
-- violation RLS). Si l'opération réussit, l'assertion échoue bruyamment.
create or replace function pg_temp.expect_denied(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception '% : l''opération a RÉUSSI alors qu''elle devait être REFUSÉE par le moteur', p_label;
exception
  when insufficient_privilege then
    return; -- 42501 = comportement attendu (permission denied / RLS violation)
end $$;

-- ------------------------------------------------------------
-- PRÉ-CHECK bloquant : aucune fixture de test ne doit préexister (protège les 2050 vrais clients + toute
-- autre donnée du LABO). On borne exclusivement sur des téléphones de test et un préfixe de prénom.
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.guests
             where phone in ('+33600000170','+33600000171','+33600000172','+33600000173')
                or first_name like 'TEST-0017-%') then
    raise exception 'PRÉ-CHECK : une fixture 0017 préexiste — vérification ANNULÉE (ne pas toucher une vraie donnée)';
  end if;
end $$;

-- ============================================================
-- (S) SCHÉMA DE PROVENANCE — colonnes (type/nullabilité/default) + index partiels (catalogue, superuser).
-- ============================================================
select pg_temp.expect(
  (select is_nullable||'/'||coalesce(column_default,'∅')
     from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='client_historique'),
  'NO/false', 'S1 client_historique NOT NULL default false');
select pg_temp.expect(
  (select is_nullable||'/'||coalesce(column_default,'∅')
     from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='source'),
  'YES/∅', 'S2 source NULLABLE sans default');
select pg_temp.expect(
  (select is_nullable||'/'||coalesce(column_default,'∅')
     from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='venue'),
  'YES/∅', 'S3 venue NULLABLE sans default');
select pg_temp.expect(
  (select is_nullable||'/'||coalesce(data_type,'∅')
     from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='first_seen_at'),
  'YES/date', 'S4 first_seen_at NULLABLE de type date');
select pg_temp.expect(
  (select is_nullable||'/'||coalesce(column_default,'∅')
     from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='import_no_show'),
  'YES/∅', 'S5 import_no_show NULLABLE sans default (NULL = non fourni, jamais false inventé)');
-- Index partiels : présents avec le bon prédicat.
select pg_temp.expect(
  (select count(*)::text from pg_indexes
    where schemaname='public' and tablename='guests'
      and indexname='guests_source_idx' and indexdef ilike '%where (source is not null)%'),
  '1', 'S6 index partiel guests_source_idx (WHERE source IS NOT NULL)');
select pg_temp.expect(
  (select count(*)::text from pg_indexes
    where schemaname='public' and tablename='guests'
      and indexname='guests_historique_idx' and indexdef ilike '%where client_historique%'),
  '1', 'S7 index partiel guests_historique_idx (WHERE client_historique)');

-- ============================================================
-- (R) INVARIANTS SUR LES VRAIS CLIENTS IMPORTÉS — LECTURE SEULE, aucune mutation.
-- ============================================================
select pg_temp.expect(
  (select count(*)::text from public.guests where source='octotable' and venue is distinct from 'eden'),
  '0', 'R1 toute fiche octotable porte venue=eden (0 exception)');
select pg_temp.expect(
  (select count(*)::text from public.guests where source='octotable' and client_historique is not true),
  '0', 'R2 toute fiche octotable porte client_historique=true (0 exception)');
select pg_temp.expect(
  (select count(*)::text from public.guests
    where source='octotable' and consent_marketing and consent_marketing_at is null),
  '0', 'R3 tout opt-in marketing importé est horodaté (journalisation CNIL intacte, 0 sans consent_marketing_at)');
select pg_temp.expect(
  (select count(*)::text from public.guests where source='octotable' and import_no_show is null),
  '0', 'R4 import_no_show renseigné pour CHAQUE fiche importée (0 NULL → flag lu de la source, pas fabriqué)');

-- ============================================================
-- FIXTURES (superuser) — 4 fiches de TEST clairement marquées, ANNULÉES au rollback.
--   170 = importée, owner=lab-promoter-01 (SA fiche)     171 = importée, owner=AUTRE promoteur (fictif)
--   172 = importée, owner=NULL (direction)               173 = « funnel » SANS provenance (sonde de défauts)
-- ============================================================
insert into public.guests (phone, first_name, majorite_verifiee, owner_promoter,
                           source, venue, client_historique, first_seen_at, import_no_show,
                           consent_marketing) values
 ('+33600000170','TEST-0017-Owned',    true, 'lab-promoter-01',
    'octotable','eden', true, date '2019-06-15', true,  false),
 ('+33600000171','TEST-0017-Other',    true, 'promoteur-fictif-171',
    'octotable','eden', true, date '2019-06-15', false, false),
 ('+33600000172','TEST-0017-Direction',true, null,
    'octotable','eden', true, date '2019-06-15', false, false);
-- 173 : fiche funnel SANS aucune colonne de provenance → sonde des DÉFAUTS.
insert into public.guests (phone, first_name, majorite_verifiee, owner_promoter)
 values ('+33600000173','TEST-0017-Funnel', true, null);

-- ============================================================
-- (D) DÉFAUTS À L'INSERT — fiche 173 (funnel sans provenance).
-- ============================================================
select pg_temp.expect(
  (select client_historique::text from public.guests where phone='+33600000173'),
  'false', 'D1 client_historique défaut=false sur une fiche funnel');
select pg_temp.expect(
  (select coalesce(import_no_show::text,'∅') from public.guests where phone='+33600000173'),
  '∅', 'D2 import_no_show=NULL par défaut (aucun false fabriqué)');
select pg_temp.expect(
  (select coalesce(source,'∅')||'/'||coalesce(venue,'∅')||'/'||coalesce(first_seen_at::text,'∅')
     from public.guests where phone='+33600000173'),
  '∅/∅/∅', 'D3 source / venue / first_seen_at = NULL par défaut');

-- ============================================================
-- (P) PROVENANCE FIDÈLE — fiche 170 (importée).
-- ============================================================
select pg_temp.expect(
  (select source||'/'||venue||'/'||client_historique::text||'/'||first_seen_at::text||'/'||import_no_show::text
     from public.guests where phone='+33600000170'),
  'octotable/eden/true/2019-06-15/true', 'P1 provenance importée conservée fidèlement');
select pg_temp.expect(
  (select consent_marketing::text from public.guests where phone='+33600000170'),
  'false', 'P2 importer un client ne donne JAMAIS de consentement marketing (reste false)');

-- ============================================================
-- (L) RLS 0013 INCHANGÉE, appliquée à des fiches de provenance d'import.
-- ============================================================
-- L1 : anon totalement fermé (revoke all from anon).
set local role anon;
select pg_temp.expect_denied('select count(*) from public.guests', 'L1 anon LECTURE guests REFUSÉE (revoke all from anon)');
reset role;

-- L2 : direction (admin) voit les 4 fiches de test importées.
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect(
  (select count(*)::text from public.guests where first_name like 'TEST-0017-%'),
  '4', 'L2 admin (direction) VOIT les 4 fiches de test');
reset role;

-- L3 : promoteur lab-promoter-01 cantonné → voit UNIQUEMENT sa fiche (170) parmi les 4.
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect(
  (select count(*)::text from public.guests where first_name like 'TEST-0017-%'),
  '1', 'L3a promoteur ne voit QUE ses clients (1 sur 4)');
select pg_temp.expect(
  (select coalesce(string_agg(phone, ',' order by phone),'∅')
     from public.guests where first_name like 'TEST-0017-%'),
  '+33600000170', 'L3b la seule fiche visible du promoteur = SA fiche importée (owner=lui)');
reset role;

-- L4 : server / security / security_counter ne voient AUCUNE fiche importée (base PII marketing).
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect(
  (select count(*)::text from public.guests where first_name like 'TEST-0017-%'),
  '0', 'L4a server ne voit AUCUNE fiche (pas d''accès base marketing)');
select pg_temp.act_as(:'security_id');
select pg_temp.expect(
  (select count(*)::text from public.guests where first_name like 'TEST-0017-%'),
  '0', 'L4b security ne voit AUCUNE fiche');
select pg_temp.act_as(:'counter_id');
select pg_temp.expect(
  (select count(*)::text from public.guests where first_name like 'TEST-0017-%'),
  '0', 'L4c security_counter ne voit AUCUNE fiche');
reset role;

select '0017 PROVENANCE IMPORT OCTOTABLE — TOUTES LES ASSERTIONS PASSENT (rollback : aucune fixture persistée ; 2050 vrais clients lus en seule lecture, jamais modifiés)' as resultat;

rollback;
