-- 0065_merge_guests.sql — FUSION DE FICHES CLIENT (dédoublonnage confirmé, acte destructif contrôlé).
--
-- Vague V4 — CRM. Le dédoublonnage de CrmProfilePanel proposait un APERÇU non destructif ; cette RPC
-- exécute la fusion CONFIRMÉE par la direction : elle réattribue TOUS les enfants FK de la fiche
-- « drop » vers la fiche « keep » (sans violer les uniques), enrichit keep des champs manquants
-- (non destructif), puis supprime drop. Atomique, SECURITY DEFINER, admin/manager uniquement.
--
-- Enfants FK de guests(id) au 2026-07-07 : guest_visits, table_reservation_requests, guest_notes,
-- guest_contacts, guest_passes, message_queue, guest_auth_attempts, guest_tags (unique guest+tag),
-- campaign_recipients (unique campaign+guest), promo_redemptions (unique code+guest).
-- Réversible (drop function). Additif/idempotent.

begin;

create or replace function public.merge_guests_v1(p_keep uuid, p_drop uuid)
returns table (ok boolean, code text, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
begin
  if v_role is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Fusion réservée à la direction'; return;
  end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then
    return query select false, 'invalid', 'Fiches à fusionner invalides'; return;
  end if;
  if not exists (select 1 from public.guests where id = p_keep)
     or not exists (select 1 from public.guests where id = p_drop) then
    return query select false, 'not_found', 'Fiche introuvable'; return;
  end if;

  -- Enfants sans unique par guest : réattribution simple.
  update public.guest_visits set guest_id = p_keep where guest_id = p_drop;
  update public.table_reservation_requests set guest_id = p_keep where guest_id = p_drop;
  update public.guest_notes set guest_id = p_keep where guest_id = p_drop;
  update public.guest_contacts set guest_id = p_keep where guest_id = p_drop;
  update public.guest_passes set guest_id = p_keep where guest_id = p_drop;
  update public.message_queue set guest_id = p_keep where guest_id = p_drop;

  -- guest_auth_attempts : compteur de rate-limit transitoire (PK guest_id) → jeter celui de drop.
  delete from public.guest_auth_attempts where guest_id = p_drop;

  -- Enfants avec unique(guest_id, X) : déplacer le non-conflictuel, jeter le conflictuel.
  update public.guest_tags t set guest_id = p_keep
   where t.guest_id = p_drop
     and not exists (select 1 from public.guest_tags k where k.guest_id = p_keep and k.tag = t.tag);
  delete from public.guest_tags where guest_id = p_drop;

  update public.campaign_recipients r set guest_id = p_keep
   where r.guest_id = p_drop
     and not exists (select 1 from public.campaign_recipients k where k.guest_id = p_keep and k.campaign_id = r.campaign_id);
  delete from public.campaign_recipients where guest_id = p_drop;

  update public.promo_redemptions pr set guest_id = p_keep
   where pr.guest_id = p_drop
     and not exists (select 1 from public.promo_redemptions k where k.guest_id = p_keep and k.promo_code_id = pr.promo_code_id);
  delete from public.promo_redemptions where guest_id = p_drop;

  -- Enrichissement non destructif de keep depuis drop (ne remplace jamais une valeur existante).
  update public.guests k set
     email      = coalesce(k.email, d.email),
     birthday   = coalesce(k.birthday, d.birthday),
     last_name  = coalesce(k.last_name, d.last_name),
     notes      = coalesce(k.notes, d.notes)
   from public.guests d
  where k.id = p_keep and d.id = p_drop;

  delete from public.guests where id = p_drop;

  return query select true, 'ok', 'Fusion effectuée';
end $$;

revoke all on function public.merge_guests_v1(uuid, uuid) from public;
grant execute on function public.merge_guests_v1(uuid, uuid) to authenticated;

commit;
