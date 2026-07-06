-- 0054_event_management.sql — GESTION DES SOIRÉES (agenda éditable), structure + RPC. Additif / idempotent.
--
-- Contexte : `public.events` existe depuis 0004 (modèle Lieux + Événements) et n'était jusqu'ici que
-- LU par l'appli (créé par seed SQL). Cette migration ouvre la PLANIFICATION éditable : champs de
-- programmation manquants + RPC direction pour créer / modifier / dupliquer / annuler une soirée FUTURE.
--
-- ⚠️ SÉPARATION DURE (D-00) : ceci NE touche PAS le cycle runtime (bootstrap/activate/close_club_event_v2
--   ni club_runtime_state). create_event_v1 insère une ligne planifiée (draft/published) ; il n'active
--   JAMAIS le singleton d'exploitation. Ouvrir/fermer ici = éditer un statut de planification, pas lancer
--   la soirée en cours.
--
-- Statuts de planification : draft → published → open → closed. 'archived' reste réservé à la clôture
--   runtime (0008) et est traité en état terminal verrouillé par les RPC ci-dessous.
--
-- Sécurité : toutes les RPC sont SECURITY DEFINER, search_path=public, gate admin/manager via
--   current_staff_role(), GRANT EXECUTE restreint à authenticated (jamais public/anon). L'id serveur est
--   généré par gen_random_uuid(). RLS de `events` (0004) inchangée. Réversible.

begin;

-- ───────── Champs de planification (additif strict, tous nullable) ─────────
alter table public.events
  add column if not exists artistes text,          -- programmation libre (texte) ; complète lineup[] existant
  add column if not exists horaire_debut text,     -- ex. '23:30' / '23h30' (souple, passage minuit possible)
  add column if not exists horaire_fin text,       -- ex. '05:00'
  add column if not exists espace text,            -- sous-espace au sein de l'univers (venue_id existe déjà)
  add column if not exists capacite integer,       -- jauge planifiée (null = non renseignée)
  add column if not exists equipe jsonb,           -- équipe affectée (liste/objets), saisie direction
  add column if not exists notes text;             -- notes de planification

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.events'::regclass and conname = 'events_capacite_nonneg'
  ) then
    alter table public.events
      add constraint events_capacite_nonneg check (capacite is null or capacite >= 0) not valid;
  end if;
end;
$$;

comment on column public.events.artistes is 'Programmation libre (texte) — saisie direction, jamais inventée.';
comment on column public.events.equipe is 'Équipe affectée (jsonb) — saisie direction.';

-- ───────── Vocabulaire de statut : draft/published/open/closed + archived (runtime) ─────────
-- 0004 ne posait qu'un INDEX sur status (aucune contrainte CHECK). On installe une contrainte fermée
-- incluant les nouveaux statuts de planification ET 'archived' (posé par la clôture runtime), de façon
-- idempotente. NOT VALID : n'échoue pas sur d'éventuelles lignes historiques, mais garde tout INSERT/UPDATE.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_status_check'
  ) then
    alter table public.events drop constraint events_status_check;
  end if;

  alter table public.events
    add constraint events_status_check
    check (status in ('draft','published','open','closed','archived')) not valid;
end;
$$;

-- ───────── Garde de transition de statut (miroir de lib/eventManagement.validateStatusTransition) ─────────
-- Pure/immutable. draft→{published,closed} ; published→{draft,open,closed} ; open→{closed} ;
-- closed/archived = terminaux. Un no-op (from = to) est autorisé.
create or replace function public.event_status_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_to not in ('draft','published','open','closed') then false
    when p_from = p_to then true
    when p_from = 'draft'     and p_to in ('published','closed') then true
    when p_from = 'published' and p_to in ('draft','open','closed') then true
    when p_from = 'open'      and p_to = 'closed' then true
    else false
  end;
$$;
revoke all on function public.event_status_transition_allowed(text, text) from public;
grant execute on function public.event_status_transition_allowed(text, text) to authenticated;

