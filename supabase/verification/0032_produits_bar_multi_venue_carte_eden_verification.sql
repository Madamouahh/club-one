-- 0032_produits_bar_multi_venue_carte_eden_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0032 — carte Eden + multi-univers produits_bar.
--
-- Comble un TROU de la convention du dépôt : chaque migration 0009→0030 a son fichier de vérification,
-- 0031 et 0032 n'en avaient PAS. Ce script prouve, sur PostgreSQL réel et en LECTURE (transaction
-- annulée par rollback — aucune donnée de test ne persiste) :
--   · le SCHÉMA additif de 0032 (colonnes venue/disponible/a_verifier, check venue, unicité élargie
--     (venue, nom, format)) ;
--   · la FIDÉLITÉ du seed (124 lignes Eden ; 36 lignes club backfillées en 'terminus') ;
--   · les RÈGLES DURES du fondateur, encodées en invariants exécutables :
--       – « Mont d'Or rôti » RETIRÉ → JAMAIS seedé côté Eden ;
--       – cuisine Eden = EXACTEMENT 3 planches + 3 paninis ;
--       – a_verifier = EXACTEMENT {Volcan Blanco 4cl 13, Don Julio 1942 70cl 390, Bombay Sapphire
--         70cl 130}, et EUX SEULS ;
--   · l'unicité PAR UNIVERS (même produit possible Eden vs club à un prix différent, doublon
--     (venue, nom, format) refusé) ;
--   · la RLS : tout le staff connecté LIT la carte ; seule la DIRECTION (admin/manager) écrit ;
--     anon n'a aucun accès.
-- Chaque assertion échoue bruyamment (raise exception) si l'attendu n'est pas observé.
--
-- Complément (niveau 3, autonome sans base) : tests/carteEden.test.mts croise le TEXTE du seed 0032
-- avec docs/carte-eden-2026.md. Ce fichier-ci prouve les LIGNES RÉELLES en base (niveau 4).

begin;

-- Auth ids réels du labo (staff_users.auth_id) — mêmes que 0024_venue_tables_verification.
\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- ------------------------------------------------------------
-- 1) SCHÉMA — colonnes additives, check venue, unicité élargie.
-- ------------------------------------------------------------
do $$
declare
  n_cols     int;
  dispo_def  text;
  n_unique   int;
begin
  select count(*) into n_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'produits_bar'
     and column_name in ('venue', 'disponible', 'a_verifier');
  if n_cols <> 3 then raise exception 'ATTENDU colonnes venue/disponible/a_verifier, OBTENU % / 3', n_cols; end if;

  -- disponible : structurellement NOT NULL default true (toggle rupture en soirée).
  select column_default into dispo_def from information_schema.columns
   where table_schema = 'public' and table_name = 'produits_bar' and column_name = 'disponible';
  if dispo_def is null or dispo_def not ilike '%true%' then
    raise exception 'ATTENDU disponible DEFAULT true, OBTENU %', coalesce(dispo_def, 'NULL');
  end if;

  -- check venue in (eden, terminus, commun).
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.produits_bar'::regclass and conname = 'produits_bar_venue_chk'
  ) then raise exception 'ATTENDU contrainte produits_bar_venue_chk absente'; end if;

  -- unicité élargie (venue, nom, format) — pas (nom, format).
  select count(*) into n_unique from pg_indexes
   where schemaname = 'public' and tablename = 'produits_bar'
     and indexdef ilike '%unique%(venue, nom, format)%';
  if n_unique <> 1 then raise exception 'ATTENDU unique index (venue, nom, format), OBTENU %', n_unique; end if;
end $$;

-- check venue MORD : une venue inconnue est refusée.
do $$
begin
  insert into public.produits_bar (nom, categorie, prix_vente, venue)
  values ('TEST-VENUE-INVALIDE', 'Test', 1, 'martien');
  raise exception 'FAILLE: venue « martien » acceptée (attendu: check produits_bar_venue_chk)';
exception
  when check_violation then null; -- comportement attendu
end $$;

-- ------------------------------------------------------------
-- 2) SEED — comptes par univers.
-- ------------------------------------------------------------
do $$
declare n_eden int; n_terminus int; n_bad_price int;
begin
  select count(*) into n_eden      from public.produits_bar where venue = 'eden';
  select count(*) into n_terminus  from public.produits_bar where venue = 'terminus';
  select count(*) into n_bad_price from public.produits_bar where venue = 'eden'
     and (prix_vente is null or prix_vente <= 0);

  if n_eden      <> 124 then raise exception 'ATTENDU 124 produits Eden, OBTENU %', n_eden; end if;
  if n_terminus  <> 36  then raise exception 'ATTENDU 36 produits club backfillés terminus, OBTENU %', n_terminus; end if;
  if n_bad_price <> 0   then raise exception 'ATTENDU 0 prix Eden null/<=0, OBTENU %', n_bad_price; end if;
end $$;

-- ------------------------------------------------------------
-- 3) RÈGLES DURES DU FONDATEUR (invariants exécutables).
-- ------------------------------------------------------------
do $$
declare
  n_montdor  int;
  n_cuisine  int;
  n_planche  int;
  n_panini   int;
  n_verifier int;
  n_verif_ok int;
