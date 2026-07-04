-- 0038_artist_checkin_audit_trigger.sql — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR L'ARTIST CHECK-IN (0027).
--
-- Suite du câblage `log_audit_event` (0033), après la carte (0034/0035, IN-RPC), les incidents (0036,
-- TRIGGER) et la décision de réservation (0037, IN-RPC). On couvre ici l'ARTIST CHECK-IN (0027).
-- Différence structurelle décisive, IDENTIQUE aux incidents : la fiche d'accueil artiste est écrite en
-- INSERT/UPDATE DIRECT sous RLS (0027, policies artist_checkins_insert / artist_checkins_update) — il
-- n'y a AUCUN corps de fonction `SECURITY DEFINER` où insérer un `perform log_audit_event(...)`. Le seul
-- point d'accroche fiable et non contournable est donc un TRIGGER de table : on RÉUTILISE tel quel le
-- patron 0036 (fonction de trigger SECURITY INVOKER + trigger AFTER + filtre de bruit + minimisation).
--
-- Valeur métier (CLUB_ONE_OS_MASTER §A8 → B1) : l'arrivée d'un artiste, un NO-SHOW, une escalade de
-- statut ou la validation technique du soir sont des événements de soirée à faible volume et fort enjeu
-- direction. Ils alimentent désormais le journal d'audit GLOBAL (timeline transverse lue par la
-- direction), en plus de la fiche opérationnelle `artist_checkins` (qui reste la source détaillée).
--
-- Additif STRICT : ne touche AUCUNE table, colonne, policy ni RPC existante. Aucun seed. Le module
-- Artist check-in continue de SHIP VIDE (aucun artiste, aucun cachet inventé). On AJOUTE seulement une
-- fonction de trigger + son trigger AFTER. L'écriture d'audit hérite des garanties de 0033 :
--   · acteur estampillé SERVEUR (`current_staff_role()`/`current_staff_username()`), jamais un
--     paramètre → non usurpable ;
--   · append-only (audit_log n'accepte l'écriture QUE via `log_audit_event`, SECURITY DEFINER) ;
--   · fail-closed : un appelant sans mapping staff fait lever 42501 dans `log_audit_event`. Ici c'est
--     COHÉRENT et SANS RÉGRESSION : la policy `artist_checkins_insert` (0027) restreint déjà l'écriture
--     à `current_staff_role() in ('admin','manager')` ET `auteur_username = current_staff_username()`,
--     et `artist_checkins_update` à la direction — donc seul un membre staff mappé (direction) peut
--     écrire une fiche. Le chemin d'audit ne peut donc JAMAIS fail-closer sur une écriture légitime.
--
-- Sémantique « audit infalsifiable » : si le journal ne peut pas enregistrer l'événement, l'écriture
-- métier est annulée (le PERFORM propage l'exception, le trigger AFTER étant dans la même transaction).
-- C'est le MÊME contrat que les incidents (0036) et la carte (0034/0035).
--
-- La fonction de trigger est SECURITY INVOKER (défaut) : elle s'exécute avec les privilèges du membre
-- direction qui écrit la fiche et se contente d'appeler `log_audit_event` (déjà SECURITY DEFINER, qui
-- fait l'INSERT privilégié dans audit_log et l'estampillage). Aucune élévation de privilège inutile ;
-- `set search_path = public` est fixé par hygiène (résolution stable des noms).

begin;

-- ============================================================
-- ARTIST_CHECKINS — ouverture (INSERT) + jalons significatifs (UPDATE)
-- ============================================================
-- Un UPDATE de fiche bumpe `updated_at` à chaque écriture (et peut ne toucher qu'un champ libre :
-- loge, rider, matériel, notes). On ne journalise QUE les changements porteurs de sens pour la
-- supervision de soirée — transition de STATUT (attendu→arrive→…→termine/no_show/annule) et
-- franchissement d'un JALON (arrivée, balance, validation technique) — pas les bumps techniques ni les
-- retouches de champs libres, afin que le journal direction reste lisible et non noyé.
--
-- MINIMISATION : le résumé et after_data ne portent QUE le nom de scène (artist_name — sujet même de
-- l'audit, pas une PII client), le statut et les jalons. Les champs libres susceptibles de contenir des
-- coordonnées de tiers (contact/tour-manager, rider, matériel, notes) ne sont JAMAIS recopiés dans le
-- journal global — ils restent dans `artist_checkins`, relisibles par la direction.
create or replace function public.audit_artist_checkin_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_summary text;
begin
  if tg_op = 'INSERT' then
    perform public.log_audit_event(
      p_action        => 'artist.checkin.open',
      p_resource_type => 'artist_checkin',
      p_resource_id   => new.id::text,
      p_summary       => format('Fiche artiste — %s (%s)%s',
                                new.artist_name, new.status,
                                case when new.slot_label is not null
                                     then ' · ' || new.slot_label else '' end),
      p_event_id      => new.event_id,
      p_after         => jsonb_build_object(
                           'artist_name', new.artist_name,
                           'status', new.status,
                           'slot_label', new.slot_label,
                           'companions', new.companions,
                           'exploitation_date', new.exploitation_date
                         )
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Significatif = transition de statut OU franchissement d'un jalon de soirée. `is distinct from`
    -- capture aussi une correction de jalon (rare) ; les retouches de champs libres seuls sont ignorées.
    if new.status            is distinct from old.status
       or new.arrived_at        is distinct from old.arrived_at
       or new.soundcheck_at     is distinct from old.soundcheck_at
       or new.tech_validated_at is distinct from old.tech_validated_at then
      -- Résumé lisible : transition de statut prioritaire, jalons signalés explicitement.
      v_summary := format('%s — fiche mise à jour', new.artist_name);
      if new.status is distinct from old.status then
        v_summary := format('%s — statut %s → %s', new.artist_name, old.status, new.status);
      end if;
      if new.arrived_at is not null and old.arrived_at is null then
        v_summary := v_summary || ' · arrivé';
      end if;
      if new.soundcheck_at is not null and old.soundcheck_at is null then
        v_summary := v_summary || ' · balance';
      end if;
      if new.tech_validated_at is not null and old.tech_validated_at is null then
        v_summary := v_summary || ' · validé technique';
      end if;
      perform public.log_audit_event(
        p_action        => 'artist.checkin.update',
        p_resource_type => 'artist_checkin',
        p_resource_id   => new.id::text,
        p_summary       => v_summary,
        p_event_id      => new.event_id,
        p_before        => jsonb_build_object(
                             'status', old.status,
                             'arrived_at', old.arrived_at,
                             'soundcheck_at', old.soundcheck_at,
                             'tech_validated_at', old.tech_validated_at
                           ),
        p_after         => jsonb_build_object(
                             'status', new.status,
                             'arrived_at', new.arrived_at,
                             'soundcheck_at', new.soundcheck_at,
                             'tech_validated_at', new.tech_validated_at,
                             'tech_validated_by', new.tech_validated_by
                           )
      );
    end if;
    return new;
  end if;

  return null; -- inatteignable (trigger déclaré INSERT OR UPDATE seulement)
end $$;

drop trigger if exists trg_audit_artist_checkin on public.artist_checkins;
create trigger trg_audit_artist_checkin
  after insert or update on public.artist_checkins
  for each row execute function public.audit_artist_checkin_change();

commit;
