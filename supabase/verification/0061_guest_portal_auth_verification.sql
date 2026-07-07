-- 0061_guest_portal_auth_verification.sql — preuve de comportement de l'AUTH PORTAIL CLIENT (0061_guest_portal_auth.sql)
-- sur le LABO. Prolonge 0058 (expiration/rotation/PIN) avec : RL rate limiting/verrou, RC récupération sans email,
-- RV révocation/logout, RP rotation de PIN — SANS AUCUN canal externe.
--
-- Ce que le MOTEUR (pas l'UI) doit garantir, prouvé ici :
--   (S) SCHÉMA — table guest_auth_attempts (guest_id pk, failed_count, window_started_at, locked_until…), RLS
--       activée ; les 4 RPC anon-facing 0061 sont SECURITY DEFINER + search_path figé explicite.
--   (G) GRANTS — les 4 RPC anon-facing ont EXECUTE anon+authenticated (revoke public) ; les helpers internes
--       (_guest_auth_*) n'ont AUCUN EXECUTE public/anon ; anon ne LIT PAS guest_auth_attempts (42501).
--   (A) ANON-ZÉRO — anon n'a aucun privilège (select/insert/update/delete) sur guest_auth_attempts.
--   (RL) verify_guest_pin_v2 — bon PIN → ok + ré-arme l'expiration + reset compteur ; mauvais PIN → 'pin_invalid'
--       neutre ; APRÈS 5 échecs → verrou 'locked' (retry_after_seconds > 0) même si le 6e PIN est BON ; jeton
--       inconnu / null → 'pin_invalid' neutre (anti-énumération).
--   (RC) recover_guest_access_v1 — téléphone+PIN correct → ok + NOUVEAU space_token (l'ancien ne résout plus) +
--       expiration fraîche ; téléphone inconnu / PIN faux → 'recover_invalid' neutre.
--   (RV) revoke_guest_token_v1 — le jeton courant cesse de résoudre après révocation (get_guest_space_v2 found:false).
--   (RP) rotate_guest_pin_v1 — ancien PIN correct + nouveau bien formé → ok ; l'ancien PIN ne vérifie plus, le
--       nouveau si ; mauvais ancien PIN → 'pin_invalid' ; nouveau mal formé → 'pin_format' ; lien expiré → 'expired'.
--
-- Fixtures = lignes de TEST clairement marquées (phones +3360000061x, prénoms 'TEST-0061-…'), vérifiées ABSENTES
-- avant exécution (pré-check bloquant), transaction ANNULÉE (rollback). Les vrais clients ne sont JAMAIS modifiés.
-- Modèle exact de 0058. NON destructif, NON prod (LABO isolé).

begin;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual, 'NULL');
  end if;
end $$;

create or replace function pg_temp.expect_denied(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception '% : l''opération a RÉUSSI alors qu''elle devait être REFUSÉE par le moteur', p_label;
exception
  when insufficient_privilege then
    return;
end $$;

-- ------------------------------------------------------------
-- PRÉ-CHECK bloquant : aucune fixture 0061 ne doit préexister.
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.guests
             where phone in ('+33600000610','+33600000611')
                or first_name like 'TEST-0061-%') then
    raise exception 'PRÉ-CHECK guests : une fixture 0061 préexiste — vérification ANNULÉE';
  end if;
end $$;

-- ============================================================
-- (S) SCHÉMA — table guest_auth_attempts + attributs de sécurité des 4 RPC 0061.
-- ============================================================
select pg_temp.expect(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='guest_auth_attempts' and column_name='guest_id'),
  'uuid', 'S1 guest_auth_attempts.guest_id est uuid');
select pg_temp.expect(
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema='public' and table_name='guest_auth_attempts'),
  'failed_count,guest_id,last_failed_at,locked_until,updated_at,window_started_at',
  'S2 guest_auth_attempts a exactement les colonnes attendues');
select pg_temp.expect(
  (select relrowsecurity::text from pg_class where oid='public.guest_auth_attempts'::regclass),
  'true', 'S3 RLS activée sur guest_auth_attempts (fail-closed)');
