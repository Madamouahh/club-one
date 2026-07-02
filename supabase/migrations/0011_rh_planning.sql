-- 0011_rh_planning.sql — Module RH / PLANNING (B7) : STRUCTURE seule, aucun salarié inventé.
-- Ce module est le PRODUCTEUR du « coût staff » que le P&L par soirée (lib/pnlSoiree) attend
-- honnêtement à null tant qu'il n'est pas branché (charge « staff », wired=false).
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed — la vraie liste du personnel
-- (noms, postes, taux horaire) est une donnée du fondateur (droit du travail + PII). Les tables
-- restent VIDES et les taux horaires NULL = états vides HONNÊTES. Rien n'est fabriqué.
--
-- RGPD / droit du travail (cf. matrice B7) :
--   · vue salarié   : un salarié ne voit QUE sa propre fiche et SES propres shifts ;
--   · vue direction : admin/manager voient tout le personnel et composent le planning ;
--   · notes_direction : colonne réservée à la direction (la vue salarié ne l'expose jamais).
-- Le suivi (heures/présence) est transparent et annoncé, pas une surveillance cachée.

begin;

-- ============================================================
-- 1) STAFF_MEMBERS — le répertoire du personnel (VIDE tant que le fondateur ne fournit pas la liste)
-- ============================================================
create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,            -- clé de rattachement au compte staff (current_staff_username())
  full_name text not null,
  poste text,                               -- libellé de poste (bar, accueil, sécurité, manager…) — libre
  contrat_type text check (contrat_type is null or contrat_type in ('cdi','cdd','extra','prestataire','stage')),
  taux_horaire numeric(10,2) check (taux_horaire is null or taux_horaire >= 0), -- PII : fourni par le fondateur (paie)
  actif boolean not null default true,
  notes_direction text,                     -- accès direction uniquement (jamais exposé à la vue salarié)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_members_actif_idx on public.staff_members(actif);

-- ============================================================
-- 2) STAFF_SHIFTS — planning prévu + pointage réel (le producteur de la masse horaire → coût staff)
-- ============================================================
create table if not exists public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  event_id uuid references public.events(id),
  exploitation_date date not null,          -- la soirée (chevauche minuit) — clé de rapprochement P&L
  poste text,                               -- poste tenu ce soir-là (peut différer du poste par défaut)
  planned_start timestamptz,                -- planning prévu (composé par le manager)
  planned_end timestamptz,
  actual_start timestamptz,                 -- pointage réel (présence effective) — null tant que non pointé
  actual_end timestamptz,
  status text not null default 'planifie'
    check (status in ('planifie','confirme','present','absent','retard','annule')),
  commentaire text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_member_id, exploitation_date)  -- idempotence : un shift par salarié et par soirée
);

create index if not exists staff_shifts_date_idx on public.staff_shifts(exploitation_date);
create index if not exists staff_shifts_event_idx on public.staff_shifts(event_id);
create index if not exists staff_shifts_member_idx on public.staff_shifts(staff_member_id);

-- ============================================================
-- 3) RLS — vue direction (admin/manager) complète ; vue salarié cantonnée à SA fiche / SES shifts
-- ============================================================
-- STAFF_MEMBERS
alter table public.staff_members enable row level security;
revoke all on public.staff_members from anon;
grant select, insert, update on public.staff_members to authenticated;

-- Lecture : la direction voit tout ; un salarié voit uniquement sa propre fiche.
drop policy if exists staff_members_read on public.staff_members;
create policy staff_members_read on public.staff_members for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or username = public.current_staff_username()
  );
-- Écriture : direction seule (composition du répertoire, taux horaire, notes de direction).
drop policy if exists staff_members_insert on public.staff_members;
create policy staff_members_insert on public.staff_members for insert to authenticated
  with check (public.current_staff_role() in ('admin','manager'));
drop policy if exists staff_members_update on public.staff_members;
create policy staff_members_update on public.staff_members for update to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- STAFF_SHIFTS
alter table public.staff_shifts enable row level security;
revoke all on public.staff_shifts from anon;
grant select, insert, update on public.staff_shifts to authenticated;

-- Lecture : la direction voit tous les shifts ; un salarié voit uniquement les siens.
drop policy if exists staff_shifts_read on public.staff_shifts;
create policy staff_shifts_read on public.staff_shifts for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or staff_member_id in (
      select id from public.staff_members where username = public.current_staff_username()
    )
  );
-- Écriture : direction seule (composition du planning et saisie du pointage).
drop policy if exists staff_shifts_insert on public.staff_shifts;
create policy staff_shifts_insert on public.staff_shifts for insert to authenticated
  with check (public.current_staff_role() in ('admin','manager'));
drop policy if exists staff_shifts_update on public.staff_shifts;
create policy staff_shifts_update on public.staff_shifts for update to authenticated
  using (public.current_staff_role() in ('admin','manager'));

commit;
