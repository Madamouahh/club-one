# Deploiement Supabase - operations atomiques

Objectif : preparer puis appliquer, hors production directe, les migrations liees aux depenses atomiques et au check-in QR atomique.

Migrations concernees :

1. `supabase/migrations/0005_atomic_expense.sql`
2. `supabase/migrations/0006_check_in_invitation.sql`
3. `supabase/migrations/0007_atomic_operations_hardening.sql`

Ne jamais appliquer ces migrations pendant une soiree active. Ne jamais les appliquer sans sauvegarde recente et pre-vol lisible.

## 1. Prerequis

- Branche relue : `security/phase0b`.
- Commit front pret : `e7e5ff3 fix: make table expenses and QR check-in atomic`.
- Variables Vercel/Supabase deja en place pour l'application.
- Acces Supabase SQL Editor avec un role autorise a lire le schema et appliquer des migrations.
- Confirmation que le front actuel en production peut continuer a fonctionner avant le deploiement front :
  - `0005` ajoute seulement `add_expense`.
  - `0006` ajoute `check_in_invitation` et un index unique QR.
  - `0007` ajoute `add_expense_v2`.

## 2. Sauvegarde

Avant toute intervention :

1. Ouvrir Supabase Dashboard.
2. Aller dans Database / Backups.
3. Verifier qu'une sauvegarde recente existe.
4. Declencher une sauvegarde manuelle si le plan Supabase le permet.
5. Noter l'heure exacte de sauvegarde, le projet, et la branche/environnement cible.

Arreter si aucune strategie de restauration n'est disponible.

## 3. Base de test

Utiliser d'abord un projet Supabase de test ou une copie non-production :

1. Copier le schema et un jeu de donnees representatif.
2. Verifier que les comptes staff et `staff_users.auth_id` existent.
3. Verifier que les roles staff couvrent les six roles : `admin`, `manager`, `server`, `security`, `security_counter`, `promoter`.
4. Ne jamais utiliser une soiree en cours comme environnement de test.

## 4. Executer le pre-vol lecture seule

Dans Supabase SQL Editor, coller et executer :

`supabase/verification/atomic_operations_preflight.sql`

Ce script est volontairement en lecture seule. Il ne contient pas d'instruction de modification de base.

Conserver les resultats complets de toutes les sections numerotees.

## 5. Interpreter les resultats

Sections attendues :

- `01_expected_tables` : toutes les tables doivent etre `ok`.
- `02_expected_columns` : toutes les colonnes attendues doivent etre `ok`, sauf les fonctions non encore presentes traitees plus bas.
- `03_expenses_column_type` : `club_tables.expenses` doit etre `jsonb`.
- `04_existing_functions` : doit lister les helpers staff et les RPC deja presentes.
- `05_function_presence_matrix` :
  - `current_staff_username` : present.
  - `current_staff_role` : present.
  - `add_expense` : present apres `0005`, absent avant `0005` sur une base non migree.
  - `add_expense_v2` : absent avant `0007`, present apres `0007`.
  - `check_in_invitation` : absent avant `0006`, present apres `0006`.
- `06_routine_execute_privileges` : les RPC sensibles doivent etre executables par `authenticated`, pas par `PUBLIC`.
- `07_rls_enabled` : RLS active sur `club_tables`, `promoter_guest_entries`, `entry_logs`, `staff_users`.
- `08_rls_policies` : verifier que les policies correspondent aux roles attendus.
- `09_staff_roles_present` : verifier les roles staff reels.
- `10_staff_auth_id_summary` : `missing_auth_id` doit etre 0 avant test authentifie.
- `11_qr_quality_summary` : noter les QR nuls, vides et `checked_in` null.
- `12_qr_duplicate_non_empty_tokens` : doit etre vide.
- `13_qr_token_indexes` : apres `0006`, doit montrer `promoter_guest_entries_qr_token_unique_idx`.
- `14_expenses_quality_summary` : `expenses_not_json_array` doit etre 0.
- `15_expenses_incompatible_rows` : doit etre vide.
- `16_blocking_summary` : toutes les lignes doivent etre `ok`.

## 6. Arret immediat

Arreter avant toute migration si un de ces points apparait :

- Table obligatoire absente.
- Colonne obligatoire absente.
- `club_tables.expenses` absent ou type different de `jsonb`.
- Ligne `expenses` non null dont le type JSON n'est pas un tableau.
- Doublons de `qr_token` non vides.
- Helpers `public.current_staff_username()` ou `public.current_staff_role()` absents.
- `staff_users.auth_id` absent ou staff sans `auth_id`.
- RLS inactive sur une table cible.
- Policies RLS incoherentes avec les roles attendus.
- Signature existante incompatible pour une RPC cible.
- Incertitude sur la sauvegarde ou la possibilite de restauration.

## 7. Ordre exact des migrations

Sur base de test uniquement d'abord :

1. Appliquer `0005_atomic_expense.sql`.
2. Appliquer `0006_check_in_invitation.sql`.
3. Appliquer `0007_atomic_operations_hardening.sql`.

