-- 0011_rh_planning_verification.sql — preuve de comportement RLS + RPC du module RH / Planning (B7)
-- sur le LABO, matrice RÉELLE après 0011 + 0020 (self-confirm) + 0021 (privacy colonne).
--
-- Exécuté dans une TRANSACTION annulée (rollback) : AUCUNE donnée de test ne persiste (le module ship
-- VIDE — staff_members/staff_shifts à 0 ligne tant que le fondateur n'a pas fourni la vraie liste du
-- personnel). Simule un vrai JWT par rôle (set role authenticated + request.jwt.claims->sub) pour
-- prouver, sur PostgreSQL réel, que la matrice B7 est imposée par le MOTEUR (RLS + grants colonne + RPC
-- SECURITY DEFINER), jamais par l'UI :
--   · MANAGER (direction) compose le répertoire (insert 2 fiches) et le planning (insert 3 shifts) ;
--   · PRIVACY COLONNE (0021) : même la direction ne lit PAS taux_horaire / notes_direction par accès
--     table direct (grant colonne révoqué pour `authenticated`) → seule la RPC list_staff_members_v1()
--     restitue ces 2 colonnes, et UNIQUEMENT à admin/manager ;
--   · SERVER (salarié) : voit SA fiche seule + SES shifts seuls (RLS row-level), ne lit pas taux même
--     sur SA fiche (privacy colonne), ne compose NI fiche NI shift (write direction seule) ;
--   · SELF-CONFIRM (0020) : le salarié confirme SON créneau (planifie→confirme) via confirm_my_shift_v1,
--     idempotent ; ne confirme PAS le créneau d'un autre (forbidden) ; ne peut PAS confirmer un créneau
--     déjà traité par la direction (present → not_confirmable) ;
--   · PROMOTER (sans fiche) : ne lit RIEN, ne compose pas, list_staff_members_v1 → forbidden ;
--   · un compte authentifié SANS mapping staff (auth.uid null) → list_staff_members_v1 forbidden
--     (garde FAIL-CLOSED de 0021, coalesce role null).
-- Chaque assertion échoue bruyamment (raise exception) si le comportement attendu n'est pas observé.
-- NOTE : les sub ci-dessous sont des auth_id du LABO (staff_users.auth_id) ; identiques à 0023..0029.
-- Les fiches de test sont rattachées à des usernames RÉELS du LABO ('server') + un username FICTIF
-- clairement marqué ('TEST-autre-salarie', rattaché à AUCUN compte) pour l'isolement inter-salarié.

begin;

\set admin_id    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_id  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set promoter_id '72b72390-32bc-4bda-b489-f0b95ed22288'
\set security_id '8177e05b-90fa-41d8-a2ba-2468acb296f7'
\set server_id   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- Un compte `authenticated` sans mapping staff (aucun sub) : auth.uid() renverra null.
create or replace function pg_temp.act_unmapped() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
end $$;

-- ------------------------------------------------------------
-- 1) MANAGER (direction) : compose le répertoire (2 fiches) + le planning (3 shifts). Writes OK.
--    - fiche 'server'            → rattachée au compte LABO 'server' (chemin « ma fiche »)
--    - fiche 'TEST-autre-salarie'→ rattachée à AUCUN compte (cible d'isolement inter-salarié)
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'manager_id');

insert into public.staff_members (username, full_name, poste, contrat_type, taux_horaire, notes_direction) values
  ('server',             'TEST rollback — Salarié Server', 'bar',   'cdi',   15.50, 'TEST rollback — note direction confidentielle'),
  ('TEST-autre-salarie', 'TEST rollback — Autre Salarié',  'accueil','extra', 12.00, 'TEST rollback — autre note');

insert into public.staff_shifts (staff_member_id, exploitation_date, poste, status)
select id, current_date,     'bar',    'planifie' from public.staff_members where username = 'server';
insert into public.staff_shifts (staff_member_id, exploitation_date, poste, status)
select id, current_date + 1, 'bar',    'planifie' from public.staff_members where username = 'server';
insert into public.staff_shifts (staff_member_id, exploitation_date, poste, status)
select id, current_date,     'accueil','planifie' from public.staff_members where username = 'TEST-autre-salarie';

do $$
declare nm int; ns int;
begin
  select count(*) into nm from public.staff_members where full_name like 'TEST rollback%';
  select count(*) into ns from public.staff_shifts;
  if nm <> 2 then raise exception 'ATTENDU: manager compose 2 fiches, OBTENU %', nm; end if;
  if ns <> 3 then raise exception 'ATTENDU: manager compose 3 shifts, OBTENU %', ns; end if;
end $$;

-- La direction traite l'un des créneaux server (pointage réel) : current_date+1 → 'present'.
-- (rend ce créneau NON confirmable par le salarié plus bas).
update public.staff_shifts s
   set status = 'present'
  from public.staff_members m
 where m.id = s.staff_member_id and m.username = 'server' and s.exploitation_date = current_date + 1;

