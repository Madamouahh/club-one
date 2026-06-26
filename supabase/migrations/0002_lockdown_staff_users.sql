-- 0002_lockdown_staff_users.sql
-- À EXÉCUTER **APRÈS** avoir déployé le nouveau code (login via RPC) ET vérifié
-- que la connexion fonctionne en prod. Verrouille la table des identifiants : plus
-- aucune lecture/écriture directe depuis le client. La fonction verify_staff_login
-- (SECURITY DEFINER) continue de fonctionner.
--
-- ⚠️ Ne pas exécuter tant que l'ancien code (qui faisait `select * from staff_users`)
--    est encore en prod : cela casserait son login.

-- 1) Activer RLS sans aucune policy => deny par défaut pour anon/authenticated.
alter table public.staff_users enable row level security;

-- 2) Retirer les droits directs (ceinture + bretelles avec RLS).
revoke all on public.staff_users from anon, authenticated;

-- 3) Une fois la nouvelle auth validée, supprimer l'ancienne colonne en clair.
--    Décommente APRÈS avoir confirmé que tous les password_hash sont remplis.
-- alter table public.staff_users drop column if exists password;

-- Vérif : ceci doit désormais renvoyer une erreur de permission depuis la clé anon,
-- mais select public.verify_staff_login('maxime','<mauvais mdp>') doit renvoyer 0 ligne sans erreur.
