-- 0067_loyalty.sql — MOTEUR DE FIDÉLITÉ (Vague 6) : points + paliers (tiers), 100 % staff-géré.
--
-- Un VRAI moteur de fidélité, sans intégration externe : chaque client (guests, 0013) possède AU PLUS un
-- compte de points (loyalty_accounts) alimenté/débité par la direction. Chaque mouvement est journalisé
-- (loyalty_ledger) — le solde est TOUJOURS reconstituable depuis le journal (delta signé + raison + auteur).
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed — la base ship VIDE (aucun point inventé).
-- Le palier (tier) est DÉRIVÉ du solde de points (jamais saisi à la main) via public.loyalty_tier().
--
-- Sécurité (règle 20-security-supabase) :
--   · toute écriture passe par une RPC SECURITY DEFINER (search_path=public figé, admin/manager only) ;
--     les tables n'accordent QUE le SELECT à authenticated → aucun INSERT/UPDATE/DELETE direct possible.
--   · RLS fail-closed via current_staff_role() : seule la direction lit ; anon n'a AUCUN privilège.
--   · loyalty_redeem_v1 REFUSE tout débit qui rendrait le solde négatif (atomique, verrou de ligne).

begin;

-- ============================================================
-- 0) HELPER — palier dérivé du solde (SEUILS = source de vérité, miroir de lib/loyalty.ts).
--    IMMUTABLE : dépend uniquement de son argument. search_path figé par prudence.
-- ============================================================
create or replace function public.loyalty_tier(p_points integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_points, 0) >= 5000 then 'platinum'
    when coalesce(p_points, 0) >= 1500 then 'gold'
    when coalesce(p_points, 0) >= 500  then 'silver'
    else 'bronze'
  end;
$$;
revoke all on function public.loyalty_tier(integer) from public;
grant execute on function public.loyalty_tier(integer) to authenticated;

-- ============================================================
-- 1) LOYALTY_ACCOUNTS — un compte de points par client (unique). Palier dérivé, jamais saisi.
-- ============================================================
create table if not exists public.loyalty_accounts (
  guest_id uuid primary key references public.guests(id) on delete cascade, -- 1 compte / client (unique)
  points integer not null default 0 check (points >= 0),                    -- solde courant, jamais négatif
  tier text not null default 'bronze'
    check (tier in ('bronze','silver','gold','platinum')),                  -- DÉRIVÉ du solde (loyalty_tier)
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2) LOYALTY_LEDGER — journal immuable des mouvements (le solde est la somme des delta).
-- ============================================================
create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests(id) on delete cascade,
  delta integer not null check (delta <> 0),        -- + = accrual (gain), − = redeem (dépense de points)
  reason text,                                       -- motif libre (ex. « visite EDEN », « bouteille offerte »)
  created_by text,                                   -- username staff (traçabilité, pas une sécurité)
  created_at timestamptz not null default now()
);

create index if not exists loyalty_ledger_guest_idx on public.loyalty_ledger(guest_id);
create index if not exists loyalty_ledger_when_idx on public.loyalty_ledger(created_at);

-- ============================================================
-- 3) RLS — direction lit ; anon rien ; écriture EXCLUSIVEMENT via RPC SECURITY DEFINER (aucun grant W direct).
-- ============================================================
alter table public.loyalty_accounts enable row level security;
revoke all on public.loyalty_accounts from anon;
grant select on public.loyalty_accounts to authenticated;

drop policy if exists loyalty_accounts_read on public.loyalty_accounts;
create policy loyalty_accounts_read on public.loyalty_accounts for select to authenticated
  using (public.current_staff_role() in ('admin','manager'));

alter table public.loyalty_ledger enable row level security;
revoke all on public.loyalty_ledger from anon;
grant select on public.loyalty_ledger to authenticated;

drop policy if exists loyalty_ledger_read on public.loyalty_ledger;
create policy loyalty_ledger_read on public.loyalty_ledger for select to authenticated
  using (public.current_staff_role() in ('admin','manager'));

