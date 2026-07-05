-- 0045_server_scope_real_relation.sql — SUPPRIME LE HARDCODE 'jeremy'/'server' DU SCOPE SERVER.
--
-- CONSTAT (audit 2026-07-05) : le périmètre du rôle `server` reposait sur une liste de noms EN DUR
--   co_is_server_table_scope(assigned_to) := assigned_to in ('', 'jeremy', 'server')
-- 'jeremy' est un nom de développeur légacy, 'server' un username littéral. La règle métier réelle
-- (décision fondateur §7) est : un server voit/agit sur les tables NON ATTRIBUÉES **ou** celles qui lui
-- sont attribuées — donc une RELATION avec l'identité authentifiée, pas des noms figés.
--
-- CORRECTIF (relation réelle, aucun nom en dur) :
--   · `co_is_server_table_scope(p_assigned_to)` ne signifie plus que « NON ATTRIBUÉE » (unassigned) ;
--   · partout où le périmètre server est évalué (policies SELECT/UPDATE, trigger d'écriture, RPC
--     add_expense_v3), on teste désormais : `co_is_server_table_scope(assigned_to)  OR
--     assigned_to = current_staff_username()` = « non attribuée OU la mienne ».
-- Pour le compte partagé actuel (username 'server'), le comportement est IDENTIQUE à avant MOINS
-- 'jeremy' ; et le modèle devient correct si des comptes server individuels sont créés plus tard.
--
-- Ne casse pas le trigger 0009 `co_enforce_club_table_server_scope` (server ne peut toujours pas changer
-- assigned_to ni le regroupement) : il est recréé avec la même relation réelle.
-- add_expense_v3 est recréée avec son corps FINAL (le correctif promoteur de 0044 CONSERVÉ + la relation
-- server réelle) — cette version supersède celle de 0044.
--
-- Additif/idempotent : CREATE OR REPLACE + DROP/CREATE POLICY. Aucune donnée touchée. Réversible.

begin;

-- ============================================================
-- Le scope « server » de base ne signifie plus que : table NON ATTRIBUÉE (unassigned). Le « ou la
-- mienne » est ajouté au point d'appel (car current_staff_username() n'est pas IMMUTABLE).
-- ============================================================
create or replace function public.co_is_server_table_scope(p_assigned_to text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select coalesce(nullif(btrim(p_assigned_to), ''), '') = '';
$function$;

-- ============================================================
-- Policies server — « non attribuée OU la mienne » (relation réelle, plus de nom en dur).
-- ============================================================
drop policy if exists club_tables_select_server on public.club_tables;
create policy club_tables_select_server on public.club_tables
  for select to authenticated
  using (
    current_staff_role() = 'server'
    and event_id = current_active_event_id()
    and (co_is_server_table_scope(assigned_to) or assigned_to = current_staff_username())
  );

drop policy if exists club_tables_update_server on public.club_tables;
create policy club_tables_update_server on public.club_tables
  for update to authenticated
  using (
    current_staff_role() = 'server'
    and event_id = current_active_event_id()
    and (co_is_server_table_scope(assigned_to) or assigned_to = current_staff_username())
  )
  with check (
    current_staff_role() = 'server'
    and event_id = current_active_event_id()
    and (event_date)::date = current_active_event_date()
    and (co_is_server_table_scope(assigned_to) or assigned_to = current_staff_username())
  );

-- ============================================================
-- Trigger d'écriture server (0009) — même relation réelle ; server ne peut toujours ni sortir de son
-- périmètre, ni changer assigned_to, ni regrouper.
-- ============================================================
create or replace function public.co_enforce_club_table_server_scope()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if public.current_staff_role() = 'server' then
    if not (public.co_is_server_table_scope(old.assigned_to) or old.assigned_to = public.current_staff_username())
       or not (public.co_is_server_table_scope(new.assigned_to) or new.assigned_to = public.current_staff_username()) then
      raise exception 'server cannot update a table outside server scope';
    end if;
    if coalesce(old.assigned_to, '') is distinct from coalesce(new.assigned_to, '') then
      raise exception 'server cannot change assigned_to';
    end if;
    if coalesce(old.linked_group_id, '') is distinct from coalesce(new.linked_group_id, '') then
      raise exception 'server cannot change table grouping';
    end if;
    if coalesce(old.linked_tables, array[]::text[]) is distinct from coalesce(new.linked_tables, array[]::text[]) then
      raise exception 'server cannot change table grouping';
    end if;
  end if;
  return new;
end;
$function$;

-- ============================================================
-- add_expense_v3 — corps FINAL : promoteur = SES tables (0044) + server = non attribuée OU la sienne.
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
       or (v_role = 'promoter' and ct.assigned_to = v_author)
       or (v_role = 'server' and (public.co_is_server_table_scope(ct.assigned_to) or ct.assigned_to = v_author))
     )
   returning ct.id into v_table_id;

  if v_table_id is null then
    return query select false, 'table_not_found_or_forbidden', 'Table introuvable ou action non autorisee.', p_table_id, null::jsonb;
    return;
  end if;

  return query select true, 'ok', 'Depense ajoutee.', v_table_id, v_expense;
end;
$function$;

commit;
