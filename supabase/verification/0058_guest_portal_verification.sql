-- 0058_guest_portal_verification.sql — preuve de comportement du PORTAIL CLIENT (migration 0058_guest_portal.sql)
-- sur le LABO. Prolonge 0019 (mini-espace) avec : E2 self-service préférences/consentements, E3 agenda mensuel
-- public, E6 durcissement du lien porteur (expiration, rotation/révocation, PIN de re-accès sans email/SMS).
--
-- Ce que le MOTEUR (pas l'UI) doit garantir, prouvé ici :
--   (S) SCHÉMA — colonnes ajoutées (preferences jsonb, image_consent boolean, space_token_expires_at timestamptz,
--       access_pin_hash text), toutes nullable ; les 6 fonctions 0058 sont SECURITY DEFINER + search_path=public.
--   (G) GRANTS — les RPC anon-facing ont EXECUTE pour anon ET authenticated (revoke public) ; en rôle anon les
--       tables guests/guest_passes/guest_visits restent NON lisibles directement (42501) : accès via RPC only.
--   (M) public_month_events_v1 — ne renvoie QUE des soirées PUBLIÉES du mois demandé (ni draft, ni archived,
--       ni hors-mois) ; p_venue null = toutes salles, sinon filtre par salle ; mois/année hors bornes → 0 ligne.
--   (E) get_guest_space_v2 — jeton valide non expiré → found=true + preferences/image_consent ; jeton EXPIRÉ →
--       found=false, expired=true, has_pin (AUCUNE donnée) ; jeton inconnu/null → found=false.
--   (P) set_guest_preferences_v1 — whitelist stricte (seules musique/table/allergies persistées, bornées 280) ;
--       jeton expiré → refus 'expired' ; jeton inconnu → 'invalid_token'.
--   (R) rotate_guest_space_token_v1 — régénère le jeton (l'ancien ne résout plus) + arme une expiration future ;
--       jeton expiré ne se rotationne pas (révocation par expiration effective).
--   (K) set_guest_pin_v1 / verify_guest_pin_v1 — PIN 4..8 chiffres, hashé (jamais en clair) ; verify accepte un
--       jeton EXPIRÉ et, si le PIN correspond, RÉ-ARME l'expiration → re-accès SANS canal externe ; PIN faux /
--       absent → réponse neutre 'pin_invalid' (anti-énumération).
--
-- Fixtures = lignes de TEST clairement marquées (phones +3360000058x, prénoms 'TEST-0058-…'), vérifiées ABSENTES
-- avant exécution (pré-check bloquant), transaction ANNULÉE (rollback). Les vrais clients ne sont JAMAIS modifiés.
-- Modèle exact de 0019. NON destructif, NON prod (LABO isolé).

begin;

\set admin_id '62143b51-2f76-4eb3-bda4-ab3655e983ba'

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
-- PRÉ-CHECK bloquant : aucune fixture 0058 ne doit préexister.
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.guests
             where phone in ('+33600000580','+33600000581')
                or first_name like 'TEST-0058-%') then
    raise exception 'PRÉ-CHECK guests : une fixture 0058 préexiste — vérification ANNULÉE';
  end if;
  if exists (select 1 from public.events where slug like 'test-0058-%') then
    raise exception 'PRÉ-CHECK events : une fixture 0058 préexiste — vérification ANNULÉE';
  end if;
end $$;

-- ============================================================
-- (S) SCHÉMA — colonnes ajoutées (nullable) + attributs de sécurité des 6 fonctions.
-- ============================================================
select pg_temp.expect(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='preferences'),
  'jsonb', 'S1 guests.preferences est jsonb');
select pg_temp.expect(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='image_consent'),
  'boolean', 'S2 guests.image_consent est boolean');
select pg_temp.expect(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='space_token_expires_at'),
  'timestamp with time zone', 'S3 guests.space_token_expires_at est timestamptz');
select pg_temp.expect(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='guests' and column_name='access_pin_hash'),
  'text', 'S4 guests.access_pin_hash est text');
select pg_temp.expect(
  (select string_agg(is_nullable, '/' order by column_name) from information_schema.columns
    where table_schema='public' and table_name='guests'
      and column_name in ('access_pin_hash','image_consent','preferences','space_token_expires_at')),
  'YES/YES/YES/YES', 'S5 les 4 colonnes ajoutées sont nullable (additif non contraignant)');
