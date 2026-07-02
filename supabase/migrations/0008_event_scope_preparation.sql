-- 0008_event_scope_preparation.sql
-- Preparation non destructive du perimetre evenementiel operationnel.
--
-- Cette migration reste une preparation : elle ajoute les objets necessaires,
-- garde les colonnes nullable, et laisse le cutover strict a 0009.

begin;

create table if not exists public.club_runtime_state (
  id boolean primary key default true,
  active_event_id uuid references public.events(id),
  bootstrap_completed_at timestamptz,
  last_closed_event_id uuid references public.events(id),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint club_runtime_state_singleton check (id)
);

alter table public.club_runtime_state
  add column if not exists id boolean default true,
  add column if not exists active_event_id uuid,
  add column if not exists bootstrap_completed_at timestamptz,
  add column if not exists last_closed_event_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by text;

do $$
declare
  v_runtime_rows int;
begin
  select count(*) into v_runtime_rows from public.club_runtime_state;

  if v_runtime_rows > 1 then
    raise exception '0008 blocked: club_runtime_state contains multiple rows';
  end if;

  if exists (select 1 from public.club_runtime_state where id is distinct from true) then
    raise exception '0008 blocked: club_runtime_state.id must be true';
  end if;

  if exists (
    select 1
      from public.club_runtime_state crs
      left join public.events e on e.id = crs.active_event_id
     where crs.active_event_id is not null
       and e.id is null
  ) then
    raise exception '0008 blocked: club_runtime_state.active_event_id references a missing event';
  end if;

  if exists (
    select 1
      from public.club_runtime_state crs
      left join public.events e on e.id = crs.last_closed_event_id
     where crs.last_closed_event_id is not null
       and e.id is null
  ) then
    raise exception '0008 blocked: club_runtime_state.last_closed_event_id references a missing event';
  end if;

  if exists (
    select 1
      from public.club_runtime_state
     where bootstrap_completed_at is null
       and (active_event_id is not null or last_closed_event_id is not null)
  ) then
    raise exception '0008 blocked: runtime cannot reference events before bootstrap_completed_at';
  end if;

  if exists (
    select 1
      from public.club_runtime_state
     where active_event_id is not null
       and last_closed_event_id is not null
       and active_event_id = last_closed_event_id
  ) then
    raise exception '0008 blocked: active_event_id cannot equal last_closed_event_id';
  end if;

  if exists (
    select 1
      from public.club_runtime_state crs
      join public.events e on e.id = crs.active_event_id
     where e.status = 'archived'
  ) then
    raise exception '0008 blocked: active_event_id cannot point to an archived event';
  end if;

  if v_runtime_rows = 0 then
    insert into public.club_runtime_state (id, active_event_id, bootstrap_completed_at, last_closed_event_id, updated_by)
    values (true, null, null, null, null);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.club_runtime_state'::regclass
       and contype = 'p'
  ) then
    alter table public.club_runtime_state
      add constraint club_runtime_state_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.club_runtime_state'::regclass
       and conname = 'club_runtime_state_singleton'
  ) then
    alter table public.club_runtime_state
      add constraint club_runtime_state_singleton check (id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.club_runtime_state'::regclass
       and conname = 'club_runtime_state_active_event_id_fkey'
  ) then
    alter table public.club_runtime_state
      add constraint club_runtime_state_active_event_id_fkey
      foreign key (active_event_id) references public.events(id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.club_runtime_state'::regclass
       and conname = 'club_runtime_state_last_closed_event_id_fkey'
  ) then
    alter table public.club_runtime_state
      add constraint club_runtime_state_last_closed_event_id_fkey
      foreign key (last_closed_event_id) references public.events(id) not valid;
  end if;
end;
$$;

alter table public.club_tables
  add column if not exists event_id uuid;

alter table public.entry_logs
  add column if not exists event_date date,
  add column if not exists event_id uuid;

alter table public.promoter_guest_entries
  add column if not exists event_id uuid;

