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
11. Appliquer `0008_event_scope_preparation.sql` (preparation additive du perimetre evenementiel — voir section "Sequence event-scope" ci-dessous ; ne ferme pas les acces anonymes).
12. Deployer le nouveau front event-scoped et le tester pendant que l'ancien front reste temporairement fonctionnel.
13. Executer `supabase/verification/0009_preflight_readonly.sql` (lecture seule).
14. Appliquer `0009_phase0b_rls_cutover.sql` pour fermer les acces anonymes et activer le verrouillage RLS final event-scoped.
15. Executer `supabase/verification/0009_postflight_readonly.sql` (lecture seule).
16. Refaire les tests fonctionnels complets sur les six roles.
17. Utiliser un rollback uniquement en cas de blocage immediat, et seulement apres l'avoir reaudite pour la version courante de l'architecture (voir "Rollback" ci-dessous).

**Etat au moment de cette mise a jour (niveau de preuve : local + SQL statique, aucune execution PostgreSQL reelle) : les etapes 1 a 10 ont ete faites manuellement sur la base operationnelle dans une iteration anterieure ; `0008_event_scope_preparation.sql` et `0009_phase0b_rls_cutover.sql` sont ecrites et revues statiquement mais N'ONT PAS ETE EXECUTEES. La prochaine execution (0008 puis 0009) doit se faire sur un projet Supabase non-production isole avant toute application sur la base operationnelle — voir `docs/CLAUDE_HANDOFF.md`.**

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

## Sequence event-scope (0008 preparation → nouveau front → 0009 cutover)

L'ancien fichier `0008_phase0b_rls_cutover.sql` a ete remplace par une sequence en deux temps, deja ecrite et revue statiquement mais **non executee** :

1. `supabase/migrations/0008_event_scope_preparation.sql` — preparation non destructive :
   - cree/durcit la table singleton `public.club_runtime_state` (`active_event_id`, `bootstrap_completed_at`, `last_closed_event_id`) avec ses contraintes (PK, CHECK singleton, FK `NOT VALID`) ;
   - ajoute `event_id`/`event_date` sur `club_tables`, `entry_logs`, `promoter_guest_entries`, `event_archives` ;
   - backfille `event_id` uniquement quand la date correspond a exactement un evenement ET exactement une archive/log — sinon la valeur reste `NULL` (voir `.claude/rules/50-club-one-domain.md`) ;
   - cree les RPC versionnees du nouveau front (`bootstrap_club_event_v2`, `activate_club_event_v2`, `close_club_event_v2`, `add_expense_v3`, `check_in_invitation_v2`, `create_promoter_invitation_v2`, `add_entry_log_v2`, `get_active_event_context`, `get_security_table_snapshot`, `list_activatable_club_events`) sans casser les RPC historiques (`add_expense_v2`, `check_in_invitation`) ni les acces anonymes existants ;
   - cree l'index unique `event_archives_event_id_unique_idx` seulement apres avoir verifie l'absence de doublon (`raise exception` sinon).
2. Deploiement du nouveau front event-scoped (`app/page.tsx`, `lib/activeEvent.ts`, `lib/securityRevenue.ts`), teste pendant que l'ancien front reste temporairement fonctionnel grace aux RPC historiques preservees.
3. `supabase/verification/0009_preflight_readonly.sql` — lecture seule, a executer avant toute etude d'execution de `0009`.
4. `supabase/migrations/0009_phase0b_rls_cutover.sql` — cutover final :
   - verifie (sans les redefinir) que toutes les RPC versionnees de l'etape 1 existent deja ;
   - verifie l'absence d'ambiguite (dates dupliquees, archives sans `event_id` attribuable, ecarts de scope) avant de continuer ;
   - active RLS sur `staff_users`, `club_runtime_state`, `club_tables`, `entry_logs`, `promoter_contacts`, `promoter_guest_entries`, `event_archives`, `venues`, `events` et pose les policies finales scopees par role + evenement actif ;
   - revoque l'usage `authenticated`/`anon` de `add_expense`, `add_expense_v2` et de l'ancien `check_in_invitation` ;
   - ferme `anon` sur toutes les tables (sauf `get_invite`/`public_events`, qui restent accessibles anonymement par design).
