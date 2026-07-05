-- 0048_suppliers_purchasing.sql — MODULE FOURNISSEURS / ACHATS (vertical neuf), structure seule, ship VIDE.
--
-- Programme gestion complète (vague 2B). Source de vérité UNIQUE : catalogue de fournisseurs + commandes
-- d'achat + lignes de commande. Le total d'une commande = somme de ses lignes (qty × prix unitaire), OU
-- un total forfaitaire saisi si aucune ligne détaillée. Imputation soirée facultative (event_id).
--
--   · `suppliers` : fournisseur (nom, catégorie, contact, téléphone, email, notes, actif).
--   · `purchase_orders` : commande d'achat (fournisseur FK, statut brouillon/envoyee/recue/annulee, libellé,
--     total_cents, event_id facultatif [imputation soirée], date attendue, date reçue, auteur).
--   · `purchase_order_lines` : ligne de commande (commande FK, désignation, qty, prix unitaire) — facultatif.
--
-- ⚠️ Facture / paiement / relance fournisseur : PRÉPARÉ mais NON ACTIVÉ. Aucun adaptateur de paiement ou
-- d'email branché ici. Ici, commandes SAISIES uniquement, aucune donnée inventée.
--
-- RLS : lecture staff opérationnel (PAS promoter — les achats ne le regardent pas) ; écriture direction
-- (admin/manager) fail-closed (engagement de dépense = donnée de gestion). Grants DML `authenticated`
-- explicites (RLS filtre). Additif/idempotent. Réversible.

begin;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'general',     -- boissons / alimentaire / technique / securite / general
  contact_name text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  status text not null default 'brouillon',     -- brouillon / envoyee / recue / annulee
  label text,
  total_cents integer check (total_cents is null or total_cents >= 0), -- total engagé (forfait ou somme des lignes)
  event_id uuid,                                -- imputation coût soirée (facultatif)
  expected_date date,
  received_date date,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  designation text not null,
  qty numeric not null default 1,
  unit_price_cents integer check (unit_price_cents is null or unit_price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suppliers_active_idx on public.suppliers (active);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status);
create index if not exists purchase_orders_event_idx on public.purchase_orders (event_id);
create index if not exists purchase_order_lines_order_idx on public.purchase_order_lines (order_id);

grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_lines to authenticated;

alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

-- Lecture : staff opérationnel (pas promoter).
drop policy if exists suppliers_select_ops on public.suppliers;
create policy suppliers_select_ops on public.suppliers
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager','server','security','security_counter']));

drop policy if exists purchase_orders_select_ops on public.purchase_orders;
create policy purchase_orders_select_ops on public.purchase_orders
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager','server','security','security_counter']));

drop policy if exists purchase_order_lines_select_ops on public.purchase_order_lines;
create policy purchase_order_lines_select_ops on public.purchase_order_lines
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager','server','security','security_counter']));

-- Écriture : direction (admin/manager) fail-closed.
drop policy if exists suppliers_write_direction on public.suppliers;
create policy suppliers_write_direction on public.suppliers
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

drop policy if exists purchase_orders_write_direction on public.purchase_orders;
create policy purchase_orders_write_direction on public.purchase_orders
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

drop policy if exists purchase_order_lines_write_direction on public.purchase_order_lines;
create policy purchase_order_lines_write_direction on public.purchase_order_lines
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
