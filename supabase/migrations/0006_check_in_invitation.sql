-- 0006_check_in_invitation.sql - validation QR atomique
--
-- Probleme : le front lisait l'invitation, verifiait `checked_in`, puis faisait
-- un UPDATE. Deux scanners simultanes pouvaient donc valider le meme QR.
--
-- Solution : une RPC SECURITY INVOKER qui fait la validation dans un UPDATE
-- conditionnel unique (`checked_in is distinct from true`) et insere le journal d'entree dans
-- la meme transaction. La RLS de `promoter_guest_entries` et `entry_logs` reste
-- appliquee au JWT authentifie.

do $$
declare
  v_duplicate_token text;
begin
  select btrim(qr_token)
    into v_duplicate_token
    from public.promoter_guest_entries
   where qr_token is not null
     and btrim(qr_token) <> ''
   group by btrim(qr_token)
  having count(*) > 1
   limit 1;

  if v_duplicate_token is not null then
    raise exception 'Duplicate qr_token found before unique index creation: %', v_duplicate_token;
  end if;
end;
$$;

create unique index if not exists promoter_guest_entries_qr_token_unique_idx
  on public.promoter_guest_entries (qr_token)
  where qr_token is not null
    and btrim(qr_token) <> '';

create or replace function public.check_in_invitation(
  p_token text,
  p_event_date text default null
) returns table (
  ok boolean,
  code text,
  message text,
  guest_name text,
  promoter_username text,
  event_date text
)
language plpgsql
set search_path = public
as $$
declare
  v_token text := nullif(trim(coalesce(p_token, '')), '');
  v_event_date text := nullif(trim(coalesce(p_event_date, '')), '');
  v_updated record;
  v_existing record;
  v_staff_username text;
  v_staff_role text;
begin
  if v_token is null then
    return query select false, 'invalid_token', 'QR vide ou invalide.', null::text, null::text, null::text;
    return;
  end if;

  v_staff_username := public.current_staff_username();
  v_staff_role := public.current_staff_role();
  if v_staff_username is null
     or v_staff_role not in ('admin','manager','security','security_counter') then
    return query select false, 'unauthorized', 'Utilisateur non autorise.', null::text, null::text, null::text;
    return;
  end if;

  update public.promoter_guest_entries
     set checked_in = true,
         checked_in_at = now(),
         checked_in_by = v_staff_username
   where qr_token = v_token
     and checked_in is distinct from true
     and (v_event_date is null or event_date::text = v_event_date)
   returning guest_name, promoter_username, event_date::text as event_date
     into v_updated;

  if v_updated is not null then
    insert into public.entry_logs (type, staff_username)
    values ('entry', v_staff_username);

    return query select true, 'checked_in', 'Entree validee.', v_updated.guest_name, v_updated.promoter_username, v_updated.event_date;
    return;
  end if;

  select pge.guest_name, pge.promoter_username, pge.event_date::text as event_date, pge.checked_in
    into v_existing
    from public.promoter_guest_entries pge
   where pge.qr_token = v_token
   limit 1;

  if v_existing is null then
    return query select false, 'unknown_token', 'QR introuvable ou invalide.', null::text, null::text, null::text;
    return;
  end if;

  if v_event_date is not null and v_existing.event_date <> v_event_date then
    return query select false, 'wrong_date', 'QR valide mais pas pour cette soiree.', null::text, null::text, v_existing.event_date;
    return;
  end if;

  if v_existing.checked_in then
    return query select false, 'already_used', 'QR deja utilise.', v_existing.guest_name, v_existing.promoter_username, v_existing.event_date;
    return;
  end if;

  return query select false, 'not_checked_in', 'Invitation non validee.', null::text, null::text, null::text;
end;
$$;

revoke all on function public.check_in_invitation(text, text) from public;
grant execute on function public.check_in_invitation(text, text) to authenticated;
