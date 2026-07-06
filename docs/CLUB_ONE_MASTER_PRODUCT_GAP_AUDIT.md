# Club One — AUDIT MASTER DE LA VISION PRODUIT COMPLÈTE

*Audit lecture seule. Aucun code écrit, aucune migration exécutée, aucune écriture production, aucun
changement de périmètre. Toutes les preuves sont citées en `fichier:ligne`.*

- **Date** : 2026-07-06
- **Branche** : `feat/club-one-launch-july-2026`
- **Méthode** : inventaire central (migrations 0000→0053, 52 fichiers de test / 872 cas, `APP_TABS`
  29 onglets, 3 routes client) + 6 sous-audits contradictoires (un par LOT), chacun vérifiant le code
  réel (pas les WORKLOG/PROGRAM_STATE), avec distinction stricte des niveaux de preuve.
- **Niveau de preuve atteint** : lecture statique + validation locale (tests Node statiques). **Aucune
  exécution SQL réelle sur base de production** n'a été faite ni vérifiée dans cet audit.

---

## 0. Légende des statuts (vocabulaire imposé)

| Statut | Signification opérationnelle |
|---|---|
| **COMPLETE_AND_UI_PROVEN** | DB/RPC + lib + écran réel câblé dans `app/page.tsx` (ou route client réelle) lisant/écrivant des données Supabase live + tests. Utilisable de bout en bout. |
| **BACKEND_ONLY** | Migration/RPC/lib présents et testés, mais AUCUN écran réel ne l'appelle (souvent monté uniquement en `*-preview` en mémoire). |
| **FRONTEND_ONLY** | Écran/composant existe mais sans backend réel branché (démo/preview, données fictives). |
| **PARTIAL** | Une partie fonctionne réellement, une partie annoncée manque (ex. « prévu » sans « réel »). |
| **PLACEHOLDER** | Coquille honnête (« NON ACTIVÉ », « bientôt disponible ») sans logique derrière. |
| **ABSENT** | Aucun code (ni table, ni lib, ni écran). |

**Échelle de priorité (vocabulaire imposé)** : le **LOT A** (porte de lancement) utilise `P0`→`P2` ;
les **LOTS B→G utilisent exclusivement `HAUTE` / `MOYENNE` / `BASSE`** (aucun mélange P/mots dans un
même lot). Correspondance : `P0` = bloquant lancement · `P1` ≈ `HAUTE` · `P2` ≈ `MOYENNE` · `P3` ≈ `BASSE`.

**Fait structurant transverse** : le registre de feature flags (`lib/featureFlags.ts`) n'est PAS branché
dans `app/page.tsx` (référencé seulement par `AdminView.tsx`). Les onglets s'affichent via
`visibleTabsForRole` (`lib/permissions.ts:167-187`) — donc « flag OFF » = affichage administratif, pas
un vrai verrou. Les onglets `APP_TABS` rendent bien pour la direction, indépendamment du flag.

---

## 1. LOT A — SOCLE PRODUCTION ET STABILISATION

> Rappel niveau de preuve : tout ce qui est « vert » ici est **écrit + rejoué sur un CLONE isolé
> (niveau 4, partiel 5)**, JAMAIS exécuté en production (niveau 6). Aucun GO cutover donné.

### A1 — Auth (Supabase Auth / JWT + durcissement login legacy)
- **STATUT** : BACKEND_ONLY
- **TABLES/RPC** : `staff_users.password_hash`, `set_staff_password`, `verify_staff_login` (0001) ; RLS lockdown (0002) ; `auth_id`, `current_staff_role()`, `get_my_profile()` (0003:21-66) ; revoke TRUNCATE + login legacy (0043:55-67)
- **ÉCRANS** : `lib/authSession.ts` (signIn via `auth.signInWithPassword` email synthétique `authSession.ts:82-85`)
- **TESTS** : aucun test dédié au flux d'auth ; `governance.test.mts` teste seulement l'absence de secrets
- **CE QUI FONCTIONNE** : chemin réel = Supabase Auth, pas la RPC legacy ; `verify_staff_login` ne renvoie aucun hash ; 0043 révoque son EXECUTE
- **CE QUI MANQUE** : (a) colonne clair `password` toujours présente (drop différé, action manuelle `supabase/manual_actions/neutralize_legacy_password.sql`, GO-gated) ; (b) `verify_staff_login` révoquée mais non supprimée (surface dormante) ; (c) aucun test unitaire de `authSession`
- **DÉPENDANCES** : `staff_users.auth_id` peuplé pour CHAQUE compte (précondition dure de 0009)
- **RISQUES** : **Important** — mots de passe en clair persistent jusqu'à l'action manuelle en fenêtre de cutover
- **PRIORITÉ** : HAUTE

