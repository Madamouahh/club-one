-- 0004_events_model.sql — Lot 3 : modèle Lieux + Événements (fondation de « la boucle »)
-- Additif. À appliquer APRÈS 0003 (réutilise public.current_staff_role()).
-- Permet : créer un événement dans Club One, le rattacher à un univers, le publier,
-- et le faire lire par le SITE via une RPC publique en lecture seule.

-- ───────── Lieux (les 3 univers) ─────────
create table if not exists public.venues (
  id text primary key,                 -- 'eden' | 'cercle' | 'terminus'
  name text not null,
  kind text not null,                  -- 'rooftop' | 'club_house' | 'club'
  tagline text,
  sort_order int default 0
);

insert into public.venues (id, name, kind, tagline, sort_order) values
  ('eden',     'L''Éden',     'rooftop',    'Le ciel est notre seule limite.',                 1),
  ('cercle',   'Le Cercle',   'club_house', 'On n''y vient pas pour le nombre — pour l''ambiance.', 2),
  ('terminus', 'Le Terminus', 'club',       'Le dernier arrêt… là où la nuit commence.',       3)
on conflict (id) do nothing;

-- ───────── Événements ─────────
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues(id),
  title text not null,
  slug text unique,
  event_date date not null,
  start_time text,
  status text not null default 'draft',   -- 'draft' | 'published' | 'archived'
  description text,
  lineup text[],                          -- DJs / artistes (le fondateur remplit)
  cover_url text,                         -- média (à fournir)
  ticket_url text,                        -- billetterie externe (Shotgun…) optionnel
  reservation_phone text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists events_venue_date_idx on public.events(venue_id, event_date);
create index if not exists events_status_date_idx on public.events(status, event_date);

-- ───────── RLS ─────────
alter table public.venues enable row level security;
alter table public.events enable row level security;
revoke all on public.venues from anon;
revoke all on public.events from anon;
grant select on public.venues to authenticated;
grant select, insert, update, delete on public.events to authenticated;

drop policy if exists venues_read on public.venues;
drop policy if exists events_read on public.events;
drop policy if exists events_write on public.events;
create policy venues_read on public.venues
  for select to authenticated using (public.current_staff_role() is not null);
create policy events_read on public.events
  for select to authenticated using (public.current_staff_role() is not null);
create policy events_write on public.events for all to authenticated
  using (public.current_staff_role() in ('admin','manager','promoter'))
  with check (public.current_staff_role() in ('admin','manager','promoter'));

-- ───────── Lecture publique (le SITE) ─────────
-- Le site n'accède JAMAIS aux tables : il appelle cette RPC anon, qui ne renvoie que
-- les événements PUBLIÉS et À VENIR, avec des champs maîtrisés.
create or replace function public.public_events()
returns table (
  venue_id text, venue_name text, title text, slug text,
  event_date date, start_time text, description text, lineup text[],
  cover_url text, ticket_url text
) language sql stable security definer set search_path = public as $$
  select e.venue_id, v.name, e.title, e.slug, e.event_date, e.start_time,
         e.description, e.lineup, e.cover_url, e.ticket_url
    from public.events e
    join public.venues v on v.id = e.venue_id
   where e.status = 'published' and e.event_date >= current_date
   order by e.event_date asc, v.sort_order asc;
$$;
revoke all on function public.public_events() from public;
grant execute on function public.public_events() to anon, authenticated;
