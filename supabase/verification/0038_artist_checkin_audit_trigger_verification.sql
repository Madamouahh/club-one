-- 0038_artist_checkin_audit_trigger_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0038 — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR
-- L'ARTIST CHECK-IN (0027), via TRIGGER (la fiche est écrite en INSERT/UPDATE direct sous RLS, sans RPC
-- où insérer un `perform` — patron 0036 réutilisé).
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) STRUCTURE : la fonction de trigger existe (search_path=public) et le trigger est bien AFTER
--       INSERT|UPDATE, attaché à public.artist_checkins ;
--   (B) OUVERTURE : un INSERT de fiche (admin) crée EXACTEMENT 1 audit `artist.checkin.open`, acteur
--       estampillé depuis la SESSION (admin/lab-admin-01), resource_id = id de la fiche, event_id
--       PROPAGÉ (valeur réelle), after_data fidèle (artist_name/status) ;
--   (C) JALON SIGNIFICATIF : un UPDATE (attendu→arrive + arrived_at posé) crée 1 audit
--       `artist.checkin.update`, before/after fidèles (statut + jalon arrivée), résumé lisible de la
--       transition ;
--   (D) FILTRE DE BRUIT : un UPDATE qui ne touche QU'un champ libre (dressing_room) — aucun statut, aucun
--       jalon — NE crée AUCUN audit `artist.checkin.update` → le journal direction reste lisible ;
--   (E) STAMPING / ACTEUR NON USURPABLE : une OUVERTURE par un `manager` estampille actor_role='manager'
--       (contraste avec 'admin') — aucun paramètre d'acteur n'existe côté trigger ;
--   (F) MINIMISATION : les champs libres pouvant porter des coordonnées de tiers (contact/tour-manager,
--       rider) n'apparaissent NULLE PART dans le journal (résumé/before/after/metadata) ;
--   (G) RLS NON ÉLARGIE : un `server` (⛔ sur artist_checkins) qui tente un INSERT est refusé par la
--       policy (42501) → AUCUNE fiche créée, AUCUN audit — le trigger n'ouvre aucune porte d'écriture ;
--   (H) APPEND-ONLY préservé (hérité de 0033) : un INSERT DIRECT dans audit_log sous `authenticated`
--       reste refusé (42501) — le trigger ne rouvre aucune écriture directe.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- subs des staff_users identiques à 0033/0034/0035/0036/0037 (LABO). Les variables psql (:'var'/\gset)
-- NE SONT PAS interpolées dans les blocs $$…$$ : bascules d'identité, captures et lectures d'audit
-- passent par des helpers pg_temp appelés depuis des SELECT normaux (tradition 0033→0037).

begin;

\set admin_sub   '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_sub '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set server_sub  '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

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