5. `supabase/verification/0009_postflight_readonly.sql` — lecture seule, a executer apres une future execution controlee de `0009`.

## Phase B - cutover RLS (execution)

1. Confirmer la sauvegarde recente.
2. Confirmer une fenetre hors soiree.
3. Appliquer `supabase/migrations/0008_event_scope_preparation.sql`, puis deployer/tester le nouveau front, puis executer le preflight, puis appliquer `supabase/migrations/0009_phase0b_rls_cutover.sql` (voir sequence ci-dessus). Chaque migration est transactionnelle et bloque explicitement (`raise exception`) avant toute modification si une precondition manque.
4. Executer `supabase/verification/0009_postflight_readonly.sql`.
5. Refaire les tests fonctionnels complets sur les six roles.
6. **Rollback** : `supabase/rollback/0008_phase0b_rls_cutover_emergency.sql` existe toujours sur disque mais a ete ecrit pour l'ancienne architecture (avant la sequence event-scope). Il ne doit pas etre considere comme automatiquement compatible avec `0008_event_scope_preparation.sql`/`0009_phase0b_rls_cutover.sql` : le reauditer explicitement contre le schema courant (colonnes `event_id`, `club_runtime_state`, RPC versionnees) avant toute utilisation, y compris en cas de blocage immediat sur un environnement non-production.

## Compatibilite migrations

- `0003` fournit `current_staff_role()`, `current_staff_username()`, `get_my_profile()` et `get_invite(text)`.
- `0004` fonctionne apres `0003`, car `current_staff_role()` existe.
- `0005` reste historique et ne depend pas du front Phase 0b.
- `0006` fonctionne apres `0003`, car il utilise les helpers staff.
- `0007` fonctionne apres `0003`, car il utilise les helpers staff.
- `0008_event_scope_preparation.sql` s'applique apres `0007` ; elle est additive et ne modifie pas les signatures des RPC atomiques existantes (`add_expense_v2`, `check_in_invitation` restent utilisables par l'ancien front).
- `0009_phase0b_rls_cutover.sql` s'applique en dernier, uniquement apres bootstrap d'un evenement actif et validation du nouveau front event-scoped ; elle verifie la presence des RPC versionnees sans les redefinir.
- Le front deploye avant cutover trouve `get_my_profile`, `add_expense_v2` et `check_in_invitation` (ancien front) ou les RPC versionnees `*_v2`/`*_v3` (nouveau front, apres `0008`).
- Statut au moment de cette mise a jour : `0008` et `0009` sont ecrites et revues statiquement, **non executees** (voir `docs/CLAUDE_HANDOFF.md`).

## Rollback

La Phase A est additive : en cas de probleme, ne pas appliquer `0008`.

La Phase B (`0009_phase0b_rls_cutover.sql`) ferme les acces anonymes directs. En cas d'incident bloquant immediat, `supabase/rollback/0008_phase0b_rls_cutover_emergency.sql` existe mais **doit etre reaudite** contre le schema event-scope courant avant utilisation (voir "Sequence event-scope" ci-dessus) : ecrit pour l'ancienne architecture, il n'est pas garanti compatible avec `club_runtime_state`, les colonnes `event_id`, ou les RPC versionnees introduites par `0008_event_scope_preparation.sql`. Ne pas presumer qu'il rouvre proprement les tables operationnelles minimales sans cette revue.

## Nettoyage futur

La colonne legacy `staff_users.password` ne doit pas etre supprimee dans ce lot. Sa suppression doit faire l'objet d'une migration future, uniquement apres :

1. creation des comptes Auth ;
2. validation des 10 connexions ;
3. stabilisation du nouveau login ;
4. sauvegarde recente ;
5. procedure de retour arriere validee.
