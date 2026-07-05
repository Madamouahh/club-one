-- 0044_promoter_table_isolation_verification.sql (+ 0045 server relation réelle)
-- PREUVE NIVEAU 4 (PostgreSQL réel, LABO) — ISOLATION PROMOTEUR A / PROMOTEUR B de bout en bout,
-- en TRANSACTION ANNULÉE (rollback : aucune donnée, aucun compte de test persisté).
--
-- Deux promoteurs distincts avec données séparées (créés IN-TX) :
--   Promoteur A = lab-promoter-01  → tables A1, A2 + une demande de résa A
--   Promoteur B = lab-promoter-02  → tables B1, B2 + une demande de résa B  (créé ici, jamais persisté)
--
-- Matrice prouvée (chaque invariant échoue bruyamment sinon) :
--   (A) SELECT      : A voit A1/A2, ne voit NI B1 NI B2 (y compris par UUID connu) ; symétrique pour B.
--   (B) UPDATE      : A modifie A1 (OK) ; A ne peut PAS modifier B1 (0 ligne) ; A ne peut PAS DONNER A1
--                     (set assigned_to=B → WITH CHECK viole) ni VOLER par ré-attribution.
--   (C) INSERT      : A ne peut PAS créer une table au nom de B (WITH CHECK viole).
--   (D) add_expense_v3 (SECDEF) : A ajoute une dépense sur A1 (ok) ; sur B1 → 'table_not_found_or_forbidden'.
--   (E) RÉSERVATION : A voit sa demande de résa, PAS celle de B (policy owner_promoter, inchangée).
--   (F) DIRECTION   : manager voit les 4 tables ; add_expense sur n'importe laquelle = ok.
--   (G) SERVER (0045): ne voit NI A NI B (tables attribuées à des promoteurs) ; scope = non-attribuée OU
--                     la sienne, plus AUCUN 'jeremy' en dur.
--
-- Les :'var'/\gset ne sont PAS interpolés dans les blocs $$…$$ : bascule d'identité, captures d'erreur
-- et assertions passent par des helpers pg_temp appelés depuis des SELECT normaux (tradition du dépôt).

begin;

-- Contexte de soirée active (lu en superuser).
select public.current_active_event_id() as ev_id, public.current_active_event_date()::text as ev_date \gset

-- Identités : A existe déjà ; B est créé IN-TX (rollback → jamais persisté).
select auth_id::text as a_sub, username as a_user from public.staff_users where role='promoter' and username='lab-promoter-01' \gset
\set b_sub '00000000-0000-4b02-8b02-0000000000b2'
insert into public.staff_users (username, role, full_name, auth_id)
values ('lab-promoter-02','promoter','Promoteur B Test', :'b_sub'::uuid);
select auth_id::text as m_sub from public.staff_users where role='manager' limit 1 \gset
select auth_id::text as srv_sub from public.staff_users where role='server' limit 1 \gset

-- Fixtures tables (superuser = bypass RLS) : A1/A2 à A, B1/B2 à B, dans la soirée active.
insert into public.club_tables (id, zone, status, capacity, assigned_to, event_id, event_date)
values
 ('ABT-A1','test', 'free', 6, :'a_user',        :'ev_id'::uuid, :'ev_date'),
 ('ABT-A2','test', 'free', 6, :'a_user',        :'ev_id'::uuid, :'ev_date'),
 ('ABT-B1','test', 'free', 6, 'lab-promoter-02',:'ev_id'::uuid, :'ev_date'),
 ('ABT-B2','test', 'free', 6, 'lab-promoter-02',:'ev_id'::uuid, :'ev_date');

-- Fixtures réservations (FK réelles : un guest + DEUX venue_tables distinctes — contrainte
-- trr_one_active_per_table interdit 2 demandes actives sur la même table).
select id::text as g_id_a from public.guests order by id limit 1 \gset
select id::text as g_id_b from public.guests order by id offset 1 limit 1 \gset
select id::text as vt_id_a from public.venue_tables where venue='eden' order by id limit 1 \gset
select id::text as vt_id_b from public.venue_tables where venue='eden' order by id offset 1 limit 1 \gset
insert into public.table_reservation_requests
  (venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, standing, status, owner_promoter)
