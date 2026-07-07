-- 0059_crm_enrichment.sql — ENRICHISSEMENT FICHE CLIENT CRM (V1) : email, tags, notes internes, vue 360.
--
-- Additif STRICT au socle 0013 (guests / guest_visits) + 0025 (table_reservation_requests). N'invente
-- AUCUNE donnée : la base ship VIDE, aucune dépense fabriquée (spend_attributed reste NULL = non identifié
-- et la vue 360 le remonte honnêtement). Idempotent (create … if not exists, add column if not exists,
-- garde de contrainte via pg_constraint). Réversible.
--
-- Périmètre de CE squad : email / tags / notes-timeline / dédup (app) / linking (vue 360). NE TOUCHE PAS
-- guests.preferences (module Portail, migration 0058) ni la clé de dédup phone (déjà unique en 0013).
--
-- RGPD / minimisation : email = donnée de contact commercial neutre (pas d'unicité en base — la dédup est
-- traitée côté app, cf. lib/crmProfile). Les notes internes (guest_notes) restent d'usage commercial neutre
-- (jamais de comportement/ébriété, cf. 0013). Aucun texte de message (loi Évin) n'est stocké ici.
--
-- RLS : admin/manager = tout ; promoteur = cantonné à SES clients (owner_promoter = son username) ;
-- anon = ZÉRO (revoke) ; grants DML `authenticated` uniquement. La vue 360 est une RPC SECURITY DEFINER
-- qui REFAIT le cantonnement en SQL (aucune confiance au client), read-only, search_path figé.

begin;

-- ============================================================
-- 1) GUESTS.EMAIL — colonne de contact, nullable, format vérifié, SANS unicité (dédup côté app).
-- ============================================================
alter table public.guests add column if not exists email text;

-- Garde de format idempotente (pg_constraint : pas de "add constraint if not exists" natif).
-- Format volontairement permissif mais non-vide : local@domaine.tld, sans espace ni second @.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'guests_email_format_chk'
       and conrelid = 'public.guests'::regclass
  ) then
    alter table public.guests
      add constraint guests_email_format_chk
      check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
  end if;
end $$;

-- ============================================================
-- 2) GUEST_TAGS — étiquettes libres par client (segment manuel, VIP maison, allergie service, etc.).
--    unique(guest_id, tag) : une étiquette n'apparaît qu'une fois par client (normalisée côté app).
-- ============================================================
create table if not exists public.guest_tags (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  tag text not null check (char_length(btrim(tag)) between 1 and 64),
  created_by text,                                  -- username du saisisseur (traçabilité, pas une sécurité)
  created_at timestamptz not null default now(),
  unique (guest_id, tag)
);

create index if not exists guest_tags_guest_idx on public.guest_tags(guest_id);
create index if not exists guest_tags_tag_idx on public.guest_tags(tag);

-- ============================================================
-- 3) GUEST_NOTES — timeline de notes internes horodatées (distincte de guests.notes, champ libre unique).
--    Une note = une entrée immuable (append-only) ; l'édition se fait par ajout, pas par écrasement.
-- ============================================================
create table if not exists public.guest_notes (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  author text,                                      -- username de l'auteur (traçabilité)
  created_at timestamptz not null default now()
);

create index if not exists guest_notes_guest_idx on public.guest_notes(guest_id);
create index if not exists guest_notes_when_idx on public.guest_notes(created_at);

-- ============================================================
-- 4) RLS — mêmes règles que 0013 : direction = tout ; promoteur = SES clients ; anon = rien.
-- ============================================================

-- GUEST_TAGS
alter table public.guest_tags enable row level security;
revoke all on public.guest_tags from anon;
grant select, insert, delete on public.guest_tags to authenticated;

drop policy if exists guest_tags_read on public.guest_tags;
create policy guest_tags_read on public.guest_tags for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_tags.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
drop policy if exists guest_tags_insert on public.guest_tags;
create policy guest_tags_insert on public.guest_tags for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_tags.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
-- Retrait d'étiquette : direction, ou le promoteur propriétaire du client (opération légère, réversible).
drop policy if exists guest_tags_delete on public.guest_tags;
create policy guest_tags_delete on public.guest_tags for delete to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_tags.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );

-- GUEST_NOTES
alter table public.guest_notes enable row level security;
revoke all on public.guest_notes from anon;
grant select, insert, delete on public.guest_notes to authenticated;

