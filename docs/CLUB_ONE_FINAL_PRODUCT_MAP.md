# Club One — CARTE FINALE DU PRODUIT (vision ↔ réalité)

*Carte de synthèse. Le pourcentage est un **score documentaire de maturité** (barème uniforme des six
statuts), calculé sur les fonctionnalités et non sur le nombre de migrations ; **il ne constitue pas
une preuve d'exploitation en production**. Détail et preuves : `CLUB_ONE_MASTER_PRODUCT_GAP_AUDIT.md`.*

- **Date** : 2026-07-06 · **Branche** : `feat/club-one-launch-july-2026`
- **Inventaire brut** : 54 migrations (0000→0053) · 52 fichiers de test / 872 cas · 55 libs · 29 onglets
  `APP_TABS` · 3 routes client (`/i`, `/espace`, `/invite`) · ~28 composants.

---

## 1. Méthode de pondération (transparente et reproductible)

Chaque sous-fonctionnalité auditée reçoit un **poids de maturité** selon son statut :

| Statut | Poids | Justification |
|---|---:|---|
| COMPLETE_AND_UI_PROVEN | 100 % | utilisable de bout en bout, live + testé |
| PARTIAL | 50 % | moitié fonctionnelle réelle |
| BACKEND_ONLY | 40 % | DB/lib prêts, UI absente |
| FRONTEND_ONLY | 25 % | écran sans backend réel |
| PLACEHOLDER | 15 % | coquille honnête |
| ABSENT | 0 % | rien |

**Poids uniforme et constant par statut — aucun ajustement au cas par cas.** Le poids d'une
sous-fonctionnalité découle UNIQUEMENT de son statut (table ci-dessus) : pas de bonus/malus individuel.
Le pourcentage d'un LOT = somme des poids ÷ nombre de sous-fonctionnalités du LOT. Le pourcentage produit
global = somme des poids des **41 sous-fonctionnalités produit (LOTS B→G)** ÷ 41. Arrondi à l'entier
pour l'affichage.

> **Périmètre du pourcentage global — LOT A EXCLU.** Le socle (LOT A, 6 items A1-A6) n'entre PAS dans
> les 41 : ce n'est pas une fonctionnalité de la vision produit mais l'**infrastructure de mise en
> production**. Il est chiffré séparément en §3 (construit/statique vs prouvé en prod = 0 %). Le titre
> du chiffre global précise donc « des 41 fonctionnalités produit (LOTS B→G) », jamais « de la vision
> complète ».

---

## 2. Matrice de statut (vision imposée → réalité)

> La colonne **STATUT** ne contient qu'une des 6 valeurs autorisées ; les précisions (« estimation »,
> « preview », « manuel », « dormant », etc.) sont reportées dans la colonne Fonctionnalité. Poids =
> fonction directe du statut (100 / 50 / 40 / 25 / 15 / 0), sans exception.

