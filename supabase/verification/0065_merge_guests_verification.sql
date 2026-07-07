-- 0065_merge_guests_verification.sql — vérification LABO (rollback ; chaque invariant = raise exception).
-- Niveau 4 (structure + garde comportementale). Le happy-path de fusion (réattribution enfants +
-- suppression drop) est prouvé en NAVIGATEUR contre le LABO (admin réel) via l'E2E CRM.

begin;

do $$
declare v_ok boolean; v_code text; v_secdef boolean; v_sp text; v_anon int; v_auth int;
begin
  -- A. merge_guests_v1 existe, SECURITY DEFINER, search_path=public figé.
  select p.prosecdef, array_to_string(p.proconfig, ',') into v_secdef, v_sp
    from pg_proc p where p.proname = 'merge_guests_v1' and p.pronamespace = 'public'::regnamespace;
  if v_secdef is null then raise exception 'A: merge_guests_v1 absente'; end if;
  if not v_secdef then raise exception 'A: merge_guests_v1 doit être SECURITY DEFINER'; end if;
  if v_sp is distinct from 'search_path=public' then raise exception 'A: search_path attendu public, obtenu %', v_sp; end if;

  -- B. Grants : execute à authenticated, pas à public/anon.
  select count(*) filter (where grantee = 'anon'),
         count(*) filter (where grantee = 'authenticated')
    into v_anon, v_auth
    from information_schema.role_routine_grants
   where routine_name = 'merge_guests_v1' and specific_schema = 'public';
  if v_anon <> 0 then raise exception 'B: anon ne doit pas avoir execute sur merge_guests_v1'; end if;
  if v_auth < 1 then raise exception 'B: authenticated doit avoir execute'; end if;

  -- C. Garde de rôle : sans identité direction (contexte postgres, current_staff_role() NULL),
  --    la RPC refuse (fail-closed) — pas de fusion à l'aveugle.
  select ok, code into v_ok, v_code from public.merge_guests_v1(gen_random_uuid(), gen_random_uuid());
  if v_ok then raise exception 'C: merge_guests_v1 aurait dû REFUSER sans rôle direction'; end if;
  if v_code <> 'unauthorized' then raise exception 'C: code attendu unauthorized, obtenu %', v_code; end if;

  raise notice '0065 merge_guests verification: A/B/C OK — DEFINER+search_path, grants authenticated-only, garde direction fail-closed.';
end $$;

rollback;
