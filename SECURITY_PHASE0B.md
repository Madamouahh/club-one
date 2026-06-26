# Phase 0b — Identité réelle + RLS · Runbook

But : fermer définitivement la lecture/écriture **anonyme** de la base (l'audit a montré que TOUTES les tables étaient ouvertes en lecture ET écriture à anon). On donne au staff une identité Supabase Auth, puis on active la RLS partout.

> ⚠️ À faire **hors soirée**, avec une **sauvegarde** récente (Supabase → Database → Backups).
> L'ordre est critique : appliquer la RLS **avant** d'avoir déployé le code casserait l'app.

## Pré-vol
- Code Phase 0b prêt sur la branche `security/phase0b` (login via Supabase Auth, page `/invite` via RPC `get_invite`).
- Supabase → Authentication → Providers : **Email activé** (par défaut). Les comptes sont créés pré-confirmés par le script, donc « Confirm email » peut rester activé.

## Étape 1 — Créer les comptes Auth + roter les mots de passe
1. `cp scripts/staff-passwords.example.json scripts/staff-passwords.local.json`
2. Renseigner un **nouveau mot de passe fort** par membre (rotation des anciens, compromis).
3. Lancer (clé service_role depuis Supabase → Settings → API) :
   ```bash
   SUPABASE_URL="https://xsotmjnaffaibgqgookt.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="<service_role>" \
   node scripts/seed-auth-users.mjs
   ```
   → crée un user Auth `<username>@clubone.local` par membre et remplit `staff_users.auth_id`.
   Idempotent (relançable). Ne révèle aucun mot de passe.
4. Vérifier dans Supabase → Authentication → Users que les 10 comptes existent, et
   `select username, auth_id from staff_users;` → tous les `auth_id` remplis.

## Étape 2 — Déployer le code (l'app passe en authentifié)
1. Merger `security/phase0b` puis push → Vercel redéploie.
2. La RLS n'est pas encore activée : anon **et** authentifié fonctionnent. L'app, elle, se connecte
   désormais en authentifié.
3. **Tester la connexion** avec un compte de **chaque rôle** (admin, manager, server, security,
   security_counter, promoter) : login OK, bon onglet par défaut, plan/réservations/flux visibles.
4. Tester la page publique `/invite/<token>` d'une invitation existante : elle doit s'afficher
   (elle passe par la RPC `get_invite`).

## Étape 3 — Activer la RLS (ferme l'accès anonyme)
1. Exécuter `supabase/migrations/0003_phase0b_identity_and_rls.sql` dans le SQL Editor.
2. Vérifier **avec la clé anon** (doit échouer / 0 ligne) :
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: <ANON>" -H "Authorization: Bearer <ANON>" \
     "https://xsotmjnaffaibgqgookt.supabase.co/rest/v1/club_tables?select=id&limit=1"   # attendu: 401/empty
   ```
3. Vérifier que **l'app authentifiée** lit/écrit toujours (faire une vraie action en soirée test).
4. Vérifier `/invite/<token>` encore OK (RPC anon get_invite).

## Étape 4 — Nettoyage (après validation)
- `alter table public.staff_users drop column if exists password;` (l'ancienne colonne en clair
  n'est plus utilisée — l'auth est dans `auth.users`). Voir aussi 0002.
- Les fonctions `verify_staff_login` / `set_staff_password` (Lot 0, approche intermédiaire) sont
  **superseded** par Supabase Auth : tu peux les `drop function` si tu ne t'en sers pas.

## Rollback
- Étapes 1–2 sont additives (création de comptes + déploiement). En cas de souci de login après
  déploiement : re-déployer le commit précédent.
- Étape 3 est la seule qui ferme l'accès : pour revenir en arrière temporairement,
  `alter table <t> disable row level security;` sur la table concernée (réouvre — à n'utiliser
  qu'en secours, ça réexpose la donnée).

## Revue de sécurité adversariale (3 angles) — verdict GO_AVEC_CORRECTIFS

Une revue automatique (attaquant anonyme / staff bas-privilège / correction-disponibilité) a été passée. **Correctifs déjà appliqués dans cette branche :**
- 🔴 **Bug critique de disponibilité corrigé** : sous RLS, les données étaient chargées *avant* authentification → écran vide après login. Désormais le chargement des données + l'abonnement realtime se font **après** authentification (`useEffect` gardé par `currentUser`). Corrige aussi la closure realtime figée sur la soirée active (via `activeEventDateRef`).
- **Token QR cryptographique** : `createQrToken` utilise `crypto.randomUUID()` (≈122 bits) au lieu de `Date.now()+Math.random()` → plus d'énumération/brute-force des invitations via `get_invite`.
- **Anti-usurpation des journaux** : `entry_logs_insert` impose `staff_username = current_staff_username()` (on ne journalise que sous sa propre identité).
- **Homogénéité des droits** : `current_staff_role()` et `current_staff_username()` ont `revoke from public` + `grant to authenticated`.
- **Filet anti-anon** : `revoke all on all tables in schema public from anon` (couvre toute table oubliée/future) + requête de contrôle d'exhaustivité.

**À TESTER plus tard (non appliqué — risque de casser la validation QR / le module promoteur sans test live) :**
- Lecture horizontale : `pc_read` / `pge_read` sont `using (true)` → tout staff lit tous les contacts/invités (téléphone compris). Restreindre par rôle/promoteur (voir bloc commenté « DURCISSEMENT À TESTER » dans `0003`), après avoir prévu une RPC dédiée pour que `security_counter` valide encore un QR par token.
- **Tokens QR legacy** : les ~8 invitations existantes ont des tokens non-crypto (devinables). Faibles en volume ; elles s'éteignent avec leur soirée. Optionnel : les régénérer.
- Rate-limit applicatif sur `get_invite` (anti-brute-force) — via Edge Function / WAF.

## Pourquoi ce design
- L'app utilisait la clé **anon** (publique) pour tout → la base ne pouvait distinguer l'app d'un
  attaquant. Avec Supabase Auth, chaque requête porte un **JWT** ; la RLS applique alors les droits
  par rôle. La page `/invite` reste anonyme mais ne peut lire qu'**une** invitation via une RPC
  `SECURITY DEFINER`, au lieu de toute la table.