-- Capture des ids nécessaires dans des GUC de session (rhtest.*) — la direction voit tout. Un GUC
-- personnalisé est lisible côté serveur QUEL QUE SOIT le rôle (contrairement à une lecture de table
-- soumise à la RLS), ce qui permet, sous le rôle server, de cibler le créneau d'un AUTRE salarié
-- (invisible en table pour lui) pour prouver la branche « forbidden » de confirm_my_shift_v1.
-- is_local=true → valeurs cantonnées à cette transaction (annulée au rollback).
select set_config('rhtest.srv_today',
  (select s.id::text from public.staff_shifts s join public.staff_members m on m.id = s.staff_member_id
    where m.username = 'server' and s.exploitation_date = current_date), true);
select set_config('rhtest.srv_present',
  (select s.id::text from public.staff_shifts s join public.staff_members m on m.id = s.staff_member_id
    where m.username = 'server' and s.exploitation_date = current_date + 1), true);
select set_config('rhtest.autre_today',
  (select s.id::text from public.staff_shifts s join public.staff_members m on m.id = s.staff_member_id
    where m.username = 'TEST-autre-salarie' and s.exploitation_date = current_date), true);

-- ------------------------------------------------------------
-- 2) PRIVACY COLONNE (0021) : même la direction ne lit PAS taux_horaire / notes_direction par accès
--    table direct ; seule la RPC list_staff_members_v1() les restitue (admin/manager).
-- ------------------------------------------------------------
-- Colonnes non sensibles : lisibles en direct.
do $$
declare v text;
begin
  select full_name into v from public.staff_members where username = 'server';
  if v is null then raise exception 'ATTENDU: direction lit full_name en direct, OBTENU null'; end if;
end $$;

-- taux_horaire : SELECT colonne révoqué pour `authenticated` → refus même pour la direction (accès direct).
do $$
begin
  begin
    perform taux_horaire from public.staff_members where username = 'server';
    raise exception 'ATTENDU: lecture directe de taux_horaire REFUSÉE (privacy colonne), mais elle a réussi';
  exception when insufficient_privilege then
    null; -- comportement attendu : grant colonne révoqué (0021)
  end;
end $$;

-- notes_direction : idem, refus en accès direct.
do $$
begin
  begin
    perform notes_direction from public.staff_members where username = 'server';
    raise exception 'ATTENDU: lecture directe de notes_direction REFUSÉE (privacy colonne), mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- La RPC gardée restitue le répertoire COMPLET (taux + notes) à la direction.
do $$
declare n int; t numeric;
begin
  select count(*) into n from public.list_staff_members_v1();
  if n <> 2 then raise exception 'ATTENDU: list_staff_members_v1 renvoie 2 fiches à la direction, OBTENU %', n; end if;
  select taux_horaire into t from public.list_staff_members_v1() where username = 'server';
  if t is distinct from 15.50 then raise exception 'ATTENDU: taux_horaire=15.50 via RPC direction, OBTENU %', t; end if;
end $$;

-- ------------------------------------------------------------
-- 3) SERVER (salarié) : SA fiche seule + SES shifts seuls ; pas de taux même sur SA fiche ; write refusé.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'server_id');

-- Row-level : voit UNIQUEMENT sa fiche (username='server'), pas celle de l'autre.
do $$
declare n int; v text;
begin
  select count(*) into n from public.staff_members;
  if n <> 1 then raise exception 'ATTENDU: server voit SA fiche seule (1), OBTENU %', n; end if;
  select username into v from public.staff_members;
  if v <> 'server' then raise exception 'ATTENDU: la fiche visible est celle de server, OBTENU %', v; end if;
end $$;

-- Row-level shifts : voit UNIQUEMENT ses 2 créneaux, pas celui de l'autre salarié.
do $$
declare n int;
begin
  select count(*) into n from public.staff_shifts;
  if n <> 2 then raise exception 'ATTENDU: server voit SES 2 shifts seuls, OBTENU %', n; end if;
end $$;

-- Privacy colonne : le salarié ne lit pas son PROPRE taux_horaire par accès direct.
do $$
begin
  begin
    perform taux_horaire from public.staff_members;
    raise exception 'ATTENDU: server ne lit pas son propre taux_horaire en direct, mais il a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Write refusé : le salarié ne compose NI fiche NI shift (direction seule).
do $$
begin
  begin
    insert into public.staff_members (username, full_name) values ('TEST-server-interdit', 'TEST');
    raise exception 'ATTENDU: composition de fiche par server REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null; -- RLS with check (direction seule)
  end;
end $$;

