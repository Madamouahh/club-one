# Club One — Runbook de ROLLBACK production

> S'applique si un critère d'arrêt du `PRODUCTION_CUTOVER_RUNBOOK.md` se déclenche. Objectif : revenir à
> un état **cohérent et connu** avec perte de données **nulle ou bornée et documentée**. Aucune action
> vague : chaque cas a des commandes exactes.

## DÉCLENCHEUR (l'un des suivants)
- Garde `raise exception` d'une migration (0008/0009/0053/…).
- Harness de contrat rouge après 0009 ou 0053.
- Login GoTrue impossible pour ≥1 rôle, ou fuite inter-rôle (RLS/Realtime).
- Incohérence de données (tables ≠ 18, archives fausses).
- Décision explicite du décideur rollback.

## DÉLAI MAXIMAL DE DÉCISION
- **≤ 10 min** après détection pour décider ROLLBACK vs correctif à chaud. Au-delà, **rollback par
  défaut** (on ne laisse pas la prod dans un état ambigu). Le décideur rollback tranche.

## MATRICE DE ROLLBACK selon le point atteint

### Cas 1 — échec AVANT `0009` (pendant/juste après `0008`)
`0008` est **non destructif et réversible** (colonnes nullable ajoutées, RPC créées, aucune donnée
détruite). L'ancien front fonctionne encore.
- **Action** : ne pas appliquer 0009. Optionnel : remettre l'ancien front hors maintenance.
- **Retrait de 0008** (si souhaité, hors urgence) : script inverse ciblé —
  `drop table if exists public.club_runtime_state cascade;` + `alter table public.club_tables drop
  column if exists event_id;` (idem `entry_logs.event_id/event_date`, `promoter_guest_entries.event_id`,
  `event_archives.event_id`) + `drop function` des RPC v2/v3 créées par 0008. **Non urgent** : 0008
  peut rester en place sans casser l'ancien front.
- **Perte de données** : nulle.

### Cas 2 — échec PENDANT/APRÈS `0009` (point de non-retour franchi)
`0009` a modifié policies + grants + révoqué anon → l'ancien front est cassé, le nouveau dépend de
l'état event-scoped.
- **Action = RESTAURATION PITR** au point pris en preflight A1 :
  1. Dashboard Supabase → Database → **Point-in-Time Recovery** → restaurer à l'**horodatage noté en
     A1** (juste avant B4). (Ou restauration du backup managé pris en A1 si PITR indisponible.)
  2. La restauration ramène le schéma **et** les données à l'état pré-`0009`.
- **Restauration du code** : redéployer le SHA de l'**ancien front** (Vercel → promote le déploiement
  précédent). Les variables d'environnement de l'ancien front restent valides (même projet Supabase).
- **Restauration des variables** : aucune variable Supabase ne change (même projet). Si des variables
  du **nouveau** front ont été ajoutées (feature flags event-scope), les remettre à l'état ancien.

### Cas 3 — échec sur un vertical (`0010`→`0052`) ou `0053` (anon revoke)
Les verticaux sont additifs (nouvelles tables/policies). `0053` révoque des grants anon.
- **Rollback ciblé préféré** (plus rapide que PITR) : `drop` de la ou des tables du vertical fautif +
  ré-exécution corrigée ; pour `0053` (anon revoke), ré-`grant` inverse si nécessaire.
- Si l'état est ambigu → **PITR complet** (Cas 2).

### Cas 4 — échec de l'action manuelle `neutralize_legacy_password` (PHASE C-bis)
Cette action **modifie une donnée** (efface le clair). Le login **ne dépend pas** de cette colonne
(GoTrue) → un échec ici ne casse pas l'auth. Rollback du clair = **PITR** au point pris avant l'action
(mais on ne veut de toute façon pas restaurer le clair). Ne jamais ré-afficher/exporter les valeurs.

## GESTION DES ÉCRITURES ENTRE CUTOVER ET ROLLBACK
- Le **gel des écritures** (preflight A4) doit tenir pendant TOUTE la fenêtre. Donc, en principe,
  **aucune écriture métier** n'a lieu entre B4 et un rollback → la restauration PITR ne perd rien.
- Si, malgré le gel, des écritures ont eu lieu après le point PITR (ex. un check-in QR de test) :
  1. **Avant** de restaurer, exporter ces lignes (SELECT → CSV/JSON) pour audit.
  2. Restaurer PITR (elles disparaissent).
  3. Décider au cas par cas de les rejouer manuellement (elles sont, par construction du gel, des
     écritures de test, pas des données clients réelles).
- **Interdit** : restaurer PITR sans avoir d'abord constaté (et exporté si présentes) les écritures
  post-point-PITR.

## VÉRIFICATION POST-RESTAURATION (obligatoire avant de rouvrir)
1. `select count(*) from public.club_tables;` = **18** ; `staff_users` = **10** ; `auth.users` = **10**.
2. Schéma conforme au snapshot pré-cutover (`backups/prod-structural-snapshot-<date>.md`) : 8 tables
   opérationnelles, RPC historiques présentes, policies `co_phase0b_*` de retour (si Cas 2).
3. **Ancien front** : un admin/promoteur/security se connecte et opère normalement (smoke humain).
4. Aucune erreur applicative en console ; Realtime de l'ancien front (si utilisé) cohérent.
5. Consigner : cause de l'échec, point PITR utilisé, écritures exportées éventuelles, heure de
   réouverture. Post-mortem avant toute nouvelle tentative de cutover.

## Ce que le rollback ne doit JAMAIS faire
- Restaurer le mot de passe en clair « pour dépanner » (le login est GoTrue).
- Désactiver la RLS pour « rouvrir vite ».
- Laisser la prod dans un état mi-`0009` (soit avant, soit après, jamais entre).
