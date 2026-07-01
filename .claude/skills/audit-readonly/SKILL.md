---
name: audit-readonly
description: Audit Club One en lecture seule — etat Git, inventaire cible, rapport avec preuves, sans aucune modification ni commande Supabase. Use when starting a new session on Club One, resuming after a break, or before any GO/NO-GO decision that needs a fresh factual baseline.
---

# Audit lecture seule (Club One)

## Quand l'utiliser
Debut de session, reprise apres pause, ou avant toute decision GO/NO-GO qui a besoin d'un etat factuel a jour.

## Etapes (aucune modification, aucune commande Supabase, aucun SQL)

1. Etat Git :
   ```
   git branch --show-current
   git status -sb
   git log --oneline -15
   git log --oneline origin/security/auth-front..HEAD
   git diff --check origin/security/auth-front..HEAD
   ```
2. Confirmer : branche = `security/auth-front` (sauf demande explicite), worktree propre, commits locaux attendus toujours presents, pas de fichier non suivi inattendu.
3. Inventaire cible (lecture seule) des fichiers pertinents a la question posee — ne pas relire tout le depot par defaut.
4. Si la question porte sur les migrations : lire `supabase/migrations/`, `supabase/verification/` en entier (petits fichiers, lecture complete justifiee).
5. Produire un rapport : constats → preuves (fichier:ligne) → risques classes → niveau de preuve atteint → elements non verifies.

## Interdictions
Aucune ecriture de fichier, aucun commit, aucun push, aucune commande `supabase`, aucun SQL execute, aucune lecture de `scripts/staff-passwords.local.json` ou de `.env*`.
