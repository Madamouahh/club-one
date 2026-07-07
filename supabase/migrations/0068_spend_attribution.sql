-- 0068_spend_attribution.sql — CHEMIN D'ATTRIBUTION DE LA DÉPENSE PAR CLIENT (Vague 6, Squad D4).
--
-- CONSTAT (audit D4) : la colonne guest_visits.spend_attributed (socle 0013, ligne 74) existe et la vue
-- 360 (guest_360_v1, 0059) l'agrège honnêtement — MAIS aucun chemin de SAISIE ne l'écrit jamais. Résultat :
-- spend_attributed reste toujours NULL → guest_360_v1.spend_is_known = false → « dépense non identifiée »
-- partout, l'historique des dépenses par client est structurellement vide. Ce squad livre le chaînon
-- manquant : une RPC qui relie une dépense réelle d'une soirée à un client, écrite par la direction.
--
-- PRINCIPE D'HONNÊTETÉ (hérité de 0013/0059) : rien n'est fabriqué. La RPC n'invente NI le montant (fourni
-- explicitement par un humain de la direction, jamais deviné) NI l'univers (résolu depuis une visite déjà
-- saisie OU depuis l'événement de la soirée ; ambigu → refus explicite plutôt qu'un choix au hasard).
--
-- STATUT « seated » : la 360 (0059) ne compte la dépense que sur les visites `status='seated'`
-- (filter … where v.status='seated'). Attribuer une dépense = le client était présent et a consommé :
-- la RPC force donc status='seated' sur la visite concernée. C'est CE point qui fait basculer
-- guest_360_v1.spend_is_known à true et spend_attributed_total de NULL à une valeur réelle.
--
-- SÉCURITÉ : SECURITY DEFINER + search_path=public figé (règle 20). Garde direction FAIL-CLOSED
-- (current_staff_role() renvoie NULL hors staff → on refuse role NULL ET role hors admin/manager).
-- La RLS de guest_visits (0013) reste active pour les accès directs ; la RPC contourne la RLS par
-- construction (DEFINER) mais REFAIT la garde de rôle en SQL (aucune confiance au client).
-- Aucune table nouvelle → aucun grant anon à révoquer ici ; EXECUTE réservé à authenticated.
-- Idempotent (create or replace) / réversible (drop function).

begin;