### A2 — RLS + event scope + venue scope (cutover 0008→0009→0052)
- **STATUT** : BACKEND_ONLY
- **TABLES/RPC** : `club_runtime_state`, `get_active_event_context`, `bootstrap/activate/close_club_event_v2`, `add_expense_v3`, `check_in_invitation_v2`, `add_entry_log_v2`, `create_promoter_invitation_v2`, `get_security_table_snapshot` (0008) ; policies event-scoped + ~30 gardes `raise exception` (0009:20-196) ; `venue_id/venue_name` (0052:20-47)
- **ÉCRANS** : `lib/activeEvent.ts` (fail-closed `requireActiveEvent` `:151-157`), câblé dans `app/page.tsx`
- **TESTS** : `rlsCutover.test.mts` (16 cas statiques), `activeEventSelector.test.mts`
- **CE QUI FONCTIONNE** : 0008 non destructif ; 0009 transactionnel gardé (singleton, tous `auth_id` liés, exactement 18 tables, aucune ambiguïté de date) ; `revoke all … from anon` (0009:450)
- **CE QUI MANQUE** : exécution prod (par design) ; bootstrap du 1ᵉʳ event = étape MANUELLE entre 0008 et 0009 (`FINAL_MIGRATION_ORDER.md:13`) ; équivalence renumérotation 0032→0052 argumentée mais sans test de schema-diff en dépôt
- **DÉPENDANCES** : bootstrap manuel ordonné ; `auth_id` complet ; `events` unique par date
- **RISQUES** : **Bloquant si** appliqué en prod sans bootstrap manuel ou avec `auth_id` incomplet (0009 abandonne toute la transaction — fail-safe, mais bloque le cutover)
- **PRIORITÉ** : HAUTE

### A3 — Isolation promoteur / serveur (0044/0045)
- **STATUT** : BACKEND_ONLY
- **TABLES/RPC** : policies `club_tables` promoteur (`assigned_to = current_staff_username()`, 0044:54-115), `add_expense_v3` durci (0044:201 / final 0045:179), `events_write` sans promoteur (0044:219-223) ; serveur dé-hardcodé `co_is_server_table_scope` (0045:36-64)
- **ÉCRANS** : miroir TS `lib/permissions.ts:243-282`
- **TESTS** : `permissions.test.mts` teste la LOGIQUE TS seulement. **Aucun test n'assère le texte SQL de 0044/0045.** `rlsCutover.test.mts:152-169` assère encore les policies **superséedées de 0009**
- **CE QUI FONCTIONNE** : la faille SECURITY DEFINER de `add_expense_v3` est fermée ; hardcode `'jeremy'/'server'` supprimé ; rejoué live sur clone (promoteur1 voit 1 table, promoteur2 voit 0)
- **CE QUI MANQUE** : garde-test statique sur le texte de 0044/0045 — les migrations les plus sensibles du lot ont la couverture statique la plus faible
- **RISQUES** : **Important** — une future édition de 0044/0045 ne serait attrapée par aucun test
- **PRIORITÉ** : HAUTE

### A4 — Verrouillage anon (0053)
- **STATUT** : BACKEND_ONLY
- **TABLES/RPC** : `revoke all on all tables … from anon` + `alter default privileges … revoke` (0053:27-49)
- **TESTS** : aucun (aucune référence à 0053 dans `tests/`)
- **CE QUI FONCTIONNE** : idempotent, corrige la brèche latente où 0046-0051 réacquièrent des grants anon via default privileges ; rejoué sur clone (anon `SELECT club_tables` → 42501)
- **CE QUI MANQUE** : test de non-régression « anon = 0 grant » ; résidu cosmétique `0054:` dans les `raise notice` (0053:38,46)
- **RISQUES** : **Mineur** (défense en profondeur ; RLS déjà fail-closed)
- **PRIORITÉ** : MOYENNE

### A5 — Santé de la suite de tests
- **STATUT** : PARTIAL
- **TESTS** : 52 fichiers `tests/*.test.mts` / 872 cas ; 52 scripts `test:*` dans `package.json`. **AUCUNE clé `"test"` agrégée** → `npm test` échoue (« Missing script: test »)
- **CE QUI FONCTIONNE** : couverture large par module ; `governance.test.mts` teste le VRAI hook `guard.cjs` (bloque push/db push/psql 0008-0009/.env) ; `migrationsRegistry.test.mts` garantit 0000..N contigu, zéro collision
- **CE QUI MANQUE** : (a) script `test` agrégé / CI ; (b) tous les tests sont niveau 3 statique sauf le hook — AUCUN n'exécute de SQL sur Postgres ; (c) aucune couverture SQL de 0044/0045/0053 ; (d) `rlsCutover.test.mts` assère des policies 0009 supersédées (fausse confiance)
- **RISQUES** : **Important** — « tests verts » = « le texte SQL correspond », pas « les migrations s'exécutent correctement »
- **PRIORITÉ** : HAUTE