drop policy if exists guest_notes_read on public.guest_notes;
create policy guest_notes_read on public.guest_notes for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_notes.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
drop policy if exists guest_notes_insert on public.guest_notes;
create policy guest_notes_insert on public.guest_notes for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_notes.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
-- Suppression d'une note interne : direction seule (la timeline est une trace maîtrisée).
drop policy if exists guest_notes_delete on public.guest_notes;
create policy guest_notes_delete on public.guest_notes for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- ============================================================
-- 5) RPC guest_360_v1 — VUE 360 read-only d'UN client : identité + tags/notes + agrégats visites (0013)
--    + demandes de résa/tables (0025) + dépense attribuée (spend_attributed, NULL surfacée honnêtement).
--    SECURITY DEFINER : REFAIT le cantonnement en SQL (anon/hors-périmètre → ZÉRO ligne, fail-closed).
--    N'écrit rien (STABLE) ; n'invente aucune dépense (sum de NULL = NULL = "non identifié").
-- ============================================================
create or replace function public.guest_360_v1(p_guest_id uuid)
returns table (
  guest_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  birthday date,
  owner_promoter text,
  consent_marketing boolean,
  opt_out boolean,
  visits_seated_total integer,
  visits_booked_active integer,
  no_shows_total integer,
  last_seated_date date,
  first_seen_date date,
  visits_with_spend integer,
  spend_attributed_total numeric,
  spend_attributed_12m numeric,
  spend_is_known boolean,
  reservation_requests_total integer,
  reservation_pending integer,
  reservation_approved integer,
  reservation_declined integer,
  reservation_cancelled integer,
  distinct_tables_requested integer,
  last_request_at timestamptz,
  tags text[],
  notes_count integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
  v_username text := public.current_staff_username();
  v_owner text;
  v_found boolean;
begin
  -- Cantonnement fail-closed (SECURITY DEFINER contourne la RLS → on la REFAIT explicitement).
  if v_role is null then
    return;  -- anon / non-staff → aucune ligne
  end if;

  select true, g.owner_promoter into v_found, v_owner
    from public.guests g where g.id = p_guest_id;
  if not v_found then
    return;  -- client inconnu → aucune ligne (rien de fabriqué)
  end if;

  if v_role not in ('admin','manager')
     and not (v_role = 'promoter' and v_owner is not distinct from v_username) then
    return;  -- hors périmètre → aucune ligne
  end if;

  return query
  select
    g.id,
    g.first_name,
    g.last_name,
    g.email,
    g.phone,
    g.birthday,
    g.owner_promoter,
    g.consent_marketing,
    (g.opt_out_at is not null)                                              as opt_out,
    coalesce(vs.seated_total, 0)::integer                                   as visits_seated_total,
    coalesce(vs.booked_active, 0)::integer                                  as visits_booked_active,
    coalesce(vs.no_shows_total, 0)::integer                                 as no_shows_total,
    vs.last_seated_date,
    vs.first_seen_date,
    coalesce(vs.visits_with_spend, 0)::integer                             as visits_with_spend,
    vs.spend_total                                                          as spend_attributed_total,
    vs.spend_12m                                                            as spend_attributed_12m,
    (coalesce(vs.visits_with_spend, 0) > 0)                                as spend_is_known,
    coalesce(rr.total, 0)::integer                                          as reservation_requests_total,
    coalesce(rr.pending, 0)::integer                                        as reservation_pending,
    coalesce(rr.approved, 0)::integer                                       as reservation_approved,
    coalesce(rr.declined, 0)::integer                                       as reservation_declined,
    coalesce(rr.cancelled, 0)::integer                                      as reservation_cancelled,
    coalesce(rr.distinct_tables, 0)::integer                               as distinct_tables_requested,
    rr.last_request_at,
    coalesce(tg.tags, array[]::text[])                                      as tags,
    coalesce(nt.notes_count, 0)::integer                                    as notes_count
  from public.guests g
  left join lateral (
    select
      count(*) filter (where v.status = 'seated')                          as seated_total,
      count(*) filter (where v.status in ('booked','confirmed'))           as booked_active,
      count(*) filter (where v.status = 'no_show')                         as no_shows_total,
      max(v.exploitation_date) filter (where v.status = 'seated')          as last_seated_date,
      min(v.exploitation_date)                                             as first_seen_date,
      count(*) filter (where v.status = 'seated' and v.spend_attributed is not null) as visits_with_spend,
      sum(v.spend_attributed) filter (where v.status = 'seated')           as spend_total,
      sum(v.spend_attributed) filter (where v.status = 'seated'
                                        and v.exploitation_date >= (now()::date - 365)) as spend_12m
    from public.guest_visits v
    where v.guest_id = g.id
  ) vs on true
  left join lateral (
    select
      count(*)                                                             as total,
      count(*) filter (where r.status = 'pending')                         as pending,
      count(*) filter (where r.status = 'approved')                        as approved,
      count(*) filter (where r.status = 'declined')                        as declined,
      count(*) filter (where r.status = 'cancelled')                       as cancelled,
      count(distinct r.venue_table_id)                                     as distinct_tables,
      max(r.created_at)                                                    as last_request_at
    from public.table_reservation_requests r
    where r.guest_id = g.id
  ) rr on true
  left join lateral (
    select array_agg(t.tag order by t.tag) as tags
    from public.guest_tags t
    where t.guest_id = g.id
  ) tg on true
  left join lateral (
    select count(*) as notes_count
    from public.guest_notes n
    where n.guest_id = g.id
  ) nt on true
  where g.id = p_guest_id;
end;
$$;

revoke all on function public.guest_360_v1(uuid) from public;
grant execute on function public.guest_360_v1(uuid) to authenticated;

commit;
