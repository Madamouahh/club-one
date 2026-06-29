-- 0007_atomic_operations_hardening.sql - durcissement depenses atomiques
--
-- Ne modifie pas la signature historique public.add_expense(text,text,numeric,text)
-- introduite en 0005. Cette migration ajoute une nouvelle RPC structuree pour le
-- front : public.add_expense_v2.
--
-- Borne metier documentee : une depense unitaire superieure a 100000 EUR est
-- consideree aberrante et refusee pour eviter une faute de frappe destructive.

create or replace function public.add_expense_v2(
  p_table_id text,
  p_label text,
  p_amount numeric,
  p_date_key text
) returns table (
  ok boolean,
  code text,
  message text,
  table_id text,
  expense jsonb
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expense jsonb;
  v_table_id text;
  v_date date;
  v_author text;
  v_role text;
begin
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

  if coalesce(p_date_key, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    return query select false, 'invalid_date', 'Date de soiree invalide.', p_table_id, null::jsonb;
    return;
  end if;

  begin
    v_date := p_date_key::date;
  exception when others then
    return query select false, 'invalid_date', 'Date de soiree invalide.', p_table_id, null::jsonb;
    return;
  end;

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
    'dateKey', v_date::text,
    'createdBy', v_author
  );

  update public.club_tables
     set expenses = coalesce(expenses, '[]'::jsonb) || v_expense,
         status = case when status = 'free' then 'arrived' else status end,
         updated_at = now()
   where id = btrim(p_table_id)
   returning id into v_table_id;

  if v_table_id is null then
    return query select false, 'table_not_found_or_forbidden', 'Table introuvable ou action non autorisee.', p_table_id, null::jsonb;
    return;
  end if;

  return query select true, 'ok', 'Depense ajoutee.', v_table_id, v_expense;
end;
$$;

revoke all on function public.add_expense_v2(text, text, numeric, text) from public;
grant execute on function public.add_expense_v2(text, text, numeric, text) to authenticated;
