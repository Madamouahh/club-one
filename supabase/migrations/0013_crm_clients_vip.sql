-- 0013_crm_clients_vip.sql — Module CRM CLIENTS VIP (V0, le SOCLE) : STRUCTURE seule, AUCUN client inventé.
-- Équivalent SQL gratuit de SevenRooms/TablelistPro : classifier les meilleurs clients de table
-- (dépense, récurrence), apprendre de leurs passages, remplir chaque soirée via des liens wa.me
-- que L'HUMAIN clique (aucun envoi automatisé — voir lib/crmClients + spec MODULE_CRM_CLIENTS_VIP.md).
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed — la base ship VIDE. Les vrais
-- clients sont captés à la résa, avec consentement horodaté et journalisé (preuve CNIL). Rien n'est
-- fabriqué : pas de client fictif, pas de dépense inventée (spend_attributed NULL = non identifié).
--
-- RGPD (France) — garde-fous inscrits DANS le schéma, pas seulement dans l'UI :
--   · consentement DÉGROUPÉ : service (contractuel, « table prête ») ≠ marketing (opt-in prospection) ;
--     chaque case a son booléen + son horodatage + le TEXTE EXACT présenté (journalisation = preuve) ;
--   · opt-out DÉFINITIF : une fois opt_out_at renseigné, un trigger interdit sa remise à NULL sauf
--     par un admin (le STOP ne se « dé-coche » pas par erreur) ;
--   · minimisation : pas de colonne « comportement/ébriété » ; notes = usage commercial neutre ;
--   · majorité : majorite_verifiee obligatoire à true — aucun mineur en base marketing (L.3342-1) ;
--   · propriété : owner_promoter est EN base (la clientèle appartient à l'établissement, pas au
--     téléphone perso du promoteur) ; la RLS cantonne le promoteur à SES clients.
--   · conservation : last_inbound_contact_at porte la date du dernier contact ENTRANT → base d'une
--     purge à 3 ans (référentiel CNIL gestion commerciale). La purge elle-même n'est PAS un DELETE
--     automatique ici (opération destructive = décision explicite) : la colonne rend la purge calculable.
--
-- LOI ÉVIN (art. L.3323-2 / L.3351-7 CSP, sanction 75 000 €) : AUCUN texte de message n'est stocké
-- ni généré ici. Les messages (liens wa.me) se composent côté client à partir de gabarits SANS alcool,
-- validés par le fondateur (voir lib/crmClients : garde Évin + constantes de consentement EXACTES).

begin;

-- ============================================================
-- 1) GUESTS — le répertoire clients (VIDE tant qu'aucune résa n'est captée). Clé de dédup = téléphone.
-- ============================================================
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,                      -- E.164 (+33…) — clé de déduplication, normalisée côté app
  first_name text not null,
  last_name text,
  birthday date,                                   -- demandé à la 2ᵉ visite, jamais à la 1ʳᵉ (spec)
  majorite_verifiee boolean not null default false,-- 18+ vérifié AVANT entrée en base marketing (L.3342-1)

  -- Consentement DÉGROUPÉ + journalisé (chaque case : booléen + quand + quel texte exact) = preuve CNIL.
  consent_service boolean not null default false,  -- « confirmations liées à ma réservation » (contractuel)
  consent_service_at timestamptz,
  consent_service_text text,                        -- texte EXACT présenté au moment du consentement
  consent_marketing boolean not null default false,-- « invitations aux soirées + agenda mensuel » (opt-in)
  consent_marketing_at timestamptz,
  consent_marketing_text text,
  consent_source text,                              -- où/comment recueilli (ex. « résa table EDEN »)

  opt_out_at timestamptz,                           -- STOP reçu = flag bloquant DÉFINITIF (trigger ci-dessous)
  owner_promoter text,                              -- username staff propriétaire (la donnée est à l'établissement)
  last_inbound_contact_at timestamptz,             -- dernier contact ENTRANT (base du calcul de purge 3 ans)
  notes text,                                       -- usage commercial neutre (minimisation : pas d'ébriété/comportement)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guests_owner_idx on public.guests(owner_promoter);
create index if not exists guests_optout_idx on public.guests(opt_out_at);
create index if not exists guests_marketing_idx on public.guests(consent_marketing) where opt_out_at is null;

-- ============================================================
-- 2) GUEST_VISITS — historique des passages (le producteur du scoring RFM). 1 visite / client / soirée / univers.
-- ============================================================
create table if not exists public.guest_visits (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  event_id uuid references public.events(id),
  exploitation_date date not null,                  -- la soirée (chevauche minuit) — cohérent 0010/0011/0012
  univers text not null check (univers in ('eden','cercle','terminus')), -- un client est dans UNE salle concrète
  status text not null default 'booked'
    check (status in ('booked','confirmed','seated','no_show','cancelled')),
  party_size integer check (party_size is null or party_size > 0),
  is_host boolean not null default false,           -- l'hôte de table (celui qui réserve/paie)
  spend_attributed numeric(10,2)                    -- dépense attribuée à ce client ; NULL = non identifié
    check (spend_attributed is null or spend_attributed >= 0),
  created_by text,                                  -- username du saisisseur (traçabilité, pas une sécurité)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guest_id, exploitation_date, univers)     -- idempotence : une visite par client / soirée / salle
);

