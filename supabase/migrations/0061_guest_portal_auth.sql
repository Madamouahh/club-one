-- ============================================================
-- 0061 — PORTAIL CLIENT : AUTH COMPLET (Squad Portal-Auth, Vague 3 — correction fondateur « Auth complet non livré »)
-- ============================================================
-- Durcit l'accès au MINI-ESPACE CLIENT (0019 jeton opaque → 0058 expiration/rotation/PIN) en livrant, SANS
-- AUCUN canal externe (ni email ni SMS), le compte de bout en bout attendu :
--
--   RL — RATE LIMITING / VERROUILLAGE : une table `guest_auth_attempts` (1 ligne par client) compte les
--        ÉCHECS de PIN/récupération dans une fenêtre glissante et arme un verrou temporaire après N échecs.
--        `verify_guest_pin_v2` CONSULTE ce compteur (v1 de 0058 reste le pont, INCHANGÉE). Réponses NEUTRES
--        (anti-énumération) : un jeton/téléphone inconnu, un PIN absent et un PIN faux renvoient le MÊME code.
--
--   RC — RÉCUPÉRATION SANS EMAIL : `recover_guest_access_v1(phone, pin)` — le client qui a PERDU son lien mais
--        détient une preuve d'identité qu'il a DÉJÀ (téléphone + PIN) obtient un NOUVEAU jeton + expiration
--        fraîche. AUCUN jeton permanent, AUCUN fournisseur externe. Soumis au rate limiting (par client résolu).
--
--   RV — RÉVOCATION / LOGOUT : `revoke_guest_token_v1(token)` — invalide le jeton COURANT (régénère un jeton
--        aléatoire que personne ne détient + expire immédiatement) → le lien cesse de résoudre. « Logout » =
--        abandon du jeton côté client + révocation serveur optionnelle. Le re-accès légitime passe alors par
--        le PIN (verify_guest_pin_v2) ou la récupération (recover_guest_access_v1).
--
--   RP — ROTATION DE PIN : `rotate_guest_pin_v1(token, old_pin, new_pin)` — vérifie l'ANCIEN PIN (bcrypt) puis
--        pose le NOUVEAU (bcrypt), sur un lien encore valide. Échec d'ancien PIN → compté (rate limiting).
--
--   EX — EXPIRATION : enforced partout (get_guest_space_v2/set_preferences rejettent déjà l'expiré en 0058 ;
--        rotate_guest_pin exige un lien non expiré ; SEULS verify_guest_pin_v2 et recover ré-arment l'accès).
--
-- SÉCURITÉ (rule-20) : toutes les RPC anon sont SECURITY DEFINER, search_path FIGÉ (public, + extensions là où
--   pgcrypto crypt/gen_salt — schéma `extensions` sous Supabase — est utilisé), revoke public, grant execute
--   ciblé. La NOUVELLE table `guest_auth_attempts` : `revoke all from anon` explicite (les DEFAULT PRIVILEGES
--   Supabase re-grantent anon sur toute table de public — piège 0055/0060, NON répété ici) + RLS fail-closed
--   (aucune policy → deny). Aucun accès table pour le client : uniquement via RPC minimisée.
--
-- NIVEAU DE PREUVE visé : validation SQL statique (3). ADDITIVE, idempotente, réversible. NON prod.
-- Rollback : drop des fonctions 0061 + drop table guest_auth_attempts (0058/0019 intactes).
-- ============================================================

begin;

-- pgcrypto (crypt/gen_salt bcrypt) déjà installé (0001/0058). Idempotent : garantit la dispo pour verify/rotate.
create extension if not exists pgcrypto;

-- ── 1) guest_auth_attempts — COMPTEUR D'ÉCHECS + VERROU (RL), 1 ligne par client ─────────────────────────────
-- Modèle minimal : une ligne par guest, fenêtre glissante `window_started_at`, `failed_count`, `locked_until`.
-- On ne stocke AUCUN secret (ni PIN, ni téléphone) : uniquement des compteurs anti-brute-force.
create table if not exists public.guest_auth_attempts (
  guest_id          uuid primary key references public.guests(id) on delete cascade,
  failed_count      int not null default 0,
  window_started_at timestamptz,          -- début de la fenêtre glissante de comptage
  locked_until      timestamptz,          -- verrou actif tant que > now() (null = pas de verrou)
  last_failed_at    timestamptz,
  updated_at        timestamptz not null default now()
);

