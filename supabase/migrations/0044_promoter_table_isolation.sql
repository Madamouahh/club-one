-- 0044_promoter_table_isolation.sql — ISOLATION PROMOTEUR DE BOUT EN BOUT (club_tables).
--
-- DÉCISION FONDATEUR (définitive) : un PROMOTEUR ne voit/gère QUE les tables qu'il a ouvertes ou qui
-- lui sont attribuées (`assigned_to = son username`), et RIEN des autres promoteurs — ni lecture, ni
-- écriture, ni dépense, ni realtime, ni accès par UUID connu, ni contournement RPC.
--
-- CONSTAT (audit 2026-07-05, prouvé live labo) — le cantonnement promoteur était UNIQUEMENT visuel
-- (front), la BASE laissait tout passer :
--   1. `club_tables_select_ops`  : SELECT admin/manager/PROMOTER, sans filtre `assigned_to` → un
--      promoteur LISAIT les 18 tables (clients, téléphones, dépenses) de la soirée.
--   2. `club_tables_update_admin_manager_promoter` : UPDATE idem, sans USING/WITH CHECK sur
--      `assigned_to` → un promoteur pouvait MODIFIER n'importe quelle table, la VOLER (reprendre) ou
--      la DONNER (changer assigned_to), voire la déplacer d'événement.
--   3. `club_tables_insert_admin_manager_promoter` : INSERT sans contrainte `assigned_to = soi` → un
--      promoteur pouvait CRÉER une table au nom d'un autre.
--   4. `add_expense_v3` (SECURITY DEFINER, bypasse la RLS) : la clause d'autorisation acceptait
--      `v_role in ('admin','manager','promoter')` pour TOUTE table → un promoteur ajoutait une dépense
--      (gonflait le CA) sur la table d'un autre. **Trou le plus grave** (SECDEF = pas de RLS).
--   5. `events_write` (FOR ALL) incluait 'promoter' → un promoteur pouvait ÉCRIRE les événements
--      (créer/renommer/supprimer une soirée). Les événements sont direction-only (matrice fondateur).
--
-- MODÈLE DE PROPRIÉTÉ retenu (source de vérité UNIQUE, serveur, non usurpable) : `assigned_to` (username)
-- comparé à `current_staff_username()` (= `staff_users.username WHERE auth_id = auth.uid()`, SECDEF).
-- La colonne `assigned_to` est du texte librement posé par le client, MAIS le WITH CHECK ci-dessous la
-- rend fiable POUR LE PROMOTEUR : un promoteur ne peut jamais écrire une ligne dont `assigned_to` n'est
-- pas son propre username → il ne peut ni créer, ni reprendre, ni donner une table étrangère. La
-- direction (admin/manager) conserve le droit d'ATTRIBUER (poser n'importe quel username) — c'est ainsi
-- qu'un manager assigne une table à un promoteur. C'est EXACTEMENT le patron déjà éprouvé sur guests /
-- promoter_contacts / promoter_guest_entries / invite_links (owner = current_staff_username()).
--
-- L'isolation realtime SUIT automatiquement : Supabase Realtime applique la RLS SELECT de l'abonné aux
-- événements `postgres_changes` de club_tables (déjà publiée en 0042) → un promoteur ne reçoit QUE les
-- changements des lignes qu'il peut lire. Le filtrage n'est donc PAS au navigateur, il est au serveur.
--
-- Additif/idempotent : DROP POLICY IF EXISTS + CREATE POLICY ; CREATE OR REPLACE de add_expense_v3
-- (corps fidèle à l'existant, une seule branche d'autorisation modifiée). Aucune table/donnée touchée,
-- aucun DROP destructif. Réversible (repolicy). Le trigger server-scope 0009 (spécifique 'server')
-- est INCHANGÉ ; la relation server sans hardcode est traitée à part en 0045.

begin;

-- ============================================================
-- club_tables — SELECT : direction voit tout ; promoteur voit SES tables seulement.
-- ============================================================
drop policy if exists club_tables_select_ops on public.club_tables;
create policy club_tables_select_ops on public.club_tables
  for select to authenticated
  using (
    current_staff_role() = any (array['admin','manager'])
    and event_id = current_active_event_id()
  );

drop policy if exists club_tables_select_promoter_own on public.club_tables;
create policy club_tables_select_promoter_own on public.club_tables
  for select to authenticated
  using (
    current_staff_role() = 'promoter'
    and event_id = current_active_event_id()
    and assigned_to = current_staff_username()
  );

-- ============================================================
-- club_tables — UPDATE : direction tout ; promoteur SES tables, sans pouvoir voler/donner/déplacer.
-- ============================================================
drop policy if exists club_tables_update_admin_manager_promoter on public.club_tables;
drop policy if exists club_tables_update_admin_manager on public.club_tables;
create policy club_tables_update_admin_manager on public.club_tables
  for update to authenticated
  using (
    current_staff_role() = any (array['admin','manager'])
    and event_id = current_active_event_id()
  )
  with check (
    current_staff_role() = any (array['admin','manager'])
    and event_id = current_active_event_id()
    and (event_date)::date = current_active_event_date()
  );

