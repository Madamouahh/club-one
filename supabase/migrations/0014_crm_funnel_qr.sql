-- 0014_crm_funnel_qr.sql — FUNNEL QR d'inscription (V0, spec MODULE_CRM_CLIENTS_VIP.md §V0).
-- Le SOCLE de la capture PRINCIPALE : le client s'inscrit LUI-MÊME via un lien/QR généré par un
-- promoteur, obtient un QR d'entrée personnel, et sa présence se constate au scan à la porte.
--
-- Additif strict au-dessus de 0013 (guests/guest_visits/guest_contacts). AUCUN seed : la base ship
-- VIDE. Deux tables + trois RPC :
--   · invite_links  : le lien/QR d'invitation généré par un promoteur pour une soirée/salle.
--   · guest_passes  : le QR d'entrée personnel délivré au client inscrit (token serveur, usage suivi).
--   · create_invite_link_v1        (authenticated) : un promoteur/direction génère un lien.
--   · get_invite_link_public       (anon)          : la page publique lit un lien SÛR (aucun secret).
--   · register_guest_via_invite_v1 (anon)          : le client s'inscrit LUI-MÊME (le cœur du funnel).
--
-- SÉCURITÉ (règle 20-security-supabase) : les deux RPC anon sont SECURITY DEFINER, search_path figé,
-- GRANT EXECUTE limité (jamais PUBLIC). anon n'a AUCUN accès direct aux tables (tout passe par RPC).
-- Aucune règle métier ne fait confiance au client : le token d'entrée est généré CÔTÉ POSTGRES
-- (gen_random_uuid), le contrôle 18+ est refait en SQL, le propriétaire (owner_promoter) vient du
-- lien, jamais d'un champ client. La case marketing ne conditionne JAMAIS la délivrance du QR.
--
-- RGPD/Évin : le consentement est journalisé avec le TEXTE EXACT présenté (preuve CNIL). Aucun texte
-- de message n'est stocké/généré ici (les liens wa.me se composent côté client, garde Évin en TS).

begin;

-- ============================================================
-- 1) INVITE_LINKS — le lien/QR d'invitation (généré par un promoteur, lié à une soirée + salle).
-- ============================================================
create table if not exists public.invite_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,                       -- jeton d'URL généré CÔTÉ SERVEUR (jamais fourni par le client)
  created_by text,                                  -- username du promoteur/staff émetteur (propriété de la clientèle)
  event_id uuid references public.events(id),
  exploitation_date date not null,                  -- la soirée (chevauche minuit) — cohérent 0010/0011/0012/0013
  univers text not null check (univers in ('eden','cercle','terminus')),
  kind text not null check (kind in ('guest_list','team_vip')),
  table_ref text,                                   -- référence de table (obligatoire si team_vip) ; soft ref :
                                                    -- club_tables est réinitialisée à chaque clôture → pas de FK dure
  max_uses integer not null default 1 check (max_uses > 0),
  uses_count integer not null default 0 check (uses_count >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  -- Un QR d'équipe (team_vip) n'existe QUE rattaché à une vraie table (anti-gaming, spec §V0).
  constraint invite_links_team_needs_table
    check (kind <> 'team_vip' or (table_ref is not null and btrim(table_ref) <> ''))
);

create index if not exists invite_links_creator_idx on public.invite_links(created_by);
create index if not exists invite_links_event_idx on public.invite_links(event_id);
create index if not exists invite_links_date_idx on public.invite_links(exploitation_date);

-- ============================================================
-- 2) GUEST_PASSES — le QR d'entrée personnel du client inscrit. Scan à la porte = présence auto.
-- ============================================================
create table if not exists public.guest_passes (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  invite_link_id uuid references public.invite_links(id) on delete set null,
  event_id uuid references public.events(id),
  exploitation_date date not null,
  univers text not null check (univers in ('eden','cercle','terminus')),
  qr_token text not null unique,                    -- jeton d'entrée généré CÔTÉ SERVEUR (usage unique/soirée)
  status text not null default 'issued'
    check (status in ('issued','scanned','expired','cancelled')),
  scanned_at timestamptz,
  scanned_by text,                                  -- username du staff qui scanne à la porte (traçabilité)
  free_entry boolean not null default true,         -- invitation guest list = entrée gratuite
  is_host boolean not null default false,           -- l'hôte d'une table (team_vip)
  created_at timestamptz not null default now(),
  -- Idempotence : un seul pass par client et par lien (re-scanner le même lien ne recrée rien).
  unique (guest_id, invite_link_id)
);