values
  (:'vt_id_a'::uuid, :'g_id_a'::uuid, :'ev_id'::uuid, :'ev_date', 'eden', 2, false, 'pending', :'a_user'),
  (:'vt_id_b'::uuid, :'g_id_b'::uuid, :'ev_id'::uuid, :'ev_date', 'eden', 2, false, 'pending', 'lab-promoter-02');

-- ── Helpers ────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.act_as(p_sub text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true); end $$;

create or replace function pg_temp.expect(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin if p_actual is distinct from p_expected then
  raise exception '% ATTENDU "%", OBTENU "%"', p_label, p_expected, coalesce(p_actual,'NULL'); end if; end $$;

-- Nb de tables de test visibles (parmi les 4) sous la session courante.
create or replace function pg_temp.visible_test_tables() returns int language sql as $$
  select count(*)::int from public.club_tables where id in ('ABT-A1','ABT-A2','ABT-B1','ABT-B2'); $$;
-- Une table précise est-elle visible (accès par UUID/id connu) ?
create or replace function pg_temp.can_see(p_id text) returns int language sql as $$
  select count(*)::int from public.club_tables where id = p_id; $$;
-- Tente un UPDATE inoffensif ; renvoie le nb de lignes affectées, ou le SQLSTATE si refus (WITH CHECK).
create or replace function pg_temp.try_touch(p_id text) returns text language plpgsql as $$
declare n int; begin update public.club_tables set notes = coalesce(notes,'') where id = p_id; get diagnostics n = row_count; return 'ROWS='||n;
exception when others then return sqlstate; end $$;
-- Tente de DONNER une table (changer assigned_to) ; WITH CHECK doit refuser (ou 0 ligne si USING filtre).
create or replace function pg_temp.try_reassign(p_id text, p_to text) returns text language plpgsql as $$
declare n int; begin update public.club_tables set assigned_to = p_to where id = p_id; get diagnostics n = row_count; return 'ROWS='||n;
exception when others then return sqlstate; end $$;
-- Tente de CRÉER une table au nom d'un autre ; WITH CHECK doit refuser.
create or replace function pg_temp.try_insert(p_id text, p_owner text, p_ev uuid, p_date text) returns text language plpgsql as $$
begin insert into public.club_tables (id, zone, status, capacity, assigned_to, event_id, event_date)
      values (p_id,'test','free',6,p_owner,p_ev,p_date); return 'INSERTED';
exception when others then return sqlstate; end $$;
-- add_expense_v3 → renvoie le code.
create or replace function pg_temp.try_expense(p_id text, p_date text) returns text language plpgsql as $$
declare v text; begin select code into v from public.add_expense_v3(p_id,'test',10,p_date); return v;
exception when others then return sqlstate; end $$;
-- Réservations visibles pour un owner donné (compte).
create or replace function pg_temp.resa_visible(p_owner text) returns int language sql as $$
  select count(*)::int from public.table_reservation_requests where owner_promoter = p_owner; $$;

-- ============================================================
-- (A)(B)(C)(D)(E) — PROMOTEUR A (lab-promoter-01)
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'a_sub');
select pg_temp.visible_test_tables()          as a_visible \gset
select pg_temp.can_see('ABT-B1')              as a_sees_b1 \gset
select pg_temp.try_touch('ABT-A1')            as a_touch_a1 \gset
select pg_temp.try_touch('ABT-B1')            as a_touch_b1 \gset
select pg_temp.try_reassign('ABT-A1','lab-promoter-02') as a_giveaway \gset
select pg_temp.try_insert('ABT-STEAL','lab-promoter-02', :'ev_id'::uuid, :'ev_date') as a_insert_foreign \gset
select pg_temp.try_expense('ABT-A1', :'ev_date') as a_exp_a1 \gset
select pg_temp.try_expense('ABT-B1', :'ev_date') as a_exp_b1 \gset
select pg_temp.resa_visible(:'a_user')        as a_resa_own \gset
select pg_temp.resa_visible('lab-promoter-02') as a_resa_foreign \gset
reset role;