create index if not exists guest_visits_guest_idx on public.guest_visits(guest_id);
create index if not exists guest_visits_date_idx on public.guest_visits(exploitation_date);
create index if not exists guest_visits_event_idx on public.guest_visits(event_id);
create index if not exists guest_visits_status_idx on public.guest_visits(status);

-- ============================================================
-- 3) GUEST_CONTACTS — journal des sollicitations (call-list du mardi, résultat tracé par promoteur).
-- ============================================================
create table if not exists public.guest_contacts (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  staff_username text,                              -- promoteur/staff qui a contacté (mesure de perf)
  channel text not null default 'whatsapp'
    check (channel in ('whatsapp','phone','sms','in_person','other')),
  purpose text                                      -- motif (invitation soirée, confirmation J-1, relance dormant…)
    check (purpose is null or purpose in
      ('invitation','confirmation','relance_dormant','anniversaire','one_shot','autre')),
  outcome text                                      -- résultat mesuré (perf promoteur)
    check (outcome is null or outcome in ('booked','no_answer','declined','opt_out')),
  direction text not null default 'outbound'
    check (direction in ('outbound','inbound')),    -- inbound alimente last_inbound_contact_at (purge 3 ans)
  contacted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists guest_contacts_guest_idx on public.guest_contacts(guest_id);
create index if not exists guest_contacts_staff_idx on public.guest_contacts(staff_username);
create index if not exists guest_contacts_when_idx on public.guest_contacts(contacted_at);

-- ============================================================
-- 4) GUEST_SCORES — VUE de scoring RFM (récence/fréquence/montant/no-show), pas de ML, 0 donnée stockée.
--    security_invoker = on : la vue applique la RLS du rôle qui l'interroge (un promoteur ne voit
--    donc QUE ses clients via la policy guests_read ci-dessous). Aucune donnée n'est dupliquée.
-- ============================================================
create or replace view public.guest_scores
with (security_invoker = on) as
select
  g.id                                    as guest_id,
  g.first_name,
  g.last_name,
  g.owner_promoter,
  max(v.exploitation_date) filter (where v.status = 'seated')            as last_seated_date,
  count(*)     filter (where v.status = 'seated'
                         and v.exploitation_date >= (now()::date - 90))  as visits_seated_90d,
  count(*)     filter (where v.status = 'seated'
                         and v.exploitation_date >= (now()::date - 180)) as visits_seated_180d,
  count(*)     filter (where v.status = 'seated'
                         and v.exploitation_date >= (now()::date - 365)) as visits_seated_12m,
  sum(v.spend_attributed) filter (where v.status = 'seated'
                         and v.exploitation_date >= (now()::date - 365)) as spend_seated_12m,
  count(*)     filter (where v.status = 'seated')                        as visits_seated_total,
  count(*)     filter (where v.status = 'no_show')                       as no_shows_total,
  count(*)     filter (where v.status in ('seated','no_show'))           as visits_resolved_total,
  avg(v.party_size) filter (where v.status = 'seated')                   as avg_party_size,
  -- Univers préféré = salle la plus fréquentée en « seated ». Sous-requête corrélée (et non
  -- mode() WITHIN GROUP … FILTER, non supporté par PostgreSQL sur un agrégat ordonné).
  (select v2.univers
     from public.guest_visits v2
    where v2.guest_id = g.id and v2.status = 'seated'
    group by v2.univers
    order by count(*) desc, v2.univers
    limit 1)                                                             as univers_prefere