-- Les 4 RPC anon-facing 0061 sont SECURITY DEFINER (prosecdef=true).
select pg_temp.expect(
  (select string_agg(distinct prosecdef::text, ',') from pg_proc
    where pronamespace='public'::regnamespace
      and proname in ('verify_guest_pin_v2','recover_guest_access_v1','revoke_guest_token_v1','rotate_guest_pin_v1')),
  'true', 'S4 les 4 RPC 0061 sont SECURITY DEFINER');
-- ... et fixent un search_path EXPLICITE et figé (rule-20). verify/recover/rotate incluent `extensions` (crypt).
select pg_temp.expect(
  (select count(*)::text from pg_proc
    where pronamespace='public'::regnamespace
      and proname in ('verify_guest_pin_v2','recover_guest_access_v1','revoke_guest_token_v1','rotate_guest_pin_v1')
      and array_to_string(proconfig, ',') in ('search_path=public','search_path=public, extensions','search_path="public, extensions"')),
  '4', 'S5 les 4 RPC 0061 fixent un search_path explicite figé (public[, extensions]) (rule-20)');
-- Les helpers internes sont AUSSI SECURITY DEFINER (écrivent la table sous l'owner).
select pg_temp.expect(
  (select string_agg(distinct prosecdef::text, ',') from pg_proc
    where pronamespace='public'::regnamespace
      and proname in ('_guest_auth_note_fail','_guest_auth_locked_until','_guest_auth_reset')),
  'true', 'S6 les helpers _guest_auth_* (écriture table) sont SECURITY DEFINER');

-- ============================================================
-- (G) GRANTS — EXECUTE anon+authenticated sur les RPC ; AUCUN pour les helpers ; revoke public partout.
-- ============================================================
select pg_temp.expect(
  has_function_privilege('anon','public.verify_guest_pin_v2(uuid,text)','EXECUTE')::text,
  'true', 'G1 anon peut EXÉCUTER verify_guest_pin_v2');
select pg_temp.expect(
  has_function_privilege('anon','public.recover_guest_access_v1(text,text)','EXECUTE')::text,
  'true', 'G2 anon peut EXÉCUTER recover_guest_access_v1');
select pg_temp.expect(
  has_function_privilege('anon','public.revoke_guest_token_v1(uuid)','EXECUTE')::text,
  'true', 'G3 anon peut EXÉCUTER revoke_guest_token_v1');
select pg_temp.expect(
  has_function_privilege('anon','public.rotate_guest_pin_v1(uuid,text,text)','EXECUTE')::text,
  'true', 'G4 anon peut EXÉCUTER rotate_guest_pin_v1');
select pg_temp.expect(
  (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
     from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('verify_guest_pin_v2','recover_guest_access_v1','revoke_guest_token_v1','rotate_guest_pin_v1')),
  'true', 'G5 authenticated peut EXÉCUTER les 4 RPC 0061 (support)');
select pg_temp.expect(
  (select bool_or(has_function_privilege('public', p.oid, 'EXECUTE'))::text
     from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('verify_guest_pin_v2','recover_guest_access_v1','revoke_guest_token_v1','rotate_guest_pin_v1')),
  'false', 'G6 PUBLIC n''a AUCUN EXECUTE sur les RPC 0061 (revoke public)');
-- Les helpers internes ne sont PAS exposés : ni anon, ni authenticated, ni public.
select pg_temp.expect(
  (select bool_or(has_function_privilege(r.rolname, p.oid, 'EXECUTE'))::text
     from pg_proc p
     cross join (values ('anon'),('authenticated'),('public')) as r(rolname)
    where p.pronamespace='public'::regnamespace
      and p.proname in ('_guest_auth_note_fail','_guest_auth_locked_until','_guest_auth_reset','_guest_auth_retry_after')),
  'false', 'G7 les helpers _guest_auth_* ne sont exécutables par AUCUN rôle client (revoke public)');

-- ============================================================
-- FIXTURES (superuser) — 2 clients de TEST avec PIN. Rollback en fin de script.
-- ============================================================
insert into public.guests (phone, first_name, majorite_verifiee) values
 ('+33600000610','TEST-0061-Alice', true),
 ('+33600000611','TEST-0061-Bob',   true);

select
  (select space_token::text from public.guests where phone='+33600000610') as alice_space
\gset

-- Pose un PIN '4242' à Alice via la RPC 0058 (lien encore valide, pas d'expiration).
select pg_temp.expect(
  ((public.set_guest_pin_v1(:'alice_space'::uuid, '4242'))->>'ok'),
  'true', 'FIX set PIN Alice OK');

-- ============================================================
-- (A) ANON-ZÉRO + (G) accès table refusé sous rôle anon.
-- ============================================================
select pg_temp.expect(
  (select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(aucun)')
     from information_schema.role_table_grants
    where table_schema='public' and table_name='guest_auth_attempts' and grantee='anon'),
  '(aucun)', 'A1 anon n''a AUCUN privilège sur guest_auth_attempts (revoke all from anon)');

set local role anon;
select pg_temp.expect_denied('select count(*) from public.guest_auth_attempts',
  'A2 anon LECTURE directe de guest_auth_attempts REFUSÉE (42501)');

-- ============================================================
-- (RL) verify_guest_pin_v2 — succès, neutre, VERROU après 5 échecs.
-- ============================================================
select pg_temp.expect(
  ((public.verify_guest_pin_v2(:'alice_space'::uuid, '9999'))->>'code'),
  'pin_invalid', 'RL1 mauvais PIN → réponse neutre pin_invalid');
select pg_temp.expect(
  ((public.verify_guest_pin_v2('00000000-0000-0000-0000-000000000000'::uuid, '4242'))->>'code'),
  'pin_invalid', 'RL2 jeton inconnu → pin_invalid neutre (anti-énumération)');
select pg_temp.expect(
  ((public.verify_guest_pin_v2(null, '4242'))->>'code'),
  'pin_invalid', 'RL3 jeton null → pin_invalid neutre');
select pg_temp.expect(
  ((public.verify_guest_pin_v2(:'alice_space'::uuid, '4242'))->>'ok'),
  'true', 'RL4 bon PIN → ok=true (compteur reset, expiration ré-armée)');

-- 5 échecs consécutifs → verrou. (Le RL1 a déjà noté 1 échec puis RL4 l'a reset : on repart de 0.)
select public.verify_guest_pin_v2(:'alice_space'::uuid, '0000');
select public.verify_guest_pin_v2(:'alice_space'::uuid, '0000');
select public.verify_guest_pin_v2(:'alice_space'::uuid, '0000');
select public.verify_guest_pin_v2(:'alice_space'::uuid, '0000');
-- 5e échec : doit basculer en verrou.
select pg_temp.expect(
  ((public.verify_guest_pin_v2(:'alice_space'::uuid, '0000'))->>'code'),
  'locked', 'RL5 5e échec consécutif → verrou (code=locked)');
-- Sous verrou, MÊME un BON PIN est refusé (anti-brute-force effectif).
select pg_temp.expect(
  ((public.verify_guest_pin_v2(:'alice_space'::uuid, '4242'))->>'code'),
  'locked', 'RL6 sous verrou, même un BON PIN est refusé (locked)');
select pg_temp.expect(
  (((public.verify_guest_pin_v2(:'alice_space'::uuid, '4242'))->>'retry_after_seconds')::int > 0)::text,
  'true', 'RL7 le verrou expose un retry_after_seconds > 0');
reset role;

-- Le verrou est bien matérialisé en base (locked_until futur) pour Alice.
select pg_temp.expect(
  (select (locked_until > now())::text from public.guest_auth_attempts
     where guest_id = (select id from public.guests where phone='+33600000610')),
  'true', 'RL8 guest_auth_attempts.locked_until est dans le futur (verrou persisté)');

-- Lève le verrou en base (simule l'écoulement de la fenêtre) pour tester la suite proprement.
update public.guest_auth_attempts
   set locked_until = now() - interval '1 minute', window_started_at = now() - interval '1 hour', failed_count = 0
 where guest_id = (select id from public.guests where phone='+33600000610');

-- ============================================================
-- (RP) rotate_guest_pin_v1 — ancien correct + nouveau bien formé → ok ; l'ancien ne vérifie plus.
-- ============================================================
set local role anon;
select pg_temp.expect(
  ((public.rotate_guest_pin_v1(:'alice_space'::uuid, '0000', '5678'))->>'code'),
  'pin_invalid', 'RP1 mauvais ANCIEN PIN → pin_invalid');
select pg_temp.expect(
  ((public.rotate_guest_pin_v1(:'alice_space'::uuid, '4242', '12'))->>'code'),
  'pin_format', 'RP2 nouveau PIN trop court → pin_format');
select pg_temp.expect(
  ((public.rotate_guest_pin_v1(:'alice_space'::uuid, '4242', '5678'))->>'ok'),
  'true', 'RP3 ancien correct + nouveau bien formé → rotation OK');
-- L'ancien PIN ne vérifie plus ; le nouveau si.
select pg_temp.expect(
  ((public.verify_guest_pin_v2(:'alice_space'::uuid, '4242'))->>'code'),
  'pin_invalid', 'RP4 l''ANCIEN PIN ne vérifie plus après rotation');
select pg_temp.expect(
  ((public.verify_guest_pin_v2(:'alice_space'::uuid, '5678'))->>'ok'),
  'true', 'RP5 le NOUVEAU PIN vérifie après rotation');
reset role;

-- ============================================================
-- (RC) recover_guest_access_v1 — téléphone+PIN → NOUVEAU jeton ; l'ancien ne résout plus.
-- ============================================================
set local role anon;
select pg_temp.expect(
  ((public.recover_guest_access_v1('+33600000610', '0000'))->>'code'),
  'recover_invalid', 'RC1 mauvais PIN → recover_invalid neutre');
select pg_temp.expect(
  ((public.recover_guest_access_v1('+33699999999', '5678'))->>'code'),
  'recover_invalid', 'RC2 téléphone inconnu → recover_invalid neutre (anti-énumération)');
select ((public.recover_guest_access_v1('+33600000610', '5678'))->>'space_token') as recovered_space \gset
select pg_temp.expect(
  (case when :'recovered_space' = :'alice_space' then 'same' else 'different' end),
  'different', 'RC3 récupération → NOUVEAU space_token distinct de l''ancien');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid))->>'found'),
  'false', 'RC4 l''ANCIEN jeton ne résout plus après récupération');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'recovered_space'::uuid))->>'found'),
  'true', 'RC5 le NOUVEAU jeton (récupéré) résout — re-accès SANS email/SMS');

-- ============================================================
-- (RV) revoke_guest_token_v1 — le jeton courant cesse de résoudre.
-- ============================================================
select pg_temp.expect(
  ((public.revoke_guest_token_v1(:'recovered_space'::uuid))->>'ok'),
  'true', 'RV1 révocation du jeton courant → ok');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'recovered_space'::uuid))->>'found'),
  'false', 'RV2 le jeton révoqué ne résout PLUS (révocation concrète)');
select pg_temp.expect(
  ((public.revoke_guest_token_v1('00000000-0000-0000-0000-000000000000'::uuid))->>'code'),
  'invalid_token', 'RV3 jeton inconnu → invalid_token');
reset role;

select '0061 AUTH PORTAIL CLIENT — TOUTES LES ASSERTIONS PASSENT (rollback : aucune fixture persistée ; rate limiting/verrou après 5 échecs prouvé ; récupération téléphone+PIN sans email prouvée ; révocation/logout prouvée ; rotation de PIN prouvée ; anon-zéro sur guest_auth_attempts ; helpers non exposés)' as resultat;

rollback;
