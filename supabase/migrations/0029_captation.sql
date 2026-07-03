-- 0029_captation.sql — Module CAPTATION EN SOIRÉE (A10) : STRUCTURE seule, visibilité par RLS.
--
-- Shot list de captation photo/vidéo de la soirée (CLUB_ONE_OS_MASTER §1 l.98-100 :
--   « Shot list · moments prioritaires · artistes · publics » / « Formats · heure idéale · statut ·
--    dépôt rapide → DAM (B4) »). Deux entités, MÊME schéma que checklists (0028) : un MODÈLE réutilisable
--   + un ÉTAT par soirée.
--   1) shot_list_items : le MODÈLE réutilisable (« ce qu'il faut capturer »). Le module SHIP VIDE —
--      AUCUN plan de contenu n'est inventé ici. Le SEUL vocabulaire fermé est le STATUT (cycle de vie
--      « à capturer → capturé → déposé au DAM » décrit littéralement par le master) et l'univers
--      (eden/terminus/cercle, miroir de venue_tables 0024). Libellé, sujet, format et heure idéale sont
--      des champs LIBRES saisis AU RUNTIME par la créa (aucune taxonomie de format n'est fabriquée).
--   2) shot_captures : l'ÉTAT d'un plan pour UNE soirée (statut + référence de dépôt DAM + note).
--
-- Matrice d'accès (master §3.1 « A10 · Manager, créa », P2) — imposée en base, JAMAIS par masquage UI :
--   · admin / manager : lecture COMPLÈTE + composition de la shot list + mise à jour du statut de capture.
--   · server / security / security_counter / promoter : « ⛔ » aucun accès (la captation est un métier créa).
--   NB : il n'existe PAS de rôle d'auth « créa » dans le socle actuel
--   (StaffRole = admin/manager/server/security/security_counter/promoter). « Manager, créa » est donc câblé
--   sur la DIRECTION (admin/manager) — on ne fabrique pas un rôle. À rebrancher quand le socle exposera un
--   rôle créa (même différé que le rôle « artiste » en 0027 / « technique » en 0027).
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed. Les colonnes d'auteur
-- (auteur_username / updated_by) sont fixées côté serveur par current_staff_username() (jamais fournies par
-- le client) et vérifiées dans les WITH CHECK → pas d'usurpation. Pas de SECURITY DEFINER (écritures
-- directes sous RLS, comme incidents 0023 / comm 0026 / artiste 0027 / checklists 0028).

begin;

-- ============================================================
-- 1) SHOT_LIST_ITEMS — le modèle réutilisable (VIDE tant qu'aucun créa n'a saisi de plan réel)
-- ============================================================
create table if not exists public.shot_list_items (
  id uuid primary key default gen_random_uuid(),
  venue text check (venue in ('eden','terminus','cercle')),  -- univers concerné ; null = toutes salles
  label text not null check (length(btrim(label)) > 0),      -- le plan à capturer, saisi au runtime
  sujet text,                                                -- artiste / public / décor… (LIBRE, jamais énuméré)
  format text,                                               -- format de rendu (LIBRE : la créa écrit le sien)
  heure_ideale text,                                         -- heure idéale de captation (LIBRE, ex. « 23:30 »)
  prioritaire boolean not null default false,                -- « moments prioritaires » du master
  position int not null default 0,                           -- ordre d'affichage
  active boolean not null default true,                      -- désactivable sans suppression (historique)
  auteur_username text not null default public.current_staff_username(),  -- fixé serveur, jamais client
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shot_list_items_venue_idx on public.shot_list_items(venue);
create index if not exists shot_list_items_active_idx on public.shot_list_items(active);

-- ============================================================
-- 2) SHOT_CAPTURES — l'état d'un plan pour UNE soirée (VIDE tant qu'aucune soirée n'est captée)
-- ============================================================
create table if not exists public.shot_captures (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.shot_list_items(id) on delete cascade,
  event_id uuid references public.events(id),
  exploitation_date date not null,                     -- la soirée concernée (chevauche minuit)
  -- Statut = cycle de vie fermé issu du master (« statut · dépôt rapide → DAM ») : à capturer → capturé
  -- → déposé (au DAM/B4). AUCUN statut inventé au-delà de ce cycle.
  status text not null default 'a_capturer'
    check (status in ('a_capturer','capture','depose')),
  dam_ref text,                                        -- référence du dépôt DAM une fois « déposé » (B4)
  note text,
  updated_by text not null default public.current_staff_username(),  -- fixé serveur, jamais client
  updated_at timestamptz not null default now(),
  -- Un état unique par plan et par soirée (upsert applicatif).
  constraint shot_captures_uniq unique (item_id, exploitation_date)
);

create index if not exists shot_captures_date_idx on public.shot_captures(exploitation_date);
create index if not exists shot_captures_item_idx on public.shot_captures(item_id);
create index if not exists shot_captures_status_idx on public.shot_captures(status);

-- ============================================================
-- 3) RLS — matrice A10 (direction seule dans le socle actuel), imposée en base
-- ============================================================
alter table public.shot_list_items enable row level security;
alter table public.shot_captures enable row level security;
revoke all on public.shot_list_items from anon;
revoke all on public.shot_captures from anon;
grant select, insert, update, delete on public.shot_list_items to authenticated;
grant select, insert, update, delete on public.shot_captures to authenticated;

-- ---- shot_list_items ----
-- Lecture : direction seule (créa = direction dans le socle). server/security/compteur/promoteur ⛔.
drop policy if exists shot_list_items_read on public.shot_list_items;
create policy shot_list_items_read on public.shot_list_items for select to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- Composition de la shot list : direction seule. auteur_username = utilisateur courant → pas d'usurpation.
drop policy if exists shot_list_items_insert on public.shot_list_items;
create policy shot_list_items_insert on public.shot_list_items for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    and auteur_username = public.current_staff_username()
  );

drop policy if exists shot_list_items_update on public.shot_list_items;
create policy shot_list_items_update on public.shot_list_items for update to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (public.current_staff_role() in ('admin','manager'));

drop policy if exists shot_list_items_delete on public.shot_list_items;
create policy shot_list_items_delete on public.shot_list_items for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- ---- shot_captures ----
-- Lecture : direction seule.
drop policy if exists shot_captures_read on public.shot_captures;
create policy shot_captures_read on public.shot_captures for select to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- Mise à jour du statut de capture (insert) : direction seule ; le plan doit être ACTIF.
-- updated_by = utilisateur courant → pas d'usurpation.
drop policy if exists shot_captures_insert on public.shot_captures;
create policy shot_captures_insert on public.shot_captures for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    and updated_by = public.current_staff_username()
    and exists (
      select 1 from public.shot_list_items sli
       where sli.id = item_id
         and sli.active
    )
  );

drop policy if exists shot_captures_update on public.shot_captures;
create policy shot_captures_update on public.shot_captures for update to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (
    public.current_staff_role() in ('admin','manager')
    and updated_by = public.current_staff_username()
  );

drop policy if exists shot_captures_delete on public.shot_captures;
create policy shot_captures_delete on public.shot_captures for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

commit;
