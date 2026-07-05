# Club One — Carte de propriété des domaines (anti-collision multi-squads)

*Directeur de programme : Claude Fable 5. Chaque équipe écrivant du code a : sa branche, son worktree,
un périmètre de fichiers EXCLUSIF, un contrat d'entrée/sortie, des tests, un reviewer distinct, un commit
atomique, une fermeture après livraison. Deux équipes ne touchent JAMAIS le même fichier.*

## Zones réservées (propriété exclusive)

| Équipe | Périmètre de fichiers exclusif | Tables/migrations | NE touche PAS |
|---|---|---|---|
| **0 Fondation/Sécu** (Fable) | `lib/permissions.ts`, `lib/auth*.ts`, `lib/authorizedOperations.ts`, `supabase/migrations/*` (RLS transverse), `supabase/rollback/*`, cutover | auth, RLS, scopes event/venue, migrations transverses | — (propriétaire de tout ce qui est sécurité) |
| **MIGRATION_STEWARD** (Fable) | `docs/MIGRATIONS_REGISTRY.md`, attribution des numéros | numérotation ≥0046, ordre, rollback, vérif | n'écrit pas la logique métier |
| **1 Exploitation** | `lib/floorPlanView.ts`, `lib/resaBoard.ts`, `lib/resaRequest.ts`, `lib/venueTables.ts`, `lib/atomicOperations.ts`, `app/_modules/exploitation/*` | club_tables, venue_tables, table_reservation_requests | permissions/RLS |
| **2 Équipes/Planning** | `lib/rhPlanning.ts`, `lib/rhRollup.ts`, `lib/rhSelf.ts`, `app/_modules/rh/*` | staff_members, staff_shifts (0011/0020/0021) | — |
| **3 Tâches/Incidents** | `lib/checklists.ts`, `lib/incidents.ts`, `lib/captation.ts`, `lib/internalComms.ts`, `app/_modules/ops/*` | checklists, incidents, captation, internal_messages | — |
| **4 Stocks/Achats/Maint.** | `lib/caisseZ.ts`, `lib/cardManager.ts`, `lib/carteEden.ts`, `lib/stock*.ts` (nouveau), `lib/maintenance.ts` (nouveau), `app/_modules/stock/*`, `app/_modules/maintenance/*` | produits_bar, caisse_z + NOUVELLES (stock_moves, suppliers, orders, equipment, interventions) | — |
| **5 CRM/Commercial** | `lib/crm*.ts`, `lib/leadsPipeline.ts`, `lib/inboxTriage.ts`, `lib/reputation.ts`, `lib/commercial.ts` (nouveau), `app/_modules/crm/*` | guests + NOUVELLES (leads, privatizations, quotes) | guests RLS (équipe 0 valide) |
| **6 Agenda/Comms/Mkt** | `lib/agenda.ts` (nouveau), `lib/messaging/*` (adaptateurs), `lib/campaigns.ts` (nouveau), `app/_modules/agenda/*`, `app/_modules/marketing/*` | events, invite_links + NOUVELLES (campaigns, message_queue) | — |
| **7 Finance** | `lib/pnlSoiree.ts`, `lib/pnlPeriode.ts`, `lib/periodSelection.ts`, `lib/crmLearning.ts`, `lib/finance.ts` (nouveau), `app/_modules/finance/*` | soiree_charges, caisse_z (lecture) + NOUVELLES (budgets) | — |
| **8 Cockpits** | `lib/commandCenter.ts`, `lib/directionCockpit.ts` (nouveau), `app/_modules/cockpit/*` | LECTURE de toutes les sources + audit_log | n'écrit aucune donnée métier |
| **13 UX/Design** | `app/_components/*` (design system), styles partagés | — | logique métier |
| **14 Tests/Intégration** | `tests/*`, fixtures, `app/*-preview` | — | code de prod (ajoute des tests) |
| **15 Red team** | LECTURE SEULE (audit offensif) | — | tout (read-only) |

## Zone SÉRIALISÉE (jamais en parallèle)

- **`app/page.tsx`** : édité UNIQUEMENT par Fable (intégrateur), une intervention à la fois. Les équipes
  livrent `app/_modules/<domaine>/` + `lib/<domaine>.ts` ; Fable câble la navigation + l'onglet.
- **`lib/permissions.ts`** (APP_TABS, matrice rôles) : équipe 0 uniquement.
- **`docs/MIGRATIONS_REGISTRY.md`** : steward uniquement.

## Convention de nommage (nouveaux)

- Composants module : `app/_modules/<domaine>/<Ecran>.tsx` (autonomes, props typées, pas d'accès direct
  à `page.tsx`).
- Lib métier pure : `lib/<domaine>.ts` + `tests/<domaine>.test.mts` (node:test).
- Migration : steward, `NNNN_slug.sql` + `supabase/verification/NNNN_slug_verification.sql` + ligne registre.
- Feature flag : `lib/featureFlags.ts` (une clé par module, défaut OFF).
