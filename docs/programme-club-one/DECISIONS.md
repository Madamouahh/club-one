# Club One — Journal de décisions d'architecture (programme gestion complète)

*Directeur de programme : Claude Fable 5. Ce fichier fait foi sur les CONTRATS d'architecture communs.
Toute équipe s'y conforme. Une décision ne se contredit pas en silence : on l'amende ici.*

---

## D-00 — UNE SOURCE DE VÉRITÉ PAR CONCEPT (contrat central, §6 du mandat)

Interdit de créer un second système concurrent pour un concept déjà porté. La table/le module ci-dessous
est **la** référence ; tout module métier s'y rattache par clé, ne la duplique pas.

| Concept | Source de vérité UNIQUE | Où | Notes |
|---|---|---|---|
| Établissement (univers) | `venue` (`'terminus'`/`'eden'`) + table `venues` | 0004 / 0032 | `get_active_event_context` (0032) expose `venue_id`/`venue_name` |
| Événement (soirée) | table `events` + `club_runtime_state` (soirée active) | 0004 / 0008 | Actif via `get_active_event_context` ; jamais l'horloge murale |
| Date/heure de soirée | `event_date` de l'événement actif | `lib/activeEventSelector.ts` (pur, sans `new Date()`) | Bascule à minuit gérée par l'event-scope, pas le wall-clock |
| Utilisateur authentifié | Supabase Auth (`auth.uid()`) → `staff_users` | `lib/authSession.ts`, 0003 | `current_staff_role()` / `current_staff_username()` (SECDEF) |
| Membre du staff (RH) | table `staff_members` | 0011 | **DISTINCT** de `staff_users` (identité/auth). Paie = PII (0021) |
| Rôle | `StaffRole` (6) + RLS `current_staff_role()` | `lib/permissions.ts` | admin, manager, server, security, security_counter, promoter |
| Client | table `guests` (fiche unifiée) | 0013–0019 | `owner_promoter` = cantonnement promoteur. 2050 clients OctoTable réels (LECTURE) |
| Table — état LIVE | table `club_tables` (par événement) | socle + 0044 | Statut/dépenses/attribution ; cantonnée par `assigned_to` |
| Table — LAYOUT/plan | table `venue_tables` | 0024 / 0031 | Géométrie du plan de salle (44 Eden). **≠** club_tables (état) |
| Promoteur | `staff_users` role=promoter | 0044 | Cantoné par `assigned_to = current_staff_username()` |
| Auteur d'une action (audit) | table `audit_log` (append-only) | 0033 | Acteur estampillé serveur ; jamais fourni par le client |
| Dépense table | `club_tables.expenses` (jsonb) via `add_expense_v3` | 0044 (cantoné) | Jamais d'écriture directe hors RPC pour l'ajout |
| Caisse / Z | table `caisse_z` | 0010 | CA réel par soirée × venue |
| Catalogue bar / stock | table `produits_bar` | 0010 / 0032 | Base stock (multi-venue) ; gestion via RPC auditées 0034/0035 |
| Charges artistes | table `soiree_charges` | 0012 | 2ᵉ ligne de coût du P&L |
| Réservation | table `table_reservation_requests` | 0025 / 0030 | Cantonnée `owner_promoter` ; décision direction (0037) |
| Comm interne / notif | table `internal_messages` | 0026 | Alimente le cockpit via audit_log |
| Checklists | `checklist_items` / `checklist_completions` | 0028 | Audit 0040 |
| Captation / DAM | `shot_list_items` / `shot_captures` | 0029 | Audit 0040 |
| Incident | `incidents` / `incident_updates` | 0023 | Audit 0036 |

**Concepts NON encore portés (à créer, source unique à définir avant tout code)** : maintenance
(équipements/interventions), stocks-inventaire (mouvements/pertes au-delà du catalogue), fournisseurs/commandes,
privatisations/devis, campagnes marketing, budget prévisionnel de soirée, cockpit direction (agrégat).

## D-01 — Le cockpit AGRÈGE, il ne stocke pas

`lib/commandCenter.ts` est un AGRÉGATEUR en lecture (signaux : résa, captation, checklists, CA…). Les
cockpits (manager, direction) LISENT les sources de vérité + `audit_log` ; ils ne créent aucune donnée
propre. Sévérité `non_connecte` déjà prévue pour un module absent (honnêteté d'affichage).

## D-02 — Adaptateurs externes DÉSACTIVÉS par défaut (§12)

SMS / e-mail / WhatsApp / caisse-JDC / paiements / signature / comptabilité / pub externe : construits
comme ADAPTATEURS derrière une interface, **jamais activés** sans clé + GO fondateur. UI honnête :
`PRÊT À CONNECTER` / `NON ACTIVÉ`. L'absence d'une clé ne bloque JAMAIS le reste du produit. Aucun mock
présenté comme intégration réelle. Rappel gouvernance : `LEAD_NURTURE_AUTO=0`, aucun envoi réel autonome.

## D-03 — Feature flags pour l'incrémental (§8)

Un module en cours OU bloqué est isolé derrière un flag (`lib/featureFlags.ts`, à créer) → il n'apparaît
pas en navigation tant qu'il n'est pas « terminé » au sens §10. Permet d'intégrer en continu sans exposer
d'écran non fini. Défaut : OFF.

## D-04 — Migration steward unique

Toute migration passe par le steward (voir `DOMAIN_OWNERSHIP.md`). Plage libre actuelle **≥ 0046**
(0000→0045 pris ; collision 0032 à renuméroter en 0046 au cutover). Une équipe métier PROPOSE un besoin
de données ; le steward attribue le numéro, l'ordre, le rollback, la vérif. Aucune migration prod hors
porte finale. Chaque migration ≥ 0010 EXIGE un fichier `supabase/verification/NNNN…` (test
`migrationsRegistry` 7/7) + une ligne au registre `docs/MIGRATIONS_REGISTRY.md`.

## D-05 — Le monolithe `app/page.tsx` est une zone à SÉRIALISER

`app/page.tsx` (~8000 l.) est LE point de collision. Règle : une seule intervention à la fois dessus
(Fable intègre), les équipes livrent leur module en **composant `app/_modules/<domaine>/`** + `lib/<domaine>.ts`
autonomes, Fable les câble dans la navigation. Pas deux équipes qui éditent page.tsx en parallèle.

## D-06 — Mobile-first, event-scope, role-gated = définition de « intégré »

Un module n'est « terminé » (§10) que s'il est : câblé nav · relié base réelle · role-gated (RLS + front) ·
utilisable smartphone · testé · relié au bon événement + établissement · observable dans les cockpits ·
dans build+preview · documenté · sans tâche active. Une lib + un preview ≠ terminé.
