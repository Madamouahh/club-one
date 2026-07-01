# Club One — memoire de reprise

Etat compact pour qu'une nouvelle session reprenne sans relire tout l'historique de conversation. Ne contient aucun secret, mot de passe, URL sensible ou cle.

## Branche

- Branche de travail : `security/auth-front`.
- Ne jamais checkout `main` sans demande explicite. Ne jamais fusionner/pousser dans `main` sans validation explicite.

## Commits Auth distants (deja pousses, ne jamais reecrire)

Six commits sur `origin/security/auth-front` : centralisation des permissions staff, matrice de permissions, garde-fous sur les mutations, cycle de session/mutations refusees, exposition QR a la vue securite, couverture des chemins QR par role. Smoke test humain valide pour `admin`, `promoter`, `security`.

## Commits event-scope locaux (non pousses, audites statiquement conformes)

Cinq commits, dans l'ordre : preparation `0008` (versionnee) → adoption front du cycle de vie evenementiel actif → cutover `0009` (RLS final event-scoped) → verification etagee → tests de non-regression de la transition. Ne pas les reecrire ; l'audit initial (voir historique de session) les a juges conformes statiquement, sans correction bloquante identifiee.

## Migrations Supabase

- `0003` a `0007` : deja appliquees manuellement sur la base operationnelle.
- `0008_event_scope_preparation.sql` : ecrite, revue statiquement (idempotente, backfill non-ambigu uniquement, garde anti-doublon avant index unique). **Non executee.**
- `0009_phase0b_rls_cutover.sql` : ecrite, revue statiquement (preconditions explicites, verifie mais ne redefinit pas les RPC versionnees, active RLS + policies finales). **Non executee.**
- Cutover bloque tant qu'un projet Supabase non-production isole n'est pas cree et valide.

## Niveau de preuve actuel

Local (TypeScript/lint/build/tests Node) + SQL statique (lecture des migrations). Aucune execution reelle sur PostgreSQL. Voir `.claude/rules/40-testing-and-proof.md` pour l'echelle complete.

## Interdictions actives

Voir `.claude/rules/` (charge automatiquement par `CLAUDE.md`) et `.claude/hooks/guard.cjs` (garde technique sur les commandes Bash : push vers `main`, force push, `supabase db push`/`migration up`/`link`, execution directe de `0008`/`0009` via `psql`, lecture de `scripts/staff-passwords.local.json` ou `.env*`).

## Prochaine etape (necessite un nouveau GO explicite)

1. Preparer un projet Supabase **non-production isole** avec ses propres variables Preview.
2. Appliquer `0008` sur ce clone.
3. Bootstrap depuis l'interface (premiere soiree).
4. Tester les six roles et le Realtime sur le clone.
5. Executer le preflight `0009_preflight_readonly.sql`.
6. Appliquer `0009` sur le clone.
7. Tester a nouveau les six roles + concurrence (depenses/QR) + clôture/activation suivante.
8. Executer le postflight `0009_postflight_readonly.sql`.
9. Documenter un rollback verifie avant toute application sur la base operationnelle.

## Criteres GO/NO-GO pour la phase non-production

- GO uniquement si : projet Supabase clone cree avec variables dediees, sauvegarde/restauration du clone comprise, aucune donnee reelle sensible copiee sans necessite, fenetre hors soiree confirmee (n/a sur un clone mais a documenter comme discipline pour la suite production).
- NO-GO si : la moindre etape suppose la base operationnelle au lieu du clone, ou si un test ne peut pas etre execute sans lire un secret.