drop policy if exists club_tables_update_promoter_own on public.club_tables;
create policy club_tables_update_promoter_own on public.club_tables
  for update to authenticated
  using (
    current_staff_role() = 'promoter'
    and event_id = current_active_event_id()
    and assigned_to = current_staff_username()          -- ne peut cibler QUE ses tables
  )
  with check (
    current_staff_role() = 'promoter'
    and event_id = current_active_event_id()
    and (event_date)::date = current_active_event_date()
    and assigned_to = current_staff_username()           -- la ligne RESTE la sienne (pas de don/vol/déplacement)
  );

-- ============================================================
-- club_tables — INSERT : direction (attribue à qui elle veut) ; promoteur crée UNIQUEMENT à son nom.
-- ============================================================
drop policy if exists club_tables_insert_admin_manager_promoter on public.club_tables;
drop policy if exists club_tables_insert_admin_manager on public.club_tables;
create policy club_tables_insert_admin_manager on public.club_tables
  for insert to authenticated
  with check (
    current_staff_role() = any (array['admin','manager'])
    and event_id = current_active_event_id()
    and (event_date)::date = current_active_event_date()
  );

drop policy if exists club_tables_insert_promoter_own on public.club_tables;
create policy club_tables_insert_promoter_own on public.club_tables
  for insert to authenticated
  with check (
    current_staff_role() = 'promoter'
    and event_id = current_active_event_id()
    and (event_date)::date = current_active_event_date()
    and assigned_to = current_staff_username()            -- ne peut créer qu'une table à son nom
  );

-- ============================================================
-- add_expense_v3 (SECURITY DEFINER) — ferme le trou : un promoteur n'ajoute une dépense que sur SES
-- tables. Corps fidèle à l'existant ; SEULE la branche d'autorisation du UPDATE change.
-- ============================================================
create or replace function public.add_expense_v3(p_table_id text, p_label text, p_amount numeric, p_date_key text)
 returns table(ok boolean, code text, message text, table_id text, expense jsonb)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_expense jsonb;
  v_table_id text;
  v_date date;
  v_author text;
  v_role text;
  v_active_event_id uuid;
  v_active_event_date date;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', p_table_id, null::jsonb;
    return;
  end if;

  if nullif(btrim(coalesce(p_table_id, '')), '') is null then
    return query select false, 'invalid_table_id', 'Table invalide.', null::text, null::jsonb;
    return;
  end if;

  if p_amount is null or p_amount <= 0 then
    return query select false, 'invalid_amount', 'Montant invalide.', p_table_id, null::jsonb;
    return;
  end if;

  if p_amount > 100000 then
    return query select false, 'amount_too_high', 'Montant trop eleve.', p_table_id, null::jsonb;
    return;
  end if;

  begin
    v_date := p_date_key::date;
  exception when others then
    return query select false, 'invalid_date', 'Date de soiree invalide.', p_table_id, null::jsonb;
    return;
  end;

  v_active_event_id := public.current_active_event_id();
  v_active_event_date := public.current_active_event_date();
  if v_active_event_id is null or v_active_event_date is null then
    return query select false, 'missing_active_event', 'Aucun evenement actif.', p_table_id, null::jsonb;
    return;
  end if;

  if v_date is distinct from v_active_event_date then
    return query select false, 'wrong_event_date', 'Date de soiree invalide.', p_table_id, null::jsonb;
    return;
  end if;

  v_author := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_author is null or v_role not in ('admin','manager','server','promoter') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', p_table_id, null::jsonb;
    return;
  end if;

  v_expense := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'label', coalesce(nullif(btrim(p_label), ''), 'Depense libre'),
    'amount', p_amount,
    'createdAt', to_char(now(), 'HH24:MI'),
    'dateKey', v_active_event_date::text,
    'eventId', v_active_event_id::text,
    'createdBy', v_author
  );

  update public.club_tables ct
     set expenses = coalesce(ct.expenses, '[]'::jsonb) || v_expense,
         status = case when ct.status = 'free' then 'arrived' else ct.status end,
         updated_at = now()
   where ct.id = btrim(p_table_id)
     and ct.event_id = v_active_event_id
     and ct.event_date::date = v_active_event_date
     and (
       v_role in ('admin','manager')
       or (v_role = 'promoter' and ct.assigned_to = v_author)                 -- ISOLATION : SES tables seulement
       or (v_role = 'server' and public.co_is_server_table_scope(ct.assigned_to))
     )
   returning ct.id into v_table_id;

  if v_table_id is null then
    return query select false, 'table_not_found_or_forbidden', 'Table introuvable ou action non autorisee.', p_table_id, null::jsonb;
    return;
  end if;

  return query select true, 'ok', 'Depense ajoutee.', v_table_id, v_expense;
end;
$function$;

-- ============================================================
-- events — retire 'promoter' du droit d'écriture (matrice fondateur : événements = direction).
-- Le promoteur conserve la LECTURE via events_read / events_select_staff (current_staff_role() not null).
-- ============================================================
drop policy if exists events_write on public.events;
create policy events_write on public.events
  for all to authenticated
  using (current_staff_role() = any (array['admin','manager']))
  with check (current_staff_role() = any (array['admin','manager']));

commit;
