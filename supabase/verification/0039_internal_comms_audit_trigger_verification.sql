-- 0039_internal_comms_audit_trigger_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0039 — CÂBLAGE DU JOURNAL D'AUDIT (0033)
-- SUR LA COMMUNICATION INTERNE (0026), via TRIGGER (internal_messages est écrit en INSERT/UPDATE
-- direct sous RLS, sans RPC où insérer un `perform` — patron 0036/0038).
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) STRUCTURE : la fonction de trigger existe (search_path=public) et le trigger est bien AFTER,
--       attaché à internal_messages, aux événements INSERT|UPDATE ;
--   (B) URGENCE : un INSERT `urgence` (admin, diffusion générale) crée EXACTEMENT 1 audit
--       `comm.urgence`, acteur estampillé depuis la SESSION (admin/lab-admin-01), resource_id = id du
--       message, event_id PROPAGÉ (valeur réelle), after_data fidèle (kind/resolved), résumé lisible ;
--   (B2) STAMPING : une `urgence` postée par un `server` (bouton urgence au sol) estampille
--       actor_role='server' (contraste avec 'admin') — aucun paramètre d'acteur côté trigger ;
--   (C) ALERTE CIBLÉE : un INSERT `alerte` ciblé `server` crée 1 audit `comm.alerte`, after_data
--       porte target_role, résumé « … · ciblé server » ;
--   (D) ANNONCE : un INSERT `annonce` par un `manager` (RLS annonce = direction seule) crée 1 audit
--       `comm.annonce`, actor_role='manager' ;
--   (E) FILTRE DE BRUIT (INSERT) : un `message` et une `tache` de coordination routinière ne créent
--       AUCUN audit → le journal direction reste une timeline d'événements accountables ;
--   (F) RÉSOLUTION : un UPDATE d'une `urgence` (resolved_at NULL → renseigné) crée 1 audit
--       `comm.resolve`, before/after fidèles (resolved false→true), event_id propagé ;
--   (G) FILTRE DE BRUIT (UPDATE) : éditer le corps d'une alerte SANS la résoudre ne crée AUCUN
--       `comm.resolve` ; résoudre un `message` (kind non audité) ne crée AUCUN `comm.resolve` ;
--   (H) MINIMISATION : le corps du message (`body`, champ libre) n'est PAS recopié dans le journal
--       global (token de test ABSENT de after_data) ;
--   (I) APPEND-ONLY préservé (hérité de 0033) : un INSERT DIRECT dans audit_log sous `authenticated`
--       reste refusé (42501) — le trigger ne rouvre aucune porte d'écriture directe.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- subs des staff_users identiques à 0033/0034/0035/0036/0037/0038 (LABO). Les variables psql
-- (:'var'/\gset) NE SONT PAS interpolées dans les blocs $$…$$ : bascules d'identité, captures d'erreur
-- et lectures d'audit passent par des helpers pg_temp appelés depuis des SELECT normaux.

begin;

\set admin_sub    '62143b51-2f76-4eb3-bda4-ab3655e983ba'
\set manager_sub  '4a8e3c3c-38df-414a-a3c7-53cfc733fb25'
\set server_sub   '36e6aeb1-70d2-4e13-ab8d-c6f1b1bf221a'

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

