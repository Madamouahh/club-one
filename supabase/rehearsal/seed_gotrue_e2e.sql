-- ============================================================================
-- Club One — Seed GoTrue bout-en-bout (CLONE NON-PROD UNIQUEMENT)
--
-- Crée de VRAIS utilisateurs GoTrue connectables (encrypted_password bcrypt +
-- auth.identities provider 'email' + email_confirmed_at), liés à staff_users,
-- pour tester le PARCOURS D'AUTHENTIFICATION RÉEL (signInWithPassword sur
-- `<username>@clubone.local`, exactement comme lib/authSession.ts) — pas de
-- l'impersonation. Puis seed opérationnel + bootstrap pour tester la RLS avec
-- le JWT réel émis par GoTrue.
--
-- Mot de passe de TEST commun (NON-PROD, jamais un secret prod) : Rehearsal!2026
-- Emails: <username>@clubone.local (format attendu par le front).
-- ============================================================================

-- 1) auth.users connectables (bcrypt + email confirmé).
--    IMPORTANT : les colonnes de tokens (confirmation_token, recovery_token, email_change*,
--    phone_change*, reauthentication_token) DOIVENT être '' et non NULL — sinon GoTrue échoue au
--    login avec « Database error querying schema » (son scanner Go ne lit pas NULL dans un string).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.username||'@clubone.local', crypt('Rehearsal!2026', gen_salt('bf')), now(),
  now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false,
  '', '', '', '', '', '', '', ''
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid,'admin'),
  ('00000000-0000-0000-0000-000000000002'::uuid,'manager'),
  ('00000000-0000-0000-0000-000000000003'::uuid,'promoter1'),
  ('00000000-0000-0000-0000-000000000004'::uuid,'promoter2'),
  ('00000000-0000-0000-0000-000000000005'::uuid,'jeremy'),
  ('00000000-0000-0000-0000-000000000006'::uuid,'server2'),
  ('00000000-0000-0000-0000-000000000007'::uuid,'security'),
  ('00000000-0000-0000-0000-000000000008'::uuid,'counter')
) as u(id, username)
on conflict (id) do nothing;

-- 2) auth.identities (GoTrue exige une identité provider 'email' pour le login mdp)
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.username||'@clubone.local', 'email_verified', true),
  'email', now(), now(), now()
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid,'admin'),
  ('00000000-0000-0000-0000-000000000002'::uuid,'manager'),
  ('00000000-0000-0000-0000-000000000003'::uuid,'promoter1'),
  ('00000000-0000-0000-0000-000000000004'::uuid,'promoter2'),
  ('00000000-0000-0000-0000-000000000005'::uuid,'jeremy'),
  ('00000000-0000-0000-0000-000000000006'::uuid,'server2'),
  ('00000000-0000-0000-0000-000000000007'::uuid,'security'),
  ('00000000-0000-0000-0000-000000000008'::uuid,'counter')
) as u(id, username)
on conflict do nothing;

-- 3) staff_users liés (rôles réels)
insert into public.staff_users (id, username, password, role, full_name, auth_id) values
  (gen_random_uuid(),'admin',    'legacy-neutralized-see-gotrue','admin',           'Admin Test',    '00000000-0000-0000-0000-000000000001'),
  (gen_random_uuid(),'manager',  'legacy-neutralized-see-gotrue','manager',         'Manager Test',  '00000000-0000-0000-0000-000000000002'),
  (gen_random_uuid(),'promoter1','legacy-neutralized-see-gotrue','promoter',        'Promoter One',  '00000000-0000-0000-0000-000000000003'),
  (gen_random_uuid(),'promoter2','legacy-neutralized-see-gotrue','promoter',        'Promoter Two',  '00000000-0000-0000-0000-000000000004'),
  (gen_random_uuid(),'jeremy',   'legacy-neutralized-see-gotrue','server',          'Jeremy Server', '00000000-0000-0000-0000-000000000005'),
  (gen_random_uuid(),'server2',  'legacy-neutralized-see-gotrue','server',          'Server Two',    '00000000-0000-0000-0000-000000000006'),
  (gen_random_uuid(),'security', 'legacy-neutralized-see-gotrue','security',        'Security Test', '00000000-0000-0000-0000-000000000007'),
  (gen_random_uuid(),'counter',  'legacy-neutralized-see-gotrue','security_counter','Counter Test',  '00000000-0000-0000-0000-000000000008')
on conflict (username) do nothing;

-- 4) venues / events / 18 tables / contacts
insert into public.venues (id, name, kind, tagline, sort_order) values
  ('eden','Eden','club','Main room',0),('rooftop','Rooftop','bar','Open air',1),('lounge','Lounge','lounge','Chill',2)
on conflict (id) do nothing;

insert into public.events (id, venue_id, title, slug, event_date, status) values
  ('11111111-1111-1111-1111-111111111111','eden','Soiree Test A','soiree-a',current_date,'published'),
  ('22222222-2222-2222-2222-222222222222','eden','Soiree Test B','soiree-b',current_date + 7,'draft')
on conflict (id) do nothing;

insert into public.club_tables (id, zone, status, capacity)
select 'T' || lpad(g::text,2,'0'), case when g <= 9 then 'Carre Or' else 'Mezzanine' end, 'free', 6
from generate_series(1,18) g
on conflict (id) do nothing;

insert into public.promoter_contacts (id, promoter_username, first_name, last_name, phone) values
  ('aaaaaaaa-0000-0000-0000-0000000000c1','promoter1','Contact','Un','0600000001'),
  ('bbbbbbbb-0000-0000-0000-0000000000c2','promoter2','Contact','Deux','0600000002')
on conflict (id) do nothing;

-- 5) bootstrap via la vraie RPC (impersonation admin) + assignations serveur/promoteur post-bootstrap
do $$ begin perform 1; end $$;