### A6 — Paquet de cutover (docs)
- **STATUT** : PARTIAL
- **NATURE** : dossier documentaire — le paquet (runbooks, harnais, scripts E2E) est **construit et rejoué sur clone** mais **non exécuté ni prouvé en production** (GO-gated, NO-GO), d'où PARTIAL. Les 6 statuts qualifient d'ordinaire des fonctionnalités applicatives ; ici on classe la maturité du dossier de bascule.
- **REHEARSAL** : `CUTOVER_REHEARSAL_RESULT.md` — **PASSED niveau 4 + partiel 5** sur clone isolé `fhpttgtjxpzexvwtylhv`, prod touchée en lecture seule uniquement, **GO NON donné**
- **DISCORDANCE À SIGNALER** : `PRODUCTION_CUTOVER_PACKAGE.md:42-43,105-106` prétend « GOTRUE E2E PASSED » et « REALTIME WEBSOCKET E2E PASSED » ; le doc rehearsal du MÊME jour les liste comme NON vérifiés. Les scripts (`scripts/gotrue-e2e.mjs`, `scripts/realtime-e2e.mjs`) ont depuis été **rejoués sur le clone non-prod et ont PASSÉ** (niveau 5 sur clone, jamais niveau 6 prod) : la mention « non vérifié » de `CUTOVER_REHEARSAL_RESULT.md §5` est une **trace historique désormais périmée** (écrite avant le rejeu). Le commit de gel `9affa66` n'est **pas** modifié → réconciliation de cette ligne dans un commit futur. **Ne vaut pas preuve de production.**
- **CE QUI MANQUE** : exécution prod, neutralisation manuelle des mots de passe, preuve indépendante re-jouable ; équivalence `fns_md5` expliquée plutôt qu'éliminée
- **RISQUES** : **Important** — l'équivalence repose sur une baseline prod RECONSTRUITE (prod bâtie hors-migration, ≠ 0001-0007)
- **PRIORITÉ** : HAUTE

**Synthèse LOT A** : socle **statiquement complet et rejoué sur clone (niveau 4/5 partiel), jamais
prod, sans GO**. Les 2 migrations les plus critiques (0044/0045) et 0053 n'ont **aucun garde-test
statique** ; les 2 preuves de plus haute valeur (GoTrue login, Realtime WS) sont **affirmées PASSED
dans le paquet mais listées non vérifiées dans le doc rehearsal du même jour**.

---

## 2. LOT B — COCKPIT DIRECTION ET PERSONNEL

### B1 — Cockpit global de direction
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **TABLES/RPC** : aucune table propre (D-01) ; agrège 10 sources live (`club_tables, entry_logs, incidents, stock_items, stock_movements, maintenance_interventions, commercial_leads, marketing_campaigns, table_reservation_requests, soiree_charges`) — `DirectionCockpitView.tsx:52-63`
- **ÉCRANS** : `app/_modules/cockpit/DirectionCockpitView.tsx`, rendu réel `app/page.tsx:3190-3191`
- **TESTS** : `tests/directionCockpit.test.mts`
- **CE QUI FONCTIONNE** : agrégation live `Promise.all` de 10 requêtes ; CA calculé live depuis `club_tables.expenses` ; guard direction-only
- **CE QUI MANQUE** : marge = ESTIMATION (personnel/pub/achats/JDC non connectés — `directionCockpit.ts:14-16`) ; le CA du cockpit vient des **dépenses tables**, pas du **Z de caisse réel** (≠ le P&L comptable de `PnlView`)
- **RISQUES** : **Mineur** (honnêteté explicite) → **Important** si le libellé « estimation » disparaît
- **PRIORITÉ** : BASSE

### B2 — Cockpit manager (CommandCenter)
- **STATUT** : PARTIAL
- **ÉCRANS** : `components/CommandCenter.tsx`, rendu live `app/page.tsx:3202-3229`
- **TESTS** : `tests/commandCenter.test.mts`
- **CE QUI FONCTIONNE** : 3 signaux live — remplissage, CA (`stats.revenue`), incidents ; 17 domaines rendent un honnête « non branché »
- **CE QUI MANQUE** : 17/20 domaines non alimentés (présence, résa, captation, checklists, leads, avis, campagnes…) ; CA `complet:false` en dur
- **RISQUES** : **Important** — cockpit surtout composé de tuiles vides
- **PRIORITÉ** : MOYENNE

### B2bis — Mode Soirée (ModeSoireeCockpit)
- **STATUT** : FRONTEND_ONLY
- **PRIORITÉ** : MOYENNE

### B3 — Personnel (staff_members)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **ÉCRANS** : `RhView` (`app/page.tsx:3091-3101`), insert live `staff_members` (`app/page.tsx:2565-2572`)
- **TESTS** : `tests/rhPlanning.test.mts`
- **CE QUI MANQUE** : protection PII (`taux_horaire`/`notes_direction`) app-side seulement, pas de RLS colonne DB (`app/page.tsx:1056-1059`)
- **RISQUES** : **Important** (durcissement PII)
- **PRIORITÉ** : MOYENNE