-- ============================================================
-- 4) RPC loyalty_accrue_v1 — CRÉDITE des points (admin/manager). Atomique, upsert du compte + journal.
--    Retour uniforme (ok, code, message, points, tier) — même contrat que merge_guests_v1 (0065).
-- ============================================================
create or replace function public.loyalty_accrue_v1(p_guest_id uuid, p_delta integer, p_reason text)
returns table (ok boolean, code text, message text, points integer, tier text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
  v_points integer;
  v_tier text;
begin
  if v_role is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Fidélité réservée à la direction', null::integer, null::text; return;
  end if;
  if p_guest_id is null then
    return query select false, 'invalid', 'Client manquant', null::integer, null::text; return;
  end if;
  if p_delta is null or p_delta <= 0 then
    return query select false, 'invalid', 'Le nombre de points à créditer doit être strictement positif', null::integer, null::text; return;
  end if;
  if not exists (select 1 from public.guests where id = p_guest_id) then
    return query select false, 'not_found', 'Fiche client introuvable', null::integer, null::text; return;
  end if;

  -- Upsert du compte puis crédit atomique (l'UPDATE verrouille la ligne → pas de course concurrente).
  insert into public.loyalty_accounts (guest_id) values (p_guest_id) on conflict (guest_id) do nothing;
  -- Alias `a` + colonnes qualifiées : lève l'ambiguïté avec les colonnes OUT `points`/`tier` (RETURNS TABLE).
  update public.loyalty_accounts a
     set points = a.points + p_delta,
         tier = public.loyalty_tier(a.points + p_delta),
         updated_at = now()
   where a.guest_id = p_guest_id
   returning a.points, a.tier into v_points, v_tier;

  insert into public.loyalty_ledger (guest_id, delta, reason, created_by)
    values (p_guest_id, p_delta, nullif(btrim(coalesce(p_reason, '')), ''), public.current_staff_username());

  return query select true, 'ok', 'Points crédités', v_points, v_tier;
end $$;
revoke all on function public.loyalty_accrue_v1(uuid, integer, text) from public;
grant execute on function public.loyalty_accrue_v1(uuid, integer, text) to authenticated;

-- ============================================================
-- 5) RPC loyalty_redeem_v1 — DÉBITE des points (admin/manager). REFUSE tout solde négatif. Atomique.
-- ============================================================
create or replace function public.loyalty_redeem_v1(p_guest_id uuid, p_points integer, p_reason text)
returns table (ok boolean, code text, message text, points integer, tier text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
  v_balance integer;
  v_points integer;
  v_tier text;
begin
  if v_role is null or v_role not in ('admin','manager') then
    return query select false, 'unauthorized', 'Fidélité réservée à la direction', null::integer, null::text; return;
  end if;
  if p_guest_id is null then
    return query select false, 'invalid', 'Client manquant', null::integer, null::text; return;
  end if;
  if p_points is null or p_points <= 0 then
    return query select false, 'invalid', 'Le nombre de points à utiliser doit être strictement positif', null::integer, null::text; return;
  end if;

  -- Verrou de ligne AVANT le contrôle de solde (fenêtre check→update atomique, pas de solde négatif).
  select a.points into v_balance from public.loyalty_accounts a where a.guest_id = p_guest_id for update;
  if not found then
    return query select false, 'insufficient', 'Solde insuffisant (aucun point)', 0, 'bronze'; return;
  end if;
  if v_balance < p_points then
    return query select false, 'insufficient', 'Solde insuffisant', v_balance,
                        public.loyalty_tier(v_balance); return;
  end if;

  update public.loyalty_accounts a
     set points = a.points - p_points,
         tier = public.loyalty_tier(a.points - p_points),
         updated_at = now()
   where a.guest_id = p_guest_id
   returning a.points, a.tier into v_points, v_tier;

  insert into public.loyalty_ledger (guest_id, delta, reason, created_by)
    values (p_guest_id, -p_points, nullif(btrim(coalesce(p_reason, '')), ''), public.current_staff_username());

  return query select true, 'ok', 'Points utilisés', v_points, v_tier;
end $$;
revoke all on function public.loyalty_redeem_v1(uuid, integer, text) from public;
grant execute on function public.loyalty_redeem_v1(uuid, integer, text) to authenticated;

commit;