-- ───────── create_event_v1 : insère une soirée planifiée (draft/published) ─────────
create or replace function public.create_event_v1(
  p_venue_id text,
  p_title text,
  p_event_date date,
  p_status text default 'draft',
  p_artistes text default null,
  p_horaire_debut text default null,
  p_horaire_fin text default null,
  p_espace text default null,
  p_capacite integer default null,
  p_equipe jsonb default null,
  p_notes text default null
) returns table (ok boolean, code text, message text, event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_status text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'draft');
  v_new_id uuid;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid;
    return;
  end if;

  if v_title is null then
    return query select false, 'invalid_title', 'Titre de soiree requis.', null::uuid;
    return;
  end if;

  if p_event_date is null then
    return query select false, 'invalid_date', 'Date de soiree requise.', null::uuid;
    return;
  end if;

  if v_status not in ('draft','published') then
    return query select false, 'invalid_status', 'Une soiree se cree en brouillon ou publiee.', null::uuid;
    return;
  end if;

  if not exists (select 1 from public.venues v where v.id = p_venue_id) then
    return query select false, 'unknown_venue', 'Univers introuvable.', null::uuid;
    return;
  end if;

  if p_capacite is not null and p_capacite < 0 then
    return query select false, 'invalid_capacite', 'Capacite invalide.', null::uuid;
    return;
  end if;

  insert into public.events (
    id, venue_id, title, event_date, status,
    artistes, horaire_debut, horaire_fin, espace, capacite, equipe, notes,
    created_by, created_at, updated_at
  ) values (
    gen_random_uuid(), p_venue_id, v_title, p_event_date, v_status,
    nullif(btrim(coalesce(p_artistes, '')), ''),
    nullif(btrim(coalesce(p_horaire_debut, '')), ''),
    nullif(btrim(coalesce(p_horaire_fin, '')), ''),
    nullif(btrim(coalesce(p_espace, '')), ''),
    p_capacite, p_equipe, nullif(btrim(coalesce(p_notes, '')), ''),
    v_username, now(), now()
  )
  returning id into v_new_id;

  return query select true, 'ok', 'Soiree creee.', v_new_id;
end;
$$;
revoke all on function public.create_event_v1(text, text, date, text, text, text, text, text, integer, jsonb, text) from public;
grant execute on function public.create_event_v1(text, text, date, text, text, text, text, text, integer, jsonb, text) to authenticated;

