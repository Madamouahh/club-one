-- 0055_tasks.sql — MODULE TÂCHES / TO-DO INTERNE (audit B6 = ABSENT). Structure seule, ship VIDE.
--
-- Source de vérité UNIQUE : liste des tâches opérationnelles internes (préparation soirée, suivi
-- ouverture/fermeture, actions direction → staff). Une tâche = un titre, un assigné facultatif (par
-- username), une échéance facultative, un statut de workflow, une priorité, éventuellement rattachée à
-- une soirée (event_id). Aucune donnée client, aucune synthèse externe : saisie interne uniquement.
--
--   · `tasks` : titre, description, assignee_username (facultatif), assigned_by, due_date, status
--     (todo/doing/done/cancelled), priority (low/normal/high), event_id facultatif, horodatage.
--
-- RLS (fail-closed) :
--   · direction (admin/manager) : accès complet (lecture + écriture + assignation + suppression).
--   · assigné : un salarié dont current_staff_username() = assignee_username LIT ses tâches et peut
--     UPDATE (fait avancer le statut / ajuste la priorité de SES tâches). Il ne peut ni créer, ni
--     supprimer, ni se réassigner une tâche d'autrui — patron username-scopé éprouvé (0044).
--   · aucun accès anon.
--
-- Grants DML `authenticated` explicites (la RLS filtre). Additif/idempotent. Réversible (repolicy).

begin;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assignee_username text,                          -- username du salarié assigné (facultatif)
  assigned_by text,                                -- username de l'auteur de l'assignation
  due_date date,                                   -- échéance (facultative)
  status text not null default 'todo'
    check (status in ('todo','doing','done','cancelled')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high')),
  event_id uuid,                                   -- soirée rattachée (facultatif)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_assignee_idx on public.tasks (assignee_username);
create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists tasks_event_idx on public.tasks (event_id);

grant select, insert, update, delete on public.tasks to authenticated;

alter table public.tasks enable row level security;

-- ============================================================
-- Direction (admin/manager) : accès complet (crée, assigne, lit, modifie, supprime).
-- ============================================================
drop policy if exists tasks_all_direction on public.tasks;
create policy tasks_all_direction on public.tasks
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

-- ============================================================
-- Assigné : LECTURE de SES tâches (celles dont assignee_username = son username).
-- ============================================================
drop policy if exists tasks_select_assignee on public.tasks;
create policy tasks_select_assignee on public.tasks
  for select to authenticated
  using (
    assignee_username is not null
    and assignee_username = current_staff_username()
  );

-- ============================================================
-- Assigné : UPDATE de SES tâches (fait avancer le statut / ajuste la priorité). Le WITH CHECK garantit
-- que la ligne RESTE la sienne (assignee_username inchangé) → pas de vol ni de réassignation d'autrui.
-- ============================================================
drop policy if exists tasks_update_assignee on public.tasks;
create policy tasks_update_assignee on public.tasks
  for update to authenticated
  using (
    assignee_username is not null
    and assignee_username = current_staff_username()
  )
  with check (
    assignee_username is not null
    and assignee_username = current_staff_username()
  );

commit;
