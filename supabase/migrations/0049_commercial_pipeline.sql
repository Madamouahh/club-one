-- 0049_commercial_pipeline.sql — MODULE COMMERCIAL / PRIVATISATIONS (vertical neuf), structure seule, ship VIDE.
--
-- Programme gestion complète (vague 2B/3). Source de vérité UNIQUE : pipeline de leads commerciaux
-- (groupes, anniversaires, privatisations, entreprises) + devis rattachés. NE double PAS guests/events :
-- un lead commercial est une DEMANDE en amont de la soirée ; il ne devient jamais un event/guest ici.
--
--   · `commercial_leads`  : demande entrante (contact, société, type, statut pipeline, valeur estimée, auteur).
--   · `commercial_quotes` : devis rattaché à un lead (libellé, montant, statut, validité). DOCUMENT de suivi.
--
-- ⚠️ Paiement / signature électronique = PRÉPARÉS mais NON ACTIVÉS : aucun encaissement, aucune signature
--    réelle. Un devis 'accepte' est saisi à la main par la direction ; aucun adaptateur externe branché.
--
-- RLS : données commerciales SENSIBLES → lecture ET écriture direction (admin/manager) fail-closed.
-- Aucun accès promoter/server/security. Grants DML `authenticated` explicites (RLS filtre). Additif/idempotent. Réversible.

begin;

create table if not exists public.commercial_leads (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null,
  company text,
  kind text not null default 'autre',          -- groupe / anniversaire / privatisation / entreprise / autre
  status text not null default 'nouveau',      -- nouveau / qualifie / devis / gagne / perdu
  phone text,
  email text,
  party_size integer check (party_size is null or party_size >= 0),
  event_date_wanted date,
  estimated_value_cents integer check (estimated_value_cents is null or estimated_value_cents >= 0),
  source text,                                 -- bouche-à-oreille / instagram / site / partenaire / autre
  owner_username text,                         -- commercial en charge (facultatif)
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commercial_quotes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete cascade,
  label text not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'option',       -- option / envoye / accepte / refuse (AUCUN paiement/signature réel)
  valid_until date,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_leads_status_idx on public.commercial_leads (status);
create index if not exists commercial_quotes_lead_idx on public.commercial_quotes (lead_id);

grant select, insert, update, delete on public.commercial_leads to authenticated;
grant select, insert, update, delete on public.commercial_quotes to authenticated;

alter table public.commercial_leads enable row level security;
alter table public.commercial_quotes enable row level security;

-- Lecture : direction UNIQUEMENT (données commerciales sensibles ; pas server/security/promoter).
drop policy if exists commercial_leads_select_direction on public.commercial_leads;
create policy commercial_leads_select_direction on public.commercial_leads
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager']));

drop policy if exists commercial_quotes_select_direction on public.commercial_quotes;
create policy commercial_quotes_select_direction on public.commercial_quotes
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager']));

-- Écriture : direction (admin/manager) fail-closed.
drop policy if exists commercial_leads_write_direction on public.commercial_leads;
create policy commercial_leads_write_direction on public.commercial_leads
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

drop policy if exists commercial_quotes_write_direction on public.commercial_quotes;
create policy commercial_quotes_write_direction on public.commercial_quotes
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
