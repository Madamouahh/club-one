-- 0019_crm_guest_space_verification.sql — preuve de comportement du module
-- « MINI-ESPACE CLIENT » (migration 0019_crm_guest_space.sql) sur le LABO.
--
-- 0019 donne au client inscrit un accès SANS mot de passe, en LECTURE SEULE, à SES propres données,
-- via un JETON OPAQUE aléatoire (guests.space_token, gen_random_uuid) et DEUX RPC anon SECURITY DEFINER :
--   1) resolve_space_from_pass_v1(qr_token) → space_token DU MÊME client (détenir le qr_token prouve
--      l'identité du porteur) ; utilisé par la page de confirmation d'inscription.
--   2) get_guest_space_v1(space_token) → jsonb minimisé { found, first_name, visits, passes } et RIEN d'autre :
--      jamais de téléphone/nom/spend/party_size, jamais la donnée d'un TIERS. Jeton inconnu → { found:false }.
--
-- ENJEU SÉCURITÉ prouvé ici, imposé par le MOTEUR (grants + corps SECURITY DEFINER — JAMAIS l'UI) :
--   · aucune table n'est exposée à anon : anon ne peut LIRE ni guests, ni guest_passes, ni guest_visits
--     directement ; il n'obtient QUE le jsonb minimisé de SON espace via la RPC.
--   · MINIMISATION RGPD : le jsonb ne porte que first_name + visites/passes du client, sans spend, sans
--     party_size, sans téléphone, sans donnée d'un tiers.
--   · AMPLIFICATION D'UN qr_token CAPTÉ (constat revue S19) : get_guest_space_v1 ne renvoie le qr_token BRUT
--     que pour un pass PRÉSENTABLE (status='issued' ET exploitation_date >= aujourd'hui). Tout pass
--     passé / scanné / expiré / annulé remonte SANS son jeton (qr_token = null) → l'historique de jetons
--     exposé est borné au strict nécessaire fonctionnel.
--   · ISOLATION INTER-CLIENTS : le jeton du client A ne renvoie JAMAIS les visites/passes du client B.
--   · LECTURE SEULE : aucun INSERT/UPDATE/DELETE n'est déclenché par les RPC (comptes de tables inchangés).
--
-- CONTEXTE LABO : guests contient DÉJÀ 2050 VRAIS clients importés (OctoTable), chacun avec un space_token
-- distinct rétro-rempli par 0019. Ils sont lus ICI EN LECTURE SEULE (invariant de schéma) et JAMAIS modifiés.
-- Les fixtures d'écriture sont des lignes de TEST clairement marquées (téléphones +3360000019x, prénoms
-- 'TEST-0019-…', qr_token préfixés 'TEST-0019-QR-…'), vérifiées ABSENTES avant exécution (pré-check bloquant),
-- et la transaction est ANNULÉE (rollback).
--
-- Assertions :
--   (S) SCHÉMA — space_token uuid, NOT NULL, default gen_random_uuid, index UNIQUE ; chaque octotable réel a
--       un space_token non nul (invariant lecture seule sur les 2050). SECURITY DEFINER + search_path fixé.
--   (G) GRANTS — les 2 RPC sont EXECUTE pour anon ET authenticated (revoke public). En rôle anon, les tables
--       guests / guest_passes / guest_visits ne sont PAS lisibles directement (42501).
--   (P) resolve_space_from_pass_v1 (rôle anon) — qr_token valide → found=true + space_token du MÊME client ;
--       qr_token d'un pass PASSÉ résout AUSSI (resolve = identité, pas présentabilité) ; qr inconnu / null /
--       vide / blanc → found=false, space_token null.
--   (E) get_guest_space_v1 (rôle anon) — jeton valide → found=true + first_name ; jeton inconnu / null →
--       { found:false } et rien d'autre ; MINIMISATION (clés exactes, pas de spend/party_size/phone) ;
--       AMPLIFICATION (seul le pass présentable expose son qr_token brut, les 3 autres = null) ; ISOLATION
--       (le jeton d'Alice ne renvoie pas les données de Bob) ; CHAÎNE intégrée resolve→get.
--   (A) rôle AUTHENTICATED (staff) — peut aussi appeler la RPC (ex. support) et obtient le même jsonb minimisé.
--   (W) LECTURE SEULE — après tous les appels RPC, les comptes guests / guest_passes / guest_visits sont
--       INCHANGÉS (aucune écriture déclenchée par les fonctions).
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Modèle exact de 0010/0013/0016/0017/0018. NON destructif, NON prod (LABO isolé), transaction ROLLBACK.

begin;

\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'

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
    return; -- 42501 = comportement attendu (permission denied)
end $$;

-- ------------------------------------------------------------
-- PRÉ-CHECK bloquant : aucune fixture de test ne doit préexister (protège les 2050 vrais clients).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.guests
             where phone in ('+33600000190','+33600000191')
                or first_name like 'TEST-0019-%') then
    raise exception 'PRÉ-CHECK guests : une fixture 0019 préexiste — vérification ANNULÉE (ne pas toucher une vraie donnée)';
  end if;
  if exists (select 1 from public.guest_passes where qr_token like 'TEST-0019-QR-%') then
    raise exception 'PRÉ-CHECK guest_passes : une fixture 0019 préexiste — vérification ANNULÉE';
  end if;
end $$;

-- ============================================================
-- (S) SCHÉMA — space_token uuid NOT NULL, default gen_random_uuid, index UNIQUE ; SECURITY DEFINER + search_path.
-- ============================================================
select pg_temp.expect(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='space_token'),
  'uuid', 'S1 guests.space_token est de type uuid');
