-- 0040_checklists_captation_audit_trigger.sql — CÂBLAGE DU JOURNAL D'AUDIT (0033) SUR LES CHECKLISTS
-- OUVERTURE/FERMETURE (0028) ET LA CAPTATION EN SOIRÉE (0029).
--
-- Suite du câblage `log_audit_event` (0033), après la carte (0034/0035, IN-RPC), les incidents (0036,
-- TRIGGER), la décision de réservation (0037, IN-RPC), l'artist check-in (0038, TRIGGER) et la
-- communication interne (0039, TRIGGER). On couvre ici DEUX modules jumeaux (même schéma « modèle
-- réutilisable + état par soirée ») : les CHECKLISTS (0028) et la CAPTATION (0029). Comme les incidents,
-- l'artiste et la comm interne, ces états sont écrits en INSERT/UPDATE DIRECT sous RLS (0028
-- checklist_completions_insert/_update, 0029 shot_captures_insert/_update) — il n'existe AUCUN corps de
-- fonction `SECURITY DEFINER` où insérer un `perform log_audit_event(...)`. Le seul point d'accroche
-- fiable et non contournable est donc un TRIGGER de table (patron 0036/0038/0039 réutilisé). Cette
-- migration ajoute DEUX fonctions de trigger + DEUX triggers AFTER, une par table d'état.
--
-- Valeur métier (CLUB_ONE_OS_MASTER §A9/A10 → B1) :
--   · CHECKLISTS (A9) : la SIGNATURE d'un contrôle LIABILITY-CRITIQUE d'ouverture/fermeture — sécurité,
--     sorties de secours, caisse — est un événement accountable (« la vérif issues de secours a-t-elle
--     été faite ce soir, et par qui ? »). C'est la question que la direction pose après incident. On
--     alimente donc le journal GLOBAL avec ces sign-off, en plus de la trace détaillée
--     `checklist_completions` (qui reste la source par item).
--   · CAPTATION (A10) : le DÉPÔT au DAM (statut → `depose`) est le moment de CHAÎNE DE GARDE du contenu
--     média (photos/vidéos pouvant contenir des personnes identifiables — cf. avertissement des frames de
--     référence Eden). « Qui a déposé quel contenu, quand, sous quelle référence » est accountable et
--     alimente le journal direction.
--
-- FILTRE DE BRUIT (décision de périmètre, patron 0036/0038/0039) — le journal direction est une timeline
-- d'événements à FAIBLE VOLUME et FORT ENJEU, PAS un miroir de chaque coche/statut :
--   · CHECKLISTS : on ne journalise QUE les complétions dont l'item appartient à une catégorie
--     liability-critique — `secu`, `issues` (sorties de secours), `caisse`. Les coches routinières
--     (lumiere/son/nettoyage/stocks/tables/signaletique/captation) sont FILTRÉES : elles restent dans
--     `checklist_completions`, mais n'encombrent pas la timeline direction.
--   · CAPTATION : on ne journalise QUE le franchissement du statut terminal `depose` (dépôt DAM). La
--     progression opérationnelle intermédiaire `a_capturer → capture` est du bruit pour la direction.
--   · Côté UPDATE checklist : la SEULE transition re-journalisée est une RÉ-ATTRIBUTION du sign-off
--     (done_by change → une AUTRE personne endosse le contrôle) ; les retouches de note seules sont
--     filtrées. Côté UPDATE captation : seule la transition VERS `depose` compte (les allers-retours de
--     statut hors dépôt, les éditions de note, sont filtrés).
--
-- MINIMISATION (patron 0037/0038/0039) : les champs LIBRES par soirée susceptibles de contenir des
-- observations sensibles ou des coordonnées de tiers ne sont JAMAIS recopiés dans le journal global :
--   · checklists : la `note` de complétion (observation libre du soir) N'EST PAS recopiée. En revanche le
--     `label` de l'item (le libellé du contrôle, ex. « Sorties de secours dégagées ») EST inclus : c'est
--     de la configuration STAFF fermée décrivant CE QUI a été vérifié, pas une PII client, et il est
--     indispensable à la lisibilité de la timeline.
--   · captation : la `note` et le `sujet` (champ libre pouvant nommer une personne : « public », un
--     artiste…) NE SONT PAS recopiés. Seuls le statut, la référence de dépôt DAM (`dam_ref`, le locator de
--     chaîne de garde, nécessaire à l'accountability) et le contexte (venue/event/date) le sont.
--
-- Additif STRICT : ne touche AUCUNE table, colonne, policy ni RPC existante. Aucun seed. Les modules
-- Checklists et Captation continuent de SHIP VIDE (aucune coche ni aucun plan inventé). On AJOUTE
-- seulement deux fonctions de trigger + leurs triggers AFTER. L'écriture d'audit hérite des garanties de
-- 0033 :
--   · acteur estampillé SERVEUR (`current_staff_role()`/`current_staff_username()`), jamais un
--     paramètre → non usurpable ;
--   · append-only (audit_log n'accepte l'écriture QUE via `log_audit_event`, SECURITY DEFINER) ;
--   · fail-closed COHÉRENT et SANS RÉGRESSION : les policies d'INSERT de 0028/0029 exigent déjà un rôle
--     opérationnel (checklists : admin/manager/server/security/security_counter ; captation :
--     admin/manager) ET `done_by`/`updated_by` = `current_staff_username()` → seul un membre staff mappé
--     peut écrire un état. Le chemin d'audit ne peut donc JAMAIS fail-closer sur une écriture légitime
--     (même contrat que 0036/0038/0039).
--
-- Sémantique « audit infalsifiable » : si le journal ne peut pas enregistrer l'événement, l'écriture
-- métier est annulée (le PERFORM propage l'exception, le trigger AFTER étant dans la même transaction).
--
-- Les fonctions de trigger sont SECURITY INVOKER (défaut) : elles s'exécutent avec les privilèges du
-- membre staff qui écrit l'état et se contentent d'appeler `log_audit_event` (déjà SECURITY DEFINER, qui
-- fait l'INSERT privilégié dans audit_log et l'estampillage). Aucune élévation de privilège inutile ;
-- `set search_path = public` est fixé par hygiène (résolution stable des noms).

begin;

-- ============================================================
-- 1) CHECKLISTS — sign-off (INSERT) d'un contrôle liability-critique + ré-attribution (UPDATE)
-- ============================================================
create or replace function public.audit_checklist_completion_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_phase    text;
  v_category text;
  v_venue    text;
  v_label    text;
begin
  -- On récupère le CONTEXTE de l'item (le FK garantit son existence). phase + category pilotent le
  -- filtre de bruit ; venue est propagé au journal ; label (config STAFF, pas de PII) rend la timeline
  -- lisible. La `note` de complétion (champ libre par soirée) n'est jamais lue ici (minimisation).
  select ci.phase, ci.category, ci.venue, ci.label
    into v_phase, v_category, v_venue, v_label
    from public.checklist_items ci
   where ci.id = new.item_id;

  -- FILTRE DE BRUIT : seules les catégories liability-critiques alimentent le journal direction.
  if v_category is null or v_category not in ('secu','issues','caisse') then
    return null; -- AFTER trigger : valeur de retour ignorée ; sert au filtrage explicite.
  end if;

  if tg_op = 'INSERT' then
    perform public.log_audit_event(
      p_action        => 'checklist.signoff',
      p_resource_type => 'checklist_completion',
      p_resource_id   => new.id::text,
      p_summary       => format('Checklist %s · %s — %s (signé)', v_phase, v_category, v_label),
      p_venue         => v_venue,
      p_event_id      => new.event_id,
      p_after         => jsonb_build_object(
                           'phase', v_phase,
                           'category', v_category,
                           'item_id', new.item_id,
                           'exploitation_date', new.exploitation_date
                         )
    );
    return null;
  end if;

  if tg_op = 'UPDATE' then
    -- Seule transition accountable : une AUTRE personne ré-endosse le sign-off (done_by change). Les
    -- retouches de note seules (même done_by) sont du bruit → filtrées.
    if new.done_by is distinct from old.done_by then
      perform public.log_audit_event(
        p_action        => 'checklist.signoff',
        p_resource_type => 'checklist_completion',
        p_resource_id   => new.id::text,
        p_summary       => format('Checklist %s · %s — %s (ré-signé)', v_phase, v_category, v_label),
        p_venue         => v_venue,
        p_event_id      => new.event_id,
        p_before        => jsonb_build_object('done_by', old.done_by),
        p_after         => jsonb_build_object(
                             'phase', v_phase,
                             'category', v_category,
                             'item_id', new.item_id,
                             'exploitation_date', new.exploitation_date
                           )
      );
    end if;
    return null;
  end if;

  return null; -- inatteignable (trigger déclaré INSERT OR UPDATE seulement)
end $$;

drop trigger if exists trg_audit_checklist_completion on public.checklist_completions;
create trigger trg_audit_checklist_completion
  after insert or update on public.checklist_completions
  for each row execute function public.audit_checklist_completion_change();

-- ============================================================
-- 2) CAPTATION — dépôt au DAM (INSERT direct 'depose' ou UPDATE → 'depose')
-- ============================================================
create or replace function public.audit_shot_capture_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_venue text;
begin
  -- venue de l'item (le FK garantit son existence). Le `sujet`/`note` (champs libres pouvant nommer une
  -- personne) ne sont jamais lus ici (minimisation).
  select sli.venue into v_venue
    from public.shot_list_items sli
   where sli.id = new.item_id;

  -- FILTRE DE BRUIT : seule la chaîne de garde compte pour la direction = le franchissement du statut
  -- terminal `depose`. Progression intermédiaire (a_capturer → capture) et éditions de note = ignorées.
  --   · INSERT : on journalise si l'état est créé DÉJÀ déposé.
  --   · UPDATE : on journalise la TRANSITION vers 'depose' (old.status != 'depose').
  if new.status <> 'depose' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'depose' then
    return null; -- déjà déposé : re-écriture (note, ré-édition dam_ref) = bruit, pas une nouvelle garde.
  end if;

  perform public.log_audit_event(
    p_action        => 'captation.depose',
    p_resource_type => 'shot_capture',
    p_resource_id   => new.id::text,
    p_summary       => format('Contenu déposé au DAM%s%s',
                              case when v_venue is not null then ' · ' || v_venue else '' end,
                              case when new.dam_ref is not null then ' (réf ' || new.dam_ref || ')' else '' end),
    p_venue         => v_venue,
    p_event_id      => new.event_id,
    p_before        => case when tg_op = 'UPDATE'
                            then jsonb_build_object('status', old.status) else null end,
    p_after         => jsonb_build_object(
                         'status', new.status,
                         'dam_ref', new.dam_ref,
                         'item_id', new.item_id,
                         'exploitation_date', new.exploitation_date
                       )
  );
  return null;
end $$;

drop trigger if exists trg_audit_shot_capture on public.shot_captures;
create trigger trg_audit_shot_capture
  after insert or update on public.shot_captures
  for each row execute function public.audit_shot_capture_change();

-- NB : les MODÈLES (checklist_items, shot_list_items) — composition/désactivation d'items de config par
-- la direction — ne sont PAS audités ici : c'est de la configuration, hors du périmètre « événements de
-- soirée accountables ». Si la direction souhaite tracer la falsification d'une checklist de config
-- (ex. retrait de l'item « sorties de secours »), ce sera un câblage ULTÉRIEUR dédié (décision fondateur).

commit;
