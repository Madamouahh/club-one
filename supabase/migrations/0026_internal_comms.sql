-- 0026_internal_comms.sql — Module COMMUNICATION INTERNE (A7) : STRUCTURE seule, ship VIDE.
--
-- Le journal de communication de soirée (messages courts, annonces manager, alertes, bouton
-- urgence interne, tâches) avec ses accusés de lecture. La matrice d'accès (CLUB_ONE_OS_MASTER
-- §4.2, ligne A7 « Comm interne ») est imposée par la RLS, JAMAIS par simple masquage d'UI :
--   · admin / manager           : lecture COMPLÈTE (supervision) + peuvent poster une ANNONCE ;
--   · server / security /
--     security_counter          : « 👁➕ » — lisent le fil diffusé (broadcast), ce qui les cible
--                                   (target_role / assignee) et leurs propres messages ; peuvent
--                                   poster un message/alerte/urgence/tâche, PAS une « annonce » ;
--   · promoter / artiste        : « ⛔ » — aucun accès (ni lecture ni écriture).
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed — le module SHIP VIDE (aucun
-- message inventé) : tout le contenu est produit AU RUNTIME par le staff réel. Pas de RPC
-- SECURITY DEFINER (comme le module Incidents 0023) : écritures directes sous RLS, avec
-- auteur_username / reader_username fixés côté serveur par current_staff_username() → aucune
-- usurpation d'auteur possible.
--
-- Statut : NON exécutée (revue statique niveau 3). Cible = projet Supabase LABO isolé, jamais la
-- base opérationnelle. Additive et transactionnelle (begin/commit) ; aucun DROP de table.

begin;

-- ============================================================
-- 1) INTERNAL_MESSAGES — le journal (VIDE tant qu'aucun message réel n'est posté)
-- ============================================================
create table if not exists public.internal_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id),
  exploitation_date date not null,                     -- la soirée concernée (chevauche minuit)
  kind text not null check (kind in (
    'message',   -- message court (tous les rôles avec accès)
    'annonce',   -- annonce manager (admin/manager uniquement — cf. RLS insert)
    'alerte',    -- alerte opérationnelle
    'urgence',   -- bouton urgence interne
    'tache'      -- tâche (attend un accusé de lecture ; peut cibler un rôle/une personne)
  )),
  body text not null check (length(btrim(body)) > 0),  -- contenu non vide (jamais un message fantôme)
  target_role text check (target_role is null or target_role in (
    'admin','manager','server','security','security_counter'
  )),                                                  -- null = diffusion à tous les rôles avec accès
  assignee_username text,                              -- null = pas d'assignation nominative
  auteur_username text not null default public.current_staff_username(),  -- fixé serveur, jamais client
  resolved_at timestamptz,                             -- null = ouvert (tâche/urgence non traitée)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_messages_event_idx on public.internal_messages(event_id);
create index if not exists internal_messages_date_idx on public.internal_messages(exploitation_date);
create index if not exists internal_messages_kind_idx on public.internal_messages(kind);
create index if not exists internal_messages_auteur_idx on public.internal_messages(auteur_username);
create index if not exists internal_messages_assignee_idx on public.internal_messages(assignee_username);

-- ============================================================
-- 2) INTERNAL_MESSAGE_READS — accusés de lecture (VIDE ; un accusé par lecteur par message)
-- ============================================================
create table if not exists public.internal_message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.internal_messages(id) on delete cascade,
  reader_username text not null default public.current_staff_username(),  -- fixé serveur
  created_at timestamptz not null default now(),
  unique (message_id, reader_username)                 -- un seul accusé par lecteur et par message
);

create index if not exists internal_message_reads_message_idx on public.internal_message_reads(message_id);
create index if not exists internal_message_reads_reader_idx on public.internal_message_reads(reader_username);

-- ============================================================
-- 3) RLS — matrice A7, imposée en base (pas par l'UI)
-- ============================================================
-- INTERNAL_MESSAGES
alter table public.internal_messages enable row level security;
revoke all on public.internal_messages from anon;
grant select, insert, update on public.internal_messages to authenticated;

-- Lecture : admin/manager voient TOUT (supervision) ; server/security/security_counter voient le
-- fil diffusé (broadcast), ce qui cible leur rôle ou eux nommément, et leurs propres messages ;
-- promoter/artiste ne matchent aucune branche → aucune ligne (⛔).
drop policy if exists internal_messages_read on public.internal_messages;
create policy internal_messages_read on public.internal_messages for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or (
      public.current_staff_role() in ('server','security','security_counter')
      and (
        (target_role is null and assignee_username is null)          -- diffusion générale
        or target_role = public.current_staff_role()                 -- ciblé sur mon rôle
        or assignee_username = public.current_staff_username()        -- assigné à moi
        or auteur_username = public.current_staff_username()          -- posté par moi
      )
    )
  );

-- Écriture : les 5 rôles avec accès peuvent poster ; SEULS admin/manager peuvent poster une
-- « annonce ». auteur_username doit être l'utilisateur courant → pas d'usurpation.
drop policy if exists internal_messages_insert on public.internal_messages;
create policy internal_messages_insert on public.internal_messages for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager','server','security','security_counter')
    and auteur_username = public.current_staff_username()
    and (kind <> 'annonce' or public.current_staff_role() in ('admin','manager'))
  );

-- Mutation (marquer une tâche/urgence résolue) : direction OU l'auteur du message. Les autres
-- rôles ne peuvent pas modifier le fil d'autrui.
drop policy if exists internal_messages_update on public.internal_messages;
create policy internal_messages_update on public.internal_messages for update to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or auteur_username = public.current_staff_username()
  )
  with check (
    public.current_staff_role() in ('admin','manager')
    or auteur_username = public.current_staff_username()
  );

-- INTERNAL_MESSAGE_READS (accusés de lecture)
alter table public.internal_message_reads enable row level security;
revoke all on public.internal_message_reads from anon;
grant select, insert on public.internal_message_reads to authenticated;

-- Lecture des accusés : admin/manager voient tout ; l'auteur voit qui a lu SES messages ; chacun
-- voit ses propres accusés. (Le lecteur ne peut accuser que des messages qu'il peut voir, garanti
-- par la RLS de select ci-dessus au moment où le front lit le message.)
drop policy if exists internal_message_reads_read on public.internal_message_reads;
create policy internal_message_reads_read on public.internal_message_reads for select to authenticated
  using (
    public.current_staff_role() in ('admin','manager')
    or reader_username = public.current_staff_username()
    or message_id in (
      select m.id from public.internal_messages m
      where m.auteur_username = public.current_staff_username()
    )
  );

-- Écriture d'un accusé : les 5 rôles avec accès, pour eux-mêmes, et uniquement sur un message
-- qu'ils peuvent lire (la sous-requête est filtrée par la RLS select de internal_messages).
drop policy if exists internal_message_reads_insert on public.internal_message_reads;
create policy internal_message_reads_insert on public.internal_message_reads for insert to authenticated
  with check (
    public.current_staff_role() in ('admin','manager','server','security','security_counter')
    and reader_username = public.current_staff_username()
    and message_id in (select m.id from public.internal_messages m)
  );

commit;
