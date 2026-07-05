-- 0046_maintenance.sql — MODULE MAINTENANCE (équipements + interventions), structure seule, ship VIDE.
--
-- Programme « gestion complète » — domaine ABSENT jusqu'ici. Patron de vertical neuf : table(s) + RLS
-- cohérente avec les rôles + verification NIVEAU 4 + lib pure + écran + onglet flag-gated.
--
-- Modèle (source de vérité UNIQUE, D-00) :
--   · `equipment` : parc d'équipements (nom, catégorie, emplacement, état courant, univers).
--   · `maintenance_interventions` : panne / réparation / maintenance préventive sur un équipement
--     (priorité, statut, responsable, prestataire, coût, échéance préventive, lien soirée optionnel).
--
-- RLS (cohérente avec la matrice) : la MAINTENANCE est pilotée par la DIRECTION (admin/manager). Tout
-- staff authentifié peut LIRE l'état du parc (utile en soirée : « le lave-verres est HS »), mais seule
-- la direction crée/modifie équipements et interventions (assignation prestataire, coût = donnée
-- sensible). Aligné sur le patron caisse/RH (écriture direction, lecture large). Le promoteur, cantoné,
-- n'a PAS de raison métier d'accéder : lecture ouverte aux rôles OPÉRATIONNELS (pas promoter).
--   · SELECT : admin/manager/server/security/security_counter (staff opérationnel) — PAS promoter.
--   · INSERT/UPDATE/DELETE : admin/manager uniquement (fail-closed).
--
-- Additif strict, idempotent (create table if not exists, drop policy if exists + create). Ship VIDE
-- (aucun équipement inventé — la direction saisit le parc réel). Réversible (drop tables/policies).
-- Aucun adaptateur externe (prestataire = texte libre, aucune intégration). event_id nullable = lien
-- soirée facultatif pour l'imputation d'un coût d'intervention à une soirée.

begin;

-- ============================================================
-- equipment — parc d'équipements
-- ============================================================
create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'general',      -- son / lumière / froid / bar / sécurité / bâtiment / général
  location text,                                  -- où dans le complexe
  venue text,                                     -- univers concerné (terminus/eden), null = commun
  status text not null default 'ok',              -- ok / a_surveiller / panne / hs / en_maintenance
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_interventions (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  kind text not null default 'panne',             -- panne / reparation / preventif / controle
  priority text not null default 'normale',       -- basse / normale / haute / urgente
  status text not null default 'ouvert',          -- ouvert / en_cours / resolu / annule
  description text,
  reported_by text,                               -- username staff (contexte, non usurpable via RLS write direction)
  assigned_to text,                               -- responsable interne
  provider text,                                  -- prestataire externe (texte libre, AUCUNE intégration)
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  due_date date,                                  -- échéance (préventif)
  event_id uuid,                                  -- lien soirée facultatif (imputation coût)
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists equipment_status_idx on public.equipment (status);
create index if not exists maintenance_interventions_equipment_idx on public.maintenance_interventions (equipment_id);
create index if not exists maintenance_interventions_status_idx on public.maintenance_interventions (status);

-- ============================================================
-- GRANTS — patron du dépôt : grant DML large à `authenticated`, la RLS ci-dessous filtre les lignes
-- par rôle (le labo n'auto-grant pas le DML sur les nouvelles tables). anon reste sans aucun grant.
-- ============================================================
grant select, insert, update, delete on public.equipment to authenticated;
grant select, insert, update, delete on public.maintenance_interventions to authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table public.equipment enable row level security;
alter table public.maintenance_interventions enable row level security;

-- Lecture : staff opérationnel (pas promoter).
drop policy if exists equipment_select_ops on public.equipment;
create policy equipment_select_ops on public.equipment
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager','server','security','security_counter']));

drop policy if exists maintenance_select_ops on public.maintenance_interventions;
create policy maintenance_select_ops on public.maintenance_interventions
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager','server','security','security_counter']));

-- Écriture : direction uniquement (fail-closed).
drop policy if exists equipment_write_direction on public.equipment;
create policy equipment_write_direction on public.equipment
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

drop policy if exists maintenance_write_direction on public.maintenance_interventions;
create policy maintenance_write_direction on public.maintenance_interventions
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
