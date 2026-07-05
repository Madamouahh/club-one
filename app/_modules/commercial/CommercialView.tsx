"use client";

// app/_modules/commercial/CommercialView.tsx — écran Commercial / privatisations (0049), mobile-first, autonome.
// RLS 0049 = frontière dure (lecture ET écriture direction). Paiement / signature : PRÊT À CONNECTER — NON ACTIVÉ.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  LEAD_KINDS,
  LEAD_STATUSES,
  QUOTE_STATUSES,
  canManageCommercial,
  canViewCommercial,
  conversionRate,
  formatMoneyEuro,
  formatRatePct,
  pipelineSummary,
  quotesForLead,
  validateLeadDraft,
  validateQuoteDraft,
  type CommercialLead,
  type CommercialQuote,
  type LeadStatus,
} from "@/lib/commercial";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

const STATUS_LABEL: Record<LeadStatus, string> = {
  nouveau: "Nouveau",
  qualifie: "Qualifié",
  devis: "Devis",
  gagne: "Gagné",
  perdu: "Perdu",
};

export default function CommercialView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = canManageCommercial(role);
  const canView = canViewCommercial(role);
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [quotes, setQuotes] = useState<CommercialQuote[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [nContact, setNContact] = useState("");
  const [nCompany, setNCompany] = useState("");
  const [nKind, setNKind] = useState<string>("privatisation");
  const [nStatus, setNStatus] = useState<string>("nouveau");
  const [nParty, setNParty] = useState("");
  const [nValue, setNValue] = useState("");

  const [qLead, setQLead] = useState<string>("");
  const [qLabel, setQLabel] = useState("");
  const [qAmount, setQAmount] = useState("");
  const [qStatus, setQStatus] = useState<string>("option");

  const load = useCallback(async () => {
    const [ld, qt] = await Promise.all([
      supabase.from("commercial_leads").select("*").order("created_at", { ascending: false }),
      supabase.from("commercial_quotes").select("*"),
    ]);
    if (ld.error) setError(ld.error.message);
    else setLeads((ld.data || []) as CommercialLead[]);
    if (!qt.error) setQuotes((qt.data || []) as CommercialQuote[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [ld, qt] = await Promise.all([
        supabase.from("commercial_leads").select("*").order("created_at", { ascending: false }),
        supabase.from("commercial_quotes").select("*"),
      ]);
      if (!active) return;
      if (ld.error) setError(ld.error.message);
      else setLeads((ld.data || []) as CommercialLead[]);
      if (!qt.error) setQuotes((qt.data || []) as CommercialQuote[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const summary = useMemo(() => pipelineSummary(leads, quotes), [leads, quotes]);
  const taux = useMemo(() => conversionRate(leads), [leads]);

  async function addLead() {
    setError("");
    const draft = {
      contact_name: nContact,
      kind: nKind,
      status: nStatus,
      party_size: nParty ? Number(nParty) : null,
      estimated_value_cents: nValue ? Math.round(Number(nValue) * 100) : null,
    };
    const check = validateLeadDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("commercial_leads").insert({
      contact_name: nContact.trim(),
      company: nCompany.trim() || null,
      kind: nKind,
      status: nStatus,
      party_size: nParty ? Number(nParty) : null,
      estimated_value_cents: nValue ? Math.round(Number(nValue) * 100) : null,
      created_by: username,
    });
    if (e) {
      setError(`Ajout lead refusé : ${e.message}`);
      return;
    }
    setNContact("");
    setNCompany("");
    setNParty("");
    setNValue("");
    await load();
  }

  async function addQuote() {
    setError("");
    const draft = {
      lead_id: qLead,
      label: qLabel,
      amount_cents: qAmount ? Math.round(Number(qAmount) * 100) : null,
      status: qStatus,
    };
    const check = validateQuoteDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("commercial_quotes").insert({
      lead_id: qLead,
      label: qLabel.trim(),
      amount_cents: Math.round(Number(qAmount) * 100),
      status: qStatus,
      created_by: username,
    });
    if (e) {
      setError(`Devis refusé : ${e.message}`);
      return;
    }
    setQLabel("");
    setQAmount("");
    await load();
  }

  if (!canView) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-white/50">
        Espace commercial réservé à la direction.
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black">{summary.total}</div>
          <div className="text-[10px] uppercase text-white/50">Leads</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-emerald-300">{summary.parStatut.gagne}</div>
          <div className="text-[10px] uppercase text-white/50">Gagnés</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-amber-400">{formatRatePct(taux)}</div>
          <div className="text-[10px] uppercase text-white/50">Conversion</div>
        </div>
      </div>
      <div className="text-center text-xs text-white/60">
        Valeur pondérée (gagnés + options) : <b className="text-white">{formatMoneyEuro(summary.valeurPondereeCents)}</b>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
        Paiement / signature électronique · PRÊT À CONNECTER — NON ACTIVÉ
      </div>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>}

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Nouveau lead</div>
          <div className="space-y-2">
            <input className={INPUT} placeholder="Contact (ex. Marie Dupont)" value={nContact} onChange={(e) => setNContact(e.target.value)} />
            <input className={INPUT} placeholder="Société (optionnel)" value={nCompany} onChange={(e) => setNCompany(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={nKind} onChange={(e) => setNKind(e.target.value)}>
                {LEAD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select className={INPUT} value={nStatus} onChange={(e) => setNStatus(e.target.value)}>
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} inputMode="numeric" placeholder="Nb personnes (opt.)" value={nParty} onChange={(e) => setNParty(e.target.value)} />
              <input className={INPUT} inputMode="decimal" placeholder="Valeur est. € (opt.)" value={nValue} onChange={(e) => setNValue(e.target.value)} />
            </div>
            <button className={BTN} onClick={addLead} disabled={!nContact.trim()}>Ajouter le lead</button>
          </div>
        </div>
      )}

      {canManage && leads.length > 0 && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Devis (suivi — non contractuel)</div>
          <div className="space-y-2">
            <select className={INPUT} value={qLead} onChange={(e) => setQLead(e.target.value)}>
              <option value="">— lead —</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.contact_name}{l.company ? ` · ${l.company}` : ""}</option>)}
            </select>
            <input className={INPUT} placeholder="Libellé (ex. Formule privatisation)" value={qLabel} onChange={(e) => setQLabel(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} inputMode="decimal" placeholder="Montant €" value={qAmount} onChange={(e) => setQAmount(e.target.value)} />
              <select className={INPUT} value={qStatus} onChange={(e) => setQStatus(e.target.value)}>
                {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button className={BTN} onClick={addQuote} disabled={!qLead || !qLabel.trim() || !qAmount}>Enregistrer le devis</button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Pipeline ({leads.length})</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : leads.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucun lead commercial. La direction saisit les demandes réelles.</div>
        ) : (
          <ul className="space-y-2">
            {leads.map((l) => {
              const lq = quotesForLead(l.id, quotes);
              return (
                <li key={l.id} className={CARD}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{l.contact_name}{l.company ? <span className="text-white/50"> · {l.company}</span> : null}</div>
                      <div className="text-[11px] text-white/50">
                        {l.kind}
                        {l.party_size != null ? ` · ${l.party_size} pers.` : ""}
                        {l.estimated_value_cents != null ? ` · ${formatMoneyEuro(l.estimated_value_cents)}` : " · —"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        l.status === "gagne" ? "bg-emerald-500/20 text-emerald-300"
                          : l.status === "perdu" ? "bg-red-500/20 text-red-300"
                          : l.status === "devis" ? "bg-sky-500/20 text-sky-300"
                          : "bg-white/10 text-white/60"
                      }`}>
                        {STATUS_LABEL[(LEAD_STATUSES as readonly string[]).includes(l.status) ? (l.status as LeadStatus) : "nouveau"]}
                      </span>
                    </div>
                  </div>
                  {lq.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-white/10 pt-2">
                      {lq.map((q) => (
                        <li key={q.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate text-white/70">{q.label} <span className="text-white/40">· {q.status}</span></span>
                          <span className="shrink-0 font-bold text-white">{formatMoneyEuro(q.amount_cents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