select pg_temp.expect(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='space_token'),
  'NO', 'S2 guests.space_token est NOT NULL (tout client a un jeton d''accès)');
select pg_temp.expect(
  (select case when column_default like '%gen_random_uuid%' then 'ok' else 'ko' end
     from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='space_token'),
  'ok', 'S3 default = gen_random_uuid() (couvre tous les INSERT futurs, jeton non devinable 122 bits)');
select pg_temp.expect(
  (select indisunique::text from pg_index where indexrelid='public.guests_space_token_key'::regclass),
  'true', 'S4 index UNIQUE guests_space_token_key sur (space_token) (jeton globalement unique)');
-- Invariant lecture seule sur les 2050 vrais clients : chacun a un space_token non nul (rétro-remplissage 0019).
select pg_temp.expect(
  (select count(*)::text from public.guests where source='octotable' and space_token is null),
  '0', 'S5 aucun octotable réel sans space_token (les 2050 vrais clients ont tous un jeton d''accès)');
-- Les deux RPC sont SECURITY DEFINER avec search_path fixé (rule-20).
select pg_temp.expect(
  (select string_agg(prosecdef::text, '/' order by proname) from pg_proc
    where proname in ('get_guest_space_v1','resolve_space_from_pass_v1') and pronamespace='public'::regnamespace),
  'true/true', 'S6 les 2 RPC sont SECURITY DEFINER');
select pg_temp.expect(
  (select array_to_string(proconfig, ',') from pg_proc
    where proname='get_guest_space_v1' and pronamespace='public'::regnamespace),
  'search_path=public', 'S7 get_guest_space_v1 fixe search_path=public (rule-20)');
select pg_temp.expect(
  (select array_to_string(proconfig, ',') from pg_proc
    where proname='resolve_space_from_pass_v1' and pronamespace='public'::regnamespace),
  'search_path=public', 'S8 resolve_space_from_pass_v1 fixe search_path=public (rule-20)');

-- ============================================================
-- (G) GRANTS — EXECUTE pour anon ET authenticated (revoke public). (Le refus des tables à anon est en P/E.)
-- ============================================================
select pg_temp.expect(
  has_function_privilege('anon','public.resolve_space_from_pass_v1(text)','EXECUTE')::text,
  'true', 'G1 anon peut EXÉCUTER resolve_space_from_pass_v1');
select pg_temp.expect(
  has_function_privilege('anon','public.get_guest_space_v1(uuid)','EXECUTE')::text,
  'true', 'G2 anon peut EXÉCUTER get_guest_space_v1');
select pg_temp.expect(
  has_function_privilege('authenticated','public.resolve_space_from_pass_v1(text)','EXECUTE')::text,
  'true', 'G3 authenticated peut EXÉCUTER resolve_space_from_pass_v1 (staff/support)');
select pg_temp.expect(
  has_function_privilege('authenticated','public.get_guest_space_v1(uuid)','EXECUTE')::text,
  'true', 'G4 authenticated peut EXÉCUTER get_guest_space_v1');

-- ============================================================
-- FIXTURES (superuser) — 2 clients de TEST + leurs passes/visites, ANNULÉS au rollback.
--   Alice (190) : 4 passes couvrant les 4 cas d'amplification + 1 visite seated (spend/party_size renseignés).
--   Bob   (191) : 1 pass présentable + 1 visite → sert la preuve d'ISOLATION inter-clients.
-- ============================================================
insert into public.guests (phone, first_name, majorite_verifiee) values
 ('+33600000190','TEST-0019-Alice', true),
 ('+33600000191','TEST-0019-Bob',   true);

