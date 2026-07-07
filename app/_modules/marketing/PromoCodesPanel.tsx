"use client";

// app/_modules/marketing/PromoCodesPanel.tsx — F4 : CRUD codes promo + rédemptions.
// La logique métier (validité / plafonds / remise) vient de lib/promoCodes (backend Vague-1). Présentational.

import { useMemo, useState } from "react";
import {
  DISCOUNT_TYPES,
  validatePromoCode,
  computeDiscountCents,
  type DiscountType,
  type PromoCode,
} from "@/lib/promoCodes";
import { formatDiscountLabel } from "@/lib/marketingUi";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export type RedemptionRow = {
  id: string;
  promo_code_id: string;
  guest_id?: string | null;
  redeemed_at?: string | null;
};

export type PromoCampaignOption = { id: string; name: string };

const REASON_LABELS: Record<string, string> = {
  ok: "Valide",
  inactive: "Inactif",
  not_yet_valid: "Pas encore actif",
  expired: "Expiré",
  max_redemptions_reached: "Plafond global atteint",
  per_guest_limit_reached: "Plafond par guest atteint",
};

// Sous-total de démonstration pour illustrer la remise calculée (aucune I/O, pur affichage).
const DEMO_SUBTOTAL_CENTS = 10000;

export default function PromoCodesPanel({
  promoCodes,
  redemptions,
  campaigns,
  canManage,
  onCreate,
  onToggleActive,
}: {
  promoCodes: PromoCode[];
  redemptions: RedemptionRow[];
  campaigns: PromoCampaignOption[];
  canManage: boolean;
  onCreate?: (draft: {
    code: string;
    campaign_id: string | null;
    discount_type: DiscountType;
    discount_value_cents: number;
    max_redemptions: number | null;
    per_guest_limit: number;
    valid_from: string | null;
    valid_until: string | null;
  }) => Promise<void> | void;
  onToggleActive?: (id: string, active: boolean) => Promise<void> | void;
}) {
  const [code, setCode] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [value, setValue] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [perGuest, setPerGuest] = useState("1");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // Rédemptions comptées par code (source de vérité d'affichage : la table promo_redemptions).
  const redemptionsByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of redemptions) m.set(r.promo_code_id, (m.get(r.promo_code_id) ?? 0) + 1);
    return m;
  }, [redemptions]);

  async function create() {
    if (!onCreate || !code.trim() || !value) return;
    setBusy(true);
    setNote("");
    try {
      // percent : la valeur saisie EST le pourcentage. amount : euros → centimes.
      const valueCents =
        discountType === "percent"
          ? Math.round(Number(value))
          : Math.round(Number(value) * 100);
      await onCreate({
        code: code.trim().toUpperCase(),
        campaign_id: campaignId || null,
        discount_type: discountType,
        discount_value_cents: valueCents,
        max_redemptions: maxRedemptions ? Math.round(Number(maxRedemptions)) : null,
        per_guest_limit: perGuest ? Math.round(Number(perGuest)) : 1,
        valid_from: validFrom || null,
        valid_until: validUntil || null,
      });
      setNote(`Code « ${code.trim().toUpperCase()} » créé.`);
      setCode("");
      setValue("");
      setMaxRedemptions("");
    } catch (e) {
      setNote(`Échec création : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-bold uppercase tracking-wide text-white/50">
        Codes promo (F4)
      </div>

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Nouveau code</div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                className={`${INPUT} uppercase`}
                placeholder="CODE (ex. EDEN20)"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <select className={INPUT} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">— campagne (opt.) —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
                {DISCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "percent" ? "pourcentage (%)" : "montant (€)"}
                  </option>
                ))}
              </select>
              <input
                className={INPUT}
                inputMode="decimal"
                placeholder={discountType === "percent" ? "Valeur % (0-100)" : "Valeur €"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={INPUT}
                inputMode="numeric"
                placeholder="Plafond global (illimité si vide)"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
              />
              <input
                className={INPUT}
                inputMode="numeric"
                placeholder="Plafond / guest"
                value={perGuest}
                onChange={(e) => setPerGuest(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} type="date" title="Valide à partir de" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              <input className={INPUT} type="date" title="Valide jusqu'à" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <button className={BTN} onClick={create} disabled={busy || !code.trim() || !value || !onCreate}>
              Créer le code
            </button>
          </div>
        </div>
      )}

      {note && (
        <div className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs text-white/70">
          {note}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Codes ({promoCodes.length})</div>
        {promoCodes.length === 0 ? (
          <div className="text-center text-sm text-white/40">
            Aucun code promo. La direction crée les codes réels.
          </div>
        ) : (
          <ul className="space-y-2">
            {promoCodes.map((p) => {
              const used = redemptionsByCode.get(p.id) ?? p.redeemed_count ?? 0;
              const verdict = validatePromoCode({ ...p, redeemed_count: used });
              const demoDiscount = computeDiscountCents(p, DEMO_SUBTOTAL_CENTS);
              return (
                <li key={p.id} className={CARD}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black tracking-wide">{p.code}</div>
                      <div className="text-[11px] text-white/50">
                        {formatDiscountLabel(p)} · {used}
                        {p.max_redemptions != null ? `/${p.max_redemptions}` : ""} utilisé(s)
                        {" · "}
                        {(demoDiscount / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}{" "}
                        sur 100 €
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`text-[11px] font-bold ${verdict.valid ? "text-emerald-300" : "text-amber-400"}`}
                      >
                        {REASON_LABELS[verdict.reason] ?? verdict.reason}
                      </div>
                      {canManage && onToggleActive && (
                        <button
                          className="mt-1 rounded-lg border border-white/15 px-2 py-0.5 text-[10px] text-white/70"
                          onClick={() => onToggleActive(p.id, !(p.active ?? true))}
                        >
                          {p.active ?? true ? "Désactiver" : "Activer"}
                        </button>
                      )}
                    </div>
                  </div>
                  {(p.valid_from || p.valid_until) && (
                    <div className="mt-1 text-[10px] text-white/40">
                      Validité {p.valid_from || "…"} → {p.valid_until || "…"} · per-guest {p.per_guest_limit ?? 1}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {redemptions.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">
            Rédemptions ({redemptions.length})
          </div>
          <ul className="space-y-1">
            {redemptions.slice(0, 50).map((r) => {
              const pc = promoCodes.find((p) => p.id === r.promo_code_id);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs"
                >
                  <span className="truncate font-bold text-white/80">{pc?.code ?? r.promo_code_id.slice(0, 8)}</span>
                  <span className="shrink-0 text-white/40">
                    {r.guest_id ? r.guest_id.slice(0, 8) : "anonyme"}
                    {r.redeemed_at ? ` · ${r.redeemed_at.slice(0, 10)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