-- INSERT DIRECT dans audit_log (SECURITY INVOKER → éprouve le grant sous l'appelant courant).
create or replace function pg_temp.try_direct_audit_insert() returns text
language plpgsql as $$
begin
  insert into public.audit_log(action, actor_username, actor_role, resource_type)
  values ('forge.comm','pirate','admin','internal_message');
  return 'NO_ERROR';
exception when others then return sqlstate; end $$;

-- Compte les audits (resource_id, action) — lu en postgres = data, RLS contournée légitimement.
create or replace function pg_temp.audit_count(p_rid text, p_action text) returns int
language sql as $$
  select count(*)::int from public.audit_log where resource_id=p_rid and action=p_action;
$$;

-- Compte TOUS les audits pour une ressource (toutes actions confondues) — pour prouver le filtre.
create or replace function pg_temp.audit_count_any(p_rid text) returns int
language sql as $$
  select count(*)::int from public.audit_log where resource_id=p_rid;
$$;

-- Assertion complète sur UNE ligne d'audit comm : unicité (resource_id, action), acteur estampillé,
-- resource_type='internal_message', et (optionnellement) event_id + fragments before/after/summary.
create or replace function pg_temp.assert_comm_audit(
  p_rid text, p_action text, p_role text, p_user text,
  p_event_id text default null,
  p_summary_like text default null,
  p_after_json jsonb default null,
  p_before_json jsonb default null
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
  if r.resource_type is distinct from 'internal_message' then
    raise exception '%.% resource_type != internal_message', p_action, p_rid; end if;
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
-- (A) STRUCTURE du trigger/fonction (lu en postgres = métadonnées).
-- ============================================================
do $$
declare v_sp bool; v_cnt int; v_tgtype int; v_rel text;
begin
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_internal_message_change';
  if v_cnt <> 1 then raise exception 'A: attendu 1 fonction de trigger, trouvé %', v_cnt; end if;
  select (p.proconfig @> array['search_path=public']) into v_sp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_internal_message_change';
  if not v_sp then raise exception 'A: audit_internal_message_change search_path != public'; end if;

  select t.tgtype, c.relname into v_tgtype, v_rel from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where t.tgname='trg_audit_internal_message' and not t.tgisinternal;
  if v_rel is distinct from 'internal_messages' then raise exception 'A: trg pas sur internal_messages (%)', v_rel; end if;
  if (v_tgtype & 2) <> 0 then raise exception 'A: trg est BEFORE (doit être AFTER)'; end if;  -- bit 2 = BEFORE
  if (v_tgtype & 4) = 0 then raise exception 'A: trg ne couvre pas INSERT'; end if;           -- bit 4 = INSERT
  if (v_tgtype & 16) = 0 then raise exception 'A: trg ne couvre pas UPDATE'; end if;          -- bit 16 = UPDATE
end $$;

-- ============================================================
-- Fixtures : on ÉCRIT les messages sous RLS avec l'identité réelle (le trigger fire dans ce contexte).
-- ============================================================
-- event réel du LABO pour prouver la propagation event_id.
select id::text as ev from public.events order by id limit 1 \gset

-- (B/F/H) URGENCE ouverte par admin, diffusion générale, event réel, corps distinctif (minimisation).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.internal_messages(event_id, exploitation_date, kind, body)
values (:'ev'::uuid, current_date, 'urgence', 'URG-BODY-SECRET-0039 bagarre entrée coordonnées 0612')
returning id::text as m_urg \gset

-- (B2) URGENCE postée par un server (stamping server ; la policy insert autorise server sur 'urgence').
set local role authenticated; select pg_temp.act_as(:'server_sub');
insert into public.internal_messages(exploitation_date, kind, body)
values (current_date, 'urgence', 'VERIF-0039 urgence server')
returning id::text as m_srv_urg \gset

-- (C) ALERTE ciblée sur le rôle server, par admin.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.internal_messages(exploitation_date, kind, body, target_role)
values (current_date, 'alerte', 'VERIF-0039 alerte capacité', 'server')
returning id::text as m_alerte \gset

-- (D) ANNONCE par manager (RLS : annonce réservée admin/manager).
set local role authenticated; select pg_temp.act_as(:'manager_sub');
insert into public.internal_messages(exploitation_date, kind, body)
values (current_date, 'annonce', 'VERIF-0039 annonce briefing')
returning id::text as m_annonce \gset

-- (E) BRUIT : un message + une tâche → doivent être FILTRÉS (aucun audit).
set local role authenticated; select pg_temp.act_as(:'server_sub');
insert into public.internal_messages(exploitation_date, kind, body)
values (current_date, 'message', 'VERIF-0039 coordination routine')
returning id::text as m_msg \gset
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.internal_messages(exploitation_date, kind, body, assignee_username)
values (current_date, 'tache', 'VERIF-0039 tâche routine', 'server')
returning id::text as m_tache \gset

-- (F) RÉSOLUTION de l'urgence admin : resolved_at NULL → renseigné (admin autorisé à muter).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
update public.internal_messages set resolved_at=now(), updated_at=now() where id = :'m_urg'::uuid;

-- (G) BRUIT UPDATE : éditer le corps de l'alerte SANS la résoudre (aucun comm.resolve).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
update public.internal_messages set body='VERIF-0039 alerte capacité (édité)', updated_at=now()
  where id = :'m_alerte'::uuid;
-- (G) résoudre un 'message' (kind NON audité) → aucun comm.resolve non plus. server = auteur.
set local role authenticated; select pg_temp.act_as(:'server_sub');
update public.internal_messages set resolved_at=now(), updated_at=now() where id = :'m_msg'::uuid;

-- (I) append-only : INSERT direct dans audit_log sous authenticated (admin) → doit être refusé.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_direct_audit_insert() as i_direct \gset

reset role;

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- (B) urgence admin : 1 audit comm.urgence, acteur admin, event_id propagé, after fidèle, résumé.
select pg_temp.assert_comm_audit(
  :'m_urg', 'comm.urgence', 'admin', 'lab-admin-01',
  :'ev', 'Urgence interne%diffusion générale%',
  jsonb_build_object('kind','urgence','resolved',false)
);

-- (B2) stamping : urgence server estampillée 'server' (contraste avec admin).
select pg_temp.assert_comm_audit(:'m_srv_urg', 'comm.urgence', 'server', 'server');

-- (C) alerte ciblée : 1 audit comm.alerte, after porte target_role, résumé « ciblé server ».
select pg_temp.assert_comm_audit(
  :'m_alerte', 'comm.alerte', 'admin', 'lab-admin-01',
  null, 'Alerte opérationnelle%ciblé server%',
  jsonb_build_object('kind','alerte','target_role','server')
);

-- (D) annonce manager : 1 audit comm.annonce, actor_role manager.
select pg_temp.assert_comm_audit(
  :'m_annonce', 'comm.annonce', 'manager', 'lab-manager-01',
  null, 'Annonce direction%'
);

-- (E) filtre de bruit (INSERT) : message + tâche = AUCUN audit.
select pg_temp.expect(pg_temp.audit_count_any(:'m_msg')::text,   '0', 'E.bruit : message routine NON journalisé');
select pg_temp.expect(pg_temp.audit_count_any(:'m_tache')::text, '0', 'E.bruit : tâche routine NON journalisée');

-- (F) résolution : 1 audit comm.resolve, before/after resolved false→true, event_id propagé.
select pg_temp.assert_comm_audit(
  :'m_urg', 'comm.resolve', 'admin', 'lab-admin-01',
  :'ev', '%résolue%diffusion générale%',
  jsonb_build_object('resolved',true),
  jsonb_build_object('resolved',false)
);

-- (G) filtre de bruit (UPDATE) : édition de corps d'alerte = 0 resolve ; message résolu = 0 resolve.
select pg_temp.expect(pg_temp.audit_count(:'m_alerte','comm.resolve')::text, '0', 'G.bruit : édition corps alerte NON journalisée comme résolution');
select pg_temp.expect(pg_temp.audit_count(:'m_msg','comm.resolve')::text,    '0', 'G.bruit : résolution d''un message (kind non audité) NON journalisée');

-- (H) minimisation : le corps (body) n'est PAS recopié dans le journal global.
select pg_temp.expect(
  (select case when after_data::text like '%URG-BODY-SECRET%' then 'LEAK' else 'OK' end
     from public.audit_log where resource_id=:'m_urg' and action='comm.urgence'),
  'OK', 'H.corps du message absent du journal global (minimisation)'
);

-- (I) append-only préservé : insert direct sous authenticated refusé (42501).
select pg_temp.expect(:'i_direct', '42501', 'I.append-only : insert direct audit_log refusé');

select '0039 internal_comms_audit_trigger (câblage log_audit_event via TRIGGER sur internal_messages · comm.urgence/alerte/annonce à l''ouverture + comm.resolve à la résolution · filtre de bruit message/tache/édition · acteur estampillé depuis la session · event_id propagé · before/after fidèles · minimisation du corps · contraste server↔manager↔admin · append-only préservé) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