### B4 — Horaires / planning (staff_shifts)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **ÉCRANS** : `RhView` + rollup `lib/rhRollup.ts` ; upsert live `staff_shifts` (`app/page.tsx:2598-2612`)
- **TESTS** : `rhRollup.test.mts`, `rhPlanning.test.mts`
- **CE QUI MANQUE** : coût staff seulement si taux+heures complets (partiel honnête) ; pas de planification auto
- **PRIORITÉ** : BASSE

### B5 — Présences (self-confirm)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **TABLES/RPC** : `confirm_my_shift_v1` SECURITY DEFINER (0020:24-90)
- **ÉCRANS** : `SelfPlanningView` onglet `monplanning` (`app/page.tsx:3103-3110`)
- **TESTS** : `rhSelf.test.mts`
- **CE QUI MANQUE** : seulement self-confirm ; pas de pointage présent/absent temps réel, pas de géoloc
- **PRIORITÉ** : BASSE

### B6 — Tâches (task management)
- **STATUT** : ABSENT
- **CE QUI MANQUE** : aucune table `tasks` (0000-0053) ; pas de tâches assignables/échéances/workflow
- **PRIORITÉ** : MOYENNE

### B7 — Performance du personnel
- **STATUT** : ABSENT
- **CE QUI MANQUE** : aucune table/score/évaluation staff ; RH capture des faits de présence bruts, pas une métrique de performance
- **PRIORITÉ** : BASSE

---

## 3. LOT C — AGENDA ET ORGANISATION DES SOIRÉES

> **Plafond structurel** : AUCUNE UI ne crée un événement. Seul chemin de création d'`events` = SQL
> manuel/seed (`supabase/manual_actions/bootstrap_launch_event_TEMPLATE.sql:15`). Dans l'app, `events`
> est toujours en LECTURE seule.

### C1 — Agenda interactif mensuel des soirées
- **STATUT** : PARTIAL
- **ÉCRANS** : `app/_modules/agenda/AgendaView.tsx`, onglet `agenda` (`app/page.tsx:3194-3195`) ; agrège 5 sources live
- **TESTS** : `tests/agenda.test.mts` (4 cas)
- **CE QUI MANQUE** : **pas de grille de mois, pas de jours cliquables, pas de navigation mois±1** ; rendu = `<ul>` plat (`AgendaView.tsx:66-77`) ; aucun clic → fiche/jour ; lecture seule
- **RISQUES** : écart produit fort (fondateur attend un agenda mensuel interactif ; livré = flux de rappels)
- **PRIORITÉ** : HAUTE

### C2 — Cycle de vie événement (bootstrap/activate/close v2)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **TABLES/RPC** : `get_active_event_context`, `bootstrap/activate/close_club_event_v2`, `list_activatable_club_events` (0008/0009/0016/0052)
- **ÉCRANS** : câblé live `app/page.tsx:2315-2325, 2876, 4281` ; `lib/activeEvent.ts`
- **CE QUI MANQUE** : on n'active que des events **déjà créés en SQL** (pas de création)
- **PRIORITÉ** : BASSE

### C3 — Checklists ouverture/fermeture
- **STATUT** : PARTIAL
- **ÉCRANS** : `app/_modules/ops/ChecklistsView.tsx` (`app/page.tsx:3178-3179`) ; cochage live + insert/delete `checklist_completions`
- **TESTS** : `tests/checklists.test.mts` (24 cas)
- **CE QUI MANQUE** : **aucune UI de composition d'items** (`validateItemDraft`/`canManageChecklistItems` non utilisés dans la vue) — la direction ne peut pas créer d'items depuis l'app ; module « ship VIDE » (`lib/checklists.ts:6`)
- **PRIORITÉ** : HAUTE

### C4 — Communication interne
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **ÉCRANS** : `InternalCommsView.tsx` (`app/page.tsx:3182-3183`) ; cycle complet live (lecture + création + accusé de lecture)
- **TESTS** : `internalComms.test.mts` (32 cas)
- **PRIORITÉ** : BASSE

### C5 — Accueil / check-in artiste
- **STATUT** : PARTIAL
- **ÉCRANS** : `ArtistCheckinView.tsx` (`app/page.tsx:3186-3187`) ; avancement jalons live (attendu→arrivé→balance→prêt)
- **TESTS** : `artistCheckin.test.mts` (21 cas)
- **CE QUI MANQUE** : **aucune création de fiche artiste** (que du `update` ; insert introuvable dans `app/`) — fiches nées par SQL/seed seulement
- **PRIORITÉ** : MOYENNE

### C6 — Captation / DAM
- **STATUT** : BACKEND_ONLY
- **TABLES/RPC** : `shot_list_items`, `shot_captures` (0029)
- **ÉCRANS** : `components/CaptationBoard.tsx` monté **uniquement** dans `app/captation-preview` (données fictives) ; `captation` ABSENT de `APP_TABS`
- **TESTS** : `captation.test.mts` (25 cas, logique pure)
- **CE QUI MANQUE** : aucun accès Supabase live, aucun onglet, aucune écriture réelle
- **PRIORITÉ** : HAUTE

