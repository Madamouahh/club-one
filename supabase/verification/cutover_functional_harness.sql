-- ============================================================================
-- Club One — HARNESS FONCTIONNEL POST-CUTOVER (PART B : SMOKE 7 RÔLES, self-seed, ROLLBACK)
--
-- Pur SQL, AUCUNE méta-commande psql → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- NON-PROD UNIQUEMENT. Toute la transaction est ROLLBACK : rien n'est persisté (zéro résidu).
-- Chaque invariant échoué => raise exception.
--
-- PRÉCONDITIONS SÉMANTIQUES (vérifiées, pas de dépendance artificielle à « exactement 18 tables ») :
--   · base réellement migrée (tables métier + RPC event-scope présentes) ;
--   · aucune fixture de test résiduelle (préfixe ffffffff / @harness.test) — refus sinon ;
--   · transaction disponible (on est dans un BEGIN).
-- Le harness s'ISOLE : il vide les données opérationnelles DANS la transaction (truncate cascade,
-- annulé au rollback), pose ses propres fixtures, bootstrappe via la VRAIE RPC, teste, puis ROLLBACK
-- → l'état d'origine du clone est intégralement restauré. Le « 18 tables » ci-dessous n'est pas une
-- hypothèse sur l'environnement : c'est l'invariant PRODUIT de bootstrap_club_event_v2 (documenté),
-- que le harness SATISFAIT en posant exactement ses 18 tables de test.
--
-- Auth : impersonation par request.jwt.claims (RPC SECDEF) pour la préparation ; role=authenticated
-- pour les assertions (RLS réellement appliquée). Login GoTrue complet prouvé par scripts/gotrue-e2e.mjs.
-- ============================================================================

begin;

-- ── Préconditions sémantiques ──────────────────────────────────────────────
do $$
begin
  if to_regclass('public.club_tables') is null or to_regclass('public.club_runtime_state') is null
     or to_regprocedure('public.bootstrap_club_event_v2(uuid)') is null
     or to_regprocedure('public.add_expense_v3(text,text,numeric,text)') is null then
    raise exception 'HARNESS refus : base non migrée (tables/RPC event-scope absentes).';
  end if;
  if exists (select 1 from auth.users where email like '%@harness.test')
     or exists (select 1 from public.staff_users where username like 'h\_%') then
    raise exception 'HARNESS refus : fixtures de test résiduelles présentes (nettoyer d''abord).';
  end if;
end $$;

-- ── Isolation : vider l'opérationnel DANS la transaction (annulé au rollback) ──
truncate public.events, public.club_runtime_state restart identity cascade;
insert into public.club_runtime_state (id) values (true);
delete from public.staff_users;

-- ── Fixtures de test (préfixe ffffffff / h_) ───────────────────────────────
insert into auth.users (id, aud, role, email, is_sso_user, is_anonymous) values
  ('ffffffff-0000-0000-0000-000000000001','authenticated','authenticated','h_admin@harness.test',false,false),
  ('ffffffff-0000-0000-0000-000000000003','authenticated','authenticated','h_promoter1@harness.test',false,false),
  ('ffffffff-0000-0000-0000-000000000004','authenticated','authenticated','h_promoter2@harness.test',false,false),
  ('ffffffff-0000-0000-0000-000000000005','authenticated','authenticated','h_jeremy@harness.test',false,false),
  ('ffffffff-0000-0000-0000-000000000007','authenticated','authenticated','h_security@harness.test',false,false),
  ('ffffffff-0000-0000-0000-000000000008','authenticated','authenticated','h_counter@harness.test',false,false)
on conflict (id) do nothing;

insert into public.staff_users (id, username, password, role, full_name, auth_id) values
  (gen_random_uuid(),'h_admin','x','admin','H Admin','ffffffff-0000-0000-0000-000000000001'),
  (gen_random_uuid(),'h_promoter1','x','promoter','H Promoter One','ffffffff-0000-0000-0000-000000000003'),
  (gen_random_uuid(),'h_promoter2','x','promoter','H Promoter Two','ffffffff-0000-0000-0000-000000000004'),
  (gen_random_uuid(),'h_jeremy','x','server','H Jeremy','ffffffff-0000-0000-0000-000000000005'),
  (gen_random_uuid(),'h_security','x','security','H Security','ffffffff-0000-0000-0000-000000000007'),
  (gen_random_uuid(),'h_counter','x','security_counter','H Counter','ffffffff-0000-0000-0000-000000000008');

insert into public.venues (id, name, kind, sort_order) values ('h_eden','H Eden','club',0) on conflict (id) do nothing;
insert into public.events (id, venue_id, title, slug, event_date, status)
  values ('ffffffff-1111-1111-1111-111111111111','h_eden','H Soiree','h-soiree-harness',current_date,'published');
insert into public.club_tables (id, zone, status, capacity)
  select 'H' || lpad(g::text,2,'0'), 'H Zone', 'free', 6 from generate_series(1,18) g;