-- Les 6 fonctions 0058 sont SECURITY DEFINER (prosecdef=true) ...
select pg_temp.expect(
  (select string_agg(distinct prosecdef::text, ',') from pg_proc
    where pronamespace='public'::regnamespace
      and proname in ('public_month_events_v1','get_guest_space_v2','set_guest_preferences_v1',
                      'rotate_guest_space_token_v1','set_guest_pin_v1','verify_guest_pin_v1')),
  'true', 'S6 les 6 RPC 0058 sont SECURITY DEFINER');
-- ... et fixent un search_path EXPLICITE et figé (rule-20). Les 2 RPC PIN incluent `extensions`
-- (pgcrypto crypt/gen_salt y vit sous Supabase) — toujours explicite/figé, donc conforme.
select pg_temp.expect(
  (select count(*)::text from pg_proc
    where pronamespace='public'::regnamespace
      and proname in ('public_month_events_v1','get_guest_space_v2','set_guest_preferences_v1',
                      'rotate_guest_space_token_v1','set_guest_pin_v1','verify_guest_pin_v1')
      and array_to_string(proconfig, ',') in ('search_path=public','search_path=public, extensions','search_path="public, extensions"')),
  '6', 'S7 les 6 RPC 0058 fixent un search_path explicite figé (public[, extensions]) (rule-20)');

-- ============================================================
-- (G) GRANTS — EXECUTE anon + authenticated (revoke public) sur les RPC anon-facing.
-- ============================================================
select pg_temp.expect(
  has_function_privilege('anon','public.public_month_events_v1(text,int,int)','EXECUTE')::text,
  'true', 'G1 anon peut EXÉCUTER public_month_events_v1');
select pg_temp.expect(
  has_function_privilege('anon','public.get_guest_space_v2(uuid)','EXECUTE')::text,
  'true', 'G2 anon peut EXÉCUTER get_guest_space_v2');
select pg_temp.expect(
  has_function_privilege('anon','public.set_guest_preferences_v1(uuid,jsonb,boolean)','EXECUTE')::text,
  'true', 'G3 anon peut EXÉCUTER set_guest_preferences_v1');
select pg_temp.expect(
  has_function_privilege('anon','public.rotate_guest_space_token_v1(uuid)','EXECUTE')::text,
  'true', 'G4 anon peut EXÉCUTER rotate_guest_space_token_v1');
select pg_temp.expect(
  has_function_privilege('anon','public.set_guest_pin_v1(uuid,text)','EXECUTE')::text,
  'true', 'G5 anon peut EXÉCUTER set_guest_pin_v1');
select pg_temp.expect(
  has_function_privilege('anon','public.verify_guest_pin_v1(uuid,text)','EXECUTE')::text,
  'true', 'G6 anon peut EXÉCUTER verify_guest_pin_v1');
select pg_temp.expect(
  (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
     from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('public_month_events_v1','get_guest_space_v2','set_guest_preferences_v1',
                        'rotate_guest_space_token_v1','set_guest_pin_v1','verify_guest_pin_v1')),
  'true', 'G7 authenticated peut EXÉCUTER les 6 RPC (support)');
-- Aucune de ces fonctions n'est exécutable par le pseudo-rôle PUBLIC (revoke public appliqué).
select pg_temp.expect(
  (select bool_or(has_function_privilege('public', p.oid, 'EXECUTE'))::text
     from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('public_month_events_v1','get_guest_space_v2','set_guest_preferences_v1',
                        'rotate_guest_space_token_v1','set_guest_pin_v1','verify_guest_pin_v1')),
  'false', 'G8 PUBLIC n''a AUCUN EXECUTE sur les RPC 0058 (revoke public)');

-- ============================================================
-- FIXTURES (superuser) — 2 clients de TEST + soirées d'agenda. Rollback en fin de script.
-- ============================================================
insert into public.guests (phone, first_name, majorite_verifiee) values
 ('+33600000580','TEST-0058-Alice', true),
 ('+33600000581','TEST-0058-Bob',   true);

-- Soirées d'agenda : 1 publiée eden ce mois, 1 publiée cercle ce mois, 1 DRAFT eden ce mois (à exclure),
-- 1 publiée eden le mois PROCHAIN (hors fenêtre), 1 ARCHIVED eden ce mois (à exclure).
insert into public.events (venue_id, title, slug, event_date, status) values
 ('eden',   'TEST-0058 Eden pub',      'test-0058-eden-pub',   date_trunc('month', current_date)::date + 5,  'published'),
 ('cercle', 'TEST-0058 Cercle pub',    'test-0058-cercle-pub', date_trunc('month', current_date)::date + 6,  'published'),
 ('eden',   'TEST-0058 Eden draft',    'test-0058-eden-draft', date_trunc('month', current_date)::date + 7,  'draft'),
 ('eden',   'TEST-0058 Eden nextm',    'test-0058-eden-next',  (date_trunc('month', current_date) + interval '1 month')::date + 3, 'published'),
 ('eden',   'TEST-0058 Eden archived', 'test-0058-eden-arch',  date_trunc('month', current_date)::date + 8,  'archived');

