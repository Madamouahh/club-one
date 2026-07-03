-- 0027_artist_checkin.sql — Module ARTIST CHECK-IN (A8) : STRUCTURE seule, visibilité par RLS.
--
-- Fiche d'accueil de l'artiste/DJ le soir de la soirée (arrivée, loge, balance, matériel, horaires,
-- accompagnants, rider, validation technique). Donnée OPÉRATIONNELLE de soirée, saisie AU RUNTIME par
-- l'équipe (manager/technique) — le module SHIP VIDE : aucun artiste, aucun cachet, aucune fiche
-- inventée ici (le booking/cachet est un autre module, B3 Gestion artistique, avec ses vraies données
-- fondateur). Ce module ne fait que l'accueil du soir.
--
-- Matrice d'accès (CLUB_ONE_OS_MASTER §4.2, ligne A8) — imposée en base, JAMAIS par simple masquage UI :
--   · admin / manager            : lecture COMPLÈTE + mutation (« ✅ » / « ✅➕ ») ;
--   · security                   : lecture seule (« 👁 » — l'accueil/sécu voit qui est attendu) ;
--   · server / security_counter  : « ⛔ » aucun accès ;
--   · promoter                   : « ⛔ » aucun accès ;
--   · artiste (soi)              : « 👁 (soi) » — DIFFÉRÉ : il n'existe PAS aujourd'hui de rôle d'auth
--     « artiste » dans le socle (StaffRole = admin/manager/server/security/security_counter/promoter).
--     Tant que ce rôle (ou un espace artiste par jeton) n'existe pas, l'accès artiste-soi n'est PAS
--     câblé — on ne fabrique pas un rôle. À rebrancher quand le socle exposera un rôle artiste.
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed. Sécurité : auteur_username est fixé
-- côté serveur par current_staff_username() (jamais fourni par le client) et l'INSERT vérifie
-- auteur_username = current_staff_username() → pas d'usurpation d'auteur. Pas de SECURITY DEFINER
-- (écritures directes sous RLS, comme incidents 0023 / comm interne 0026).

begin;

-- ============================================================
-- 1) ARTIST_CHECKINS — la fiche d'accueil (VIDE tant qu'aucun artiste réel n'est saisi)
-- ============================================================
create table if not exists public.artist_checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id),
  exploitation_date date not null,                     -- la soirée concernée (chevauche minuit)
  artist_name text not null check (length(btrim(artist_name)) > 0),  -- nom de scène, saisi au runtime
  slot_label text,                                     -- horaires / créneau, libre (ex. « 01h-03h »)
  status text not null default 'attendu' check (status in (
    'attendu','arrive','en_loge','balance','pret','en_scene','termine','no_show','annule'
  )),
  companions int not null default 0 check (companions >= 0),  -- nombre d'accompagnants (entourage)
  dressing_room text,                                  -- loge attribuée (libre)
  contact text,                                        -- contact du soir (tour manager, tél), libre
  rider_notes text,                                    -- rider / hospitality (besoins loge)
  material_notes text,                                 -- matériel / besoins techniques
  -- Jalons de la soirée (timestamps null = étape non franchie = état vide honnête) :
  arrived_at timestamptz,                              -- arrivée réelle
  soundcheck_at timestamptz,                           -- balance faite
  tech_validated_at timestamptz,                       -- validation technique OK
  tech_validated_by text,                              -- qui a validé (username), null tant que non validé
  notes text,
  auteur_username text not null default public.current_staff_username(),  -- fixé serveur, jamais client
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artist_checkins_event_idx on public.artist_checkins(event_id);
create index if not exists artist_checkins_date_idx on public.artist_checkins(exploitation_date);
create index if not exists artist_checkins_status_idx on public.artist_checkins(status);

-- ============================================================
-- 2) RLS — matrice A8, imposée en base
-- ============================================================
alter table public.artist_checkins enable row level security;
revoke all on public.artist_checkins from anon;
grant select, insert, update on public.artist_checkins to authenticated;

-- Lecture : direction + sécurité (accueil). server/compteur/promoteur ne matchent aucune branche → ⛔.
drop policy if exists artist_checkins_read on public.artist_checkins;
create policy artist_checkins_read on public.artist_checkins for select to authenticated
  using (public.current_staff_role() in ('admin','manager','security'));

-- Écriture (création de la fiche) : direction seule (manager inclus). auteur_username = utilisateur
-- courant → pas d'usurpation. La sécurité ne crée pas de fiche (lecture seule).
drop policy if exists artist_checkins_insert on public.artist_checkins;
create policy artist_checkins_insert on public.artist_checkins for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    and auteur_username = public.current_staff_username()
  );

-- Mutation (statut, jalons, notes) : direction seule (manager inclus).
drop policy if exists artist_checkins_update on public.artist_checkins;
create policy artist_checkins_update on public.artist_checkins for update to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (public.current_staff_role() in ('admin','manager'));

commit;
