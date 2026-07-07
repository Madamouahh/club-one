-- 0070_client_reservation_request_verification.sql — PREUVE NIVEAU 3 (SQL STATIQUE, tx ROLLBACK).
-- PUR SQL. Transaction rollback ; chaque invariant = raise exception.
--
-- Vérifie APRÈS 0070 :
--   A. request_table_reservation_as_guest_v1(uuid,text,uuid,int,text,text) présente, SECURITY DEFINER,
--      search_path=public figé ;
--   B. cancel_reservation_request_as_guest_v1(uuid,uuid) présente, SECURITY DEFINER, search_path figé ;
--   C. les DEUX résolvent le token en tête (garde de capacité : source contient guests + space_token) ;
--   D. request_… crée une DEMANDE pending + une notification Inbox (contact_requests, requester_type client) ;
--   E. grants EXECUTE = anon + authenticated (route protégée par capacité, pas anon nue mais token-gardée) ;
--   F. tables cibles table_reservation_requests + contact_requests toujours sous RLS.

begin;

do $$
declare
  v_oid_req oid; v_oid_cancel oid;
  v_secdef boolean; v_cfg text[]; v_src text;
begin
  -- A. request présente + signature exacte ----------------------------------------------------------
  select p.oid into v_oid_req from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='request_table_reservation_as_guest_v1'
     and oidvectortypes(p.proargtypes)='uuid, text, uuid, integer, text, text';
  if v_oid_req is null then raise exception 'A: request_table_reservation_as_guest_v1 absente/signature inattendue'; end if;
  select p.prosecdef, p.proconfig into v_secdef, v_cfg from pg_proc p where p.oid=v_oid_req;
  if not v_secdef then raise exception 'A: request_… pas SECURITY DEFINER'; end if;
  if v_cfg is null or not exists (select 1 from unnest(v_cfg) c where c ilike 'search_path=%public%') then
    raise exception 'A: request_… sans search_path=public figé'; end if;

  -- B. cancel présente -----------------------------------------------------------------------------
  select p.oid into v_oid_cancel from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='cancel_reservation_request_as_guest_v1'
     and oidvectortypes(p.proargtypes)='uuid, uuid';
  if v_oid_cancel is null then raise exception 'B: cancel_reservation_request_as_guest_v1 absente'; end if;
  select p.prosecdef, p.proconfig into v_secdef, v_cfg from pg_proc p where p.oid=v_oid_cancel;
  if not v_secdef then raise exception 'B: cancel_… pas SECURITY DEFINER'; end if;
  if v_cfg is null or not exists (select 1 from unnest(v_cfg) c where c ilike 'search_path=%public%') then
    raise exception 'B: cancel_… sans search_path=public figé'; end if;

  -- C. garde de capacité : les deux résolvent space_token → guests -----------------------------------
  select pg_get_functiondef(v_oid_req) into v_src;
  if v_src not ilike '%from public.guests%' or v_src not ilike '%space_token = p_space_token%' then
    raise exception 'C: request_… ne résout pas le space_token (garde de capacité absente)'; end if;
  select pg_get_functiondef(v_oid_cancel) into v_src;
  if v_src not ilike '%space_token = p_space_token%' then
    raise exception 'C: cancel_… ne résout pas le space_token'; end if;

  -- D. request_… crée pending + notif Inbox --------------------------------------------------------
  select pg_get_functiondef(v_oid_req) into v_src;
  if v_src not ilike '%''pending''%' then raise exception 'D: request_… ne crée pas une demande pending'; end if;
  if v_src not ilike '%into public.contact_requests%' or v_src not ilike '%''client''%' then
    raise exception 'D: request_… ne notifie pas l''Inbox (contact_requests client)'; end if;

  -- E. grants : anon + authenticated ---------------------------------------------------------------
  if not has_function_privilege('anon','public.request_table_reservation_as_guest_v1(uuid,text,uuid,int,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.request_table_reservation_as_guest_v1(uuid,text,uuid,int,text,text)','EXECUTE') then
    raise exception 'E: request_… doit être exécutable par anon ET authenticated (route protégée par token)'; end if;
  if not has_function_privilege('anon','public.cancel_reservation_request_as_guest_v1(uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.cancel_reservation_request_as_guest_v1(uuid,uuid)','EXECUTE') then
    raise exception 'E: cancel_… doit être exécutable par anon ET authenticated'; end if;

  -- E'. list_requestable_tables_v1 présente, SECURITY DEFINER, token-gardée, anon+authenticated --------
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='list_requestable_tables_v1'
       and oidvectortypes(p.proargtypes)='uuid, text' and p.prosecdef
  ) then raise exception 'E'': list_requestable_tables_v1(uuid,text) absente/pas SECURITY DEFINER'; end if;
  if not has_function_privilege('anon','public.list_requestable_tables_v1(uuid,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.list_requestable_tables_v1(uuid,text)','EXECUTE') then
    raise exception 'E'': list_requestable_tables_v1 doit être exécutable par anon ET authenticated'; end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='list_requestable_tables_v1') not ilike '%space_token = p_space_token%' then
    raise exception 'E'': list_requestable_tables_v1 ne résout pas le space_token (garde de capacité absente)'; end if;

  -- F. RLS toujours active sur les tables cibles ----------------------------------------------------
  if not (select relrowsecurity from pg_class where oid='public.table_reservation_requests'::regclass) then
    raise exception 'F: RLS off sur table_reservation_requests'; end if;
  if not (select relrowsecurity from pg_class where oid='public.contact_requests'::regclass) then
    raise exception 'F: RLS off sur contact_requests'; end if;

  raise notice '0070 client_reservation_request verification: A/B/C/D/E/F OK — RPC token-gardées, pending + Inbox, RLS active.';
end;
$$;

rollback;