select
  (select space_token::text from public.guests where phone='+33600000580') as alice_space,
  (extract(year  from current_date))::int::text as cur_year,
  (extract(month from current_date))::int::text as cur_month
\gset

select (select count(*) from public.guests)::text||'/'
     ||(select count(*) from public.guest_passes)::text||'/'
     ||(select count(*) from public.guest_visits)::text as baseline
\gset

-- ============================================================
-- Tout sous rôle ANON : le client public n'a que le jeton, jamais l'accès table.
-- ============================================================
set local role anon;

select pg_temp.expect_denied('select count(*) from public.guests',
  'G9 anon LECTURE directe de guests REFUSÉE (42501) — accès uniquement via RPC');

-- (M) public_month_events_v1 — mois courant.
select pg_temp.expect(
  (select count(*)::text from public.public_month_events_v1(null, :cur_year::int, :cur_month::int)
    where slug like 'test-0058-%'),
  '2', 'M1 mois courant, toutes salles → 2 soirées PUBLIÉES (draft/archived/mois suivant exclus)');
select pg_temp.expect(
  (select count(*)::text from public.public_month_events_v1('eden', :cur_year::int, :cur_month::int)
    where slug like 'test-0058-%'),
  '1', 'M2 filtre salle=eden → 1 seule soirée eden publiée ce mois');
select pg_temp.expect(
  (select bool_and(slug not in ('test-0058-eden-draft','test-0058-eden-arch','test-0058-eden-next'))::text
     from public.public_month_events_v1(null, :cur_year::int, :cur_month::int) where slug like 'test-0058-%'),
  'true', 'M3 aucune soirée draft/archived/hors-mois n''est renvoyée');
select pg_temp.expect(
  (select count(*)::text from public.public_month_events_v1(null, 1999, 13)),
  '0', 'M4 année/mois hors bornes → aucune ligne (garde de format, pas d''erreur)');
select pg_temp.expect(
  (select count(*)::text from public.public_month_events_v1(null, :cur_year::int, 13)),
  '0', 'M5 mois=13 → aucune ligne');

-- (E) get_guest_space_v2 — jeton valide (pas d'expiration posée → NULL = jamais expiré).
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid))->>'found'),
  'true', 'E1 jeton valide non expiré → found=true');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid)) ? 'preferences')::text,
  'true', 'E2 v2 expose la clé preferences (préremplissage E2)');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid)) ? 'image_consent')::text,
  'true', 'E3 v2 expose la clé image_consent');
select pg_temp.expect(
  ((public.get_guest_space_v2('00000000-0000-0000-0000-000000000000'::uuid))->>'found'),
  'false', 'E4 jeton inconnu → found=false');
select pg_temp.expect(
  ((public.get_guest_space_v2(null))->>'found'),
  'false', 'E5 jeton null → found=false');

-- (P) set_guest_preferences_v1 — whitelist + persistance.
select pg_temp.expect(
  ((public.set_guest_preferences_v1(:'alice_space'::uuid,
      jsonb_build_object('musique','techno','table','près du DJ','allergies','arachides',
                         'admin', true, 'phone','+33600000000'),
      true))->>'ok'),
  'true', 'P1 écriture préférences OK (jeton valide)');
-- Les clés parasites (admin/phone) ne sont PAS persistées ; seules les 3 clés whitelistées le sont.
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid))->'preferences'->>'musique'),
  'techno', 'P2 la préférence musique est bien persistée et relue');
select pg_temp.expect(
  (select string_agg(k, ',' order by k)
     from jsonb_object_keys((public.get_guest_space_v2(:'alice_space'::uuid))->'preferences') k),
  'allergies,musique,table', 'P3 SEULES les 3 clés whitelistées sont persistées (admin/phone rejetées)');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid))->>'image_consent'),
  'true', 'P4 image_consent persisté (self-service droit à l''image E2)');
-- Bornage 280 caractères (whitelist tronque).
select pg_temp.expect(
  (length((public.set_guest_preferences_v1(:'alice_space'::uuid,
      jsonb_build_object('musique', repeat('a', 500)), false))->'preferences'->>'musique'))::text,
  '280', 'P5 valeur de préférence tronquée à 280 caractères (anti-bloat)');
select pg_temp.expect(
  ((public.set_guest_preferences_v1('00000000-0000-0000-0000-000000000000'::uuid, '{}'::jsonb, false))->>'code'),
  'invalid_token', 'P6 jeton inconnu → refus invalid_token');

