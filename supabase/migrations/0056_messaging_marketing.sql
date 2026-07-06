-- 0056_messaging_marketing.sql — MODULE MESSAGERIE / MARKETING (F5 infra messages + F4 codes promo + F1 audiences).
-- Structure seule, ship VIDE. Additif strict / idempotent / réversible.
--
-- Ce module fournit l'INFRASTRUCTURE d'envoi (file d'attente + gabarits + audiences de campagne + codes promo),
-- MAIS reste PROVIDER-NEUTRE et DRY_RUN. AUCUN fournisseur externe (Twilio/SendGrid/WhatsApp/FCM) n'est appelé,
-- importé ni configuré ici. Le « send » côté application est un OUTBOX local qui ne fait que muter le statut
-- d'une ligne (queued → sent), jamais un appel réseau. PRÊT À CONNECTER — NON ACTIVÉ.
--
--   · `message_templates`   : gabarits de message (clé unique, canal, sujet, corps, locale, actif).
--   · `message_queue`       : file d'attente/outbox local (canal, destinataire, gabarit, payload, statut, dédup,
--                             planification, tentatives). Le statut est muté par l'application DRY_RUN, pas par un réseau.
--   · `campaign_audiences`  : segments d'une campagne (critères jsonb) — référence marketing_campaigns (0050).
--   · `campaign_recipients` : destinataires effectifs d'une campagne (lien vers message_queue), 1 ligne / (campagne, guest).
--   · `promo_codes`         : codes promo (remise %, montant), plafonds de rédemption globaux et par guest.
--   · `promo_redemptions`   : rédemptions effectives (1 par (code, guest) tant que per_guest_limit=1, enforcé app + index).
--
-- Références EXTERNES (non redéfinies ici) : public.marketing_campaigns (0050), public.guests (0013).
--
-- RLS : lecture ET écriture direction (admin/manager) fail-closed — données de gestion marketing, pas de lecture
-- staff-op ni promoter. Grants DML `authenticated` explicites (RLS filtre). Aucun grant anon (revoke explicite).

begin;

-- ============================================================
-- 1) MESSAGE_TEMPLATES — gabarits de message (SANS alcool, cf. loi Évin ; le texte est validé hors-schéma).
-- ============================================================
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                       -- clé stable référencée par message_queue.template_key
  channel text not null default 'sms'
    check (channel in ('sms','email','whatsapp','push')),
  subject text,                                   -- sujet (email surtout ; null pour sms/whatsapp/push)
  body text not null default '',                  -- corps du gabarit (placeholders {{...}} résolus côté app)
  locale text not null default 'fr',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_templates_channel_idx on public.message_templates (channel);
create index if not exists message_templates_active_idx on public.message_templates (active);

-- ============================================================
-- 2) MESSAGE_QUEUE — file d'attente / OUTBOX local. Le « send » est une mutation de statut (DRY_RUN), pas un réseau.
-- ============================================================
create table if not exists public.message_queue (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'sms'
    check (channel in ('sms','email','whatsapp','push')),
  guest_id uuid references public.guests(id) on delete set null,  -- facultatif (message hors répertoire possible)
  to_address text,                                -- numéro/email de destination (résolu côté app)
  template_key text,                              -- clé de gabarit (references logique message_templates.key)
  payload jsonb not null default '{}'::jsonb,     -- variables de rendu + métadonnées (aucune donnée sensible imposée)
  status text not null default 'queued'
    check (status in ('queued','sending','sent','failed','skipped','opted_out')),
  dedup_key text,                                 -- clé d'idempotence applicative (null = pas de dédup)
  scheduled_at timestamptz,                        -- planification (null = dès que possible)
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Dédup : au plus une ligne active par dedup_key non-null (idempotence de l'enqueue).
create unique index if not exists message_queue_dedup_key_uidx
  on public.message_queue (dedup_key) where dedup_key is not null;
create index if not exists message_queue_status_idx on public.message_queue (status);
create index if not exists message_queue_scheduled_idx on public.message_queue (scheduled_at);
create index if not exists message_queue_guest_idx on public.message_queue (guest_id);
create index if not exists message_queue_template_idx on public.message_queue (template_key);

-- ============================================================
-- 3) CAMPAIGN_AUDIENCES — segments d'une campagne (critères jsonb). Référence marketing_campaigns (0050).
-- ============================================================
create table if not exists public.campaign_audiences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  segment_key text not null,                      -- identifiant de segment (ex. 'vip_90d', 'dormant_180d')
  criteria jsonb not null default '{}'::jsonb,     -- critères déclaratifs (résolus côté app, pas de PII imposée)
  created_at timestamptz not null default now()
);

create index if not exists campaign_audiences_campaign_idx on public.campaign_audiences (campaign_id);
create index if not exists campaign_audiences_segment_idx on public.campaign_audiences (segment_key);

-- ============================================================
-- 4) CAMPAIGN_RECIPIENTS — destinataires effectifs (1 ligne / campagne / guest). Lien vers message_queue.
-- ============================================================
create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  message_id uuid references public.message_queue(id) on delete set null,  -- message émis (facultatif tant que non enqueue)
  status text not null default 'pending',         -- pending / queued / sent / skipped / opted_out (miroir applicatif)
  created_at timestamptz not null default now(),
  unique (campaign_id, guest_id)                  -- idempotence : un destinataire par campagne
);

create index if not exists campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id);
create index if not exists campaign_recipients_guest_idx on public.campaign_recipients (guest_id);
create index if not exists campaign_recipients_status_idx on public.campaign_recipients (status);