alter table public.event_archives
  add column if not exists event_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_tables_event_id_fkey') then
    alter table public.club_tables
      add constraint club_tables_event_id_fkey
      foreign key (event_id) references public.events(id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'entry_logs_event_id_fkey') then
    alter table public.entry_logs
      add constraint entry_logs_event_id_fkey
      foreign key (event_id) references public.events(id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'promoter_guest_entries_event_id_fkey') then
    alter table public.promoter_guest_entries
      add constraint promoter_guest_entries_event_id_fkey
      foreign key (event_id) references public.events(id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'event_archives_event_id_fkey') then
    alter table public.event_archives
      add constraint event_archives_event_id_fkey
      foreign key (event_id) references public.events(id) not valid;
  end if;
end;
$$;

with unique_event_dates as (
  select event_date, min(id::text)::uuid as event_id
    from public.events
   group by event_date
  having count(*) = 1
)
update public.promoter_guest_entries pge
   set event_id = ued.event_id
  from unique_event_dates ued
 where pge.event_id is null
   and pge.event_date::date = ued.event_date;

with unique_event_dates as (
  select event_date, min(id::text)::uuid as event_id
    from public.events
   group by event_date
  having count(*) = 1
),
unique_archive_dates as (
  select event_date::date as event_date
    from public.event_archives
   where event_date is not null
   group by event_date::date
  having count(*) = 1
)
update public.event_archives ea
   set event_id = ued.event_id
  from unique_event_dates ued
  join unique_archive_dates uad on uad.event_date = ued.event_date
 where ea.event_id is null
   and ea.event_date::date = ued.event_date;

update public.entry_logs
   set event_date = created_at::date
 where event_date is null
   and created_at is not null;

with unique_event_dates as (
  select event_date, min(id::text)::uuid as event_id
    from public.events
   group by event_date
  having count(*) = 1
)
update public.entry_logs el
   set event_id = ued.event_id
  from unique_event_dates ued
 where el.event_id is null
   and el.event_date = ued.event_date;

create or replace function public.current_active_event_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select crs.active_event_id
    from public.club_runtime_state crs
   where crs.id is true;
$$;
revoke all on function public.current_active_event_id() from public;
grant execute on function public.current_active_event_id() to authenticated;

create or replace function public.current_active_event_date()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select e.event_date
    from public.club_runtime_state crs
    join public.events e on e.id = crs.active_event_id
   where crs.id is true;
$$;
revoke all on function public.current_active_event_date() from public;
grant execute on function public.current_active_event_date() to authenticated;

create or replace function public.co_is_server_table_scope(p_assigned_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(btrim(p_assigned_to), ''), '') in ('', 'jeremy', 'server');
$$;
revoke all on function public.co_is_server_table_scope(text) from public;
grant execute on function public.co_is_server_table_scope(text) to authenticated;

