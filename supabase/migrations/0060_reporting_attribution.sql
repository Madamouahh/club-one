-- 0060_reporting_attribution.sql — SOURCE D'ATTRIBUTION RÉELLE POUR LE REPORTING (Vague 2, Squad Reporting).
--
-- CONSTAT (correction fondateur 2026-07-07) : le reporting Vague 1 (lib/serverReports.ts,
-- lib/promoterReports.ts) dérivait les promoteurs/serveurs de `assignedTo` par HEURISTIQUE (nom deviné),
-- ce qui est fragile. Deux manques structurels (audit G2) :
--   1. AUCUNE source d'attribution serveur↔table : `club_tables` n'a PAS de champ « serveur ». La
--      colonne `assigned_to` porte déjà le PROMOTEUR propriétaire (isolation 0044) et sert au périmètre
--      server (0045 : « non attribuée OU la mienne »). On ne peut donc PAS la réutiliser pour désigner
--      le serveur qui a physiquement servi une table sans casser ces deux règles.
--   2. AUCUNE autorité de rôle exploitable par le reporting : `staff_users` (username→role) est
--      verrouillée (0002 : RLS deny-all, aucune lecture directe). Le reporting ne pouvait donc pas
--      distinguer un promoteur d'un serveur AUTREMENT que par un nom deviné.
--
-- CORRECTIF (additif, aucune donnée touchée, aucune table existante altérée) :
--   A. `table_server_assignments` : la source d'attribution serveur↔table MANQUANTE (G2). Table dédiée
--      plutôt qu'une colonne `served_by` sur `club_tables`, DÉLIBÉRÉMENT :
--        · `club_tables.assigned_to` = promoteur propriétaire ; le serveur qui SERT est un rôle distinct
--          → surcharger `assigned_to` mélangerait deux notions et casserait l'isolation promoteur 0044 ;
--        · ajouter une colonne à `club_tables` obligerait à toucher ses policies/triggers de périmètre
--          (0044/0045, hors périmètre de ce squad) pour protéger la nouvelle colonne, et le trigger
--          server interdit déjà de modifier `assigned_to` — risque de régression ;
--        · une table d'attribution additive est fail-closed, n'altère AUCUNE ligne existante, et sépare
--          proprement « qui a amené/possède la table » (promoteur) de « qui l'a servie » (serveur).
--   B. `staff_roster_v1()` : RPC role-authoritative (username→role depuis `staff_users`), lisible
--      direction seule, pour que le reporting identifie promoteurs/serveurs par RÔLE — plus aucun nom en
--      dur, plus aucune heuristique sur `assigned_to`.
--
-- RLS fail-closed, anon zéro grant, grants DML `authenticated` uniquement. Idempotent / réversible.

begin;

-- ============================================================
-- A. table_server_assignments — attribution RÉELLE serveur↔table par soirée (source manquante G2).
--    Un serveur (username, autorité de rôle via staff_roster_v1) sert une table (id texte de club_tables)
--    pour une soirée (event_id). Unicité (event_id, table_id) : une table est servie par UN serveur ;
--    une nouvelle attribution remplace l'ancienne (upsert côté appelant sur la contrainte unique).
-- ============================================================
create table if not exists public.table_server_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,                       -- soirée concernée
  table_id text not null,                       -- club_tables.id (identifiant TEXTE, cf. 0045)
  table_label text,                             -- libellé humain facultatif (instantané au moment de l'attribution)
  server_username text not null,                -- username du serveur qui a servi (validé par rôle côté reporting)
  assigned_at timestamptz not null default now(),
  assigned_by text,                             -- username de la direction ayant attribué
  constraint table_server_assignments_event_table_unique unique (event_id, table_id)
);

create index if not exists table_server_assignments_event_idx
  on public.table_server_assignments (event_id);
create index if not exists table_server_assignments_server_idx
  on public.table_server_assignments (server_username);
create index if not exists table_server_assignments_table_idx
  on public.table_server_assignments (table_id);

grant select, insert, update, delete on public.table_server_assignments to authenticated;
-- Défense en profondeur (invariant 0053) : neutraliser les GRANT anon rétablis par les DEFAULT
-- PRIVILEGES Supabase sur toute nouvelle table. Vérifié niveau 4 sur le LABO.
revoke all on public.table_server_assignments from anon;

alter table public.table_server_assignments enable row level security;

-- Direction (admin/manager) : attribue / relit / réattribue / supprime (accès complet).
drop policy if exists tsa_all_direction on public.table_server_assignments;
create policy tsa_all_direction on public.table_server_assignments
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

-- Serveur : LECTURE de SES attributions (username-scopé, patron 0044/0055). Aucune écriture.
drop policy if exists tsa_select_server on public.table_server_assignments;
create policy tsa_select_server on public.table_server_assignments
  for select to authenticated
  using (
    server_username is not null
    and server_username = current_staff_username()
  );

-- (aucune policy anon → anon deny par défaut sous RLS ; aucun grant anon → fail-closed ceinture+bretelles)

-- ============================================================
-- B. staff_roster_v1() — autorité de rôle (username→role) pour le reporting. Direction seule.
--    `staff_users` est verrouillée (0002 : RLS deny-all). Une VUE tournerait en droits de l'appelant
--    → bloquée. On passe donc par une RPC SECURITY DEFINER (propriétaire) avec garde FAIL-CLOSED
--    explicite (modèle 0021 : current_staff_role() renvoie NULL pour un compte non mappé → un test
--    naïf `not in (...)` s'évaluerait à NULL et NE bloquerait PAS → on refuse uid null ET rôle null).
-- ============================================================
create or replace function public.staff_roster_v1()
returns table (username text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  v_role := public.current_staff_role();
  if v_role is null or v_role <> all (array['admin','manager']) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query
    select s.username, s.role
      from public.staff_users s
     order by s.username;
end;
$$;

revoke all on function public.staff_roster_v1() from public;
grant execute on function public.staff_roster_v1() to authenticated;

commit;
