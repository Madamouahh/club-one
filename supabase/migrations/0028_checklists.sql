-- 0028_checklists.sql — Module CHECKLISTS OUVERTURE/FERMETURE (A9) : STRUCTURE seule, visibilité par RLS.
--
-- Listes de vérification d'ouverture et de fermeture de la soirée, PAR ESPACE et PAR POSTE
-- (CLUB_ONE_OS_MASTER §2, l.96-97). Deux entités :
--   1) checklist_items      : le MODÈLE réutilisable (« ce qu'il faut vérifier »). Le module SHIP VIDE —
--      AUCUN item de contenu n'est inventé ici : seules les CATÉGORIES et les PHASES sont un vocabulaire
--      fermé issu DIRECTEMENT du master (pas une donnée fondateur). Le libellé de chaque item est saisi
--      AU RUNTIME par un manager (la vraie liste d'ouverture/fermeture appartient au fondateur/manager).
--   2) checklist_completions : la COCHE par soirée (un item vérifié le soir J, par qui, quand).
--
-- Matrice d'accès (master §3.1 « A9 · Tous (par poste) » + §4.2 « données de soirée, RLS pas UI ») —
-- imposée en base, JAMAIS par simple masquage UI :
--   · admin / manager                 : lecture COMPLÈTE + composition des items (créer/éditer le modèle)
--                                       + cochage (« ✅➕ ») ;
--   · server / security / security_counter : lecture COMPLÈTE + cochage de LEURS items (poste = leur rôle
--                                       ou item sans poste) — ils NE composent PAS le modèle (« 👁➕ ») ;
--   · promoter                        : « ⛔ » aucun accès (le promoteur n'a pas de poste d'ouverture/
--                                       fermeture ; exclusion cohérente avec incidents 0023 / comm 0026).
--   · artiste (soi)                   : hors périmètre (pas de rôle d'auth « artiste » dans le socle — cf. 0027).
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed. Sécurité : les colonnes d'auteur
-- (auteur_username / done_by) sont fixées côté serveur par current_staff_username() (jamais fournies par
-- le client) et vérifiées dans les WITH CHECK → pas d'usurpation. Le cochage « par poste » est imposé par
-- la RLS (un employé ne coche que les items de son poste ou sans poste), pas seulement par l'UI. Pas de
-- SECURITY DEFINER (écritures directes sous RLS, comme incidents 0023 / comm interne 0026 / artiste 0027).

begin;

-- ============================================================
-- 1) CHECKLIST_ITEMS — le modèle réutilisable (VIDE tant qu'aucun manager n'a saisi de ligne réelle)
-- ============================================================
create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  venue text,                                          -- eden / cercle / terminus / null (toutes salles)
  phase text not null check (phase in ('ouverture','fermeture')),
  -- Catégories = vocabulaire fermé du master §2 l.96-97 (sécu · caisse · lumière · son · nettoyage ·
  -- stocks · tables · issues (sorties de secours) · signalétique · contenus à capturer). PAS inventé.
  category text not null check (category in (
    'secu','caisse','lumiere','son','nettoyage','stocks','tables','issues','signaletique','captation'
  )),
  -- Poste responsable (rôle d'auth) ; null = tous les postes. Contraint aux rôles opérationnels
  -- (le promoteur n'a pas de poste d'ouverture/fermeture).
  poste text check (poste in ('admin','manager','server','security','security_counter')),
  label text not null check (length(btrim(label)) > 0),  -- le contenu de l'item, saisi au runtime
  position int not null default 0,                     -- ordre d'affichage dans sa catégorie
  active boolean not null default true,                -- désactivable sans suppression (historique préservé)
  auteur_username text not null default public.current_staff_username(),  -- fixé serveur, jamais client
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_items_phase_idx on public.checklist_items(phase);
create index if not exists checklist_items_venue_idx on public.checklist_items(venue);
create index if not exists checklist_items_poste_idx on public.checklist_items(poste);

-- ============================================================
-- 2) CHECKLIST_COMPLETIONS — la coche par soirée (VIDE tant qu'aucune soirée réelle n'est cochée)
-- ============================================================
create table if not exists public.checklist_completions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.checklist_items(id) on delete cascade,
  event_id uuid references public.events(id),
  exploitation_date date not null,                     -- la soirée concernée (chevauche minuit)
  note text,
  done_by text not null default public.current_staff_username(),  -- fixé serveur, jamais client
  done_at timestamptz not null default now(),
  -- Une coche unique par item et par soirée (le dernier qui coche l'un remet à jour l'autre via upsert applicatif).
  constraint checklist_completions_uniq unique (item_id, exploitation_date)
);

