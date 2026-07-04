-- 0036_incidents_audit_trigger_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0036 — CÂBLAGE DU JOURNAL D'AUDIT (0033)
-- SUR LE MODULE INCIDENTS (0023), via TRIGGER (les incidents sont écrits en INSERT/UPDATE direct
-- sous RLS, sans RPC où insérer un `perform` — cf. en-tête de 0036).
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) STRUCTURE : les 2 fonctions de trigger existent (search_path=public) et les 2 triggers sont
--       bien AFTER, attachés à incidents / incident_updates, aux bons événements ;
--   (B) OUVERTURE : un INSERT d'incident (admin) crée EXACTEMENT 1 audit `incident.open`, acteur
--       estampillé depuis la SESSION (admin/lab-admin-01), resource_id = id de l'incident,
--       event_id PROPAGÉ (valeur réelle), after_data fidèle (type/niveau/status) ;
--   (C) MISE À JOUR SIGNIFICATIVE : un UPDATE (ouvert→escalade + escalade true) crée 1 audit
--       `incident.update`, before/after fidèles (statut + escalade), résumé lisible de la transition ;
--   (D) FILTRE DE BRUIT : un UPDATE qui ne change QUE `updated_at` (aucune colonne significative)
--       NE crée AUCUN audit `incident.update` → le journal direction reste lisible ;
--   (E) FIL DE SUIVI : un INSERT dans incident_updates crée 1 audit `incident.followup`
--       (action + new_status ; note NON recopiée, seule sa présence est signalée) ;
--   (F) ACTEUR NON USURPABLE / stamping : une OUVERTURE par un `server` estampille
--       actor_role='server' (contraste avec 'admin') — aucun paramètre d'acteur n'existe côté trigger ;
--   (G) APPEND-ONLY préservé (hérité de 0033) : un INSERT DIRECT dans audit_log sous `authenticated`
--       reste refusé (42501) — le trigger ne rouvre aucune porte d'écriture directe.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- subs des staff_users identiques à 0033/0034/0035 (LABO). Les variables psql (:'var'/\gset) NE SONT
-- PAS interpolées dans les blocs $$…$$ : bascules d'identité, captures d'erreur et lectures d'audit
-- passent par des helpers pg_temp appelés depuis des SELECT normaux (tradition 0033/0034/0035).

begin;

\set admin_sub   '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set server_sub  '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

-- Bascule d'identité (sub présent → auth.uid()=sub ; sub null → session authentifiée « anonyme »).
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

-- Wrapper d'erreur pour un INSERT DIRECT dans audit_log (SECURITY INVOKER → éprouve réellement le
-- grant sous l'appelant courant : prouve que 0036 n'ouvre aucune écriture directe).
create or replace function pg_temp.try_direct_audit_insert() returns text
language plpgsql as $$
begin
  insert into public.audit_log(action, actor_username, actor_role, resource_type)
  values ('forge.incident','pirate','admin','incident');
  return 'NO_ERROR';
exception when others then return sqlstate; end $$;

-- Compte les audits (resource_id, action) — lu en postgres = data, RLS contournée légitimement.
create or replace function pg_temp.audit_count(p_rid text, p_action text) returns int
language sql as $$
  select count(*)::int from public.audit_log where resource_id=p_rid and action=p_action;
$$;

