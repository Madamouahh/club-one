-- 0020_rh_self_confirm.sql — RH / Planning (B7), VUE SALARIÉ : confirmation de présence « 1 tap ».
--
-- Contexte : la 0011 donne déjà à chaque salarié la LECTURE de sa propre fiche et de SES shifts
-- (staff_members_read / staff_shifts_read : direction OU username = current_staff_username()).
-- En revanche l'ÉCRITURE reste direction seule (staff_shifts_update). Le master doc B7 prévoit pour
-- la vue salarié une « confirmation présence 1 tap » : le salarié confirme qu'il SERA présent au
-- créneau que la direction lui a composé. On ne peut PAS ouvrir une policy UPDATE large (elle
-- laisserait le salarié changer poste, horaires, ou se marquer lui-même present/absent — falsifiant
-- le pointage). On expose donc une RPC SECURITY DEFINER minimale, à surface strictement bornée :
--   · elle ne touche QUE la colonne status, et UNIQUEMENT la transition 'planifie' → 'confirme' ;
--   · UNIQUEMENT sur un shift appartenant à l'appelant (staff_member.username = current_staff_username) ;
--   · elle ne peut jamais poser 'present'/'absent'/'retard' (le pointage réel reste direction seule),
--     ni annuler, ni ré-ouvrir un créneau déjà traité par la direction, ni modifier les horaires.
-- Additif strict : aucune table modifiée, aucune policy existante retouchée, aucun salarié inventé.
--
-- RGPD / droit du travail : la confirmation est une action VOLONTAIRE du salarié sur SON créneau,
-- transparente et annoncée — pas une surveillance. La direction garde la main sur le pointage réel.

begin;

-- ============================================================
-- RPC confirm_my_shift_v1 — le salarié confirme SA présence (planifie → confirme), 1 tap.
-- ============================================================
create or replace function public.confirm_my_shift_v1(p_shift_id uuid)
returns table (ok boolean, code text, message text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_member_id uuid;
  v_shift_member uuid;
  v_status text;
begin
  -- 1) Authentification : un compte staff réel, jamais anon.
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorisé.', null::text; return;
  end if;
  v_username := public.current_staff_username();
  if v_username is null then
    return query select false, 'unauthorized', 'Utilisateur non autorisé.', null::text; return;
  end if;

  -- 2) La fiche salarié de l'appelant (rattachement par username, comme la RLS 0011). Sans fiche,
  --    aucun créneau ne peut lui appartenir : état honnête, pas une erreur technique.
  select id into v_member_id
  from public.staff_members
  where username = v_username;
  if v_member_id is null then
    return query select false, 'no_member', 'Aucune fiche salarié rattachée à ce compte.', null::text; return;
  end if;

  -- 3) Le shift ciblé, verrouillé le temps de la transition (évite une course avec le pointage direction).
  --    Colonnes qualifiées (alias s) : le RETURNS TABLE expose un OUT « status » qui masquerait sinon
  --    staff_shifts.status (ambiguïté PL/pgSQL).
  select s.staff_member_id, s.status into v_shift_member, v_status
  from public.staff_shifts s
  where s.id = p_shift_id
  for update;
  if not found then
    return query select false, 'not_found', 'Créneau introuvable.', null::text; return;
  end if;

  -- 4) Appartenance stricte : on ne confirme QUE son propre créneau (pas de fuite inter-salarié).
  if v_shift_member is distinct from v_member_id then
    return query select false, 'forbidden', 'Ce créneau ne vous appartient pas.', null::text; return;
  end if;

  -- 5) Idempotence : déjà confirmé → succès sans écriture (le 1-tap peut être re-cliqué sans effet).
  if v_status = 'confirme' then
    return query select true, 'already', 'Présence déjà confirmée.', 'confirme'::text; return;
  end if;

  -- 6) Seule la transition planifie → confirme est autorisée. Un créneau déjà traité par la direction
  --    (present/absent/retard) ou annulé n'est PAS ré-ouvrable par le salarié : le pointage réel et
  --    l'annulation restent une prérogative direction (staff_shifts_update, 0011).
  if v_status <> 'planifie' then
    return query select false, 'not_confirmable',
      'Ce créneau a déjà été traité par la direction et ne peut plus être confirmé ici.',
      v_status; return;
  end if;

  update public.staff_shifts
  set status = 'confirme', updated_at = now()
  where id = p_shift_id;

  return query select true, 'ok', 'Présence confirmée.', 'confirme'::text;
end;
$$;

-- Surface d'exécution : comptes staff authentifiés uniquement (jamais anon). La fonction elle-même
-- borne l'action à SON propre créneau : le grant authenticated n'ouvre aucun accès transversal.
revoke all on function public.confirm_my_shift_v1(uuid) from public;
grant execute on function public.confirm_my_shift_v1(uuid) to authenticated;

commit;