create index if not exists checklist_completions_date_idx on public.checklist_completions(exploitation_date);
create index if not exists checklist_completions_item_idx on public.checklist_completions(item_id);

-- ============================================================
-- 3) RLS — matrice A9, imposée en base
-- ============================================================
alter table public.checklist_items enable row level security;
alter table public.checklist_completions enable row level security;
revoke all on public.checklist_items from anon;
revoke all on public.checklist_completions from anon;
grant select, insert, update, delete on public.checklist_items to authenticated;
grant select, insert, update, delete on public.checklist_completions to authenticated;

-- ---- checklist_items ----
-- Lecture : tous les rôles opérationnels (chacun voit la liste complète pour se repérer). promoteur ⛔.
drop policy if exists checklist_items_read on public.checklist_items;
create policy checklist_items_read on public.checklist_items for select to authenticated
  using (public.current_staff_role() in ('admin','manager','server','security','security_counter'));

-- Composition du modèle (créer/éditer/désactiver un item) : direction seule (manager inclus).
-- auteur_username = utilisateur courant → pas d'usurpation.
drop policy if exists checklist_items_insert on public.checklist_items;
create policy checklist_items_insert on public.checklist_items for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    and auteur_username = public.current_staff_username()
  );

drop policy if exists checklist_items_update on public.checklist_items;
create policy checklist_items_update on public.checklist_items for update to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (public.current_staff_role() in ('admin','manager'));

drop policy if exists checklist_items_delete on public.checklist_items;
create policy checklist_items_delete on public.checklist_items for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- ---- checklist_completions ----
-- Lecture : tous les rôles opérationnels (transparence : qui a coché quoi ce soir). promoteur ⛔.
drop policy if exists checklist_completions_read on public.checklist_completions;
create policy checklist_completions_read on public.checklist_completions for select to authenticated
  using (public.current_staff_role() in ('admin','manager','server','security','security_counter'));

-- Cochage : un employé coche un item de SON poste (ou sans poste) ; la direction coche n'importe quel item.
-- done_by = utilisateur courant → pas d'usurpation. Le « par poste » est imposé ICI (RLS), pas par l'UI.
drop policy if exists checklist_completions_insert on public.checklist_completions;
create policy checklist_completions_insert on public.checklist_completions for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager','server','security','security_counter')
    and done_by = public.current_staff_username()
    and exists (
      select 1 from public.checklist_items ci
       where ci.id = item_id
         and ci.active
         and (
           public.current_staff_role() in ('admin','manager')
           or ci.poste is null
           or ci.poste = public.current_staff_role()
         )
    )
  );

-- Mise à jour d'une coche (note, ou re-cochage) : l'auteur de la coche ou la direction.
drop policy if exists checklist_completions_update on public.checklist_completions;
create policy checklist_completions_update on public.checklist_completions for update to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or done_by = public.current_staff_username()
  )
  with check (done_by = public.current_staff_username()
    or public.current_staff_role() in ('admin','manager'));

-- Décochage (suppression) : l'auteur de la coche ou la direction.
drop policy if exists checklist_completions_delete on public.checklist_completions;
create policy checklist_completions_delete on public.checklist_completions for delete to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or done_by = public.current_staff_username()
  );

commit;
