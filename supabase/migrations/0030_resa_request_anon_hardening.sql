-- 0030_resa_request_anon_hardening.sql — DURCISSEMENT DE CORRECTNESS/MINIMISATION de la RPC anon
-- `request_table_reservation_v1` (flux client « demande de résa », chunk 4 PLAN_SALLE_EDEN, migration 0025).
--
-- Origine : revue security-architect ADVERSARIALE de 0025 (session 50, 2026-07-03). Trois findings dont
-- le correctif est un fix de CORRECTNESS / MINIMISATION — additif, non destructif, SANS décision fondateur.
-- Cette migration NE traite PAS l'anti-abus de fond (saturation des tables / pollution par un anon avec des
-- téléphones différents / preuve de propriété du téléphone) : celui-là reste BLOQUANT avant prod et relève
-- d'une DÉCISION FONDATEUR (captcha vs jeton signé par soirée vs rate-limit / OTP) — à NE PAS inventer.
--
-- CE QUE 0030 CORRIGE (les 3 fixes buildables, prouvés au niveau 5 par 0030_..._verification.sql) :
--
--   F4 — CONFUSION SALLE/SOIRÉE (intégrité).  0025 résolvait la soirée par slug SANS lire `events.venue_id`
--        et ne comparait jamais la salle de la table (`venue_tables.venue`) à celle de la soirée. Un client
--        pouvait donc envoyer le slug d'une soirée Terminus + l'id d'une table Eden : la demande était
--        enregistrée avec venue='eden' mais rattachée à l'événement Terminus, incohérence propagée jusqu'à
--        `guest_visits` à l'approbation. → 0030 lit `venue_id` et ajoute la garde `venue_mismatch`.
--        (`venues.id` ∈ {eden,cercle,terminus} = exactement `venue_tables.venue` — mapping 1:1, 0004/0024.)
--
--   F2a — FUITE DE MINIMISATION (PII).  0025 renvoyait le `guest_id` interne à l'appelant ANON (sur `ok`
--        ligne 272 ET sur `already_requested` ligne 255). anon n'a aucun accès direct aux tables : ce
--        `guest_id` ne lui sert à rien fonctionnellement mais constitue un identifiant interne stable
--        corrélable à un téléphone (aide à l'oracle d'énumération). → 0030 renvoie TOUJOURS guest_id=null
--        à l'anon (colonne conservée dans la signature pour ne pas casser le miroir TS ; valeur nulle).
--        Vérifié : aucun appelant TS/TSX ne consomme ce guest_id (la RPC n'est encore montée nulle part).
--
--   F1 — FORGE DE CONSENTEMENT RGPD sur un client EXISTANT (« preuve CNIL » fabricable par un tiers).
--        0025, sur la branche dédup-par-téléphone d'un guest DÉJÀ existant (lignes 236-245), FORÇAIT
--        `majorite_verifiee=true` et ÉLEVAIT `consent_service`/`consent_marketing` (+ texte + horodatage
--        fabriqués par l'appelant) — alors que l'appelant anon n'est PAS prouvé propriétaire du téléphone.
--        Un tiers connaissant le numéro d'un vrai client pouvait ainsi injecter un consentement horodaté au
--        texte de son choix sur la fiche de la victime, même sur la branche `already_requested` (l'UPDATE
--        était écrit puis committé). → 0030 SUPPRIME toute mutation de la fiche d'un guest préexistant via
--        le chemin anon : l'insert de la demande réutilise le `guest_id`/`owner_promoter` déjà LUS (aucun
--        UPDATE de consentement, de majorité ni même d'horodatage). La création d'un NOUVEAU guest
--        (l'appelant fournit alors ses PROPRES données fraîches — c'est le funnel) reste inchangée.
--
-- Ce qui NE change PAS : signature, search_path=public, grants (anon+authenticated), toutes les autres
-- gardes SQL (champs, 18+ L.3342-1, slug publié, table active, capacité si connue, anti double-demande
-- table + client, statut pending, marketing ne conditionne jamais la demande). `decide_table_reservation_v1`
-- n'est pas touchée. Additif : simple CREATE OR REPLACE d'une fonction. LABO uniquement (règles 20 + 40) :
-- NON exécutée sur la base opérationnelle.

begin;

create or replace function public.request_table_reservation_v1(
  p_event_slug text,
  p_venue_table_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone_e164 text,
  p_birthday date,
  p_party_size integer,
  p_slot text,
  p_guest_note text,
  p_consent_service boolean,
  p_consent_service_text text,
  p_consent_marketing boolean,
  p_consent_marketing_text text
) returns table (ok boolean, code text, message text, request_id uuid, guest_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_slug text := nullif(btrim(coalesce(p_event_slug, '')), '');
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone_e164, '')), '');
  v_slot text := nullif(btrim(coalesce(p_slot, '')), '');
  v_note text := nullif(btrim(coalesce(p_guest_note, '')), '');
  v_party integer := p_party_size;
  v_svc boolean := coalesce(p_consent_service, false);
  v_mkt boolean := coalesce(p_consent_marketing, false);
  v_svc_text text := nullif(btrim(coalesce(p_consent_service_text, '')), '');
  v_mkt_text text := nullif(btrim(coalesce(p_consent_marketing_text, '')), '');
  v_now timestamptz := now();
  v_event record;
  v_table record;
  v_guest_id uuid;
  v_owner text;
  v_request_id uuid;
