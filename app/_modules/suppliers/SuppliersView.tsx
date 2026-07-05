"use client";

// app/_modules/suppliers/SuppliersView.tsx — écran Fournisseurs/Achats (0048), mobile-first, autonome.
// RLS 0048 = frontière dure (écriture direction). Facture / paiement : PRÊT À CONNECTER — NON ACTIVÉ.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  ORDER_STATUSES,
  SUPPLIER_CATEGORIES,
  canManagePurchasing,
  formatCostEuro,
  ordersSummary,
  validateOrderDraft,
  validateSupplierDraft,
  type OrderStatus,
  type PurchaseOrder,
  type Supplier,
} from "@/lib/suppliers";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

const STATUS_LABEL: Record<OrderStatus, string> = {
  brouillon: "Brouillon",
  envoyee: "Envoyée",
  recue: "Reçue",
  annulee: "Annulée",
};
const STATUS_COLOR: Record<OrderStatus, string> = {
  brouillon: "text-white/50",
  envoyee: "text-amber-400",
  recue: "text-emerald-300",
  annulee: "text-red-400",
};

export default function SuppliersView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = canManagePurchasing(role);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [sName, setSName] = useState("");
  const [sCategory, setSCategory] = useState<string>("boissons");
  const [sContact, setSContact] = useState("");
  const [sPhone, setSPhone] = useState("");

  const [oSupplier, setOSupplier] = useState<string>("");
  const [oLabel, setOLabel] = useState("");
  const [oStatus, setOStatus] = useState<string>("brouillon");
  const [oTotal, setOTotal] = useState("");

  const load = useCallback(async () => {
    const [sp, po] = await Promise.all([
      supabase.from("suppliers").select("*").order("name", { ascending: true }),
      supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
    ]);
    if (sp.error) setError(sp.error.message);
    else setSuppliers((sp.data || []) as Supplier[]);
    if (!po.error) setOrders((po.data || []) as PurchaseOrder[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [sp, po] = await Promise.all([
        supabase.from("suppliers").select("*").order("name", { ascending: true }),
        supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      if (sp.error) setError(sp.error.message);
      else setSuppliers((sp.data || []) as Supplier[]);
      if (!po.error) setOrders((po.data || []) as PurchaseOrder[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const summary = useMemo(() => ordersSummary(orders), [orders]);
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  async function addSupplier() {
    setError("");
    const draft = { name: sName.trim(), category: sCategory };
    const check = validateSupplierDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("suppliers").insert({
      name: sName.trim(),
      category: sCategory,
      contact_name: sContact.trim() || null,
      phone: sPhone.trim() || null,
    });
    if (e) {
      setError(`Ajout fournisseur refusé : ${e.message}`);
      return;
    }
    setSName("");
    setSContact("");
    setSPhone("");
    await load();
  }

  async function addOrder() {
    setError("");
    const totalCents = oTotal ? Math.round(Number(oTotal) * 100) : null;
    const draft = { supplier_id: oSupplier, status: oStatus, total_cents: totalCents };
    const check = validateOrderDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("purchase_orders").insert({
      supplier_id: oSupplier,
      status: oStatus,
      label: oLabel.trim() || null,
      total_cents: totalCents,
      created_by: username,
    });
    if (e) {
      setError(`Commande refusée : ${e.message}`);
      return;
    }
    setOLabel("");
    setOTotal("");
    await load();
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-4 gap-2 text-center">
        {(ORDER_STATUSES as readonly OrderStatus[]).map((st) => (
          <div key={st} className={CARD}>
            <div className={`text-2xl font-black ${STATUS_COLOR[st]}`}>{summary.parStatut[st]}</div>
            <div className="text-[9px] uppercase text-white/50">{STATUS_LABEL[st]}</div>
          </div>
        ))}
      </div>
      <div className="text-center text-xs text-white/60">
        Engagé (envoyées + reçues, coûts connus) : <b className="text-white">{formatCostEuro(summary.engageCents)}</b>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
        Facture / paiement fournisseur · PRÊT À CONNECTER — NON ACTIVÉ
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>}

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Ajouter un fournisseur</div>
          <div className="space-y-2">
            <input className={INPUT} placeholder="Nom (ex. Metro Amiens)" value={sName} onChange={(e) => setSName(e.target.value)} />
            <select className={INPUT} value={sCategory} onChange={(e) => setSCategory(e.target.value)}>
              {SUPPLIER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} placeholder="Contact (opt.)" value={sContact} onChange={(e) => setSContact(e.target.value)} />
              <input className={INPUT} inputMode="tel" placeholder="Téléphone (opt.)" value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
            </div>
            <button className={BTN} onClick={addSupplier} disabled={!sName.trim()}>Ajouter</button>
          </div>
        </div>
      )}

      {canManage && suppliers.length > 0 && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Nouvelle commande</div>
          <div className="space-y-2">
            <select className={INPUT} value={oSupplier} onChange={(e) => setOSupplier(e.target.value)}>
              <option value="">— fournisseur —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className={INPUT} placeholder="Libellé (ex. Réappro champagne)" value={oLabel} onChange={(e) => setOLabel(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={oStatus} onChange={(e) => setOStatus(e.target.value)}>
                {(ORDER_STATUSES as readonly OrderStatus[]).map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
              </select>
              <input className={INPUT} inputMode="decimal" placeholder="Total € (opt.)" value={oTotal} onChange={(e) => setOTotal(e.target.value)} />
            </div>
            <button className={BTN} onClick={addOrder} disabled={!oSupplier}>Enregistrer la commande</button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Commandes ({orders.length})</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : orders.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucune commande. La direction saisit les achats réels.</div>
        ) : (
          <ul className="space-y-2">
            {orders.map((o) => (
              <li key={o.id} className={`${CARD} flex items-center justify-between gap-2`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{o.label || supplierName.get(o.supplier_id) || "Commande"}</div>
                  <div className="text-[11px] text-white/50">{supplierName.get(o.supplier_id) || "—"}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black text-white">{formatCostEuro(o.total_cents)}</div>
                  <div className={`text-[9px] font-normal uppercase ${STATUS_COLOR[(o.status as OrderStatus)] || "text-white/40"}`}>
                    {STATUS_LABEL[(o.status as OrderStatus)] || o.status}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Fournisseurs ({suppliers.length})</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : suppliers.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucun fournisseur. La direction saisit le carnet réel.</div>
        ) : (
          <ul className="space-y-2">
            {suppliers.map((s) => (
              <li key={s.id} className={`${CARD} flex items-center justify-between gap-2`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{s.name}</div>
                  <div className="text-[11px] text-white/50">
                    {s.category}{s.contact_name ? ` · ${s.contact_name}` : ""}{s.phone ? ` · ${s.phone}` : ""}
                  </div>
                </div>
                {!s.active && <div className="shrink-0 text-[9px] uppercase text-white/40">inactif</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
