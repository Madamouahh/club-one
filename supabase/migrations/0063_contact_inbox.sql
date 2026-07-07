-- 0063_contact_inbox.sql — MODULE DEMANDES / INBOX TRIÉES (B13), backend réel de la file de contact.
--
-- Source de vérité UNIQUE : les demandes de contact structurées (« vous êtes : client / entreprise /
-- artiste / autre » + sujet + message + coordonnées). Le formulaire du SITE PUBLIC qui alimenterait
-- cette table est HORS PÉRIMÈTRE de cette migration : ici, la direction SAISIT et TRAITE les demandes
-- (staff-entry). Aucune RPC anon d'insertion n'est ajoutée tant qu'un canal public durci (format +
-- anti-abus) n'est pas spécifié : PRÊT À CONNECTER — NON ACTIVÉ (on n'ouvre aucun grant anon).
--
--   · `contact_requests` : une demande (profil « vous êtes », identité/coordonnées, sujet, message,
--     statut du pipeline nouveau→en_cours→traite→clos, responsable assigné, horodatages).
--
-- PII : full_name / phone / email = coordonnées personnelles. Lecture ET écriture réservées à la
-- direction (admin/manager), fail-closed via current_staff_role(). Aucun accès staff-op / promoteur.
--
-- RLS fail-closed. Grants DML `authenticated` explicites (la RLS filtre). ⚠️ Supabase RÉ-ACCORDE anon
-- sur toute table neuve via DEFAULT PRIVILEGES → `revoke all ... from anon` OBLIGATOIRE (invariant 0009/
-- 0053 : anon = zéro grant de table). Additif / idempotent. Réversible.

begin;

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_type text not null check (requester_type in ('client','entreprise','artiste','autre')),
  full_name text,
  phone text,
  email text,
  subject text not null,
  message text,
  status text not null default 'nouveau' check (status in ('nouveau','en_cours','traite','clos')),
  assigned_to text,                              -- username du responsable (facultatif)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_requests_status_idx on public.contact_requests (status);
create index if not exists contact_requests_type_idx on public.contact_requests (requester_type);
create index if not exists contact_requests_assigned_idx on public.contact_requests (assigned_to);
create index if not exists contact_requests_created_idx on public.contact_requests (created_at desc);

-- DML pour les sessions authentifiées ; la RLS ci-dessous cantonne réellement l'accès.
grant select, insert, update, delete on public.contact_requests to authenticated;

-- ⚠️ CRITIQUE : Supabase ré-accorde anon par DEFAULT PRIVILEGES sur toute table neuve. On révoque
-- explicitement (invariant : anon ne possède AUCUN grant de table dans public — cf. 0009 / 0053).
revoke all on public.contact_requests from anon;

alter table public.contact_requests enable row level security;

-- Lecture : direction (admin/manager) fail-closed (coordonnées personnelles = PII).
drop policy if exists contact_requests_select_direction on public.contact_requests;
create policy contact_requests_select_direction on public.contact_requests
  for select to authenticated
  using (current_staff_role() = any (array['admin','manager']));

-- Écriture (saisie / triage / assignation) : direction (admin/manager) fail-closed.
drop policy if exists contact_requests_write_direction on public.contact_requests;
create policy contact_requests_write_direction on public.contact_requests
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
