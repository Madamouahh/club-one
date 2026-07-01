---
name: migration-review
description: Revue statique d'une migration Supabase Club One — ordre, idempotence, traitement des donnees historiques, transaction, rollback, RLS, grants, contraintes. Use when reviewing a new or modified file under supabase/migrations/ or supabase/verification/, before any non-production execution.
---

# Revue de migration (statique, Club One)

## Quand l'utiliser
Avant toute preparation d'execution (meme sur clone non-production) d'un fichier sous `supabase/migrations/` ou `supabase/verification/`.

## Points a verifier, dans l'ordre

1. **Ordre** — la migration suppose-t-elle un etat prealable explicite (colonnes, fonctions, table) ? Le verifie-t-elle (`to_regclass`, `to_regprocedure`, `information_schema.columns`) avant d'agir, ou suppose-t-elle silencieusement ?
2. **Idempotence** — `IF NOT EXISTS` / `CREATE OR REPLACE` / gestion des contraintes deja presentes. Une deuxieme execution accidentelle casse-t-elle quelque chose ?
3. **Donnees historiques** — tout backfill ambigu (date non unique, cle non unique) doit laisser la valeur `NULL` plutot que d'assigner arbitrairement ; verifier qu'un controle explicite (`raise exception`) existe avant toute contrainte unique qui en decoule.
4. **Transaction** — `begin`/`commit` explicites ; pas d'etat partiel possible en cas d'echec en cours de route.
5. **Rollback** — un chemin de retour arriere existe-t-il et a-t-il ete reaudite pour la version courante de la migration (pas seulement historiquement compatible) ?
6. **RLS / policies** — `ENABLE ROW LEVEL SECURITY`, policies par role, `WITH CHECK` distinct de `USING` quand necessaire.
7. **Grants** — `REVOKE ALL ... FROM PUBLIC` puis `GRANT` cible ; jamais de fonction sensible ouverte a `PUBLIC` ou `anon` sans raison documentee.
8. **Contraintes** — PK/FK/CHECK/index unique, et ordre de creation par rapport aux gardes anti-doublon (l'index unique doit etre cree APRES la verification d'absence de doublon, jamais avant).

## Sortie attendue
Par fichier : fichier:ligne → point verifie → conforme/non conforme → preuve → niveau de preuve ("SQL statique" au maximum tant qu'aucune execution reelle n'a eu lieu).

## Interdictions
Aucune execution SQL, aucune commande `supabase`, aucune base contactee.
