-- 0016_crm_no_show_cloture.sql — RÈGLEMENT DES PRÉSENCES À LA CLÔTURE (spec MODULE_CRM_CLIENTS_VIP.md §V0).
--
-- Chunk (a) du funnel CRM après le scan à la porte (0015). Au moment où la direction clôture la soirée
-- (close_club_event_v2, définie en 0008), toute invitation restée EN ATTENTE de présence — inscrite
-- (« booked ») ou confirmée J-1 (« confirmed ») mais JAMAIS scannée à la porte — doit devenir un
-- no-show. Le no-show alimente le taux de no-show du scoring (vue guest_scores : no_shows_total /
-- visits_resolved_total), qui sert ensuite à segmenter (fiable vs. lapin) sans jamais rien inventer.
--
-- Additif STRICT au-dessus de 0008/0013/0014/0015. AUCUN seed, AUCUNE donnée fabriquée : on ne fait que
-- RÉSOUDRE des lignes déjà présentes (créées par le funnel). Base vide -> 0 ligne touchée.
--
-- MÉTHODE (règle 20-security-supabase, atomicité) : on re-déclare close_club_event_v2 en entier via
-- « create or replace » (0008 n'est pas réécrite) en INSÉRANT le règlement des présences DANS la même
-- transaction que l'archivage et le reset des tables. Un seul « create or replace » -> la clôture reste
-- une opération atomique unique (règle 50 : le front n'enchaîne jamais plusieurs étapes manuelles).
--
-- SÉCURITÉ : signature, security definer, search_path, gardes de rôle (admin/manager), grants =
-- STRICTEMENT IDENTIQUES à 0008. Le seul changement fonctionnel est l'ajout de deux UPDATE bornés à la
-- soirée qui se clôture (event_id = v_event_id). Aucune règle métier ne fait confiance au client.
--
-- Deux mutations ajoutées, avant le reset des tables :
--   1) guest_visits  booked/confirmed -> no_show   (présence en attente jamais constatée = lapin)
--   2) guest_passes  issued           -> expired    (QR d'entrée délivré mais jamais scanné ; l'événement
--      est archivé, le scan à la porte 0015 refuserait déjà ce QR — garde wrong_event — on ne laisse
--      donc pas de pass « issued » orphelin après clôture). Nettoyage de cohérence, aucune donnée créée.
--
-- Preuve : validation SQL statique (niveau 3) ici. Le test réel (niveau 4) est exécuté sur le LABO
-- isolé (guest_visits/guest_passes peuplés, clôture, vérification des statuts, ROLLBACK), pas en prod.

begin;

