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
- Un numéro = un fichier. **Exception documentée en cours : collision `0032`** (voir §3).
- Réservation de plages ≥ 0010 par équipe (intention du master, à faire respecter quand
  plusieurs équipes reprennent l'ajout de migrations) :
  - **0000–0009** — socle Auth / event-scope / RLS (Phase 0b). *Gelé* : les six commits Auth
    poussés et les cutover 0008/0009 vivent ici. Ne pas réutiliser ces numéros.
  - **0010–0038** — modules opérationnels post-cutover (stock/caisse, RH, CRM, plan de salle,
    incidents, comms, checklists, captation, carte multi-univers, journal d'audit, gestion de carte,
    câblage audit des incidents, de la décision de résa, de l'artist check-in…). Plage courante d'ajout.
  - **≥ 0039** — plage libre pour la suite. `0038` est désormais pris (câblage du journal d'audit sur
    l'artist check-in, TRIGGER sur `artist_checkins`, S85). Voir §3 : la carte Eden devra être
    renumérotée au premier numéro libre (**0039** à ce jour) pour lever la collision 0032 au moment de
    préparer le paquet de bascule prod.

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
| 0032 | `0032_active_event_venue.sql` | Le contexte d'événement actif expose l'univers (venue) | 0032 |
| 0032 | `0032_produits_bar_multi_venue_carte_eden.sql` | Carte Eden rooftop 2026 + multi-univers du catalogue bar | 0032 |
| 0033 | `0033_audit_log.sql` | Journal d'audit global (socle 0.5) : append-only, acteur estampillé serveur, lecture direction | 0033 |
| 0034 | `0034_carte_management_rpc.sql` | Gestion de carte (back mobile) : toggle dispo / créer / modifier produit (admin·manager, fail-closed) + 1ᵉʳ câblage `log_audit_event` (carte.produit.*) | 0034 |
| 0035 | `0035_carte_produit_actif_rpc.sql` | Retrait / remise en carte d'un produit (colonne `actif`, distincte de `disponible`) : `set_produit_actif_v1` admin·manager fail-closed + audit `carte.produit.actif` (before/after) | 0035 |
| 0036 | `0036_incidents_audit_trigger.sql` | Câblage du journal d'audit (0033) sur le module incidents (0023) via TRIGGER (writes INSERT/UPDATE direct sous RLS, pas de RPC) : `incident.open` / `incident.update` (filtre de bruit) / `incident.followup`, acteur estampillé serveur, minimisation de la note libre | 0036 |
| 0037 | `0037_reservation_decision_audit.sql` | Câblage du journal d'audit (0033) sur la décision de réservation (RPC `decide_table_reservation_v1`, 0025) : `reservation.approve` / `reservation.decline` (before/after, venue + event_id propagés), acteur estampillé serveur, minimisation PII client (ni prénom ni note libre) ; demande anon NON auditée (fail-closed) | 0037 |
| 0038 | `0038_artist_checkin_audit_trigger.sql` | Câblage du journal d'audit (0033) sur l'artist check-in (0027) via TRIGGER (writes INSERT/UPDATE direct sous RLS, patron 0036) : `artist.checkin.open` / `artist.checkin.update` (filtre de bruit champ libre, before/after des jalons de soirée), acteur estampillé serveur, event_id propagé, minimisation des champs libres (contact/rider/matériel/notes) | 0038 |

## 3. ⚠️ Collision de numéro `0032` (connue, documentée, à lever avant prod)

Deux fichiers portent le numéro `0032` :

- `0032_active_event_venue.sql` (venue exposée dans `get_active_event_context`) ;
- `0032_produits_bar_multi_venue_carte_eden.sql` (carte Eden + multi-univers).

**Impact réel** : l'application par ordre alphabétique fait passer `active_event_venue`
**avant** `produits_bar…`. Les deux contenus sont disjoints (contexte événement vs catalogue
bar) → **pas de danger fonctionnel connu ici**, mais l'ordre est **ambigu** et la convention
« un numéro = un fichier » est violée.

**Décision retenue (non exécutée ici)** : **renuméroter la carte Eden au premier numéro libre**
(**`0039`** à ce jour ; `0033` pris par le journal d'audit depuis S80, `0034` par la gestion de carte
depuis S81, `0035` par le retrait/remise en carte `actif` depuis S82, `0036` par le câblage audit des
incidents depuis S83, `0037` par le câblage audit de la décision de résa depuis S84, `0038` par le
câblage audit de l'artist check-in depuis S85) lors de la
**préparation du paquet de bascule prod** `0008 → 0038`.
Renommer un fichier de migration déjà committé et possiblement appliqué au LABO est une
opération à faire **consciemment, hors session autonome** (mise à jour du LABO, de ce
registre, du test et des fichiers de vérification en même temps).

Tant que la collision existe, `tests/migrationsRegistry.test.mts` la traite comme la **seule**
collision autorisée : introduire un autre doublon casse le test, et lever la collision `0032`
sans mettre à jour le test le casse aussi (supersession consciente, tradition du dépôt).

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

> Comblé (S79, 2026-07-04, prouvé niveau 4 sur le LABO) :
> - **`0032_active_event_venue.sql`** → `0032_active_event_venue_verification.sql`. Auparavant la
>   seule vérification `0032…` couvrait la carte (`0032_produits_bar_multi_venue_carte_eden_verification.sql`)
>   au niveau NUMÉRO ; l'exposition `venue` de `active_event_venue` n'avait pas de vérification
>   **dédiée**. Elle en a une désormais : surface additive stricte 6+2 colonnes (les 6 de 0008
>   préservées dans l'ordre, `venue_id`/`venue_name` ajoutées en fin), attributs STABLE +
>   SECURITY DEFINER + `search_path=public`, grant `authenticated`-only (anon fail-closed au moteur),
>   `venue_name` résolu depuis `venues.name` (join vivant prouvé par renommage), et singleton
>   NULL-safe sans événement actif.

Il ne reste **aucun** trou de vérification, ni au niveau NUMÉRO ni au niveau FICHIER, pour les
migrations ≥ 0010. Le test verrouille la liste au niveau numéro : ajouter une migration ≥ 0010 sans
fichier de vérification, sans l'inscrire ici, casse le test. La levée de la collision `0032` (§3)
reste à faire au paquet de bascule prod (renumérotation de la carte), indépendamment de ce comblement.

> Note historique : `0000–0009` (socle Auth/RLS) sont vérifiés par des fichiers à **nom
> historique** (`phase0b_auth_preflight.sql`, `phase0b_post_cutover_verification.sql`,
> `atomic_operations_preflight.sql`, `atomic_operations_verification.sql`), sans préfixe
> numérique — la convention `NNNN…` a démarré à `0010`. Ils ne comptent donc pas comme des
> trous.
