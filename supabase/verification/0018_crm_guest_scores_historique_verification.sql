-- 0018_crm_guest_scores_historique_verification.sql — preuve de comportement du module
-- « exposer la PROVENANCE dans guest_scores » (migration 0018_crm_guest_scores_historique.sql) sur le LABO.
--
-- 0018 est un ADDITIF STRICT au-dessus de 0013 (vue guest_scores) + 0017 (colonnes de provenance) :
-- il RECRÉE la vue guest_scores (create or replace) en AJOUTANT EN FIN trois colonnes déjà présentes
-- sur guests — client_historique, first_seen_at, source — sans toucher aucune donnée, sans fabriquer
-- aucune visite, sans changer le scoring (100 % côté lib TS). security_invoker = on est conservé →
-- la RLS de guests (0013) s'applique INCHANGÉE au travers de la vue. 0018 corrige aussi un BOGUE LATENT
-- de 0013 : un GRANT SELECT EXPLICITE à `authenticated` (0013 s'appuyait sur les default privileges
-- Supabase, ABSENTS sur un clone/labo → la vue y était illisible par le front), et un revoke explicite d'anon.
--
-- CE QUE DÉBLOQUE 0018 (le vrai enjeu) : dans guest_scores, les 2050 fiches OctoTable importées ont
-- visits_seated_total = 0 (l'export est un AGRÉGAT clients, il ne contient AUCUNE visite datée). Sans la
-- colonne client_historique, classifyGuest() les rangerait dans « prospect (jamais venu) » — une donnée
-- FAUSSE (ces clients ONT fréquenté l'établissement). En exposant client_historique côté SQL déjà, la vue
-- permet de DISTINGUER un « historique importé » d'un « vrai prospect » à visites=0. C'est ce que ce
-- script prouve, imposé par le MOTEUR (schéma de la vue + grants + RLS security_invoker — JAMAIS par l'UI).
--
-- CONTEXTE LABO : guests contient DÉJÀ ~2050 VRAIS clients importés (source='octotable', client_historique
-- =true, owner_promoter NULL). Ils sont lus ICI EN LECTURE SEULE (invariants) et JAMAIS modifiés. Les
-- fixtures d'écriture sont des lignes de TEST clairement marquées (téléphones +3360000018x, prénoms
-- 'TEST-0018-…'), vérifiées ABSENTES avant exécution (pré-check bloquant), et la transaction est ANNULÉE.
--
-- Assertions :
--   (S) SCHÉMA DE LA VUE — les 3 colonnes de provenance sont AJOUTÉES EN FIN (ordinal 15/16/17), du bon
--       type ; security_invoker = on conservé.
--   (G) GRANTS — `authenticated` a SELECT sur la vue (correctif du bogue latent 0013) ; `anon` n'a AUCUN
--       privilège (revoke explicite).
--   (V) COMPORTEMENT / bug de classification débloqué — un historique importé à 0 visite apparaît dans la
--       vue avec client_historique=true ; un prospect funnel à 0 visite avec client_historique=false ; la
--       vue les DISTINGUE (le cœur de 0018) ; un importé AVEC une visite seated garde sa provenance ET son
--       agrégat (pas de double comptage).
--   (R) INVARIANTS SUR LES 2050 VRAIS CLIENTS (lecture seule) — chacun remonte dans guest_scores avec
--       client_historique=true ; aucun n'est laissé « faux prospect » (0 octotable sans client_historique).
--   (L) RLS 0013 INCHANGÉE via security_invoker (la RLS de guests gouverne la vue) :
--       (L1) anon → select guest_scores REFUSÉ (42501, revoke all) ;
--       (L2) direction (admin) VOIT les 4 fiches de test dans la vue ;
--       (L3) promoteur lab-promoter-01 CANTONNÉ → ne voit QUE SA fiche ; les historiques importés
--            (owner NULL) lui sont INVISIBLES au travers de la vue ;
--       (L4) server / security / security_counter ne voient AUCUNE fiche (RLS guests propagée par la vue).
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Modèle exact de 0010/0013/0016/0017. NON destructif, NON prod (LABO isolé), transaction ROLLBACK.

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

-- Exécute p_sql et EXIGE un refus moteur (insufficient_privilege / 42501 : grant manquant OU RLS).
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
-- PRÉ-CHECK bloquant : aucune fixture de test ne doit préexister (protège les 2050 vrais clients).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.guests
             where phone in ('+33600000180','+33600000181','+33600000182','+33600000183')
                or first_name like 'TEST-0018-%') then
    raise exception 'PRÉ-CHECK : une fixture 0018 préexiste — vérification ANNULÉE (ne pas toucher une vraie donnée)';
  end if;
end $$;

-- ============================================================
-- (S) SCHÉMA DE LA VUE — les 3 colonnes de provenance ajoutées EN FIN (ordinal 15/16/17) + types.
--     Les 14 premières colonnes 0013 restent à l'identique (contrainte create or replace).
-- ============================================================
select pg_temp.expect(
  (select column_name from information_schema.columns
    where table_schema='public' and table_name='guest_scores' and ordinal_position=15),
  'client_historique', 'S1 client_historique ajoutée en 15e position (fin, après univers_prefere)');
select pg_temp.expect(
  (select column_name from information_schema.columns
    where table_schema='public' and table_name='guest_scores' and ordinal_position=16),
  'first_seen_at', 'S2 first_seen_at ajoutée en 16e position');
select pg_temp.expect(
  (select column_name from information_schema.columns
    where table_schema='public' and table_name='guest_scores' and ordinal_position=17),
  'source', 'S3 source ajoutée en 17e position (dernière)');
select pg_temp.expect(
  (select string_agg(data_type, '/' order by ordinal_position)
     from information_schema.columns
    where table_schema='public' and table_name='guest_scores'
      and column_name in ('client_historique','first_seen_at','source')),
  'boolean/date/text', 'S4 types de provenance = boolean/date/text');
-- Position 14 inchangée (univers_prefere) → les colonnes 0013 n'ont pas bougé.
select pg_temp.expect(
  (select column_name from information_schema.columns
    where table_schema='public' and table_name='guest_scores' and ordinal_position=14),
  'univers_prefere', 'S5 la 14e colonne 0013 (univers_prefere) reste inchangée avant les ajouts');
-- security_invoker = on conservé (la vue applique la RLS du rôle qui interroge).
select pg_temp.expect(
  (select case when reloptions @> array['security_invoker=on'] then 'on' else 'off' end
     from pg_class where oid='public.guest_scores'::regclass),
  'on', 'S6 security_invoker = on conservé (RLS du rôle interrogateur appliquée)');

-- ============================================================
-- (G) GRANTS — correctif du bogue latent 0013 : SELECT explicite à authenticated, anon revoké.
-- ============================================================
select pg_temp.expect(
  has_table_privilege('authenticated','public.guest_scores','SELECT')::text,
  'true', 'G1 authenticated a SELECT sur guest_scores (correctif du bogue latent 0013 / default privileges)');
select pg_temp.expect(
  has_table_privilege('anon','public.guest_scores','SELECT')::text,
  'false', 'G2 anon n''a AUCUN SELECT sur guest_scores (revoke all from anon)');

-- ============================================================
-- FIXTURES (superuser) — 4 fiches de TEST clairement marquées, ANNULÉES au rollback.
--   180 = historique importé, 0 visite, owner NULL   181 = prospect funnel, 0 visite, owner NULL
--   182 = importé + 1 visite seated, owner=lab-promoter-01   183 = importé, owner=AUTRE promoteur
-- ============================================================
insert into public.guests (phone, first_name, majorite_verifiee, owner_promoter,
                           source, venue, client_historique, first_seen_at, import_no_show, consent_marketing) values
 ('+33600000180','TEST-0018-HistImport', true, null,
    'octotable','eden', true, date '2019-06-15', false, false),
 ('+33600000182','TEST-0018-Owned',      true, 'lab-promoter-01',
    'octotable','eden', true, date '2019-06-15', false, false),
 ('+33600000183','TEST-0018-Other',      true, 'promoteur-fictif-183',
    'octotable','eden', true, date '2019-06-15', false, false);
-- 181 : prospect funnel SANS provenance → client_historique prend le DÉFAUT false.
insert into public.guests (phone, first_name, majorite_verifiee, owner_promoter)
 values ('+33600000181','TEST-0018-Prospect', true, null);

-- 182 reçoit UNE visite seated réelle → prouve que la provenance coexiste avec l'agrégat (pas de double comptage).
insert into public.guest_visits (guest_id, exploitation_date, univers, status, party_size, spend_attributed)
 select id, date '2026-06-20', 'eden', 'seated', 4, 200
   from public.guests where phone='+33600000182';

-- ============================================================
-- (V) COMPORTEMENT — le bug de classification débloqué (superuser : voit tout, RLS bypass).
-- ============================================================
-- V1 : historique importé à 0 visite → présent dans la vue, client_historique=true (PAS un prospect).
select pg_temp.expect(
  (select visits_seated_total::text||'/'||client_historique::text
     from public.guest_scores where first_name='TEST-0018-HistImport'),
  '0/true', 'V1 historique importé (0 visite) remonte avec client_historique=true');
-- V2 : prospect funnel à 0 visite → présent, client_historique=false.
select pg_temp.expect(
  (select visits_seated_total::text||'/'||client_historique::text
     from public.guest_scores where first_name='TEST-0018-Prospect'),
  '0/false', 'V2 prospect funnel (0 visite) remonte avec client_historique=false');
-- V3 (LE CŒUR) : à visites=0 identiques, la vue DISTINGUE historique importé vs prospect.
select pg_temp.expect(
  (select string_agg(client_historique::text, '/' order by first_name)
     from public.guest_scores
    where first_name in ('TEST-0018-HistImport','TEST-0018-Prospect')
      and visits_seated_total = 0),
  'true/false', 'V3 à visites=0, la vue distingue historique importé (true) du prospect (false)');
-- V4 : importé AVEC 1 visite seated → agrégat=1 ET provenance conservée (source/first_seen_at).
select pg_temp.expect(
  (select visits_seated_total::text||'/'||client_historique::text||'/'||source||'/'||first_seen_at::text
     from public.guest_scores where first_name='TEST-0018-Owned'),
  '1/true/octotable/2019-06-15', 'V4 importé + 1 seated → agrégat=1 et provenance intacte (pas de double comptage)');

-- ============================================================
-- (R) INVARIANTS SUR LES 2050 VRAIS CLIENTS IMPORTÉS — LECTURE SEULE, aucune mutation.
-- ============================================================
-- R1 : chaque fiche octotable RÉELLE remonte dans guest_scores avec client_historique=true.
--      (on exclut les fixtures TEST-0018 pour ne mesurer que les 2050 vrais clients importés.)
select pg_temp.expect(
  (select count(*)::text from public.guest_scores
    where source='octotable' and first_name not like 'TEST-0018-%' and client_historique is not true),
  '0', 'R1 aucune fiche octotable réelle dans la vue sans client_historique=true (0 exception)');
-- R2 : chaque octotable réel est un historique à 0 visite → SANS la colonne, tous seraient de faux
--      « prospects ». La vue les rend distinguables : count(0 visite & historique) = count(octotable réels).
select pg_temp.expect(
  (select ((count(*) filter (where visits_seated_total = 0 and client_historique)) = count(*))::text
     from public.guest_scores where source='octotable' and first_name not like 'TEST-0018-%'),
  'true', 'R2 tout octotable réel (0 visite) est marqué historique → aucun « faux prospect » dans la vue');

-- ============================================================
-- (L) RLS 0013 INCHANGÉE via security_invoker — la RLS de guests gouverne la vue.
-- ============================================================
-- L1 : anon → lecture de la vue REFUSÉE (revoke all from anon).
set local role anon;
select pg_temp.expect_denied('select count(*) from public.guest_scores',
  'L1 anon LECTURE guest_scores REFUSÉE (revoke all from anon, 42501)');
reset role;

-- L2 : direction (admin) voit les 4 fiches de test dans la vue.
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_scores where first_name like 'TEST-0018-%'),
  '4', 'L2 admin (direction) VOIT les 4 fiches de test dans guest_scores');
