-- 0051_budget_forecast.sql — MODULE BUDGET PRÉVU (prévisionnel de gestion), structure seule, ship VIDE.
--
-- Programme « gestion complète ». Source de vérité UNIQUE (D-00) pour le PRÉVISIONNEL uniquement :
--   · `budget_forecasts` : un montant PRÉVU par poste (label libre + poste fermé), optionnellement
--     rattaché à une soirée (`event_id` nullable), avec auteur (contexte) et horodatage.
--
-- ⚠️ FRONTIÈRE DE SOURCE DE VÉRITÉ — cette table ne stocke QUE le PRÉVU. Le RÉEL n'est JAMAIS écrit ici :
-- il vient des sources existantes (caisse_z pour le CA réel, soiree_charges pour les charges, stock pour
-- les pertes/valeur, maintenance pour les coûts d'intervention). Le cockpit/finance croisera prévu↔réel.
-- Tant que ce croisement n'est pas branché, le réel est présenté « NON CONNECTÉ » — JAMAIS 0 € inventé,
-- JAMAIS un prévu maquillé en comptable réel.
--
-- RLS : lecture ET écriture réservées à la DIRECTION (admin/manager) fail-closed — le prévisionnel de
-- gestion (marges, budgets par poste) est une donnée de pilotage sensible, hors périmètre de tout autre
-- rôle (server/security/security_counter/promoter n'y ont AUCUN accès). Grants DML `authenticated`
-- explicites (le labo n'auto-grant pas le DML), la RLS filtre ensuite. anon : AUCUN grant.
--
-- Additif strict, idempotent (create table if not exists, drop policy if exists + create). Ship VIDE
-- (aucun budget inventé — la direction saisit le prévisionnel réel). Réversible (drop table/policies).
-- Aucun adaptateur externe. `event_id` nullable = rattachement soirée facultatif d'une ligne de budget.

begin;

-- ============================================================
-- budget_forecasts — montant PRÉVU par poste (le RÉEL vient d'ailleurs)
-- ============================================================
create table if not exists public.budget_forecasts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid,                                  -- rattachement soirée facultatif (null = budget global)
  label text not null,                            -- intitulé libre de la ligne (ex. « DJ résident février »)
  poste text not null default 'autre',            -- ca_tables / artistes / personnel / publicite / achats / maintenance / pertes / autre
  montant_prevu_cents integer not null check (montant_prevu_cents >= 0), -- montant PRÉVU (toujours renseigné, ≥ 0)
  created_by text,                                -- username staff (contexte, non usurpable via RLS write direction)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists budget_forecasts_event_idx on public.budget_forecasts (event_id);
create index if not exists budget_forecasts_poste_idx on public.budget_forecasts (poste);

-- ============================================================
-- GRANTS — patron du dépôt : grant DML large à `authenticated`, la RLS ci-dessous filtre les lignes par
-- rôle (le labo n'auto-grant pas le DML sur les nouvelles tables). anon reste sans aucun grant.
-- ============================================================
grant select, insert, update, delete on public.budget_forecasts to authenticated;

-- ============================================================
-- RLS — direction uniquement (lecture ET écriture), fail-closed
-- ============================================================
alter table public.budget_forecasts enable row level security;

-- Lecture : direction (admin/manager) — le prévisionnel est une donnée de pilotage sensible.
drop policy if exists budget_forecasts_select_direction on public.budget_forecasts;
create policy budget_forecasts_select_direction on public.budget_forecasts
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager']));

-- Écriture : direction (admin/manager) fail-closed.
drop policy if exists budget_forecasts_write_direction on public.budget_forecasts;
create policy budget_forecasts_write_direction on public.budget_forecasts
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
