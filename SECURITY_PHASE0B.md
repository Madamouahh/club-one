# Phase 0b - Supabase Auth et cutover RLS

But : donner au staff une identite Supabase Auth reelle, deployer les RPC necessaires au front Auth et aux operations atomiques, puis fermer les acces anonymes directs aux tables internes.

Ne jamais executer ces etapes pendant une soiree active. Ne jamais afficher ni committer de mot de passe, de cle Supabase ou de fichier local de secrets.

## Prerequis

- Branche `security/phase0b` relue.
- Sauvegarde Supabase recente et procedure de restauration identifiee.
- Variables front disponibles : `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Supabase Auth Email active.
- Inscriptions publiques Supabase Auth desactivees ou controlees par procedure interne. Cette configuration est obligatoire humainement, mais la securite ne repose pas seulement dessus : les policies refusent aussi tout utilisateur Auth non lie a `staff_users.auth_id`.
- Cle `SUPABASE_SERVICE_ROLE_KEY` disponible uniquement pour l'operateur du seed.
- `scripts/staff-passwords.local.json` ignore par Git.

## Ordre complet obligatoire

1. Sauvegarder la base.
2. Appliquer `0003` non destructive : Auth prep + pont RLS transitoire.
3. Executer le pre-vol Phase A.
4. Creer et lier les 10 comptes Auth.
5. Verifier les 10 liaisons.
6. Tester les 10 connexions localement et sur Vercel Preview.
7. Appliquer les migrations additives `0004`, `0005`, `0006`, `0007` si elles sont absentes.
8. Executer la verification des operations atomiques.
9. Deployer le front Auth et atomique en production pendant que les anciens acces anon existent encore.
10. Tester immediatement les six roles et les fonctions critiques.
11. Appliquer `0008` pour fermer les acces anonymes.
12. Executer la verification post-cutover.
13. Refaire les tests fonctionnels complets.
14. Utiliser le rollback uniquement en cas de blocage immediat.

Le front doit etre deploye apres la creation des comptes Auth et apres la presence des RPC `get_my_profile`, `add_expense_v2` et `check_in_invitation`, mais avant le cutover `0008`. Ainsi, il peut etre teste pendant que l'ancien acces anon reste temporairement disponible. Il fonctionne avant `0008` uniquement grace aux policies RLS transitoires de `0003` et aux policies de `0004` pour `venues/events`. Si le front etait deploye seulement apres `0008`, un probleme de session, de role ou de RPC bloquerait immediatement l'exploitation sans filet de compatibilite.

## Phase A - preparation Auth non destructive

1. Appliquer `supabase/migrations/0003_phase0b_identity_and_rls.sql`.
   - Ajoute `public.staff_users.auth_id`.
   - Cree `current_staff_role()`.
   - Cree `current_staff_username()`.
   - Cree `get_my_profile()`.
   - Cree ou remplace `get_invite(text)`.
   - Active une RLS transitoire sur les tables operationnelles existantes.
   - Conserve temporairement l'ancien front anon via des policies anon strictement nommees `co_phase0b_anon_*`.
   - Ajoute des policies authenticated `co_phase0b_auth_*` qui exigent un staff lie via `auth.uid()`.
   - Ne donne aucun acces direct a `staff_users`.
2. Executer `supabase/verification/phase0b_auth_preflight.sql` dans le SQL Editor.
3. Copier `scripts/staff-passwords.example.json` vers `scripts/staff-passwords.local.json`.
4. Remplir un nouveau mot de passe fort pour chaque compte staff.
5. Executer le seed depuis PowerShell :

   ```powershell
   $env:SUPABASE_URL="https://TON-PROJET.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY="CLE_SERVICE_ROLE"
   node .\scripts\seed-auth-users.mjs
   Remove-Item Env:SUPABASE_URL
   Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
   ```

6. Si un reset explicite des comptes Auth existants est necessaire, utiliser uniquement :

   ```powershell
   $env:SUPABASE_URL="https://TON-PROJET.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY="CLE_SERVICE_ROLE"
   node .\scripts\seed-auth-users.mjs --reset-existing-passwords
   Remove-Item Env:SUPABASE_URL
   Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
   ```

7. Verifier que les 10 comptes Auth existent et que les 10 lignes `staff_users.auth_id` sont remplies.
8. Tester les 10 connexions localement et sur Vercel Preview.

## Migrations additives avant front

Appliquer `0004`, `0005`, `0006`, `0007` si elles sont absentes, dans cet ordre.

- `0004` ajoute le modele `venues/events` et `public_events()`.
- `0005` conserve la RPC historique `add_expense(text,text,numeric,text)`.
- `0006` ajoute `check_in_invitation(text,text)`.
- `0007` ajoute `add_expense_v2(text,text,numeric,text)`.

Ensuite, executer `supabase/verification/atomic_operations_verification.sql` sur l'environnement de test ou de preproduction. Le front Auth et atomique ne doit etre deploye en production qu'apres presence de `get_my_profile`, `add_expense_v2` et `check_in_invitation`.

## Pont RLS transitoire

Avant `0008`, le role PostgreSQL `authenticated` ne beneficie pas automatiquement des droits du role `anon`. `0003` met donc en place un pont RLS transitoire : les privileges de table existent, mais les policies `authenticated` refusent tout utilisateur Auth dont `auth.uid()` ne correspond pas a `staff_users.auth_id`.

- `club_tables` : `SELECT`, `INSERT`, `UPDATE`.
- `entry_logs` : `SELECT`, `INSERT`.
- `promoter_contacts` : `SELECT`, `INSERT`.
- `promoter_guest_entries` : `SELECT`, `INSERT`, `UPDATE`.
- `event_archives` : `INSERT`.

`0004` accorde ensuite `SELECT` sur `venues` et `SELECT`, `INSERT`, `UPDATE`, `DELETE` sur `events`, avec des policies qui exigent aussi un staff lie. Cette periode doit etre tres courte : le pont ne remplace pas le cutover final, il permet seulement de tester le front Auth et les RPC `SECURITY INVOKER` avant que `0008` supprime les policies anon transitoires et applique la vraie separation finale par role.

## Deploiement front avant cutover

Deployer le front Auth et atomique en production tant que les anciens acces anon existent encore. Tester immediatement :

- `admin`
- `manager`
- `server`
- `security`
- `security_counter`
- `promoter`

Verifier aussi le plan, les reservations, les groupes, les depenses atomiques, la validation QR, la page `/invite/<token>` et le realtime.

## Phase B - cutover RLS

1. Confirmer la sauvegarde recente.
2. Confirmer une fenetre hors soiree.
3. Appliquer `supabase/migrations/0008_phase0b_rls_cutover.sql`.
   - La migration est transactionnelle.
   - La garde bloque avant toute modification de RLS ou permission.
   - `staff_users` ne devient jamais lisible directement.
   - L'invitation publique reste disponible uniquement via `get_invite(text)`.
4. Executer `supabase/verification/phase0b_post_cutover_verification.sql`.
5. Refaire les tests fonctionnels complets.
6. Utiliser `supabase/rollback/0008_phase0b_rls_cutover_emergency.sql` seulement en cas de blocage immediat.

## Compatibilite migrations

- `0003` fournit `current_staff_role()`, `current_staff_username()`, `get_my_profile()` et `get_invite(text)`.
- `0004` fonctionne apres `0003`, car `current_staff_role()` existe.
- `0005` reste historique et ne depend pas du front Phase 0b.
- `0006` fonctionne apres `0003`, car il utilise les helpers staff.
- `0007` fonctionne apres `0003`, car il utilise les helpers staff.
- `0008` est appliquee en dernier.
- `0008` ne modifie pas les signatures des RPC atomiques.
- Le front deploye trouve `get_my_profile`, `add_expense_v2` et `check_in_invitation`.

## Rollback

La Phase A est additive : en cas de probleme, ne pas appliquer `0008`.

La Phase B ferme les acces anonymes directs. En cas d'incident bloquant immediat, executer `supabase/rollback/0008_phase0b_rls_cutover_emergency.sql`. Ce rollback est temporaire et constitue une regression de securite : il rouvre les tables operationnelles minimales mais garde `staff_users` inaccessible directement.

## Nettoyage futur

La colonne legacy `staff_users.password` ne doit pas etre supprimee dans ce lot. Sa suppression doit faire l'objet d'une migration future, uniquement apres :

1. creation des comptes Auth ;
2. validation des 10 connexions ;
3. stabilisation du nouveau login ;
4. sauvegarde recente ;
5. procedure de retour arriere validee.
