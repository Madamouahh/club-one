-- 0072_staff_shift_lifecycle_notifications.sql — SOCLE RH ABSENT (espace salarié /staff + workflow RH).
--
-- RÈGLE ABSOLUE (section 9 du cahier) : RÉUTILISER l'existant, ne PAS créer un 2ᵉ système de planning ni
-- de comptes salariés. On ÉTEND `staff_shifts` (0011) et on s'appuie sur `staff_members`/`staff_users`,
-- `confirm_my_shift_v1` (0020), le trigger d'audit `audit_staff_shift_change` (0031) → `audit_log`.
-- Ce fichier n'ajoute QUE les capacités réellement absentes :
--   1. CYCLE DE VIE d'un shift : publication (brouillon invisible au salarié), VERSIONING, heure INITIALE
--      conservée à la modification, MOTIF de modification, ACCUSÉ DE RÉCEPTION (acknowledged_at) ;
--   2. NOTIFICATIONS PERSONNELLES in-app par salarié (statut lu/accusé/refusé/expiré, criticité, action
--      explicite) — distinctes de `internal_messages` (comm d'équipe soirée) et de `message_queue`
--      (canal marketing sortant DRY_RUN). Aucun fournisseur réel ; push PWA = adaptateur futur.
--   3. RPC du workflow : publier un shift, demander une ARRIVÉE ANTICIPÉE (jamais silencieuse), répondre
--      à une notification (accepter/refuser), marquer lu.
--
-- SÉCURITÉ : RLS fail-closed. Salarié = SES notifications / SES shifts (0011 cantonne déjà). Manager/dir
-- publie et notifie. Aucun accès anon. RPC SECURITY DEFINER + search_path figé, gardes de rôle en SQL.
-- Additif / idempotent / réversible.

begin;

-- ============================================================
-- 1. CYCLE DE VIE DU SHIFT — colonnes ajoutées à staff_shifts (aucune table de planning nouvelle).
-- ============================================================
alter table public.staff_shifts
  add column if not exists version int not null default 1,               -- version du shift (>=1)
  add column if not exists original_planned_start timestamptz,           -- heure de prise de poste INITIALE (avant 1re modif)
  add column if not exists modification_reason text,                     -- motif de la dernière modification (ex. « briefing »)
  add column if not exists acknowledged_at timestamptz,                  -- accusé de réception du salarié (null = pas encore)
  add column if not exists published_at timestamptz;                     -- null = BROUILLON (invisible au salarié) ; sinon publié

-- BACKFILL non destructif : tous les shifts EXISTANTS sont considérés publiés (ils étaient déjà visibles
-- du salarié avant cette migration → on ne les fait pas disparaître). Les shifts créés APRÈS restent
-- brouillon (published_at NULL) jusqu'à publish_shift_v1. La visibilité « brouillon caché » est appliquée
-- côté surface /staff (filtre published_at IS NOT NULL) ; la RLS 0011 (cantonnement au salarié) est INCHANGÉE.
update public.staff_shifts set published_at = created_at where published_at is null;

create index if not exists staff_shifts_published_idx on public.staff_shifts (published_at);

-- ============================================================
-- 2. NOTIFICATIONS PERSONNELLES in-app par salarié.
-- ============================================================
create table if not exists public.staff_notifications (
  id               uuid primary key default gen_random_uuid(),
  staff_username   text not null,                                        -- destinataire (staff_users.username)
  type             text not null,                                        -- shift_published | early_start | shift_modified | task_assigned | rappel | info
  title            text not null,
  body             text,
  severity         text not null default 'info' check (severity in ('info','critical')),
  requires_action  boolean not null default false,                       -- true = action explicite requise (ne disparaît pas au simple « lu »)
  status           text not null default 'non_lue'
    check (status in ('non_lue','lue','confirmation_requise','confirmee','refusee','expiree')),
  shift_id         uuid references public.staff_shifts(id) on delete set null,
  event_id         uuid,
  expires_at       timestamptz,                                          -- délai de réponse (facultatif)
  read_at          timestamptz,
  responded_at     timestamptz,
  created_by       text,                                                 -- manager auteur
  created_at       timestamptz not null default now()
);

create index if not exists staff_notif_user_idx on public.staff_notifications (staff_username, created_at desc);
create index if not exists staff_notif_status_idx on public.staff_notifications (status);
create index if not exists staff_notif_shift_idx on public.staff_notifications (shift_id);

grant select, insert, update on public.staff_notifications to authenticated;
revoke all on public.staff_notifications from anon;

alter table public.staff_notifications enable row level security;

-- Salarié : LIT SES notifications (destinataire = son username) et peut les UPDATE (lu/accusé) — le
-- WITH CHECK garantit qu'il ne se réattribue pas la notification d'un autre.
drop policy if exists staff_notif_select_own on public.staff_notifications;
create policy staff_notif_select_own on public.staff_notifications
  for select to authenticated
  using (staff_username = current_staff_username()
         or current_staff_role() = any (array['admin','manager']));

drop policy if exists staff_notif_update_own on public.staff_notifications
;
create policy staff_notif_update_own on public.staff_notifications
  for update to authenticated
  using (staff_username = current_staff_username()
         or current_staff_role() = any (array['admin','manager']))
  with check (staff_username = current_staff_username()
         or current_staff_role() = any (array['admin','manager']));

-- Manager/direction : CRÉE des notifications (publication, arrivée anticipée, tâches…).
drop policy if exists staff_notif_insert_direction on public.staff_notifications;
create policy staff_notif_insert_direction on public.staff_notifications
  for insert to authenticated
  with check (current_staff_role() = any (array['admin','manager']));

-- ============================================================
-- 3a. publish_shift_v1 — le manager PUBLIE un shift brouillon → visible + à confirmer + notification.
-- ============================================================
create or replace function public.publish_shift_v1(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
  v_shift record;
  v_username text;
begin
  if v_role is null or v_role not in ('admin','manager') then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Réservé au manager.');
  end if;
  select s.*, sm.username as staff_username into v_shift
    from public.staff_shifts s join public.staff_members sm on sm.id = s.staff_member_id
   where s.id = p_shift_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_shift', 'message', 'Shift introuvable.');
  end if;
  if v_shift.published_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_published', 'message', 'Shift déjà publié.');
  end if;

  update public.staff_shifts set published_at = now(), updated_at = now() where id = p_shift_id;

  insert into public.staff_notifications
    (staff_username, type, title, body, severity, requires_action, status, shift_id, event_id, created_by)
  values
    (v_shift.staff_username, 'shift_published', 'Nouveau créneau publié',
     format('Créneau du %s — poste %s. Merci de confirmer.', v_shift.exploitation_date, coalesce(v_shift.poste,'?')),
     'info', true, 'confirmation_requise', p_shift_id, v_shift.event_id, public.current_staff_username());

  return jsonb_build_object('ok', true, 'code', 'published', 'message', 'Shift publié et salarié notifié.');
end;
$$;

-- ============================================================
-- 3b. request_early_start_v1 — ARRIVÉE ANTICIPÉE (jamais silencieuse) : conserve l'heure initiale,
--     versionne, remet en attente de confirmation, notification CRITIQUE à action explicite.
-- ============================================================
create or replace function public.request_early_start_v1(
  p_shift_id   uuid,
  p_new_start  timestamptz,
  p_reason     text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
  v_shift record;
  v_old_start timestamptz;
begin
  if v_role is null or v_role not in ('admin','manager') then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Réservé au manager.');
  end if;
  if p_new_start is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_time', 'message', 'Nouvel horaire requis.');
  end if;
  select s.*, sm.username as staff_username into v_shift
    from public.staff_shifts s join public.staff_members sm on sm.id = s.staff_member_id
   where s.id = p_shift_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_shift', 'message', 'Shift introuvable.');
  end if;

  -- Conserve l'heure INITIALE la 1re fois seulement (l'historique d'origine ne se réécrit pas).
  v_old_start := v_shift.planned_start;
  update public.staff_shifts
     set original_planned_start = coalesce(original_planned_start, planned_start),
         planned_start          = p_new_start,
         modification_reason    = nullif(btrim(coalesce(p_reason,'')), ''),
         version                = version + 1,
         status                 = 'planifie',       -- remet en attente de confirmation (re-confirmation requise)
         acknowledged_at        = null,
         updated_at             = now()
   where id = p_shift_id;

  -- Notification CRITIQUE à action explicite (accepter / pas disponible).
  insert into public.staff_notifications
    (staff_username, type, title, body, severity, requires_action, status, shift_id, event_id, expires_at, created_by)
  values
    (v_shift.staff_username, 'early_start', 'Arrivée anticipée demandée',
     format('Créneau du %s : arrivée avancée à %s (au lieu de %s). Motif : %s. Merci d''accepter ou de signaler votre indisponibilité.',
            v_shift.exploitation_date, to_char(p_new_start,'HH24:MI'),
            coalesce(to_char(v_old_start,'HH24:MI'),'?'), coalesce(nullif(btrim(coalesce(p_reason,'')),''),'—')),
     'critical', true, 'confirmation_requise', p_shift_id, v_shift.event_id, p_expires_at, public.current_staff_username());

  return jsonb_build_object('ok', true, 'code', 'requested', 'message', 'Arrivée anticipée demandée — salarié notifié.',
    'old_start', v_old_start, 'new_start', p_new_start, 'version', v_shift.version + 1);
end;
$$;

-- ============================================================
-- 3c. respond_staff_notification_v1 — le SALARIÉ répond (accepter/refuser) à SA notification à action.
--     Accepter une notification liée à un shift confirme le shift (status confirme + acknowledged_at).
-- ============================================================
create or replace function public.respond_staff_notification_v1(
  p_notification_id uuid,
  p_accept          boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := public.current_staff_username();
  v_notif record;
begin
  if v_username is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'Session invalide.');
  end if;
  select * into v_notif from public.staff_notifications where id = p_notification_id for update;
  if not found or v_notif.staff_username <> v_username then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Notification introuvable.');
  end if;
  if not v_notif.requires_action then
    return jsonb_build_object('ok', false, 'code', 'no_action', 'message', 'Cette notification n''attend pas de réponse.');
  end if;
  if v_notif.status in ('confirmee','refusee','expiree') then
    return jsonb_build_object('ok', true, 'code', 'already', 'message', 'Réponse déjà enregistrée.', 'status', v_notif.status);
  end if;

  update public.staff_notifications
     set status = case when p_accept then 'confirmee' else 'refusee' end,
         responded_at = now(),
         read_at = coalesce(read_at, now())
   where id = p_notification_id;

  -- Répercussion sur le shift : accepter → confirme + accusé ; refuser → laisse le shift en attente
  -- (le manager voit le refus et peut chercher un remplaçant). Jamais de modification silencieuse.
  if v_notif.shift_id is not null then
    if p_accept then
      update public.staff_shifts
         set status = 'confirme', acknowledged_at = now(), updated_at = now()
       where id = v_notif.shift_id and staff_member_id in (select id from public.staff_members where username = v_username);
    else
      update public.staff_shifts set acknowledged_at = now(), updated_at = now()
       where id = v_notif.shift_id and staff_member_id in (select id from public.staff_members where username = v_username);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', case when p_accept then 'accepted' else 'declined' end,
    'message', case when p_accept then 'Confirmé.' else 'Indisponibilité enregistrée — le manager est alerté.' end);
end;
$$;

-- ============================================================
-- 3d. mark_staff_notification_read_v1 — marque LU (une notif à action reste « confirmation_requise »
--     tant qu'aucune réponse n'est donnée : le simple « lu » ne la fait pas disparaître).
-- ============================================================
create or replace function public.mark_staff_notification_read_v1(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := public.current_staff_username();
  v_notif record;
begin
  if v_username is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  select * into v_notif from public.staff_notifications where id = p_notification_id;
  if not found or v_notif.staff_username <> v_username then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  update public.staff_notifications
     set read_at = coalesce(read_at, now()),
         status = case when requires_action then status else 'lue' end
   where id = p_notification_id;
  return jsonb_build_object('ok', true, 'code', 'read');
end;
$$;

-- ============================================================
-- Grants : authenticated uniquement (opérations STAFF). Jamais anon.
-- ============================================================
revoke all on function public.publish_shift_v1(uuid) from public;
grant execute on function public.publish_shift_v1(uuid) to authenticated;
revoke all on function public.request_early_start_v1(uuid, timestamptz, text, timestamptz) from public;
grant execute on function public.request_early_start_v1(uuid, timestamptz, text, timestamptz) to authenticated;
revoke all on function public.respond_staff_notification_v1(uuid, boolean) from public;
grant execute on function public.respond_staff_notification_v1(uuid, boolean) to authenticated;
revoke all on function public.mark_staff_notification_read_v1(uuid) from public;
grant execute on function public.mark_staff_notification_read_v1(uuid) to authenticated;

commit;
