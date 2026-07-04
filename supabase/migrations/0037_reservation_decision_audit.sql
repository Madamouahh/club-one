-- 0037_reservation_decision_audit.sql — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR LA DÉCISION DE RÉSERVATION.
--
-- Suite du câblage `log_audit_event(...)` désigné par la PROCHAINE ÉTAPE S82/S83 (« assign de table /
-- décision de résa »). La carte (0034/0035) est auditée via des RPC SECURITY DEFINER ; les incidents
-- (0036) via un TRIGGER (writes INSERT direct sous RLS). La DÉCISION de réservation appartient à la
-- 1re famille : `decide_table_reservation_v1` (0025) est une RPC SECURITY DEFINER — le point d'accroche
-- propre est donc un `perform public.log_audit_event(...)` DANS le corps de la fonction, comme 0034/0035.
--
-- PÉRIMÈTRE VOLONTAIREMENT ÉTROIT — on N'AUDITE QUE la décision STAFF (validation/refus par la direction),
-- PAS la demande anon `request_table_reservation_v1` :
--   · `log_audit_event` est fail-closed : un appelant sans mapping staff (rôle NULL → anon) lève 42501 et,
--     dans la même transaction, ANNULERAIT la demande client. Un journal d'audit n'accepte QUE des actions
--     attribuables à un membre du personnel identifié (règle du socle 0033) — la demande anon n'en est pas
--     une. La brancher casserait le flux client ET polluerait un journal « direction » de bruit volumineux.
--   · La décision (approve/decline) est au contraire une action de direction, à faible volume, hautement
--     sensible (elle engage une table, branche une visite CRM) → exactement la cible du journal d'audit.
--
-- POURQUOI `create or replace` D'UNE FONCTION EXISTANTE (et pas un trigger comme 0036) : la décision passe
-- déjà par une RPC SECURITY DEFINER unique — il n'existe pas d'écriture directe sous RLS à intercepter.
-- Le corps ci-dessous REPRODUIT FIDÈLEMENT la définition de 0025 (vérifiée identique à la définition vivante
-- du LABO au moment de l'écriture) et n'AJOUTE que deux appels `log_audit_event` dans les branches de succès.
-- AUCUN changement de signature, de type de retour, de garde, ni de comportement métier : la seule
-- différence observable est UNE ligne d'audit écrite quand la décision aboutit. Ce n'est PAS une fonction de
-- cycle de vie (close/bootstrap/activate 0008) — le risque est du même ordre que 0034/0035, pas une « porte
-- critique » lifecycle.
--
-- Propriétés de sécurité (inchangées vs 0025 + héritées de 0033) :
--   · La garde de rôle (`v_role not in ('admin','manager')` → `unauthorized`) est ANTÉRIEURE aux branches :
--     quand on atteint l'appel d'audit, l'acteur est forcément admin/manager → `log_audit_event` ne peut
--     jamais fail-close ici → AUCUNE régression (une décision légitime ne peut pas être annulée par l'audit).
--   · L'ACTEUR de l'audit n'est jamais fourni par le client : `log_audit_event` l'estampille depuis la
--     session (current_staff_role/username), inchangé par le passage en SECURITY DEFINER.
--   · MINIMISATION : le résumé et les instantanés ne portent AUCUNE PII client (ni nom, ni note libre du
--     client) — seulement l'univers, le NUMÉRO de table, la taille de groupe, la transition de statut, et
--     (au refus) le motif SAISI PAR LE STAFF. Le lien vers le client reste `guest_id` dans la demande.
--   · before/after = support de réversibilité (0033) : la transition pending→approved / pending→declined.
--
-- Additif strict : `create or replace function` (même signature), aucune table/donnée/policy touchée, aucun
-- seed. Idempotent. LABO uniquement (migration NON exécutée sur la base opérationnelle — règles 20 + 40).

begin;

-- ============================================================
-- decide_table_reservation_v1 — un manager VALIDE ou REFUSE une demande (authenticated), MAINTENANT TRACÉ.
--   Corps identique à 0025 + `perform log_audit_event(...)` dans chaque branche de succès (approve/decline).
-- ============================================================
create or replace function public.decide_table_reservation_v1(
  p_request_id uuid,
  p_decision text,
  p_decline_reason text
) returns table (ok boolean, code text, message text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_decision text := nullif(btrim(coalesce(p_decision, '')), '');
  v_reason text := nullif(btrim(coalesce(p_decline_reason, '')), '');
  v_req record;
  v_label text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorisé.', null::text; return;
  end if;
  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Validation réservée à la direction.', null::text; return;
  end if;
  if v_decision not in ('approve','decline') then
    return query select false, 'invalid_decision', 'Décision invalide.', null::text; return;
  end if;

  select * into v_req from public.table_reservation_requests where id = p_request_id for update;
  if not found then
    return query select false, 'unknown_request', 'Demande introuvable.', null::text; return;
  end if;
  if v_req.status <> 'pending' then
    return query select false, 'not_pending', 'Cette demande a déjà été traitée.', v_req.status; return;
  end if;

  -- Numéro de table pour un résumé lisible par la direction (aucune PII client). NULL-safe.
  select label into v_label from public.venue_tables where id = v_req.venue_table_id;

  if v_decision = 'approve' then
    update public.table_reservation_requests
       set status = 'approved', decided_by = v_username, decided_at = v_now, updated_at = v_now
     where id = v_req.id;
    -- Branche le flux dans le CRM : une visite « booked » (idempotente sur la clé unique 0013).
    insert into public.guest_visits (
      guest_id, event_id, exploitation_date, univers, status, party_size, is_host, created_by
    ) values (
      v_req.guest_id, v_req.event_id, v_req.exploitation_date, v_req.venue, 'booked', v_req.party_size, true, 'resa_request'
    ) on conflict (guest_id, exploitation_date, univers) do nothing;

    perform public.log_audit_event(
      p_action        => 'reservation.approve',
      p_resource_type => 'table_reservation_requests',
      p_resource_id   => v_req.id::text,
      p_summary       => 'Réservation ' || v_req.venue || ' · table ' || coalesce(v_label, '?') ||
                         ' → VALIDÉE · ' || v_req.party_size || ' pers',
      p_venue         => v_req.venue,
      p_event_id      => v_req.event_id,
      p_before        => jsonb_build_object('status', 'pending'),
      p_after         => jsonb_build_object('status', 'approved'),
      p_metadata      => jsonb_build_object('venue_table_id', v_req.venue_table_id, 'party_size', v_req.party_size)
    );

    return query select true, 'approved', 'Demande validée.', 'approved'; return;
  else
    update public.table_reservation_requests
       set status = 'declined', decided_by = v_username, decided_at = v_now, decline_reason = v_reason, updated_at = v_now
     where id = v_req.id;

    perform public.log_audit_event(
      p_action        => 'reservation.decline',
      p_resource_type => 'table_reservation_requests',
      p_resource_id   => v_req.id::text,
      p_summary       => 'Réservation ' || v_req.venue || ' · table ' || coalesce(v_label, '?') ||
                         ' → REFUSÉE' || coalesce(' · ' || v_reason, ''),
      p_venue         => v_req.venue,
      p_event_id      => v_req.event_id,
      p_before        => jsonb_build_object('status', 'pending'),
      p_after         => jsonb_build_object('status', 'declined', 'decline_reason', v_reason),
      p_metadata      => jsonb_build_object('venue_table_id', v_req.venue_table_id, 'party_size', v_req.party_size)
    );

    return query select true, 'declined', 'Demande refusée.', 'declined'; return;
  end if;
end;
$$;

-- Grants réémis à l'identique de 0025 (idempotent ; `create or replace` préserve déjà les grants).
revoke all on function public.decide_table_reservation_v1(uuid, text, text) from public;
grant execute on function public.decide_table_reservation_v1(uuid, text, text) to authenticated;

commit;