-- ── Bootstrap + invitations + flux via claims (rôle courant conservé) ──────
do $$
declare v_ok boolean;
begin
  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000001"}', true);
  select ok into v_ok from public.bootstrap_club_event_v2('ffffffff-1111-1111-1111-111111111111');
  if not coalesce(v_ok,false) then raise exception 'HARNESS: bootstrap a échoué'; end if;
end $$;

update public.club_tables set assigned_to='h_promoter1' where id='H03';

do $$
begin
  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000003"}', true);
  perform public.create_promoter_invitation_v2('h_promoter1', null, 'H Guest A1', '0611111111', 'sans_alcool','en_attente');
  perform public.create_promoter_invitation_v2('h_promoter1', null, 'H Guest A2', '0611111112', 'avec_alcool','regle');
  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000004"}', true);
  perform public.create_promoter_invitation_v2('h_promoter2', null, 'H Guest B1', '0622222221', 'sans_alcool','offert');
  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000008"}', true);
  perform public.add_entry_log_v2('entry'); perform public.add_entry_log_v2('exit');
end $$;

-- ── Assertions sous role authenticated (RLS réellement appliquée) ──────────
set local role authenticated;

do $$
declare v_ct int; v_pge int; v_snap int; v_code text; v_logs int;
begin
  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000001"}', true);
  select count(*) into v_ct from public.club_tables; if v_ct<>18 then raise exception 'admin tables=% (att 18)', v_ct; end if;
  select count(*) into v_snap from public.get_security_table_snapshot(); if v_snap<>18 then raise exception 'admin snapshot=% (att 18)', v_snap; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000003"}', true);
  select count(*) into v_ct from public.club_tables; if v_ct<>1 then raise exception 'promoter1 tables=% (att 1)', v_ct; end if;
  select count(*) into v_pge from public.promoter_guest_entries; if v_pge<>2 then raise exception 'promoter1 invit=% (att 2)', v_pge; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000004"}', true);
  select count(*) into v_ct from public.club_tables; if v_ct<>0 then raise exception 'promoter2 tables=% (att 0)', v_ct; end if;
  select count(*) into v_pge from public.promoter_guest_entries; if v_pge<>1 then raise exception 'promoter2 invit=% (att 1)', v_pge; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000005"}', true);
  select count(*) into v_ct from public.club_tables; if v_ct<>17 then raise exception 'server tables=% (att 17)', v_ct; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000007"}', true);
  select count(*) into v_ct from public.club_tables; if v_ct<>0 then raise exception 'security direct=% (att 0)', v_ct; end if;
  select count(*) into v_snap from public.get_security_table_snapshot(); if v_snap<>18 then raise exception 'security snapshot=% (att 18)', v_snap; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000008"}', true);
  select count(*) into v_ct from public.club_tables; if v_ct<>0 then raise exception 'counter tables=% (att 0)', v_ct; end if;
  select count(*) into v_logs from public.entry_logs; if v_logs<>2 then raise exception 'counter flux=% (att 2)', v_logs; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000003"}', true);
  select code into v_code from public.add_expense_v3('H03','Bouteille',100,current_date::text);
  if v_code<>'ok' then raise exception 'promoter1 dépense H03 code=% (att ok)', v_code; end if;
  select code into v_code from public.add_expense_v3('H05','Vol',50,current_date::text);
  if v_code='ok' then raise exception 'promoter1 dépense étrangère H05 doit être refusée'; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000008"}', true);
  select code into v_code from public.add_expense_v3('H05','x',10,current_date::text);
  if v_code='ok' then raise exception 'counter ne doit pas pouvoir dépenser'; end if;

  raise notice 'FUNCTIONAL HARNESS OK (1/2) — 7 rôles + isolation promoteur/server + dépenses + flux.';
end $$;

do $$
declare v_token text; v_code text; v_active uuid;
begin
  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000001"}', true);
  select qr_token into v_token from public.promoter_guest_entries where guest_name='H Guest A1' limit 1;
  if v_token is null then raise exception 'HARNESS: token introuvable'; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000005"}', true);
  select code into v_code from public.check_in_invitation_v2(v_token, current_date::text);
  if v_code='checked_in' then raise exception 'server ne doit pas pouvoir check-in'; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000007"}', true);
  select code into v_code from public.check_in_invitation_v2(v_token, current_date::text);
  if v_code<>'checked_in' then raise exception 'security check-in code=% (att checked_in)', v_code; end if;
  select code into v_code from public.check_in_invitation_v2(v_token, current_date::text);
  if v_code<>'already_used' then raise exception 'rejeu QR code=% (att already_used)', v_code; end if;

  perform set_config('request.jwt.claims','{"sub":"ffffffff-0000-0000-0000-000000000001"}', true);
  select code into v_code from public.close_club_event_v2();
  if v_code<>'ok' then raise exception 'close code=% (att ok)', v_code; end if;
  select event_id into v_active from public.get_active_event_context();
  if v_active is not null then raise exception 'après close, get_active_event_context.event_id doit être null'; end if;

  raise notice 'FUNCTIONAL HARNESS OK (2/2) — QR (server refusé / security ok / rejeu already_used) + clôture atomique.';
end $$;

reset role;
rollback;
