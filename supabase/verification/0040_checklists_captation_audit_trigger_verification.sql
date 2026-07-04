-- 0040_checklists_captation_audit_trigger_verification.sql
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) de la migration 0040 — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR
-- LES CHECKLISTS (0028) ET LA CAPTATION (0029), via TRIGGERS (états écrits en INSERT/UPDATE direct sous
-- RLS, sans RPC où insérer un `perform` — patron 0036/0038/0039).
--
-- Prouve, sur PostgreSQL réel et en TRANSACTION ANNULÉE (rollback — aucune donnée persistée) :
--   (A) STRUCTURE : les 2 fonctions de trigger existent (search_path=public) et les 2 triggers sont bien
--       AFTER, attachés à checklist_completions / shot_captures, aux événements INSERT|UPDATE ;
--   (B) CHECKLIST SIGN-OFF (catégorie liability-critique) : cocher un item `issues` (fermeture) crée
--       EXACTEMENT 1 audit `checklist.signoff`, acteur estampillé depuis la SESSION (server/server),
--       venue PROPAGÉ, event_id PROPAGÉ, after fidèle (phase/category/item_id), résumé lisible avec label ;
--   (C) FILTRE DE BRUIT CHECKLIST : cocher un item `nettoyage` (catégorie routinière) ne crée AUCUN audit ;
--   (D) RÉ-ATTRIBUTION (UPDATE) : changer `done_by` d'une coche `caisse` crée 1 audit `checklist.signoff`
--       supplémentaire (before.done_by = ancien, résumé « ré-signé ») ; une simple édition de note (même
--       done_by) ne crée AUCUN audit supplémentaire ;
--   (E) CAPTATION DÉPÔT : passer un plan à `depose` (UPDATE) crée 1 audit `captation.depose`, venue
--       propagé, before.status='capture', after porte dam_ref + status='depose', résumé « déposé au DAM » ;
--   (F) FILTRE DE BRUIT CAPTATION : un état `capture` (intermédiaire) ne crée AUCUN audit ; ré-éditer un
--       plan DÉJÀ `depose` (note) ne crée AUCUN audit supplémentaire ;
--   (G) MINIMISATION : la `note` de complétion checklist et le `sujet`/`note` captation (champs libres)
--       ne sont PAS recopiés dans le journal global (tokens de test ABSENTS de after_data) ;
--   (H) APPEND-ONLY préservé (hérité de 0033) : un INSERT DIRECT dans audit_log sous `authenticated`
--       reste refusé (42501) — les triggers ne rouvrent aucune porte d'écriture directe.
--
-- Chaque assertion échoue bruyamment (raise exception) si l'invariant n'est pas observé.
-- subs des staff_users identiques à 0033..0039 (LABO). Les variables psql (:'var'/\gset) NE SONT PAS
-- interpolées dans les blocs $$…$$ : bascules d'identité, captures d'erreur et lectures d'audit passent
-- par des helpers pg_temp appelés depuis des SELECT normaux.

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
  values ('forge.checklist','pirate','admin','checklist_completion');
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

