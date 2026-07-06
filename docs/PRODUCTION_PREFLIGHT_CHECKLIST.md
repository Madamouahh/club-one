# Club One — Checklist PRÉFLIGHT production (PHASE A)

> À cocher intégralement AVANT toute application en prod. **Un seul item rouge = NO-GO.** Lecture seule
> uniquement ; aucune écriture prod dans cette phase.

## Fenêtre & personnes
- [ ] Fenêtre **hors soirée** confirmée (mardi/mercredi 10:00–12:00 CET proposé), aucune soirée active.
- [ ] Opérateur cutover présent : ______
- [ ] Vérificateur présent : ______
- [ ] Décideur rollback (fondateur/délégué) joignable en temps réel : ______

## Aucune écriture / aucune soirée active
- [ ] Ancien front en maintenance ou fenêtre sans staff connecté (gel des écritures).
- [ ] `select count(*) from public.club_tables where status <> 'free' or coalesce(client,'')<>'' or coalesce(expenses,'[]'::jsonb)<>'[]'::jsonb;` → **0** (tables propres, pas de soirée live).
- [ ] Aucune réservation active en cours de service.

## Sauvegarde & PITR
- [ ] **Backup managé Supabase** récent confirmé (dashboard).
- [ ] **PITR activé**, fenêtre de restauration vérifiée ; **horodatage du dernier point restaurable noté** : ______ (servira de cible rollback).
- [ ] Test de faisabilité restauration compris (procédure PITR relue dans `PRODUCTION_ROLLBACK_RUNBOOK.md`).

## Export structurel & inventaire
- [ ] `backups/prod-structural-snapshot-<date>.md` régénéré (schéma, policies, grants, functions) — aucun secret/PII.
- [ ] Inventaire des connexions actives noté (`select count(*) from pg_stat_activity where datname = current_database();`).
- [ ] État Realtime noté : `select count(*) from pg_publication_tables where pubname='supabase_realtime';` → attendu **0** (pré-`0042`).
- [ ] État Auth noté : `select count(*) from auth.users;` = **10** ; `select count(*) from public.staff_users where auth_id is not null;` = **10** (tous liés).

## SHA & migrations gelés
- [ ] SHA git du code front à déployer noté : `git rev-parse HEAD` → ______
- [ ] Les **46** fichiers `0008…0053` présents, ordre numérique contigu (une seule `0032`), guard vert : `npm run test:migrationsregistry` → 7/7.
- [ ] `npx tsc --noEmit` = 0 erreur ; build front OK sur le SHA gelé.
- [ ] Empreinte de schéma cible connue (cf. `PRODUCTION_CUTOVER_PACKAGE.md` §5) pour comparaison post-cutover.

## Préconditions `0009` (event-scope) comprises
- [ ] Plan de **bootstrap de la 1ʳᵉ soirée** entre `0008` et `0009` défini (événement cible choisi, admin qui l'exécute).
- [ ] `supabase/verification/0009_preflight_readonly.sql` prêt à être lancé après bootstrap.

## Sécurité
- [ ] Neutralisation mot de passe = **action manuelle** (`supabase/manual_actions/`, mode B), PAS dans la chaîne ; ne s'exécute qu'en PHASE C-bis après login GoTrue confirmé + backup, phrase d'autorisation exacte.
- [ ] Aucune clé `service_role` / secret dans les logs, la console, ou une variable exposée client.

## GO/NO-GO préflight
- [ ] **Tous** les items ci-dessus cochés. Sinon **NO-GO** (corriger, re-préflighter).
