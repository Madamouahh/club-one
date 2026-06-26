# Lot 0 — Sécurité Club One · Runbook d'application

Objectif : supprimer l'exposition des mots de passe et poser des bases d'auth saines,
**sans interrompre l'app pendant une soirée**. Ordre à respecter.

## Ce qui a déjà été fait (côté code, dans ce dépôt)
- `app/page.tsx` : suppression de `STAFF_FALLBACK` (mots de passe en dur) → remplacé par un
  annuaire d'affichage sans secret (`STAFF_DIRECTORY`).
- `app/page.tsx` : `login()` n'utilise plus de comparaison côté client ni `select * from staff_users`.
  Il appelle la fonction base `verify_staff_login` (mots de passe hashés, aucun secret renvoyé).
- Migrations SQL fournies dans `supabase/migrations/`.

> ⚠️ **Ne pas déployer le code seul.** Le nouveau login échouera tant que la fonction
> `verify_staff_login` n'existe pas en base. Suivre l'ordre ci-dessous.

## Étape A — Hors-ligne / immédiat (à faire par le propriétaire)
1. **Considérer tous les anciens mots de passe comme compromis** (ils étaient publics dans le code et l'historique git).
2. **Passer le dépôt GitHub en privé** s'il est public.
3. (Recommandé) Nettoyer l'historique git des secrets (ex. `git filter-repo`) ou, a minima,
   acter que ces mots de passe ne seront plus jamais réutilisés.

## Étape B — Base (éditeur SQL Supabase)
1. Exécuter `supabase/migrations/0000_inspect_schema.sql` (lecture seule) et vérifier :
   - le type de `staff_users.id` (uuid ou text) ;
   - s'il existe une contrainte unique sur `username` ;
   - l'état RLS actuel.
2. Exécuter `supabase/migrations/0001_auth_hashing.sql` (additif, sans risque).
3. Si certains comptes n'existaient que dans l'ancien fallback (maxime, jerome, …) et ne sont
   pas dans `staff_users`, les **insérer** (bloc 6 du fichier, à adapter au schéma réel).
4. **Définir les NOUVEAUX mots de passe** (bloc 7) :
   `select public.set_staff_password('maxime', '<nouveau mdp fort>');` pour chaque membre.
5. Vérifier : `select public.verify_staff_login('maxime', '<le nouveau mdp>');`
   → doit renvoyer 1 ligne (id, username, role, full_name). Un mauvais mdp → 0 ligne.

## Étape C — Déploiement du code
1. Revoir le diff `app/page.tsx`, puis commit + push sur `main` (Vercel redéploie).
2. **Tester la connexion en prod** avec un compte de chaque rôle. Vérifier la redirection
   d'onglet (security → sécurité, security_counter → flux, autres → plan).

## Étape D — Verrouillage de la table des identifiants
1. Une fois le login prod confirmé, exécuter `supabase/migrations/0002_lockdown_staff_users.sql`.
2. Vérifier qu'une lecture directe `select * from staff_users` via la clé anon est désormais
   refusée, tandis que `verify_staff_login` fonctionne toujours.
3. Quand tous les `password_hash` sont remplis, décommenter le `drop column password` (fin de 0002).

## Étape E — RLS des tables opérationnelles (Phase 0b, plus tard, hors soirée)
`supabase/migrations/0003_rls_operational_tables.PHASE0b.sql` **ne s'applique pas en l'état** :
il exige d'abord une vraie identité (Supabase Auth). Voir l'en-tête du fichier. À planifier
sur un projet de staging, hors service, avec test des 6 rôles et de la page publique `/invite`.

## Rollback
- Étapes B/C sont additives : en cas de souci de login, on peut temporairement re-déployer
  l'ancien commit (le temps de corriger), car `0001` n'a rien supprimé.
- Ne PAS lancer `0002` (lockdown) ni le `drop column` tant que C n'est pas validé : ce sont les
  seules étapes non triviales à inverser.

## Reste ouvert (suivi)
- `verify_staff_login` est appelable par anon (comme tout endpoint de login) → prévoir un
  **rate-limiting** anti-brute-force (Edge Function ou WAF) en suivi.
- Cadrage **RGPD** des PII clients/invités (durée de conservation, accès) — à traiter avec le CRM.