create or replace function public.get_active_event_context()
returns table (
  event_id uuid,
  event_date date,
  title text,
  bootstrap_completed boolean,
  bootstrap_completed_at timestamptz,
  last_closed_event_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         e.event_date,
         e.title,
         crs.bootstrap_completed_at is not null,
         crs.bootstrap_completed_at,
         crs.last_closed_event_id
    from public.club_runtime_state crs
    left join public.events e on e.id = crs.active_event_id
   where crs.id is true;
$$;
revoke all on function public.get_active_event_context() from public;
grant execute on function public.get_active_event_context() to authenticated;

create or replace function public.list_activatable_club_events()
returns table (
  id uuid,
  title text,
  event_date date,
  status text,
  venue_id text,
  venue_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         e.title,
         e.event_date,
         e.status,
         e.venue_id,
         v.name as venue_name
    from public.events e
    left join public.venues v on v.id = e.venue_id
   where auth.uid() is not null
     and public.current_staff_role() in ('admin','manager')
     and e.status in ('draft','published')
     and e.id is distinct from public.current_active_event_id()
   order by e.event_date asc, e.title asc;
$$;
revoke all on function public.list_activatable_club_events() from public;
grant execute on function public.list_activatable_club_events() to authenticated;

create or replace function public.get_security_table_snapshot()
returns table (
  id text,
  zone text,
  status text,
  client text,
  phone text,
  people text,
  notes text,
  event_date text,
  event_id uuid,
  revenue_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped_tables as (
    select ct.*,
           case
             when nullif(btrim(coalesce(ct.linked_group_id, '')), '') is not null then ct.linked_group_id
             when coalesce(array_length(ct.linked_tables, 1), 0) > 0 then (
               select string_agg(value, '+' order by value)
                 from unnest(array_append(ct.linked_tables, ct.id)) value
             )
             else ct.id
           end as revenue_group_key
      from public.club_tables ct
     where auth.uid() is not null
       and public.current_staff_role() in ('admin','manager','security')
       and public.current_active_event_id() is not null
       and ct.event_id = public.current_active_event_id()
  ),
  canonical_groups as (
    select revenue_group_key, min(id) as canonical_id
      from scoped_tables
     group by revenue_group_key
  ),
  group_revenue as (
    select st.revenue_group_key,
           coalesce(sum(coalesce((expense->>'amount')::numeric, 0)), 0) as total
      from scoped_tables st
      left join lateral jsonb_array_elements(coalesce(st.expenses, '[]'::jsonb)) expense on true
     group by st.revenue_group_key
  )
  select st.id,
         st.zone,
         st.status,
         st.client,
         st.phone,
         st.people,
         st.notes,
         st.event_date::text,
         st.event_id,
         case when st.id = cg.canonical_id then coalesce(gr.total, 0) else 0 end as revenue_total
    from scoped_tables st
    join canonical_groups cg on cg.revenue_group_key = st.revenue_group_key
    left join group_revenue gr on gr.revenue_group_key = st.revenue_group_key
   order by st.id;
$$;
revoke all on function public.get_security_table_snapshot() from public;
grant execute on function public.get_security_table_snapshot() to authenticated;

create or replace function public.bootstrap_club_event_v2(p_event_id uuid)
returns table (ok boolean, code text, message text, event_id uuid, event_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_event record;
  v_active uuid;
  v_bootstrap_marker text;
  v_table_count int;
  v_live_count int;
  v_live_date_count int;
  v_live_date date;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid, null::date;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid, null::date;
    return;
  end if;

  select e.id, e.event_date, e.status into v_event
    from public.events e
   where e.id = p_event_id;
  if v_event.id is null then
    return query select false, 'unknown_event', 'Evenement introuvable.', null::uuid, null::date;
    return;
  end if;

  if v_event.status = 'archived' then
    return query select false, 'event_archived', 'Evenement deja archive.', null::uuid, null::date;
    return;
  end if;

  if v_event.status not in ('draft','published') then
    return query select false, 'event_not_activatable', 'Statut evenement non activable.', null::uuid, null::date;
    return;
  end if;

  select active_event_id, bootstrap_completed_at::text into v_active, v_bootstrap_marker
    from public.club_runtime_state
   where id is true
   for update;

  if v_active is not null then
    return query select false, 'already_active', 'Une soiree est deja active.', v_active, null::date;
    return;
  end if;

  if v_bootstrap_marker is not null then
    return query select false, 'bootstrap_already_done', 'Le bootstrap initial a deja ete effectue.', null::uuid, null::date;
    return;
  end if;

  select count(*) into v_table_count from public.club_tables;
  if v_table_count <> 18 then
    return query select false, 'invalid_table_count', 'Les 18 tables operationnelles sont requises.', null::uuid, null::date;
    return;
  end if;

  select count(*) into v_live_count
    from public.club_tables
   where status <> 'free'
      or coalesce(client, '') <> ''
      or coalesce(phone, '') <> ''
      or coalesce(people, '') <> ''
      or coalesce(notes, '') <> ''
      or coalesce(booker, '') <> ''
      or coalesce(assigned_to, '') <> ''
      or coalesce(linked_group_id, '') <> ''
      or coalesce(array_length(linked_tables, 1), 0) > 0
      or coalesce(expenses, '[]'::jsonb) <> '[]'::jsonb;

  select count(distinct club_tables.event_date::date), min(club_tables.event_date::date)
    into v_live_date_count, v_live_date
    from public.club_tables
   where nullif(btrim(coalesce(club_tables.event_date, '')), '') is not null;

  if v_live_count > 0 then
    if v_live_date_count <> 1 then
      return query select false, 'ambiguous_live_dates', 'Les donnees live contiennent plusieurs dates.', null::uuid, null::date;
      return;
    end if;

    if v_live_date is distinct from v_event.event_date then
      return query select false, 'incompatible_live_date', 'La date live ne correspond pas a l''evenement choisi.', null::uuid, null::date;
      return;
    end if;
  end if;

  update public.club_runtime_state
     set active_event_id = p_event_id,
         bootstrap_completed_at = now(),
         updated_at = now(),
         updated_by = v_username
   where id is true;

  update public.club_tables
     set event_id = p_event_id,
         event_date = v_event.event_date::text,
         updated_at = now();

  return query select true, 'ok', 'Premiere soiree activee.', v_event.id, v_event.event_date;
end;
$$;
revoke all on function public.bootstrap_club_event_v2(uuid) from public;
grant execute on function public.bootstrap_club_event_v2(uuid) to authenticated;

create or replace function public.activate_club_event_v2(p_event_id uuid)
returns table (ok boolean, code text, message text, event_id uuid, event_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_event record;
  v_active uuid;
  v_bootstrap_completed_at timestamptz;
  v_last_closed_event_id uuid;
  v_table_count int;
  v_busy_count int;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid, null::date;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid, null::date;
    return;
  end if;

  select e.id, e.event_date, e.status into v_event
    from public.events e
   where e.id = p_event_id;
  if v_event.id is null then
    return query select false, 'unknown_event', 'Evenement introuvable.', null::uuid, null::date;
    return;
  end if;

  if v_event.status = 'archived' then
    return query select false, 'event_archived', 'Evenement deja archive.', null::uuid, null::date;
    return;
  end if;

  if v_event.status not in ('draft','published') then
    return query select false, 'event_not_activatable', 'Statut evenement non activable.', null::uuid, null::date;
    return;
  end if;

  select active_event_id, bootstrap_completed_at, last_closed_event_id
    into v_active, v_bootstrap_completed_at, v_last_closed_event_id
    from public.club_runtime_state
   where id is true
   for update;

  if v_active is not null then
    return query select false, 'event_still_active', 'La soiree precedente doit etre cloturee avant activation.', v_active, null::date;
    return;
  end if;

  if v_bootstrap_completed_at is null then
    return query select false, 'bootstrap_required', 'Le bootstrap initial doit etre effectue avant une activation suivante.', null::uuid, null::date;
    return;
  end if;

  if p_event_id = v_last_closed_event_id then
    return query select false, 'same_as_last_closed_event', 'La derniere soiree cloturee ne peut pas etre reactivee.', null::uuid, null::date;
    return;
  end if;

  select count(*) into v_table_count from public.club_tables;
  if v_table_count <> 18 then
    return query select false, 'invalid_table_count', 'Les 18 tables operationnelles sont requises.', null::uuid, null::date;
    return;
  end if;

  select count(*) into v_busy_count
    from public.club_tables
   where status <> 'free'
      or coalesce(client, '') <> ''
      or coalesce(phone, '') <> ''
      or coalesce(people, '') <> ''
      or coalesce(notes, '') <> ''
      or coalesce(booker, '') <> ''
      or coalesce(assigned_to, '') <> ''
      or coalesce(linked_group_id, '') <> ''
      or coalesce(array_length(linked_tables, 1), 0) > 0
      or coalesce(expenses, '[]'::jsonb) <> '[]'::jsonb;

  if v_busy_count > 0 then
    return query select false, 'live_state_not_reset', 'Les tables doivent etre reinitialisees avant activation.', null::uuid, null::date;
    return;
  end if;

  update public.club_runtime_state
     set active_event_id = p_event_id,
         updated_at = now(),
         updated_by = v_username
   where id is true;

  update public.club_tables
     set event_id = p_event_id,
         event_date = v_event.event_date::text,
         status = 'free',
         client = '',
         phone = '',
         people = '',
         notes = '',
         booker = '',
         assigned_to = '',
         linked_group_id = '',
         linked_tables = array[]::text[],
         expenses = '[]'::jsonb,
         updated_at = now();

  return query select true, 'ok', 'Evenement actif configure.', v_event.id, v_event.event_date;
end;
$$;
revoke all on function public.activate_club_event_v2(uuid) from public;
grant execute on function public.activate_club_event_v2(uuid) to authenticated;

create or replace function public.add_entry_log_v2(p_type text)
returns table (ok boolean, code text, message text, log_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_event_id uuid;
  v_event_date date;
  v_log_id text;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::text;
    return;
  end if;

  if p_type not in ('entry','exit') then
    return query select false, 'invalid_type', 'Type de flux invalide.', null::text;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager','security_counter') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::text;
    return;
  end if;

  v_event_id := public.current_active_event_id();
  v_event_date := public.current_active_event_date();
  if v_event_id is null or v_event_date is null then
    return query select false, 'missing_active_event', 'Aucun evenement actif.', null::text;
    return;
  end if;

  insert into public.entry_logs (type, staff_username, event_id, event_date)
  values (p_type, v_username, v_event_id, v_event_date)
  returning id::text into v_log_id;

  return query select true, 'ok', 'Flux ajoute.', v_log_id;
end;
$$;
revoke all on function public.add_entry_log_v2(text) from public;
grant execute on function public.add_entry_log_v2(text) to authenticated;

create or replace function public.add_expense_v3(
  p_table_id text,
  p_label text,
  p_amount numeric,
  p_date_key text
) returns table (
  ok boolean,
  code text,
  message text,
  table_id text,
  expense jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense jsonb;
  v_table_id text;
  v_date date;
  v_author text;
  v_role text;
  v_active_event_id uuid;
  v_active_event_date date;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', p_table_id, null::jsonb;
    return;
  end if;

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

  begin
    v_date := p_date_key::date;
  exception when others then
    return query select false, 'invalid_date', 'Date de soiree invalide.', p_table_id, null::jsonb;
    return;
  end;

  v_active_event_id := public.current_active_event_id();
  v_active_event_date := public.current_active_event_date();
  if v_active_event_id is null or v_active_event_date is null then
    return query select false, 'missing_active_event', 'Aucun evenement actif.', p_table_id, null::jsonb;
    return;
  end if;

  if v_date is distinct from v_active_event_date then
    return query select false, 'wrong_event_date', 'Date de soiree invalide.', p_table_id, null::jsonb;
    return;
  end if;

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
    'dateKey', v_active_event_date::text,
    'eventId', v_active_event_id::text,
    'createdBy', v_author
  );

  update public.club_tables ct
     set expenses = coalesce(ct.expenses, '[]'::jsonb) || v_expense,
         status = case when ct.status = 'free' then 'arrived' else ct.status end,
         updated_at = now()
   where ct.id = btrim(p_table_id)
     and ct.event_id = v_active_event_id
     and ct.event_date::date = v_active_event_date
     and (
       v_role in ('admin','manager','promoter')
       or (v_role = 'server' and public.co_is_server_table_scope(ct.assigned_to))
     )
   returning ct.id into v_table_id;

  if v_table_id is null then
    return query select false, 'table_not_found_or_forbidden', 'Table introuvable ou action non autorisee.', p_table_id, null::jsonb;
    return;
  end if;

  return query select true, 'ok', 'Depense ajoutee.', v_table_id, v_expense;
end;
$$;
revoke all on function public.add_expense_v3(text, text, numeric, text) from public;
grant execute on function public.add_expense_v3(text, text, numeric, text) to authenticated;

create or replace function public.check_in_invitation_v2(
  p_token text,
  p_event_date text default null
) returns table (
  ok boolean,
  code text,
  message text,
  guest_name text,
  promoter_username text,
  event_date text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(trim(coalesce(p_token, '')), '');
  v_event_date text := nullif(trim(coalesce(p_event_date, '')), '');
  v_active_event_id uuid;
  v_active_event_date date;
  v_updated record;
  v_existing record;
  v_staff_username text;
  v_staff_role text;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::text, null::text, null::text;
    return;
  end if;

  if v_token is null then
    return query select false, 'invalid_token', 'QR vide ou invalide.', null::text, null::text, null::text;
    return;
  end if;

  v_active_event_id := public.current_active_event_id();
  v_active_event_date := public.current_active_event_date();
  if v_active_event_id is null or v_active_event_date is null then
    return query select false, 'missing_active_event', 'Aucun evenement actif.', null::text, null::text, null::text;
    return;
  end if;

  if v_event_date is not null and v_event_date::date is distinct from v_active_event_date then
    return query select false, 'wrong_date', 'QR valide mais pas pour cette soiree.', null::text, null::text, v_active_event_date::text;
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
     and pge.event_id = v_active_event_id
     and pge.event_date::date = v_active_event_date
     and pge.checked_in is distinct from true
   returning pge.guest_name, pge.promoter_username, pge.event_date::text as event_date
     into v_updated;

  if v_updated is not null then
    insert into public.entry_logs (type, staff_username, event_id, event_date)
    values ('entry', v_staff_username, v_active_event_id, v_active_event_date);

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

  if v_existing.event_date <> v_active_event_date::text then
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
revoke all on function public.check_in_invitation_v2(text, text) from public;
grant execute on function public.check_in_invitation_v2(text, text) to authenticated;

create or replace function public.create_promoter_invitation_v2(
  p_promoter_username text,
  p_contact_id uuid,
  p_guest_name text,
  p_phone text,
  p_access_mode text,
  p_payment_status text
) returns table (
  ok boolean,
  code text,
  message text,
  invitation_id text,
  qr_token text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_event_id uuid;
  v_event_date date;
  v_promoter_username text := lower(nullif(btrim(coalesce(p_promoter_username, '')), ''));
  v_guest_name text := nullif(btrim(coalesce(p_guest_name, '')), '');
  v_token text;
  v_invitation_id text;
  v_attempt int;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::text, null::text;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager','promoter') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::text, null::text;
    return;
  end if;

  if v_role = 'promoter' and v_promoter_username is distinct from v_username then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::text, null::text;
    return;
  end if;

  if v_promoter_username is null then
    return query select false, 'invalid_promoter', 'Promoteur invalide.', null::text, null::text;
    return;
  end if;

  if not exists (
    select 1
      from public.staff_users s
     where s.username = v_promoter_username
       and s.role = 'promoter'
  ) then
    return query select false, 'unknown_promoter', 'Promoteur introuvable.', null::text, null::text;
    return;
  end if;

  if v_guest_name is null and nullif(btrim(coalesce(p_phone, '')), '') is null then
    return query select false, 'invalid_guest', 'Invite invalide.', null::text, null::text;
    return;
  end if;

  if p_access_mode not in ('avec_alcool','sans_alcool') then
    return query select false, 'invalid_access_mode', 'Mode d''acces invalide.', null::text, null::text;
    return;
  end if;

  if p_payment_status not in ('regle','en_attente','offert') then
    return query select false, 'invalid_payment_status', 'Statut de paiement invalide.', null::text, null::text;
    return;
  end if;

  v_event_id := public.current_active_event_id();
  v_event_date := public.current_active_event_date();
  if v_event_id is null or v_event_date is null then
    return query select false, 'missing_active_event', 'Aucun evenement actif.', null::text, null::text;
    return;
  end if;

  for v_attempt in 1..5 loop
    v_token := gen_random_uuid()::text;
    begin
      insert into public.promoter_guest_entries (
        event_date,
        event_id,
        promoter_username,
        contact_id,
        guest_name,
        phone,
        access_mode,
        payment_status,
        qr_token
      )
      values (
        v_event_date,
        v_event_id,
        v_promoter_username,
        p_contact_id,
        coalesce(v_guest_name, nullif(btrim(coalesce(p_phone, '')), ''), 'Client'),
        coalesce(nullif(btrim(coalesce(p_phone, '')), ''), ''),
        p_access_mode,
        p_payment_status,
        v_token
      )
      returning id::text into v_invitation_id;

      return query select true, 'ok', 'Invitation creee.', v_invitation_id, v_token;
      return;
    exception
      when unique_violation then
        if v_attempt = 5 then
          return query select false, 'duplicate_token', 'Generation QR impossible.', null::text, null::text;
          return;
        end if;
    end;
  end loop;
end;
$$;
revoke all on function public.create_promoter_invitation_v2(text, uuid, text, text, text, text) from public;
grant execute on function public.create_promoter_invitation_v2(text, uuid, text, text, text, text) to authenticated;

create or replace function public.close_club_event_v2()
returns table (ok boolean, code text, message text, event_id uuid, event_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_event_id uuid;
  v_event_date date;
  v_table_count int;
  v_revenue numeric;
  v_entries int;
  v_exits int;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid, null::date;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid, null::date;
    return;
  end if;

  select crs.active_event_id, e.event_date
    into v_event_id, v_event_date
    from public.club_runtime_state crs
    left join public.events e on e.id = crs.active_event_id
   where crs.id is true
   for update;

  if v_event_id is null or v_event_date is null then
    return query select false, 'missing_active_event', 'Aucun evenement actif.', null::uuid, null::date;
    return;
  end if;

  select count(*) into v_table_count
    from public.club_tables
   where event_id = v_event_id
     and event_date::date = v_event_date;
  if v_table_count <> 18 then
    return query select false, 'invalid_table_count', 'Les 18 tables actives sont requises.', v_event_id, v_event_date;
    return;
  end if;

  if exists (select 1 from public.event_archives ea where ea.event_id = v_event_id) then
    return query select false, 'already_archived', 'Cet evenement est deja archive.', v_event_id, v_event_date;
    return;
  end if;

  select coalesce(sum(coalesce((expense->>'amount')::numeric, 0)), 0)
    into v_revenue
    from public.club_tables ct
    cross join lateral jsonb_array_elements(coalesce(ct.expenses, '[]'::jsonb)) expense
   where ct.event_id = v_event_id;

  select count(*) filter (where type = 'entry'),
         count(*) filter (where type = 'exit')
    into v_entries, v_exits
    from public.entry_logs
   where event_id = v_event_id;

  insert into public.event_archives (
    event_date,
    event_id,
    closed_by,
    total_revenue,
    total_entries,
    total_exits,
    tables_snapshot,
    entry_logs_snapshot
  )
  values (
    v_event_date,
    v_event_id,
    v_username,
    coalesce(v_revenue, 0),
    coalesce(v_entries, 0),
    coalesce(v_exits, 0),
    (select coalesce(jsonb_agg(to_jsonb(ct) order by ct.id), '[]'::jsonb) from public.club_tables ct where ct.event_id = v_event_id),
    (select coalesce(jsonb_agg(to_jsonb(el) order by el.created_at), '[]'::jsonb) from public.entry_logs el where el.event_id = v_event_id)
  );

  update public.events
     set status = 'archived',
         updated_at = now()
   where id = v_event_id;

  update public.club_tables
     set event_id = null,
         event_date = null,
         status = 'free',
         client = '',
         phone = '',
         people = '',
         notes = '',
         booker = '',
         assigned_to = '',
         linked_group_id = '',
         linked_tables = array[]::text[],
         expenses = '[]'::jsonb,
         updated_at = now()
   where event_id = v_event_id;

  update public.club_runtime_state
     set active_event_id = null,
         last_closed_event_id = v_event_id,
         updated_at = now(),
         updated_by = v_username
   where id is true;

  return query select true, 'ok', 'Soiree cloturee et archivee.', v_event_id, v_event_date;
end;
$$;
revoke all on function public.close_club_event_v2() from public;
grant execute on function public.close_club_event_v2() to authenticated;

create index if not exists club_tables_event_id_idx
  on public.club_tables(event_id);

create index if not exists entry_logs_event_id_created_at_idx
  on public.entry_logs(event_id, created_at desc);

create index if not exists entry_logs_event_date_created_at_idx
  on public.entry_logs(event_date, created_at desc);

create index if not exists promoter_guest_entries_event_id_promoter_idx
  on public.promoter_guest_entries(event_id, promoter_username);

create index if not exists promoter_guest_entries_event_date_promoter_idx
  on public.promoter_guest_entries(event_date, promoter_username);

do $$
begin
  if exists (
    select 1
      from public.event_archives
     where event_id is not null
     group by event_id
    having count(*) > 1
  ) then
    raise exception '0008 blocked: duplicate event_archives.event_id values must be resolved before unique index creation';
  end if;
end;
$$;

create unique index if not exists event_archives_event_id_unique_idx
  on public.event_archives(event_id)
  where event_id is not null;

commit;