from public.guests g
left join public.guest_visits v on v.guest_id = g.id
where g.opt_out_at is null
group by g.id, g.first_name, g.last_name, g.owner_promoter;

-- ============================================================
-- 5) RLS — admin/manager : tout. promoteur : SES clients (owner_promoter = son username). Autres : rien.
--    Le portier/serveur n'accède PAS à la base marketing (tél/spend) : un besoin « soirée en cours »
--    (prénom + statut) passerait par une vue dédiée ultérieure, pas par un accès direct.
-- ============================================================

-- GUESTS
alter table public.guests enable row level security;
revoke all on public.guests from anon;
grant select, insert, update, delete on public.guests to authenticated;

drop policy if exists guests_read on public.guests;
create policy guests_read on public.guests for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter' and owner_promoter = public.current_staff_username())
  );
-- Insert : direction, ou un promoteur qui crée un client À SON nom (jamais au nom d'un autre).
drop policy if exists guests_insert on public.guests;
create policy guests_insert on public.guests for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter' and owner_promoter = public.current_staff_username())
  );
-- Update : direction, ou le promoteur propriétaire (ne peut PAS modifier le client d'autrui).
drop policy if exists guests_update on public.guests;
create policy guests_update on public.guests for update to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter' and owner_promoter = public.current_staff_username())
  )
  with check (
    public.current_staff_role() in ('admin','manager')
    or (public.current_staff_role() = 'promoter' and owner_promoter = public.current_staff_username())
  );
-- Delete : direction seule (droit à l'effacement RGPD = acte maîtrisé, jamais un promoteur seul).
drop policy if exists guests_delete on public.guests;
create policy guests_delete on public.guests for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- GUEST_VISITS — visible/éditable si le client sous-jacent l'est (direction, ou promoteur propriétaire).
alter table public.guest_visits enable row level security;
revoke all on public.guest_visits from anon;
grant select, insert, update, delete on public.guest_visits to authenticated;

drop policy if exists guest_visits_read on public.guest_visits;
create policy guest_visits_read on public.guest_visits for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_visits.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
drop policy if exists guest_visits_insert on public.guest_visits;
create policy guest_visits_insert on public.guest_visits for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_visits.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
drop policy if exists guest_visits_update on public.guest_visits;
create policy guest_visits_update on public.guest_visits for update to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_visits.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  )
  with check (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_visits.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
drop policy if exists guest_visits_delete on public.guest_visits;
create policy guest_visits_delete on public.guest_visits for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- GUEST_CONTACTS — même cantonnement (le journal des sollicitations suit la propriété du client).
alter table public.guest_contacts enable row level security;
revoke all on public.guest_contacts from anon;
grant select, insert, delete on public.guest_contacts to authenticated;

drop policy if exists guest_contacts_read on public.guest_contacts;
create policy guest_contacts_read on public.guest_contacts for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_contacts.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
drop policy if exists guest_contacts_insert on public.guest_contacts;
create policy guest_contacts_insert on public.guest_contacts for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager')
    or exists (
      select 1 from public.guests g
       where g.id = guest_contacts.guest_id
         and public.current_staff_role() = 'promoter'
         and g.owner_promoter = public.current_staff_username()
    )
  );
drop policy if exists guest_contacts_delete on public.guest_contacts;
create policy guest_contacts_delete on public.guest_contacts for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- ============================================================
-- 6) TRIGGER — l'opt-out (STOP) est DÉFINITIF : seul un admin peut remettre opt_out_at à NULL.
--    SECURITY DEFINER + search_path figé (règle 20-security-supabase). Bloque aussi anon (rôle null).
-- ============================================================
create or replace function public.guard_guest_optout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.opt_out_at is not null and new.opt_out_at is null then
    if public.current_staff_role() is distinct from 'admin' then
      raise exception 'opt_out_at ne peut être remis à NULL que par un admin (STOP définitif)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_guest_optout() from public;

drop trigger if exists guests_guard_optout on public.guests;
create trigger guests_guard_optout
  before update on public.guests
  for each row
  execute function public.guard_guest_optout();

commit;
