# Club One — Runbook de bascule PRODUCTION

> **Ne s'exécute qu'après `GO CUTOVER PRODUCTION` explicite du fondateur.** Ce document décrit les
> commandes exactes ; il ne les lance pas. Cible : `xsotmjnaffaibgqgookt` (prod). Claude Code ne pousse
> jamais et n'écrit jamais en prod : chaque commande ci-dessous est exécutée **par un opérateur humain**.

## Rôles & responsables présents (à nommer au GO)

- **Opérateur cutover** (exécute les migrations) : ______
- **Vérificateur** (coche preflight/postflight, lit les sorties) : ______
- **Décideur rollback** (autorité GO/NO-GO/ROLLBACK) : ______ (le fondateur ou son délégué)

## Fenêtre

- **Hors soirée obligatoire** (aucune réservation live, aucune entrée en cours). Les soirées sont les
  nuits jeu–sam ; **fenêtre proposée : mardi ou mercredi 10:00–12:00 CET**, aucune soirée active.
- Durée estimée : **45–90 min** (dont la majorité en vérifications). Le SQL pur est de l'ordre de
  quelques minutes.
- **Précondition dure** : aucune soirée active côté opérationnel (`club_tables` propres). Voir preflight.

---

## PHASE A — AVANT (préflight)

Exécuter intégralement `docs/PRODUCTION_PREFLIGHT_CHECKLIST.md`. Ne pas continuer si **un seul** item
échoue. Points bloquants clés :

1. **Sauvegarde vérifiée** : backup managé Supabase récent + **PITR activé** (fenêtre de restauration
   confirmée sur le dashboard). Noter l'horodatage exact du dernier point restaurable.
2. **Export structurel** : `backups/prod-structural-snapshot-<date>.md` régénéré (schéma/policies/grants).
3. **SHA gelés** : noter le SHA git exact du **code front** déployé et le **hash des 46 fichiers de
   migration** (`0008…0053`, doivent correspondre à ceux répétés). `git rev-parse HEAD` + inventaire.
4. **Gel des écritures** : passer l'ancien front en maintenance (ou fenêtre sans staff connecté),
   confirmer 0 session active d'écriture.
5. **État Realtime / Auth / connexions** : noter `pg_publication_tables` (attendu vide pré-cutover),
   nombre d'`auth.users` (10) et de `staff_users` (10) tous `auth_id` liés.

---

## PHASE B — PENDANT (bascule)

> Chaque étape : exécuter, **lire la sortie**, cocher, puis seulement avancer. `raise exception` =
> arrêt immédiat (cf. « Critères d'arrêt »).

### B1. Appliquer `0008` (préparation, non destructif)
- Appliquer `supabase/migrations/0008_event_scope_preparation.sql`.
- Vérif : `club_runtime_state` existe, RPC v2/v3 présentes, `club_tables.event_id` ajoutée.
- **L'ancien front fonctionne toujours** ici. Réversible sans casse.

### B2. Déployer le nouveau front (event-scoped) pointant sur la prod
- Déploiement Vercel du SHA gelé (variables prod). **Ne déclenche pas encore la RLS finale.**
- Vérif : la page de login GoTrue charge ; un admin peut se connecter (auth déjà en place).

### B3. Bootstrap de la première soirée — **ÉTAPE MANUELLE CONTRÔLÉE**
- Un **admin** connecté au nouveau front lance le bootstrap de la 1ʳᵉ soirée (événement `draft`/
  `published` choisi), OU l'opérateur appelle la RPC de façon contrôlée (session authentifiée admin) :
  `select * from public.bootstrap_club_event_v2('<event_id>');` → attendu `ok=true`.
- Vérif (preflight 0009) : `club_runtime_state` = 1 ligne, `active_event_id` non nul,
  `bootstrap_completed_at` non nul, **18** `club_tables` rattachées à l'événement actif, tous les
  `staff_users.auth_id` matchent `auth.users`, rôles valides. Lancer
  `supabase/verification/0009_preflight_readonly.sql` (lecture seule) et vérifier l'absence d'anomalie.

### B4. Appliquer `0009` — **⚠️ POINT DE NON-RETOUR**
- **À partir d'ici, l'ancien front cesse de fonctionner** (anon révoqué, RLS finale). Le rollback
  n'est plus « ne rien faire » mais une restauration (cf. rollback runbook).
- Appliquer `supabase/migrations/0009_phase0b_rls_cutover.sql`. Les gardes internes (`raise exception`)
  bloquent si une précondition manque → dans ce cas, **NE PAS forcer**, passer en analyse/rollback.
- Vérif : lancer `supabase/verification/0009_postflight_readonly.sql` + le **harness de contrat**
  `supabase/verification/cutover_contract_harness.sql` (doit finir `CONTRACT HARNESS OK`).

### B5. Appliquer les verticaux `0010 → 0052` (ordre numérique)
- Appliquer dans l'ordre : `0010` … `0031`, `0032_produits_bar_multi_venue_carte_eden`, `0033` …
  `0051`, `0052_active_event_venue`. (43 fichiers.)
- Après chaque migration à vérification, exécuter le fichier `supabase/verification/<n>_*.sql`
  correspondant (lecture, `rollback`). Points de contrôle : `0042` (Realtime = 4 tables), `0043`
  (TRUNCATE révoqué), `0044/0045` (isolation promoteur / relation server).

### B6. Durcissement `0053` (dernière migration de la chaîne)
- `0053_revoke_anon_all_tables.sql` — révoque tout grant de table anon (défense en profondeur ;
  additif/idempotent).
- Vérif finale : re-lancer `cutover_contract_harness.sql` → `CONTRACT HARNESS OK`.

> **Neutralisation du mot de passe legacy = NON ici.** C'est une **action manuelle post-cutover**
> (`supabase/manual_actions/neutralize_legacy_password.sql`, mode B) exécutée en PHASE C, **après** que
> le login GoTrue est confirmé en prod et le backup pris — jamais par le runner de migrations.

---

## PHASE C — APRÈS
Exécuter `docs/PRODUCTION_POST_CUTOVER_VERIFICATION.md` intégralement (login 7 rôles réels, résa,
dépense, QR, Realtime, cycle d'événement, surveillance erreurs, front mobile). Ne déclarer le cutover
réussi qu'après **toutes** les cases vertes.

### C-bis. Neutralisation du mot de passe legacy (action manuelle, mode B)
- **Seulement après** login GoTrue prouvé (C ci-dessus) **et** backup/PITR confirmé. Session SQL
  manuelle : `set clubone.cutover_authorization = 'NEUTRALIZE LEGACY PASSWORD - FOUNDER APPROVED';` puis
  exécuter `supabase/manual_actions/neutralize_legacy_password.sql`. Vérif : plus aucun clair réel.
  N'affiche/n'exporte aucune valeur de mot de passe.

---

## Critères d'ARRÊT IMMÉDIAT (→ rollback runbook)
- Une garde `raise exception` d'une migration se déclenche (précondition manquante).
- Le harness de contrat échoue après `0009` ou après `0053`.
- Un rôle ne peut pas se connecter (GoTrue) ou voit des données hors de son périmètre.
- Realtime ne délivre pas, ou délivre à un rôle non autorisé (fuite).
- Toute anomalie de données (comptes de tables ≠ 18, archives incohérentes).
- Doute non levé du décideur rollback.

**Ne jamais** : forcer une migration dont la garde a sauté ; désactiver la RLS pour « débloquer » ;
continuer au-delà d'un item preflight/postflight rouge.