create index if not exists guest_passes_guest_idx on public.guest_passes(guest_id);
create index if not exists guest_passes_link_idx on public.guest_passes(invite_link_id);
create index if not exists guest_passes_date_idx on public.guest_passes(exploitation_date);
create index if not exists guest_passes_status_idx on public.guest_passes(status);

-- ============================================================
-- 3) RLS — anon : AUCUN accès direct (tout passe par les RPC SECURITY DEFINER). Staff : cantonnement.
-- ============================================================

-- INVITE_LINKS : direction voit tout ; le promoteur voit/gère SES liens (created_by = lui).
alter table public.invite_links enable row level security;
revoke all on public.invite_links from anon;
grant select, insert, update, delete on public.invite_links to authenticated;

drop policy if exists invite_links_read on public.invite_links;
create policy invite_links_read on public.invite_links for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter' and created_by = public.current_staff_username())
  );
drop policy if exists invite_links_insert on public.invite_links;
create policy invite_links_insert on public.invite_links for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter' and created_by = public.current_staff_username())
  );
drop policy if exists invite_links_update on public.invite_links;
create policy invite_links_update on public.invite_links for update to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter' and created_by = public.current_staff_username())
  )
  with check (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter' and created_by = public.current_staff_username())
  );
drop policy if exists invite_links_delete on public.invite_links;
create policy invite_links_delete on public.invite_links for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- GUEST_PASSES : visible/gérable si le client sous-jacent l'est (direction, ou promoteur propriétaire).
alter table public.guest_passes enable row level security;
revoke all on public.guest_passes from anon;
grant select, insert, update, delete on public.guest_passes to authenticated;

drop policy if exists guest_passes_read on public.guest_passes;
create policy guest_passes_read on public.guest_passes for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_passes.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
-- Insert/update directs : direction seule (le chemin normal est la RPC anon en SECURITY DEFINER).
-- Le scan à la porte (update status→scanned) sera une RPC staff dédiée (chunk ultérieur).
drop policy if exists guest_passes_insert on public.guest_passes;
create policy guest_passes_insert on public.guest_passes for insert to authenticated
  with check (public.current_staff_role() in ('admin','manager'));
