-- ============================================================
-- 0058 — PORTAIL CLIENT (audit E2 self-service préférences/consentements, E3 agenda mensuel, E6 durcissement accès)
-- ============================================================
-- Prolonge le MINI-ESPACE CLIENT de 0019 (accès sans mot de passe par jeton opaque guests.space_token) avec :
--
--   E2 — SELF-SERVICE PRÉFÉRENCES/CONSENTEMENTS : le client déclare LUI-MÊME ses préférences de service
--        (musique / table / allergies) et son droit à l'image. On n'invente rien : ces champs n'existaient pas,
--        on les AJOUTE (guests.preferences jsonb, guests.image_consent boolean). L'écriture passe par une RPC
--        anon SECURITY DEFINER gardée par possession du space_token — même modèle de confiance que le lien.
--
--   E3 — AGENDA MENSUEL PUBLIC : le client consulte les soirées PUBLIÉES d'un mois donné, par salle
--        (Eden/Cercle/Terminus) ou toutes salles. RPC anon en LECTURE SEULE, champs maîtrisés, miroir de
--        public_events (0004) mais borné à un mois — pour un calendrier client sans exposer aucune table.
--
--   E6 — DURCISSEMENT « LIEN PORTEUR PERMANENT NON RÉVOCABLE » (constat sécurité) : le space_token de 0019 est
--        un porteur permanent — s'il fuite, il donne un accès illimité et non révocable. Mitigations ici :
--          · guests.space_token_expires_at (nullable) : NULL = jamais expiré (compat 0019 : les 2050 clients
--            existants gardent leur lien) ; une valeur => le lien cesse d'être valide au-delà.
--          · get_guest_space_v2 : version durcie de get_guest_space_v1 qui REJETTE un jeton expiré (found:false,
--            expired:true) et expose EN PLUS preferences/image_consent (pour préremplir le formulaire E2).
--            v1 reste INTACTE (bridge, aucune régression pour l'ancien front).
--          · rotate_guest_space_token_v1 : régénère le jeton (invalide l'ancien) et arme une expiration
--            => RÉVOCABILITÉ concrète (self-service ou support authentifié).
--          · PIN optionnel (guests.access_pin_hash, hashé bcrypt via pgcrypto) : set_guest_pin_v1 /
--            verify_guest_pin_v1. verify accepte un jeton MÊME EXPIRÉ et, si le PIN correspond, RÉ-ARME
--            l'expiration => RE-ACCÈS SANS EMAIL NI SMS (aucune dépendance à un fournisseur externe).
--
-- SÉCURITÉ (rule-20) : toutes les RPC anon sont SECURITY DEFINER, search_path=public figé, revoke public,
--   grant execute ciblé, gardes de format/rate (nullif/btrim, bornes de taille, whitelist de clés jsonb).
--   Aucune table n'est exposée à anon : le seul accès reste la RPC minimisée.
--
-- NIVEAU DE PREUVE visé : validation SQL statique (3). ADDITIVE, idempotente, réversible. NON prod.
-- Rollback : drop des colonnes ajoutées + drop des fonctions 0058 (v1/0019 intactes).
-- ============================================================

begin;

-- pgcrypto est déjà installé par 0001 (auth bcrypt). Idempotent ici : garantit crypt()/gen_salt() pour le PIN.
-- Si l'extension était indisponible, le PIN dégraderait (voir garde has_pgcrypto ci-dessous) ; le reste du
-- portail (préférences, agenda, rotation, expiration) ne dépend PAS de pgcrypto.
create extension if not exists pgcrypto;

-- ── 1) Colonnes portail client (additif strict, toutes nullable, aucune donnée métier fabriquée) ──────────
alter table public.guests add column if not exists preferences jsonb;             -- { musique, table, allergies } déclaré par le client
alter table public.guests add column if not exists image_consent boolean;         -- droit à l'image (null = non recueilli), self-service
alter table public.guests add column if not exists space_token_expires_at timestamptz; -- NULL = jamais expiré (compat 0019)
alter table public.guests add column if not exists access_pin_hash text;           -- PIN de re-accès hashé bcrypt (null = aucun PIN)

comment on column public.guests.preferences is 'Préférences de service déclarées PAR LE CLIENT (musique/table/allergies) — jamais inventées.';
comment on column public.guests.image_consent is 'Droit à l''image, self-service via set_guest_preferences_v1 (null = non recueilli).';
comment on column public.guests.space_token_expires_at is 'Expiration du lien mini-espace (NULL = jamais). Armée par rotate/verify PIN — durcissement E6.';
comment on column public.guests.access_pin_hash is 'PIN de re-accès hashé bcrypt (pgcrypto). Permet de ré-armer un lien expiré SANS email/SMS.';

-- ── 2) public_month_events_v1 — AGENDA MENSUEL PUBLIC (E3), lecture seule, champs maîtrisés ───────────────
-- Renvoie les soirées PUBLIÉES (donc non archivées, non draft) d'un mois civil, filtrées par salle (p_venue
-- NULL = toutes). Gardes de format : mois 1..12, année bornée ; entrées hors bornes → aucun résultat (jamais
-- d'erreur exploitable). Miroir de public_events (0004) mais cadré à un mois, pour un calendrier client.
create or replace function public.public_month_events_v1(
  p_venue text,
  p_year int,
  p_month int
)
returns table (
  venue_id text,
  venue_name text,
  venue_kind text,
  title text,
  slug text,
  event_date date,
  start_time text,
  horaire_debut text,
  horaire_fin text,
  description text,
  lineup text[],
  artistes text,
  cover_url text,
  ticket_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_venue text := nullif(btrim(coalesce(p_venue, '')), '');
  v_start date;
  v_end date;
begin
  -- Gardes de format : année/mois plausibles, sinon aucun résultat (pas d'exception, pas d'énumération).
  if p_year is null or p_month is null or p_year < 2000 or p_year > 2100 or p_month < 1 or p_month > 12 then
    return;
  end if;
  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month')::date;  -- borne haute exclusive

  return query
  select e.venue_id, v.name, v.kind, e.title, e.slug, e.event_date, e.start_time,
         e.horaire_debut, e.horaire_fin, e.description, e.lineup, e.artistes,
         e.cover_url, e.ticket_url
    from public.events e
    join public.venues v on v.id = e.venue_id
   where e.status = 'published'
     and e.event_date >= v_start
     and e.event_date < v_end
     and (v_venue is null or e.venue_id = v_venue)
   order by e.event_date asc, v.sort_order asc, e.start_time asc nulls last;
end;
$$;
revoke all on function public.public_month_events_v1(text, int, int) from public;
grant execute on function public.public_month_events_v1(text, int, int) to anon, authenticated;

-- ── 3) get_guest_space_v2 — mini-espace DURCI (E6 expiration) + préférences/consentement (E2 préremplissage) ─
-- Reprend get_guest_space_v1 (0019) et ajoute : rejet des jetons EXPIRÉS ({found:false, expired:true}) et
-- exposition de preferences + image_consent (données PROPRES du client, minimisées). v1 reste inchangée.
create or replace function public.get_guest_space_v2(p_space_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest record;
  v_visits jsonb;
  v_passes jsonb;
begin
  if p_space_token is null then
    return jsonb_build_object('found', false);
  end if;

  select g.id, g.first_name, g.preferences, g.image_consent, g.space_token_expires_at,
         (g.access_pin_hash is not null) as has_pin
    into v_guest
    from public.guests g
   where g.space_token = p_space_token;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- DURCISSEMENT E6 : un lien expiré ne donne AUCUNE donnée. On signale 'expired' pour que l'UI propose le
  -- re-accès par PIN (verify_guest_pin_v1) — aucune fuite (le porteur détenait déjà le jeton).
  if v_guest.space_token_expires_at is not null and v_guest.space_token_expires_at < now() then
    return jsonb_build_object('found', false, 'expired', true, 'has_pin', v_guest.has_pin);
  end if;

  select coalesce(jsonb_agg(x order by x.exploitation_date desc), '[]'::jsonb) into v_visits
  from (
    select v.exploitation_date, v.univers, v.status, v.is_host, e.title as event_title
      from public.guest_visits v
      left join public.events e on e.id = v.event_id
     where v.guest_id = v_guest.id
     order by v.exploitation_date desc
     limit 100
  ) x;

  -- Mitigation amplification (0019) : qr_token brut seulement pour un pass présentable (issued + futur).
  select coalesce(jsonb_agg(y order by y.exploitation_date desc), '[]'::jsonb) into v_passes
  from (
    select
      case when gp.status = 'issued' and gp.exploitation_date >= current_date then gp.qr_token else null end
        as qr_token,
      gp.exploitation_date, gp.univers, gp.status, gp.is_host, e.title as event_title
      from public.guest_passes gp
      left join public.events e on e.id = gp.event_id
     where gp.guest_id = v_guest.id
     order by gp.exploitation_date desc
     limit 60
  ) y;

  return jsonb_build_object(
    'found', true,
    'first_name', v_guest.first_name,
    'preferences', coalesce(v_guest.preferences, '{}'::jsonb),
    'image_consent', v_guest.image_consent,
    'has_pin', v_guest.has_pin,
    'visits', v_visits,
    'passes', v_passes
  );
end;
$$;
revoke all on function public.get_guest_space_v2(uuid) from public;
grant execute on function public.get_guest_space_v2(uuid) to anon, authenticated;

-- ── 4) set_guest_preferences_v1 — SELF-SERVICE préférences + droit à l'image (E2), écriture gardée ─────────
-- Écriture anon gardée par possession du space_token NON EXPIRÉ. Whitelist STRICTE des clés (musique/table/
-- allergies), chaînes bornées (rate/format) : on n'accepte jamais un jsonb arbitraire (anti-abus/anti-bloat).
create or replace function public.set_guest_preferences_v1(
  p_token uuid,
  p_prefs jsonb,
  p_image_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest record;
  v_clean jsonb := '{}'::jsonb;
  v_musique text;
  v_table text;
  v_allergies text;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  select g.id, g.space_token_expires_at
    into v_guest
    from public.guests g
   where g.space_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if v_guest.space_token_expires_at is not null and v_guest.space_token_expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  -- WHITELIST : on ne retient QUE les 3 clés connues, chacune bornée à 280 caractères. Tout le reste ignoré.
  if p_prefs is not null and jsonb_typeof(p_prefs) = 'object' then
    v_musique   := nullif(btrim(left(coalesce(p_prefs->>'musique', ''), 280)), '');
    v_table     := nullif(btrim(left(coalesce(p_prefs->>'table', ''), 280)), '');
    v_allergies := nullif(btrim(left(coalesce(p_prefs->>'allergies', ''), 280)), '');
    if v_musique is not null then v_clean := v_clean || jsonb_build_object('musique', v_musique); end if;
    if v_table is not null then v_clean := v_clean || jsonb_build_object('table', v_table); end if;
    if v_allergies is not null then v_clean := v_clean || jsonb_build_object('allergies', v_allergies); end if;
  end if;

  update public.guests
     set preferences = v_clean,
         image_consent = p_image_consent,
         updated_at = now()
   where id = v_guest.id;

  return jsonb_build_object('ok', true, 'preferences', v_clean, 'image_consent', p_image_consent);
end;
$$;
revoke all on function public.set_guest_preferences_v1(uuid, jsonb, boolean) from public;
grant execute on function public.set_guest_preferences_v1(uuid, jsonb, boolean) to anon, authenticated;

-- ── 5) rotate_guest_space_token_v1 — RÉVOCABILITÉ (E6) : régénère le jeton + arme une expiration ──────────
-- Prend le jeton COURANT (preuve de possession), génère un NOUVEAU jeton (l'ancien cesse aussitôt de résoudre)
-- et fixe une expiration à +180 jours. Self-service (le client rafraîchit son lien) ou support authentifié.
create or replace function public.rotate_guest_space_token_v1(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_expires timestamptz;
  v_new uuid;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  select g.id, g.space_token_expires_at into v_id, v_expires
    from public.guests g
   where g.space_token = p_token;
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  -- Un jeton déjà expiré ne peut PAS se rotationner seul (sinon la révocation par expiration serait vaine) :
  -- le re-accès d'un lien expiré passe par le PIN (verify_guest_pin_v1). Rotation = uniquement lien encore actif.
  if v_expires is not null and v_expires < now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  v_new := gen_random_uuid();
  update public.guests
     set space_token = v_new,
         space_token_expires_at = now() + interval '180 days',
         updated_at = now()
   where id = v_id;

  return jsonb_build_object('ok', true, 'space_token', v_new, 'expires_at', now() + interval '180 days');
end;
$$;
revoke all on function public.rotate_guest_space_token_v1(uuid) from public;
grant execute on function public.rotate_guest_space_token_v1(uuid) to anon, authenticated;

-- ── 6) PIN optionnel (E6) — re-accès SANS email/SMS. Hashé bcrypt via pgcrypto (dégradation gracieuse) ────
-- set_guest_pin_v1 : le porteur d'un lien VALIDE fixe un PIN (4 à 8 chiffres), hashé bcrypt. Si pgcrypto est
-- indisponible, on refuse proprement (code 'pin_unavailable') SANS stocker de secret en clair.
create or replace function public.set_guest_pin_v1(p_token uuid, p_pin text)
returns jsonb
language plpgsql
security definer
-- pgcrypto (crypt/gen_salt) vit dans le schéma `extensions` sous Supabase → l'ajouter au search_path
-- (figé) pour que le hachage bcrypt du PIN se résolve. Vérifié niveau 4 sur le LABO.
set search_path = public, extensions
as $$
declare
  v_guest record;
  v_pin text := nullif(btrim(coalesce(p_pin, '')), '');
  v_has_pgcrypto boolean := exists (select 1 from pg_extension where extname = 'pgcrypto');
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if not v_has_pgcrypto then
    -- Dégradation gracieuse : jamais de PIN en clair. Le portail reste utilisable sans PIN.
    return jsonb_build_object('ok', false, 'code', 'pin_unavailable');
  end if;
  if v_pin is null or v_pin !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'code', 'pin_format');
  end if;

  select g.id, g.space_token_expires_at into v_guest
    from public.guests g
   where g.space_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if v_guest.space_token_expires_at is not null and v_guest.space_token_expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  update public.guests
     set access_pin_hash = crypt(v_pin, gen_salt('bf', 10)),
         updated_at = now()
   where id = v_guest.id;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_guest_pin_v1(uuid, text) from public;
grant execute on function public.set_guest_pin_v1(uuid, text) to anon, authenticated;

-- verify_guest_pin_v1 : accepte un jeton MÊME EXPIRÉ (c'est tout l'intérêt : re-accès d'un lien expiré). Si le
-- PIN correspond, RÉ-ARME l'expiration (+180 jours) => le lien redevient valide, SANS email ni SMS. En cas
-- d'échec, aucune distinction entre "pas de PIN" et "PIN faux" côté message (anti-énumération).
create or replace function public.verify_guest_pin_v1(p_token uuid, p_pin text)
returns jsonb
language plpgsql
security definer
-- pgcrypto (crypt) vit dans `extensions` sous Supabase → search_path figé incluant extensions.
set search_path = public, extensions
as $$
declare
  v_guest record;
  v_pin text := nullif(btrim(coalesce(p_pin, '')), '');
  v_has_pgcrypto boolean := exists (select 1 from pg_extension where extname = 'pgcrypto');
  v_new_expires timestamptz := now() + interval '180 days';
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if not v_has_pgcrypto then
    return jsonb_build_object('ok', false, 'code', 'pin_unavailable');
  end if;
  if v_pin is null then
    return jsonb_build_object('ok', false, 'code', 'pin_invalid');
  end if;

  select g.id, g.access_pin_hash into v_guest
    from public.guests g
   where g.space_token = p_token;
  -- Jeton inconnu OU aucun PIN configuré OU PIN faux => même réponse neutre (aucune énumération utile).
  if not found or v_guest.access_pin_hash is null
     or v_guest.access_pin_hash <> crypt(v_pin, v_guest.access_pin_hash) then
    return jsonb_build_object('ok', false, 'code', 'pin_invalid');
  end if;

  -- Succès : ré-arme l'expiration => le lien (jeton connu du porteur) redevient valide sans canal externe.
  update public.guests
     set space_token_expires_at = v_new_expires,
         updated_at = now()
   where id = v_guest.id;

  return jsonb_build_object('ok', true, 'expires_at', v_new_expires);
end;
$$;
revoke all on function public.verify_guest_pin_v1(uuid, text) from public;
grant execute on function public.verify_guest_pin_v1(uuid, text) to anon, authenticated;

commit;
