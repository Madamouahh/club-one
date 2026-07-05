# Club One — PROGRAM_STATE (reprise sans re-audit)

*Directeur de programme : Claude Fable 5. Une nouvelle session REPREND ICI sans refaire l'audit.*
*Dernière MAJ : 2026-07-05. Branche `feat/club-one-launch-july-2026`. Base inventaire = workflow read-only 7 zones.*

## Où on en est (résumé 30 s)

Le **P0 sécurité est fait** : isolation promoteur A/B prouvée (0044/0045), anon fermé, cutover 0008→0045
prêt (porte fondateur). Le **cœur d'exploitation est déjà exploitable** : ~15 onglets réels câblés
(exploitation, RH, CRM, finance de base, incidents). Le programme « gestion complète » CONSOLIDE l'existant
(beaucoup est déjà construit en lib+preview) et AJOUTE les domaines absents. Gouvernance + feature flags posés.

## Matrice de progression (CONSTRUIT = lib/DB · INTÉGRÉ = onglet réel câblé · reste = §10)

| # | Domaine | CONSTRUIT | INTÉGRÉ | TESTÉ | PREVIEW | BLOQUÉ |
|---|---|---|---|---|---|---|
| 1 | Exploitation soirée (plan/résa/clients/statuts/groupes/dépenses/entrées/archives/clôture) | ✅ | ✅ onglets | ✅ | ✅ | — |
| 2 | Équipes & planning (staff_members, staff_shifts) | ✅ 0011/20/21 | ✅ rh/monplanning | ✅ | ✅ | données réelles RH (G-6) |
| 3a | Incidents (0023) | ✅ | ✅ incidents | ✅ | ✅ | photos upload (mineur) |
| 3b | Checklists (0028) | ✅ lib | ⬜ preview | ✅ | ✅ | **câblage onglet** |
| 3c | Captation/DAM (0029) | ✅ lib | ⬜ preview | ✅ | ✅ | câblage + upload |
| 3d | Comm interne (0026) | ✅ lib | ⬜ preview | ✅ | ✅ | **câblage onglet** |
| 3e | Artist check-in (0027) | ✅ lib | ⬜ preview | ✅ | ✅ | câblage (onglet artistes = charges seulement) |
| 4a | Stock — catalogue/caisse (produits_bar, caisse_z) | ✅ 0010/32 | ✅ caisse | ✅ | ✅ | — |
| 4b | Stock — inventaire/mouvements/pertes/casse | ✅ 0047 | ✅ onglet direction | ✅ | ✅ | rapprochement caisse-JDC PRÊT-NON ACTIVÉ |
| 4c | Fournisseurs / commandes / réceptions | ❌ ABSENT | ❌ | ❌ | ❌ | **à construire** |
| 5 | Maintenance (équipements/pannes/interventions/préventif) | ✅ 0046 | ✅ onglet direction | ✅ | ✅ | vertical de référence livré (patron) |
| 6a | CRM clients (guests, scoring RFM, call-list) | ✅ 0013–19 | ✅ clients/crm/funnel | ✅ | ✅ | — |
| 6b | Mini-espace client (space_token) | ✅ 0019 | 🟡 route /espace | ✅ | ✅ | câblage nav interne |
| 7 | Commercial / privatisations / devis (leads, inbox, réputation) | 🟡 lib pur | ⬜ preview | ✅ | ✅ | **DB manquante** (leads/privatizations/quotes) + câblage |
| 8a | Agenda global + événements + invitations QR | ✅ events/funnel | ✅ funnel + partiel | ✅ | ✅ | agenda calendaire (à construire) |
| 8b | Modèles messages / file d'envoi / adaptateurs SMS-email-WhatsApp | ❌ ABSENT | ❌ | ❌ | ❌ | **à construire, adaptateurs OFF** (G-7) |
| 9 | Marketing (campagnes/canaux/budgets/codes promo/ROAS stocké) | 🟡 leadsPipeline pur (in-memory) | ⬜ | ✅ lib | ✅ | **DB manquante** + câblage |
| 10 | Finance / rentabilité (P&L soirée/période) | ✅ 0012 | ✅ pnl | ✅ | ✅ | budget prévu/réel (à construire) ; adaptateur JDC OFF |
| 11 | Cockpit manager (commandCenter) | ✅ lib+composant | ✅ onglet direction | ✅ | ✅ | signaux live : remplissage/CA/incidents ; reste « non branché » honnête (à enrichir) |
| 12 | Cockpit direction (agrégat global) | ❌ ABSENT | ❌ | ❌ | ❌ | **à construire** |
| 12b | Rapports quotidien/hebdo | ❌ ABSENT | ❌ | ❌ | ❌ | à construire |
| 13 | UX mobile / design system | ✅ partiel | ✅ | — | ✅ | P1 (viewport, hit-targets ≥44px, SW offline) |
| 14 | Tests / intégration | ✅ 776+5 | ✅ | ✅ | ✅ | 3 vérifs labo en dérive (P2) |
| 0 | Fondation/sécu (auth, RLS, isolation, cutover) | ✅ | ✅ | ✅ | ✅ | cutover = porte fondateur (G-1/2/3) |

## Prochaine action (écrite pour la session suivante)

1. Vague 2 — construire les domaines ABSENTS restants par verticals (patron = Maintenance 0046) :
   stock-inventaire, fournisseurs/commandes, cockpit direction, budget prévu/réel, adaptateurs messagerie (OFF).
2. Vague 1 finition — câbler les PREVIEW_ONLY en onglets réels : checklists, comm interne, artist-checkin,
   commercial (après DB leads/privatizations), campagnes (après DB).
3. Chaque vertical : migration steward ≥0047 + lib+test + composant `app/_modules/<domaine>/` + onglet
   flag-gated + vérif labo. Voir DOMAIN_OWNERSHIP.md pour les périmètres.

## Portes humaines : voir BLOCKERS.md (G-1…G-8). Décisions d'archi : DECISIONS.md. File : INTEGRATION_QUEUE.md.