drop policy if exists guest_passes_update on public.guest_passes;
create policy guest_passes_update on public.guest_passes for update to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (public.current_staff_role() in ('admin','manager'));
drop policy if exists guest_passes_delete on public.guest_passes;
create policy guest_passes_delete on public.guest_passes for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- ============================================================
-- 4) RPC create_invite_link_v1 — un promoteur/direction génère un lien. Token CÔTÉ SERVEUR.
--    Le lien porte la soirée ACTIVE (jamais choisie par le client). created_by = l'émetteur réel.
-- ============================================================
create or replace function public.create_invite_link_v1(
  p_kind text,
  p_univers text,
  p_table_ref text,
  p_max_uses integer,
  p_expires_at timestamptz
) returns table (ok boolean, code text, message text, link_id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_username text;
  v_event_id uuid;
  v_event_date date;
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_univers text := nullif(btrim(coalesce(p_univers, '')), '');
  v_table_ref text := nullif(btrim(coalesce(p_table_ref, '')), '');
  v_max_uses integer := coalesce(p_max_uses, 1);
  v_token text;
  v_link_id uuid;
  v_attempt int;
begin
  if auth.uid() is null then
    return query select false, 'unauthorized', 'Utilisateur non autorisé.', null::uuid, null::text; return;
  end if;

  v_username := public.current_staff_username();
  v_role := public.current_staff_role();
  if v_username is null or v_role not in ('admin','manager','promoter') then
    return query select false, 'unauthorized', 'Utilisateur non autorisé.', null::uuid, null::text; return;
  end if;

  if v_kind not in ('guest_list','team_vip') then
    return query select false, 'invalid_kind', 'Type de lien invalide.', null::uuid, null::text; return;
  end if;
  if v_univers not in ('eden','cercle','terminus') then
    return query select false, 'invalid_univers', 'Salle invalide.', null::uuid, null::text; return;
  end if;
  if v_kind = 'team_vip' and v_table_ref is null then
    return query select false, 'table_required', 'Une table est obligatoire pour un QR d''équipe.', null::uuid, null::text; return;
  end if;
  if v_max_uses is null or v_max_uses <= 0 then
    return query select false, 'invalid_max_uses', 'Nombre d''usages invalide.', null::uuid, null::text; return;
  end if;

  v_event_id := public.current_active_event_id();
  v_event_date := public.current_active_event_date();
  if v_event_id is null or v_event_date is null then
    return query select false, 'missing_active_event', 'Aucun événement actif.', null::uuid, null::text; return;
  end if;

  for v_attempt in 1..5 loop
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    begin
      insert into public.invite_links (
        token, created_by, event_id, exploitation_date, univers, kind, table_ref, max_uses, expires_at
      ) values (
        v_token, v_username, v_event_id, v_event_date, v_univers, v_kind, v_table_ref, v_max_uses, p_expires_at
      ) returning id into v_link_id;
      return query select true, 'ok', 'Lien créé.', v_link_id, v_token; return;
    exception when unique_violation then
      if v_attempt = 5 then
        return query select false, 'duplicate_token', 'Génération du lien impossible.', null::uuid, null::text; return;
      end if;
    end;
  end loop;
end;
$$;
revoke all on function public.create_invite_link_v1(text, text, text, integer, timestamptz) from public;
grant execute on function public.create_invite_link_v1(text, text, text, integer, timestamptz) to authenticated;

-- ============================================================
-- 5) RPC get_invite_link_public — vue SÛRE d'un lien pour la page publique (anon). AUCUN secret.
--    N'expose ni le username staff, ni aucune donnée client : juste de quoi afficher l'invitation.
-- ============================================================
create or replace function public.get_invite_link_public(p_token text)
returns table (
  valid boolean,
  kind text,
  univers text,
  event_title text,
  exploitation_date date,
  expires_at timestamptz,
  uses_count integer,
  max_uses integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
begin
  if v_token is null then
    return query select false, null::text, null::text, null::text, null::date, null::timestamptz, 0, 0; return;
  end if;
  return query
    select true, l.kind, l.univers, e.title, l.exploitation_date, l.expires_at, l.uses_count, l.max_uses
      from public.invite_links l
      left join public.events e on e.id = l.event_id
     where l.token = v_token;
  if not found then
    return query select false, null::text, null::text, null::text, null::date, null::timestamptz, 0, 0;
  end if;
end;
$$;
revoke all on function public.get_invite_link_public(text) from public;
grant execute on function public.get_invite_link_public(text) to anon, authenticated;

-- ============================================================
-- 6) RPC register_guest_via_invite_v1 — LE CŒUR : le client s'inscrit LUI-MÊME (anon).
--    Refait TOUTES les gardes en SQL (ne fait jamais confiance au client) :
--      · lien valide, non expiré, quota non épuisé ;
--      · téléphone au format E.164 (regex) — la normalisation FR se fait côté app ;
--      · DDN présente + 18+ à la date de la soirée (L.3342-1) — sinon AUCUNE entrée en base ;
--      · dédup par téléphone (upsert) ; owner_promoter vient du LIEN (jamais du client) et n'est
--        jamais volé à un autre promoteur si le client existe déjà ;
--      · consentement journalisé avec le TEXTE EXACT ; le marketing ne conditionne PAS le QR ;
--      · QR d'entrée généré CÔTÉ SERVEUR ; idempotent (re-scan du même lien = même QR, sans conso).
-- ============================================================
create or replace function public.register_guest_via_invite_v1(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_phone_e164 text,
  p_birthday date,
  p_consent_service boolean,
  p_consent_service_text text,
  p_consent_marketing boolean,
  p_consent_marketing_text text
) returns table (ok boolean, code text, message text, qr_token text, guest_id uuid)
language plpgsql
security definer
set search_path = public
as $$
-- Les colonnes guest_id / qr_token portent le même nom que des paramètres OUT : on n'accède JAMAIS
-- aux OUT par leur nom nu dans le corps (on utilise des variables v_*), donc « use_column » lève
-- l'ambiguïté en faveur de la colonne, ce qui est le comportement voulu dans les requêtes DML.
#variable_conflict use_column
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_first text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone_e164, '')), '');
  v_link record;
  v_now timestamptz := now();
  v_guest_id uuid;
  v_owner text;
  v_is_host boolean;
  v_qr text;
  v_existing_qr text;
  v_reserved boolean := false;
  v_attempt int;
  v_svc_text text := nullif(btrim(coalesce(p_consent_service_text, '')), '');
  v_mkt_text text := nullif(btrim(coalesce(p_consent_marketing_text, '')), '');
  v_svc boolean := coalesce(p_consent_service, false);
  v_mkt boolean := coalesce(p_consent_marketing, false);
