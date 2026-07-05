"use client";

// app/_modules/admin/AdminView.tsx — ADMINISTRATION & CONFIGURATION (admin uniquement).
// Surface HONNÊTE de l'état de configuration : statut des adaptateurs externes (jamais activés sans clé
// + GO), effectif staff, état des modules. Aucune écriture sensible ici (la gestion staff détaillée reste
// l'onglet RH ; la carte reste ses RPC auditées). Ne présente aucun mock comme réel.

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import { adapterStatus, enabledFeatures } from "@/lib/featureFlags";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const STATUS_STYLE: Record<string, string> = {
  ACTIF: "text-emerald-300",
  "PRÊT À CONNECTER": "text-amber-300",
  "NON ACTIVÉ": "text-white/40",
};

// Adaptateurs externes du programme. Aucune clé n'est présente en session (hasKey=false) → tout est
// « NON ACTIVÉ » : c'est l'état honnête. L'activation réelle = porte fondateur (clé + GO + budget).
const ADAPTERS: { name: string; featureOn: boolean; note: string }[] = [
  { name: "SMS", featureOn: false, note: "Relances / confirmations" },
  { name: "E-mail marketing", featureOn: false, note: "Campagnes / nurturing" },
  { name: "WhatsApp", featureOn: false, note: "Invitations promoteurs" },
  { name: "Caisse / JDC", featureOn: false, note: "Rapprochement stock / CA réel" },
  { name: "Paiement", featureOn: false, note: "Acomptes privatisations" },
  { name: "Signature électronique", featureOn: false, note: "Devis / contrats" },
  { name: "Publicité externe", featureOn: false, note: "Meta / Google Ads" },
];

export default function AdminView({ supabase, role }: { supabase: SupabaseClient; role: StaffRole }) {
  const isAdmin = role === "admin";
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(isAdmin);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      const { count } = await supabase.from("staff_members").select("*", { count: "exact", head: true });
      if (!active) return;
      setStaffCount(count ?? 0);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, isAdmin]);

  if (!isAdmin) return <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">Administration réservée à l’administrateur.</p>;

  const flags = enabledFeatures(process.env.NEXT_PUBLIC_CLUB_FEATURES ?? null);

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className={CARD}>
        <div className="mb-1 text-xs font-bold uppercase text-white/50">Effectif</div>
        <div className="text-sm">{loading ? "…" : `${staffCount} membre(s) du staff`} · gestion détaillée dans l’onglet RH.</div>
      </div>

      <div className={CARD}>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Adaptateurs externes (activation = porte fondateur)</div>
        <ul className="space-y-1">
          {ADAPTERS.map((a) => {
            const st = adapterStatus(false, a.featureOn);
            return (
              <li key={a.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{a.name} <span className="text-[11px] text-white/40">· {a.note}</span></span>
                <span className={`shrink-0 text-[11px] font-bold uppercase ${STATUS_STYLE[st]}`}>{st}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 text-[10px] text-white/40">Aucune clé en session → tout NON ACTIVÉ (état honnête). Aucun envoi/paiement réel n’est possible sans activation explicite.</div>
      </div>

      <div className={CARD}>
        <div className="mb-1 text-xs font-bold uppercase text-white/50">Modules en préparation (feature flags)</div>
        <div className="text-sm">{flags.length === 0 ? "Aucun module masqué : tous les modules terminés sont en navigation." : flags.join(", ")}</div>
      </div>
    </div>
  );
}
