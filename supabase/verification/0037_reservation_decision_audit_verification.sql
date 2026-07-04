-- 0037_reservation_decision_audit_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0037 — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR
-- LA DÉCISION DE RÉSERVATION (`decide_table_reservation_v1`, action `reservation.approve|decline`).
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) `decide_table_reservation_v1` reste SECURITY DEFINER + search_path=public + VOLATILE ;
--       EXECUTE accordé à `authenticated`, RÉVOQUÉ à `anon` (le durcissement de 0025 est préservé) ;
--   (B) APPROVE (admin) : la demande passe RÉELLEMENT à `approved`, une visite CRM `booked` est créée,
--       et UNE ligne d'audit `reservation.approve` before=pending / after=approved est écrite, acteur
--       estampillé depuis la SESSION (admin/lab-admin-01), venue + event_id propagés depuis la demande ;
--   (C) DECLINE (admin, motif) : la demande passe RÉELLEMENT à `declined` (+ motif staff), et UNE ligne
--       d'audit `reservation.decline` after=declined + decline_reason est écrite ;
--   (D) FAIL-CLOSED : un `server` (ni admin ni manager) reçoit ok=false/unauthorized, la demande reste
--       `pending` (aucune mutation) et AUCUNE ligne d'audit n'est écrite pour cette demande (une décision
--       refusée n'entre pas au journal — cohérent avec le retour non-vacuité admin de B) ;
--   (E) ACTEUR NON USURPABLE / stamping : une validation par un `manager` estampille actor_role='manager'
--       (contraste avec 'admin') — aucun paramètre d'acteur n'existe dans la RPC ;
--   (F) MINIMISATION : ni le PRÉNOM du client, ni sa NOTE libre n'apparaissent NULLE PART dans le journal
--       (résumé/before/after/metadata) — le journal direction ne fuit aucune PII client.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- Fixtures créées EN SUPERUSER (postgres, RLS contournée) puis décisions jouées sous des sessions staff
-- réelles. subs des staff_users identiques à 0034/0035 (LABO). Les variables psql (:'var'/\gset) NE SONT
-- PAS interpolées dans les blocs $$…$$ : bascules d'identité, captures et assertions passent par des
-- helpers pg_temp appelés depuis des SELECT normaux (tradition 0033/0034/0035).

begin;

\set admin_sub   '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_sub '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set server_sub  '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'
\set ev          '7f2ed369-34c5-4ca2-adc4-865ce6b9b3e7'
\set exdate      '2099-10-01'

-- Bascule d'identité (sub présent → auth.uid()=sub).
create or replace function pg_temp.act_as(p_sub text) returns void
language plpgsql as $$
begin
  if p_sub is null then
    perform set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true);
  end if;
end $$;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual,'NULL');
  end if;
end $$;

-- Attributs + grants de la RPC (lus en postgres = métadonnées, pas RLS).
create or replace function pg_temp.assert_fn_hardened(p_name text, p_typesig text, p_expect_volatile boolean)
returns void language plpgsql as $$
declare v_secdef bool; v_sp bool; v_vol char; v_exec_auth bool; v_exec_anon bool; v_sig text; v_cnt int;
begin
  select count(*) into v_cnt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname=p_name;
  if v_cnt <> 1 then raise exception 'A.%: attendu 1 fonction, trouvé %', p_name, v_cnt; end if;
  select p.prosecdef, (p.proconfig @> array['search_path=public']), p.provolatile
    into v_secdef, v_sp, v_vol
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname=p_name;
  if not v_secdef then raise exception 'A.% pas SECURITY DEFINER', p_name; end if;
  if not v_sp then raise exception 'A.% search_path != public', p_name; end if;
  if p_expect_volatile and v_vol <> 'v' then raise exception 'A.% pas VOLATILE (%)', p_name, v_vol; end if;
  v_sig := format('public.%s(%s)', p_name, p_typesig);
  v_exec_auth := has_function_privilege('authenticated', v_sig, 'EXECUTE');
  v_exec_anon := has_function_privilege('anon',          v_sig, 'EXECUTE');
  if not v_exec_auth then raise exception 'A.% EXECUTE authenticated manquant', p_name; end if;
  if v_exec_anon    then raise exception 'A.% EXECUTE anon PRÉSENT (doit être révoqué)', p_name; end if;
end $$;

