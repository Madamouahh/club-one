-- 0071_client_invitation_pass_verification.sql — PREUVE NIVEAU 3 (SQL STATIQUE, tx ROLLBACK).
-- PUR SQL. Transaction rollback ; chaque invariant = raise exception.
--
-- Vérifie APRÈS 0071 :
--   A. issue_guest_pass_v1(uuid,uuid,boolean,boolean) présente, SECURITY DEFINER, search_path figé ;
--   B. cancel_guest_pass_v1(uuid) présente, SECURITY DEFINER, search_path figé ;
--   C. issue_… : garde staff (admin/manager/promoter) + anti-doublon actif (issued|scanned) + QR serveur ;
--   D. cancel_… : garde direction (admin/manager) + refus d'annuler un pass déjà scanné ;
--   E. grants EXECUTE = authenticated SEUL (jamais anon) sur les deux ;
--   F. guest_passes toujours sous RLS.

begin;

do $$
declare v_oid_issue oid; v_oid_cancel oid; v_secdef boolean; v_cfg text[]; v_src text;
begin
  -- A. issue -----------------------------------------------------------------------------------------
  select p.oid into v_oid_issue from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='issue_guest_pass_v1'
     and oidvectortypes(p.proargtypes)='uuid, uuid, boolean, boolean';
  if v_oid_issue is null then raise exception 'A: issue_guest_pass_v1 absente/signature inattendue'; end if;
  select p.prosecdef, p.proconfig into v_secdef, v_cfg from pg_proc p where p.oid=v_oid_issue;
  if not v_secdef then raise exception 'A: issue_… pas SECURITY DEFINER'; end if;
  if v_cfg is null or not exists (select 1 from unnest(v_cfg) c where c ilike 'search_path=%public%') then
    raise exception 'A: issue_… sans search_path=public figé'; end if;

  -- B. cancel ----------------------------------------------------------------------------------------
  select p.oid into v_oid_cancel from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='cancel_guest_pass_v1'
     and oidvectortypes(p.proargtypes)='uuid';
  if v_oid_cancel is null then raise exception 'B: cancel_guest_pass_v1 absente'; end if;
  select p.prosecdef, p.proconfig into v_secdef, v_cfg from pg_proc p where p.oid=v_oid_cancel;
  if not v_secdef then raise exception 'B: cancel_… pas SECURITY DEFINER'; end if;
  if v_cfg is null or not exists (select 1 from unnest(v_cfg) c where c ilike 'search_path=%public%') then
    raise exception 'B: cancel_… sans search_path=public figé'; end if;

  -- C. issue_… gardes + anti-doublon + QR serveur ---------------------------------------------------
  select pg_get_functiondef(v_oid_issue) into v_src;
  if v_src not ilike '%not in (''admin'',''manager'',''promoter'')%' then
    raise exception 'C: issue_… sans garde staff (admin/manager/promoter)'; end if;
  if v_src not ilike '%status in (''issued'',''scanned'')%' then
    raise exception 'C: issue_… sans garde anti-doublon (pass actif existant)'; end if;
  if v_src not ilike '%gen_random_uuid()%' then
    raise exception 'C: issue_… ne génère pas le QR côté serveur'; end if;

  -- D. cancel_… garde direction + refus scanned -----------------------------------------------------
  select pg_get_functiondef(v_oid_cancel) into v_src;
  if v_src not ilike '%not in (''admin'',''manager'')%' then
    raise exception 'D: cancel_… sans garde direction (admin/manager)'; end if;
  if v_src not ilike '%''scanned''%' or v_src not ilike '%already_used%' then
    raise exception 'D: cancel_… n''interdit pas l''annulation d''un pass déjà scanné'; end if;

  -- E. grants authenticated-only --------------------------------------------------------------------
  if not has_function_privilege('authenticated','public.issue_guest_pass_v1(uuid,uuid,boolean,boolean)','EXECUTE') then
    raise exception 'E: authenticated privé d''EXECUTE sur issue_…'; end if;
  if has_function_privilege('anon','public.issue_guest_pass_v1(uuid,uuid,boolean,boolean)','EXECUTE') then
    raise exception 'E: anon a EXECUTE sur issue_… (doit être authenticated-only)'; end if;
  if not has_function_privilege('authenticated','public.cancel_guest_pass_v1(uuid)','EXECUTE') then
    raise exception 'E: authenticated privé d''EXECUTE sur cancel_…'; end if;
  if has_function_privilege('anon','public.cancel_guest_pass_v1(uuid)','EXECUTE') then
    raise exception 'E: anon a EXECUTE sur cancel_… (doit être authenticated-only)'; end if;

  -- F. RLS active sur guest_passes ------------------------------------------------------------------
  if not (select relrowsecurity from pg_class where oid='public.guest_passes'::regclass) then
    raise exception 'F: RLS off sur guest_passes'; end if;

  raise notice '0071 client_invitation_pass verification: A/B/C/D/E/F OK — issue/cancel gardées, anti-doublon, QR serveur, authenticated-only, RLS active.';
end;
$$;

rollback;
