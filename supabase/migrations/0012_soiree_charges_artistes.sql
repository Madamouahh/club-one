-- 0012_soiree_charges_artistes.sql — 2ᵉ CHARGE du P&L par soirée : coûts ARTISTES & EXTRAS (B2/B3).
-- Ce module est le PRODUCTEUR de la charge « artistes » que le P&L par soirée (lib/pnlSoiree) attend
-- honnêtement à null tant qu'elle n'est pas branchée (charge « artistes », wired=false). Il complète
-- le coût staff (0011) : P&L = CA (caisse Z, 0010) − coût staff (RH, 0011) − coûts artistes/extras.
--
-- Additif strict : ne touche à aucune table existante. AUCUN seed — les vrais cachets/coûts (montant)
-- sont une donnée du fondateur (contrats booking / factures presta). Une ligne se saisit AVANT de
-- connaître son montant : montant_ttc NULL = coût non encore chiffré (état vide HONNÊTE), jamais 0
-- fabriqué. Le P&L ne branchera cette charge comme définitive que lorsque tous les postes ENGAGÉS
-- de la soirée sont chiffrés (voir lib/artistesExtras · coutComplet), exactement comme le coût staff.
--
-- RLS (cf. matrice B2/B3) : le COÛT (cachet, budget) est DIRECTIONNEL. Un artiste peut voir « sa
-- fiche » (B3, module créa E5, hors de ce périmètre) mais jamais le budget de la soirée. Ici :
-- admin/manager en lecture/écriture complète ; anon fermé ; aucun autre rôle.

begin;

-- ============================================================
-- SOIREE_CHARGES — postes de coût artistes & extras d'une soirée (VIDE tant que le fondateur ne
-- fournit pas les contrats/cachets). Une soirée = plusieurs lignes possibles (DJ + technique + extra).
-- ============================================================
create table if not exists public.soiree_charges (
  id uuid primary key default gen_random_uuid(),
  exploitation_date date not null,          -- la soirée (chevauche minuit) — clé de rapprochement P&L
  event_id uuid references public.events(id),
  categorie text not null
    check (categorie in ('artiste','dj','technique','securite_externe','extra','location','autre')),
  label text not null,                      -- nom de scène / description du poste (ex. « DJ Untel », « ingé son »)
  montant_ttc numeric(10,2) check (montant_ttc is null or montant_ttc >= 0), -- cachet/coût TTC ; NULL = non chiffré
  statut text not null default 'prevu'
    check (statut in ('prevu','confirme','paye','annule')),
  notes_direction text,                     -- accès direction uniquement
  saisi_par text,                           -- username du saisisseur (traçabilité, pas une sécurité)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists soiree_charges_date_idx on public.soiree_charges(exploitation_date);
create index if not exists soiree_charges_event_idx on public.soiree_charges(event_id);

-- ============================================================
-- RLS — DIRECTIONNEL strict (admin/manager). anon fermé, aucun autre rôle.
-- ============================================================
alter table public.soiree_charges enable row level security;
revoke all on public.soiree_charges from anon;
grant select, insert, update, delete on public.soiree_charges to authenticated;

-- Lecture : direction seule (le budget de soirée n'est jamais exposé aux autres rôles).
drop policy if exists soiree_charges_direction_read on public.soiree_charges;
create policy soiree_charges_direction_read on public.soiree_charges for select to authenticated
  using (public.current_staff_role() in ('admin','manager'));
-- Écriture : direction seule (composition des postes de coût, saisie des cachets).
drop policy if exists soiree_charges_direction_insert on public.soiree_charges;
create policy soiree_charges_direction_insert on public.soiree_charges for insert to authenticated
  with check (public.current_staff_role() in ('admin','manager'));
drop policy if exists soiree_charges_direction_update on public.soiree_charges;
create policy soiree_charges_direction_update on public.soiree_charges for update to authenticated
  using (public.current_staff_role() in ('admin','manager'))
  with check (public.current_staff_role() in ('admin','manager'));
drop policy if exists soiree_charges_direction_delete on public.soiree_charges;
create policy soiree_charges_direction_delete on public.soiree_charges for delete to authenticated
  using (public.current_staff_role() in ('admin','manager'));

commit;