comment on table public.guest_auth_attempts is
  'Rate limiting du portail client (0061) : échecs de PIN/récupération + verrou temporaire. Aucun secret stocké.';

-- Défense en profondeur (invariant 0053, piège 0055/0060) : neutraliser les GRANT anon que les DEFAULT
-- PRIVILEGES Supabase rétablissent sur toute nouvelle table de public. Le client n'accède JAMAIS à cette
-- table : seules les RPC SECURITY DEFINER (owner) l'écrivent/lisent. RLS fail-closed en ceinture+bretelles.
revoke all on public.guest_auth_attempts from anon;
alter table public.guest_auth_attempts enable row level security;
-- Aucune policy → aucun rôle (anon/authenticated) n'accède directement ; l'owner (definer) bypass RLS.

-- ── 2) Helpers internes de rate limiting (SECURITY DEFINER, JAMAIS exposés à anon) ───────────────────────────
-- Constantes de politique : verrou après 5 échecs sur une fenêtre de 15 min ; durée de verrou 15 min.
-- Ces fonctions sont appelées UNIQUEMENT depuis les RPC 0061 (donc sous l'identité de l'owner) : elles ne
-- reçoivent aucun GRANT anon/authenticated (revoke public) — un client ne peut pas manipuler son compteur.

-- Enregistre un ÉCHEC pour p_guest_id : incrémente dans la fenêtre (ou repart à 1 si la fenêtre est écoulée),
-- puis arme le verrou si le seuil est atteint. Concurrency-safe via INSERT … ON CONFLICT.
create or replace function public._guest_auth_note_fail(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window  interval := interval '15 minutes';
  v_lockout interval := interval '15 minutes';
  v_max     int := 5;
begin
  if p_guest_id is null then
    return;
  end if;

  insert into public.guest_auth_attempts as a (guest_id, failed_count, window_started_at, last_failed_at, updated_at)
  values (p_guest_id, 1, now(), now(), now())
  on conflict (guest_id) do update
    set failed_count = case
          when a.window_started_at is null or a.window_started_at < now() - v_window then 1
          else a.failed_count + 1
        end,
        window_started_at = case
          when a.window_started_at is null or a.window_started_at < now() - v_window then now()
          else a.window_started_at
        end,
        last_failed_at = now(),
        updated_at = now();

  -- Arme le verrou si le seuil est atteint (2e passe : simple et lisible ; le compteur vient d'être posé).
  update public.guest_auth_attempts
     set locked_until = now() + v_lockout,
         updated_at = now()
   where guest_id = p_guest_id
     and failed_count >= v_max
     and (locked_until is null or locked_until < now());
end;
$$;
revoke all on function public._guest_auth_note_fail(uuid) from public;

-- Renvoie l'instant de fin de verrou si un verrou est ACTIF (locked_until > now()), sinon NULL.
create or replace function public._guest_auth_locked_until(p_guest_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select locked_until
    from public.guest_auth_attempts
   where guest_id = p_guest_id
     and locked_until is not null
     and locked_until > now();
$$;
revoke all on function public._guest_auth_locked_until(uuid) from public;

-- Réinitialise le compteur après un SUCCÈS (le client légitime repart propre).
create or replace function public._guest_auth_reset(p_guest_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.guest_auth_attempts where guest_id = p_guest_id;
$$;
revoke all on function public._guest_auth_reset(uuid) from public;

-- Secondes restantes avant expiration du verrou (>= 0, arrondi haut) — pour un message d'attente honnête.
create or replace function public._guest_auth_retry_after(p_locked_until timestamptz)
returns int
language sql
stable  -- dépend de now() (STABLE) : jamais IMMUTABLE.
set search_path = public
as $$
  select greatest(0, ceil(extract(epoch from (p_locked_until - now()))))::int;
$$;
revoke all on function public._guest_auth_retry_after(timestamptz) from public;

-- ── 3) verify_guest_pin_v2 — VÉRIF PIN AVEC RATE LIMITING (RL) ; v1 (0058) reste le pont INCHANGÉ ────────────
-- Accepte un jeton MÊME EXPIRÉ (c'est le canal de re-accès). Ordre : (a) résout le client par jeton ; (b) si un
-- verrou est actif → refus 'locked' AVANT toute vérif de PIN (anti-brute-force + anti-timing) ; (c) vérifie le
-- PIN bcrypt ; succès → RÉ-ARME l'expiration + reset compteur ; échec → note l'échec (arme le verrou au seuil).
-- Anti-énumération : jeton inconnu / PIN absent / PIN faux → MÊME code neutre 'pin_invalid'.
create or replace function public.verify_guest_pin_v2(p_token uuid, p_pin text)
returns jsonb
language plpgsql
security definer
-- crypt() vit dans `extensions` sous Supabase → search_path figé incluant extensions.
set search_path = public, extensions
as $$
declare
  v_guest record;
  v_pin text := nullif(btrim(coalesce(p_pin, '')), '');
  v_has_pgcrypto boolean := exists (select 1 from pg_extension where extname = 'pgcrypto');
  v_new_expires timestamptz := now() + interval '180 days';
  v_locked_until timestamptz;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'code', 'pin_invalid');
  end if;
  if not v_has_pgcrypto then
    return jsonb_build_object('ok', false, 'code', 'pin_unavailable');
  end if;

  select g.id, g.access_pin_hash into v_guest
    from public.guests g
   where g.space_token = p_token;

  -- Jeton connu : applique le verrou éventuel AVANT de toucher au PIN.
  if found then
    v_locked_until := public._guest_auth_locked_until(v_guest.id);
    if v_locked_until is not null then
      return jsonb_build_object('ok', false, 'code', 'locked',
        'locked_until', v_locked_until,
        'retry_after_seconds', public._guest_auth_retry_after(v_locked_until));
    end if;
  end if;

  if v_pin is null then
    return jsonb_build_object('ok', false, 'code', 'pin_invalid');
  end if;

  -- Jeton inconnu OU aucun PIN OU PIN faux → réponse NEUTRE (aucune énumération). On note l'échec quand un
  -- client réel est identifié (pour armer le verrou) ; jeton inconnu = rien à verrouiller (silencieux).
  if not found or v_guest.access_pin_hash is null
     or v_guest.access_pin_hash <> crypt(v_pin, v_guest.access_pin_hash) then
    if found then
      perform public._guest_auth_note_fail(v_guest.id);
      v_locked_until := public._guest_auth_locked_until(v_guest.id);
      if v_locked_until is not null then
        return jsonb_build_object('ok', false, 'code', 'locked',
          'locked_until', v_locked_until,
          'retry_after_seconds', public._guest_auth_retry_after(v_locked_until));
      end if;
    end if;
    return jsonb_build_object('ok', false, 'code', 'pin_invalid');
  end if;

  -- Succès : ré-arme l'expiration (re-accès SANS canal externe) + reset compteur.
  update public.guests
     set space_token_expires_at = v_new_expires,
         updated_at = now()
   where id = v_guest.id;
  perform public._guest_auth_reset(v_guest.id);

  return jsonb_build_object('ok', true, 'expires_at', v_new_expires);
end;
$$;
revoke all on function public.verify_guest_pin_v2(uuid, text) from public;
grant execute on function public.verify_guest_pin_v2(uuid, text) to anon, authenticated;

-- ── 4) recover_guest_access_v1 — RÉCUPÉRATION SANS EMAIL (RC) : téléphone + PIN → NOUVEAU jeton + expiration ──
-- Pour le client qui a PERDU son lien mais détient téléphone + PIN. Résout le client par téléphone (1er client
-- disposant d'un PIN pour ce numéro), applique le rate limiting, vérifie le PIN bcrypt, puis RÉGÉNÈRE le jeton
-- (l'ancien cesse de résoudre) et arme une expiration fraîche. AUCUN email/SMS, AUCUN jeton permanent.
-- Anti-énumération : téléphone inconnu / sans PIN / PIN faux → MÊME code neutre 'recover_invalid'.
create or replace function public.recover_guest_access_v1(p_phone text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_guest record;
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_pin text := nullif(btrim(coalesce(p_pin, '')), '');
  v_has_pgcrypto boolean := exists (select 1 from pg_extension where extname = 'pgcrypto');
  v_new uuid;
  v_new_expires timestamptz := now() + interval '180 days';
  v_locked_until timestamptz;
begin
  if not v_has_pgcrypto then
    return jsonb_build_object('ok', false, 'code', 'pin_unavailable');
  end if;
  if v_phone is null or v_pin is null then
    return jsonb_build_object('ok', false, 'code', 'recover_invalid');
  end if;

  -- Résolution par téléphone, borné aux clients disposant d'un PIN (canal de récupération). En cas de doublon
  -- de numéro, on prend le plus ancien (déterministe) — limitation documentée, cas de bord marginal.
  select g.id, g.access_pin_hash into v_guest
    from public.guests g
   where g.phone = v_phone
     and g.access_pin_hash is not null
   order by g.created_at asc nulls last, g.id asc
   limit 1;

  -- Verrou actif (par client résolu) → refus 'locked' avant toute vérif de PIN.
  if found then
    v_locked_until := public._guest_auth_locked_until(v_guest.id);
    if v_locked_until is not null then
      return jsonb_build_object('ok', false, 'code', 'locked',
        'locked_until', v_locked_until,
        'retry_after_seconds', public._guest_auth_retry_after(v_locked_until));
    end if;
  end if;

  if not found or v_guest.access_pin_hash <> crypt(v_pin, v_guest.access_pin_hash) then
    if found then
      perform public._guest_auth_note_fail(v_guest.id);
      v_locked_until := public._guest_auth_locked_until(v_guest.id);
      if v_locked_until is not null then
        return jsonb_build_object('ok', false, 'code', 'locked',
          'locked_until', v_locked_until,
          'retry_after_seconds', public._guest_auth_retry_after(v_locked_until));
      end if;
    end if;
    return jsonb_build_object('ok', false, 'code', 'recover_invalid');
  end if;

  -- Succès : NOUVEAU jeton (l'ancien lien perdu/fuité ne résout plus) + expiration fraîche + reset compteur.
  v_new := gen_random_uuid();
  update public.guests
     set space_token = v_new,
         space_token_expires_at = v_new_expires,
         updated_at = now()
   where id = v_guest.id;
  perform public._guest_auth_reset(v_guest.id);

  return jsonb_build_object('ok', true, 'space_token', v_new, 'expires_at', v_new_expires);
end;
$$;
revoke all on function public.recover_guest_access_v1(text, text) from public;
grant execute on function public.recover_guest_access_v1(text, text) to anon, authenticated;

-- ── 5) revoke_guest_token_v1 — RÉVOCATION / LOGOUT SERVEUR (RV) ──────────────────────────────────────────────
-- Le porteur du jeton COURANT (preuve de possession) tue son lien : on régénère un jeton ALÉATOIRE que personne
-- ne détient ET on expire immédiatement → le lien courant cesse de résoudre (get_guest_space_v2 → found:false).
-- Le re-accès légitime repasse par le PIN (verify_guest_pin_v2) ou la récupération (recover_guest_access_v1).
-- On ne renvoie PAS le nouveau jeton : révoquer = supprimer l'accès, pas en émettre un nouveau.
create or replace function public.revoke_guest_token_v1(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  select g.id into v_id
    from public.guests g
   where g.space_token = p_token;
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  update public.guests
     set space_token = gen_random_uuid(),        -- jeton aléatoire non détenu → l'ancien ne résout plus
         space_token_expires_at = now(),         -- expiré immédiatement (ceinture+bretelles)
         updated_at = now()
   where id = v_id;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.revoke_guest_token_v1(uuid) from public;
grant execute on function public.revoke_guest_token_v1(uuid) to anon, authenticated;

-- ── 6) rotate_guest_pin_v1 — ROTATION DE PIN (RP) : vérifie l'ANCIEN, pose le NOUVEAU (bcrypt) ────────────────
-- Sur un lien ENCORE VALIDE (non expiré). Vérifie l'ancien PIN (rate-limité comme verify) puis pose le nouveau
-- PIN (4 à 8 chiffres, bcrypt). Mauvais ancien PIN → 'pin_invalid' compté ; nouveau PIN mal formé → 'pin_format'.
create or replace function public.rotate_guest_pin_v1(p_token uuid, p_old_pin text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_guest record;
  v_old text := nullif(btrim(coalesce(p_old_pin, '')), '');
  v_new text := nullif(btrim(coalesce(p_new_pin, '')), '');
  v_has_pgcrypto boolean := exists (select 1 from pg_extension where extname = 'pgcrypto');
  v_locked_until timestamptz;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if not v_has_pgcrypto then
    return jsonb_build_object('ok', false, 'code', 'pin_unavailable');
  end if;

  select g.id, g.access_pin_hash, g.space_token_expires_at into v_guest
    from public.guests g
   where g.space_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  -- Rotation = action de session : le lien doit être encore valide (un lien expiré passe par le PIN/recover).
  if v_guest.space_token_expires_at is not null and v_guest.space_token_expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  -- Verrou actif → refus avant vérif de l'ancien PIN.
  v_locked_until := public._guest_auth_locked_until(v_guest.id);
  if v_locked_until is not null then
    return jsonb_build_object('ok', false, 'code', 'locked',
      'locked_until', v_locked_until,
      'retry_after_seconds', public._guest_auth_retry_after(v_locked_until));
  end if;

  -- Vérifie l'ANCIEN PIN. Échec (pas de PIN posé, ou faux) → neutre 'pin_invalid', compté (rate limiting).
  if v_old is null or v_guest.access_pin_hash is null
     or v_guest.access_pin_hash <> crypt(v_old, v_guest.access_pin_hash) then
    perform public._guest_auth_note_fail(v_guest.id);
    v_locked_until := public._guest_auth_locked_until(v_guest.id);
    if v_locked_until is not null then
      return jsonb_build_object('ok', false, 'code', 'locked',
        'locked_until', v_locked_until,
        'retry_after_seconds', public._guest_auth_retry_after(v_locked_until));
    end if;
    return jsonb_build_object('ok', false, 'code', 'pin_invalid');
  end if;

  -- Nouveau PIN : format 4 à 8 chiffres (miroir de set_guest_pin_v1).
  if v_new is null or v_new !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'code', 'pin_format');
  end if;

  update public.guests
     set access_pin_hash = crypt(v_new, gen_salt('bf', 10)),
         updated_at = now()
   where id = v_guest.id;
  perform public._guest_auth_reset(v_guest.id);

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.rotate_guest_pin_v1(uuid, text, text) from public;
grant execute on function public.rotate_guest_pin_v1(uuid, text, text) to anon, authenticated;

commit;
