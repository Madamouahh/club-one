-- 0074_invite_link_revocation_verification.sql — PREUVE NIVEAU 3 (SQL STATIQUE, tx ROLLBACK). PUR SQL.
-- Vérifie APRÈS 0074 :
--   A. colonnes revoked_at / revoked_by / revocation_reason sur invite_links ;
--   B. revoke_invite_link_v1 présente, SECURITY DEFINER, search_path figé ;
--   C. get_invite_link_public expose la colonne `revoked` ;
--   D. onboard_referral_v1 refuse un lien révoqué (référence revoked_at + code link_revoked) ;
--   E. grants : revoke = authenticated seulement (jamais anon) ; get_invite_link_public = anon+authenticated.

begin;
do $$
declare v_src text; v_secdef boolean; v_cfg text[];
begin
  -- A
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='invite_links'
      and column_name in ('revoked_at','revoked_by','revocation_reason')) <> 3 then
    raise exception 'A: colonnes de révocation manquantes'; end if;

  -- B
  select p.prosecdef, p.proconfig into v_secdef, v_cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='revoke_invite_link_v1';
  if v_secdef is null then raise exception 'B: revoke_invite_link_v1 absente'; end if;
  if not v_secdef then raise exception 'B: revoke non SECURITY DEFINER'; end if;
  if v_cfg is null or not exists (select 1 from unnest(v_cfg) c where c ilike 'search_path=%public%') then
    raise exception 'B: revoke sans search_path figé'; end if;

  -- C
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='get_invite_link_public'
        and pg_get_function_result(p.oid) ilike '%revoked boolean%') then
    raise exception 'C: get_invite_link_public n''expose pas `revoked`'; end if;

  -- D
  select pg_get_functiondef(oid) into v_src from pg_proc where proname='onboard_referral_v1' and pronamespace='public'::regnamespace;
  if v_src not ilike '%revoked_at is not null%' or v_src not ilike '%link_revoked%' then
    raise exception 'D: onboard_referral_v1 ne refuse pas les liens révoqués'; end if;

  -- E
  if has_function_privilege('anon','public.revoke_invite_link_v1(uuid,text)','EXECUTE') then
    raise exception 'E: anon a EXECUTE sur revoke_invite_link_v1'; end if;
  if not has_function_privilege('authenticated','public.revoke_invite_link_v1(uuid,text)','EXECUTE') then
    raise exception 'E: authenticated devrait exécuter revoke'; end if;
  if not has_function_privilege('anon','public.get_invite_link_public(text)','EXECUTE') then
    raise exception 'E: get_invite_link_public doit rester lisible par anon (/i public)'; end if;

  raise notice '0074 invite_link_revocation verification: A/B/C/D/E OK — révocation explicite, DEFINER search_path figé, onboard refuse revoked, grants corrects.';
end;
$$;
rollback;
