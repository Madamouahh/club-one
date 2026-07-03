-- 0023_incidents.sql — Module INCIDENTS (A6) : STRUCTURE seule, à visibilité RESTREINTE par RLS.
--
-- Registre des incidents de soirée (altercation, refus d'entrée, malaise, vol, dégradation…) avec
-- son fil de suivi (actions, changements de statut, escalade). Donnée SENSIBLE : la matrice d'accès
-- (CLUB_ONE_OS_MASTER §4.2, ligne A6) impose une visibilité restreinte par la RLS, JAMAIS par simple
-- masquage d'UI :
--   · admin / manager / security : lecture COMPLÈTE (supervision + rapport post-soirée) ;
--   · manager / security         : mutation (statut, escalade, suivi) — « ✅➕ » ;
--   · server / security_counter  : « ➕(signaler) » — peuvent OUVRIR un incident, et ne relisent
--                                   QUE leurs propres signalements (pas ceux des autres) ;
--   · promoter / artiste         : « ⛔ » — aucun accès (ni lecture ni écriture).
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed — le module SHIP VIDE (aucun
-- incident inventé). Les photos sont une STRUCTURE (photo_refs) : le dépôt fichier vers un bucket
-- Storage n'est PAS câblé ici (config bucket + politique Storage = étape ultérieure) ; la colonne
-- reste un tableau vide honnête tant que rien n'est téléversé.
--
-- Sécurité : auteur_username est fixé côté serveur par current_staff_username() (jamais fourni par le
-- client) et l'INSERT vérifie auteur_username = current_staff_username() → pas d'usurpation d'auteur.

begin;

-- ============================================================
-- 1) INCIDENTS — le registre (VIDE tant qu'aucun incident réel n'est signalé)
-- ============================================================
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id),
  exploitation_date date not null,                     -- la soirée concernée (chevauche minuit)
  type text not null check (type in (
    'altercation','refus_entree','malaise','vol','degradation','securite','technique','autre'
  )),
  niveau text not null check (niveau in ('mineur','moyen','grave','critique')),
  lieu text,                                           -- libre (entrée, VIP, bar, extérieur…)
  personne_concernee text,                             -- libre (description, pas une fiche PII structurée)
  description text not null check (length(btrim(description)) > 0),
  photo_refs text[] not null default '{}',             -- STRUCTURE : chemins Storage (dépôt non câblé ici)
  status text not null default 'ouvert'
    check (status in ('ouvert','en_cours','escalade','resolu','clos')),
  escalade boolean not null default false,             -- remonté à la direction (A6 → B1)
  auteur_username text not null default public.current_staff_username(),  -- fixé serveur, jamais client
  resolved_at timestamptz,                             -- null tant que non résolu = état vide honnête
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incidents_event_idx on public.incidents(event_id);
create index if not exists incidents_date_idx on public.incidents(exploitation_date);
create index if not exists incidents_status_idx on public.incidents(status);
create index if not exists incidents_auteur_idx on public.incidents(auteur_username);

-- ============================================================
-- 2) INCIDENT_UPDATES — fil de suivi (action, transition de statut, note d'escalade)
-- ============================================================
create table if not exists public.incident_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  auteur_username text not null default public.current_staff_username(),  -- fixé serveur
  action text,                                         -- ce qui a été fait
  new_status text check (new_status is null or new_status in
    ('ouvert','en_cours','escalade','resolu','clos')), -- transition consignée (trace, pas la source)
  note text,
  created_at timestamptz not null default now()
);

create index if not exists incident_updates_incident_idx on public.incident_updates(incident_id);

-- ============================================================
-- 3) RLS — visibilité RESTREINTE (matrice A6), imposée en base, pas par l'UI
-- ============================================================
-- INCIDENTS
alter table public.incidents enable row level security;
revoke all on public.incidents from anon;
grant select, insert, update on public.incidents to authenticated;

-- Lecture : direction + sécurité voient TOUT ; server/compteur ne relisent QUE leurs propres
-- signalements ; promoteur/artiste ne matchent aucune branche → aucune ligne (⛔).
drop policy if exists incidents_read on public.incidents;
create policy incidents_read on public.incidents for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager','security')
    or auteur_username = public.current_staff_username()
  );

-- Écriture (signalement) : direction, sécurité, server, compteur — PAS le promoteur/artiste.
-- auteur_username doit être l'utilisateur courant → pas d'usurpation d'auteur.
drop policy if exists incidents_insert on public.incidents;
create policy incidents_insert on public.incidents for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager','security','server','security_counter')
    and auteur_username = public.current_staff_username()
  );

-- Mutation (statut, escalade, suivi) : direction + sécurité uniquement (server/compteur = signaler seul).
drop policy if exists incidents_update on public.incidents;
create policy incidents_update on public.incidents for update to authenticated
  using (public.current_staff_role() in ('admin','manager','security'))
  with check (public.current_staff_role() in ('admin','manager','security'));

-- INCIDENT_UPDATES
alter table public.incident_updates enable row level security;
revoke all on public.incident_updates from anon;
grant select, insert on public.incident_updates to authenticated;

-- Lecture du fil : direction/sécurité voient tout ; les autres ne voient que le fil des incidents
-- qu'ils PEUVENT lire (leurs propres signalements) — la sous-requête est elle-même filtrée par la RLS
-- de public.incidents, mais on réplique le prédicat pour une intention explicite et robuste.
drop policy if exists incident_updates_read on public.incident_updates;
create policy incident_updates_read on public.incident_updates for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager','security')
    or incident_id in (
      select i.id from public.incidents i
      where i.auteur_username = public.current_staff_username()
    )
  );

-- Écriture du fil (suivi/escalade) : direction + sécurité — même périmètre que la mutation.
drop policy if exists incident_updates_insert on public.incident_updates;
create policy incident_updates_insert on public.incident_updates for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager','security')
    and auteur_username = public.current_staff_username()
  );

commit;