create or replace function public.close_club_event_v2()
returns table (ok boolean, code text, message text, event_id uuid, event_date date)
language plpgsql
security definer
set search_path = public
as $$
-- CORRECTIF 0016 (2e bug latent de 0008, même classe que celui attrapé en 0014/0015) : les colonnes
-- de SORTIE event_id/event_date du RETURNS TABLE rendaient « where event_id = v_event_id » AMBIGU
-- (variable OUT vs colonne de table) → la fonction plantait aussi pour cette raison. use_column force
-- toute référence nue (event_id, event_date, status…) à désigner la COLONNE de table ; les valeurs
-- retournées passent par les variables explicites v_event_id / v_event_date (jamais ambiguës).
#variable_conflict use_column
declare
  v_role text;
  v_username text;
  v_event_id uuid;
  v_event_date date;
  v_table_count int;
  v_revenue numeric;
  v_entries int;
  v_exits int;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid, null::date;
    return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::uuid, null::date;
    return;
  end if;

  -- CORRECTIF 0016 (bug latent de 0008, révélé par la 1re exécution RÉELLE sur le LABO) : le SELECT
  -- d'origine appliquait « for update » à un LEFT JOIN club_runtime_state × events. PostgreSQL refuse
  -- (« FOR UPDATE cannot be applied to the nullable side of an outer join ») → la fonction plantait à
  -- CHAQUE clôture. La lecture statique (niveau 3) ne pouvait pas le voir. Correctif à sémantique
  -- IDENTIQUE : on verrouille le singleton club_runtime_state (le vrai garde de concurrence), puis on
  -- lit event_date séparément (sans FOR UPDATE sur la table nullable). Si active_event_id est null, la
  -- 2e lecture ne renvoie rien → v_event_date reste null → même garde « missing_active_event » qu'avant.
  select crs.active_event_id
    into v_event_id
    from public.club_runtime_state crs
   where crs.id is true
   for update;

  select e.event_date
    into v_event_date
    from public.events e
   where e.id = v_event_id;

  if v_event_id is null or v_event_date is null then
    return query select false, 'missing_active_event', 'Aucun evenement actif.', null::uuid, null::date;
    return;
  end if;

  select count(*) into v_table_count
    from public.club_tables
   where event_id = v_event_id
     and event_date::date = v_event_date;
  if v_table_count <> 18 then
    return query select false, 'invalid_table_count', 'Les 18 tables actives sont requises.', v_event_id, v_event_date;
    return;
  end if;

  if exists (select 1 from public.event_archives ea where ea.event_id = v_event_id) then
    return query select false, 'already_archived', 'Cet evenement est deja archive.', v_event_id, v_event_date;
    return;
  end if;

  select coalesce(sum(coalesce((expense->>'amount')::numeric, 0)), 0)
    into v_revenue
    from public.club_tables ct
    cross join lateral jsonb_array_elements(coalesce(ct.expenses, '[]'::jsonb)) expense
   where ct.event_id = v_event_id;

  select count(*) filter (where type = 'entry'),
         count(*) filter (where type = 'exit')
    into v_entries, v_exits
    from public.entry_logs
   where event_id = v_event_id;

  insert into public.event_archives (
    event_date,
    event_id,
    closed_by,
    total_revenue,
    total_entries,
    total_exits,
    tables_snapshot,
    entry_logs_snapshot
  )
  values (
    v_event_date,
    v_event_id,
    v_username,
    coalesce(v_revenue, 0),
    coalesce(v_entries, 0),
    coalesce(v_exits, 0),
    (select coalesce(jsonb_agg(to_jsonb(ct) order by ct.id), '[]'::jsonb) from public.club_tables ct where ct.event_id = v_event_id),
    (select coalesce(jsonb_agg(to_jsonb(el) order by el.created_at), '[]'::jsonb) from public.entry_logs el where el.event_id = v_event_id)
  );

  update public.events
     set status = 'archived',
         updated_at = now()
   where id = v_event_id;

  -- ============================================================================
  -- AJOUT 0016 — Règlement des présences du funnel CRM, atomique dans la clôture.
  -- Borné à la soirée qui se clôture (event_id = v_event_id). Base vide -> 0 ligne.
  -- ============================================================================

  -- 1) Toute invitation encore EN ATTENTE de présence (booked = inscrite, confirmed = confirmée J-1)
  --    jamais scannée à la porte devient un no-show. On NE touche jamais un « seated » (présence
  --    constatée au scan 0015) ni un « cancelled » (désinscription) : miroir de resolveVisitStatusAtClose.
  update public.guest_visits
     set status = 'no_show',
         updated_at = now()
   where event_id = v_event_id
     and status in ('booked','confirmed');

  -- 2) Cohérence des pass d'entrée : un QR délivré mais jamais scanné (« issued ») expire à la clôture
  --    (l'événement est archivé, le scan à la porte refuserait déjà ce QR). On ne touche pas un pass
  --    « scanned » / « expired » / « cancelled » : miroir de resolvePassStatusAtClose.
  update public.guest_passes
     set status = 'expired'
   where event_id = v_event_id
     and status = 'issued';

  update public.club_tables
     set event_id = null,
         event_date = null,
         status = 'free',
         client = '',
         phone = '',
         people = '',
         notes = '',
         booker = '',
         assigned_to = '',
         linked_group_id = '',
         linked_tables = array[]::text[],
         expenses = '[]'::jsonb,
         updated_at = now()
   where event_id = v_event_id;

  update public.club_runtime_state
     set active_event_id = null,
         last_closed_event_id = v_event_id,
         updated_at = now(),
         updated_by = v_username
   where id is true;

  return query select true, 'ok', 'Soiree cloturee et archivee.', v_event_id, v_event_date;
end;
$$;
revoke all on function public.close_club_event_v2() from public;
grant execute on function public.close_club_event_v2() to authenticated;

commit;