begin
  -- 3.1 Validation des champs (mêmes règles que lib/resaRequest, refaites en SQL) ---------------
  --     NB : guest_id N'EST JAMAIS renvoyé à l'anon (F2a) → toujours null::uuid dans les retours.
  if v_first is null then
    return query select false, 'first_name_required', 'Le prénom est obligatoire.', null::uuid, null::uuid, null::text; return;
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return query select false, 'phone_invalid', 'Numéro de téléphone invalide.', null::uuid, null::uuid, null::text; return;
  end if;
  if p_birthday is null then
    return query select false, 'birthday_required', 'La date de naissance est obligatoire.', null::uuid, null::uuid, null::text; return;
  end if;
  if v_party is null or v_party <= 0 then
    return query select false, 'party_size_invalid', 'Le nombre de personnes est invalide.', null::uuid, null::uuid, null::text; return;
  end if;
  if v_svc and v_svc_text is null then
    return query select false, 'consent_service_text_missing', 'Texte de consentement manquant.', null::uuid, null::uuid, null::text; return;
  end if;
  if v_mkt and v_mkt_text is null then
    return query select false, 'consent_marketing_text_missing', 'Texte de consentement manquant.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.2 Résolution de la soirée par SLUG PUBLIÉ (jamais un event_id brut du client) --------------
  --     F4 : on lit AUSSI venue_id pour garder la cohérence salle table ↔ salle soirée.
  select id, event_date, venue_id into v_event
    from public.events
   where slug = v_slug and status = 'published';
  if not found then
    return query select false, 'unknown_event', 'Soirée introuvable ou non publiée.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.3 Résolution de la table : existante + ACTIVE. Verrou pour sérialiser la garde de dispo. ---
  select id, venue, standing, capacity, active into v_table
    from public.venue_tables
   where id = p_venue_table_id
   for update;
  if not found or not v_table.active then
    return query select false, 'table_unavailable', 'Cette table n''est pas disponible.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.3b F4 — COHÉRENCE SALLE : la table demandée doit appartenir à la SALLE de la soirée résolue.
  --      (venue_tables.venue et events.venue_id partagent le même domaine 'eden'|'cercle'|'terminus'.)
  if v_table.venue is distinct from v_event.venue_id then
    return query select false, 'venue_mismatch', 'Cette table n''appartient pas à la salle de cette soirée.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.4 Capacité : ne bloque QUE si elle est connue (null = à confirmer → aucun blocage inventé). -
  if v_table.capacity is not null and v_party > v_table.capacity then
    return query select false, 'party_over_capacity', 'Le nombre de personnes dépasse la capacité de la table.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.5 Contrôle 18+ à la DATE DE LA SOIRÉE (L.3342-1) — refait en SQL. ---------------------------
  if p_birthday > (v_event.event_date - interval '18 years') then
    return query select false, 'underage', 'Réservation réservée aux personnes majeures.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.6 Table LIBRE au sens couche-demandes : aucune demande active (pending|approved) dessus. ----
  if exists (
    select 1 from public.table_reservation_requests r
     where r.venue_table_id = v_table.id
       and r.exploitation_date = v_event.event_date
       and r.status in ('pending','approved')
  ) then
    return query select false, 'table_taken', 'Cette table fait déjà l''objet d''une demande.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.7 Dédup par téléphone.
  --     F1 — MINIMISATION : sur un guest DÉJÀ existant, le chemin ANON ne mute RIEN de sa fiche
  --     (pas d'élévation de consentement, pas de forçage de majorité, pas même d'horodatage) :
  --     l'appelant anon n'est pas prouvé propriétaire du numéro. On réutilise le guest lu tel quel.
  --     Un NOUVEAU guest = l'appelant fournit ses PROPRES données fraîches (le funnel) → création inchangée.
  select id, owner_promoter into v_guest_id, v_owner from public.guests where phone = v_phone;
  if v_guest_id is null then
    insert into public.guests (
      phone, first_name, last_name, birthday, majorite_verifiee,
      consent_service, consent_service_at, consent_service_text,
      consent_marketing, consent_marketing_at, consent_marketing_text,
      consent_source, owner_promoter
    ) values (
      v_phone, v_first, v_last, p_birthday, true,
      v_svc, case when v_svc then v_now end, v_svc_text,
      v_mkt, case when v_mkt then v_now end, v_mkt_text,
      'reservation', null                                -- self-résa client : pas de promoteur émetteur
    ) returning id into v_guest_id;
    v_owner := null;
  end if;
  -- (guest existant : AUCUN UPDATE — v_guest_id / v_owner déjà lus ci-dessus suffisent à l'insert.)

  -- 3.8 Une seule demande ACTIVE par client par soirée (spec §3). ---------------------------------
  if exists (
    select 1 from public.table_reservation_requests r
     where r.guest_id = v_guest_id
       and r.exploitation_date = v_event.event_date
       and r.status in ('pending','approved')
  ) then
    return query select false, 'already_requested', 'Vous avez déjà une demande en cours pour cette soirée.', null::uuid, null::uuid, null::text; return;
  end if;

  -- 3.9 Insert de la demande (pending). Les index uniques partiels sont le filet anti-concurrence.
  begin
    insert into public.table_reservation_requests (
      venue_table_id, guest_id, event_id, exploitation_date, venue, party_size, standing,
      slot, guest_note, status, owner_promoter
    ) values (
      v_table.id, v_guest_id, v_event.id, v_event.event_date, v_table.venue, v_party, v_table.standing,
      v_slot, v_note, 'pending', v_owner
    ) returning id into v_request_id;
  exception when unique_violation then
    -- Course perdue sur un des index partiels (table déjà prise, ou client déjà en demande).
    return query select false, 'request_conflict', 'Une demande concurrente vient d''être enregistrée.', null::uuid, null::uuid, null::text; return;
  end;

  -- F2a : guest_id renvoyé null à l'anon même sur le SUCCÈS (identifiant interne non exposé).
  return query select true, 'ok', 'Demande envoyée : un responsable la validera.', v_request_id, null::uuid, 'pending'; return;
end;
$$;
revoke all on function public.request_table_reservation_v1(text, uuid, text, text, text, date, integer, text, text, boolean, text, boolean, text) from public;
grant execute on function public.request_table_reservation_v1(text, uuid, text, text, text, date, integer, text, text, boolean, text, boolean, text) to anon, authenticated;

commit;
