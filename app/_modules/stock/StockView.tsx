"use client";

// app/_modules/stock/StockView.tsx — écran Stock/inventaire/pertes (0047), mobile-first, autonome.
// RLS 0047 = frontière dure (écriture direction). Rapprochement caisse : PRÊT À CONNECTER — NON ACTIVÉ.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  MOVEMENT_KINDS,
  STOCK_FAMILIES,
  STOCK_UNITS,
  canManageStock,
  formatCostEuro,
  itemsWithStock,
  signedQty,
  stockSummary,
  validateMovementDraft,
  type MovementKind,
  type StockItem,
  type StockMovement,
} from "@/lib/stock";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export default function StockView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = canManageStock(role);
  const [items, setItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [nName, setNName] = useState("");
  const [nFamily, setNFamily] = useState<string>("spiritueux");
  const [nUnit, setNUnit] = useState<string>("bouteille");
  const [nPar, setNPar] = useState("");
  const [nCost, setNCost] = useState("");

  const [mItem, setMItem] = useState<string>("");
  const [mKind, setMKind] = useState<string>("entree");
  const [mQty, setMQty] = useState("");

  const load = useCallback(async () => {
    const [it, mv] = await Promise.all([
      supabase.from("stock_items").select("*").order("name", { ascending: true }),
      supabase.from("stock_movements").select("*"),
    ]);
    if (it.error) setError(it.error.message);
    else setItems((it.data || []) as StockItem[]);
    if (!mv.error) setMovements((mv.data || []) as StockMovement[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [it, mv] = await Promise.all([
        supabase.from("stock_items").select("*").order("name", { ascending: true }),
        supabase.from("stock_movements").select("*"),
      ]);
      if (!active) return;
      if (it.error) setError(it.error.message);
      else setItems((it.data || []) as StockItem[]);
      if (!mv.error) setMovements((mv.data || []) as StockMovement[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const summary = useMemo(() => stockSummary(items, movements), [items, movements]);
  const enriched = useMemo(() => itemsWithStock(items, movements), [items, movements]);

  async function addItem() {
    setError("");
    if (!nName.trim()) {
      setError("Nom de l'article requis.");
      return;
    }
    const { error: e } = await supabase.from("stock_items").insert({
      name: nName.trim(),
      family: nFamily,
      unit: nUnit,
      par_level: nPar ? Number(nPar) : null,
      unit_cost_cents: nCost ? Math.round(Number(nCost) * 100) : null,
    });
    if (e) {
      setError(`Ajout article refusé : ${e.message}`);
      return;
    }
    setNName("");
    setNPar("");
    setNCost("");
    await load();
  }

  async function addMovement() {
    setError("");
    const qtyAbs = Number(mQty);
    const draft = { item_id: mItem, kind: mKind, qty: qtyAbs };
    const check = validateMovementDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("stock_movements").insert({
      item_id: mItem,
      kind: mKind,
      qty: signedQty(mKind as MovementKind, qtyAbs),
      created_by: username,
    });
    if (e) {
      setError(`Mouvement refusé : ${e.message}`);
      return;
    }
    setMQty("");
    await load();
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black">{summary.totalArticles}</div>
          <div className="text-[10px] uppercase text-white/50">Articles</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-amber-400">{summary.sousSeuil}</div>
          <div className="text-[10px] uppercase text-white/50">Sous seuil</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-red-400">{summary.ruptures}</div>
          <div className="text-[10px] uppercase text-white/50">Ruptures</div>
        </div>
      </div>
      <div className="text-center text-xs text-white/60">
        Valeur du stock (coûts connus) : <b className="text-white">{formatCostEuro(summary.valeurStockCents)}</b>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
        Rapprochement caisse / JDC · PRÊT À CONNECTER — NON ACTIVÉ
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>}

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Ajouter un article</div>
          <div className="space-y-2">
            <input className={INPUT} placeholder="Nom (ex. Grey Goose 70cl)" value={nName} onChange={(e) => setNName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={nFamily} onChange={(e) => setNFamily(e.target.value)}>
                {STOCK_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select className={INPUT} value={nUnit} onChange={(e) => setNUnit(e.target.value)}>
                {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} inputMode="numeric" placeholder="Seuil (optionnel)" value={nPar} onChange={(e) => setNPar(e.target.value)} />
              <input className={INPUT} inputMode="decimal" placeholder="Coût unit. € (opt.)" value={nCost} onChange={(e) => setNCost(e.target.value)} />
            </div>
            <button className={BTN} onClick={addItem} disabled={!nName.trim()}>Ajouter</button>
          </div>
        </div>
      )}

      {canManage && items.length > 0 && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Mouvement (entrée / sortie / perte / casse)</div>
          <div className="space-y-2">
            <select className={INPUT} value={mItem} onChange={(e) => setMItem(e.target.value)}>
              <option value="">— article —</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={mKind} onChange={(e) => setMKind(e.target.value)}>
                {MOVEMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input className={INPUT} inputMode="numeric" placeholder="Quantité" value={mQty} onChange={(e) => setMQty(e.target.value)} />
            </div>
            <button className={BTN} onClick={addMovement} disabled={!mItem || !mQty}>Enregistrer le mouvement</button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Articles ({items.length})</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : enriched.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucun article. La direction saisit le catalogue réel.</div>
        ) : (
          <ul className="space-y-2">
            {enriched.map((it) => (
              <li key={it.id} className={`${CARD} flex items-center justify-between gap-2`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{it.name}</div>
                  <div className="text-[11px] text-white/50">{it.family} · {it.unit}{it.unit_cost_cents != null ? ` · ${formatCostEuro(it.unit_cost_cents)}/u` : ""}</div>
                </div>
                <div className={`shrink-0 text-right text-sm font-black ${it.rupture ? "text-red-400" : it.belowPar ? "text-amber-400" : "text-emerald-300"}`}>
                  {it.stock}
                  <div className="text-[9px] font-normal uppercase text-white/40">{it.rupture ? "rupture" : it.belowPar ? "sous seuil" : "ok"}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
