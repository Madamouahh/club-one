# Registre des migrations Club One

> Source de vérité IN-REPO du numérotage des migrations `supabase/migrations/`.
> Réclamé par `CLUB_ONE_OS_MASTER.md` §5 (E0 / livrables) : « registre
> `docs/MIGRATIONS_REGISTRY.md` (réservation de plages de numéros ≥ 0010 par équipe) ».
>
> **Gardé par un test** : `tests/migrationsRegistry.test.mts` croise CE fichier avec le
> contenu réel de `supabase/migrations/` et `supabase/verification/` (tradition « deux
> sources, une vérité », comme `venueTables ↔ 0031` et `carteEden seed ↔ docs`). Toute
> dérive (nouveau numéro en double, trou dans la séquence, migration non documentée ici,
> migration ≥ 0010 sans fichier de vérification) casse le test.
>
> Niveau de preuve : **3 (statique)**. Ce registre décrit les FICHIERS committés ; il ne
> prouve pas l'application réelle sur une base (niveau 4 : voir la colonne « Vérif » et les
> fichiers `supabase/verification/`, exécutés sur le LABO uniquement).

## 1. Convention de numérotage

- Format de nom obligatoire : `NNNN_slug_minuscule.sql` (`^\d{4}_[a-z0-9_]+\.sql$`).
- Séquence **contiguë sans trou** de `0000` au dernier numéro.
- Un numéro = un fichier. **Collision `0032` RÉSOLUE** au paquet de bascule prod (voir §3).
- Réservation de plages ≥ 0010 par équipe (intention du master, à faire respecter quand
  plusieurs équipes reprennent l'ajout de migrations) :
  - **0000–0009** — socle Auth / event-scope / RLS (Phase 0b). *Gelé* : les six commits Auth
    poussés et les cutover 0008/0009 vivent ici. Ne pas réutiliser ces numéros.
  - **0010–0041** — modules opérationnels post-cutover (stock/caisse, RH, CRM, plan de salle,
    incidents, comms, checklists, captation, carte multi-univers, journal d'audit, gestion de carte,
    câblage audit des incidents, de la décision de résa, de l'artist check-in, de la comm interne, des
    checklists, de la captation et du cycle de vie du créneau RH…). Plage courante d'ajout.
  - **0042–0052** — lot de lancement 2026-07 : `0042` (Realtime R1), `0043` (durcissement
    TRUNCATE/login legacy S1/D2), `0044` (isolation promoteur), `0045` (relation réelle server, retrait
    'jeremy'), `0046` (Maintenance), `0047` (Stock), `0048` (Fournisseurs), `0049` (Commercial),
    `0050` (Marketing), `0051` (Budget), `0052` (active_event_venue — **renuméroté depuis 0032** pour
    lever la collision, voir §3), `0053` (anon = zéro grant de table, défense en profondeur —
    renuméroté depuis 0054). La neutralisation du mot de passe legacy est une **action manuelle**
    (`supabase/manual_actions/`), pas une migration. Prochaine plage libre : **≥ 0054**.

## 2. Inventaire (numéro · fichier · objet · vérif)

Colonne « Vérif » : `NNNN` = un fichier `supabase/verification/NNNN…` couvre ce numéro (niveau 4,
LABO) · `nommé` = couvert par un fichier de vérification à nom historique (Phase 0b / atomic,
sans préfixe numérique) · `—` = pas encore de fichier de vérification dédié.

| N° | Fichier | Objet | Vérif |
|----|---------|-------|-------|
| 0000 | `0000_inspect_schema.sql` | Inspection lecture seule du schéma réel avant migrations | — |
| 0001 | `0001_auth_hashing.sql` | Auth à mots de passe hashés (bcrypt / pgcrypto) | — |
| 0002 | `0002_lockdown_staff_users.sql` | Verrouillage de la table des identifiants staff (après login RPC) | — |
| 0003 | `0003_phase0b_identity_and_rls.sql` | Phase 0b/A : prépa Supabase Auth + pont RLS transitoire | nommé |
| 0004 | `0004_events_model.sql` | Modèle Lieux + Événements (fondation de « la boucle ») | — |
| 0005 | `0005_atomic_expense.sql` | Ajout de dépense ATOMIQUE (anti-perte concurrente) | nommé |
| 0006 | `0006_check_in_invitation.sql` | Validation QR atomique | — |
| 0007 | `0007_atomic_operations_hardening.sql` | Durcissement des dépenses atomiques | nommé |
| 0008 | `0008_event_scope_preparation.sql` | Préparation non destructive du périmètre événementiel | — |
| 0009 | `0009_phase0b_rls_cutover.sql` | Phase 0b/B : verrouillage RLS final event-scoped | nommé |
| 0010 | `0010_caisse_z_stock.sql` | Module Stock / Caisse (fondation P&L par soirée) | 0010 |
| 0011 | `0011_rh_planning.sql` | Module RH / Planning (B7), structure seule | 0011 |
| 0012 | `0012_soiree_charges_artistes.sql` | Coûts artistes & extras (2ᵉ charge du P&L par soirée) | 0012 |
| 0013 | `0013_crm_clients_vip.sql` | CRM clients VIP (V0, socle), structure seule | 0013 |
| 0014 | `0014_crm_funnel_qr.sql` | Funnel QR d'inscription (V0) | 0014 |
| 0015 | `0015_crm_scan_porte.sql` | Scan à la porte du QR d'entrée (V0) | 0015 |
| 0016 | `0016_crm_no_show_cloture.sql` | Règlement des présences à la clôture | 0016 |
| 0017 | `0017_octotable_import_provenance.sql` | Provenance d'import CRM (OctoTable & assimilés) | 0017 |
| 0018 | `0018_crm_guest_scores_historique.sql` | Provenance dans la vue guest_scores (segment « historique importé ») | 0018 |
| 0019 | `0019_crm_guest_space.sql` | Mini-espace client (accès lecture seule par jeton opaque) | 0019 |
| 0020 | `0020_rh_self_confirm.sql` | RH vue salarié : confirmation de présence « 1 tap » | 0020 |
| 0021 | `0021_rh_staff_column_privacy.sql` | RH : fermeture du gap column-level de 0011 | 0021 |
| 0022 | `0022_events_format_learning.sql` | Étiquette de programmation « format » sur les événements | 0022 |
| 0023 | `0023_incidents.sql` | Module Incidents (A6), structure seule, RLS restreinte | 0023 |
| 0024 | `0024_venue_tables.sql` | Plan de salle (layout tables par univers) + seed Eden | 0024 |
| 0025 | `0025_table_reservation_requests.sql` | Flux client « demande de résa » | 0025 |
| 0026 | `0026_internal_comms.sql` | Communication interne (A7), structure seule, ship vide | 0026 |
| 0027 | `0027_artist_checkin.sql` | Artist check-in (A8), structure seule | 0027 |
| 0028 | `0028_checklists.sql` | Checklists ouverture/fermeture (A9), structure seule | 0028 |
| 0029 | `0029_captation.sql` | Captation en soirée (A10), structure seule | 0029 |
| 0030 | `0030_resa_request_anon_hardening.sql` | Durcissement correctness/minimisation de la RPC anon | 0030 |
| 0031 | `0031_eden_plan_v2.sql` | Plan Eden V2 « proprement » (corrections fondateur 2026-07-03) | 0031 |
| 0032 | `0032_produits_bar_multi_venue_carte_eden.sql` | Carte Eden rooftop 2026 + multi-univers du catalogue bar | 0032 |
| 0033 | `0033_audit_log.sql` | Journal d'audit global (socle 0.5) : append-only, acteur estampillé serveur, lecture direction | 0033 |
| 0034 | `0034_carte_management_rpc.sql` | Gestion de carte (back mobile) : toggle dispo / créer / modifier produit (admin·manager, fail-closed) + 1ᵉʳ câblage `log_audit_event` (carte.produit.*) | 0034 |
| 0035 | `0035_carte_produit_actif_rpc.sql` | Retrait / remise en carte d'un produit (colonne `actif`, distincte de `disponible`) : `set_produit_actif_v1` admin·manager fail-closed + audit `carte.produit.actif` (before/after) | 0035 |
| 0036 | `0036_incidents_audit_trigger.sql` | Câblage du journal d'audit (0033) sur le module incidents (0023) via TRIGGER (writes INSERT/UPDATE direct sous RLS, pas de RPC) : `incident.open` / `incident.update` (filtre de bruit) / `incident.followup`, acteur estampillé serveur, minimisation de la note libre | 0036 |
| 0037 | `0037_reservation_decision_audit.sql` | Câblage du journal d'audit (0033) sur la décision de réservation (RPC `decide_table_reservation_v1`, 0025) : `reservation.approve` / `reservation.decline` (before/after, venue + event_id propagés), acteur estampillé serveur, minimisation PII client (ni prénom ni note libre) ; demande anon NON auditée (fail-closed) | 0037 |
| 0038 | `0038_artist_checkin_audit_trigger.sql` | Câblage du journal d'audit (0033) sur l'artist check-in (0027) via TRIGGER (writes INSERT/UPDATE direct sous RLS, patron 0036) : `artist.checkin.open` / `artist.checkin.update` (filtre de bruit champ libre, before/after des jalons de soirée), acteur estampillé serveur, event_id propagé, minimisation des champs libres (contact/rider/matériel/notes) | 0038 |
| 0039 | `0039_internal_comms_audit_trigger.sql` | Câblage du journal d'audit (0033) sur la communication interne (0026) via TRIGGER (writes INSERT/UPDATE direct sous RLS, patron 0036) : `comm.urgence` / `comm.alerte` / `comm.annonce` à l'ouverture + `comm.resolve` à la résolution ; filtre de bruit (message/tache/édition/bump filtrés), acteur estampillé serveur, event_id propagé, minimisation du corps du message (`body` jamais recopié) | 0039 |
| 0040 | `0040_checklists_captation_audit_trigger.sql` | Câblage du journal d'audit (0033) sur les checklists (0028) ET la captation (0029) via 2 TRIGGERS (writes INSERT/UPDATE direct sous RLS, patron 0036/0038/0039) : `checklist.signoff` sur les coches de catégories liability-critiques (secu/issues/caisse) + ré-attribution `done_by` ; `captation.depose` sur le franchissement du statut DAM `depose` ; filtre de bruit (catégories routinières, statuts intermédiaires, éditions de note filtrés), acteur estampillé serveur, venue + event_id propagés, minimisation des champs libres (note de complétion, sujet/note captation jamais recopiés) | 0040 |
| 0041 | `0041_rh_shift_audit_trigger.sql` | Câblage du journal d'audit (0033) sur le cycle de vie du créneau RH (`staff_shifts`, 0011/0020) via 1 TRIGGER captant les DEUX chemins d'écriture (UPSERT direction sous RLS + `update` interne de la RPC SECDEF `confirm_my_shift_v1`, ce qui évite le double-audit d'un patron in-corps) : `rh.shift.confirm` (confirmation salarié, acteur = LE SALARIÉ), `rh.shift.pointage` (pointage réel present/absent/retard, acteur direction), `rh.shift.cancel` (annulation, acteur direction) ; filtre de bruit (brouillon `planifie` + re-sauvegarde à statut inchangé filtrés), acteur estampillé serveur, event_id propagé, before/after fidèles, minimisation droit du travail/paie (`taux_horaire`, `notes_direction`, `commentaire` jamais recopiés ; seul `full_name` inclus pour la lisibilité, déjà visible de la direction). Répertoire `staff_members` NON audité ici (config/PII paie, décision fondateur) | 0041 |
| 0042 | `0042_enable_realtime_publication.sql` | Activation de la publication Realtime des 4 tables auxquelles le front s'abonne (`club_tables`, `entry_logs`, `promoter_contacts`, `promoter_guest_entries`) — correctif R1 (audit lancement 2026-07-05 : `pg_publication_tables` était vide → sync multi-poste morte, badge « Live » mensonger). DO block idempotent (ADD TABLE si absente), RLS reste l'autorité (Realtime filtre par rôle abonné), aucune table PII hors-périmètre publiée, réversible (DROP TABLE) | 0042 |
| 0043 | `0043_revoke_truncate_and_legacy_login.sql` | Durcissement : REVOKE TRUNCATE sur toutes les relations publiques (tables + vues) pour `authenticated`/`anon` + `ALTER DEFAULT PRIVILEGES` (RLS ne borne jamais TRUNCATE — correctif S1) et REVOKE EXECUTE sur la fonction de login legacy `verify_staff_login` (correctif D2, plus aucun code ne l'appelle ; fonction conservée non-DROP, réversible). Additif/idempotent (REVOKE = no-op si déjà retiré), aucune donnée touchée | 0043 |
| 0044 | `0044_promoter_table_isolation.sql` | **Isolation promoteur** (décision fondateur) : `club_tables` SELECT/UPDATE/INSERT cantonnés au promoteur propriétaire (`assigned_to = current_staff_username()`, WITH CHECK anti-vol/don/déplacement) — la direction voit/attribue tout ; `add_expense_v3` (SECDEF) re-vérifie l'ownership promoteur (ferme le trou « dépense sur table étrangère ») ; `events_write` retire 'promoter' (événements = direction). Realtime auto-cantonné (RLS SELECT + refetch RLS-filtré). Additif/idempotent, réversible | 0044_0045 |
| 0045 | `0045_server_scope_real_relation.sql` | **Relation réelle server** (§7) : `co_is_server_table_scope` = « non attribuée » seulement ; server SELECT/UPDATE + trigger 0009 + branche server de `add_expense_v3` = « non attribuée OU la mienne (`assigned_to = current_staff_username()`) » → supprime les noms en dur `'jeremy'`/`'server'`. Comportement server préservé (compte partagé 'server' inchangé), modèle correct pour comptes individuels. Additif/idempotent | 0044_0045 |
| 0046 | `0046_maintenance.sql` | **Module Maintenance** (programme gestion complète, vertical neuf) : tables `equipment` + `maintenance_interventions` (état parc, pannes/réparations/préventif, priorité, prestataire=texte libre sans intégration, coût, lien soirée facultatif). RLS : lecture staff opérationnel (PAS promoter), écriture direction (admin/manager) fail-closed. Grants DML `authenticated` explicites (RLS filtre). Ship VIDE (aucun équipement inventé). Additif/idempotent, réversible | 0046 |
| 0047 | `0047_stock_inventory.sql` | **Module Stock/inventaire/pertes** (vertical neuf) : tables `stock_items` + `stock_movements` (mouvements SIGNÉS : entree/sortie/perte/casse/ajustement/inventaire ; stock théorique = somme des deltas ; seuil critique, coût moyen, imputation coût soirée). RLS lecture staff-op (PAS promoter), écriture direction fail-closed. Rapprochement caisse/JDC PRÊT-NON ACTIVÉ (aucune décrémentation sur fausses données). Ship VIDE. Additif/idempotent | 0047 |
| 0048 | `0048_suppliers_purchasing.sql` | **Module Fournisseurs/achats** : tables `suppliers` + `purchase_orders` (statut brouillon/envoyee/recue/annulee, imputation soirée) + `purchase_order_lines`. RLS lecture staff-op (PAS promoter), écriture direction fail-closed. Facture/paiement PRÊT-NON ACTIVÉ. Ship VIDE | 0048 |
| 0049 | `0049_commercial_pipeline.sql` | **Module Commercial/privatisations** : tables `commercial_leads` (kind groupe/anniversaire/privatisation/entreprise, pipeline nouveau→gagne/perdu, valeur estimée) + `commercial_quotes` (devis). RLS lecture ET écriture direction fail-closed (données commerciales sensibles ; server/promoter refusés). Paiement/signature PRÊT-NON ACTIVÉ. Ship VIDE | 0049 |
| 0050 | `0050_marketing_campaigns.sql` | **Module Marketing/acquisition** : table `marketing_campaigns` (canal, budget/dépensé/CA attribué, période, promo_code, réservations attribuées → ROAS/CAC calculés honnêtement). RLS lecture+écriture direction fail-closed. Plateformes pub externes NON ACTIVÉES. Ship VIDE | 0050 |
| 0051 | `0051_budget_forecast.sql` | **Module Budget prévu/réel** : table `budget_forecasts` (prévisionnel par poste ca_tables/artistes/personnel/publicite/achats/maintenance/pertes ; le RÉEL vient du croisement caisse_z/soiree_charges/stock/maintenance, JAMAIS stocké ici). RLS lecture+écriture direction fail-closed. Valeur réelle absente = NON RENSEIGNÉE. Ship VIDE | 0051 |
| 0052 | `0052_active_event_venue.sql` | Le contexte d'événement actif expose l'univers (venue) — **renuméroté depuis 0032** (levée de collision, paquet de bascule prod). `CREATE OR REPLACE get_active_event_context` ; appliqué en fin de chaîne = schéma final identique. | 0052 |
| 0053 | `0053_revoke_anon_all_tables.sql` | **Défense en profondeur : anon = zéro grant de table** sur tout `public` (`revoke all on all tables from anon` + `alter default privileges`). Rétablit l'invariant de 0009 rompu par les DEFAULT PRIVILEGES Supabase sur les tables verticales créées après 0009 (pas de fuite — RLS fail-closed — mais brèche latente). Constat du harness de contrat. Additif/idempotent. (Renuméroté depuis 0054.) | 0053 |
| 0054 | `0054_event_management.sql` | **Vague V1 — Squad A (Agenda/soirées)** : colonnes de planification additives sur `events` (artistes, horaire_debut/fin, espace, capacite, equipe jsonb, notes) + vocabulaire de statut `draft/published/open/closed/archived` (CHECK `NOT VALID`). RPC `create/update/duplicate/cancel_event_v1` + helper `event_status_transition_allowed` (SECURITY DEFINER, `search_path=public`, admin/manager, `authenticated`-only). Planification pure — ne touche PAS `club_runtime_state`/bootstrap-activate-close. `0054_event_management_verification.sql`. | 0054 |
| 0055 | `0055_tasks.sql` | **Vague V1 — Squad B (Tâches)** : table `tasks` (titre, assignee_username, assigned_by, due_date, status todo/doing/done/cancelled, priority low/normal/high, event_id). RLS fail-closed : direction (admin/manager) complet ; assigné username-scopé (`current_staff_username()`) lit/avance SES tâches sans vol/réassignation ; anon zéro. `authenticated`-only. `0055_tasks_verification.sql`. | 0055 |
| 0056 | `0056_messaging_marketing.sql` | **Vague V1 — Squad E (Infra marketing DRY_RUN)** : `message_templates`, `message_queue` (statuts queued/sending/sent/failed/skipped/opted_out, dedup_key unique), `campaign_audiences`, `campaign_recipients` (unique campaign+guest), `promo_codes` (expiration/max_redemptions/per_guest_limit), `promo_redemptions` (unique code+guest). Référence `marketing_campaigns` (0050) + `guests` (0013). RLS direction fail-closed, anon zéro. **Aucun fournisseur activé — envoi = DRY_RUN local (adaptateur injecté).** `0056_messaging_marketing_verification.sql`. | 0056 |
| 0057 | `0057_cercle_floor_plan.sql` | **Vague V1 — Squad G (Le Cercle) — CORRIGÉ (décision fondateur 2026-07-07)** : support technique multi-espace SEUL (garantit `venues('cercle')`, idempotent). **AUCUN plan de salle officiel seedé** — le layout « 14 tables » proposé N'EST PAS validé fondateur (conçu sans plan réel) → déplacé, marqué PROVISOIRE, en fixture hors chaîne `supabase/fixtures/cercle_floor_plan_PROVISIONAL.sql` (LAB/preview only). N'altère aucune ligne Eden/Terminus. `0057_cercle_floor_plan_verification.sql` prouve `venue_tables(cercle)=0` après 0057. | 0057 |

> **Neutralisation du mot de passe legacy en clair** : **N'EST PLUS une migration numérotée** (mode B,
> GO fondateur). Sortie vers `supabase/manual_actions/neutralize_legacy_password.sql` (hors chemin
> `migrate`/`db push`, phrase d'autorisation exacte + préflight bloquant). Purement données → aucun
> impact schéma. cf. `docs/LEGACY_PASSWORD_AUDIT.md` et `docs/FINAL_MIGRATION_ORDER.md`.

## 3. ✅ Collision de numéro `0032` — RÉSOLUE (paquet de bascule prod, 2026-07-06)

Historiquement, deux fichiers portaient `0032` :

- `active_event_venue` (venue exposée dans `get_active_event_context`) ;
- `produits_bar_multi_venue_carte_eden` (carte Eden + multi-univers).

**Résolution appliquée** : `active_event_venue` renuméroté **`0032` → `0052`** ;
`0032_produits_bar_multi_venue_carte_eden.sql` **conserve `0032`**.

**Pourquoi renuméroter `active_event_venue` et non la carte** (déviation assumée de la suggestion
initiale « renuméroter la carte ») : l'analyse de dépendances montre que **`produits_bar` est
dépendu** — `0010` y référence (corps de fonction, déféré), et surtout `0034_carte_management_rpc` +
`0035_carte_produit_actif_rpc` en dépendent à l'application → `produits_bar` **doit rester avant
`0034`**. À l'inverse, **`active_event_venue` n'a AUCUN dépendant** : elle est le seul
`CREATE OR REPLACE get_active_event_context` (avec `0008`), et aucune migration `0033→0051` ne
référence cette fonction. La déplacer en fin de chaîne (**`0052`**) est donc sûr et donne un
**schéma final identique** (prouvé par la re-répétition sur clone vierge, cf.
`docs/CUTOVER_REHEARSAL_RESULT.md` / `docs/PRODUCTION_CUTOVER_PACKAGE.md`).

Mis à jour en même temps (tradition « deux sources, une vérité ») : ce registre, la vérification
dédiée (`0032_active_event_venue_verification.sql` → `0052_active_event_venue_verification.sql`),
et le test `tests/migrationsRegistry.test.mts` (assertion B durcie : **plus aucun** doublon toléré).

## 4. Trous de couverture « vérification » (post-0010, à combler par une future session)

La convention `supabase/verification/NNNN…` (transaction `rollback`, chaque invariant =
`raise exception`) couvre tous les modules opérationnels.

**Trous au niveau NUMÉRO** (aucun fichier `supabase/verification/NNNN…` pour ce numéro) —
c'est la liste verrouillée par le test (assertion E) : **AUCUN** (liste vide).

> Comblés (S78, 2026-07-04, prouvés niveau 4 sur le LABO) :
> - **`0020_rh_self_confirm.sql`** → `0020_rh_self_confirm_verification.sql` (contrat de surface
>   de `confirm_my_shift_v1` : unauthorized / no_member / transition planifie→confirme surface
>   bornée / already / not_confirmable / forbidden / not_found + lignes réelles inchangées).
> - **`0021_rh_staff_column_privacy.sql`** → `0021_rh_staff_column_privacy_verification.sql`
>   (grant colonne révoqué taux/notes, défense en profondeur direction, RPC `list_staff_members_v1`
>   qui rétablit taux+notes pour admin/manager, fail-closed y compris rôle NULL et anon).

**Trou au niveau FICHIER** : **AUCUN** (comblé S79).

> Comblé (S79, 2026-07-04, prouvé niveau 4 sur le LABO ; fichier renuméroté 0032 → 0052 au paquet
> de bascule prod) :
> - **`0052_active_event_venue.sql`** → `0052_active_event_venue_verification.sql`. L'exposition
>   `venue` de `active_event_venue` a une vérification
>   **dédiée** : surface additive stricte 6+2 colonnes (les 6 de 0008
>   préservées dans l'ordre, `venue_id`/`venue_name` ajoutées en fin), attributs STABLE +
>   SECURITY DEFINER + `search_path=public`, grant `authenticated`-only (anon fail-closed au moteur),
>   `venue_name` résolu depuis `venues.name` (join vivant prouvé par renommage), et singleton
>   NULL-safe sans événement actif.

Il ne reste **aucun** trou de vérification, ni au niveau NUMÉRO ni au niveau FICHIER, pour les
migrations ≥ 0010. Le test verrouille la liste au niveau numéro : ajouter une migration ≥ 0010 sans
fichier de vérification, sans l'inscrire ici, casse le test. La collision `0032` (§3) est
**résolue** (active_event_venue → 0052) ; la vérification dédiée suit le fichier sous son nouveau nom.

> Note historique : `0000–0009` (socle Auth/RLS) sont vérifiés par des fichiers à **nom
> historique** (`phase0b_auth_preflight.sql`, `phase0b_post_cutover_verification.sql`,
> `atomic_operations_preflight.sql`, `atomic_operations_verification.sql`), sans préfixe
> numérique — la convention `NNNN…` a démarré à `0010`. Ils ne comptent donc pas comme des
> trous.
