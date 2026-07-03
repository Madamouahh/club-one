-- 0010_caisse_z_stock_verification.sql — preuve de comportement RLS/grants du module STOCK/CAISSE
-- (migration 0010_caisse_z_stock.sql) sur le LABO. Deux tables : caisse_z (le relevé de clôture « Z »,
-- RÉSERVÉ AU DIRECTIONNEL) et produits_bar (catalogue bar, LU par tout le staff connecté, ÉCRIT par la
-- direction seule). Club One LIT la caisse, il n'ENCAISSE jamais → le Z est du reporting append/update,
-- jamais supprimable (intégrité d'audit anti-fraude TVA).
--
-- Exécuté dans une TRANSACTION annulée (ROLLBACK) : AUCUNE donnée de test ne persiste. Le LABO reste
-- exactement dans son état d'entrée (caisse_z vide, 36 produits réels intacts).
--
-- Prouve, sur PostgreSQL réel, imposé par le MOTEUR (RLS/grants — JAMAIS par l'UI) :
--
--   (A) ANON TOTALEMENT FERMÉ — `revoke all ... from anon` : anon ne peut ni lire caisse_z ni lire
--       produits_bar (permission denied, SQLSTATE 42501).
--   (B) CAISSE_Z CANTONNÉE À LA DIRECTION — server / security / security_counter / promoteur :
--       (B1..B4) ne VOIENT AUCUN Z (RLS `using role in ('admin','manager')` → 0 ligne, la ligne existe
--       pourtant) ; (B5..B8) ne peuvent PAS INSÉRER de Z (with_check → 42501) ; (B9) leur UPDATE est un
--       NO-OP (RLS using → 0 ligne touchée, la valeur reste intacte).
--   (C) CAISSE_Z PILOTÉE PAR LA DIRECTION — admin ET manager (direction non-admin) VOIENT le Z ;
--       l'admin peut INSÉRER un nouveau Z et METTRE À JOUR un Z existant.
--   (D) LE Z NE SE SUPPRIME JAMAIS — aucun grant DELETE (ni policy delete) : même l'admin est REFUSÉ
--       (42501). Le relevé de caisse est append/update-only (piste d'audit préservée).
--   (E) CATALOGUE BAR LU PAR TOUT LE STAFF — produits_bar `using (true)` : server ET security voient
--       les 36 produits (référence partagée pour la saisie du Z / le futur stock).
--   (F) CATALOGUE BAR ÉCRIT PAR LA DIRECTION SEULE — server ne peut PAS INSÉRER un produit (with_check
--       → 42501) et son UPDATE est un NO-OP (using → prix inchangé) ; l'admin peut AJOUTER et MODIFIER.
--
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- Fixtures = dates de test 1990-01-0x (clairement hors exploitation) + produits préfixés TEST- ; vérifiées
-- ABSENTES avant exécution (pré-check bloquant). Staff = comptes RÉELS du LABO. Modèle exact de 0013/0016.

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
-- violation RLS with_check). Si l'opération réussit, l'assertion échoue bruyamment.
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
-- PRÉ-CHECK bloquant : aucune fixture de test ne doit préexister (protège les vraies données du LABO).
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.caisse_z
             where exploitation_date in (date '1990-01-02', date '1990-01-03', date '1990-01-04')) then
    raise exception 'PRÉ-CHECK : un Z de test préexiste — vérification ANNULÉE (ne pas toucher une vraie donnée)';
  end if;
  if exists (select 1 from public.produits_bar where nom in ('TEST-PROD-0010','TEST-PROD-server')) then
    raise exception 'PRÉ-CHECK : un produit de test préexiste — vérification ANNULÉE';
  end if;
end $$;

-- ============================================================
-- FIXTURE (superuser) : 1 Z de test (event_id null = FK nullable), clairement marqué TEST.
-- ============================================================
insert into public.caisse_z (exploitation_date, venue, source, ca_ttc, saisi_par, commentaire)
values (date '1990-01-02', 'eden', 'manual', 1234.50, 'TEST', 'TEST-0010-verif');

-- Capture le prix de VENTE réel d'un produit du catalogue pour prouver le NO-OP d'un update non-direction.
select prix_vente as redbull_price from public.produits_bar where nom = 'Red Bull' limit 1 \gset

-- ============================================================
-- (A) ANON TOTALEMENT FERMÉ — revoke all from anon.
-- ============================================================
set local role anon;
select pg_temp.expect_denied('select count(*) from public.caisse_z',    'A1 anon LECTURE caisse_z REFUSÉE (revoke all from anon)');
select pg_temp.expect_denied('select count(*) from public.produits_bar','A2 anon LECTURE produits_bar REFUSÉE (revoke all from anon)');
reset role;

-- ============================================================
-- (B) CAISSE_Z CANTONNÉE À LA DIRECTION — non-direction : pas de lecture, pas d'insert, update no-op.
-- ============================================================
-- B1..B4 : les 4 rôles non-direction ne VOIENT AUCUN Z (la ligne existe pourtant).
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect((select count(*)::text from public.caisse_z where exploitation_date = date '1990-01-02'),'0','B1 server ne VOIT pas le Z (RLS direction)');
select pg_temp.act_as(:'security_id');
select pg_temp.expect((select count(*)::text from public.caisse_z where exploitation_date = date '1990-01-02'),'0','B2 security ne VOIT pas le Z');
select pg_temp.act_as(:'counter_id');
select pg_temp.expect((select count(*)::text from public.caisse_z where exploitation_date = date '1990-01-02'),'0','B3 security_counter ne VOIT pas le Z');
select pg_temp.act_as(:'promoter_id');
select pg_temp.expect((select count(*)::text from public.caisse_z where exploitation_date = date '1990-01-02'),'0','B4 promoteur ne VOIT pas le Z');

-- B5..B8 : les 4 rôles non-direction ne peuvent PAS INSÉRER de Z (with_check → 42501).
select pg_temp.act_as(:'server_id');
select pg_temp.expect_denied($$insert into public.caisse_z(exploitation_date,venue,ca_ttc) values (date '1990-01-03','cercle',1)$$,'B5 server ne peut PAS insérer un Z');
select pg_temp.act_as(:'security_id');
select pg_temp.expect_denied($$insert into public.caisse_z(exploitation_date,venue,ca_ttc) values (date '1990-01-03','cercle',1)$$,'B6 security ne peut PAS insérer un Z');
select pg_temp.act_as(:'counter_id');
select pg_temp.expect_denied($$insert into public.caisse_z(exploitation_date,venue,ca_ttc) values (date '1990-01-03','cercle',1)$$,'B7 security_counter ne peut PAS insérer un Z');
select pg_temp.act_as(:'promoter_id');
select pg_temp.expect_denied($$insert into public.caisse_z(exploitation_date,venue,ca_ttc) values (date '1990-01-03','cercle',1)$$,'B8 promoteur ne peut PAS insérer un Z');

-- B9 : l'UPDATE d'un non-direction est un NO-OP (RLS using → 0 ligne touchée, aucune erreur, valeur intacte).
select pg_temp.act_as(:'server_id');
update public.caisse_z set ca_ttc = 99999 where exploitation_date = date '1990-01-02';
reset role;
select pg_temp.expect((select ca_ttc::text from public.caisse_z where exploitation_date = date '1990-01-02'),'1234.50','B9 UPDATE par server = NO-OP (RLS using direction) : le Z reste à 1234.50');

-- ============================================================
-- (C) CAISSE_Z PILOTÉE PAR LA DIRECTION — admin + manager voient ; admin insère et met à jour.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect((select count(*)::text from public.caisse_z where exploitation_date = date '1990-01-02'),'1','C1 admin VOIT le Z');
insert into public.caisse_z(exploitation_date,venue,ca_ttc,saisi_par,commentaire)
  values (date '1990-01-04','terminus',500,'TEST','TEST-0010-admin-insert');
select pg_temp.expect((select count(*)::text from public.caisse_z where exploitation_date = date '1990-01-04'),'1','C2 admin peut INSÉRER un Z');
update public.caisse_z set ca_ttc = 777 where exploitation_date = date '1990-01-02';
select pg_temp.expect((select ca_ttc::text from public.caisse_z where exploitation_date = date '1990-01-02'),'777.00','C3 admin peut METTRE À JOUR un Z');
select pg_temp.act_as(:'manager_id');
select pg_temp.expect((select count(*)::text from public.caisse_z where exploitation_date = date '1990-01-02'),'1','C4 manager (direction non-admin) VOIT le Z');
reset role;

-- ============================================================
-- (D) LE Z NE SE SUPPRIME JAMAIS — aucun grant DELETE : même l'admin est refusé (42501).
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_id');
select pg_temp.expect_denied($$delete from public.caisse_z where exploitation_date = date '1990-01-02'$$,'D1 même l''admin ne peut PAS SUPPRIMER un Z (aucun grant DELETE — intégrité d''audit)');
reset role;

-- ============================================================
-- (E) CATALOGUE BAR LU PAR TOUT LE STAFF — produits_bar using(true).
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect((select (count(*) >= 36)::text from public.produits_bar),'true','E1 server (staff) VOIT le catalogue bar (>= 36 produits)');
select pg_temp.act_as(:'security_id');
select pg_temp.expect((select (count(*) >= 36)::text from public.produits_bar),'true','E2 security VOIT le catalogue bar');
reset role;

-- ============================================================
-- (F) CATALOGUE BAR ÉCRIT PAR LA DIRECTION SEULE — server refusé en insert + no-op en update ; admin OK.
-- ============================================================
-- F1 : insert par un non-direction → refusé (with_check → 42501).
set local role authenticated; select pg_temp.act_as(:'server_id');
select pg_temp.expect_denied($$insert into public.produits_bar(categorie,nom,format,prix_vente) values ('TEST','TEST-PROD-server','x',1)$$,'F1 server ne peut PAS ajouter un produit (écriture = direction)');
-- F2 : update par un non-direction → NO-OP (using → 0 ligne, prix réel du catalogue inchangé).
update public.produits_bar set prix_vente = 999 where nom = 'Red Bull';
reset role;
select pg_temp.expect((select prix_vente::text from public.produits_bar where nom = 'Red Bull'),:'redbull_price','F2 UPDATE catalogue par server = NO-OP (RLS using direction) : prix inchangé');
-- F3/F4 : l'admin peut AJOUTER et MODIFIER un produit.
set local role authenticated; select pg_temp.act_as(:'admin_id');
insert into public.produits_bar(categorie,nom,format,prix_vente) values ('TEST-CAT','TEST-PROD-0010','test',1.00);
select pg_temp.expect((select count(*)::text from public.produits_bar where nom = 'TEST-PROD-0010'),'1','F3 admin peut AJOUTER un produit');
update public.produits_bar set prix_vente = 2.00 where nom = 'TEST-PROD-0010';
select pg_temp.expect((select prix_vente::text from public.produits_bar where nom = 'TEST-PROD-0010'),'2.00','F4 admin peut MODIFIER un produit');
reset role;

select '0010 CAISSE_Z / PRODUITS_BAR — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée, LABO restauré : caisse_z vide, 36 produits réels intacts)' as resultat;

rollback;