-- Assertion complète sur UNE ligne d'audit incident : unicité (resource_id, action), acteur estampillé,
-- resource_type, et (optionnellement) event_id + fragment de before/after/summary attendus.
create or replace function pg_temp.assert_incident_audit(
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
  if r.resource_type is distinct from 'incident' then
    raise exception '%.% resource_type != incident', p_action, p_rid; end if;
  if p_event_id is not null and (r.event_id is distinct from p_event_id::uuid) then
    raise exception '%.% event_id ATTENDU %, OBTENU %', p_action, p_rid, p_event_id, coalesce(r.event_id::text,'NULL'); end if;
  if p_summary_like is not null and (r.summary is null or r.summary not like p_summary_like) then
    raise exception '%.% summary "%" ne matche pas "%"', p_action, p_rid, coalesce(r.summary,'NULL'), p_summary_like; end if;
  if p_after_json is not null and not (coalesce(r.after_data,'{}'::jsonb) @> p_after_json) then
    raise exception '%.% after_data % ne contient pas %', p_action, p_rid, coalesce(r.after_data,'NULL'::jsonb), p_after_json; end if;
  if p_before_json is not null and not (coalesce(r.before_data,'{}'::jsonb) @> p_before_json) then
    raise exception '%.% before_data % ne contient pas %', p_action, p_rid, coalesce(r.before_data,'NULL'::jsonb), p_before_json; end if;
end $$;

-- ============================================================
-- (A) STRUCTURE des triggers/fonctions (lu en postgres = métadonnées).
-- ============================================================
do $$
declare v_sp bool; v_cnt int; v_tgtype int; v_rel text;
begin
  -- fonctions présentes + search_path=public
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('audit_incident_change','audit_incident_update_row');
  if v_cnt <> 2 then raise exception 'A: attendu 2 fonctions de trigger, trouvé %', v_cnt; end if;
  select (p.proconfig @> array['search_path=public']) into v_sp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_incident_change';
  if not v_sp then raise exception 'A: audit_incident_change search_path != public'; end if;
  select (p.proconfig @> array['search_path=public']) into v_sp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_incident_update_row';
  if not v_sp then raise exception 'A: audit_incident_update_row search_path != public'; end if;

  -- trigger incidents : AFTER (tgtype bit 1 = BEFORE ; doit être 0), INSERT|UPDATE, sur public.incidents
  select t.tgtype, c.relname into v_tgtype, v_rel from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where t.tgname='trg_audit_incident' and not t.tgisinternal;
  if v_rel is distinct from 'incidents' then raise exception 'A: trg_audit_incident pas sur incidents (%)', v_rel; end if;
  if (v_tgtype & 2) <> 0 then raise exception 'A: trg_audit_incident est BEFORE (doit être AFTER)'; end if; -- bit 2 = BEFORE
  if (v_tgtype & 4) = 0 then raise exception 'A: trg_audit_incident ne couvre pas INSERT'; end if;         -- bit 4 = INSERT
  if (v_tgtype & 16) = 0 then raise exception 'A: trg_audit_incident ne couvre pas UPDATE'; end if;        -- bit 16 = UPDATE

  -- trigger incident_updates : AFTER INSERT sur public.incident_updates
  select t.tgtype, c.relname into v_tgtype, v_rel from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where t.tgname='trg_audit_incident_update' and not t.tgisinternal;
  if v_rel is distinct from 'incident_updates' then raise exception 'A: trg_audit_incident_update pas sur incident_updates (%)', v_rel; end if;
  if (v_tgtype & 2) <> 0 then raise exception 'A: trg_audit_incident_update est BEFORE (doit être AFTER)'; end if;
  if (v_tgtype & 4) = 0 then raise exception 'A: trg_audit_incident_update ne couvre pas INSERT'; end if;
end $$;

-- ============================================================
-- Fixtures : on ÉCRIT les incidents sous RLS avec l'identité réelle (le trigger fire dans ce contexte).
-- ============================================================
-- event réel du LABO pour prouver la propagation event_id.
select id::text as ev from public.events order by id limit 1 \gset

-- (B/C/E) incident principal ouvert par admin, sur un event réel.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.incidents(event_id, exploitation_date, type, niveau, lieu, description, status, escalade)
values (:'ev'::uuid, current_date, 'altercation', 'moyen', 'entrée', 'VERIF-0036 test altercation', 'ouvert', false)
returning id::text as inc_main \gset

-- (C) mutation SIGNIFICATIVE : ouvert→escalade + escalade true (admin autorisé à muter).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
update public.incidents set status='escalade', escalade=true, updated_at=now() where id = :'inc_main'::uuid;

-- (E) fil de suivi : une entrée avec action + transition de statut + note.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.incident_updates(incident_id, action, new_status, note)
values (:'inc_main'::uuid, 'Vigile dépêché', 'escalade', 'note interne confidentielle');

-- (D) incident de BRUIT : ouvert par admin puis UPDATE ne touchant QUE updated_at.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.incidents(exploitation_date, type, niveau, description, status, escalade)
values (current_date, 'technique', 'mineur', 'VERIF-0036 bruit', 'ouvert', false)
returning id::text as inc_noise \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
update public.incidents set updated_at=now() where id = :'inc_noise'::uuid;  -- aucune colonne significative

-- (F) OUVERTURE par un server (contraste d'acteur ; la policy incidents_insert autorise server).
set local role authenticated; select pg_temp.act_as(:'server_sub');
insert into public.incidents(exploitation_date, type, niveau, description, status, escalade)
values (current_date, 'refus_entree', 'mineur', 'VERIF-0036 signalement server', 'ouvert', false)
returning id::text as inc_srv \gset

-- (G) append-only : INSERT direct dans audit_log sous authenticated (admin) → doit être refusé.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_direct_audit_insert() as g_direct \gset

reset role;

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- (A) déjà asserté ci-dessus (les blocs do $$ lèvent si non conforme).

-- (B) ouverture admin : 1 audit incident.open, acteur admin, event_id propagé, after fidèle.
select pg_temp.assert_incident_audit(
  :'inc_main', 'incident.open', 'admin', 'lab-admin-01',
  :'ev', 'Incident ouvert%',
  jsonb_build_object('type','altercation','niveau','moyen','status','ouvert','escalade',false)
);

-- (C) mise à jour significative : 1 audit incident.update, before/after fidèles, résumé de transition.
select pg_temp.assert_incident_audit(
  :'inc_main', 'incident.update', 'admin', 'lab-admin-01',
  null, 'Statut ouvert → escalade%ESCALADE direction%',
  jsonb_build_object('status','escalade','escalade',true),
  jsonb_build_object('status','ouvert','escalade',false)
);

-- (E) fil de suivi : 1 audit incident.followup (action + new_status ; note non recopiée).
select pg_temp.assert_incident_audit(
  :'inc_main', 'incident.followup', 'admin', 'lab-admin-01',
  null, 'Vigile dépêché (→ escalade)%',
  jsonb_build_object('action','Vigile dépêché','new_status','escalade','note_present',true)
);
-- Preuve de MINIMISATION : la note libre n'est PAS recopiée dans le journal global.
select pg_temp.expect(
  (select case when after_data::text like '%confidentielle%' then 'LEAK' else 'OK' end
     from public.audit_log where resource_id=:'inc_main' and action='incident.followup'),
  'OK', 'E.note libre absente du journal global (minimisation)'
);

-- (D) filtre de bruit : l'incident bruit a bien 1 open et 0 update.
select pg_temp.expect(pg_temp.audit_count(:'inc_noise','incident.open')::text,   '1', 'D.bruit : ouverture journalisée');
select pg_temp.expect(pg_temp.audit_count(:'inc_noise','incident.update')::text, '0', 'D.bruit : bump updated_at NON journalisé');

-- (F) stamping : l'ouverture par server est estampillée 'server' (contraste avec admin).
select pg_temp.assert_incident_audit(:'inc_srv', 'incident.open', 'server', 'server');

-- (G) append-only préservé : insert direct sous authenticated refusé (42501).
select pg_temp.expect(:'g_direct', '42501', 'G.append-only : insert direct audit_log refusé');

select '0036 incidents_audit_trigger (câblage log_audit_event via TRIGGER sur incidents/incident_updates · incident.open/update/followup · acteur estampillé depuis la session · event_id propagé · before/after fidèles · filtre de bruit updated_at · minimisation note libre · contraste server↔admin · append-only préservé) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
