-- 0041_rh_shift_audit_trigger_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0041 — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR LE
-- CYCLE DE VIE DU CRÉNEAU RH (staff_shifts, 0011/0020), via UN TRIGGER unique captant les DEUX chemins
-- d'écriture (UPSERT direction sous RLS + `update` interne de la RPC SECDEF confirm_my_shift_v1).
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) STRUCTURE : la fonction de trigger existe (search_path=public) et le trigger est bien AFTER,
--       attaché à staff_shifts, aux événements INSERT|UPDATE ;
--   (B) FILTRE DE COMPOSITION : un brouillon 'planifie' (INSERT direction) ne crée AUCUN audit ;
--   (C) CONFIRMATION SALARIÉ via la RPC : le salarié 'server' appelle confirm_my_shift_v1 (planifie →
--       confirme) → EXACTEMENT 1 audit `rh.shift.confirm`, acteur estampillé = LE SALARIÉ (server/server,
--       PAS la direction — preuve que l'audit du chemin RPC attribue au vrai session-user), event_id
--       PROPAGÉ, before.status='planifie', after.status='confirme', résumé lisible avec le full_name ;
--   (D) POINTAGE RÉEL direction : l'admin marque 'present' → 1 audit `rh.shift.pointage`, acteur admin,
--       before.status='confirme', after porte status+poste, résumé « pointage … → present » ;
--   (E) FILTRE DE BRUIT UPDATE : re-sauvegarde à statut INCHANGÉ (retouche poste/commentaire, status
--       reste 'present') → AUCUN audit supplémentaire (le créneau A totalise EXACTEMENT 2 audits :
--       confirm + pointage) ;
--   (F) ANNULATION direction (par un manager, contraste de stamping) : status → 'annule' → 1 audit
--       `rh.shift.cancel`, acteur manager, before.status='planifie', résumé « créneau … annulé » ;
--   (G) MINIMISATION (droit du travail / paie) : ni la donnée de rémunération (staff_members.taux_horaire,
--       notes_direction) ni le champ libre (staff_shifts.commentaire) ne fuit dans le journal — les tokens
--       de test sont ABSENTS de summary/before/after. Seul full_name (identité du sujet, déjà visible de
--       la direction) est présent, à des fins de lisibilité (prouvé positivement en C/D) ;
--   (H) APPEND-ONLY préservé (hérité de 0033) : un INSERT DIRECT dans audit_log sous `authenticated`
--       reste refusé (42501) — le trigger ne rouvre aucune porte d'écriture directe.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- subs des staff_users identiques à 0033..0040 (LABO). Les variables psql (:'var'/\gset) NE SONT PAS
-- interpolées dans les blocs $$…$$ : bascules d'identité et lectures d'audit passent par des helpers
-- pg_temp appelés depuis des SELECT normaux.

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
  values ('forge.rh','pirate','admin','staff_shift');
  return 'NO_ERROR';
exception when others then return sqlstate; end $$;

create or replace function pg_temp.audit_count(p_rid text, p_action text) returns int
language sql as $$
  select count(*)::int from public.audit_log where resource_id=p_rid and action=p_action;
$$;

create or replace function pg_temp.audit_count_any(p_rid text) returns int
language sql as $$
  select count(*)::int from public.audit_log where resource_id=p_rid;
$$;

-- Fuite d'un token dans TOUT le journal d'une ressource (summary + before + after) → 'LEAK' sinon 'OK'.
create or replace function pg_temp.audit_leak(p_rid text, p_token text) returns text
language sql as $$
  select case when exists(
    select 1 from public.audit_log
     where resource_id=p_rid
       and (coalesce(summary,'')||coalesce(after_data::text,'')||coalesce(before_data::text,''))
           like '%'||p_token||'%'
  ) then 'LEAK' else 'OK' end;
$$;

-- Assertion complète sur UNE ligne d'audit (patron 0040) : unicité (resource_id, action), acteur
-- estampillé, resource_type, et (optionnellement) event_id + fragments summary/after/before.
create or replace function pg_temp.assert_audit(
  p_rid text, p_action text, p_rtype text, p_role text, p_user text,
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
  if r.resource_type is distinct from p_rtype then
    raise exception '%.% resource_type ATTENDU %, OBTENU %', p_action, p_rid, p_rtype, coalesce(r.resource_type,'NULL'); end if;
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
    where n.nspname='public' and p.proname='audit_staff_shift_change';
  if v_cnt <> 1 then raise exception 'A: attendu 1 fonction audit_staff_shift_change, trouvé %', v_cnt; end if;
  select (p.proconfig @> array['search_path=public']) into v_sp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_staff_shift_change';
  if not v_sp then raise exception 'A: audit_staff_shift_change search_path != public'; end if;
  select t.tgtype, c.relname into v_tgtype, v_rel from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where t.tgname='trg_audit_staff_shift' and not t.tgisinternal;
  if v_rel is distinct from 'staff_shifts' then raise exception 'A: trg pas sur staff_shifts (%)', v_rel; end if;
  if (v_tgtype & 2) <> 0 then raise exception 'A: trg est BEFORE (doit être AFTER)'; end if;   -- bit 2 = BEFORE
  if (v_tgtype & 4) = 0 then raise exception 'A: trg ne couvre pas INSERT'; end if;            -- bit 4 = INSERT
  if (v_tgtype & 16) = 0 then raise exception 'A: trg ne couvre pas UPDATE'; end if;           -- bit 16 = UPDATE
end $$;

-- ============================================================
-- Fixtures : répertoire du personnel composé par la DIRECTION (RLS staff_members_insert = admin/manager),
-- puis planning/pointage sous les identités réelles (le trigger fire dans ce contexte).
--   · member A rattaché au compte 'server' → nécessaire pour que confirm_my_shift_v1 (rattachement par
--     username = current_staff_username()) trouve la fiche du salarié.
--   · taux_horaire/notes_direction (member A) + commentaire (shift A) portent des TOKENS pour éprouver la
--     minimisation.
-- ============================================================
select id::text as ev from public.events order by id limit 1 \gset

set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.staff_members(username, full_name, poste, contrat_type, taux_horaire, notes_direction)
values ('server','Salarié Test A','bar','extra', 77.77, 'NOTE-DIR-SECRET-0041')
returning id::text as mem_a \gset
insert into public.staff_members(username, full_name, poste)
values ('lab-security-01','Salarié Test B','accueil')
returning id::text as mem_b \gset
insert into public.staff_members(username, full_name, poste)
values ('lab-counter-01','Salarié Test C','flux')
returning id::text as mem_c \gset

-- (B) COMPOSITION : brouillons 'planifie' (INSERT direction). Le créneau C reste un brouillon jamais
-- traité → doit rester à 0 audit (preuve directe du filtre INSERT-planifie).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
insert into public.staff_shifts(staff_member_id, event_id, exploitation_date, poste, planned_start, planned_end, status, commentaire)
values (:'mem_a'::uuid, :'ev'::uuid, current_date, 'bar', now(), now()+interval '6h', 'planifie', 'CMT-SECRET-0041 brouillon')
returning id::text as sh_a \gset
insert into public.staff_shifts(staff_member_id, event_id, exploitation_date, status)
values (:'mem_b'::uuid, :'ev'::uuid, current_date, 'planifie')
returning id::text as sh_b \gset
insert into public.staff_shifts(staff_member_id, event_id, exploitation_date, status)
values (:'mem_c'::uuid, :'ev'::uuid, current_date, 'planifie')
returning id::text as sh_c \gset

-- (C) CONFIRMATION SALARIÉ : le compte 'server' confirme SON créneau via la RPC (planifie → confirme).
-- La RPC fait un `update staff_shifts` DIRECT → le trigger fire, et l'acteur estampillé est LE SALARIÉ.
set local role authenticated; select pg_temp.act_as(:'server_sub');
select code as confirm_code from public.confirm_my_shift_v1(:'sh_a'::uuid) \gset

-- (D) POINTAGE RÉEL : l'admin marque le créneau A 'present' (confirme → present).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
update public.staff_shifts set status='present', actual_start=now() where id = :'sh_a'::uuid;

-- (E) BRUIT UPDATE : re-sauvegarde à statut INCHANGÉ (retouche poste + commentaire, status reste present).
update public.staff_shifts set poste='vestiaire', commentaire='CMT-SECRET-0041 relu' where id = :'sh_a'::uuid;

-- (F) ANNULATION : un MANAGER annule le créneau B (planifie → annule) — contraste de stamping.
set local role authenticated; select pg_temp.act_as(:'manager_sub');
update public.staff_shifts set status='annule' where id = :'sh_b'::uuid;

-- (H) append-only : INSERT direct dans audit_log sous authenticated (admin) → doit être refusé.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_direct_audit_insert() as i_direct \gset

reset role;

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- La RPC de confirmation a bien abouti.
select pg_temp.expect(:'confirm_code', 'ok', 'C.confirm_my_shift_v1 a confirmé (code ok)');

-- (B) filtre de composition : le créneau C (resté 'planifie') n'a AUCUN audit.
select pg_temp.expect(pg_temp.audit_count_any(:'sh_c')::text, '0',
  'B.composition : brouillon planifie NON journalisé');

-- (C) confirmation salarié : 1 audit rh.shift.confirm, acteur LE SALARIÉ (server/server), event_id
-- propagé, before.status=planifie, after.status=confirme, résumé avec full_name.
select pg_temp.assert_audit(
  :'sh_a', 'rh.shift.confirm', 'staff_shift', 'server', 'server',
  :'ev', 'RH · Salarié Test A — présence confirmée%',
  jsonb_build_object('status','confirme','staff_member_id',:'mem_a'),
  jsonb_build_object('status','planifie')
);

-- (D) pointage réel direction : 1 audit rh.shift.pointage, acteur admin, before.status=confirme,
-- after porte status=present + poste, résumé « pointage … → present ».
select pg_temp.assert_audit(
  :'sh_a', 'rh.shift.pointage', 'staff_shift', 'admin', 'lab-admin-01',
  :'ev', 'RH · Salarié Test A — pointage%→ present',
  jsonb_build_object('status','present'),
  jsonb_build_object('status','confirme')
);

-- (E) filtre de bruit UPDATE : la re-sauvegarde à statut inchangé n'a rien ajouté → le créneau A
-- totalise EXACTEMENT 2 audits (confirm + pointage), et 1 seul pointage.
select pg_temp.expect(pg_temp.audit_count_any(:'sh_a')::text, '2',
  'E.bruit : re-sauvegarde à statut inchangé filtrée (2 audits : confirm + pointage)');
select pg_temp.expect(pg_temp.audit_count(:'sh_a','rh.shift.pointage')::text, '1',
  'E.un seul pointage (la retouche poste/commentaire à statut inchangé n''a rien ajouté)');

-- (F) annulation par un manager : 1 audit rh.shift.cancel, acteur manager, before.status=planifie.
select pg_temp.assert_audit(
  :'sh_b', 'rh.shift.cancel', 'staff_shift', 'manager', 'lab-manager-01',
  :'ev', 'RH · Salarié Test B — créneau % annulé',
  jsonb_build_object('status','annule'),
  jsonb_build_object('status','planifie')
);

-- (G) minimisation : ni rémunération (taux_horaire/notes_direction) ni champ libre (commentaire) ne fuit.
select pg_temp.expect(pg_temp.audit_leak(:'sh_a','NOTE-DIR-SECRET-0041'), 'OK',
  'G.notes_direction (paie/confidentiel) absent du journal');
select pg_temp.expect(pg_temp.audit_leak(:'sh_a','77.77'), 'OK',
  'G.taux_horaire (paie) absent du journal');
select pg_temp.expect(pg_temp.audit_leak(:'sh_a','CMT-SECRET-0041'), 'OK',
  'G.commentaire (champ libre) absent du journal');

-- (H) append-only préservé : insert direct sous authenticated refusé (42501).
select pg_temp.expect(:'i_direct', '42501', 'H.append-only : insert direct audit_log refusé');

select '0041 rh_shift_audit_trigger (câblage log_audit_event via 1 TRIGGER sur staff_shifts captant les DEUX chemins : UPSERT direction + update interne de la RPC SECDEF confirm_my_shift_v1 · rh.shift.confirm attribué au SALARIÉ · rh.shift.pointage / rh.shift.cancel attribués à la direction · filtre de composition planifie + re-sauvegarde à statut inchangé · event_id propagé · before/after fidèles · minimisation taux_horaire + notes_direction + commentaire · full_name inclus pour lisibilité · append-only préservé) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
