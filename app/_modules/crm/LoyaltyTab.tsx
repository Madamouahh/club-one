"use client";

// app/_modules/crm/LoyaltyTab.tsx — MOTEUR DE FIDÉLITÉ (Vague 6), staff direction (admin/manager).
// Autonome : reçoit { supabase, role, username } et fait tout son fetch (comme StockView / CrmProfilePanel).
// S'appuie sur le backend 0067 (loyalty_accounts + loyalty_ledger + RPC loyalty_accrue_v1 / loyalty_redeem_v1)
// et sur la logique PURE de lib/loyalty. Ne fabrique RIEN : un client sans compte a un solde 0 (bronze) ;
// un débit qui rendrait le solde négatif est refusé côté RPC (et pré-validé ici pour un retour immédiat).
//
// La sécurité RÉELLE est la RLS/RPC 0067 (direction = tout ; anon = rien ; écriture via RPC SECURITY DEFINER).
// Ce gating UI (admin/manager) est un confort, pas une frontière : la base refuse déjà tout accès hors périmètre.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  LOYALTY_TIER_LABELS,
  canManageLoyalty,
  pointsToNextTier,
  tierForPoints,
  validateAccrue,
  validateRedeem,
  type LoyaltyLedgerEntry,
  type LoyaltyRpcResult,
  type LoyaltyTier,
} from "@/lib/loyalty";

// Styles (miroir de StockView / CrmProfilePanel pour rester cohérent visuellement).
const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const BTN_GHOST =
  "rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const LABEL = "text-[10px] font-bold uppercase tracking-wide text-white/50";

const GUESTS_LOAD_CAP = 1000;

type GuestRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
};

type AccountRow = { guest_id: string; points: number; tier: LoyaltyTier; updated_at: string | null };

const TIER_COLOR: Record<LoyaltyTier, string> = {
  bronze: "text-amber-600",
  silver: "text-slate-300",
  gold: "text-yellow-400",
  platinum: "text-cyan-300",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR");
}

