-- 0062_leads_pipeline.sql — MODULE LEADS & TUNNEL COMMERCIAL (B12), structure seule, ship VIDE.
--
-- Source de vérité UNIQUE du tunnel commercial par CANAL : la table `lead_channel_stats` porte, pour
-- une soirée (event_id facultatif) et une période, le funnel MESURÉ d'un canal d'origine
-- (impressions → leads → résas demandées → résas confirmées → entrées) + la dépense pub SAISIE.
--
-- DIRECTION-SAISIE, HONNÊTE. Comme 0050 (marketing_campaigns) : aucune API pub externe
-- (Meta / Google Ads / TikTok…), aucune synchronisation d'impression/dépense automatique. Tout ici est
-- SAISI par la direction. Une étape non tracée reste NULL (« non tracké »), JAMAIS 0 fabriqué :
-- les colonnes de funnel et la dépense sont donc nullable (null = non renseigné, distinct de 0 mesuré).
--
-- RLS : lecture ET écriture direction (admin/manager) fail-closed via current_staff_role() — un funnel
-- de leads + une dépense pub sont des données de gestion, pas de lecture staff-op ni promoteur. Grants
-- DML `authenticated` explicites (la RLS filtre). anon = ZÉRO grant (revoke explicite : les DEFAULT
-- PRIVILEGES Supabase re-grantent anon sinon). Additif / idempotent / réversible.

begin;

create table if not exists public.lead_channel_stats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid,                                 -- soirée rattachée (facultatif ; pas de FK, découplé)
  channel text not null
    check (channel in ('qr','promoteur','campagne','google_business','direct','import')),
  period_start date,
  period_end date,
  -- Funnel MESURÉ par canal. NULLABLE : null = non tracké (jamais 0 fabriqué). >= 0 si renseigné.
  impressions integer check (impressions is null or impressions >= 0),
  leads integer check (leads is null or leads >= 0),
  resas_demandees integer check (resas_demandees is null or resas_demandees >= 0),
  resas_confirmees integer check (resas_confirmees is null or resas_confirmees >= 0),
  venus integer check (venus is null or venus >= 0),
  -- Dépense pub RÉELLE saisie par la direction (centimes). null = non renseignée (jamais supposée).
  spend_cents integer check (spend_cents is null or spend_cents >= 0),
  created_by text,
  created_at timestamptz not null default now(),
  -- Période cohérente si les deux bornes sont renseignées.
  check (period_start is null or period_end is null or period_end >= period_start)
);

create index if not exists lead_channel_stats_channel_idx on public.lead_channel_stats (channel);
create index if not exists lead_channel_stats_event_idx on public.lead_channel_stats (event_id);
create index if not exists lead_channel_stats_period_idx on public.lead_channel_stats (period_start);

grant select, insert, update, delete on public.lead_channel_stats to authenticated;

-- anon = ZÉRO grant (les DEFAULT PRIVILEGES Supabase re-grantent anon sur toute nouvelle table sinon).
revoke all on public.lead_channel_stats from anon;

alter table public.lead_channel_stats enable row level security;

-- Lecture : direction (admin/manager) fail-closed.
drop policy if exists lead_channel_stats_select_direction on public.lead_channel_stats;
create policy lead_channel_stats_select_direction on public.lead_channel_stats
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager']));

-- Écriture : direction (admin/manager) fail-closed.
drop policy if exists lead_channel_stats_write_direction on public.lead_channel_stats;
create policy lead_channel_stats_write_direction on public.lead_channel_stats
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
