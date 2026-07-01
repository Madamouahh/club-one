---
name: release-gate
description: Porte de validation avant tout push/deploiement Club One — tests, build, diff, commits, secrets, risque Preview, base cible, rollback, GO explicite. Use when preparing to push, merge, or deploy any change to Club One, or when asked whether something is "ready".
---

# Release gate (Club One)

## Quand l'utiliser
Avant tout push, toute fusion, ou toute affirmation qu'un changement est "pret".

## Checklist (toutes les cases doivent etre explicitement statuees, pas supposees)

1. **Tests** — `npm run test:atomic`, `npm run test:permissions`, `npm run test:rls` : resultats bruts (pass/fail, nombre).
2. **Typecheck / lint / build** — `npx tsc --noEmit`, `npm run lint`, `npm run build`.
3. **Diff** — `git diff --check` propre ; `git diff --stat` relu integralement, pas seulement le resume.
4. **Commits** — atomiques, messages clairs, aucun commit distant reecrit.
5. **Secrets** — aucun secret, cle `service_role`/`sb_secret`, mot de passe, ou `scripts/staff-passwords.local.json` dans le diff.
6. **Risque Preview** — la branche est-elle suivie par Vercel ? Un push declenchera-t-il un deploiement pointant vers une base sensible ?
7. **Base cible** — le changement suppose-t-il une migration deja executee sur la base visee ? Si non, le declarer explicitement.
8. **Rollback** — un chemin de retour arriere existe et a ete verifie pour la version courante (pas seulement historiquement).
9. **GO explicite** — le push/la fusion/le deploiement necessite un GO explicite de l'utilisateur ; ne jamais le deduire d'une approbation anterieure sur un autre perimetre.

## Sortie attendue
Tableau case-par-case (statut + preuve) → niveau de preuve global atteint → verdict GO/NO-GO avec justification.

## Interdictions
Ne jamais pousser, fusionner, ou declencher un deploiement depuis ce skill lui-meme — il produit une recommandation, l'action reste soumise au GO humain.
