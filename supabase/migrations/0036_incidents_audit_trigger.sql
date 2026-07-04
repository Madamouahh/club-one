-- 0036_incidents_audit_trigger.sql — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR LE MODULE INCIDENTS (0023).
--
-- Suite du câblage `log_audit_event` (0033) : après la carte (0034/0035, câblage IN-RPC), on couvre
-- les INCIDENTS. Différence structurelle décisive : les incidents ne passent PAS par une RPC
-- `SECURITY DEFINER` — ils sont écrits en INSERT/UPDATE DIRECT sous RLS (0023, policies
-- incidents_insert / incidents_update). Il n'y a donc AUCUN corps de fonction où insérer un
-- `perform log_audit_event(...)` comme pour la carte. Le seul point d'accroche fiable et non
-- contournable est un TRIGGER de table — l'approche explicitement désignée par la PROCHAINE ÉTAPE
-- S82 (« writes en INSERT direct RLS → nécessitera un TRIGGER, pas un `perform` in-RPC »).
--
-- Valeur métier (CLUB_ONE_OS_MASTER §A6 → B1) : « A6 (incidents) → B1 (centre de commandement) :
-- remontée temps réel vers la direction ». Un incident ouvert, une escalade ou un changement de
-- statut alimentent désormais le journal d'audit GLOBAL (timeline transverse lue par la direction),
-- en plus du fil de suivi local `incident_updates` (qui reste la source détaillée).
--
-- Additif STRICT : ne touche AUCUNE table, colonne, policy ni RPC existante. Aucun seed. Le module
-- Incidents continue de SHIP VIDE (aucun incident inventé). On AJOUTE seulement deux fonctions de
-- trigger + leurs triggers AFTER. L'écriture d'audit hérite des garanties de 0033 :
--   · acteur estampillé SERVEUR (`current_staff_role()`/`current_staff_username()`), jamais un
--     paramètre → non usurpable ;
--   · append-only (audit_log n'accepte l'écriture QUE via `log_audit_event`, SECURITY DEFINER) ;
--   · fail-closed : un appelant sans mapping staff fait lever 42501 dans `log_audit_event`. Ici c'est
--     COHÉRENT et sans régression : la policy `incidents_insert` (0023) exige déjà
--     `auteur_username = current_staff_username()`, donc seul un membre staff mappé peut écrire un
--     incident — le chemin d'audit ne peut donc pas fail-closer sur une écriture légitime.
--
-- Sémantique « audit infalsifiable » : si le journal ne peut pas enregistrer l'événement, l'écriture
-- métier est annulée (le PERFORM propage l'exception, le trigger AFTER étant dans la même
-- transaction). C'est le MÊME contrat que la carte (0034/0035 appellent `log_audit_event` inline) :
-- pas de mutation sensible sans trace.
--
-- Les fonctions de trigger sont SECURITY INVOKER (défaut) : elles s'exécutent avec les privilèges du
-- membre staff qui écrit l'incident et se contentent d'appeler `log_audit_event` (déjà SECURITY
-- DEFINER, qui fait l'INSERT privilégié dans audit_log et l'estampillage). Aucune élévation de
-- privilège inutile ; `set search_path = public` est fixé par hygiène (résolution stable des noms).

begin;

-- ============================================================
-- 1) INCIDENTS — ouverture (INSERT) + changements significatifs (UPDATE)
-- ============================================================
-- Un UPDATE d'incident bumpe `updated_at` à chaque écriture ; on ne journalise QUE les changements
-- porteurs de sens pour la supervision (statut, escalade, niveau, résolution) — pas les bumps
-- purement techniques — afin que le journal direction reste lisible et non noyé.
create or replace function public.audit_incident_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_summary text;
begin
  if tg_op = 'INSERT' then
    perform public.log_audit_event(
      p_action        => 'incident.open',
      p_resource_type => 'incident',
      p_resource_id   => new.id::text,
      p_summary       => format('Incident ouvert — %s / %s%s',
                                new.type, new.niveau,
                                case when new.escalade then ' (escaladé)' else '' end),
      p_event_id      => new.event_id,
      p_after         => jsonb_build_object(
                           'type', new.type, 'niveau', new.niveau, 'status', new.status,
                           'escalade', new.escalade, 'lieu', new.lieu
                         )
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status    is distinct from old.status
       or new.escalade is distinct from old.escalade
       or new.niveau   is distinct from old.niveau
       or new.resolved_at is distinct from old.resolved_at then
      -- Résumé lisible : transition de statut prioritaire, escalade signalée explicitement.
      v_summary := 'Incident mis à jour';
      if new.status is distinct from old.status then
        v_summary := format('Statut %s → %s', old.status, new.status);
      end if;
      if new.escalade and not old.escalade then
        v_summary := v_summary || ' · ESCALADE direction';
      end if;
      if new.resolved_at is not null and old.resolved_at is null then
        v_summary := v_summary || ' · résolu';
      end if;
      perform public.log_audit_event(
        p_action        => 'incident.update',
        p_resource_type => 'incident',
        p_resource_id   => new.id::text,
        p_summary       => v_summary,
        p_event_id      => new.event_id,
        p_before        => jsonb_build_object('status', old.status, 'niveau', old.niveau,
                                              'escalade', old.escalade, 'resolved_at', old.resolved_at),
        p_after         => jsonb_build_object('status', new.status, 'niveau', new.niveau,
                                              'escalade', new.escalade, 'resolved_at', new.resolved_at)
      );
    end if;
    return new;
  end if;

  return null; -- inatteignable (trigger déclaré INSERT OR UPDATE seulement)
end $$;

drop trigger if exists trg_audit_incident on public.incidents;
create trigger trg_audit_incident
  after insert or update on public.incidents
  for each row execute function public.audit_incident_change();

-- ============================================================
-- 2) INCIDENT_UPDATES — chaque entrée du fil de suivi (action, transition, escalade)
-- ============================================================
-- Le fil local `incident_updates` reste la source DÉTAILLÉE ; on en projette une trace dans le
-- journal GLOBAL pour la timeline transverse direction (B1). La note libre n'est PAS recopiée
-- (minimisation : elle reste dans incident_updates, relisible par la direction) — seul sa présence
-- est signalée.
create or replace function public.audit_incident_update_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.log_audit_event(
    p_action        => 'incident.followup',
    p_resource_type => 'incident',
    p_resource_id   => new.incident_id::text,
    p_summary       => coalesce(nullif(btrim(new.action), ''), 'Suivi incident')
                       || case when new.new_status is not null
                               then format(' (→ %s)', new.new_status) else '' end,
    p_after         => jsonb_build_object(
                         'action', new.action,
                         'new_status', new.new_status,
                         'note_present', (new.note is not null and length(btrim(new.note)) > 0)
                       )
  );
  return new;
end $$;

drop trigger if exists trg_audit_incident_update on public.incident_updates;
create trigger trg_audit_incident_update
  after insert on public.incident_updates
  for each row execute function public.audit_incident_update_row();

commit;
