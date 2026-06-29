\set ON_ERROR_STOP on
\pset pager off

\echo '=== Vérifications structurelles ==='

do $verify$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'club_tables'
      and column_name = 'expenses'
      and data_type = 'jsonb'
  ) then
    raise exception 'club_tables.expenses doit être de type jsonb';
  end if;

  if to_regprocedure(
    'public.add_expense_v2(text,text,numeric,text)'
  ) is null then
    raise exception 'fonction add_expense_v2 absente';
  end if;

  if to_regprocedure(
    'public.check_in_invitation(text,text)'
  ) is null then
    raise exception 'fonction check_in_invitation absente';
  end if;

  if exists (
    select qr_token
    from public.promoter_guest_entries
    where qr_token is not null
      and btrim(qr_token) <> ''
    group by qr_token
    having count(*) > 1
  ) then
    raise exception 'des QR tokens dupliqués existent';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_attribute a
      on a.attrelid = i.indrelid
     and a.attnum = any(i.indkey)
    where i.indrelid =
      'public.promoter_guest_entries'::regclass
      and i.indisunique
      and a.attname = 'qr_token'
  ) then
    raise exception 'protection UNIQUE absente sur qr_token';
  end if;

  if not exists (
    select 1 from public.club_tables
  ) then
    raise exception 'aucune table disponible pour le test';
  end if;

  if not exists (
    select 1
    from public.staff_users
    where role = 'admin'
      and auth_id is not null
  ) then
    raise exception 'aucun compte admin lié à Auth';
  end if;

  if not exists (
    select 1
    from public.staff_users
    where role = 'promoter'
      and auth_id is not null
  ) then
    raise exception 'aucun compte promoter lié à Auth';
  end if;
end
$verify$;

select id::text as test_table_id
from public.club_tables
order by id
limit 1
\gset

select auth_id::text as admin_auth_id
from public.staff_users
where role = 'admin'
  and auth_id is not null
order by username
limit 1
\gset

select auth_id::text as promoter_auth_id
from public.staff_users
where role = 'promoter'
  and auth_id is not null
order by username
limit 1
\gset

\echo '=== Début des tests transactionnels ==='

begin;

set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  :'admin_auth_id',
  true
);

select set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', :'admin_auth_id',
    'role', 'authenticated'
  )::text,
  true
);

select set_config(
  'clubone.test_table_id',
  :'test_table_id',
  true
);

select set_config(
  'clubone.admin_auth_id',
  :'admin_auth_id',
  true
);

select set_config(
  'clubone.promoter_auth_id',
  :'promoter_auth_id',
  true
);

do $verify$
declare
  v_role text;
begin
  select public.current_staff_role()
  into v_role;

  if v_role <> 'admin' then
    raise exception
      'le compte de test devrait être admin, rôle obtenu : %',
      coalesce(v_role, '<null>');
  end if;

  raise notice 'contexte Auth admin : ok';
end
$verify$;

select set_config(
  'clubone.before_expenses',
  coalesce(jsonb_array_length(expenses), 0)::text,
  true
)
from public.club_tables
where id = :'test_table_id';

\echo '=== Test unicité QR ==='

do $verify$
declare
  v_token text :=
    '__VERIFY_DUPLICATE_' || txid_current()::text || '__';
begin
  insert into public.promoter_guest_entries (
    event_date,
    promoter_username,
    guest_name,
    qr_token
  )
  values (
    current_date::text,
    'mathias',
    'Verify Duplicate A',
    v_token
  );

  begin
    insert into public.promoter_guest_entries (
      event_date,
      promoter_username,
      guest_name,
      qr_token
    )
    values (
      current_date::text,
      'mathias',
      'Verify Duplicate B',
      v_token
    );

    raise exception 'un QR token dupliqué a été accepté';
  exception
    when unique_violation then
      raise notice 'QR dupliqué refusé : ok';
  end;
end
$verify$;

\echo '=== Tests dépenses atomiques ==='

do $verify$
declare
  r_first record;
  r_second record;
  r_zero record;
  r_high record;
  r_unknown record;

  v_table text :=
    current_setting('clubone.test_table_id');

  v_before integer :=
    current_setting('clubone.before_expenses')::integer;

  v_after integer;