-- ───────── update_event_v1 : modifie une soirée planifiée (coalesce = champ null conserve l'existant) ─────────
create or replace function public.update_event_v1(
  p_event_id uuid,
  p_title text default null,
  p_venue_id text default null,
  p_event_date date default null,
  p_status text default null,
  p_artistes text default null,
  p_horaire_debut text default null,
  p_horaire_fin text default null,
  p_espace text default null,
  p_capacite integer default null,
  p_equipe jsonb default null,
  p_notes text default null
) returns table (ok boolean, code text, message text, event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_event record;
  v_new_status text;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid;
    return;
  end if;

  select e.id, e.status into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    return query select false, 'unknown_event', 'Soiree introuvable.', null::uuid;
    return;
  end if;

  if v_event.status = 'archived' then
    return query select false, 'event_locked', 'Soiree archivee : edition verrouillee.', p_event_id;
    return;
  end if;

  v_new_status := coalesce(nullif(btrim(coalesce(p_status, '')), ''), v_event.status);
  if v_new_status is distinct from v_event.status
     and not public.event_status_transition_allowed(v_event.status, v_new_status) then
    return query select false, 'invalid_transition',
      format('Transition %s -> %s interdite.', v_event.status, v_new_status), p_event_id;
    return;
  end if;

  if p_venue_id is not null and not exists (select 1 from public.venues v where v.id = p_venue_id) then
    return query select false, 'unknown_venue', 'Univers introuvable.', p_event_id;
    return;
  end if;

  if p_capacite is not null and p_capacite < 0 then
    return query select false, 'invalid_capacite', 'Capacite invalide.', p_event_id;
    return;
  end if;

  update public.events e
     set title         = coalesce(nullif(btrim(coalesce(p_title, '')), ''), e.title),
         venue_id      = coalesce(p_venue_id, e.venue_id),
         event_date    = coalesce(p_event_date, e.event_date),
         status        = v_new_status,
         artistes      = coalesce(p_artistes, e.artistes),
         horaire_debut = coalesce(p_horaire_debut, e.horaire_debut),
         horaire_fin   = coalesce(p_horaire_fin, e.horaire_fin),
         espace        = coalesce(p_espace, e.espace),
         capacite      = coalesce(p_capacite, e.capacite),
         equipe        = coalesce(p_equipe, e.equipe),
         notes         = coalesce(p_notes, e.notes),
         updated_at    = now()
   where e.id = p_event_id;

  return query select true, 'ok', 'Soiree mise a jour.', p_event_id;
end;
$$;
revoke all on function public.update_event_v1(uuid, text, text, date, text, text, text, text, text, integer, jsonb, text) from public;
grant execute on function public.update_event_v1(uuid, text, text, date, text, text, text, text, text, integer, jsonb, text) to authenticated;

-- ───────── duplicate_event_v1 : clone une soirée source vers une nouvelle date (nouvelle soirée brouillon) ─────────
create or replace function public.duplicate_event_v1(
  p_source_event_id uuid,
  p_new_date date
) returns table (ok boolean, code text, message text, event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_src record;
  v_new_id uuid;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid;
    return;
  end if;

  if p_new_date is null then
    return query select false, 'invalid_date', 'Nouvelle date requise.', null::uuid;
    return;
  end if;

  select * into v_src from public.events e where e.id = p_source_event_id;
  if v_src.id is null then
    return query select false, 'unknown_event', 'Soiree source introuvable.', null::uuid;
    return;
  end if;

  -- Nouvelle soirée en brouillon, slug remis à null (unique) : le clone repart d'un état neutre.
  insert into public.events (
    id, venue_id, title, slug, event_date, start_time, status, description, lineup,
    cover_url, ticket_url, reservation_phone, format,
    artistes, horaire_debut, horaire_fin, espace, capacite, equipe, notes,
    created_by, created_at, updated_at
  ) values (
    gen_random_uuid(), v_src.venue_id, v_src.title, null, p_new_date, v_src.start_time, 'draft',
    v_src.description, v_src.lineup, v_src.cover_url, v_src.ticket_url, v_src.reservation_phone, v_src.format,
    v_src.artistes, v_src.horaire_debut, v_src.horaire_fin, v_src.espace, v_src.capacite, v_src.equipe, v_src.notes,
    v_username, now(), now()
  )
  returning id into v_new_id;

  return query select true, 'ok', 'Soiree dupliquee.', v_new_id;
end;
$$;
revoke all on function public.duplicate_event_v1(uuid, date) from public;
grant execute on function public.duplicate_event_v1(uuid, date) to authenticated;

-- ───────── cancel_event_v1 : annule (statut = closed) une soirée planifiée ─────────
create or replace function public.cancel_event_v1(p_event_id uuid)
returns table (ok boolean, code text, message text, event_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_event record;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid;
    return;
  end if;

  select e.id, e.status into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null then
    return query select false, 'unknown_event', 'Soiree introuvable.', null::uuid;
    return;
  end if;

  if v_event.status = 'archived' then
    return query select false, 'event_locked', 'Soiree archivee : edition verrouillee.', p_event_id;
    return;
  end if;

  if v_event.status = 'closed' then
    return query select false, 'already_closed', 'Soiree deja annulee.', p_event_id;
    return;
  end if;

  if not public.event_status_transition_allowed(v_event.status, 'closed') then
    return query select false, 'invalid_transition',
      format('Transition %s -> closed interdite.', v_event.status), p_event_id;
    return;
  end if;

  update public.events
     set status = 'closed',
         updated_at = now()
   where id = p_event_id;

  return query select true, 'ok', 'Soiree annulee.', p_event_id;
end;
$$;
revoke all on function public.cancel_event_v1(uuid) from public;
grant execute on function public.cancel_event_v1(uuid) to authenticated;

commit;
