-- ============================================================================
-- Club One — Rehearsal seed + bootstrap (CLONE ONLY, applied after 0008)
--
-- 100% synthetic data. NO production PII/credentials copied. Passwords are
-- placeholders (login is not exercised; roles are tested via jwt-claims
-- impersonation, which enforces real RLS under the `authenticated` role).
--
-- Purpose: satisfy 0009's hard preconditions (bootstrapped active event, 18
-- event-scoped tables, every staff auth_id matching auth.users, valid roles,
-- event-scoped entry_logs / invitations) AND provide a role matrix to test.
--
-- Fixed auth_id uuids for easy impersonation in the test phase:
--   admin=...01 manager=...02 promoter1=...03 promoter2=...04
--   jeremy(server)=...05 server2=...06 security=...07 counter=...08
-- ============================================================================

-- 1) auth.users (minimal: only id/is_sso_user/is_anonymous are NOT NULL)
insert into auth.users (id, aud, role, email, is_sso_user, is_anonymous) values
  ('00000000-0000-0000-0000-000000000001','authenticated','authenticated','admin@rehearsal.test',false,false),
  ('00000000-0000-0000-0000-000000000002','authenticated','authenticated','manager@rehearsal.test',false,false),
  ('00000000-0000-0000-0000-000000000003','authenticated','authenticated','promoter1@rehearsal.test',false,false),
  ('00000000-0000-0000-0000-000000000004','authenticated','authenticated','promoter2@rehearsal.test',false,false),
  ('00000000-0000-0000-0000-000000000005','authenticated','authenticated','jeremy@rehearsal.test',false,false),
  ('00000000-0000-0000-0000-000000000006','authenticated','authenticated','server2@rehearsal.test',false,false),
  ('00000000-0000-0000-0000-000000000007','authenticated','authenticated','security@rehearsal.test',false,false),
  ('00000000-0000-0000-0000-000000000008','authenticated','authenticated','counter@rehearsal.test',false,false)
on conflict (id) do nothing;

-- 2) staff_users (roles cover all 6 distinct prod roles + 2nd promoter/server)
insert into public.staff_users (id, username, password, role, full_name, auth_id) values
  (gen_random_uuid(),'admin',    'x','admin',           'Admin Test',    '00000000-0000-0000-0000-000000000001'),
  (gen_random_uuid(),'manager',  'x','manager',         'Manager Test',  '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid(),'promoter1','x','promoter',        'Promoter One',  '00000000-0000-0000-0000-000000000003'),
  (gen_random_uuid(),'promoter2','x','promoter',        'Promoter Two',  '00000000-0000-0000-0000-000000000004'),
  (gen_random_uuid(),'jeremy',   'x','server',          'Jeremy Server', '00000000-0000-0000-0000-000000000005'),
  (gen_random_uuid(),'server2',  'x','server',          'Server Two',    '00000000-0000-0000-0000-000000000006'),
  (gen_random_uuid(),'security', 'x','security',        'Security Test', '00000000-0000-0000-0000-000000000007'),
  (gen_random_uuid(),'counter',  'x','security_counter','Counter Test',  '00000000-0000-0000-0000-000000000008')
on conflict (username) do nothing;

-- 3) venues (3)
insert into public.venues (id, name, kind, tagline, sort_order) values
  ('eden','Eden','club','Main room',0),
  ('rooftop','Rooftop','bar','Open air',1),
  ('lounge','Lounge','lounge','Chill',2)
on conflict (id) do nothing;

-- 4) events: ev1 (today, published) = bootstrap target; ev2 (+7, draft) = next
insert into public.events (id, venue_id, title, slug, event_date, status) values
  ('11111111-1111-1111-1111-111111111111','eden','Soiree Test A','soiree-a',current_date,'published'),
  ('22222222-2222-2222-2222-222222222222','eden','Soiree Test B','soiree-b',current_date + 7,'draft')
on conflict (id) do nothing;

-- 5) 18 club_tables (all free/empty). assigned_to designed for server-scope test:
--    T01->jeremy, T02->server (server SEES), T03->promoter1, T04->manager (server MUST NOT see), rest '' (server sees).
insert into public.club_tables (id, zone, status, capacity, assigned_to)
select 'T' || lpad(g::text,2,'0'),
       case when g <= 9 then 'Carre Or' else 'Mezzanine' end,
       'free', 6,
       case g when 1 then 'jeremy' when 2 then 'server' when 3 then 'promoter1' when 4 then 'manager' else '' end
from generate_series(1,18) g
on conflict (id) do nothing;

-- 6) promoter_contacts (one per promoter)
insert into public.promoter_contacts (id, promoter_username, first_name, last_name, phone) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1','promoter1','Contact','Un','0600000001'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2','promoter2','Contact','Deux','0600000002')
on conflict (id) do nothing;
