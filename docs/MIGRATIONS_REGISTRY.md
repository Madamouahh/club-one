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
  - **0010–0032** — modules opérationnels post-cutover (stock/caisse, RH, CRM, plan de salle,
    incidents, comms, checklists, captation, carte multi-univers…). Plage courante d'ajout.
  - **≥ 0033** — plage libre pour la suite (voir §3 : la carte Eden devra probablement y être
    renumérotée pour lever la collision 0032 au moment de préparer le paquet de bascule prod).

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
| 0020 | `0020_rh_self_confirm.sql` | RH vue salarié : confirmation de présence « 1 tap » | — |
| 0021 | `0021_rh_staff_column_privacy.sql` | RH : fermeture du gap column-level de 0011 | — |
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
| 0032 | `0032_active_event_venue.sql` | Le contexte d'événement actif expose l'univers (venue) | — |
| 0032 | `0032_produits_bar_multi_venue_carte_eden.sql` | Carte Eden rooftop 2026 + multi-univers du catalogue bar | 0032 |

## 3. ⚠️ Collision de numéro `0032` (connue, documentée, à lever avant prod)

Deux fichiers portent le numéro `0032` :

- `0032_active_event_venue.sql` (venue exposée dans `get_active_event_context`) ;
- `0032_produits_bar_multi_venue_carte_eden.sql` (carte Eden + multi-univers).

**Impact réel** : l'application par ordre alphabétique fait passer `active_event_venue`
**avant** `produits_bar…`. Les deux contenus sont disjoints (contexte événement vs catalogue
bar) → **pas de danger fonctionnel connu ici**, mais l'ordre est **ambigu** et la convention
« un numéro = un fichier » est violée.

**Décision retenue (non exécutée ici)** : **renuméroter la carte Eden en `0033`** (ou le
premier numéro libre) lors de la **préparation du paquet de bascule prod** `0008 → 0032`.
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
c'est la liste verrouillée par le test (assertion E) :

- **`0020_rh_self_confirm.sql`** — pas de fichier de vérification.
- **`0021_rh_staff_column_privacy.sql`** — pas de fichier de vérification.

**Trou au niveau FICHIER** (nuance, non verrouillée par le test E car le numéro est couvert) :

- **`0032_active_event_venue.sql`** — la seule vérification `0032…` couvre la carte
  (`0032_produits_bar_multi_venue_carte_eden_verification.sql`) ; l'exposition `venue` de
  `active_event_venue` n'a pas de vérification **dédiée**. À combler en même temps que la
  levée de la collision `0032` (§3), quand la carte migrera vers un numéro propre.

Ces trous sont **non bloquants** (structure additive, prouvée statiquement) et constituent une
**file de travail non bloquée** pour une prochaine session (même geste que S76 sur
0031/0032-carte). Le test verrouille la liste au niveau numéro : ajouter une migration ≥ 0010
sans fichier de vérification, sans l'inscrire ici, casse le test.

> Note historique : `0000–0009` (socle Auth/RLS) sont vérifiés par des fichiers à **nom
> historique** (`phase0b_auth_preflight.sql`, `phase0b_post_cutover_verification.sql`,
> `atomic_operations_preflight.sql`, `atomic_operations_verification.sql`), sans préfixe
> numérique — la convention `NNNN…` a démarré à `0010`. Ils ne comptent donc pas comme des
> trous.
