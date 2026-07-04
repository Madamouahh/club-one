-- 0039_internal_comms_audit_trigger.sql — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR LA COMMUNICATION
-- INTERNE (0026).
--
-- Suite du câblage `log_audit_event` (0033), après la carte (0034/0035, IN-RPC), les incidents
-- (0036, TRIGGER), la décision de résa (0037, IN-RPC) et l'artist check-in (0038, TRIGGER). On
-- couvre ici la COMMUNICATION INTERNE. Comme les incidents et l'artist check-in, `internal_messages`
-- est écrit en INSERT/UPDATE DIRECT sous RLS (0026, policies internal_messages_insert/_update) — il
-- n'existe AUCUNE RPC `SECURITY DEFINER` où insérer un `perform log_audit_event(...)`. Le seul point
-- d'accroche fiable et non contournable est donc un TRIGGER de table (patron 0036/0038 réutilisé).
--
-- Valeur métier (CLUB_ONE_OS_MASTER §A7 → B1) : « A7 (comm interne) → B1 (centre de commandement) ».
-- Le bouton URGENCE interne, une ALERTE opérationnelle et une ANNONCE direction sont des événements
-- ACCOUNTABLES (qui a déclenché quoi, quand) : ils alimentent désormais la timeline d'audit GLOBALE
-- lue par la direction, en plus du fil local `internal_messages` (qui reste la source détaillée).
--
-- FILTRE DE BRUIT (décision de périmètre, patron 0036/0038) : on ne journalise QUE les catégories
-- sensibles/accountables — `urgence`, `alerte`, `annonce`. Les `message` et `tache` de coordination
-- routinière sont FILTRÉS : le journal direction est une timeline d'événements accountables, pas un
-- miroir du chat interne (qui serait vite illisible). Côté UPDATE, la SEULE transition journalisée est
-- la RÉSOLUTION d'une urgence/alerte (resolved_at NULL → renseigné : qui a clos l'alerte, quand) ;
-- les éditions de corps, re-ciblages et bumps `updated_at` seuls sont filtrés.
--
-- MINIMISATION (patron 0037/0038) : le corps du message (`body`) est un champ LIBRE pouvant contenir
-- des coordonnées de tiers ou des informations sensibles → il n'est JAMAIS recopié dans le journal
-- global. On ne journalise que la CATÉGORIE (kind), le CIBLAGE (target_role / assignee_username, qui
-- sont des identités STAFF internes, pas de la PII client), l'état résolu et le contexte soirée
-- (event_id). Le corps reste dans `internal_messages`, relisible sous RLS par qui de droit.
--
-- Additif STRICT : ne touche AUCUNE table, colonne, policy ni RPC existante. Aucun seed. Le module
-- Comm interne continue de SHIP VIDE (aucun message inventé). On AJOUTE seulement une fonction de
-- trigger + son trigger AFTER. L'écriture d'audit hérite des garanties de 0033 :
--   · acteur estampillé SERVEUR (`current_staff_role()`/`current_staff_username()`), jamais un
--     paramètre → non usurpable ;
--   · append-only (audit_log n'accepte l'écriture QUE via `log_audit_event`, SECURITY DEFINER) ;
--   · fail-closed COHÉRENT et sans régression : la policy internal_messages_insert (0026) exige déjà
--     `auteur_username = current_staff_username()` et un rôle opérationnel → seul un membre staff mappé
--     peut écrire un message ; le chemin d'audit ne peut donc jamais fail-closer sur une écriture
--     légitime (même contrat que 0036/0038).
--
-- Sémantique « audit infalsifiable » : si le journal ne peut pas enregistrer l'événement, l'écriture
-- métier est annulée (le PERFORM propage l'exception, le trigger AFTER étant dans la même
-- transaction). Pas de mutation accountable sans trace.
--
-- La fonction de trigger est SECURITY INVOKER (défaut) : elle s'exécute avec les privilèges du membre
-- staff qui écrit le message et se contente d'appeler `log_audit_event` (déjà SECURITY DEFINER, qui
-- fait l'INSERT privilégié dans audit_log et l'estampillage). Aucune élévation de privilège inutile ;
-- `set search_path = public` est fixé par hygiène (résolution stable des noms).

begin;

-- ============================================================
-- COMMUNICATION INTERNE — ouverture (INSERT) des catégories sensibles + résolution (UPDATE)
-- ============================================================
create or replace function public.audit_internal_message_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_target text;
begin
  -- Description lisible du ciblage (rôle / assignation nominative / diffusion générale), SANS le
  -- corps du message (minimisation). target_role et assignee_username sont des identités STAFF.
  v_target := case
    when new.target_role is not null       then format(' · ciblé %s', new.target_role)
    when new.assignee_username is not null  then format(' · assigné à %s', new.assignee_username)
    else ' · diffusion générale'
  end;

  if tg_op = 'INSERT' then
    -- FILTRE DE BRUIT : seules les catégories accountables alimentent le journal direction.
    -- 'message' et 'tache' (coordination routinière) sont ignorés.
    if new.kind not in ('urgence','alerte','annonce') then
      return null; -- AFTER trigger : valeur de retour ignorée ; sert au filtrage explicite.
    end if;
    perform public.log_audit_event(
      p_action        => 'comm.' || new.kind,      -- comm.urgence / comm.alerte / comm.annonce
      p_resource_type => 'internal_message',
      p_resource_id   => new.id::text,
      p_summary       => (case new.kind
                            when 'urgence' then 'Urgence interne'
                            when 'alerte'  then 'Alerte opérationnelle'
                            when 'annonce' then 'Annonce direction'
                          end) || v_target,
      p_event_id      => new.event_id,
      p_after         => jsonb_build_object(
                           'kind', new.kind,
                           'target_role', new.target_role,
                           'assignee_username', new.assignee_username,
                           'resolved', (new.resolved_at is not null)
                         )
      -- p_venue omis : internal_messages ne porte pas de colonne venue.
    );
    return null;
  end if;

  if tg_op = 'UPDATE' then
    -- Seule transition accountable : une urgence/alerte OUVERTE devient RÉSOLUE. Les éditions de
    -- corps / re-ciblage et les bumps updated_at seuls sont filtrés (bruit) → journal lisible.
    if new.kind in ('urgence','alerte')
       and new.resolved_at is not null and old.resolved_at is null then
      perform public.log_audit_event(
        p_action        => 'comm.resolve',
        p_resource_type => 'internal_message',
        p_resource_id   => new.id::text,
        p_summary       => (case new.kind when 'urgence' then 'Urgence' else 'Alerte' end)
                           || ' résolue' || v_target,
        p_event_id      => new.event_id,
        p_before        => jsonb_build_object('kind', old.kind, 'resolved', false),
        p_after         => jsonb_build_object('kind', new.kind, 'resolved', true)
      );
    end if;
    return null;
  end if;

  return null; -- inatteignable (trigger déclaré INSERT OR UPDATE seulement)
end $$;

drop trigger if exists trg_audit_internal_message on public.internal_messages;
create trigger trg_audit_internal_message
  after insert or update on public.internal_messages
  for each row execute function public.audit_internal_message_change();

-- NB : internal_message_reads (accusés de lecture) n'est PAS audité — un accusé de lecture est du
-- bruit pur pour un journal d'audit (haut volume, aucune valeur d'accountability direction).

commit;