Ne pas inverser `0006` et `0007` si le plan de verification attend les deux fonctions atomiques ensemble.

## 8. Verification apres migration

Apres les migrations sur base de test, executer :

`supabase/verification/atomic_operations_verification.sql`

Verifier notamment :

- existence de `add_expense`, `add_expense_v2`, `check_in_invitation`;
- existence de l'index unique partiel QR;
- absence de doublons QR;
- refus d'un duplicate token de test;
- acceptation unique de `checked_in NULL`;
- deux depenses successives sans perte;
- roles QR autorises/refuses.

## 9. Tests des six roles

Tester avec de vrais JWT Supabase Auth ou via l'application connectee :

- `admin`
  - depense : autorisee.
  - QR : autorise.
- `manager`
  - depense : autorisee.
  - QR : autorise.
- `server`
  - depense : autorisee selon RLS `club_tables`.
  - QR : refuse.
- `security`
  - depense : refusee.
  - QR : autorise.
- `security_counter`
  - depense : refusee.
  - QR : autorise.
- `promoter`
  - depense : autorisee selon RLS `club_tables`.
  - QR : refuse.

## 10. Tests de concurrence

Depenses :

1. Ouvrir deux sessions autorisees sur la meme table.
2. Lancer deux ajouts de depense quasi simultanes.
3. Verifier que les deux objets sont presents dans `club_tables.expenses`.
4. Verifier que les totaux restent corrects dans l'application.

QR :

1. Creer une invitation de test non utilisee.
2. Scanner le meme QR depuis deux sessions autorisees quasi simultanees.
3. Un seul appel doit retourner succes.
4. L'autre doit retourner deja utilise.
5. Une seule entree correspondante doit etre ajoutee au flux.

## 11. Criteres autorisant la production

Production autorisee uniquement si :

- Pre-vol test sans blocage.
- Migrations test appliquees dans l'ordre.
- Verification SQL test sans anomalie.
- Tests des six roles valides.
- Tests de concurrence valides.
- Sauvegarde production confirmee.
- Fenetre hors soiree confirmee.

## 12. Ordre production, Phase 0b et Vercel

Ordre confirme avec Phase 0b : le front qui appelle `get_my_profile`, `add_expense_v2` et `check_in_invitation` doit etre deploye apres la creation des comptes Auth et apres presence des RPC, mais avant `0008`. Il peut ainsi etre teste pendant que l'ancien acces anon reste temporairement disponible. Ce test pre-cutover fonctionne uniquement grace au pont RLS transitoire ajoute par `0003` et aux policies de `0004` pour `venues/events`. Un utilisateur Auth non lie a `staff_users.auth_id` doit etre refuse par les policies.

Ordre recommande :

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

Ne pas deployer le front seulement apres `0008` : cela supprimerait le filet de compatibilite anon avant d'avoir valide les sessions Auth, les roles et les RPC critiques en production.

Le pont RLS transitoire ne remplace pas le cutover final : `0008` doit suivre dans la meme fenetre de maintenance pour supprimer les policies anon transitoires, retirer les acces directs `anon` et appliquer la vraie separation finale par role. Les inscriptions publiques Supabase Auth doivent etre desactivees ou controlees, mais cette configuration ne suffit pas : les policies doivent refuser les comptes Auth non lies au staff.

Le pre-vol atomique verifie les prerequis techniques des RPC atomiques. Il distingue `atomic_ready`, `phase0b_cutover_ready` et `post_cutover_security_verified`. La securite RLS finale est validee seulement apres `0008` avec `supabase/verification/phase0b_post_cutover_verification.sql`.

## 13. Retour arriere

Priorite : restaurer la sauvegarde Supabase si une migration appliquee en production laisse la base dans un etat incertain.

Retour arriere applicatif :

- Si les migrations sont appliquees mais le front pose probleme, redeployer le front precedent.
- Les fonctions ajoutees peuvent rester en base si elles ne sont pas appelees par l'ancien front.

Retour arriere SQL cible, uniquement si necessaire et hors soiree :

- Ne supprimer aucune donnee metier.
- Ne supprimer ni invitations ni entrees existantes.
- Pour retirer les nouvelles RPC, utiliser uniquement les signatures exactes :
  - `public.check_in_invitation(text, text)`
  - `public.add_expense_v2(text, text, numeric, text)`

Ne pas supprimer `public.add_expense(text, text, numeric, text)` si `0005` est conservee comme migration historique.

## 14. Resultats a transmettre pour revue

Transmettre :

- capture ou export des sections `01` a `16` du pre-vol;
- lignes de `16_blocking_summary`;
- resultat de `12_qr_duplicate_non_empty_tokens`;
- resultat de `14_expenses_quality_summary`;
- resultat de `15_expenses_incompatible_rows`;
- liste des roles de `09_staff_roles_present`;
- privileges de `06_routine_execute_privileges`;
- policies de `08_rls_policies`;
- apres migration test, resultat complet de `atomic_operations_verification.sql`;
- compte-rendu des tests des six roles;
- compte-rendu des tests de concurrence.
