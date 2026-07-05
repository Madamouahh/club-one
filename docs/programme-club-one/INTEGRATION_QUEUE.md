# Club One — INTEGRATION_QUEUE (file d'intégration priorisée par vagues)

*Ordre d'intégration. Fable intègre dans cet ordre ; les contrats stables peuvent être développés en
parallèle (worktrees). Un item n'est « intégré » qu'au sens §10 (câblé nav + base + rôles + mobile + testé).*

## Vague 1 — Fondation opérationnelle (câbler l'existant construit)

| Item | Type | État | Périmètre | Note |
|---|---|---|---|---|
| Cockpit manager (`cockpit`) | Câblage (consolidation) | 🟡 CE LOT | page.tsx + permissions + flag `cockpitManager` | assemble CommandCenterInput depuis l'état live, composant `CommandCenter` existant |
| Checklists (`checklist`) | Câblage preview→onglet | ⬜ | page.tsx + lib/checklists (existe) + flag `opsChecklists` | 0028 en base, RLS ok |
| Comm interne (`comms`) | Câblage preview→onglet | ⬜ | page.tsx + lib/internalComms (existe) + flag `internalComms` | 0026 en base |
| Artist check-in | Câblage (dans onglet artistes) | ⬜ | lib/artistCheckin (existe) | 0027 en base |

## Vague 2 — Gestion du complexe (verticals neufs)

| Item | Type | État | Migration | Périmètre |
|---|---|---|---|---|
| **Maintenance** (équipements/interventions/préventif) | Vertical neuf (PATRON) | 🟡 CE LOT | **0046** | lib/maintenance + test + `app/_modules/maintenance` + onglet flag `maintenance` |
| Stock inventaire (mouvements/pertes/casse/seuils) | Vertical neuf | ⬜ | ≥0047 | lib/stock + fournisseurs ; adaptateur caisse-JDC OFF |
| Fournisseurs / commandes / réceptions | Vertical neuf | ⬜ | ≥0047 | lié stock |
| Commercial / privatisations / devis | DB + câblage (lib pur existe) | ⬜ | ≥0047 | table leads/privatizations/quotes ; lib leadsPipeline/inboxTriage à relier ; paiement/signature OFF |
| Agenda calendaire + file d'envoi + adaptateurs msg | Vertical neuf | ⬜ | ≥0047 | adaptateurs SMS/email/WhatsApp OFF (D-02, G-7) |

## Vague 3 — Pilotage

| Item | Type | État | Note |
|---|---|---|---|
| Cockpit direction (`cockpit-direction`) | Vertical neuf | ⬜ | agrège CA/coûts/marge/fréquentation/promoteurs/campagnes/incidents/maintenance + décisions à valider |
| Budget prévu vs réel | Vertical neuf | ⬜ | table budget_forecast ; croise pnl |
| Marketing (campagnes/canaux/budgets/ROAS stocké) | DB + câblage | ⬜ | table campaigns/promo_codes ; leadsPipeline existe (in-memory) |
| Rapports quotidien/hebdo | Génération | ⬜ | agrégat lecture, export |

## Vague 4 — Durcissement

| Item | Note |
|---|---|
| Réconcilier 3 vérifs labo en dérive (0020/0024/atomic vs 0031/0041) | équipe 14, P2 |
| Renuméroter collision 0032 → 0046+ au cutover | steward |
| UX mobile P1 (viewport, hit-targets ≥44px, service worker offline) | équipe 13 |
| Smoke navigateur 7 rôles + realtime 2 sessions | porte credentials G-4 |
| Tests transversaux + concurrence + perf + preview complète | équipe 14 |

## Règle d'intégration

Fable intègre Vague 1 → 2 → 3 → 4. Développement parallèle autorisé quand les contrats (DECISIONS.md D-00)
sont stables. Jamais deux équipes sur `app/page.tsx` (sérialisé). Steward = numéros de migration.
