-- ============================================================
-- 0019 — CRM : MINI-ESPACE CLIENT (accès lecture seule par jeton opaque, spec MODULE_CRM_CLIENTS_VIP.md §V0)
-- ============================================================
-- OBJECTIF (spec « Mini-espace client », L.47-51) : donner au client inscrit un accès SANS mot de passe,
-- zéro friction, à SES propres données (prochaines soirées, ses QR d'entrée, à terme les photos qu'il a
-- consenties). C'est du PULL (le client vient voir) — aucune prospection, l'opt-in marketing ne conditionne
-- rien ici. Le PUSH (WhatsApp) reste régi par consent_marketing, hors de ce périmètre.
--
-- CHOIX DE CONCEPTION (déviation ASSUMÉE de la spec, documentée) : la spec évoque un « token HMAC (pattern
-- AVENORE lead_token) ». Un HMAC impose un SECRET partagé à configurer côté infra (variable d'env) — ce qui
-- serait une dépendance de configuration bloquante. On retient à la place un JETON OPAQUE aléatoire stocké en
-- base (guests.space_token, gen_random_uuid), exactement le patron déjà éprouvé pour guest_passes.qr_token :
--   · même propriété : non devinable (128 bits), vérifié CÔTÉ SERVEUR, ne fuite jamais d'autre donnée ;
--   · AVANTAGES vs HMAC : aucun secret à gérer/faire tourner, révocable PAR client (regénérer la colonne),
--     et l'accès est refait en SQL par une RPC SECURITY DEFINER (aucune table exposée à anon).
--
-- SURFACE : deux RPC anon, en LECTURE SEULE, sans aucune écriture ni listing :
--   1) resolve_space_from_pass_v1(qr_token) → space_token : permet à la page de confirmation d'inscription
--      (/i/[token], qui détient déjà le qr_token du client qui vient de s'inscrire) d'afficher le lien du
--      mini-espace SANS modifier la RPC d'inscription (register_guest_via_invite_v1 reste INTACTE).
--   2) get_guest_space_v1(space_token) → jsonb : renvoie UNIQUEMENT les données propres de CE client, minimisées
--      (prénom, ses visites, ses passes/QR). JAMAIS de téléphone, nom de famille, spend, notes, ni aucune donnée
--      d'un TIERS. Jeton inconnu → { found:false } (aucune fuite, aucune énumération utile : uuid v4 ~122 bits).
--
-- AMPLIFICATION D'UN qr_token CAPTÉ (constat revue sécurité S19, IMPORTANT-1) : un qr_token n'est PAS un secret
-- fort (il est imprimé en clair sous le QR, scanné à la porte, potentiellement photographié). Sans garde, la
-- chaîne resolve → space → passes exposerait TOUS les qr_tokens du client (dont ceux de soirées futures encore
-- utilisables → entrée usurpable). MITIGATION appliquée : get_guest_space_v1 ne renvoie le qr_token BRUT que
-- pour les passes PRÉSENTABLES (status='issued' ET exploitation_date >= aujourd'hui) — exactement ceux que
-- l'UI affiche déjà (liveUpcomingPasses) ; pour tout pass passé/scanné/expiré/annulé, qr_token = null. On limite
-- ainsi l'historique de jetons exposé au strict nécessaire fonctionnel. Traiter le qr_token comme un porteur.
--
-- MINIMISATION (RGPD, checklist §6) : on n'expose que le strict nécessaire à l'usage « le client se retrouve ».
-- PHOTOS : aucune infrastructure de stockage photo n'existe, ET le droit à l'image n'est PAS encore recueilli
-- (aucune colonne image_consent sur guests, aucune case à l'inscription) → on n'invente RIEN et on n'expose
-- aucun drapeau photo. La page affiche un état HONNÊTE « photos à venir » sans donnée. Le recueil du droit à
-- l'image (case dédiée + colonne) est un chunk ultérieur, hors périmètre de 0019.
--
-- NIVEAU DE PREUVE visé : validation SQL statique (3) → exécution sur le LABO isolé (4).
-- ADDITIVE, NON destructive, NON prod. Idempotente. Rollback : drop des 2 fonctions + drop de la colonne
-- space_token (aucune donnée métier n'est portée par cette colonne, seulement un jeton d'accès régénérable).
-- ============================================================

begin;

-- ── 1) Jeton d'accès par client ──────────────────────────────────────────────────────────────────────
-- Colonne ajoutée de façon idempotente ; rétro-remplie pour les clients déjà en base (dont les 2050 OctoTable),
-- unique, puis NOT NULL. La valeur par défaut couvre tous les INSERT futurs (register_guest_via_invite_v1,
-- import OctoTable) sans les modifier. C'est un jeton d'ACCÈS, pas une donnée métier : régénérable à volonté.
alter table public.guests add column if not exists space_token uuid;
alter table public.guests alter column space_token set default gen_random_uuid();
update public.guests set space_token = gen_random_uuid() where space_token is null;
create unique index if not exists guests_space_token_key on public.guests(space_token);
alter table public.guests alter column space_token set not null;

-- ── 2) resolve_space_from_pass_v1 — d'un QR d'entrée vers le jeton d'espace du MÊME client ────────────
-- Utilisée par la page de confirmation d'inscription pour proposer le lien du mini-espace. Ne renvoie
-- QUE le space_token (jamais d'autre donnée). Détenir le qr_token prouve déjà l'identité du porteur.
create or replace function public.resolve_space_from_pass_v1(p_qr_token text)
returns table (found boolean, space_token uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_token text := nullif(btrim(coalesce(p_qr_token, '')), '');
  v_space uuid;
begin
  if v_token is null then
    return query select false, null::uuid; return;
  end if;
  select g.space_token into v_space
    from public.guest_passes gp
    join public.guests g on g.id = gp.guest_id
   where gp.qr_token = v_token;
  if v_space is null then
    return query select false, null::uuid; return;
  end if;
  return query select true, v_space;
end;
$$;
revoke all on function public.resolve_space_from_pass_v1(text) from public;
grant execute on function public.resolve_space_from_pass_v1(text) to anon, authenticated;

-- ── 3) get_guest_space_v1 — le contenu du mini-espace (lecture seule, données PROPRES du client) ──────
-- Renvoie un unique jsonb assemblé côté serveur. Ordre des visites/passes du plus récent au plus ancien.
-- Bornes de sécurité : au plus 100 visites et 60 passes (l'historique d'un seul client, borné par prudence).
create or replace function public.get_guest_space_v1(p_space_token uuid)
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

  select g.id, g.first_name
    into v_guest
    from public.guests g
   where g.space_token = p_space_token;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Ses visites (booked/confirmed/seated/no_show/cancelled) — MINIMISÉ : ni spend, ni party_size, ni tiers.
  select coalesce(jsonb_agg(x order by x.exploitation_date desc), '[]'::jsonb) into v_visits
  from (
    select v.exploitation_date, v.univers, v.status, v.is_host, e.title as event_title
      from public.guest_visits v
      left join public.events e on e.id = v.event_id
     where v.guest_id = v_guest.id
     order by v.exploitation_date desc
     limit 100
  ) x;

  -- Ses passes / QR d'entrée — le client peut ré-afficher SON QR (usage unique par soirée).
  -- Le qr_token BRUT n'est renvoyé que pour un pass PRÉSENTABLE (issued + soirée pas encore passée) : voir
  -- la note « AMPLIFICATION » en tête. Un pass passé/scanné/expiré/annulé remonte sans son jeton (qr_token null).
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
    'visits', v_visits,
    'passes', v_passes
  );
end;
$$;
revoke all on function public.get_guest_space_v1(uuid) from public;
grant execute on function public.get_guest_space_v1(uuid) to anon, authenticated;

commit;