| # | Fonctionnalité (vision) — précision | STATUT | Poids |
|---|---|---|---:|
| **B1** | Cockpit global de direction (marge = estimation) | COMPLETE_AND_UI_PROVEN | 100 |
| **B2** | Cockpit manager CommandCenter (3/20 domaines live) | PARTIAL | 50 |
| B2b | Mode Soirée cockpit (preview) | FRONTEND_ONLY | 25 |
| **B3** | Personnel (staff_members) | COMPLETE_AND_UI_PROVEN | 100 |
| **B4** | Horaires / planning | COMPLETE_AND_UI_PROVEN | 100 |
| **B5** | Présences (self-confirm) | COMPLETE_AND_UI_PROVEN | 100 |
| **B6** | Tâches (assignables) | ABSENT | 0 |
| **B7** | Performance du personnel | ABSENT | 0 |
| **C1** | Agenda interactif mensuel (timeline plate, pas de calendrier) | PARTIAL | 50 |
| **C2** | Cycle de vie / organisation événement | COMPLETE_AND_UI_PROVEN | 100 |
| C3 | Checklists (pas de composition d'items) | PARTIAL | 50 |
| C4 | Communication interne | COMPLETE_AND_UI_PROVEN | 100 |
| C5 | Check-in artiste (pas de création de fiche) | PARTIAL | 50 |
| C6 | Captation / DAM (preview orphelin) | BACKEND_ONLY | 40 |
| **C7** | Création / planification de soirée (UI) | ABSENT | 0 |
| **D1** | CRM client (fiches guests) | COMPLETE_AND_UI_PROVEN | 100 |
| **D2** | Historique des visites (client-only, pas de drill-down staff) | PARTIAL | 50 |
| **D3** | Historique des réservations (board preview) | BACKEND_ONLY | 40 |
| **D4** | Historique des dépenses par client (colonne vide, aucune saisie) | PARTIAL | 50 |
| **D5** | Comptes clients (token lecture seule, pas d'auth) | PARTIAL | 50 |
| **D6** | Segmentation marketing (RFM) | COMPLETE_AND_UI_PROVEN | 100 |
| D7 | Boards leads / réputation / inbox (preview) | FRONTEND_ONLY | 25 |
| **E1** | Création de profil depuis un QR | COMPLETE_AND_UI_PROVEN | 100 |
| **E2** | Naissance / préférences / consentements (préférences absentes, consent inerte sans config) | PARTIAL | 50 |
| **E3** | Agenda du mois dans le compte client | ABSENT | 0 |
| **E4** | Réservations client (dormant, aucun écran) | BACKEND_ONLY | 40 |
| **E5** | Invitations client (lecture seule) | FRONTEND_ONLY | 25 |
| **E6** | Compte / login client (token, par design) | ABSENT | 0 |
| **F1** | Segmentation marketing campagnes (registre sans audience) | ABSENT | 0 |
| **F2** | Relances anniversaires (manuel, pas d'auto) | PARTIAL | 50 |
| **F3** | Relances clients inactifs (manuel, pas d'auto) | PARTIAL | 50 |
| **F4** | Offres promotionnelles ciblées | ABSENT | 0 |
| **F5** | SMS / email / notifications (adaptateurs absents ; labels PLACEHOLDER honnêtes) | ABSENT | 0 |
| **F6** | Fidélité et avantages | ABSENT | 0 |
| F7 | UI Marketing (registre campagnes, manuel) | COMPLETE_AND_UI_PROVEN | 100 |
| **G1** | Rapports promoteurs (liste en dur, lib orpheline) | PARTIAL | 50 |
| **G2** | Rapports serveurs (reporting inexistant) | ABSENT | 0 |
| **G3** | Analyse financière globale P&L (Z réel) | COMPLETE_AND_UI_PROVEN | 100 |
| **G4** | Budget prévu vs réel (réel NON CONNECTÉ) | PARTIAL | 50 |
| **G5** | Pilotage de tous les espaces de L'Arche (Terminus + Eden ; Cercle absent) | PARTIAL | 50 |
| G6 | Verticales support (stock/achats/commercial/maintenance) | COMPLETE_AND_UI_PROVEN | 100 |

---

## 3. Score documentaire de maturité (barème uniforme des 6 statuts)

### Par LOT

| LOT | Domaine | Items | Somme poids | Score de maturité (doc) |
|---|---|---:|---:|---:|
| **A** | Socle production & stabilisation | 6 (hors global) | 260 | **43 % construit/statique · 0 % prouvé en PROD** (clone niveau 4/5, GO en attente) |
| **B** | Cockpit direction & personnel | 8 | 475 | **59 %** |
| **C** | Agenda & organisation des soirées | 7 | 390 | **56 %** |
| **D** | CRM & identité client | 7 | 415 | **59 %** |
| **E** | Portail client & QR onboarding | 6 | 215 | **36 %** |
| **F** | Marketing automatisé & fidélité | 7 | 200 | **29 %** |
| **G** | Finance, reporting & pilotage global | 6 | 350 | **58 %** |

### Global produit

> **Score documentaire de maturité des 41 fonctionnalités produit (LOTS B→G) : 49,9 %, arrondi à 50 %.**
> Ce score est calculé à partir du **barème uniforme des six statuts** (100/50/40/25/15/0) ; **il ne
> constitue PAS une preuve d'exploitation en production** (ce n'est pas un niveau 6, seulement une
> mesure documentaire de maturité). **Le LOT A (socle) est EXCLU de ce score** (infrastructure).
>
> Trois chiffres à distinguer clairement :
> - **MATURITÉ FONCTIONNALITÉS PRODUIT B→G : 49,9 % ≈ 50 %**
> - **MATURITÉ TOUT INCLUS A→G : 49 %**
> - **SOCLE PROUVÉ EN PRODUCTION : 0 %**

Calcul reproductible (poids = fonction directe du statut, 41 items) :

```
B = (100+50+25+100+100+100+0+0)      = 475 / 8 = 59 %
C = (50+100+50+100+50+40+0)          = 390 / 7 = 56 %
D = (100+50+40+50+50+100+25)         = 415 / 7 = 59 %
E = (100+50+0+40+25+0)               = 215 / 6 = 36 %
F = (0+50+50+0+0+0+100)              = 200 / 7 = 29 %
G = (50+0+100+50+50+100)             = 350 / 6 = 58 %
------------------------------------------------------
GLOBAL (LOTS B→G) = 475+390+415+215+200+350 = 2045 / 41 = 49,9 % ≈ 50 %

Pour mémoire, LOT A en poids uniforme = (40+40+40+40+50+50) = 260 / 6 = 43 %
  → « construit / prouvé statiquement » ; mais 0 % prouvé en production (niveau 6 jamais atteint).
Global TOUT INCLUS (47 items, socle compris) = (2045+260) = 2305 / 47 = 49 %.
```

Lecture honnête de ce chiffre :

- **Côté EXPLOITATION / GESTION INTERNE (LOTS B, C, D, G ≈ 56-59 %)** : c'est la moitié la plus mûre.
  Le staff dispose d'un vrai outil live (plan de salle, RH, CRM, P&L Z-réel, verticales gestion). Les
  trous sont surtout des **surfaces de création manquantes** (créer une soirée, composer une checklist,
  saisir la dépense d'un client) et des **boards restés en preview**.
- **Côté CLIENT & CROISSANCE (LOTS E, F ≈ 29-36 %)** : c'est le déficit majeur de la vision. L'onboarding
  QR fonctionne, mais **le portail client (agenda, réservation, compte) et TOUTE l'automatisation
  marketing/fidélité (messagerie, relances auto, promos ciblées, points) sont absents ou dormants.**
- **Socle** : élevé en construction, mais **non prouvé en production** — c'est la porte de lancement,
  pas une fonctionnalité.

⚠️ Ce pourcentage est une **estimation de synthèse**, pas une mesure. Il reflète la lecture statique du
code + les tests statiques + le rapport de rejeu clone. Aucune fonctionnalité n'est vérifiée au
niveau 6 (production).

---

## 4. Ce qui FONCTIONNE réellement aujourd'hui (bout-en-bout, live)

1. **Exploitation soirée** : plan de salle, réservations, statuts, groupes, dépenses, entrées, clôture atomique.
2. **RH complet** : personnel (sans seed), planning horaires, self-confirm présence.
3. **Cycle de vie événement** : bootstrap / activate / close (v2) sous RLS event-scoped.
4. **CRM staff** : fiches guests (birthday + consentements dégroupés RGPD), segmentation RFM, call-list du mardi.
5. **Onboarding QR client** : `/i/[token]` crée réellement une fiche guest (18+, dédup, quota, idempotence).
6. **Finance P&L** : P&L soirée/période sur **Z de caisse réel** + coûts RH/artistes réels.
7. **Verticales gestion** : stock, fournisseurs, commercial, maintenance (onglets live) + cockpit direction agrégé.
8. **Communication interne** : messages + accusés de lecture, live.

## 5. Ce qui est CONSTRUIT mais DORMANT (backend/preview, non exposé)

- Demande de réservation client (RPC 0025/0030) — aucun écran client, anti-abus non tranché.
- Boards CRM riches : leads, réputation, inbox triage, resa-board — **preview only**.
- Captation / DAM — **preview only**.
- `lib/securityRevenue.ts` — rollup CA promoteur **orphelin, non importé, non testé**.
- `lib/modeSoiree.ts` — cockpit soirée **preview only**.

## 6. Ce qui est ABSENT (zéro ou quasi-zéro code)

- Création de soirée depuis l'UI ; agenda mensuel calendaire ; tâches assignables ; performance staff.
- Portail client : agenda du mois, compte/login authentifié, préférences, gestion des invitations.
- **Toute la couche marketing automatisé** : file d'envoi, adaptateurs SMS/email/WhatsApp, scheduler,
  relances automatiques anniversaire/inactifs, promo codes ciblés, **moteur de fidélité/points**.
- Rapports serveurs ; « réel » du budget ; colonne `email` sur guests ; saisie `spend_attributed`.
- Espace « Cercle » de L'Arche (déclaré, non modélisé).

---

*Feuille de route de comblement : `CLUB_ONE_REMAINING_ROADMAP.md`.*