-- (K) PIN — set puis verify (jeton encore valide).
select pg_temp.expect(
  ((public.set_guest_pin_v1(:'alice_space'::uuid, '1234'))->>'ok'),
  'true', 'K1 set PIN 4 chiffres OK');
select pg_temp.expect(
  ((public.set_guest_pin_v1(:'alice_space'::uuid, '12'))->>'code'),
  'pin_format', 'K2 PIN trop court → refus pin_format');
select pg_temp.expect(
  ((public.set_guest_pin_v1(:'alice_space'::uuid, 'abcd'))->>'code'),
  'pin_format', 'K3 PIN non numérique → refus pin_format');
select pg_temp.expect(
  ((public.verify_guest_pin_v1(:'alice_space'::uuid, '9999'))->>'code'),
  'pin_invalid', 'K4 mauvais PIN → réponse neutre pin_invalid (anti-énumération)');
select pg_temp.expect(
  ((public.verify_guest_pin_v1(:'alice_space'::uuid, '1234'))->>'ok'),
  'true', 'K5 bon PIN → ok=true');
reset role;

-- Le PIN n'est JAMAIS stocké en clair (hash bcrypt commençant par $2).
select pg_temp.expect(
  (select left(access_pin_hash, 2) from public.guests where phone='+33600000580'),
  '$2', 'K6 access_pin_hash est un hash bcrypt ($2…), jamais le PIN en clair');

-- ============================================================
-- (R)+(E-EXP) EXPIRATION & ROTATION — poser une expiration passée en superuser puis observer le rejet.
-- ============================================================
update public.guests set space_token_expires_at = now() - interval '1 day' where phone='+33600000580';

set local role anon;
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid))->>'found'),
  'false', 'E6 lien EXPIRÉ → found=false (aucune donnée renvoyée)');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid))->>'expired'),
  'true', 'E7 lien EXPIRÉ → expired=true (l''UI propose le re-accès par PIN)');
select pg_temp.expect(
  ((public.set_guest_preferences_v1(:'alice_space'::uuid, '{}'::jsonb, false))->>'code'),
  'expired', 'P7 écriture préférences refusée sur lien EXPIRÉ');
select pg_temp.expect(
  ((public.rotate_guest_space_token_v1(:'alice_space'::uuid))->>'code'),
  'expired', 'R1 un lien EXPIRÉ ne peut PAS se rotationner seul (révocation par expiration effective)');

-- verify_guest_pin_v1 accepte un jeton EXPIRÉ et, si le PIN est bon, RÉ-ARME l'expiration (re-accès sans email).
select pg_temp.expect(
  ((public.verify_guest_pin_v1(:'alice_space'::uuid, '1234'))->>'ok'),
  'true', 'K7 verify PIN accepte un jeton EXPIRÉ (c''est le canal de re-accès)');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid))->>'found'),
  'true', 'K8 après verify PIN réussi, le lien REDEVIENT valide (expiration ré-armée) → re-accès SANS email/SMS');

-- (R) ROTATION sur lien ré-armé : nouveau jeton, l'ancien ne résout plus.
select ((public.rotate_guest_space_token_v1(:'alice_space'::uuid))->>'space_token') as new_space \gset
select pg_temp.expect(
  (case when :'new_space' = :'alice_space' then 'same' else 'different' end),
  'different', 'R2 rotation → nouveau space_token distinct de l''ancien');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'alice_space'::uuid))->>'found'),
  'false', 'R3 l''ANCIEN jeton ne résout plus après rotation (révocation concrète)');
select pg_temp.expect(
  ((public.get_guest_space_v2(:'new_space'::uuid))->>'found'),
  'true', 'R4 le NOUVEAU jeton résout (accès préservé pour le porteur légitime)');
reset role;

-- ============================================================
-- (W) LECTURE SEULE des tables NON ciblées — guest_passes/guest_visits inchangés (0058 ne les écrit pas).
-- ============================================================
select pg_temp.expect(
  (select count(*) from public.guest_passes)::text||'/'||(select count(*) from public.guest_visits)::text,
  split_part(:'baseline','/',2)||'/'||split_part(:'baseline','/',3),
  'W guest_passes/guest_visits inchangés (0058 n''écrit que guests.preferences/pin/expiry)');

select '0058 PORTAIL CLIENT — TOUTES LES ASSERTIONS PASSENT (rollback : aucune fixture persistée ; expiration/rotation/PIN prouvés ; agenda mensuel borné aux publiées ; préférences whitelistées et bornées ; PIN hashé)' as resultat;

rollback;