### C7 — Création / planification d'événement (UI)
- **STATUT** : ABSENT
- **CE QUI MANQUE** : aucune RPC `create_event`, aucun formulaire de création de soirée future ; events créés à la main en SQL. Un manager ne peut pas planifier une soirée, seulement l'ACTIVER une fois créée en base
- **RISQUES** : écart de vision majeur — « organisation des soirées » sans capacité à créer une soirée ; bloque partiellement C1, C2
- **PRIORITÉ** : HAUTE

---

## 4. LOT D — CRM ET IDENTITÉ CLIENT (côté staff)

> Vigilance : l'onglet **« clients »** (`ClientsView`) n'est PAS le CRM — il dérive des tables live de
> la soirée (`app/page.tsx:1931-1960`). Le vrai répertoire CRM est l'onglet **« crm »** (`CrmView`).

### D1 — CRM client (fiches guests)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **TABLES/RPC** : `public.guests` (0013:32-55). Colonnes réelles : `phone` (unique E.164), `first_name`, `last_name`, **`birthday` PRÉSENT** (0013:38), `majorite_verifiee`, consentements **DÉGROUPÉS + horodatés + texte exact** (`consent_service*`, `consent_marketing*`, `consent_source`, 0013:41-49), `opt_out_at` (STOP définitif, trigger 0013:275-297), `owner_promoter`, `notes`, provenance (0017), `space_token` (0019)
- **ÉCRANS** : `CrmView` (`app/page.tsx:7590+`), fetch `fetchCrmData` (`:1207-1261`)
- **TESTS** : `crmClients.test.mts`, `crmFunnel.test.mts`
- **CE QUI MANQUE** : **aucune colonne `email`** (canal = WhatsApp/téléphone) ; **`preferences` ABSENT** (seul `notes` libre) ; pas d'écran d'édition directe d'une fiche guest ; pas de `image_consent`
- **PRIORITÉ** : BASSE

### D2 — Historique des visites
- **STATUT** : PARTIAL
- **TABLES/RPC** : `guest_visits` (0013:64-80) ; alimenté par scan porte (0015), clôture (0016), approbation résa (0025)
- **ÉCRANS** : historique par guest rendu **uniquement côté client** (`get_guest_space_v1`, `/espace/[token]`). Côté staff, `guest_visits` lu seulement pour dériver la prochaine résa
- **CE QUI MANQUE** : aucun écran staff « fiche client → ses visites datées »
- **PRIORITÉ** : MOYENNE

### D3 — Historique des réservations
- **STATUT** : BACKEND_ONLY
- **TABLES/RPC** : `table_reservation_requests` (FK `guest_id`, 0025:41-60) ; `request_/decide_table_reservation_v1`
- **ÉCRANS** : `ReservationBoard.tsx`/`ReservationRequestQueue.tsx` montés SEULEMENT en `*-preview` ; non câblés dans `app/page.tsx`
- **TESTS** : `resaRequest.test.mts`, `resaBoard.test.mts`
- **CE QUI MANQUE** : pas d'écran staff en prod pour traiter la file ; avertissement anti-abus anon BLOQUANT (0025:26-30)
- **PRIORITÉ** : HAUTE

### D4 — Historique des dépenses (par client)
- **STATUT** : PARTIAL
- **TABLES/RPC** : `guest_visits.spend_attributed` (0013:74, NULL=non identifié) ; agrégat `guest_scores.spend_seated_12m`
- **CE QUI MANQUE** : **aucun chemin de SAISIE de `spend_attributed`** (ni RPC ni écran) — les tables live `ClubTable` ne sont pas reliées à `guests`. La colonne reste NULL → historique dépenses par client structurellement vide
- **RISQUES** : principal trou vision « dépenses par client » (socle prêt mais non alimenté)
- **PRIORITÉ** : HAUTE