reset role;

-- L3 : promoteur lab-promoter-01 cantonné → ne voit QUE sa fiche (182) ; historiques owner NULL invisibles.
set local role authenticated; select pg_temp.act_as(:'promoter_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_scores where first_name like 'TEST-0018-%'),
  '1', 'L3a promoteur ne voit QUE ses clients dans la vue (1 sur 4)');
select pg_temp.expect(
  (select coalesce(string_agg(first_name, ',' order by first_name),'∅')
     from public.guest_scores where first_name like 'TEST-0018-%'),
  'TEST-0018-Owned', 'L3b la seule fiche visible du promoteur = SA fiche (owner=lui) ; historiques owner NULL invisibles');
reset role;

-- L4 : server / security / security_counter ne voient AUCUNE fiche (RLS guests propagée par la vue).
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_scores where first_name like 'TEST-0018-%'),
  '0', 'L4a server ne voit AUCUNE fiche via la vue');
select pg_temp.act_as(:'security_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_scores where first_name like 'TEST-0018-%'),
  '0', 'L4b security ne voit AUCUNE fiche via la vue');
select pg_temp.act_as(:'counter_id');
select pg_temp.expect(
  (select count(*)::text from public.guest_scores where first_name like 'TEST-0018-%'),
  '0', 'L4c security_counter ne voit AUCUNE fiche via la vue');
reset role;

select '0018 PROVENANCE DANS guest_scores — TOUTES LES ASSERTIONS PASSENT (rollback : aucune fixture persistée ; 2050 vrais clients lus en seule lecture, jamais modifiés)' as resultat;

rollback;
