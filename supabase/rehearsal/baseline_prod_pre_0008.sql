-- ============================================================================
-- Club One — Rehearsal baseline: faithful reconstruction of PRODUCTION
-- structure at its real pre-0008 state (schema level ~0007).
--
-- WHY THIS FILE EXISTS
--   Production (xsotmjnaffaibgqgookt) was hand-built out-of-band: its 6 core
--   tables (staff_users, club_tables, entry_logs, event_archives,
--   promoter_contacts, promoter_guest_entries) are NOT created by any repo
--   migration, and prod does NOT literally match migrations 0001-0007
--   (e.g. staff_users has no password_hash / set_staff_password — it uses a
--   plaintext `password` column + `auth_id`). Replaying 0001-0007 would build
--   a DIFFERENT schema than prod. So the faithful rehearsal baseline is a
--   read-only capture of prod's LIVE structure, reproduced here verbatim.
--
-- SOURCE: read-only catalog capture from prod on 2026-07-06 via MCP
--         (supabase_prod_ro, read_only=true). No PII, no data rows, no
--         secrets — structure only.
--
-- TARGET: the ISOLATED clone (fhpttgtjxpzexvwtylhv) ONLY. Never prod.
-- After this baseline, migrations 0008 -> 0051 are applied = the real cutover.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES (dependency order: venues -> ... -> promoter_guest_entries -> events)
-- ---------------------------------------------------------------------------

create table if not exists public.venues (
  id          text primary key,
  name        text not null,
  kind        text not null,
  tagline     text,
  sort_order  integer default 0
);

create table if not exists public.staff_users (
  id          uuid primary key default gen_random_uuid(),
  username    text not null unique,
  password    text not null,
  role        text not null,
  full_name   text not null,
  created_at  timestamptz default now(),
  auth_id     uuid
);

create table if not exists public.club_tables (
  id              text primary key,
  zone            text not null,
  status          text not null default 'free'::text,
  capacity        integer default 6,
  client          text default ''::text,
  phone           text default ''::text,
  people          text default ''::text,
  notes           text default ''::text,
  event_date      text default ''::text,
  booker          text default ''::text,
  expenses        jsonb default '[]'::jsonb,
  updated_at      timestamptz default now(),
  assigned_to     text default ''::text,
  linked_group_id text default ''::text,
  linked_tables   text[] default '{}'::text[]
);

create table if not exists public.entry_logs (
  id             uuid primary key default gen_random_uuid(),
  type           text not null,
  staff_username text default ''::text,
  created_at     timestamptz default now()
);

create table if not exists public.event_archives (
  id                  uuid primary key default gen_random_uuid(),
  event_date          text not null,
  closed_by           text default ''::text,
  total_revenue       numeric default 0,
  total_entries       integer default 0,
  total_exits         integer default 0,
  tables_snapshot     jsonb default '[]'::jsonb,
  entry_logs_snapshot jsonb default '[]'::jsonb,
  closed_at           timestamptz default now()
);

create table if not exists public.promoter_contacts (
  id                uuid primary key default gen_random_uuid(),
  promoter_username text not null,
  first_name        text default ''::text,
  last_name         text default ''::text,
  phone             text default ''::text,
  notes             text default ''::text,
  created_at        timestamptz default now(),
  last_seen_at      timestamptz,
  total_visits      integer default 0
);

create table if not exists public.promoter_guest_entries (
  id                uuid primary key default gen_random_uuid(),
  event_date        text not null,
  promoter_username text not null,
  contact_id        uuid references public.promoter_contacts(id) on delete set null,
  guest_name        text not null,
  phone             text default ''::text,
  access_mode       text not null default 'sans_alcool'::text,
  payment_status    text not null default 'en_attente'::text,
  qr_token          text not null unique,
  checked_in        boolean default false,
  checked_in_at     timestamptz,
  checked_in_by     text default ''::text,
  created_at        timestamptz default now()
);