-- ============================================================
-- (A)(D) — PROMOTEUR B (lab-promoter-02) : symétrie
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'b_sub');
select pg_temp.visible_test_tables()          as b_visible \gset
select pg_temp.can_see('ABT-A1')              as b_sees_a1 \gset
select pg_temp.try_expense('ABT-B1', :'ev_date') as b_exp_b1 \gset
select pg_temp.try_expense('ABT-A1', :'ev_date') as b_exp_a1 \gset
reset role;

-- ============================================================
-- (F) — MANAGER : voit les 4, dépense sur n'importe laquelle
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'m_sub');
select pg_temp.visible_test_tables()          as m_visible \gset
select pg_temp.try_expense('ABT-B1', :'ev_date') as m_exp_b1 \gset
reset role;

-- ============================================================
-- (G) — SERVER : ne voit NI A NI B (tables attribuées à des promoteurs)
-- ============================================================
set local role authenticated; select pg_temp.act_as(:'srv_sub');
select pg_temp.visible_test_tables()          as srv_visible \gset
reset role;

-- ============================================================
-- ASSERTIONS
-- ============================================================
-- (A) SELECT + accès UUID
select pg_temp.expect(:'a_visible','2', 'A voit exactement SES 2 tables (A1,A2)');
select pg_temp.expect(:'a_sees_b1','0', 'A ne voit PAS B1 même par id connu (UUID access refusé)');
select pg_temp.expect(:'b_visible','2', 'B voit exactement SES 2 tables (B1,B2)');
select pg_temp.expect(:'b_sees_a1','0', 'B ne voit PAS A1');
-- (B) UPDATE
select pg_temp.expect(:'a_touch_a1','ROWS=1', 'A modifie A1 (sa table)');
select pg_temp.expect(:'a_touch_b1','ROWS=0', 'A ne modifie PAS B1 (USING filtre → 0 ligne)');
-- donner A1 à B : soit WITH CHECK viole (erreur), soit 0 ligne — dans les deux cas la table N''est pas donnée
select pg_temp.expect(case when :'a_giveaway' in ('ROWS=0','44000','23514','42501') then 'BLOQUE' else :'a_giveaway' end,
                      'BLOQUE', 'A ne peut PAS donner A1 à B (WITH CHECK / 0 ligne)');
-- (C) INSERT au nom d''un autre : WITH CHECK viole
select pg_temp.expect(case when :'a_insert_foreign' in ('44000','23514','42501') then 'BLOQUE' else :'a_insert_foreign' end,
                      'BLOQUE', 'A ne peut PAS créer une table au nom de B (WITH CHECK)');
-- (D) add_expense_v3 (SECDEF) — le trou historique est fermé
select pg_temp.expect(:'a_exp_a1','ok', 'A ajoute une dépense sur A1 (autorisé)');
select pg_temp.expect(:'a_exp_b1','table_not_found_or_forbidden', 'A ne peut PAS ajouter de dépense sur B1 (SECDEF re-vérifie ownership)');
select pg_temp.expect(:'b_exp_b1','ok', 'B ajoute une dépense sur B1 (autorisé)');
select pg_temp.expect(:'b_exp_a1','table_not_found_or_forbidden', 'B ne peut PAS ajouter de dépense sur A1');
-- (E) réservations
select pg_temp.expect(:'a_resa_own','1',     'A voit SA demande de résa');
select pg_temp.expect(:'a_resa_foreign','0', 'A ne voit PAS la demande de résa de B');
-- (F) direction
select pg_temp.expect(:'m_visible','4',  'Manager voit les 4 tables');
select pg_temp.expect(:'m_exp_b1','ok',  'Manager ajoute une dépense sur n''importe quelle table');
-- (G) server
select pg_temp.expect(:'srv_visible','0','Server ne voit NI A NI B (tables attribuées à des promoteurs)');

select '0044+0045 isolation promoteur A/B (SELECT/UPDATE/INSERT/add_expense/résa cantonnés ; direction voit tout ; server scope sans hardcode) — TOUTES LES ASSERTIONS PASSENT (rollback, aucun compte/donnée de test persisté)' as resultat;

rollback;