begin
  -- 6.1 Validation des champs (mêmes règles que lib/crmFunnel, refaites en SQL) -----------------
  if v_token is null then
    return query select false, 'invalid_token', 'Lien invalide.', null::text, null::uuid; return;
  end if;
  if v_first is null then
    return query select false, 'first_name_required', 'Le prénom est obligatoire.', null::text, null::uuid; return;
  end if;
  -- E.164 : « + » suivi d'un chiffre 1-9 puis 7 à 14 chiffres. La normalisation FR (0X→+33) est côté app.
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return query select false, 'phone_invalid', 'Numéro de téléphone invalide.', null::text, null::uuid; return;
  end if;
  if p_birthday is null then
    return query select false, 'birthday_required', 'La date de naissance est obligatoire.', null::text, null::uuid; return;
  end if;
  -- Consentement journalisé : cocher une case impose de fournir le texte exact présenté.
  if v_svc and v_svc_text is null then
    return query select false, 'consent_service_text_missing', 'Texte de consentement manquant.', null::text, null::uuid; return;
  end if;
  if v_mkt and v_mkt_text is null then
    return query select false, 'consent_marketing_text_missing', 'Texte de consentement manquant.', null::text, null::uuid; return;
  end if;

  -- 6.2 Verrouille le lien et vérifie sa validité (expiration, quota) ---------------------------
  select * into v_link from public.invite_links l where l.token = v_token for update;
  if not found then
    return query select false, 'unknown_link', 'Lien introuvable.', null::text, null::uuid; return;
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= v_now then
    return query select false, 'link_expired', 'Ce lien a expiré.', null::text, null::uuid; return;
  end if;

  -- 6.3 Contrôle 18+ à la DATE DE LA SOIRÉE (L.3342-1) — refait en SQL, aucune confiance au client.
  if p_birthday > (v_link.exploitation_date - interval '18 years') then
    return query select false, 'underage', 'Inscription réservée aux personnes majeures.', null::text, null::uuid; return;
  end if;

  v_owner := v_link.created_by;
  v_is_host := (v_link.kind = 'team_vip'); -- l'hôte d'un QR d'équipe ; guest_list = invité simple

  -- 6.4 Dédup par téléphone : crée le client OU met à jour de façon ADDITIVE (jamais de vol de
  --     propriété, jamais de rétrogradation d'un opt-in existant, jamais de réveil d'un opt-out).
  select id into v_guest_id from public.guests where phone = v_phone;
  if v_guest_id is null then
    insert into public.guests (
      phone, first_name, last_name, birthday, majorite_verifiee,
      consent_service, consent_service_at, consent_service_text,
      consent_marketing, consent_marketing_at, consent_marketing_text,
      consent_source, owner_promoter
    ) values (
      v_phone, v_first, v_last, p_birthday, true,
      v_svc, case when v_svc then v_now end, v_svc_text,
      v_mkt, case when v_mkt then v_now end, v_mkt_text,
      case when v_link.kind = 'team_vip' then 'qr_team' else 'qr_invite' end,
      v_owner
    ) returning id into v_guest_id;
  else
    -- Client déjà connu : on n'écrase PAS l'owner ; on n'ajoute un consentement que s'il est
    -- nouvellement donné (et jamais on ne le retire ici). majorite_verifiee passe à true.
    update public.guests g set
      majorite_verifiee = true,
      consent_service = g.consent_service or v_svc,
      consent_service_at = case when v_svc and g.consent_service_at is null then v_now else g.consent_service_at end,
      consent_service_text = case when v_svc and g.consent_service_text is null then v_svc_text else g.consent_service_text end,
      consent_marketing = g.consent_marketing or (v_mkt and g.opt_out_at is null),
      consent_marketing_at = case when v_mkt and g.opt_out_at is null and g.consent_marketing_at is null then v_now else g.consent_marketing_at end,
      consent_marketing_text = case when v_mkt and g.opt_out_at is null and g.consent_marketing_text is null then v_mkt_text else g.consent_marketing_text end,
      updated_at = v_now
    where g.id = v_guest_id;
  end if;

  -- 6.5 Idempotence : si ce client a DÉJÀ un pass pour ce lien, on le renvoie (aucune conso de quota).
  select gp.qr_token into v_existing_qr from public.guest_passes gp
   where gp.guest_id = v_guest_id and gp.invite_link_id = v_link.id;
  if v_existing_qr is not null then
    -- Assure aussi la visite « booked » (idempotente) puis renvoie le pass existant.
    insert into public.guest_visits (guest_id, event_id, exploitation_date, univers, status, is_host, created_by)
    values (v_guest_id, v_link.event_id, v_link.exploitation_date, v_link.univers, 'booked', v_is_host, 'qr_funnel')
    on conflict (guest_id, exploitation_date, univers) do nothing;
    return query select true, 'already_registered', 'Déjà inscrit : voici votre QR.', v_existing_qr, v_guest_id; return;
  end if;

  -- 6.6 Réserve un usage du lien de façon ATOMIQUE (protège le quota même en concurrence).
  update public.invite_links
     set uses_count = uses_count + 1
   where id = v_link.id and uses_count < max_uses;
  if not found then
    return query select false, 'link_exhausted', 'Ce lien a atteint son quota.', null::text, null::uuid; return;
  end if;
  v_reserved := true;

  -- 6.7 Génère le QR d'entrée CÔTÉ SERVEUR et crée le pass + la visite « booked ».
  for v_attempt in 1..5 loop
    v_qr := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    begin
      insert into public.guest_passes (
        guest_id, invite_link_id, event_id, exploitation_date, univers, qr_token, free_entry, is_host
      ) values (
        v_guest_id, v_link.id, v_link.event_id, v_link.exploitation_date, v_link.univers, v_qr, true, v_is_host
      );
      insert into public.guest_visits (guest_id, event_id, exploitation_date, univers, status, is_host, created_by)
      values (v_guest_id, v_link.event_id, v_link.exploitation_date, v_link.univers, 'booked', v_is_host, 'qr_funnel')
      on conflict (guest_id, exploitation_date, univers) do nothing;
      return query select true, 'ok', 'Inscription confirmée.', v_qr, v_guest_id; return;
    exception when unique_violation then
      -- Collision improbable du qr_token → on réessaie SANS reconsommer le quota.
      if v_attempt = 5 then
        raise exception 'qr_token generation failed' using errcode = 'internal_error';
      end if;
    end;
  end loop;
end;
$$;
revoke all on function public.register_guest_via_invite_v1(text, text, text, text, date, boolean, text, boolean, text) from public;
grant execute on function public.register_guest_via_invite_v1(text, text, text, text, date, boolean, text, boolean, text) to anon, authenticated;

commit;
