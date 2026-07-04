-- 0033_audit_log.sql — SOCLE 0.5 : JOURNAL D'AUDIT GLOBAL (« qui / quoi / quand », réversible).
--
-- Réclamé par CLUB_ONE_OS_MASTER.md §2 (socle transverse : « Journal d'audit global (AuditLog :
-- qui/quoi/quand, réversible) ») et §3.1 (ligne 0.5, priorité P1, zone Direction). STRUCTURE seule :
-- le module SHIP VIDE (aucune ligne inventée). Aucune RPC métier existante n'est modifiée ici — le
-- câblage des appels `log_audit_event(...)` depuis les actions sensibles (assign de table, mutation
-- d'incident, lancement de campagne, gestion d'utilisateur…) est une étape ULTÉRIEURE, module par
-- module. Ce fichier ne fournit que le RÉCEPTACLE durci et son point d'entrée server-side.
--
-- Propriétés de sécurité (un journal d'audit n'a de valeur que s'il est INFALSIFIABLE) :
--   · APPEND-ONLY : `authenticated` n'a AUCUN privilège INSERT/UPDATE/DELETE sur la table. La seule
--     écriture possible passe par la fonction SECURITY DEFINER `log_audit_event(...)` — donc pas de
--     forge de ligne, pas d'altération ni de suppression a posteriori (même pas par la direction via
--     l'app : le journal est une trace, pas une donnée éditable).
--   · ACTEUR NON USURPABLE : `actor_username` / `actor_role` sont estampillés côté serveur depuis la
--     session (`current_staff_username()` / `current_staff_role()`), JAMAIS fournis par le client —
--     il n'existe aucun paramètre d'acteur dans la fonction (cf. règle 20 : ne jamais faire confiance
--     au rôle/username envoyé par le client).
--   · LECTURE DIRECTION : la matrice (§3.1 ligne 0.5 = Direction) est imposée par la RLS, pas par
--     masquage d'UI. `admin` lit tout ; tout autre rôle ne voit AUCUNE ligne. Élargir à `manager`
--     est une décision fondateur (comme les « notes de direction » RH) — fermé par défaut ici.
--   · anon : aucun accès (ni lecture, ni écriture, ni EXECUTE sur la fonction).
--
-- « Réversible » (spec §2) : chaque entrée peut porter un instantané `before_data` / `after_data`
-- (jsonb) — la STRUCTURE qui permettra à une future opération d'annulation de reconstituer l'état
-- antérieur. AUCUNE RPC d'annulation n'est câblée ici (capacité vide honnête) : on stocke la matière,
-- on ne l'exécute pas encore.
--
-- Additif strict : `create ... if not exists`, aucune table existante touchée, aucun seed.

begin;

-- ============================================================
-- 1) AUDIT_LOG — le journal (VIDE tant qu'aucune action réelle n'est tracée)
-- ============================================================
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),        -- quand : horodatage serveur (immuable)
  actor_username text,                                    -- qui : estampillé serveur (peut être NULL si mapping absent)
  actor_role text,                                        -- qui : rôle au moment de l'action (trace, pas la source de vérité)
  action text not null check (length(btrim(action)) > 0),-- quoi : clé d'action (ex. matrice RBAC 'table.assign', 'user.manage'…)
  resource_type text,                                     -- sur quoi : entité touchée ('club_tables','events','staff_members'…)
  resource_id text,                                       -- id de l'entité (text : accueille tout type de PK)
  venue text,                                             -- univers concerné (eden/cercle/terminus/complexe) — libre, nullable
  event_id uuid references public.events(id),            -- contexte soirée (facultatif)
  summary text,                                           -- description courte lisible par un humain
  before_data jsonb,                                      -- instantané AVANT (support de réversibilité) — nullable
  after_data jsonb,                                       -- instantané APRÈS — nullable
  metadata jsonb                                          -- contexte libre supplémentaire — nullable
);

create index if not exists audit_log_occurred_idx on public.audit_log(occurred_at desc);
create index if not exists audit_log_action_idx on public.audit_log(action);
create index if not exists audit_log_actor_idx on public.audit_log(actor_username);
create index if not exists audit_log_resource_idx on public.audit_log(resource_type, resource_id);
create index if not exists audit_log_event_idx on public.audit_log(event_id);

-- ============================================================
-- 2) POINT D'ENTRÉE D'ÉCRITURE — la SEULE façon d'écrire (SECURITY DEFINER, acteur estampillé serveur)
-- ============================================================
-- Aucun paramètre d'acteur : l'identité vient de la session (impossible d'usurper qui a agi).
-- Fail-closed : un appelant sans mapping staff (rôle NULL) ne peut pas journaliser (42501). Le journal
-- n'accepte donc que des actions attribuables à un membre du personnel identifié.
create or replace function public.log_audit_event(
  p_action text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_summary text default null,
  p_venue text default null,
  p_event_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
  v_username text := public.current_staff_username();
  v_id uuid;
begin
  if v_role is null then
    -- Appelant non identifié (anon, ou authenticated sans mapping staff) : refus. Une action non
    -- attribuable n'a pas sa place dans un journal d'audit.
    raise exception 'log_audit_event: appelant non identifié (aucun membre staff mappé)'
      using errcode = '42501';
  end if;
  if p_action is null or length(btrim(p_action)) = 0 then
    raise exception 'log_audit_event: action requise' using errcode = '22023';
  end if;

  insert into public.audit_log(
    action, actor_username, actor_role, resource_type, resource_id,
    venue, event_id, summary, before_data, after_data, metadata
  )
  values (
    btrim(p_action), v_username, v_role, p_resource_type, p_resource_id,
    p_venue, p_event_id, p_summary, p_before, p_after, p_metadata
  )
  returning id into v_id;

  return v_id;
end $$;

-- ============================================================
-- 3) RLS + GRANTS — APPEND-ONLY côté écriture, LECTURE DIRECTION uniquement
-- ============================================================
alter table public.audit_log enable row level security;

-- anon : rien. authenticated : SELECT seul (jamais insert/update/delete direct → append-only).
revoke all on public.audit_log from anon;
revoke all on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;

-- Lecture : direction (admin) voit TOUT ; tout autre rôle ne matche pas → aucune ligne (fermé par RLS,
-- pas par l'UI). Élargissement à 'manager' = décision fondateur (non prise ici).
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated
  using (public.current_staff_role() = 'admin');

-- Pas de policy INSERT/UPDATE/DELETE : combiné à l'absence de grant, l'écriture directe est refusée au
-- niveau privilège pour authenticated (l'insertion ne se fait QUE via log_audit_event, SECURITY DEFINER).

-- Point d'entrée d'écriture : réservé aux sessions authentifiées (la fonction refuse elle-même les
-- appelants sans mapping staff). anon n'a pas le droit d'exécuter.
revoke all on function public.log_audit_event(text, text, text, text, text, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.log_audit_event(text, text, text, text, text, uuid, jsonb, jsonb, jsonb) to authenticated;

commit;