begin
  select *
  into r_first
  from public.add_expense_v2(
    v_table,
    '__VERIFY_EXPENSE_A__',
    11,
    current_date::text
  );

  if not coalesce(r_first.ok, false) then
    raise exception
      'première dépense refusée : % / %',
      r_first.code,
      r_first.message;
  end if;

  select *
  into r_second
  from public.add_expense_v2(
    v_table,
    '__VERIFY_EXPENSE_B__',
    22,
    current_date::text
  );

  if not coalesce(r_second.ok, false) then
    raise exception
      'seconde dépense refusée : % / %',
      r_second.code,
      r_second.message;
  end if;

  select coalesce(jsonb_array_length(expenses), 0)
  into v_after
  from public.club_tables
  where id = v_table;

  if v_after <> v_before + 2 then
    raise exception
      'perte de dépense détectée : avant %, après %',
      v_before,
      v_after;
  end if;

  select *
  into r_zero
  from public.add_expense_v2(
    v_table,
    '__VERIFY_ZERO__',
    0,
    current_date::text
  );

  if coalesce(r_zero.ok, false) then
    raise exception 'un montant nul a été accepté';
  end if;

  select *
  into r_high
  from public.add_expense_v2(
    v_table,
    '__VERIFY_HIGH__',
    100001,
    current_date::text
  );

  if coalesce(r_high.ok, false) then
    raise exception 'un montant aberrant a été accepté';
  end if;

  select *
  into r_unknown
  from public.add_expense_v2(
    '__TABLE_INCONNUE__',
    '__VERIFY_UNKNOWN__',
    10,
    current_date::text
  );

  if coalesce(r_unknown.ok, false) then
    raise exception 'une table inconnue a été acceptée';
  end if;

  raise notice
    'dépenses atomiques : ok — codes invalides %, %, %',
    r_zero.code,
    r_high.code,
    r_unknown.code;
end
$verify$;

\echo '=== Tests check-in atomique ==='

do $verify$
declare
  r_unknown record;
  r_first record;
  r_second record;
  r_denied record;

  v_event text := current_date::text;

  v_token text :=
    '__VERIFY_QR_' || txid_current()::text || '__';

  v_denied_token text :=
    '__VERIFY_DENIED_' || txid_current()::text || '__';
begin
  select *
  into r_unknown
  from public.check_in_invitation(
    '__VERIFY_TOKEN_INCONNU__',
    v_event
  );

  if coalesce(r_unknown.ok, false) then
    raise exception 'un QR inconnu a été accepté';
  end if;

  insert into public.promoter_guest_entries (
    event_date,
    promoter_username,
    guest_name,
    qr_token,
    checked_in
  )
  values (
    v_event,
    'mathias',
    'Verify QR',
    v_token,
    null
  );

  select *
  into r_first
  from public.check_in_invitation(
    v_token,
    v_event
  );

  if not coalesce(r_first.ok, false) then
    raise exception
      'premier check-in refusé : % / %',
      r_first.code,
      r_first.message;
  end if;

  select *
  into r_second
  from public.check_in_invitation(
    v_token,
    v_event
  );

  if coalesce(r_second.ok, false) then
    raise exception 'le même QR a été validé deux fois';
  end if;

  insert into public.promoter_guest_entries (
    event_date,
    promoter_username,
    guest_name,
    qr_token,
    checked_in
  )
  values (
    v_event,
    'mathias',
    'Verify Unauthorized',
    v_denied_token,
    false
  );

  perform set_config(
    'request.jwt.claim.sub',
    current_setting('clubone.promoter_auth_id'),
    true
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      current_setting('clubone.promoter_auth_id'),
      'role',
      'authenticated'
    )::text,
    true
  );

  select *
  into r_denied
  from public.check_in_invitation(
    v_denied_token,
    v_event
  );

  if coalesce(r_denied.ok, false) then
    raise exception
      'un promoteur a pu valider un QR';
  end if;

  if r_denied.code is distinct from 'unauthorized' then
    raise exception
      'code attendu unauthorized, obtenu : %',
      coalesce(r_denied.code, '<null>');
  end if;

  raise notice
    'check-in atomique : ok — premier %, second %, promoteur %',
    r_first.code,
    r_second.code,
    r_denied.code;
end
$verify$;

rollback;

\echo '=== Vérification du rollback ==='

do $verify$
begin
  if exists (
    select 1
    from public.promoter_guest_entries
    where qr_token like '__VERIFY_%'
  ) then
    raise exception 'des invitations de test sont restées en base';
  end if;

  if exists (
    select 1
    from public.club_tables
    where expenses::text like '%__VERIFY_EXPENSE_%'
  ) then
    raise exception 'des dépenses de test sont restées en base';
  end if;
end
$verify$;

select
  'atomic_operations_verification' as check_name,
  'ok' as status;