-- ============================================================
-- 5) PROMO_CODES — codes promo (remise % ou montant), plafonds global + par guest.
-- ============================================================
create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                       -- code saisi par le client (normalisé côté app, ex. MAJUSCULE)
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,  -- rattachement facultatif
  discount_type text not null default 'percent'
    check (discount_type in ('percent','amount')),
  discount_value_cents integer not null default 0 check (discount_value_cents >= 0), -- percent: 0..100(*100? non) → app borne
  max_redemptions integer check (max_redemptions is null or max_redemptions >= 0),   -- null = illimité
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  per_guest_limit integer not null default 1 check (per_guest_limit >= 0),
  valid_from date,
  valid_until date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists promo_codes_campaign_idx on public.promo_codes (campaign_id);
create index if not exists promo_codes_active_idx on public.promo_codes (active);

-- ============================================================
-- 6) PROMO_REDEMPTIONS — rédemptions effectives. Unicité (code, guest) : per_guest_limit=1 enforcé app + cet index.
-- ============================================================
create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  guest_id uuid references public.guests(id) on delete set null,
  reservation_id uuid,                             -- réservation liée (facultatif, pas de FK cross-module imposée)
  redeemed_at timestamptz not null default now()
);

-- Unicité (code, guest) : garde-fou du cas per_guest_limit=1 (le cas > 1 est géré côté app).
create unique index if not exists promo_redemptions_code_guest_uidx
  on public.promo_redemptions (promo_code_id, guest_id) where guest_id is not null;
create index if not exists promo_redemptions_code_idx on public.promo_redemptions (promo_code_id);
create index if not exists promo_redemptions_guest_idx on public.promo_redemptions (guest_id);

-- ============================================================
-- 7) RLS + GRANTS — direction (admin/manager) fail-closed partout. authenticated only, jamais anon.
-- ============================================================

-- MESSAGE_TEMPLATES
alter table public.message_templates enable row level security;
revoke all on public.message_templates from anon;
grant select, insert, update, delete on public.message_templates to authenticated;
drop policy if exists message_templates_select_direction on public.message_templates;
create policy message_templates_select_direction on public.message_templates
  for select to authenticated
  using (public.current_staff_role() = any (array['admin','manager']));
drop policy if exists message_templates_write_direction on public.message_templates;
create policy message_templates_write_direction on public.message_templates
  for all to authenticated
  using (public.current_staff_role() = any (array['admin','manager']))
  with check (public.current_staff_role() = any (array['admin','manager']));

-- MESSAGE_QUEUE
alter table public.message_queue enable row level security;
revoke all on public.message_queue from anon;
grant select, insert, update, delete on public.message_queue to authenticated;
drop policy if exists message_queue_select_direction on public.message_queue;
create policy message_queue_select_direction on public.message_queue
  for select to authenticated
  using (public.current_staff_role() = any (array['admin','manager']));
drop policy if exists message_queue_write_direction on public.message_queue;
create policy message_queue_write_direction on public.message_queue
  for all to authenticated
  using (public.current_staff_role() = any (array['admin','manager']))
  with check (public.current_staff_role() = any (array['admin','manager']));

-- CAMPAIGN_AUDIENCES
alter table public.campaign_audiences enable row level security;
revoke all on public.campaign_audiences from anon;
grant select, insert, update, delete on public.campaign_audiences to authenticated;
drop policy if exists campaign_audiences_select_direction on public.campaign_audiences;
create policy campaign_audiences_select_direction on public.campaign_audiences
  for select to authenticated
  using (public.current_staff_role() = any (array['admin','manager']));
drop policy if exists campaign_audiences_write_direction on public.campaign_audiences;
create policy campaign_audiences_write_direction on public.campaign_audiences
  for all to authenticated
  using (public.current_staff_role() = any (array['admin','manager']))
  with check (public.current_staff_role() = any (array['admin','manager']));

-- CAMPAIGN_RECIPIENTS
alter table public.campaign_recipients enable row level security;
revoke all on public.campaign_recipients from anon;
grant select, insert, update, delete on public.campaign_recipients to authenticated;
drop policy if exists campaign_recipients_select_direction on public.campaign_recipients;
create policy campaign_recipients_select_direction on public.campaign_recipients
  for select to authenticated
  using (public.current_staff_role() = any (array['admin','manager']));
drop policy if exists campaign_recipients_write_direction on public.campaign_recipients;
create policy campaign_recipients_write_direction on public.campaign_recipients
  for all to authenticated
  using (public.current_staff_role() = any (array['admin','manager']))
  with check (public.current_staff_role() = any (array['admin','manager']));

-- PROMO_CODES
alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon;
grant select, insert, update, delete on public.promo_codes to authenticated;
drop policy if exists promo_codes_select_direction on public.promo_codes;
create policy promo_codes_select_direction on public.promo_codes
  for select to authenticated
  using (public.current_staff_role() = any (array['admin','manager']));
drop policy if exists promo_codes_write_direction on public.promo_codes;
create policy promo_codes_write_direction on public.promo_codes
  for all to authenticated
  using (public.current_staff_role() = any (array['admin','manager']))
  with check (public.current_staff_role() = any (array['admin','manager']));

-- PROMO_REDEMPTIONS
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_redemptions from anon;
grant select, insert, update, delete on public.promo_redemptions to authenticated;
drop policy if exists promo_redemptions_select_direction on public.promo_redemptions;
create policy promo_redemptions_select_direction on public.promo_redemptions
  for select to authenticated
  using (public.current_staff_role() = any (array['admin','manager']));
drop policy if exists promo_redemptions_write_direction on public.promo_redemptions;
create policy promo_redemptions_write_direction on public.promo_redemptions
  for all to authenticated
  using (public.current_staff_role() = any (array['admin','manager']))
  with check (public.current_staff_role() = any (array['admin','manager']));

commit;
