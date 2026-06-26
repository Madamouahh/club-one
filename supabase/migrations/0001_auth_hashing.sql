-- 0001_auth_hashing.sql
-- SÛR & ADDITIF : peut être exécuté à tout moment, ne casse pas l'app existante.
-- Met en place l'authentification à mots de passe HASHÉS (bcrypt / pgcrypto)
-- vérifiée côté base, sans jamais renvoyer de secret au navigateur.
--
-- Prérequis : avoir exécuté 0000_inspect_schema.sql et vérifié le type de staff_users.id.

-- 1) Extension de hachage
create extension if not exists pgcrypto;

-- 2) Colonne de hash (on garde l'ancienne colonne `password` le temps de la bascule ;
--    elle sera supprimée en 0002 une fois la nouvelle auth validée en prod).
alter table public.staff_users add column if not exists password_hash text;

-- 3) Définir / faire tourner un mot de passe (bcrypt, coût 12).
--    À n'exécuter QUE depuis l'éditeur SQL Supabase (jamais exposé au client).
create or replace function public.set_staff_password(p_username text, p_new_password text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.staff_users
     set password_hash = crypt(p_new_password, gen_salt('bf', 12))
   where lower(username) = lower(p_username);
$$;

-- 4) Vérifier un login. SECURITY DEFINER : lit staff_users même quand la table
--    est verrouillée par RLS (0002). Ne renvoie AUCUN secret, jamais le hash.
--    `id::text` pour fonctionner que la colonne soit uuid ou text.
create or replace function public.verify_staff_login(p_username text, p_password text)
returns table (id text, username text, role text, full_name text)
language sql
security definer
set search_path = public
as $$
  select s.id::text, s.username, s.role, s.full_name
    from public.staff_users s
   where lower(s.username) = lower(p_username)
     and s.password_hash is not null
     and s.password_hash = crypt(p_password, s.password_hash);
$$;

-- 5) Exposition PostgREST : le client (clé anon) doit pouvoir appeler verify_staff_login,
--    mais PAS set_staff_password.
revoke all on function public.set_staff_password(text, text) from anon, authenticated;
grant execute on function public.verify_staff_login(text, text) to anon, authenticated;

-- 6) (Optionnel) S'assurer que les 10 comptes connus existent.
--    Décommente et adapte si certains n'existaient que dans l'ancien fallback en dur.
--    NB : adapte selon que staff_users.id est généré automatiquement ou non.
-- insert into public.staff_users (username, role, full_name) values
--   ('maxime','admin','Maxime'),
--   ('jerome','admin','Jérôme'),
--   ('anthony','admin','Anthony'),
--   ('enguerrand','manager','Enguerrand'),
--   ('jeremy','server','Jeremy'),
--   ('hanass','security','Hanass'),
--   ('mohamed','security_counter','Mohamed'),
--   ('mathias','promoter','Mathias'),
--   ('quentin','promoter','Quentin'),
--   ('lawrence','promoter','Lawrence')
-- on conflict (username) do nothing;   -- nécessite un index/contrainte unique sur username

-- 7) ROTATION OBLIGATOIRE des mots de passe compromis (ils étaient publics dans le code).
--    Remplace chaque '...' par un NOUVEAU mot de passe fort. Ne réutilise pas les anciens.
-- select public.set_staff_password('maxime',     '...');
-- select public.set_staff_password('jerome',     '...');
-- select public.set_staff_password('anthony',    '...');
-- select public.set_staff_password('enguerrand', '...');
-- select public.set_staff_password('jeremy',     '...');
-- select public.set_staff_password('hanass',     '...');
-- select public.set_staff_password('mohamed',    '...');
-- select public.set_staff_password('mathias',    '...');
-- select public.set_staff_password('quentin',    '...');
-- select public.set_staff_password('lawrence',   '...');