create table if not exists public.events (
  id                uuid primary key default gen_random_uuid(),
  venue_id          text not null references public.venues(id),
  title             text not null,
  slug              text unique,
  event_date        date not null,
  start_time        text,
  status            text not null default 'draft'::text,
  description       text,
  lineup            text[],
  cover_url         text,
  ticket_url        text,
  reservation_phone text,
  created_by        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Extra indexes present on prod
create unique index if not exists staff_users_auth_id_unique_idx
  on public.staff_users (auth_id) where (auth_id is not null);

create unique index if not exists promoter_guest_entries_qr_token_unique_idx
  on public.promoter_guest_entries (qr_token)
  where ((qr_token is not null) and (btrim(qr_token) <> ''::text));

create index if not exists events_status_date_idx on public.events (status, event_date);
create index if not exists events_venue_date_idx  on public.events (venue_id, event_date);

-- ---------------------------------------------------------------------------
-- 2. FUNCTIONS (verbatim from prod; all SECURITY DEFINER set search_path)
-- ---------------------------------------------------------------------------

create or replace function public.current_staff_role()
  returns text language sql stable security definer set search_path to 'public'
as $$
  select s.role from public.staff_users s where s.auth_id = auth.uid();
$$;

create or replace function public.current_staff_username()
  returns text language sql stable security definer set search_path to 'public'
as $$
  select s.username from public.staff_users s where s.auth_id = auth.uid();
$$;

create or replace function public.get_my_profile()
  returns table(id text, username text, role text, full_name text)
  language sql stable security definer set search_path to 'public'
as $$
  select s.id::text, s.username, s.role, s.full_name
    from public.staff_users s where s.auth_id = auth.uid();
$$;

create or replace function public.get_invite(p_token text)
  returns table(guest_name text, promoter_username text, event_date text,
                access_mode text, payment_status text, checked_in boolean, qr_token text)
  language sql stable security definer set search_path to 'public'
as $$
  select pge.guest_name, pge.promoter_username, pge.event_date::text,
         pge.access_mode, pge.payment_status, pge.checked_in, pge.qr_token
    from public.promoter_guest_entries pge
   where pge.qr_token = p_token limit 1;
$$;

create or replace function public.public_events()
  returns table(venue_id text, venue_name text, title text, slug text,
                event_date date, start_time text, description text,
                lineup text[], cover_url text, ticket_url text)
  language sql stable security definer set search_path to 'public'
as $$
  select e.venue_id, v.name, e.title, e.slug, e.event_date, e.start_time,
         e.description, e.lineup, e.cover_url, e.ticket_url
    from public.events e join public.venues v on v.id = e.venue_id
   where e.status = 'published' and e.event_date >= current_date
   order by e.event_date asc, v.sort_order asc;
$$;

create or replace function public.add_expense(p_table_id text, p_label text, p_amount numeric, p_date_key text)
  returns void language sql set search_path to 'public'
as $$
  update public.club_tables
     set expenses = coalesce(expenses, '[]'::jsonb) || jsonb_build_object(
           'id', gen_random_uuid()::text,
           'label', p_label,
           'amount', p_amount,
           'createdAt', to_char(now(), 'HH24:MI'),
           'dateKey', p_date_key
         ),
         updated_at = now()
   where id = p_table_id;
$$;

create or replace function public.add_expense_v2(p_table_id text, p_label text, p_amount numeric, p_date_key text)
  returns table(ok boolean, code text, message text, table_id text, expense jsonb)
  language plpgsql set search_path to 'public'
as $$
declare
  v_expense jsonb;
  v_table_id text;
  v_date date;
  v_author text;
  v_role text;
begin
  if nullif(btrim(coalesce(p_table_id, '')), '') is null then
    return query select false, 'invalid_table_id', 'Table invalide.', null::text, null::jsonb;
    return;
  end if;

  if p_amount is null or p_amount <= 0 then
    return query select false, 'invalid_amount', 'Montant invalide.', p_table_id, null::jsonb;
    return;
  end if;

  if p_amount > 100000 then
    return query select false, 'amount_too_high', 'Montant trop eleve.', p_table_id, null::jsonb;
    return;
  end if;

  if coalesce(p_date_key, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    return query select false, 'invalid_date', 'Date de soiree invalide.', p_table_id, null::jsonb;
    return;
  end if;

  begin
    v_date := p_date_key::date;
  exception when others then
    return query select false, 'invalid_date', 'Date de soiree invalide.', p_table_id, null::jsonb;
    return;
  end;

  v_author := public.current_staff_username();
  v_role := public.current_staff_role();

  if v_author is null or v_role not in ('admin','manager','server','promoter') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', p_table_id, null::jsonb;
    return;
  end if;

  v_expense := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'label', coalesce(nullif(btrim(p_label), ''), 'Depense libre'),
    'amount', p_amount,
    'createdAt', to_char(now(), 'HH24:MI'),
    'dateKey', v_date::text,
    'createdBy', v_author
  );

  update public.club_tables
     set expenses = coalesce(expenses, '[]'::jsonb) || v_expense,
         status = case when status = 'free' then 'arrived' else status end,
         updated_at = now()
   where id = btrim(p_table_id)
   returning id into v_table_id;

  if v_table_id is null then
    return query select false, 'table_not_found_or_forbidden', 'Table introuvable ou action non autorisee.', p_table_id, null::jsonb;
    return;
  end if;

  return query select true, 'ok', 'Depense ajoutee.', v_table_id, v_expense;
end;
$$;

create or replace function public.check_in_invitation(p_token text, p_event_date text default null::text)
  returns table(ok boolean, code text, message text, guest_name text, promoter_username text, event_date text)
  language plpgsql set search_path to 'public'
as $$
declare
  v_token text := nullif(trim(coalesce(p_token, '')), '');
  v_event_date text := nullif(trim(coalesce(p_event_date, '')), '');
  v_updated record;
  v_existing record;
  v_staff_username text;
  v_staff_role text;
begin
  if v_token is null then
    return query select false, 'invalid_token', 'QR vide ou invalide.', null::text, null::text, null::text;
    return;
  end if;

  v_staff_username := public.current_staff_username();
  v_staff_role := public.current_staff_role();
  if v_staff_username is null
     or v_staff_role not in ('admin','manager','security','security_counter') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::text, null::text, null::text;
    return;
  end if;

  update public.promoter_guest_entries as pge
     set checked_in = true,
         checked_in_at = now(),
         checked_in_by = v_staff_username
   where pge.qr_token = v_token
     and pge.checked_in is distinct from true
     and (v_event_date is null or pge.event_date::text = v_event_date)
   returning pge.guest_name, pge.promoter_username, pge.event_date::text as event_date
     into v_updated;

  if v_updated is not null then
    insert into public.entry_logs (type, staff_username)
    values ('entry', v_staff_username);

    return query select true, 'checked_in', 'Entree validee.', v_updated.guest_name, v_updated.promoter_username, v_updated.event_date;
    return;
  end if;

  select pge.guest_name, pge.promoter_username, pge.event_date::text as event_date, pge.checked_in
    into v_existing
    from public.promoter_guest_entries pge
   where pge.qr_token = v_token
   limit 1;

  if v_existing is null then
    return query select false, 'unknown_token', 'QR introuvable ou invalide.', null::text, null::text, null::text;
    return;
  end if;

  if v_event_date is not null and v_existing.event_date <> v_event_date then
    return query select false, 'wrong_date', 'QR valide mais pas pour cette soiree.', null::text, null::text, v_existing.event_date;
    return;
  end if;

  if v_existing.checked_in then
    return query select false, 'already_used', 'QR deja utilise.', v_existing.guest_name, v_existing.promoter_username, v_existing.event_date;
    return;
  end if;

  return query select false, 'not_checked_in', 'Invitation non validee.', null::text, null::text, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS: enable on all 8 tables (not forced), matching prod
-- ---------------------------------------------------------------------------

alter table public.venues                 enable row level security;
alter table public.staff_users            enable row level security; -- no policy (service_role only)
alter table public.club_tables            enable row level security;
alter table public.entry_logs             enable row level security;
alter table public.event_archives         enable row level security;
alter table public.promoter_contacts      enable row level security;
alter table public.promoter_guest_entries enable row level security;
alter table public.events                 enable row level security;

-- club_tables policies (co_phase0b)
create policy co_phase0b_anon_club_tables_insert on public.club_tables for insert to anon with check (true);
create policy co_phase0b_anon_club_tables_select on public.club_tables for select to anon using (true);
create policy co_phase0b_anon_club_tables_update on public.club_tables for update to anon using (true) with check (true);
create policy co_phase0b_auth_club_tables_insert on public.club_tables for insert to authenticated with check (current_staff_role() = any (array['admin','manager','server','promoter']));
create policy co_phase0b_auth_club_tables_select on public.club_tables for select to authenticated using (current_staff_role() is not null);
create policy co_phase0b_auth_club_tables_update on public.club_tables for update to authenticated using (current_staff_role() = any (array['admin','manager','server','promoter'])) with check (current_staff_role() = any (array['admin','manager','server','promoter']));

-- entry_logs policies
create policy co_phase0b_anon_entry_logs_insert on public.entry_logs for insert to anon with check (true);
create policy co_phase0b_anon_entry_logs_select on public.entry_logs for select to anon using (true);
create policy co_phase0b_auth_entry_logs_insert on public.entry_logs for insert to authenticated with check (staff_username = current_staff_username());
create policy co_phase0b_auth_entry_logs_select on public.entry_logs for select to authenticated using (current_staff_role() is not null);

-- event_archives policies
create policy co_phase0b_anon_event_archives_insert on public.event_archives for insert to anon with check (true);
create policy co_phase0b_auth_event_archives_insert on public.event_archives for insert to authenticated with check (current_staff_role() = any (array['admin','manager']));

-- events policies
create policy events_read  on public.events for select to authenticated using (current_staff_role() is not null);
create policy events_write on public.events for all to authenticated using (current_staff_role() = any (array['admin','manager','promoter'])) with check (current_staff_role() = any (array['admin','manager','promoter']));

-- promoter_contacts policies
create policy co_phase0b_anon_promoter_contacts_insert on public.promoter_contacts for insert to anon with check (true);
create policy co_phase0b_anon_promoter_contacts_select on public.promoter_contacts for select to anon using (true);
create policy co_phase0b_auth_promoter_contacts_insert on public.promoter_contacts for insert to authenticated with check (current_staff_role() = any (array['admin','manager','promoter']));
create policy co_phase0b_auth_promoter_contacts_select on public.promoter_contacts for select to authenticated using (current_staff_role() is not null);

-- promoter_guest_entries policies
create policy co_phase0b_anon_pge_insert on public.promoter_guest_entries for insert to anon with check (true);
create policy co_phase0b_anon_pge_select on public.promoter_guest_entries for select to anon using (true);
create policy co_phase0b_anon_pge_update on public.promoter_guest_entries for update to anon using (true) with check (true);
create policy co_phase0b_auth_pge_insert on public.promoter_guest_entries for insert to authenticated with check (current_staff_role() = any (array['admin','manager','promoter']));
create policy co_phase0b_auth_pge_select on public.promoter_guest_entries for select to authenticated using (current_staff_role() is not null);
create policy co_phase0b_auth_pge_update on public.promoter_guest_entries for update to authenticated using (current_staff_role() = any (array['admin','manager','promoter','security','security_counter'])) with check (current_staff_role() = any (array['admin','manager','promoter','security','security_counter']));

-- venues policies
create policy venues_read on public.venues for select to authenticated using (current_staff_role() is not null);

-- ---------------------------------------------------------------------------
-- 4. GRANTS (faithful to prod: revoke-then-grant exact sets)
-- ---------------------------------------------------------------------------

-- Full-DML tables for both anon and authenticated (constrained only by RLS above)
do $$
declare t text;
begin
  foreach t in array array['club_tables','entry_logs','event_archives','promoter_contacts','promoter_guest_entries']
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete, truncate, references, trigger on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- events: authenticated full DML, anon none
revoke all on public.events from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on public.events to authenticated;

-- venues: authenticated read-ish, anon none
revoke all on public.venues from anon, authenticated;
grant select, references, trigger, truncate on public.venues to authenticated;

-- staff_users: locked (no anon/authenticated access; service_role only)
revoke all on public.staff_users from anon, authenticated;

-- Function EXECUTE grants (no PUBLIC on any; matches prod)
revoke all on function public.current_staff_role()      from public;
revoke all on function public.current_staff_username()  from public;
revoke all on function public.get_my_profile()          from public;
revoke all on function public.get_invite(text)          from public;
revoke all on function public.public_events()           from public;
revoke all on function public.add_expense(text,text,numeric,text)    from public;
revoke all on function public.add_expense_v2(text,text,numeric,text) from public;
revoke all on function public.check_in_invitation(text,text)         from public;

grant execute on function public.current_staff_role()      to authenticated;
grant execute on function public.current_staff_username()  to authenticated;
grant execute on function public.get_my_profile()          to authenticated;
grant execute on function public.get_invite(text)          to anon, authenticated;
grant execute on function public.public_events()           to anon, authenticated;
grant execute on function public.add_expense(text,text,numeric,text)    to authenticated;
grant execute on function public.add_expense_v2(text,text,numeric,text) to authenticated;
grant execute on function public.check_in_invitation(text,text)         to authenticated;