-- ============================================================
-- attribute_guest_spend_v1 — attribue un montant (en CENTIMES) à un client pour une soirée (date).
--   · p_guest_id     : le client (doit exister).
--   · p_event_date   : la date d'exploitation de la soirée (exploitation_date), passée ou du jour.
--   · p_amount_cents : le montant réellement dépensé, EN CENTIMES (> 0). Converti en euros pour
--                      guest_visits.spend_attributed numeric(10,2) : spend = p_amount_cents / 100.
--
-- Comportement (atomique, une seule transaction) :
--   1. gardes : direction, montant > 0, date non future, client existant ;
--   2. résolution de l'univers (guest_visits.univers est NOT NULL et fait partie de la clé d'unicité
--      (guest_id, exploitation_date, univers), or la signature n'en reçoit pas — on le RÉSOUT honnêtement) :
--        a. si une (et une seule) visite existe déjà pour (client, date) → on réutilise SON univers
--           (mise à jour de la dépense sur la visite existante) ;
--        b. si plusieurs visites (univers différents) ce jour-là → AMBIGU → exception (on ne devine pas) ;
--        c. sinon (aucune visite) → on dérive l'univers de l'événement de la soirée (events.event_date) :
--           un seul univers ce jour → on l'utilise ; zéro → refus (rien à quoi rattacher) ;
--           plusieurs → AMBIGU → exception ;
--   3. upsert idempotent sur (guest_id, exploitation_date, univers) : insertion ou mise à jour de
--      spend_attributed, status forcé à 'seated'. Retourne le montant en euros réellement enregistré.
-- ============================================================
create or replace function public.attribute_guest_spend_v1(
  p_guest_id uuid,
  p_event_date date,
  p_amount_cents int
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text := public.current_staff_role();
  v_username text := public.current_staff_username();
  v_spend    numeric(10,2);
  v_univers  text;
  v_event_id uuid;
  v_existing int;
  v_venues   int;
begin
  -- 1) Garde direction FAIL-CLOSED (role NULL = anon/non-staff → refus).
  if v_role is null or v_role not in ('admin','manager') then
    raise exception 'attribute_guest_spend_v1: réservé à la direction (admin/manager)'
      using errcode = '42501';
  end if;

  -- 1) Garde montant : présent et strictement positif (jamais un 0 « inventé », jamais un négatif).
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'attribute_guest_spend_v1: montant (centimes) invalide, attendu > 0 (reçu %)', p_amount_cents
      using errcode = '22023';
  end if;

  -- 1) Garde date : présente et non future (on n'attribue pas une dépense à une soirée qui n'a pas eu lieu).
  if p_event_date is null then
    raise exception 'attribute_guest_spend_v1: date de soirée requise' using errcode = '22023';
  end if;
  if p_event_date > current_date then
    raise exception 'attribute_guest_spend_v1: date future refusée (%), aucune dépense à venir', p_event_date
      using errcode = '22023';
  end if;

  -- 1) Garde client : doit exister (aucune ligne fabriquée pour un client inconnu).
  perform 1 from public.guests g where g.id = p_guest_id;
  if not found then
    raise exception 'attribute_guest_spend_v1: client % introuvable', p_guest_id
      using errcode = 'P0002';
  end if;

  v_spend := (p_amount_cents::numeric) / 100.0;  -- centimes → euros (numeric(10,2), pas d'overflow depuis int4)

  -- 2) Résolution de l'univers, sans jamais le deviner.
  select count(*) into v_existing
    from public.guest_visits v
   where v.guest_id = p_guest_id and v.exploitation_date = p_event_date;

  if v_existing = 1 then
    -- 2a) une seule visite ce jour : on prend SON univers (mise à jour de la dépense sur cette visite).
    select v.univers, v.event_id into v_univers, v_event_id
      from public.guest_visits v
     where v.guest_id = p_guest_id and v.exploitation_date = p_event_date;
  elsif v_existing > 1 then
    -- 2b) plusieurs univers ce jour : ambigu → refus explicite (on ne choisit pas au hasard).
    raise exception 'attribute_guest_spend_v1: plusieurs visites (univers) pour ce client le % — univers ambigu, attribution refusée', p_event_date
      using errcode = '22023';
  else
    -- 2c) aucune visite : on dérive l'univers de l'événement de la soirée.
    select count(distinct e.venue_id) into v_venues
      from public.events e where e.event_date = p_event_date;
    if v_venues = 0 then
      raise exception 'attribute_guest_spend_v1: aucune visite ni événement le % — rien à quoi rattacher la dépense', p_event_date
        using errcode = '22023';
    elsif v_venues > 1 then
      raise exception 'attribute_guest_spend_v1: plusieurs univers programmés le % — univers ambigu, attribution refusée', p_event_date
        using errcode = '22023';
    else
      select e.venue_id, e.id into v_univers, v_event_id
        from public.events e where e.event_date = p_event_date
        order by e.created_at nulls last, e.id
        limit 1;
    end if;
  end if;

  -- 3) Upsert atomique idempotent. status='seated' → la dépense devient visible dans guest_360_v1
  --    (qui n'agrège que les visites seated). On ne réécrit pas event_id sur une visite existante.
  insert into public.guest_visits
    (guest_id, event_id, exploitation_date, univers, status, spend_attributed, created_by)
  values
    (p_guest_id, v_event_id, p_event_date, v_univers, 'seated', v_spend, v_username)
  on conflict (guest_id, exploitation_date, univers) do update
    set spend_attributed = excluded.spend_attributed,
        status           = 'seated',
        updated_at        = now();

  return v_spend;
end;
$$;

revoke all on function public.attribute_guest_spend_v1(uuid, date, int) from public;
grant execute on function public.attribute_guest_spend_v1(uuid, date, int) to authenticated;

commit;
