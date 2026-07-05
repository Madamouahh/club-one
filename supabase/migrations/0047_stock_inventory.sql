-- 0047_stock_inventory.sql — MODULE STOCK / INVENTAIRE / PERTES (vertical neuf), structure seule, ship VIDE.
--
-- Programme gestion complète (vague 2B). Source de vérité UNIQUE (D-00) : catalogue d'articles de stock
-- + mouvements signés. Le stock THÉORIQUE d'un article = somme des mouvements (delta signé). L'inventaire
-- réel = un mouvement de kind 'ajustement' qui recale le théorique sur le compté (le front calcule le delta).
-- Pertes/casse = mouvements négatifs typés (jamais décrémentés par de fausses données de caisse).
--
--   · `stock_items` : article (nom, famille, unité, seuil critique `par_level`, coût moyen unitaire).
--   · `stock_movements` : mouvement signé (entree +, sortie/perte/casse −, ajustement ±, inventaire),
--     lié à un article, avec motif, `event_id` facultatif (imputation du coût à une soirée), auteur.
--
-- ⚠️ Le rapprochement caisse/JDC est PRÉPARÉ mais NON ACTIVÉ (D-02) : aucune décrémentation auto sur
-- données de caisse tant que l'adaptateur n'est pas branché + testé. Ici, mouvements SAISIS uniquement.
--
-- RLS : lecture staff opérationnel (PAS promoter — le stock ne le regarde pas) ; écriture direction
-- (admin/manager) fail-closed (inventaire/valorisation = données de gestion). Grants DML `authenticated`
-- explicites (RLS filtre). Additif/idempotent. Réversible.

begin;

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  family text not null default 'general',      -- spiritueux / champagne / soft / biere / consommable / general
  unit text not null default 'piece',          -- piece / bouteille / cl / kg / L
  venue text,                                  -- univers concerné (null = commun)
  par_level numeric,                           -- seuil critique d'alerte (null = pas de seuil)
  unit_cost_cents integer check (unit_cost_cents is null or unit_cost_cents >= 0), -- coût moyen unitaire
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id) on delete cascade,
  kind text not null default 'sortie',         -- entree / sortie / perte / casse / ajustement / inventaire
  qty numeric not null,                        -- delta SIGNÉ (entree>0 ; sortie/perte/casse<0 ; ajustement ±)
  reason text,
  event_id uuid,                               -- imputation coût soirée (facultatif)
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists stock_items_active_idx on public.stock_items (active);
create index if not exists stock_movements_item_idx on public.stock_movements (item_id);
create index if not exists stock_movements_event_idx on public.stock_movements (event_id);

grant select, insert, update, delete on public.stock_items to authenticated;
grant select, insert, update, delete on public.stock_movements to authenticated;

alter table public.stock_items enable row level security;
alter table public.stock_movements enable row level security;

-- Lecture : staff opérationnel (pas promoter).
drop policy if exists stock_items_select_ops on public.stock_items;
create policy stock_items_select_ops on public.stock_items
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager','server','security','security_counter']));

drop policy if exists stock_movements_select_ops on public.stock_movements;
create policy stock_movements_select_ops on public.stock_movements
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager','server','security','security_counter']));

-- Écriture : direction (admin/manager) fail-closed.
drop policy if exists stock_items_write_direction on public.stock_items;
create policy stock_items_write_direction on public.stock_items
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

drop policy if exists stock_movements_write_direction on public.stock_movements;
create policy stock_movements_write_direction on public.stock_movements
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
