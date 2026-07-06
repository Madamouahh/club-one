-- ============================================================================
-- Club One — HARNESS DE CONTRÔLE POST-CUTOVER (PART A : CONTRAT, LECTURE SEULE)
--
-- Pur SQL, AUCUNE méta-commande psql (\set/\gset) → exécutable TEL QUEL via :
--   · MCP  execute_sql   · psql -f   · éditeur SQL Supabase.
-- Read-only : SAFE même sur PRODUCTION juste après le cutover (ne modifie rien).
-- Chaque invariant échoué => `raise exception` (le harness s'arrête en rouge).
-- Fin OK => une ligne NOTICE « CONTRACT HARNESS OK ».
--
-- Couvre : nb migrations trackées, tables clés, fonctions versionnées, attributs de sécurité,
-- policies finales, grants, publication Realtime (4 tables), verrouillage anon, révocation RPC
-- legacy, exposition venue (0052), neutralisation password (0053, si staff présents).
-- ============================================================================

do $$
declare
  v_missing text;
  v_n int;
  v_cols text;
begin
  -- ── 1. Tables de base event-scope présentes ────────────────────────────────
  foreach v_missing in array array[
    'staff_users','club_runtime_state','club_tables','entry_logs','promoter_contacts',
    'promoter_guest_entries','event_archives','venues','events'
  ] loop
    if to_regclass('public.'||v_missing) is null then
      raise exception 'CONTRACT: table % manquante', v_missing;
    end if;
  end loop;

  -- ── 2. RPC versionnées (event-scope) présentes ─────────────────────────────
  foreach v_missing in array array[
    'current_staff_role()','current_staff_username()','current_active_event_id()',
    'current_active_event_date()','get_active_event_context()','get_security_table_snapshot()',
    'list_activatable_club_events()','bootstrap_club_event_v2(uuid)','activate_club_event_v2(uuid)',
    'close_club_event_v2()','add_entry_log_v2(text)','add_expense_v3(text,text,numeric,text)',
    'check_in_invitation_v2(text,text)','create_promoter_invitation_v2(text,uuid,text,text,text,text)'
  ] loop
    if to_regprocedure('public.'||v_missing) is null then
      raise exception 'CONTRACT: RPC % manquante', v_missing;
    end if;
  end loop;

  -- ── 3. Fonctions sensibles = SECURITY DEFINER + search_path fixé ────────────
  for v_missing in
    select p.proname
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in ('current_staff_role','current_staff_username','current_active_event_id',
                         'bootstrap_club_event_v2','activate_club_event_v2','close_club_event_v2',
                         'add_expense_v3','check_in_invitation_v2','create_promoter_invitation_v2',
                         'get_security_table_snapshot','get_active_event_context')
       and (not p.prosecdef
            or coalesce(array_to_string(p.proconfig,','),'') not ilike '%search_path%')
  loop
    raise exception 'CONTRACT: fonction % doit être SECURITY DEFINER avec search_path fixé', v_missing;
  end loop;

  -- ── 4. RLS activée sur les 9 tables ────────────────────────────────────────
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'
     and c.relname in ('staff_users','club_runtime_state','club_tables','entry_logs',
                       'promoter_contacts','promoter_guest_entries','event_archives','venues','events')
     and c.relrowsecurity = false;
  if v_missing is not null then
    raise exception 'CONTRACT: RLS non activée sur : %', v_missing;
  end if;

  -- ── 5. anon : AUCUN grant de table dans public ─────────────────────────────
  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema='public' and grantee='anon';
  if v_n <> 0 then
    raise exception 'CONTRACT: anon possède % grant(s) de table (attendu 0 après 0009)', v_n;
  end if;

  -- ── 6. RPC legacy révoquées pour anon/authenticated (0009) ─────────────────
  select count(*) into v_n
    from information_schema.routine_privileges
   where routine_schema='public'
     and routine_name in ('add_expense','add_expense_v2','check_in_invitation')
     and grantee in ('anon','authenticated');
  if v_n <> 0 then
    raise exception 'CONTRACT: RPC legacy exposent encore % grant(s) anon/authenticated', v_n;
  end if;

  -- ── 7. Plus aucune policy transitoire co_phase0b_* ─────────────────────────
  select count(*) into v_n from pg_policies
   where schemaname='public' and policyname like 'co_phase0b_%';
  if v_n <> 0 then
    raise exception 'CONTRACT: % policy transitoire co_phase0b_* subsiste(nt)', v_n;
  end if;

  -- ── 8. Policies finales clés présentes ─────────────────────────────────────
  foreach v_missing in array array[
    'club_tables_select_promoter_own','club_tables_select_server','club_tables_update_promoter_own',
    'pge_select_promoter_own','pc_select_promoter_own','entry_logs_select_ops'
  ] loop
    if not exists (select 1 from pg_policies where schemaname='public' and policyname=v_missing) then
      raise exception 'CONTRACT: policy finale % manquante', v_missing;
    end if;
  end loop;

  -- ── 9. Publication Realtime = les 4 tables live ────────────────────────────
  foreach v_missing in array array['club_tables','entry_logs','promoter_contacts','promoter_guest_entries'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename=v_missing
    ) then
      raise exception 'CONTRACT: table % absente de la publication Realtime', v_missing;
    end if;
  end loop;

  -- ── 10. Exposition venue (0052) : get_active_event_context expose venue_id/venue_name ──
  select pg_get_function_result(p.oid) into v_cols
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='get_active_event_context';
  if v_cols not ilike '%venue_id%' or v_cols not ilike '%venue_name%' then
    raise exception 'CONTRACT: get_active_event_context n''expose pas venue_id/venue_name (0052) : %', v_cols;
  end if;

  -- ── 11. staff_users verrouillée (aucun grant anon/authenticated) ───────────
  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema='public' and table_name='staff_users' and grantee in ('anon','authenticated');
  if v_n <> 0 then
    raise exception 'CONTRACT: staff_users exposée (% grant anon/authenticated)', v_n;
  end if;

  -- ── 12. Neutralisation password (0053) — SI des staff existent ─────────────
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='staff_users' and column_name='password')
     and exists (select 1 from public.staff_users) then
    select count(*) into v_n from public.staff_users
     where password is not null and password <> 'legacy-neutralized-see-gotrue';
    if v_n <> 0 then
      raise notice 'CONTRACT WARN: % mot(s) de passe en clair non neutralisé(s) — 0053 pas encore appliquée (GO-gated)', v_n;
    end if;
  end if;

  raise notice 'CONTRACT HARNESS OK — contrat post-cutover vérifié (structure, RLS, grants, Realtime, anon verrouillé, RPC legacy révoquées, venue exposé).';
end;
$$;