do $$
declare v_mid uuid;
begin
  select id into v_mid from public.staff_members where username = 'server';
  begin
    insert into public.staff_shifts (staff_member_id, exploitation_date, status)
    values (v_mid, current_date + 5, 'planifie');
    raise exception 'ATTENDU: composition de shift par server REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- list_staff_members_v1 : refusé au salarié (garde admin/manager).
do $$
begin
  begin
    perform * from public.list_staff_members_v1();
    raise exception 'ATTENDU: list_staff_members_v1 REFUSÉE au server, mais elle a réussi';
  exception when insufficient_privilege then
    null; -- raise 'forbidden' errcode 42501 (0021)
  end;
end $$;

-- SELF-CONFIRM (0020) : server confirme SON créneau du jour (planifie → confirme).
do $$
declare v_ok boolean; v_code text; v_status text;
begin
  select ok, code, status into v_ok, v_code, v_status
    from public.confirm_my_shift_v1(current_setting('rhtest.srv_today')::uuid);
  if v_ok is not true or v_code <> 'ok' or v_status <> 'confirme' then
    raise exception 'ATTENDU: confirm_my_shift OK/confirme, OBTENU ok=% code=% status=%', v_ok, v_code, v_status;
  end if;
end $$;

-- Idempotence : re-confirmer SON créneau déjà confirmé → succès sans nouvelle écriture ('already').
do $$
declare v_ok boolean; v_code text;
begin
  select ok, code into v_ok, v_code
    from public.confirm_my_shift_v1(current_setting('rhtest.srv_today')::uuid);
  if v_ok is not true or v_code <> 'already' then
    raise exception 'ATTENDU: re-confirm idempotent (already), OBTENU ok=% code=%', v_ok, v_code;
  end if;
end $$;

-- Isolement : server ne confirme PAS le créneau d'un AUTRE salarié (forbidden).
do $$
declare v_ok boolean; v_code text;
begin
  select ok, code into v_ok, v_code
    from public.confirm_my_shift_v1(current_setting('rhtest.autre_today')::uuid);
  if v_ok is not false or v_code <> 'forbidden' then
    raise exception 'ATTENDU: confirm du créneau d''autrui REFUSÉ (forbidden), OBTENU ok=% code=%', v_ok, v_code;
  end if;
end $$;

-- Anti-falsification du pointage : un créneau déjà traité par la direction ('present') n'est PAS
-- confirmable par le salarié (not_confirmable) — le pointage réel reste prérogative direction.
do $$
declare v_ok boolean; v_code text;
begin
  select ok, code into v_ok, v_code
    from public.confirm_my_shift_v1(current_setting('rhtest.srv_present')::uuid);
  if v_ok is not false or v_code <> 'not_confirmable' then
    raise exception 'ATTENDU: créneau present NON confirmable (not_confirmable), OBTENU ok=% code=%', v_ok, v_code;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4) PROMOTER (aucune fiche rattachée) : ne lit RIEN, ne compose pas, RPC direction refusée.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'promoter_id');

do $$
declare nm int; ns int;
begin
  select count(*) into nm from public.staff_members;
  select count(*) into ns from public.staff_shifts;
  if nm <> 0 then raise exception 'ATTENDU: promoter ne lit aucune fiche (0), OBTENU %', nm; end if;
  if ns <> 0 then raise exception 'ATTENDU: promoter ne lit aucun shift (0), OBTENU %', ns; end if;
end $$;

do $$
begin
  begin
    insert into public.staff_members (username, full_name) values ('TEST-promoter-interdit', 'TEST');
    raise exception 'ATTENDU: composition de fiche par promoter REFUSÉE, mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

do $$
begin
  begin
    perform * from public.list_staff_members_v1();
    raise exception 'ATTENDU: list_staff_members_v1 REFUSÉE au promoter, mais elle a réussi';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ------------------------------------------------------------
-- 5) COMPTE AUTHENTIFIÉ NON MAPPÉ (auth.uid null) : list_staff_members_v1 FAIL-CLOSED (0021, coalesce).
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_unmapped();

do $$
begin
  begin
    perform * from public.list_staff_members_v1();
    raise exception 'ATTENDU: list_staff_members_v1 REFUSÉE au compte non mappé (uid null), mais elle a réussi';
  exception when insufficient_privilege then
    null; -- garde auth.uid() is null → forbidden
  end;
end $$;

-- ------------------------------------------------------------
-- 6) DIRECTION relit : le self-confirm du server a bien persisté (planifie → confirme) DANS la txn.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(:'manager_id');

do $$
declare v text;
begin
  select s.status into v from public.staff_shifts s
    join public.staff_members m on m.id = s.staff_member_id
   where m.username = 'server' and s.exploitation_date = current_date;
  if v <> 'confirme' then raise exception 'ATTENDU: shift server du jour = confirme après self-confirm, OBTENU %', v; end if;
end $$;

reset role;
select '0011 RH/Planning — RLS row-level + privacy colonne (0021) + self-confirm (0020) : TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