export default function LoyaltyTab({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const isDirection = canManageLoyalty(role);

  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [account, setAccount] = useState<AccountRow | null>(null);
  const [ledger, setLedger] = useState<LoyaltyLedgerEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");

  // Chargement de la liste des fiches (page) — RLS = frontière réelle.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("guests")
        .select("id, first_name, last_name, phone")
        .order("first_name", { ascending: true })
        .limit(GUESTS_LOAD_CAP);
      if (!active) return;
      if (e) setError(e.message);
      else setGuests((data || []) as GuestRow[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const loadDetail = useCallback(
    async (guestId: string) => {
      setDetailLoading(true);
      setError("");
      const [acc, led] = await Promise.all([
        supabase.from("loyalty_accounts").select("guest_id, points, tier, updated_at").eq("guest_id", guestId).maybeSingle(),
        supabase
          .from("loyalty_ledger")
          .select("id, guest_id, delta, reason, created_by, created_at")
          .eq("guest_id", guestId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (acc.error) setError(acc.error.message);
      else setAccount((acc.data as AccountRow | null) ?? null);
      if (!led.error) setLedger((led.data || []) as LoyaltyLedgerEntry[]);
      setDetailLoading(false);
    },
    [supabase],
  );

  function selectGuest(id: string) {
    setSelectedId(id);
    setFlash("");
    setAmount("");
    setReason("");
    setAccount(null);
    setLedger([]);
    void loadDetail(id);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? guests.filter((g) =>
          `${g.first_name} ${g.last_name ?? ""} ${g.phone}`.toLowerCase().includes(q),
        )
      : guests;
    return base.slice(0, 50);
  }, [guests, query]);

  const balance = account?.points ?? 0;
  const currentTier: LoyaltyTier = account?.tier ?? tierForPoints(balance);
  const selectedGuest = useMemo(() => guests.find((g) => g.id === selectedId) ?? null, [guests, selectedId]);
  const nextTier = useMemo(() => pointsToNextTier(balance), [balance]);

  async function runRpc(kind: "accrue" | "redeem") {
    if (!selectedId) return;
    const n = Number(amount);
    const check = kind === "accrue" ? validateAccrue(n) : validateRedeem(n, balance);
    if (!check.ok) {
      setFlash(check.message);
      return;
    }
    setBusy(true);
    setFlash("");
    try {
      const fn = kind === "accrue" ? "loyalty_accrue_v1" : "loyalty_redeem_v1";
      const args =
        kind === "accrue"
          ? { p_guest_id: selectedId, p_delta: n, p_reason: reason.trim() || null }
          : { p_guest_id: selectedId, p_points: n, p_reason: reason.trim() || null };
      const { data, error: e } = await supabase.rpc(fn, args);
      if (e) throw new Error(e.message);
      const row = (Array.isArray(data) ? data[0] : data) as LoyaltyRpcResult | undefined;
      if (!row?.ok) throw new Error(row?.message || "Opération refusée");
      setFlash(kind === "accrue" ? `+${n} points crédités.` : `${n} points utilisés.`);
      setAmount("");
      setReason("");
      await loadDetail(selectedId);
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  if (!isDirection) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-white/60">
        Fidélité réservée à la direction (admin / manager).
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="text-center text-xs text-white/60">
        Moteur de fidélité — points &amp; paliers. La direction crédite/débite ; chaque mouvement est journalisé.
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      {/* Recherche client */}
      <div className={CARD}>
        <div className={`mb-2 ${LABEL}`}>Rechercher un client</div>
        <input
          className={INPUT}
          placeholder="Nom, prénom ou téléphone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-2">
          {loading ? (
            <div className="text-center text-sm text-white/40">Chargement…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-white/40">
              {guests.length === 0
                ? "Aucun client en base. Les fiches sont captées à la réservation."
                : "Aucun client ne correspond."}
            </div>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {filtered.map((g) => (
                <li key={g.id}>
                  <button
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                      selectedId === g.id
                        ? "border-orange-500/60 bg-orange-500/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                    onClick={() => selectGuest(g.id)}
                  >
                    <span className="font-bold">
                      {g.first_name} {g.last_name ?? ""}
                    </span>
                    <span className="ml-2 text-[11px] text-white/40">{g.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Détail du compte sélectionné */}
      {selectedGuest && (
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">
                {selectedGuest.first_name} {selectedGuest.last_name ?? ""}
              </div>
              <div className="text-[11px] text-white/40">{selectedGuest.phone}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-2xl font-black">{balance}</div>
              <div className="text-[9px] uppercase text-white/40">points</div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={`font-black uppercase ${TIER_COLOR[currentTier]}`}>
              {LOYALTY_TIER_LABELS[currentTier]}
            </span>
            <span className="text-white/40">
              {nextTier
                ? `${nextTier.remaining} pts → ${LOYALTY_TIER_LABELS[nextTier.next]}`
                : "Palier maximal atteint"}
            </span>
          </div>

          {flash && (
            <div className="mt-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/80">
              {flash}
            </div>
          )}

          {/* Crédit / débit */}
          <div className="mt-3 space-y-2">
            <input
              className={INPUT}
              inputMode="numeric"
              placeholder="Nombre de points"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className={INPUT}
              placeholder="Motif (optionnel : visite, offert…)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <button className={BTN} onClick={() => runRpc("accrue")} disabled={busy || !amount}>
                Créditer
              </button>
              <button className={BTN_GHOST} onClick={() => runRpc("redeem")} disabled={busy || !amount}>
                Utiliser
              </button>
            </div>
          </div>

          {/* Journal */}
          <div className="mt-3">
            <div className={`mb-1 ${LABEL}`}>Historique ({ledger.length})</div>
            {detailLoading ? (
              <div className="text-center text-sm text-white/40">Chargement…</div>
            ) : ledger.length === 0 ? (
              <div className="text-center text-sm text-white/40">Aucun mouvement pour ce client.</div>
            ) : (
              <ul className="max-h-60 space-y-1 overflow-y-auto">
                {ledger.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] text-white/80">{e.reason || "—"}</div>
                      <div className="text-[10px] text-white/40">
                        {fmtDateTime(e.created_at)}
                        {e.created_by ? ` · ${e.created_by}` : ""}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 text-sm font-black ${
                        e.delta >= 0 ? "text-emerald-300" : "text-red-300"
                      }`}
                    >
                      {e.delta >= 0 ? `+${e.delta}` : e.delta}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
