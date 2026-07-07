-- 0072_staff_shift_lifecycle_notifications_verification.sql — PREUVE NIVEAU 3 (SQL STATIQUE, tx ROLLBACK).
-- PUR SQL. Transaction rollback ; chaque invariant = raise exception.
--
-- Vérifie APRÈS 0072 :
--   A. colonnes de cycle de vie ajoutées à staff_shifts (version, original_planned_start,
--      modification_reason, acknowledged_at, published_at) ;
--   B. table staff_notifications présente avec status/severity contraints + RLS active ;
--   C. RPC publish_shift_v1 / request_early_start_v1 / respond_staff_notification_v1 /
--      mark_staff_notification_read_v1 présentes, SECURITY DEFINER, search_path figé ;
--   D. gardes : publish/early-start = manager (admin/manager) ; early-start conserve l'heure initiale,
--      versionne et remet en attente de confirmation ; respond ne touche que SA notification ;
--   E. grants : RPC authenticated-only (jamais anon) ; staff_notifications anon fail-closed ;
--   F. RLS staff_notifications : policies own + direction présentes.

begin;

do $$
declare v_src text; v_oid oid; v_secdef boolean; v_cfg text[];
begin
  -- A. colonnes staff_shifts --------------------------------------------------------------------------
  perform 1 from information_schema.columns where table_schema='public' and table_name='staff_shifts'
    and column_name in ('version','original_planned_start','modification_reason','acknowledged_at','published_at')
    group by table_name having count(*) = 5;
  if not found then raise exception 'A: colonnes de cycle de vie manquantes sur staff_shifts'; end if;

  -- B. table staff_notifications + contraintes + RLS --------------------------------------------------
  if to_regclass('public.staff_notifications') is null then raise exception 'B: staff_notifications absente'; end if;
  if not exists (select 1 from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='staff_notifications' and con.contype='c'
       and pg_get_constraintdef(con.oid) ilike '%confirmation_requise%') then
    raise exception 'B: contrainte status (…confirmation_requise…) absente'; end if;
  if not (select relrowsecurity from pg_class where oid='public.staff_notifications'::regclass) then
    raise exception 'B: RLS off sur staff_notifications'; end if;

  -- C. RPC présentes + SECURITY DEFINER + search_path figé --------------------------------------------
  for v_oid in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('publish_shift_v1','request_early_start_v1','respond_staff_notification_v1','mark_staff_notification_read_v1')
  loop
    select p.prosecdef, p.proconfig into v_secdef, v_cfg from pg_proc p where p.oid=v_oid;
    if not v_secdef then raise exception 'C: RPC % non SECURITY DEFINER', v_oid::regprocedure; end if;
    if v_cfg is null or not exists (select 1 from unnest(v_cfg) c where c ilike 'search_path=%public%') then
      raise exception 'C: RPC % sans search_path figé', v_oid::regprocedure; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in
        ('publish_shift_v1','request_early_start_v1','respond_staff_notification_v1','mark_staff_notification_read_v1')) <> 4 then
    raise exception 'C: une ou plusieurs RPC 0072 absentes'; end if;

  -- D. gardes en source -------------------------------------------------------------------------------
  select pg_get_functiondef(oid) into v_src from pg_proc where proname='publish_shift_v1'
    and pronamespace='public'::regnamespace;
  if v_src not ilike '%not in (''admin'',''manager'')%' then raise exception 'D: publish_shift_v1 sans garde manager'; end if;
  select pg_get_functiondef(oid) into v_src from pg_proc where proname='request_early_start_v1'
    and pronamespace='public'::regnamespace;
  if v_src not ilike '%not in (''admin'',''manager'')%' then raise exception 'D: request_early_start_v1 sans garde manager'; end if;
  if v_src not ilike '%coalesce(original_planned_start%' then raise exception 'D: early-start ne conserve pas l''heure initiale'; end if;
  if v_src not ilike '%version%+%1%' then raise exception 'D: early-start ne versionne pas'; end if;
  if v_src not ilike '%''planifie''%' then raise exception 'D: early-start ne remet pas en attente de confirmation'; end if;
  select pg_get_functiondef(oid) into v_src from pg_proc where proname='respond_staff_notification_v1'
    and pronamespace='public'::regnamespace;
  if v_src not ilike '%staff_username <> v_username%' then raise exception 'D: respond ne cantonne pas au destinataire'; end if;

  -- E. grants ----------------------------------------------------------------------------------------
  if has_function_privilege('anon','public.publish_shift_v1(uuid)','EXECUTE')
     or has_function_privilege('anon','public.request_early_start_v1(uuid,timestamptz,text,timestamptz)','EXECUTE')
     or has_function_privilege('anon','public.respond_staff_notification_v1(uuid,boolean)','EXECUTE') then
    raise exception 'E: une RPC 0072 est exécutable par anon'; end if;
  if not has_function_privilege('authenticated','public.publish_shift_v1(uuid)','EXECUTE') then
    raise exception 'E: authenticated privé de publish_shift_v1'; end if;
  if has_table_privilege('anon','public.staff_notifications','SELECT')
     or has_table_privilege('anon','public.staff_notifications','INSERT') then
    raise exception 'E: anon a un privilège sur staff_notifications'; end if;

  -- F. policies RLS ----------------------------------------------------------------------------------
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='staff_notifications'
     and qual ilike '%current_staff_username()%') then
    raise exception 'F: policy salarié (staff_username = current_staff_username) absente'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='staff_notifications'
     and cmd='INSERT' and with_check ilike '%admin%' and with_check ilike '%manager%') then
    raise exception 'F: policy insert direction absente'; end if;

  raise notice '0072 verification: A/B/C/D/E/F OK — cycle de vie shift + notifications personnelles, RPC gardées manager/salarié, anon fail-closed, RLS active.';
end;
$$;

rollback;
