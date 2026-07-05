-- 0050_marketing_campaigns.sql — MODULE MARKETING / ACQUISITION (vertical neuf), structure seule, ship VIDE.
--
-- Programme gestion complète. Source de vérité UNIQUE : catalogue des campagnes d'acquisition (com/marketing).
-- Une campagne = un budget, un canal, une période, un code promo facultatif, éventuellement rattachée à une
-- soirée (event_id). Les retombées (CA attribué, réservations attribuées) sont SAISIES par la direction
-- (attribution honnête déclarée), jamais synthétisées depuis une pub externe.
--
--   · `marketing_campaigns` : campagne (nom, canal, budget/dépensé en centimes, période, event_id facultatif,
--     code promo, statut, CA attribué, réservations attribuées, auteur).
--
-- ⚠️ Plateformes pub externes (Instagram/Facebook/TikTok/Google Ads…) : aucune API. Aucune synchronisation
--   de dépense/impression automatique tant que l'adaptateur n'est pas branché + testé : PRÊT À CONNECTER —
--   NON ACTIVÉ. Ici, données SAISIES uniquement (dépensé, CA attribué, réservations attribuées).
--
-- RLS : lecture ET écriture direction (admin/manager) fail-closed — budget/dépense/CA = données de gestion,
-- pas de lecture staff-op ni promoter. Grants DML `authenticated` explicites (RLS filtre). Additif/idempotent.
-- Réversible.

begin;

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null default 'autre',        -- instagram / facebook / tiktok / google / affichage / promoteurs / autre
  budget_cents integer check (budget_cents is null or budget_cents >= 0),   -- budget alloué (null = non renseigné)
  spent_cents integer not null default 0 check (spent_cents >= 0),          -- dépensé réel SAISI
  period_start date,
  period_end date,
  event_id uuid,                                 -- soirée rattachée (facultatif)
  promo_code text,
  status text not null default 'brouillon',      -- brouillon / active / terminee
  attributed_revenue_cents integer not null default 0 check (attributed_revenue_cents >= 0), -- CA attribué SAISI
  attributed_reservations integer not null default 0 check (attributed_reservations >= 0),   -- réservations attribuées SAISIES
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_campaigns_status_idx on public.marketing_campaigns (status);
create index if not exists marketing_campaigns_channel_idx on public.marketing_campaigns (channel);
create index if not exists marketing_campaigns_event_idx on public.marketing_campaigns (event_id);

grant select, insert, update, delete on public.marketing_campaigns to authenticated;

alter table public.marketing_campaigns enable row level security;

-- Lecture : direction (admin/manager) fail-closed (budget/dépense/CA = gestion).
drop policy if exists marketing_campaigns_select_direction on public.marketing_campaigns;
create policy marketing_campaigns_select_direction on public.marketing_campaigns
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager']));

-- Écriture : direction (admin/manager) fail-closed.
drop policy if exists marketing_campaigns_write_direction on public.marketing_campaigns;
create policy marketing_campaigns_write_direction on public.marketing_campaigns
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