-- Alice — 4 passes : SEUL le 1er est « présentable » (issued + soirée future) → qr_token brut exposé.
insert into public.guest_passes (guest_id, exploitation_date, univers, qr_token, status, is_host)
 select id, current_date + 7, 'eden',     'TEST-0019-QR-FUT-ISSUED',    'issued',    false from public.guests where phone='+33600000190'
 union all
 select id, current_date - 7, 'eden',     'TEST-0019-QR-PAST-ISSUED',   'issued',    false from public.guests where phone='+33600000190'
 union all
 select id, current_date + 7, 'cercle',   'TEST-0019-QR-FUT-SCANNED',   'scanned',   false from public.guests where phone='+33600000190'
 union all
 select id, current_date + 8, 'terminus', 'TEST-0019-QR-FUT-CANCELLED', 'cancelled', false from public.guests where phone='+33600000190';

-- Alice — 1 visite seated avec spend_attributed ET party_size renseignés (pour prouver leur NON-exposition).
insert into public.guest_visits (guest_id, exploitation_date, univers, status, party_size, spend_attributed, is_host)
 select id, current_date - 3, 'eden', 'seated', 6, 200, true from public.guests where phone='+33600000190';

-- Bob — 1 pass présentable + 1 visite (données d'un TIERS, ne doivent JAMAIS apparaître dans l'espace d'Alice).
insert into public.guest_passes (guest_id, exploitation_date, univers, qr_token, status, is_host)
 select id, current_date + 7, 'eden', 'TEST-0019-QR-BOB', 'issued', false from public.guests where phone='+33600000191';
insert into public.guest_visits (guest_id, exploitation_date, univers, status, party_size, spend_attributed, is_host)
 select id, current_date - 5, 'terminus', 'seated', 2, 50, false from public.guests where phone='+33600000191';

-- Contrôle superuser : la visite d'Alice porte BIEN spend/party_size en base (ce que la RPC devra masquer).
select pg_temp.expect(
  (select spend_attributed::text||'/'||party_size::text from public.guest_visits gv
     join public.guests g on g.id=gv.guest_id where g.phone='+33600000190'),
  '200.00/6', 'F1 (contrôle) la visite d''Alice porte spend=200 et party_size=6 en base');

-- Jetons/space_token résolus EN SUPERUSER (le client, lui, ne détient QUE ces valeurs, jamais l'accès table).
select
  (select space_token::text from public.guests where phone='+33600000190') as alice_space,
  (select space_token::text from public.guests where phone='+33600000191') as bob_space,
  'TEST-0019-QR-FUT-ISSUED'  as alice_fut_qr,
  'TEST-0019-QR-PAST-ISSUED' as alice_past_qr
\gset

-- Baseline des comptes (pour la preuve de lecture seule (W) en fin de script).
select (select count(*) from public.guests)::text||'/'
     ||(select count(*) from public.guest_passes)::text||'/'
     ||(select count(*) from public.guest_visits)::text as baseline
\gset

-- ============================================================
-- (P)+(E)+(G tables) — TOUT sous le rôle ANON : le client public n'a QUE le jeton, jamais l'accès table.
-- ============================================================
set local role anon;

-- (G5/G6) anon ne peut PAS lire les tables directement — la seule voie est la RPC minimisée.
select pg_temp.expect_denied('select count(*) from public.guests',
  'G5 anon LECTURE directe de guests REFUSÉE (42501) — accès uniquement via RPC');
select pg_temp.expect_denied('select count(*) from public.guest_passes',
  'G6 anon LECTURE directe de guest_passes REFUSÉE (42501)');
select pg_temp.expect_denied('select count(*) from public.guest_visits',
  'G7 anon LECTURE directe de guest_visits REFUSÉE (42501)');

-- (P) resolve_space_from_pass_v1
select pg_temp.expect(
  (select found::text from public.resolve_space_from_pass_v1(:'alice_fut_qr')),
  'true', 'P1a qr_token valide → found=true');
select pg_temp.expect(
  (select space_token::text from public.resolve_space_from_pass_v1(:'alice_fut_qr')),
  :'alice_space', 'P1b resolve renvoie le space_token DU MÊME client (identité du porteur)');
-- Un qr d'un pass PASSÉ résout aussi : resolve = preuve d'identité, indépendante de la présentabilité.
select pg_temp.expect(
  (select space_token::text from public.resolve_space_from_pass_v1(:'alice_past_qr')),
  :'alice_space', 'P1c un qr d''un pass PASSÉ résout au MÊME space_token (resolve = identité, pas présentabilité)');
select pg_temp.expect(
  (select found::text||'/'||coalesce(space_token::text,'null') from public.resolve_space_from_pass_v1('TEST-0019-QR-INEXISTANT')),
  'false/null', 'P2 qr inconnu → found=false, space_token null (aucune fuite, aucune énumération utile)');
select pg_temp.expect(
  (select found::text from public.resolve_space_from_pass_v1(null)),
  'false', 'P3a qr null → found=false');
select pg_temp.expect(
  (select found::text from public.resolve_space_from_pass_v1('')),
  'false', 'P3b qr vide → found=false');
select pg_temp.expect(
  (select found::text from public.resolve_space_from_pass_v1('   ')),
  'false', 'P3c qr blanc (espaces) → found=false');

-- (E) get_guest_space_v1 — jeton d'Alice.
select pg_temp.expect(
  ((public.get_guest_space_v1(:'alice_space'::uuid))->>'found'),
  'true', 'E1a space_token valide → found=true');
select pg_temp.expect(
  ((public.get_guest_space_v1(:'alice_space'::uuid))->>'first_name'),
  'TEST-0019-Alice', 'E1b l''espace renvoie le prénom du BON client');
-- Jeton inconnu → { found:false } et RIEN d'autre (aucune énumération, uuid v4 ~122 bits).
select pg_temp.expect(
  ((public.get_guest_space_v1('00000000-0000-0000-0000-000000000000'::uuid))->>'found'),
  'false', 'E2a jeton inconnu → found=false');
select pg_temp.expect(
  (select string_agg(k, ',' order by k)
     from jsonb_object_keys(public.get_guest_space_v1('00000000-0000-0000-0000-000000000000'::uuid)) k),
  'found', 'E2b jeton inconnu → la seule clé est "found" (aucune donnée fuitée)');
select pg_temp.expect(
  ((public.get_guest_space_v1(null))->>'found'),
  'false', 'E3 space_token null → found=false');

-- (E-MIN) MINIMISATION : clés exactes au niveau racine + par objet, sans spend / party_size / téléphone.
select pg_temp.expect(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.get_guest_space_v1(:'alice_space'::uuid)) k),
  'first_name,found,passes,visits', 'E4 racine du jsonb = { first_name, found, passes, visits } et RIEN d''autre');