-- Assertion sur la ligne d'audit d'une décision (localisée par (resource_id, action) — unique : une
-- demande ne reçoit qu'UNE décision → une seule ligne d'audit).
create or replace function pg_temp.assert_resa_audit(
  p_rid text, p_action text, p_after_status text, p_role text, p_user text, p_venue text, p_event uuid
) returns void language plpgsql as $$
declare r public.audit_log%rowtype; v_cnt int;
begin
  select count(*) into v_cnt from public.audit_log where resource_id=p_rid and action=p_action;
  if v_cnt <> 1 then
    raise exception 'resa.% : attendu 1 audit (%), trouvé %', p_rid, p_action, v_cnt;
  end if;
  select * into r from public.audit_log where resource_id=p_rid and action=p_action;
  if r.actor_role is distinct from p_role then raise exception 'resa.% actor_role ATTENDU %, OBTENU %', p_rid, p_role, coalesce(r.actor_role,'NULL'); end if;
  if r.actor_username is distinct from p_user then raise exception 'resa.% actor_username ATTENDU %, OBTENU %', p_rid, p_user, coalesce(r.actor_username,'NULL'); end if;
  if r.resource_type is distinct from 'table_reservation_requests' then raise exception 'resa.% resource_type != table_reservation_requests', p_rid; end if;
  if (r.before_data->>'status') is distinct from 'pending' then raise exception 'resa.% before.status != pending (%)', p_rid, r.before_data->>'status'; end if;
  if (r.after_data->>'status') is distinct from p_after_status then raise exception 'resa.% after.status ATTENDU %, OBTENU %', p_rid, p_after_status, r.after_data->>'status'; end if;
  if r.venue is distinct from p_venue then raise exception 'resa.% venue ATTENDU %, OBTENU %', p_rid, p_venue, coalesce(r.venue,'NULL'); end if;
  if r.event_id is distinct from p_event then raise exception 'resa.% event_id NON propagé (ATTENDU %, OBTENU %)', p_rid, p_event, coalesce(r.event_id::text,'NULL'); end if;
end $$;

-- Aucune ligne d'audit pour une demande (fail-closed).
create or replace function pg_temp.assert_no_audit(p_rid text) returns void
language plpgsql as $$
declare v_cnt int;
begin
  select count(*) into v_cnt from public.audit_log where resource_id=p_rid;
  if v_cnt <> 0 then raise exception 'no_audit.% : ATTENDU 0 ligne d''audit, trouvé %', p_rid, v_cnt; end if;
end $$;

-- Minimisation : une chaîne PII client ne doit apparaître dans AUCUNE ligne d'audit (row entière en text).
create or replace function pg_temp.assert_pii_absent(p_needle text) returns void
language plpgsql as $$
declare v_cnt int;
begin
  select count(*) into v_cnt from public.audit_log a where a.action like 'reservation.%' and (a::text) like '%'||p_needle||'%';
  if v_cnt <> 0 then raise exception 'minimisation : la chaîne PII "%" FUIT dans % ligne(s) d''audit', p_needle, v_cnt; end if;
end $$;

select username as manager_username from public.staff_users where auth_id = :'manager_sub' \gset

-- ============================================================
-- FIXTURES (postgres superuser, RLS contournée) — 4 clients + 4 demandes `pending` sur 4 tables Eden.
--   Prénoms + notes DISTINCTIFS pour la preuve de minimisation (F).
-- ============================================================
reset role;

insert into public.guests (phone, first_name, majorite_verifiee) values ('+33600000371','PRENOMCLIENT371',true) returning id as g_ap \gset
insert into public.guests (phone, first_name, majorite_verifiee) values ('+33600000372','PRENOMCLIENT372',true) returning id as g_dc \gset
insert into public.guests (phone, first_name, majorite_verifiee) values ('+33600000373','PRENOMCLIENT373',true) returning id as g_sv \gset
insert into public.guests (phone, first_name, majorite_verifiee) values ('+33600000374','PRENOMCLIENT374',true) returning id as g_mg \gset

-- 4 tables Eden distinctes (labels 100/101/102/103) — capture id + label.
select id as t_ap from public.venue_tables where venue='eden' and label='100' \gset
select id as t_dc from public.venue_tables where venue='eden' and label='101' \gset
select id as t_sv from public.venue_tables where venue='eden' and label='102' \gset
select id as t_mg from public.venue_tables where venue='eden' and label='103' \gset

insert into public.table_reservation_requests (venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, guest_note, status)
  values (:'t_ap'::uuid, :'g_ap'::uuid, :'ev'::uuid, :'exdate'::date, 'eden', 4, 'NOTE-CONFIDENTIELLE-371', 'pending') returning id as req_ap \gset
insert into public.table_reservation_requests (venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, guest_note, status)
  values (:'t_dc'::uuid, :'g_dc'::uuid, :'ev'::uuid, :'exdate'::date, 'eden', 2, 'NOTE-CONFIDENTIELLE-372', 'pending') returning id as req_dc \gset
insert into public.table_reservation_requests (venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, guest_note, status)
  values (:'t_sv'::uuid, :'g_sv'::uuid, :'ev'::uuid, :'exdate'::date, 'eden', 3, 'NOTE-CONFIDENTIELLE-373', 'pending') returning id as req_sv \gset
