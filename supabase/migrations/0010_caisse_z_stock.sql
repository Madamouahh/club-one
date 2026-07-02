-- 0010_caisse_z_stock.sql — Module STOCK / CAISSE (fondation P&L par soirée)
-- Club One LIT la caisse (le Z de clôture), il n'ENCAISSE jamais (sinon loi anti-fraude TVA,
-- amende 7 500 €). Ces tables sont du REPORTING + un catalogue produits, pas un journal de caisse.
-- Additif : ne touche à aucune table existante. Colonnes coût/stock laissées NULL = états vides
-- HONNÊTES (données réelles fournies par le fondateur : prix d'achat via facture, stock via inventaire).
-- RLS : le Z est réservé au DIRECTIONNEL (admin/manager) ; le catalogue est visible du staff connecté.

begin;

-- ============================================================
-- 1) CATALOGUE PRODUITS BAR (prix de VENTE réels ; achat/stock = NULL en attendant les vrais chiffres)
-- ============================================================
create table if not exists public.produits_bar (
  id uuid primary key default gen_random_uuid(),
  categorie text not null,
  nom text not null,
  format text,                              -- 4cl, 70cl, 175cl, bouteille…
  prix_vente numeric(10,2) not null check (prix_vente >= 0),   -- RÉEL (carte)
  prix_achat numeric(10,2) check (prix_achat is null or prix_achat >= 0), -- à fournir (facture) → marge
  stock integer check (stock is null or stock >= 0),           -- à fournir (inventaire)
  seuil_alerte integer check (seuil_alerte is null or seuil_alerte >= 0),
  fournisseur text,
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nom, format)
);

-- Seed = catalogue RÉEL transcrit de CATALOGUE_BAR_REEL.md (prix de vente réels, achat/stock NULL).
insert into public.produits_bar (categorie, nom, format, prix_vente) values
  ('Vodka & Tequila','Vodka 37.5°','4cl',10.00),
  ('Vodka & Tequila','Vodka 37.5°','70cl',90.00),
  ('Vodka & Tequila','Vodka Cîroc 40° (apple/red berry/peach)','70cl',150.00),
  ('Vodka & Tequila','Vodka Belvedere 40°','70cl',150.00),
  ('Vodka & Tequila','Vodka Belvedere 40° Diamond','175cl',350.00),
  ('Vodka & Tequila','Tequila Volcan Blanco 40°','70cl',350.00),
  ('Vodka & Tequila','Tequila Don Julio 1942 38°','7cl',150.00),
  ('Vodka & Tequila','Tequila Don Julio 1942 38°','70cl',450.00),
  ('Rhum & Gin','Rhum','4cl',10.00),
  ('Rhum & Gin','Bouteille Rhum','70cl',90.00),
  ('Rhum & Gin','Gin','4cl',10.00),
  ('Whisky & Bourbon','Whisky','4cl',10.00),
  ('Whisky & Bourbon','Whisky Jack Daniel''s 40°','4cl',12.00),
  ('Whisky & Bourbon','Bouteille Whisky','70cl',90.00),
  ('Whisky & Bourbon','Whisky Jack Daniel''s 40°','70cl',150.00),
  ('Whisky & Bourbon','Whisky Jack Daniel''s 40° (honey/apple)','70cl',160.00),
  ('Vins & Champagnes','Gris Blanc IGP Rosé','15cl',7.00),
  ('Vins & Champagnes','Chardonnay Blanc','15cl',7.00),
  ('Vins & Champagnes','Côtes de Gascogne « Moelleux »','75cl',45.00),
  ('Vins & Champagnes','Champagne du Moment','12cl',15.00),
  ('Vins & Champagnes','Champagne Moët & Chandon','75cl',120.00),
  ('Vins & Champagnes','Champagne Moët & Chandon','150cl',230.00),
  ('Vins & Champagnes','Champagne Moët & Chandon','300cl',600.00),
  ('Vins & Champagnes','Champagne Moët & Chandon Rosé','75cl',150.00),
  ('Vins & Champagnes','Champagne Armand de Brignac Brut','75cl',450.00),
  ('Vins & Champagnes','Champagne Krug Grande Cuvée Brut','75cl',450.00),
  ('Vins & Champagnes','Champagne Dom Pérignon Brut','75cl',390.00),
  ('Liqueurs','Get 27',null,10.00),
  ('Liqueurs','Get 31',null,10.00),
  ('Liqueurs','Jägerbomb','4cl',10.00),
  ('Liqueurs','Jägerbomb','70cl',90.00),
  ('Softs & Bière','Red Bull',null,8.00),
  ('Softs & Bière','Coca-Cola',null,5.00),
  ('Softs & Bière','Jus d''orange',null,5.00),
  ('Softs & Bière','Jus d''ananas',null,5.00),
  ('Softs & Bière','Corona Cero','bouteille',8.00)