select pg_temp.expect(
  (select string_agg(k, ',' order by k)
     from jsonb_object_keys((public.get_guest_space_v1(:'alice_space'::uuid))->'visits'->0) k),
  'event_title,exploitation_date,is_host,status,univers',
  'E5a un objet visite = 5 clés minimisées (ni spend_attributed, ni party_size, ni tiers)');
select pg_temp.expect(
  (((public.get_guest_space_v1(:'alice_space'::uuid))->'visits'->0) ? 'spend_attributed')::text,
  'false', 'E5b la visite N''EXPOSE PAS spend_attributed (alors qu''il vaut 200 en base)');
select pg_temp.expect(
  (((public.get_guest_space_v1(:'alice_space'::uuid))->'visits'->0) ? 'party_size')::text,
  'false', 'E5c la visite N''EXPOSE PAS party_size (alors qu''il vaut 6 en base)');
-- Le pass présentable (issued + futur) porte exactement 6 clés dont qr_token.
select pg_temp.expect(
  (select string_agg(k, ',' order by k)
     from jsonb_array_elements((public.get_guest_space_v1(:'alice_space'::uuid))->'passes') p,
          jsonb_object_keys(p) k
    where p->>'status'='issued' and (p->>'exploitation_date')::date >= current_date),
  'event_title,exploitation_date,is_host,qr_token,status,univers',
  'E6 un objet pass = 6 clés minimisées (event_title, date, is_host, qr_token, status, univers)');

-- (E-AMP) AMPLIFICATION d'un qr_token capté : SEUL le pass présentable expose son jeton brut.
select pg_temp.expect(
  (select jsonb_array_length((public.get_guest_space_v1(:'alice_space'::uuid))->'passes'))::text,
  '4', 'E7 Alice a bien ses 4 passes remontés (aucun perdu)');
select pg_temp.expect(
  (select count(*)::text
     from jsonb_array_elements((public.get_guest_space_v1(:'alice_space'::uuid))->'passes') p
    where p->>'qr_token' is not null),
  '1', 'E8 UN SEUL pass expose un qr_token brut (le présentable) — les 3 autres masqués');
select pg_temp.expect(
  (select p->>'qr_token'
     from jsonb_array_elements((public.get_guest_space_v1(:'alice_space'::uuid))->'passes') p
    where p->>'qr_token' is not null),
  :'alice_fut_qr', 'E9 le qr_token exposé = celui du pass PRÉSENTABLE (issued + soirée future), brut');
