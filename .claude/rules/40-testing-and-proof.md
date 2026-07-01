# 40 — Tests et niveaux de preuve

Toujours distinguer explicitement, dans un rapport comme dans une conversation :

1. **Lecture statique** — affirmation prouvee seulement par lecture de code ou recherche textuelle.
2. **Validation locale** — TypeScript (`npx tsc --noEmit`), lint (`npm run lint`), tests Node locaux (`npm run test:atomic`, `npm run test:permissions`, `npm run test:rls`), build (`npm run build`).
3. **Validation SQL statique** — inspection des migrations/contrats SQL. Ne prouve jamais que PostgreSQL executera reellement le SQL sans erreur.
4. **Test non-production reel** — migrations reellement executees sur un projet Supabase isole.
5. **Validation integree** — front + Auth + RLS + RPC + Realtime + plusieurs roles reels.
6. **Production verifiee** — apres deploiement controle et verification reelle.

## Regles

- Ne jamais qualifier un test regex ou un test de lecture de source de "validation PostgreSQL" ou de "validation RLS reelle".
- Lancer les tests cibles (fichier concerne) avant les tests globaux.
- Interdiction de vocabulaire sans preciser le niveau : "parfait", "totalement securise", "garanti", "termine", "production ready", "valide en base", "sans risque". Utiliser a la place : "conforme statiquement", "valide localement", "pret pour test non-production", "teste sur clone", "verifie en production".
- Chaque rapport liste explicitement les elements non verifies (ce qui reste au niveau de preuve le plus bas atteint).