### D5 — Comptes clients
- **STATUT** : PARTIAL
- **TABLES/RPC** : `guests.space_token` (0019:50-54) + `get_guest_space_v1` (anon lecture seule)
- **CE QUI MANQUE** : pas de vrai compte authentifié (pas de Supabase Auth client, pas de mot de passe, pas d'édition self-service). Les « clients » sont des fiches `guests` gérées par le staff
- **PRIORITÉ** : BASSE

### D6 — Segmentation marketing (RFM / segments)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **TABLES/RPC** : vue `guest_scores` (RFM à la volée, 0013:116-147 / 0018) ; `classifyGuest` TS pur, 7 segments (`crmClients.ts:284-334`)
- **ÉCRANS** : grille segments réelle `CrmView` (`app/page.tsx:7693-7711`) + call-list du mardi plafonnée
- **TESTS** : `crmCallList.test.mts`, `crmClients.test.mts`
- **CE QUI MANQUE** : dépend de `spend_attributed`/visites datées ; sur base OctoTable seule tout retombe en « historique » ; segmentation **non connectée** à `marketing_campaigns`
- **PRIORITÉ** : BASSE

### D7 — Boards CRM riches (leads / réputation / inbox)
- **STATUT** : FRONTEND_ONLY
- **ÉCRANS** : `CallListBoard`, `InboxTriageBoard`, `ReputationBoard`, `LeadsPipelineBoard` → seulement `*-preview` ; aucun onglet dans la nav
- **TESTS** : `inboxTriage.test.mts`, `leadsPipeline.test.mts`, `reputation.test.mts`
- **CE QUI MANQUE** : câblage dans la nav réelle
- **PRIORITÉ** : HAUTE

---

## 5. LOT E — PORTAIL CLIENT ET QR ONBOARDING

### E1 — Création de profil depuis un QR
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **TABLES/RPC** : `invite_links`, `guest_passes`, `guests` ; `get_invite_link_public`, `register_guest_via_invite_v1`, `resolve_space_from_pass_v1` (anon, 0014/0019)
- **ÉCRANS** : `app/i/[token]/page.tsx` (formulaire → `register_guest_via_invite_v1` `:255`)
- **TESTS** : `crmFunnel.test.mts` (18 cas, logique pure)
- **CE QUI FONCTIONNE** : le client crée LUI-MÊME sa fiche ; token serveur `gen_random_uuid` ; 18+ à la date de soirée ; dédup par téléphone additive ; quota atomique ; idempotence re-scan
- **CE QUI MANQUE** : ce n'est pas un « compte » (pas de mot de passe ; identité = téléphone non vérifié) ; le QR est généré par un PROMOTEUR staff, pas un QR « ouvert » générique
- **RISQUES** : téléphone non vérifié (pas d'OTP) → inscription d'un numéro non possédé ; token invite = porteur
- **PRIORITÉ** : MOYENNE

### E2 — Collecte date de naissance, préférences, consentements
- **STATUT** : PARTIAL
- **ÉCRANS** : `app/i/[token]` — Prénom*, Nom, Téléphone*, **Date de naissance***, Consentement service, Consentement marketing (dégroupés, non pré-cochés, journalisés texte exact)
- **CE QUI MANQUE** : **aucun champ « préférences »** (musique/table/allergies) ; les 2 cases de consentement sont **désactivées tant que `NEXT_PUBLIC_CLUB_RAISON_SOCIALE`/cadence/URL politique ne sont pas configurées** (`app/i/[token]/page.tsx:454,464`) → en l'état, **aucun consentement réellement recueillable** ; pas de recueil du droit à l'image
- **RISQUES** : la « collecte des préférences » de la vision n'existe pas ; consentements inertes sans config env
- **PRIORITÉ** : HAUTE

### E3 — Agenda du mois dans le compte client
- **STATUT** : ABSENT
- **CE QUI MANQUE** : `get_guest_space_v1` ne renvoie QUE les visites/passes DU client ; **aucune programmation mensuelle du club**, aucun composant calendrier, aucune RPC anon listant les events publiés du mois. Le client ne voit que ses réservations, pas les soirées qu'il pourrait rejoindre
- **RISQUES** : écart de vision majeur — pas de découverte d'events côté client
- **PRIORITÉ** : MOYENNE

### E4 — Réservations client (demande de table)
- **STATUT** : BACKEND_ONLY
- **TABLES/RPC** : `request_table_reservation_v1` (anon), `decide_table_reservation_v1` (0025, durci 0030)
- **ÉCRANS** : `components/TableReservationRequest.tsx` monté uniquement dans `app/plan-salle-resa-preview` (banc EN MÉMOIRE sans Supabase) ; 0030:24 confirme « la RPC n'est encore montée nulle part »
- **TESTS** : `resaRequest.test.mts` (24 cas)
- **CE QUI MANQUE** : aucune route client réelle n'appelle `request_table_reservation_v1` ; pas de page anon `/resa/[slug]`
- **RISQUES** : anti-abus BLOQUANT non résolu (décision fondateur : captcha/OTP/jeton signé, 0025:26-30/0030:6-8)
- **PRIORITÉ** : HAUTE

### E5 — Invitations client
- **STATUT** : FRONTEND_ONLY
- **ÉCRANS** : `app/invite/[token]` (une invitation legacy) + section « Mes QR d'entrée » de `/espace/[token]`
- **CE QUI MANQUE** : aucun transfert/forward, aucune gestion (annuler, inviter un ami), aucune liste consolidée. Le client subit les invitations
- **PRIORITÉ** : BASSE

### E6 — Compte client / login
- **STATUT** : ABSENT
- **TABLES/RPC** : `guests.space_token` uuid opaque (0019:50-54)
- **CE QUI MANQUE** : aucune authentification client ; quiconque détient le lien accède ; pas de récupération si lien perdu
- **RISQUES** : lien mini-espace = porteur non expirable → fuite = accès permanent jusqu'à régénération manuelle
- **PRIORITÉ** : MOYENNE

---

## 6. LOT F — MARKETING AUTOMATISÉ ET FIDÉLITÉ

> **Constat central** : la vision « marketing automatisé + fidélité » est quasi entièrement **ABSENTE**.
> Ce qui existe = un unique **registre comptable manuel de campagnes** + un **CRM manuel (clic humain
> `wa.me`)**. Règle d'architecture dure : aucun module n'auto-envoie à un client (`lib/agentOrchestrator.ts:20,101`).

### F1 — Segmentation marketing (côté campagnes)
- **STATUT** : ABSENT
- **TABLES/RPC** : `marketing_campaigns` seul (0050:21-37) — name, channel (texte libre), budget/spent, promo_code (texte), attributed_revenue/reservations. **Aucune table audience/segment/recipient, aucun join `guests`, aucun `promo_codes`, aucun `channels`**
- **ÉCRANS** : `MarketingView.tsx`
- **TESTS** : `marketing.test.mts` (ROAS/CAC math)
- **CE QUI MANQUE** : toute notion de ciblage d'un sous-ensemble de clients ; la segmentation CRM (D6) n'est PAS connectée aux campagnes
- **PRIORITÉ** : HAUTE

### F2 — Relances anniversaires
- **STATUT** : PARTIAL
- **CE QUI FONCTIONNE** : `crmCallList.ts:120-152` calcule J-14 anniversaire + message suggéré + **lien wa.me manuel**. Un humain doit ouvrir WhatsApp
- **CE QUI MANQUE** : aucun trigger/scheduler/envoi automatique (pas de cron/edge function)
- **PRIORITÉ** : MOYENNE

### F3 — Relances des clients inactifs (win-back)
- **STATUT** : PARTIAL
- **CE QUI FONCTIONNE** : `crmClients.ts:319` classe `dormant` ≥45j ; call-list plafonnée 5/semaine, liens wa.me manuels
- **CE QUI MANQUE** : job de détection + outreach automatisés ; pas de queue, pas d'envoi
- **PRIORITÉ** : MOYENNE

### F4 — Offres promotionnelles ciblées
- **STATUT** : ABSENT
- **CE QUI MANQUE** : `marketing_campaigns.promo_code` = simple texte libre (0050:30). Aucune table `promo_codes`, aucune génération/validation/redemption/limite/ciblage/expiration. L'UI a un input « Code promo » qui ne fait rien
- **PRIORITÉ** : HAUTE

### F5 — SMS, email et notifications
- **STATUT** : ABSENT
- **TABLES/RPC** : **aucune table `message_queue`** ; **aucun `lib/messaging/`, `lib/campaigns.ts`, `lib/notifications*`** (Glob : rien). `lib/agenda.ts` n'est PAS une file d'envoi (agrégateur pur)
- **CE QUI FONCTIONNE** : `adapterStatus()` renvoie « NON ACTIVÉ » ; préparation de liens `wa.me`/`mailto` cliqués par un humain, avec gardes consentement/opt-out/Loi Évin AVANT construction du lien
- **CE QUI MANQUE** : adaptateurs réels (aucune dépendance Twilio/SendGrid/WhatsApp-API), credentials, file d'envoi, tracking de livraison, retry, scheduler. Confirme PROGRAM_STATE 8b + **BLOCKER programme G-7** (adaptateurs externes ; la tâche de construction correspondante est **F-1** de la roadmap)
- **PRIORITÉ** : HAUTE

### F6 — Fidélité et avantages (loyalty)
- **STATUT** : ABSENT
- **CE QUI MANQUE** : aucune table loyalty/points/tier/reward ; aucun accrual/redemption/tiers/perks. Le plus proche = le flag « vip » (une classification, pas un moteur de points)
- **PRIORITÉ** : HAUTE

### F7 — UI Marketing (registre de campagnes)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **ÉCRANS** : onglet `marketing` permanent (`permissions.ts:35`), lit/écrit `marketing_campaigns` live, admin/manager-only (RLS 0050:47-58)
- **Dérive registre** : `featureFlags.ts` liste encore `campaigns` défaut false alors que le tab est permanent (flag mort pour ce module)
- **PRIORITÉ** : BASSE

---

## 7. LOT G — FINANCE, REPORTING ET PILOTAGE GLOBAL

### G1 — Rapports promoteurs
- **STATUT** : PARTIAL
- **ÉCRANS** : bloc « contribution par promoteur » (`app/page.tsx:4919-4943`), CA live via `groupTotal`
- **CE QUI MANQUE** : liste promoteurs **codée en dur** `["mathias","quentin","lawrence"]` (`app/page.tsx:4808`) — un promoteur hors liste n'apparaît jamais ; `lib/securityRevenue.ts` **orphelin, importé nulle part, sans test** ; `promoter_guest_entries` chargée mais non agrégée
- **RISQUES** : rapport faux/incomplet si promoteurs réels ≠ liste en dur
- **PRIORITÉ** : HAUTE

### G2 — Rapports serveurs
- **STATUT** : ABSENT
- **CE QUI MANQUE** : aucune agrégation « tables servies / dépenses par serveur », aucun écran. Ne pas confondre isolation (faite) et reporting (absent)
- **PRIORITÉ** : MOYENNE

### G3 — Analyse financière globale (P&L soirée + période)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **TABLES/RPC** : `caisse_z` (0010), `soiree_charges` (0012), shifts RH (0011)
- **ÉCRANS** : `PnlView` (`app/page.tsx:3075-3088`)
- **TESTS** : `pnlSoiree.test.mts`, `pnlPeriode.test.mts`, `caisseZ.test.mts`
- **CE QUI FONCTIONNE** : produit = **Z de caisse réel** ; charge staff = coût réel du pointage RH ; charge artistes = booking réel ; discipline « jamais de coût partiel fantôme » ; rapprochement CA bar caisse ↔ CA tables
- **CE QUI MANQUE** : rapprochement CA tables au niveau période absent (tables remises à zéro à la clôture) ; pas de charges hors staff/artistes (loyer, achats). **Deux « vérités » de CA coexistent** : Z réel (`PnlView`) vs dépenses tables (cockpit direction) — risque de confusion
- **PRIORITÉ** : BASSE

### G4 — Budget prévu vs réel (0051)
- **STATUT** : PARTIAL
- **ÉCRANS** : `BudgetView` onglet `budget` (`app/page.tsx:3174-3176`), insert/select `budget_forecasts` live
- **CE QUI MANQUE** : colonne « Réel » affiche **« NON CONNECTÉ » en dur** (`BudgetView.tsx:118`) ; `variance()` existe mais aucun `reelCents` réel ne lui est jamais fourni. Donc « prévu vs réel » = **prévu seulement**
- **RISQUES** : promesse « prévu vs réel » non tenue
- **PRIORITÉ** : HAUTE

### G5 — Pilotage de tous les espaces de L'Arche (multi-venue)
- **STATUT** : PARTIAL
- **TABLES/RPC** : `venue_tables` (0024, seed **Eden uniquement**, 44 tables), `kind` (0031), `produits_bar.venue` (0032), venue actif (0052)
- **ESPACES RÉELS** : Eden = plan complet (44 tables) ; Terminus = plan « club » legacy (18 tables) ; **Cercle = AUCUN plan/seed** (univers déclaré mais vide) ; « rooftop » = l'Eden lui-même (`lib/rooftop3d.ts:1-6`), rendu 3D en preview hors app
- **CE QUI MANQUE** : pas de console « pilotage simultané de tous les espaces » ; Cercle non planifié ; pas de vue occupation multi-espace unifiée temps réel
- **RISQUES** : vision « piloter TOUS les espaces » **surestimée** — essentiellement Terminus + Eden
- **PRIORITÉ** : HAUTE

### G6 — Verticales support (stock / suppliers / commercial / maintenance)
- **STATUT** : COMPLETE_AND_UI_PROVEN
- **TABLES/RPC** : 0047/0048/0049/0046
- **ÉCRANS** : `StockView`/`SuppliersView`/`CommercialView`/`MaintenanceView` (`app/page.tsx:3154-3166`), fetch live
- **TESTS** : `stock/suppliers/commercial/maintenance.test.mts`
- **CE QUI MANQUE** : lien vers le budget réel (G4) et vers un P&L comptable enrichi (achats/pertes) non fait — ces verticales alimentent le **cockpit estimé**, pas encore le P&L Z-réel ni le « réel » du budget
- **PRIORITÉ** : BASSE

---

## 8. Éléments explicitement NON vérifiés (honnêteté de niveau de preuve)

- Aucune migration n'a été exécutée : tous les statuts « backend » sont au **niveau 3 (SQL statique)** +
  rejeu clone rapporté par docs (niveau 4), **jamais niveau 6 (prod)**.
- Les tests sont **statiques** (texte/logique) sauf `governance.test.mts` (hook réel). « Vert » ≠ « exécuté par Postgres ».
- Les preuves E2E GoTrue et Realtime : les **scripts ont été REJOUÉS sur le CLONE non-prod et ont PASSÉ**
  (niveau 5 sur clone, **PAS** niveau 6 production). La mention « non vérifié » de
  `CUTOVER_REHEARSAL_RESULT.md §5` est une **trace historique périmée** ; le paquet gelé `9affa66` n'est
  pas modifié (réconciliation dans un commit futur). **Ceci ne vaut pas preuve de production.**
- 0044/0045/0053 n'ont **aucun garde-test SQL** ; `rlsCutover.test.mts` assère des policies 0009 supersédées.
- Le comportement runtime des routes client n'a pas été exercé (pas de navigateur/DB) — seul le code a été lu.

---

*Voir `CLUB_ONE_FINAL_PRODUCT_MAP.md` (carte + pourcentage) et `CLUB_ONE_REMAINING_ROADMAP.md` (lots A-G).*
