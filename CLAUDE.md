@AGENTS.md

# Club One — gouvernance projet

## Projet

- Nom : Club One (gestion de soirees nightclub — plan de tables, flux entree/sortie, promoteurs/QR, securite, cloture).
- Chemin local : `C:\Users\maxou\club-one`.
- Branche de travail obligatoire : `security/auth-front`. Ne jamais checkout `main` sans demande explicite, jamais de push/merge dedans sans validation explicite.
- Stack : Next.js + React + TypeScript, Supabase (Postgres + Auth + RLS + RPC), Vercel.
- Objectif produit courant : terminer la transition evenementielle `0008` (preparation) → nouveau front event-scoped → `0009` (cutover RLS final), sans casser l'ancien front pendant la periode transitoire.

## Regles absolues

- Jamais de travail direct sur `main` ; jamais de checkout `main` sans demande explicite ; jamais de fusion/push dans `main` sans validation explicite.
- **Claude Code ne pousse jamais.** `git push` (quelle que soit la branche, quelle que soit la forme) est bloque de facon inconditionnelle par `.claude/hooks/guard.cjs` : aucune variable d'environnement, aucun argument, aucun fichier ne leve ce blocage — un agent ne peut pas s'auto-autoriser a pousser en definissant une variable. Le push est une operation manuelle que l'utilisateur execute lui-meme, hors Claude Code, apres validation explicite.
- Jamais de `supabase db push`.
- Jamais de `supabase migration up`.
- Jamais d'execution reelle d'une migration (`0008`, `0009`, ou toute autre) sans GO explicite et sans etre sur une base non-production isolee.
- Jamais de `service_role` / `sb_secret` cote client ou affiche dans une reponse.
- Jamais d'affichage ou de lecture inutile de `scripts/staff-passwords.local.json`.
- Jamais d'affichage de `.env`, `.env.local` ou de tout fichier contenant un secret.
- Jamais d'utilisation de la base operationnelle (production) comme environnement de test.
- Toujours distinguer : lecture statique, validation locale (build/lint/tests TS), validation SQL statique, validation reelle sur une base non-production, integration complete, production verifiee (voir `.claude/rules/40-testing-and-proof.md`).

## Etat actuel (a la derniere revue de gouvernance)

- Six commits Auth deja pousses sur `origin/security/auth-front` (`a704306` → `be1f694`), non fusionnes dans `main`. Ne jamais les reecrire.
- Cinq commits event-scope locaux non pousses (`77773d4` → `dc09586`), audites et juges statiquement conformes (voir `docs/CLAUDE_HANDOFF.md`).
- Migrations `0003` a `0007` deja appliquees manuellement sur la base operationnelle.
- `0008_event_scope_preparation.sql` et `0009_phase0b_rls_cutover.sql` ecrites et revues statiquement, **non executees**.
- Cutover bloque tant qu'un clone Supabase non-production n'est pas prepare et valide.

## Processus obligatoire

audit (lecture seule) → constats + preuves → plan → GO explicite → modification → tests cibles → tests globaux → audit contradictoire → preparation (non-production) → execution controlee → verification reelle → rollback documente → rapport.

Ne jamais sauter l'etape GO avant une action a fort risque (migration, push, base non-production, depense externe).

## Niveaux de preuve

1. Lecture statique (code, grep).
2. Validation locale (TypeScript, lint, tests Node, build).
3. Validation SQL statique (lecture des migrations — ne prouve pas l'execution reelle par PostgreSQL).
4. Test reel sur base non-production isolee (migrations reellement executees).
5. Validation integree (front + Auth + RLS + RPC + Realtime + plusieurs roles).
6. Production verifiee (apres deploiement controle).

Ne jamais ecrire "valide", "termine" ou "production ready" sans preciser le niveau atteint.

## Routage des modeles (indicatif, non applique automatiquement)

Claude Code ne route pas automatiquement le modele par type de tache : c'est une discipline a appliquer manuellement a chaque session, pas un mecanisme technique du produit.

- Modele economique/rapide : recherche, grep, inventaires, formatage, doc simple, tests statiques.
- Modele intermediaire : developpement React/TypeScript courant, tests, refactoring cible, debug local.
- Niveau maximal reserve aux portes critiques : architecture, Auth/RLS, migrations, concurrence/atomicite, incident, cutover, decision de rollback, audit final avant GO/NO-GO.

## References

- Agents specialises disponibles (auto-decouverts par Claude Code) : `.claude/agents/`.
- Procedures (skills, auto-decouvertes) : `.claude/skills/`.
- Protections techniques (hooks) et permissions : `.claude/settings.json`, `.claude/hooks/guard.cjs`.
- Etat de reprise compact : `docs/CLAUDE_HANDOFF.md`.
- Runbook Supabase Phase 0b : `SECURITY_PHASE0B.md`.

## Regles detaillees (chargees automatiquement dans ce fichier)

@.claude/rules/00-governance.md
@.claude/rules/10-git-safety.md
@.claude/rules/20-security-supabase.md
@.claude/rules/30-cost-model-routing.md
@.claude/rules/40-testing-and-proof.md
@.claude/rules/50-club-one-domain.md
