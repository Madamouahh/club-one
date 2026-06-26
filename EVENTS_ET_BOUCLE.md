# La boucle complète — modèle Lieux/Événements

Objectif du cahier des charges (section 8) : un événement créé dans Club One nourrit le site, la
communication, les réservations, la soirée, puis le CRM. Voici la fondation technique (Lot 3).

## Le modèle (migration `0004_events_model.sql`)
- `venues` — les 3 univers : `eden`, `cercle`, `terminus` (nom, type, tagline).
- `events` — un événement rattaché à un lieu : titre, date, statut (`draft`/`published`/`archived`),
  description, line-up (DJs/artistes), média, lien billetterie, etc.
- `public_events()` — RPC **anon, lecture seule** : ne renvoie que les événements **publiés et à venir**.
  Le site n'accède jamais aux tables opérationnelles de la soirée ; il lit cette RPC.

## La boucle, étape par étape
1. **Club One** : un membre (admin/manager/promoter) crée un `event` (statut `draft`), le rattache à
   Eden / Le Cercle / Terminus, ajoute line-up + média.
2. **Validation humaine** : on passe le statut à `published`.
3. **Site** : la home/agenda appelle `public_events()` et affiche les soirées à venir par univers
   (remplace l'`/agenda/` vide du WordPress actuel).
4. **Communication** (back office IA, Priorité 2) : à partir de l'`event`, génération de briefs/posts
   (validation humaine, aucun envoi autonome — voir `COMMS_IA_PLAN.md`).
5. **Réservation** : CTA du site → téléphone/OctoTable aujourd'hui ; demain, une table `reservations`
   rattachée à l'`event` pourra alimenter directement le plan de Club One.
6. **Soirée** : Club One gère tables/entrées/dépenses en temps réel (déjà en place).
7. **CRM/stats** : `event_archives` + futures `reservations` relient fréquentation, CA, canal,
   promoteur, artiste → quelles campagnes/artistes/ promoteurs convertissent.

## Ce qui est fait vs à faire
- **Fait (préparé)** : tables `venues`/`events` + RLS + RPC publique `public_events()`. Additif, à
  appliquer après Phase 0b (réutilise `current_staff_role`).
- **À construire ensuite** (UI, non fait cette nuit) : un onglet « Événements » dans Club One
  (CRUD simple, gardé par rôle) ; côté site, une section agenda qui consomme `public_events()` ;
  puis la table `reservations` (lien site → soirée) qui ferme la boucle.

## Pourquoi ce découpage
La partie **temps réel de la soirée** (Front Office) et la **gestion événement/communication**
(Back Office) partagent la même base Supabase mais restent séparées : créer/publier un événement ou
générer un contenu ne touche jamais le chemin critique de la soirée (contrainte du cahier des charges).