on conflict (nom, format) do nothing;

-- ============================================================
-- 2) CAISSE_Z — relevé de clôture (source-agnostique : saisie manuelle, puis import auto JDC)
-- ============================================================
create table if not exists public.caisse_z (
  id uuid primary key default gen_random_uuid(),
  -- la « journée d'exploitation » chevauche minuit : on stocke la DATE DE LA SOIRÉE
  exploitation_date date not null,
  venue text not null check (venue in ('eden','cercle','terminus','complexe')),
  event_id uuid references public.events(id),
  source text not null default 'manual' check (source in ('manual','jdc_popina_api','jdc_kezia_export','autre_import')),
  ca_ttc numeric(12,2) not null check (ca_ttc >= 0),
  nb_tickets integer check (nb_tickets is null or nb_tickets >= 0),
  familles jsonb not null default '{}'::jsonb,     -- {"bar":4210.50,"entrees":1830.00,"vestiaire":145.00}
  tva jsonb not null default '{}'::jsonb,           -- {"20":{"ht":3508.75,"tva":701.75},"10":{...}}
  paiements jsonb not null default '{}'::jsonb,      -- {"cb":4890.00,"especes":1150.50}
  offerts_ttc numeric(12,2) default 0,
  commentaire text,
  saisi_par text,                                   -- username (audit ; pas de FK pour rester souple)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exploitation_date, venue)                 -- idempotence : 1 Z par soirée et par univers
);

create index if not exists caisse_z_event_idx on public.caisse_z(event_id);
create index if not exists caisse_z_date_idx on public.caisse_z(exploitation_date);

-- ============================================================
-- 3) RLS — le Z appartient au DIRECTIONNEL ; le catalogue est visible du staff connecté
-- ============================================================
alter table public.caisse_z enable row level security;
revoke all on public.caisse_z from anon;
grant select, insert, update on public.caisse_z to authenticated;
drop policy if exists caisse_z_direction_read on public.caisse_z;
create policy caisse_z_direction_read on public.caisse_z for select to authenticated
  using (public.current_staff_role() in ('admin','manager'));
drop policy if exists caisse_z_direction_insert on public.caisse_z;
create policy caisse_z_direction_insert on public.caisse_z for insert to authenticated
  with check (public.current_staff_role() in ('admin','manager'));
drop policy if exists caisse_z_direction_update on public.caisse_z;
create policy caisse_z_direction_update on public.caisse_z for update to authenticated
  using (public.current_staff_role() in ('admin','manager'));

alter table public.produits_bar enable row level security;
revoke all on public.produits_bar from anon;
grant select on public.produits_bar to authenticated;
grant insert, update on public.produits_bar to authenticated;
drop policy if exists produits_bar_read on public.produits_bar;
create policy produits_bar_read on public.produits_bar for select to authenticated using (true);
drop policy if exists produits_bar_write on public.produits_bar;
create policy produits_bar_write on public.produits_bar for insert to authenticated
  with check (public.current_staff_role() in ('admin','manager'));
drop policy if exists produits_bar_update on public.produits_bar;
create policy produits_bar_update on public.produits_bar for update to authenticated
  using (public.current_staff_role() in ('admin','manager'));

commit;