-- INSERT DIRECT dans audit_log (SECURITY INVOKER → éprouve réellement le grant sous l'appelant courant :
-- prouve que 0038 n'ouvre aucune écriture directe).
create or replace function pg_temp.try_direct_audit_insert() returns text
language plpgsql as $$
begin
  insert into public.audit_log(action, actor_username, actor_role, resource_type)
  values ('forge.artist','pirate','admin','artist_checkin');
  return 'NO_ERROR';
exception when others then return sqlstate; end $$;

-- INSERT de fiche artiste sous l'appelant courant (éprouve la policy RLS artist_checkins_insert).
create or replace function pg_temp.try_artist_insert(p_name text) returns text
language plpgsql as $$
begin
  insert into public.artist_checkins(exploitation_date, artist_name, status)
  values ('2099-11-01', p_name, 'attendu');
  return 'NO_ERROR';
exception when others then return sqlstate; end $$;

-- Compte les audits (resource_id, action) — lu en postgres = data, RLS contournée légitimement.
create or replace function pg_temp.audit_count(p_rid text, p_action text) returns int
language sql as $$
  select count(*)::int from public.audit_log where resource_id=p_rid and action=p_action;
$$;

-- Assertion complète sur UNE ligne d'audit artiste : unicité (resource_id, action), acteur estampillé,
-- resource_type, et (optionnellement) event_id + fragment de before/after/summary attendus.
create or replace function pg_temp.assert_artist_audit(
  p_rid text, p_action text, p_role text, p_user text,
  p_event_id text default null,          -- si non NULL, on exige audit.event_id = p_event_id
  p_summary_like text default null,      -- si non NULL, on exige summary LIKE '%…%'
  p_after_json jsonb default null,       -- si non NULL, on exige after_data @> p_after_json
  p_before_json jsonb default null       -- si non NULL, on exige before_data @> p_before_json
) returns void language plpgsql as $$
declare r public.audit_log%rowtype; v_cnt int;
begin
  select count(*) into v_cnt from public.audit_log where resource_id=p_rid and action=p_action;
  if v_cnt <> 1 then
    raise exception '%.% : attendu 1 audit, trouvé %', p_action, p_rid, v_cnt;
  end if;
  select * into r from public.audit_log where resource_id=p_rid and action=p_action;
  if r.actor_role is distinct from p_role then
    raise exception '%.% actor_role ATTENDU %, OBTENU %', p_action, p_rid, p_role, coalesce(r.actor_role,'NULL'); end if;
  if r.actor_username is distinct from p_user then
    raise exception '%.% actor_username ATTENDU %, OBTENU %', p_action, p_rid, p_user, coalesce(r.actor_username,'NULL'); end if;
  if r.resource_type is distinct from 'artist_checkin' then
    raise exception '%.% resource_type != artist_checkin', p_action, p_rid; end if;
  if p_event_id is not null and (r.event_id is distinct from p_event_id::uuid) then
    raise exception '%.% event_id ATTENDU %, OBTENU %', p_action, p_rid, p_event_id, coalesce(r.event_id::text,'NULL'); end if;
  if p_summary_like is not null and (r.summary is null or r.summary not like p_summary_like) then
    raise exception '%.% summary "%" ne matche pas "%"', p_action, p_rid, coalesce(r.summary,'NULL'), p_summary_like; end if;
  if p_after_json is not null and not (coalesce(r.after_data,'{}'::jsonb) @> p_after_json) then
    raise exception '%.% after_data % ne contient pas %', p_action, p_rid, coalesce(r.after_data,'NULL'::jsonb), p_after_json; end if;
  if p_before_json is not null and not (coalesce(r.before_data,'{}'::jsonb) @> p_before_json) then
    raise exception '%.% before_data % ne contient pas %', p_action, p_rid, coalesce(r.before_data,'NULL'::jsonb), p_before_json; end if;
end $$;

-- Minimisation : une chaîne libre (coordonnées de tiers / rider) ne doit apparaître dans AUCUNE ligne
-- d'audit artiste (row entière en text).
create or replace function pg_temp.assert_free_text_absent(p_needle text) returns void
language plpgsql as $$
declare v_cnt int;
begin
  select count(*) into v_cnt from public.audit_log a where a.action like 'artist.checkin.%' and (a::text) like '%'||p_needle||'%';
  if v_cnt <> 0 then raise exception 'minimisation : la chaîne libre "%" FUIT dans % ligne(s) d''audit', p_needle, v_cnt; end if;
end $$;

select username as manager_username from public.staff_users where auth_id = :'manager_sub' \gset

-- ============================================================
-- (A) STRUCTURE du trigger/fonction (lu en postgres = métadonnées).
-- ============================================================
do $$
declare v_sp bool; v_cnt int; v_tgtype int; v_rel text;
begin
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_artist_checkin_change';
  if v_cnt <> 1 then raise exception 'A: attendu 1 fonction de trigger, trouvé %', v_cnt; end if;
  select (p.proconfig @> array['search_path=public']) into v_sp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_artist_checkin_change';
  if not v_sp then raise exception 'A: audit_artist_checkin_change search_path != public'; end if;

  -- trigger : AFTER (bit 2 = BEFORE, doit être 0), INSERT|UPDATE, sur public.artist_checkins
  select t.tgtype, c.relname into v_tgtype, v_rel from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where t.tgname='trg_audit_artist_checkin' and not t.tgisinternal;
  if v_rel is distinct from 'artist_checkins' then raise exception 'A: trg_audit_artist_checkin pas sur artist_checkins (%)', v_rel; end if;
  if (v_tgtype & 2) <> 0 then raise exception 'A: trg_audit_artist_checkin est BEFORE (doit être AFTER)'; end if; -- bit 2 = BEFORE
  if (v_tgtype & 4) = 0 then raise exception 'A: trg_audit_artist_checkin ne couvre pas INSERT'; end if;         -- bit 4 = INSERT
  if (v_tgtype & 16) = 0 then raise exception 'A: trg_audit_artist_checkin ne couvre pas UPDATE'; end if;        -- bit 16 = UPDATE
end $$;

-- ============================================================
-- Fixtures : on ÉCRIT les fiches sous RLS avec l'identité réelle (le trigger fire dans ce contexte).
-- ============================================================
-- event réel du LABO pour prouver la propagation event_id.
select id::text as ev from public.events order by id limit 1 \gset

-- (B/C/F) fiche principale ouverte par admin, sur un event réel, AVEC des champs libres distinctifs
-- (contact tour-manager + rider) pour la preuve de minimisation.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.artist_checkins(event_id, exploitation_date, artist_name, slot_label, status, contact, rider_notes)
values (:'ev'::uuid, '2099-11-01', 'DJ-VERIF-0038-MAIN', '01h-03h', 'attendu',
        'TM-CONTACT-0612340038', 'RIDER-CONFIDENTIEL-0038')
returning id::text as chk_main \gset

-- (C) jalon SIGNIFICATIF : attendu→arrive + arrivée horodatée (direction autorisée à muter).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
update public.artist_checkins set status='arrive', arrived_at=now(), updated_at=now() where id = :'chk_main'::uuid;

-- (D) fiche de BRUIT : ouverte par admin puis UPDATE ne touchant QU'un champ libre (dressing_room).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.artist_checkins(exploitation_date, artist_name, status)
values ('2099-11-01', 'DJ-VERIF-0038-NOISE', 'attendu')
returning id::text as chk_noise \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
update public.artist_checkins set dressing_room='Loge 2', updated_at=now() where id = :'chk_noise'::uuid; -- aucun statut/jalon

-- (E) OUVERTURE par un manager (contraste d'acteur ; la policy artist_checkins_insert autorise manager).
set local role authenticated; select pg_temp.act_as(:'manager_sub');
insert into public.artist_checkins(exploitation_date, artist_name, status)
values ('2099-11-01', 'DJ-VERIF-0038-MGR', 'attendu')
returning id::text as chk_mgr \gset

-- (G) RLS non élargie : un server tente un INSERT → refusé par artist_checkins_insert (⛔ server).
set local role authenticated; select pg_temp.act_as(:'server_sub');
select pg_temp.try_artist_insert('DJ-VERIF-0038-SERVER-BLOCKED') as g_server \gset

-- (H) append-only : INSERT direct dans audit_log sous authenticated (admin) → doit être refusé.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_direct_audit_insert() as h_direct \gset

reset role;

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- (A) déjà asserté ci-dessus (le bloc do $$ lève si non conforme).

-- (B) ouverture admin : 1 audit artist.checkin.open, acteur admin, event_id propagé, after fidèle.
select pg_temp.assert_artist_audit(
  :'chk_main', 'artist.checkin.open', 'admin', 'lab-admin-01',
  :'ev', 'Fiche artiste — DJ-VERIF-0038-MAIN (attendu)%',
  jsonb_build_object('artist_name','DJ-VERIF-0038-MAIN','status','attendu')
);

-- (C) jalon significatif : 1 audit artist.checkin.update, before/after fidèles, résumé de transition.
select pg_temp.assert_artist_audit(
  :'chk_main', 'artist.checkin.update', 'admin', 'lab-admin-01',
  null, 'DJ-VERIF-0038-MAIN — statut attendu → arrive%arrivé%',
  jsonb_build_object('status','arrive'),
  jsonb_build_object('status','attendu')
);

-- (D) filtre de bruit : la fiche bruit a bien 1 open et 0 update (retouche champ libre non journalisée).
select pg_temp.expect(pg_temp.audit_count(:'chk_noise','artist.checkin.open')::text,   '1', 'D.bruit : ouverture journalisée');
select pg_temp.expect(pg_temp.audit_count(:'chk_noise','artist.checkin.update')::text, '0', 'D.bruit : retouche champ libre NON journalisée');

-- (E) stamping : l'ouverture par manager est estampillée 'manager' (contraste avec admin).
select pg_temp.assert_artist_audit(:'chk_mgr', 'artist.checkin.open', 'manager', :'manager_username');

-- (F) minimisation : ni le contact tour-manager ni le rider n'apparaissent dans le journal.
select pg_temp.assert_free_text_absent('TM-CONTACT-0612340038');
select pg_temp.assert_free_text_absent('RIDER-CONFIDENTIEL-0038');

-- (G) RLS non élargie : le server est refusé (42501), aucune fiche ni audit créés pour lui.
select pg_temp.expect(:'g_server', '42501', 'G.server refusé par RLS (aucune écriture directe ouverte)');
select pg_temp.expect(
  (select count(*)::text from public.audit_log where action like 'artist.checkin.%'
     and after_data->>'artist_name' = 'DJ-VERIF-0038-SERVER-BLOCKED'),
  '0', 'G.aucun audit pour la tentative server refusée');

-- (H) append-only préservé : insert direct sous authenticated refusé (42501).
select pg_temp.expect(:'h_direct', '42501', 'H.append-only : insert direct audit_log refusé');

select '0038 artist_checkin_audit_trigger (câblage log_audit_event via TRIGGER sur artist_checkins · artist.checkin.open/update · acteur estampillé depuis la session · event_id propagé · before/after fidèles · filtre de bruit champ libre · minimisation contact/rider · contraste admin↔manager · RLS non élargie server · append-only préservé) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