begin
  -- (a) Mont d'Or rôti RETIRÉ → jamais côté Eden.
  select count(*) into n_montdor from public.produits_bar
   where venue = 'eden' and nom ilike '%mont d%or%';
  if n_montdor <> 0 then raise exception 'FAILLE règle fondateur: Mont d''Or seedé côté Eden (%)', n_montdor; end if;

  -- (b) Cuisine Eden = EXACTEMENT 3 planches + 3 paninis.
  select count(*) into n_cuisine from public.produits_bar where venue = 'eden' and categorie = 'Cuisine';
  select count(*) into n_planche from public.produits_bar where venue = 'eden' and categorie = 'Cuisine' and nom ilike 'planche%';
  select count(*) into n_panini  from public.produits_bar where venue = 'eden' and categorie = 'Cuisine' and nom ilike 'panini%';
  if n_cuisine <> 6 then raise exception 'ATTENDU cuisine Eden = 6 items (3 planches + 3 paninis), OBTENU %', n_cuisine; end if;
  if n_planche <> 3 then raise exception 'ATTENDU 3 planches, OBTENU %', n_planche; end if;
  if n_panini  <> 3 then raise exception 'ATTENDU 3 paninis, OBTENU %', n_panini; end if;

  -- (c) a_verifier = EXACTEMENT les 3 mappings flaggés, et eux seuls (toutes venues confondues).
  select count(*) into n_verifier from public.produits_bar where a_verifier;
  if n_verifier <> 3 then raise exception 'ATTENDU 3 lignes a_verifier, OBTENU %', n_verifier; end if;

  select count(*) into n_verif_ok from public.produits_bar
   where a_verifier and venue = 'eden'
     and (
       (nom ilike 'Tequila Volcan Blanco%' and format = '4cl'  and prix_vente = 13)
    or (nom ilike 'Tequila Don Julio 1942%' and format = '70cl' and prix_vente = 390)
    or (nom ilike 'Gin Bombay Sapphire%'    and format = '70cl' and prix_vente = 130)
     );
  if n_verif_ok <> 3 then
    raise exception 'ATTENDU a_verifier = {Volcan 4cl 13, Don Julio 70cl 390, Bombay 70cl 130}, OBTENU % concordants', n_verif_ok;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4) UNICITÉ PAR UNIVERS — même produit Eden vs club OK, doublon (venue,nom,format) refusé.
--    (Testé en tant qu'admin, puis rollback.)
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'admin_id');

insert into public.produits_bar (nom, categorie, format, prix_vente, venue)
values ('TEST-UNICITE', 'Test', '70cl', 100, 'eden');

-- même nom+format sous une AUTRE venue : autorisé (prix différent par univers).
insert into public.produits_bar (nom, categorie, format, prix_vente, venue)
values ('TEST-UNICITE', 'Test', '70cl', 200, 'commun');

-- doublon exact (venue, nom, format) : refusé.
do $$
begin
  insert into public.produits_bar (nom, categorie, format, prix_vente, venue)
  values ('TEST-UNICITE', 'Test', '70cl', 300, 'eden');
  raise exception 'FAILLE: doublon (eden, TEST-UNICITE, 70cl) accepté (attendu: unique_violation)';
exception
  when unique_violation then null; -- comportement attendu
end $$;

-- ------------------------------------------------------------
-- 5) RLS — lecture staff, écriture direction seule, anon exclu.
-- ------------------------------------------------------------
-- 5a) server (non-direction) LIT la carte Eden.
select pg_temp.act_as(:'server_id');
do $$
declare n int;
begin
  select count(*) into n from public.produits_bar where venue = 'eden';
  if n < 124 then raise exception 'ATTENDU: server lit la carte Eden (>=124), OBTENU %', n; end if;
end $$;

-- 5b) server est REFUSÉ à l'insert (WITH CHECK direction-only).
do $$
begin
  insert into public.produits_bar (nom, categorie, prix_vente, venue)
  values ('TEST-SERVER', 'Test', 5, 'eden');
  raise exception 'FAILLE: server a pu inserer un produit (attendu: refuse RLS)';
exception
  when insufficient_privilege then null; -- comportement attendu
end $$;

-- 5c) manager (direction) modifie un prix (toggle géré ailleurs) puis rollback.
select pg_temp.act_as(:'manager_id');
update public.produits_bar set disponible = false where venue = 'eden' and nom = 'TEST-UNICITE';
do $$
declare d boolean;
begin
  select disponible into d from public.produits_bar where venue = 'eden' and nom = 'TEST-UNICITE';
  if d is not false then raise exception 'ATTENDU: manager bascule disponible=false, OBTENU %', d; end if;
end $$;

-- 5d) anon : aucun accès.
reset role;
set local role anon;
do $$
declare n int;
begin
  select count(*) into n from public.produits_bar;
  raise exception 'FAILLE: anon a lu % lignes produits_bar (attendu: refuse)', n;
exception
  when insufficient_privilege then null; -- comportement attendu (aucun grant anon)
end $$;

reset role;

select '0032 carte Eden (schéma multi-venue + seed 124 + règles fondateur Mont d''Or/cuisine/a_verifier + unicité par univers + RLS) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée de test persistée, seed intact)' as resultat;

rollback;
