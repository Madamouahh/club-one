-- 0041_rh_shift_audit_trigger.sql — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR LE CYCLE DE VIE DU CRÉNEAU RH
-- (staff_shifts, 0011 / 0020) : confirmation salarié, pointage réel, annulation.
--
-- Suite du câblage `log_audit_event` (0033), après la carte (0034/0035, IN-RPC), les incidents (0036,
-- TRIGGER), la décision de réservation (0037, IN-RPC), l'artist check-in (0038, TRIGGER), la
-- communication interne (0039, TRIGGER) et les checklists + captation (0040, TRIGGER). On couvre ici la
-- brique RH / Planning (B7, master §B7) : le CRÉNEAU (`staff_shifts`, 0011) = le producteur de la masse
-- horaire (coût staff) et le support du pointage. Ses jalons accountables sont exactement ce que la
-- direction reconstitue après coup (« qui a confirmé, qui a été marqué absent ce soir, et par qui ? »).
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI UN TRIGGER UNIQUE — ET PAS L'APPROCHE « IN-CORPS » ESQUISSÉE PAR LA PROCHAINE ÉTAPE S84→S87
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Le master notait deux points d'accroche RH : (1) la RPC `confirm_my_shift_v1` (0020, SECURITY DEFINER)
-- → patron in-corps 0034/0035/0037 ; (2) les writes planning de la direction (INSERT/UPDATE direct sous
-- RLS) → patron TRIGGER 0036. Or ces deux surfaces ÉCRIVENT LA MÊME TABLE `staff_shifts` :
--   · la direction compose/pointe via un UPSERT direct (app `upsertStaffShift`, RLS staff_shifts_insert/
--     _update = admin/manager) ;
--   · le salarié confirme via `confirm_my_shift_v1`, dont le corps fait un `update public.staff_shifts
--     set status='confirme'` — un UPDATE DIRECT de la table, donc INTERCEPTÉ par un trigger de table.
-- Un TRIGGER AFTER INSERT OR UPDATE sur `staff_shifts` capte donc les DEUX chemins avec un seul point non
-- contournable. Ajouter EN PLUS un `perform log_audit_event` in-corps dans `confirm_my_shift_v1`
-- DOUBLERAIT l'audit de la transition « confirme » (l'UPDATE de la RPC réveille le trigger). Le trigger
-- seul est donc le design CORRECT (non redondant), plus SÛR (aucun `create or replace` d'un corps SECDEF
-- vivant à reproduire à l'identique, contrairement à 0037), et COMPLET. `confirm_my_shift_v1` n'est PAS
-- modifiée par cette migration.
--
-- ATTRIBUTION CORRECTE DE L'ACTEUR SUR LES DEUX CHEMINS : `log_audit_event` estampille l'acteur depuis la
-- session (`current_staff_role()`/`current_staff_username()` → lecture de `staff_users` via `auth.uid()`),
-- ce qui est INCHANGÉ par le passage en SECURITY DEFINER de `confirm_my_shift_v1`. Donc :
--   · pointage/annulation direction → actor = admin/manager (l'auteur du pointage) ;
--   · confirmation via la RPC → actor = LE SALARIÉ lui-même (il a confirmé SON propre créneau).
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- FILTRE DE BRUIT (patron 0036/0038/0039/0040) — la timeline direction est à FAIBLE VOLUME / FORT ENJEU
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- On NE journalise QUE les jalons accountables du créneau :
--   · `rh.shift.confirm`  — le salarié confirme sa présence (statut résultant 'confirme') ;
--   · `rh.shift.pointage` — pointage réel de la direction (statut résultant 'present'/'absent'/'retard') ;
--   · `rh.shift.cancel`   — la direction annule un créneau (statut résultant 'annule').
-- Sont FILTRÉS (restent dans `staff_shifts`, hors timeline direction) :
--   · la COMPOSITION du planning : création d'un brouillon 'planifie' (INSERT status='planifie'), et
--     toute re-sauvegarde à statut INCHANGÉ (retouche d'horaires prévus/réels, de poste, de commentaire)
--     — c'est de la coordination routinière, pas un jalon.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MINIMISATION (patron 0037/0038/0039/0040) — droit du travail + paie : on ne recopie AUCUNE donnée
-- sensible de rémunération ni aucun champ libre dans le journal global :
--   · `staff_members.taux_horaire` et `staff_members.notes_direction` (paie / confidentiel direction) ne
--     sont JAMAIS lus par ce trigger ;
--   · `staff_shifts.commentaire` (champ libre du soir, pouvant contenir une observation sensible sur une
--     personne) n'est JAMAIS recopié ;
--   · les horodatages de pointage réel (`actual_start`/`actual_end`) ne sont PAS recopiés — le journal
--     retient le FAIT accountable (transition de statut), la source de vérité chiffrée reste `staff_shifts`.
--   · SEUL `full_name` est inclus (identité du SUJET du créneau) : il est indispensable à la lisibilité de
--     la timeline et n'est PAS une divulgation nouvelle — la direction, seule lectrice de `audit_log`
--     (0033, lecture 'admin'), voit déjà tout `staff_members` (staff_members_read admin/manager). Le
--     `poste` tenu (libellé de poste, pas une donnée sensible) est inclus pour le contexte.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Additif STRICT : ne touche AUCUNE table, colonne, policy ni RPC existante. Aucun seed. Le module RH
-- continue de SHIP VIDE (staff_members/staff_shifts vides — la vraie liste du personnel est une donnée du
-- fondateur, jamais inventée). On AJOUTE seulement une fonction de trigger + un trigger AFTER. L'écriture
-- d'audit hérite des garanties de 0033 :
--   · acteur estampillé SERVEUR (jamais un paramètre) → non usurpable ;
--   · append-only (audit_log n'accepte l'écriture QUE via `log_audit_event`, SECURITY DEFINER) ;
--   · fail-closed COHÉRENT et SANS RÉGRESSION : toute écriture légitime de `staff_shifts` provient soit
--     de la direction (policy staff_shifts_insert/_update = current_staff_role() in ('admin','manager') →
--     rôle non nul), soit de `confirm_my_shift_v1` qui a déjà exigé current_staff_username() non nul (même
--     ligne `staff_users` que le rôle → rôle non nul lui aussi). Dans les deux cas l'acteur est un membre
--     staff mappé → `log_audit_event` ne peut JAMAIS fail-closer sur une écriture RH légitime.
--
-- Sémantique « audit infalsifiable » : si le journal ne peut pas enregistrer l'événement, l'écriture
-- métier est annulée (le PERFORM propage l'exception, le trigger AFTER étant dans la même transaction).
--
-- La fonction de trigger est SECURITY INVOKER (défaut) : elle s'exécute avec les privilèges de l'écrivain
-- et se contente d'appeler `log_audit_event` (déjà SECURITY DEFINER, qui fait l'INSERT privilégié et
-- l'estampillage). `set search_path = public` est fixé par hygiène (résolution stable des noms).
--
-- NB PÉRIMÈTRE : le RÉPERTOIRE du personnel (`staff_members` : embauche/départ via `actif`, changement de
-- `taux_horaire`, `notes_direction`) n'est PAS audité ici — comme les MODÈLES de checklist/captation en
-- 0040, c'est de la configuration/administration RH touchant de la PII de paie ; son audit demandera une
-- revue de minimisation dédiée (décision fondateur), pas un fourre-tout dans cette migration.
--
-- LABO uniquement (migration NON exécutée sur la base opérationnelle — règles 20 + 40).

begin;

-- ============================================================
-- staff_shifts — jalons accountables du créneau : confirmation salarié / pointage réel / annulation
-- ============================================================
create or replace function public.audit_staff_shift_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_full_name text;
  v_action    text;
  v_old_status text := case when tg_op = 'UPDATE' then old.status else null end;
begin
  -- FILTRE DE BRUIT 1 — la composition du planning (brouillon 'planifie') n'est jamais un jalon.
  if new.status = 'planifie' then
    return null;
  end if;

  -- FILTRE DE BRUIT 2 — sur UPDATE, n'agir que si le STATUT change (une re-sauvegarde d'horaires/poste/
  -- commentaire à statut inchangé est de la coordination routinière, pas un jalon accountable).
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  -- Classe le statut RÉSULTANT en clé d'action. Un statut hors nomenclature accountable n'est pas tracé.
  v_action := case new.status
                when 'confirme' then 'rh.shift.confirm'
                when 'present'  then 'rh.shift.pointage'
                when 'absent'   then 'rh.shift.pointage'
                when 'retard'   then 'rh.shift.pointage'
                when 'annule'   then 'rh.shift.cancel'
                else null
              end;
  if v_action is null then
    return null;
  end if;

  -- Identité du SUJET du créneau (FK staff_member_id garanti). full_name uniquement (minimisation) :
  -- taux_horaire / notes_direction NE sont JAMAIS lus ici.
  select sm.full_name into v_full_name
    from public.staff_members sm
   where sm.id = new.staff_member_id;

  perform public.log_audit_event(
    p_action        => v_action,
    p_resource_type => 'staff_shift',
    p_resource_id   => new.id::text,
    p_summary       => case v_action
                         when 'rh.shift.confirm' then
                           format('RH · %s — présence confirmée (%s)', coalesce(v_full_name, '?'), new.exploitation_date)
                         when 'rh.shift.cancel' then
                           format('RH · %s — créneau %s annulé', coalesce(v_full_name, '?'), new.exploitation_date)
                         else
                           format('RH · %s — pointage %s → %s', coalesce(v_full_name, '?'), new.exploitation_date, new.status)
                       end,
    p_event_id      => new.event_id,
    -- before = ancien statut (support de réversibilité 0033) ; null à l'INSERT (backfill direct d'un
    -- statut accountable, ex. une soirée pointée sans brouillon préalable).
    p_before        => case when tg_op = 'UPDATE'
                            then jsonb_build_object('status', v_old_status) else null end,
    -- after = le FAIT accountable + contexte lisible. Ni commentaire libre, ni horodatages de pointage,
    -- ni donnée de paie (minimisation).
    p_after         => jsonb_build_object(
                         'status', new.status,
                         'poste', new.poste,
                         'exploitation_date', new.exploitation_date,
                         'staff_member_id', new.staff_member_id
                       )
  );
  return null; -- AFTER trigger : valeur de retour ignorée.
end $$;

drop trigger if exists trg_audit_staff_shift on public.staff_shifts;
create trigger trg_audit_staff_shift
  after insert or update on public.staff_shifts
  for each row execute function public.audit_staff_shift_change();

commit;
