-- 0005_atomic_expense.sql — Lot 2 : ajout de dépense ATOMIQUE (anti-perte concurrente)
-- PROBLÈME : aujourd'hui saveTable réécrit TOUT le tableau `expenses` (toDbRow) → si deux
-- serveurs ajoutent une dépense à la même table en même temps, la dernière écriture écrase
-- l'autre (perte de CA). C'est le risque n°1 de fiabilité du cahier des charges.
--
-- SOLUTION : append jsonb côté base, en une seule UPDATE (atomique au niveau ligne).
-- SECURITY INVOKER (par défaut) => la RLS de club_tables s'applique (seuls admin/manager/
-- server/promoter écrivent). PRÉPARÉ — à brancher dans l'app (remplacer la réécriture par
-- un appel `supabase.rpc('add_expense', {...})`) dans une fenêtre de test.
--
-- ⚠️ Prérequis : la colonne club_tables.expenses doit être de type JSONB (et non json).
--    Vérifier :  select data_type from information_schema.columns
--                where table_name='club_tables' and column_name='expenses';
--    Si 'json', migrer :  alter table public.club_tables alter column expenses type jsonb using expenses::jsonb;

create or replace function public.add_expense(
  p_table_id text, p_label text, p_amount numeric, p_date_key text
) returns void
language sql
set search_path = public
as $$
  update public.club_tables
     set expenses = coalesce(expenses, '[]'::jsonb) || jsonb_build_object(
           'id', gen_random_uuid()::text,
           'label', p_label,
           'amount', p_amount,
           'createdAt', to_char(now(), 'HH24:MI'),
           'dateKey', p_date_key
         ),
         updated_at = now()
   where id = p_table_id;
$$;
revoke all on function public.add_expense(text, text, numeric, text) from public;
grant execute on function public.add_expense(text, text, numeric, text) to authenticated;