select pg_temp.expect(
  (select ((p->>'qr_token') is null)::text
     from jsonb_array_elements((public.get_guest_space_v1(:'alice_space'::uuid))->'passes') p
    where p->>'status'='issued' and (p->>'exploitation_date')::date < current_date),
  'true', 'E10 pass PASSÉ (issued mais soirée révolue) → qr_token masqué (null)');
select pg_temp.expect(
  (select ((p->>'qr_token') is null)::text
     from jsonb_array_elements((public.get_guest_space_v1(:'alice_space'::uuid))->'passes') p
    where p->>'status'='scanned'),
  'true', 'E11 pass SCANNÉ (futur) → qr_token masqué (null) : ne pas rejouer un jeton déjà consommé');
select pg_temp.expect(
  (select ((p->>'qr_token') is null)::text
     from jsonb_array_elements((public.get_guest_space_v1(:'alice_space'::uuid))->'passes') p
    where p->>'status'='cancelled'),
  'true', 'E12 pass ANNULÉ (futur) → qr_token masqué (null)');

-- (E-ISO) ISOLATION INTER-CLIENTS : le jeton d'Alice ne renvoie JAMAIS les données de Bob.
select pg_temp.expect(
  (select jsonb_array_length((public.get_guest_space_v1(:'alice_space'::uuid))->'visits'))::text,
  '1', 'E13 l''espace d''Alice ne contient QUE sa visite (1), pas celle de Bob');
select pg_temp.expect(
  (select exists(
     select 1 from jsonb_array_elements((public.get_guest_space_v1(:'alice_space'::uuid))->'passes') p
      where p->>'qr_token'='TEST-0019-QR-BOB')::text),
  'false', 'E14 le pass de Bob n''apparaît JAMAIS dans l''espace d''Alice');
-- Réciproque : l'espace de Bob est bien le sien (bon prénom, 1 pass, 1 visite), disjoint d'Alice.
select pg_temp.expect(
  ((public.get_guest_space_v1(:'bob_space'::uuid))->>'first_name'),
  'TEST-0019-Bob', 'E15a l''espace de Bob renvoie SON prénom');
select pg_temp.expect(
  (select jsonb_array_length((public.get_guest_space_v1(:'bob_space'::uuid))->'passes'))::text
   ||'/'||(select jsonb_array_length((public.get_guest_space_v1(:'bob_space'::uuid))->'visits'))::text,
  '1/1', 'E15b l''espace de Bob = 1 pass + 1 visite (les siens), disjoint d''Alice');

-- (E-CHAIN) CHAÎNE intégrée réaliste (anon) : qr_token → resolve → space_token → get → prénom du bon client.
select pg_temp.expect(
  ((public.get_guest_space_v1(
      (select space_token from public.resolve_space_from_pass_v1(:'alice_fut_qr'))
    ))->>'first_name'),
  'TEST-0019-Alice', 'E16 chaîne anon qr→resolve→space→get aboutit au bon client (flux d''inscription réel)');

reset role;

-- ============================================================
-- (A) rôle AUTHENTICATED (staff) — peut aussi appeler la RPC (ex. support) et obtient le même jsonb minimisé.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect(
  ((public.get_guest_space_v1(:'alice_space'::uuid))->>'first_name'),
  'TEST-0019-Alice', 'A1 un staff authentifié peut aussi consulter l''espace (support) — même contenu minimisé');
select pg_temp.expect(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.get_guest_space_v1(:'alice_space'::uuid)) k),
  'first_name,found,passes,visits', 'A2 côté authenticated aussi : jsonb minimisé (aucune donnée de plus)');
reset role;

-- ============================================================
-- (W) LECTURE SEULE — après tous les appels RPC, les comptes de tables sont INCHANGÉS.
-- ============================================================
select pg_temp.expect(
  (select count(*) from public.guests)::text||'/'
   ||(select count(*) from public.guest_passes)::text||'/'
   ||(select count(*) from public.guest_visits)::text,
  :'baseline',
  'W les RPC sont en LECTURE SEULE : comptes guests/guest_passes/guest_visits inchangés après tous les appels');

select '0019 MINI-ESPACE CLIENT — TOUTES LES ASSERTIONS PASSENT (rollback : aucune fixture persistée ; 2050 vrais clients lus en seule lecture, jamais modifiés ; jeton opaque en lecture seule, minimisé, isolé, qr_token borné au présentable)' as resultat;

rollback;