insert into public.table_reservation_requests (venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, guest_note, status)
  values (:'t_mg'::uuid, :'g_mg'::uuid, :'ev'::uuid, :'exdate'::date, 'eden', 6, 'NOTE-CONFIDENTIELLE-374', 'pending') returning id as req_mg \gset

-- ============================================================
-- (B) APPROVE (admin)
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select ok::text as ap_ok, code as ap_code, status as ap_status
  from public.decide_table_reservation_v1(:'req_ap'::uuid, 'approve', null) \gset

-- ============================================================
-- (C) DECLINE (admin, motif staff)
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select ok::text as dc_ok, code as dc_code, status as dc_status
  from public.decide_table_reservation_v1(:'req_dc'::uuid, 'decline', 'Salle complète ce soir') \gset

-- ============================================================
-- (D) FAIL-CLOSED : server tente d'approuver → refusé, aucune mutation, aucun audit.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'server_sub');
select ok::text as sv_ok, code as sv_code
  from public.decide_table_reservation_v1(:'req_sv'::uuid, 'approve', null) \gset

-- ============================================================
-- (E) STAMPING : approbation par un manager.
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'manager_sub');
select ok::text as mg_ok, status as mg_status
  from public.decide_table_reservation_v1(:'req_mg'::uuid, 'approve', null) \gset

reset role;

-- État RÉEL des lignes (lu en postgres = data) — prouve la mutation, pas seulement l'audit.
select status as st_ap from public.table_reservation_requests where id = :'req_ap'::uuid \gset
select status as st_dc, decline_reason as reason_dc from public.table_reservation_requests where id = :'req_dc'::uuid \gset
select status as st_sv from public.table_reservation_requests where id = :'req_sv'::uuid \gset
select status as st_mg from public.table_reservation_requests where id = :'req_mg'::uuid \gset
select count(*)::text as visit_ap from public.guest_visits where guest_id = :'g_ap'::uuid and exploitation_date = :'exdate'::date and univers='eden' and status='booked' \gset

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- (A) durcissement de la RPC (préservé vs 0025)
select pg_temp.assert_fn_hardened('decide_table_reservation_v1', 'uuid, text, text', true);

-- (B) approve : retour + mutation réelle + visite CRM + audit estampillé admin, venue/event propagés
select pg_temp.expect(:'ap_ok','true',       'B.approve renvoie ok=true');
select pg_temp.expect(:'ap_status','approved','B.approve renvoie status=approved');
select pg_temp.expect(:'st_ap','approved',    'B.demande réellement approved');
select pg_temp.expect(:'visit_ap','1',        'B.visite CRM booked créée (1)');
select pg_temp.assert_resa_audit(:'req_ap','reservation.approve','approved','admin','lab-admin-01','eden',:'ev'::uuid);

-- (C) decline : retour + mutation réelle (+ motif) + audit
select pg_temp.expect(:'dc_ok','true',        'C.decline renvoie ok=true');
select pg_temp.expect(:'dc_status','declined','C.decline renvoie status=declined');
select pg_temp.expect(:'st_dc','declined',    'C.demande réellement declined');
select pg_temp.expect(:'reason_dc','Salle complète ce soir','C.motif staff enregistré');
select pg_temp.assert_resa_audit(:'req_dc','reservation.decline','declined','admin','lab-admin-01','eden',:'ev'::uuid);

-- (D) fail-closed server : refus, demande intacte, AUCUN audit
select pg_temp.expect(:'sv_ok','false',       'D.server refusé (ok=false)');
select pg_temp.expect(:'sv_code','unauthorized','D.server code=unauthorized');
select pg_temp.expect(:'st_sv','pending',     'D.demande INTACTE (pending) après refus');
select pg_temp.assert_no_audit(:'req_sv');

-- (E) stamping manager
select pg_temp.expect(:'mg_ok','true',        'E.manager approve ok=true');
select pg_temp.expect(:'st_mg','approved',    'E.demande réellement approved (manager)');
select pg_temp.assert_resa_audit(:'req_mg','reservation.approve','approved','manager',:'manager_username','eden',:'ev'::uuid);

-- (F) minimisation : aucun prénom client ni note libre dans le journal
select pg_temp.assert_pii_absent('PRENOMCLIENT371');
select pg_temp.assert_pii_absent('PRENOMCLIENT372');
select pg_temp.assert_pii_absent('PRENOMCLIENT373');
select pg_temp.assert_pii_absent('PRENOMCLIENT374');
select pg_temp.assert_pii_absent('NOTE-CONFIDENTIELLE-371');
select pg_temp.assert_pii_absent('NOTE-CONFIDENTIELLE-372');

select '0037 reservation_decision_audit (approve/decline tracés · mutation réelle + visite CRM booked · audit reservation.approve|decline estampillé depuis la session · venue+event_id propagés · fail-closed server sans audit · stamping manager · minimisation PII client prouvée) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