-- Assertion complète sur UNE ligne d'audit : unicité (resource_id, action), acteur estampillé,
-- resource_type attendu, et (optionnellement) venue + event_id + fragments summary/after/before.
create or replace function pg_temp.assert_audit(
  p_rid text, p_action text, p_rtype text, p_role text, p_user text,
  p_venue text default null,
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
  if p_venue is not null and (r.venue is distinct from p_venue) then
    raise exception '%.% venue ATTENDU %, OBTENU %', p_action, p_rid, p_venue, coalesce(r.venue,'NULL'); end if;
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
-- (A) STRUCTURE des 2 triggers/fonctions (lu en postgres = métadonnées).
-- ============================================================
do $$
declare v_sp bool; v_cnt int; v_tgtype int; v_rel text;
begin
  -- checklist
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_checklist_completion_change';
  if v_cnt <> 1 then raise exception 'A: attendu 1 fonction checklist, trouvé %', v_cnt; end if;
  select (p.proconfig @> array['search_path=public']) into v_sp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_checklist_completion_change';
  if not v_sp then raise exception 'A: audit_checklist_completion_change search_path != public'; end if;
  select t.tgtype, c.relname into v_tgtype, v_rel from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where t.tgname='trg_audit_checklist_completion' and not t.tgisinternal;
  if v_rel is distinct from 'checklist_completions' then raise exception 'A: trg checklist pas sur checklist_completions (%)', v_rel; end if;
  if (v_tgtype & 2) <> 0 then raise exception 'A: trg checklist est BEFORE (doit être AFTER)'; end if;   -- bit 2 = BEFORE
  if (v_tgtype & 4) = 0 then raise exception 'A: trg checklist ne couvre pas INSERT'; end if;            -- bit 4 = INSERT
  if (v_tgtype & 16) = 0 then raise exception 'A: trg checklist ne couvre pas UPDATE'; end if;           -- bit 16 = UPDATE
  -- captation
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_shot_capture_change';
  if v_cnt <> 1 then raise exception 'A: attendu 1 fonction captation, trouvé %', v_cnt; end if;
  select (p.proconfig @> array['search_path=public']) into v_sp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='audit_shot_capture_change';
  if not v_sp then raise exception 'A: audit_shot_capture_change search_path != public'; end if;
  select t.tgtype, c.relname into v_tgtype, v_rel from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where t.tgname='trg_audit_shot_capture' and not t.tgisinternal;
  if v_rel is distinct from 'shot_captures' then raise exception 'A: trg captation pas sur shot_captures (%)', v_rel; end if;
  if (v_tgtype & 2) <> 0 then raise exception 'A: trg captation est BEFORE (doit être AFTER)'; end if;
  if (v_tgtype & 4) = 0 then raise exception 'A: trg captation ne couvre pas INSERT'; end if;
  if (v_tgtype & 16) = 0 then raise exception 'A: trg captation ne couvre pas UPDATE'; end if;
end $$;

-- ============================================================
-- Fixtures : on ÉCRIT sous RLS avec l'identité réelle (les triggers firent dans ce contexte).
-- Modèles (items) composés par la direction ; états (coches/captures) par les rôles autorisés.
-- ============================================================
select id::text as ev from public.events order by id limit 1 \gset

-- ---- CHECKLIST : items de config (composés par admin — RLS composition = direction) ----
set local role authenticated; select pg_temp.act_as(:'admin_sub');
-- item liability-critique : sorties de secours (issues), fermeture, venue eden, sans poste (tous).
insert into public.checklist_items(venue, phase, category, poste, label)
values ('eden','fermeture','issues', null, 'Sorties de secours dégagées et éclairées')
returning id::text as it_issues \gset
-- item liability-critique : caisse (fermeture), venue eden.
insert into public.checklist_items(venue, phase, category, poste, label)
values ('eden','fermeture','caisse', null, 'Fond de caisse compté et scellé')
returning id::text as it_caisse \gset
-- item routinier : nettoyage (fermeture) — doit être FILTRÉ.
insert into public.checklist_items(venue, phase, category, poste, label)
values ('eden','fermeture','nettoyage', null, 'Sols nettoyés')
returning id::text as it_net \gset

-- (B) SIGN-OFF liability-critique : un server coche l'item issues (poste null → autorisé).
set local role authenticated; select pg_temp.act_as(:'server_sub');
insert into public.checklist_completions(item_id, event_id, exploitation_date, note, done_by)
values (:'it_issues'::uuid, :'ev'::uuid, current_date, 'RAS-CHK-NOTE-SECRET-0040', 'server')
returning id::text as cc_issues \gset

-- (C) BRUIT : une coche nettoyage (catégorie routinière) → aucun audit.
set local role authenticated; select pg_temp.act_as(:'server_sub');
insert into public.checklist_completions(item_id, event_id, exploitation_date, done_by)
values (:'it_net'::uuid, :'ev'::uuid, current_date, 'server')
returning id::text as cc_net \gset

-- (D) coche caisse par le manager, puis RÉ-ATTRIBUTION (admin ré-endosse) + édition de note pure.
set local role authenticated; select pg_temp.act_as(:'manager_sub');
insert into public.checklist_completions(item_id, event_id, exploitation_date, done_by)
values (:'it_caisse'::uuid, :'ev'::uuid, current_date, 'lab-manager-01')
returning id::text as cc_caisse \gset
-- ré-attribution : admin ré-endosse (done_by change) → 1 audit supplémentaire (ré-signé).
set local role authenticated; select pg_temp.act_as(:'admin_sub');
update public.checklist_completions set done_by='lab-admin-01' where id = :'cc_caisse'::uuid;
-- édition de note pure (même done_by admin) → AUCUN audit supplémentaire.
update public.checklist_completions set note='recompté OK' where id = :'cc_caisse'::uuid;

-- ---- CAPTATION : item de shot list (composé par manager — RLS = direction) ----
set local role authenticated; select pg_temp.act_as(:'manager_sub');
insert into public.shot_list_items(venue, label, sujet, format, prioritaire)
values ('eden','Ambiance rooftop golden hour','CAP-SUJET-SECRET-0040 public terrasse','reel 9:16', true)
returning id::text as sli \gset

-- (F) BRUIT : un état intermédiaire 'capture' → aucun audit.
set local role authenticated; select pg_temp.act_as(:'manager_sub');
insert into public.shot_captures(item_id, event_id, exploitation_date, status, note)
values (:'sli'::uuid, :'ev'::uuid, current_date, 'capture', 'CAP-NOTE-SECRET-0040 en cours')
returning id::text as sc \gset

-- (E) DÉPÔT : transition capture → depose (UPDATE) avec dam_ref.
set local role authenticated; select pg_temp.act_as(:'manager_sub');
update public.shot_captures set status='depose', dam_ref='DAM-2026-07-04-001', note='CAP-NOTE-SECRET-0040 déposé'
  where id = :'sc'::uuid;
-- (F) ré-édition d'un plan DÉJÀ déposé (note) → AUCUN audit supplémentaire.
update public.shot_captures set note='CAP-NOTE-SECRET-0040 relu' where id = :'sc'::uuid;

-- (H) append-only : INSERT direct dans audit_log sous authenticated (admin) → doit être refusé.
set local role authenticated; select pg_temp.act_as(:'admin_sub');
select pg_temp.try_direct_audit_insert() as i_direct \gset

reset role;

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- (B) sign-off issues : 1 audit checklist.signoff, acteur server, venue eden, event_id propagé, after
-- fidèle (phase/category/item_id), résumé lisible avec label.
select pg_temp.assert_audit(
  :'cc_issues', 'checklist.signoff', 'checklist_completion', 'server', 'server',
  'eden', :'ev', 'Checklist fermeture · issues — Sorties de secours%(signé)%',
  jsonb_build_object('phase','fermeture','category','issues','item_id',:'it_issues')
);

-- (C) filtre de bruit : coche nettoyage = AUCUN audit.
select pg_temp.expect(pg_temp.audit_count_any(:'cc_net')::text, '0', 'C.bruit : coche nettoyage NON journalisée');

-- (D) ré-attribution caisse : EXACTEMENT 2 audits checklist.signoff (insert manager + ré-signé admin) ;
-- l'édition de note pure n'en a PAS ajouté de 3e. before du dernier porte l'ancien done_by.
select pg_temp.expect(pg_temp.audit_count(:'cc_caisse','checklist.signoff')::text, '2',
  'D.ré-attribution : 2 signoff attendus (coche + ré-signature), pas plus (note pure filtrée)');
select pg_temp.expect(
  (select case when exists(
     select 1 from public.audit_log
      where resource_id=:'cc_caisse' and action='checklist.signoff'
        and summary like '%(ré-signé)%' and before_data @> jsonb_build_object('done_by','lab-manager-01'))
   then 'OK' else 'KO' end),
  'OK', 'D.la ré-signature porte before.done_by=ancien et résumé « ré-signé »');

-- (E) dépôt captation : 1 audit captation.depose, acteur manager, venue eden, before.status='capture',
-- after porte dam_ref + status='depose', résumé « déposé au DAM ».
select pg_temp.assert_audit(
  :'sc', 'captation.depose', 'shot_capture', 'manager', 'lab-manager-01',
  'eden', :'ev', 'Contenu déposé au DAM · eden (réf DAM-2026-07-04-001)%',
  jsonb_build_object('status','depose','dam_ref','DAM-2026-07-04-001','item_id',:'sli'),
  jsonb_build_object('status','capture')
);
-- (F) filtre : le shot_capture n'a QU'UN SEUL audit au total (le dépôt) — l'état 'capture' initial et la
-- ré-édition post-dépôt n'ont rien ajouté.
select pg_temp.expect(pg_temp.audit_count_any(:'sc')::text, '1',
  'F.bruit captation : seul le dépôt est journalisé (capture initiale + ré-édition filtrées)');

-- (G) minimisation : aucun champ libre recopié dans le journal global.
select pg_temp.expect(
  (select case when after_data::text like '%CHK-NOTE-SECRET%' then 'LEAK' else 'OK' end
     from public.audit_log where resource_id=:'cc_issues' and action='checklist.signoff'),
  'OK', 'G.note de complétion checklist absente du journal (minimisation)');
select pg_temp.expect(
  (select case when after_data::text like '%CAP-NOTE-SECRET%' or after_data::text like '%CAP-SUJET-SECRET%'
               then 'LEAK' else 'OK' end
     from public.audit_log where resource_id=:'sc' and action='captation.depose'),
  'OK', 'G.note/sujet captation absents du journal (minimisation)');

-- (H) append-only préservé : insert direct sous authenticated refusé (42501).
select pg_temp.expect(:'i_direct', '42501', 'H.append-only : insert direct audit_log refusé');

select '0040 checklists_captation_audit_trigger (câblage log_audit_event via 2 TRIGGERS · checklist.signoff sur les coches de catégories liability-critiques secu/issues/caisse + ré-attribution done_by · captation.depose sur le franchissement du statut DAM depose · filtre de bruit catégories routinières / statuts intermédiaires / éditions de note · acteur estampillé depuis la session · venue + event_id propagés · before/after fidèles · minimisation note+sujet · append-only préservé) — TOUTES LES ASSERTIONS PASSENT (rollback, aucune donnée persistée)' as resultat;

rollback;
