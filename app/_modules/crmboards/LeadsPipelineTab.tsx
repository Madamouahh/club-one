"use client";

// app/_modules/crmboards/LeadsPipelineTab.tsx — CONTENEUR autonome (intégrateur) pour B12 LEADS &
// TUNNEL COMMERCIAL. Même contrat d'appel que les autres conteneurs (StockView/ReservationBoardTab) :
// { supabase, role, username }.
//
// Récupère les vraies lignes de `lead_channel_stats` (migration 0062, déjà cantonnées par la RLS
// direction admin/manager), les AGRÈGE par canal via lib/leadsBoard (aucune règle métier dupliquée : on
// réutilise buildLeadsPipeline), et nourrit le composant PRÉSENTATIONNEL existant <LeadsPipelineBoard>.
// Ajoute une SAISIE direction (create/edit d'une ligne canal) — l'admin pilote (canManageLeads), le
// manager consulte. Les gardes d'affichage reflètent la matrice B12 ; l'autorité reste la RLS 0062.
//
// HONNÊTETÉ : aucune donnée fabriquée. Vide réel → funnel « non tracké » (jamais un faux zéro). La table
// ne porte pas de « valeur de résa générée » : le ROAS reste « — » (non mesurable), jamais un ROI inventé.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import LeadsPipelineBoard from "@/components/LeadsPipelineBoard";
import type { StaffRole } from "@/lib/permissions";
import {
  LEAD_CHANNELS,
  canManageLeads,
  canViewLeads,
  leadChannelTitle,
} from "@/lib/leadsPipeline";
import {
  buildLeadsBoardView,
  isLeadChannel,
  validateLeadStatDraft,
  type LeadChannelStatRow,
  type LeadStatDraft,
} from "@/lib/leadsBoard";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const GHOST = "rounded-xl border border-white/15 px-3 py-2 text-sm font-bold text-white/70";

// Champ texte → nombre entier ou null (vide = non tracké, jamais 0 fabriqué).
function toIntOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : NaN as unknown as number;
}
// Champ euros → centimes ou null.
function toCentsOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : (NaN as unknown as number);
}
function fromCents(c: number | null): string {
  return c === null ? "" : (c / 100).toString();
}
function fromInt(n: number | null): string {
  return n === null ? "" : n.toString();
}

type FormState = {
  editingId: string | null;
  channel: string;
  period_start: string;
  period_end: string;
  impressions: string;
  leads: string;
  resas_demandees: string;
  resas_confirmees: string;
  venus: string;
  spend: string; // en euros à l'écran
};

const EMPTY_FORM: FormState = {
  editingId: null,
  channel: "qr",
  period_start: "",
  period_end: "",
  impressions: "",
  leads: "",
  resas_demandees: "",
  resas_confirmees: "",
  venus: "",
  spend: "",
};

export default function LeadsPipelineTab({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = canManageLeads(role);
  const [rows, setRows] = useState<LeadChannelStatRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("lead_channel_stats")
      .select("*")
      .order("created_at", { ascending: false });
    if (e) {
      setError(e.message);
      return;
    }
    setError("");
    setRows((data ?? []) as LeadChannelStatRow[]);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("lead_channel_stats")
        .select("*")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (e) setError(e.message);
      else setRows((data ?? []) as LeadChannelStatRow[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // La table 0062 ne porte pas la soirée résolue (label/date/venue) : le board affiche « aucune soirée
  // active » plutôt qu'un rattachement fabriqué. Les lignes restent agrégées par canal, honnêtement.
  const view = useMemo(() => buildLeadsBoardView(rows, null), [rows]);

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function loadIntoForm(r: LeadChannelStatRow) {
    setForm({
      editingId: r.id,
      channel: r.channel,
      period_start: r.period_start ?? "",
      period_end: r.period_end ?? "",
      impressions: fromInt(r.impressions),
      leads: fromInt(r.leads),
      resas_demandees: fromInt(r.resas_demandees),
      resas_confirmees: fromInt(r.resas_confirmees),
      venus: fromInt(r.venus),
      spend: fromCents(r.spend_cents),
    });
  }

  async function submit() {
    setError("");
    const draft: LeadStatDraft = {
      channel: form.channel,
      period_start: form.period_start.trim() || null,
      period_end: form.period_end.trim() || null,
      impressions: toIntOrNull(form.impressions),
      leads: toIntOrNull(form.leads),
      resas_demandees: toIntOrNull(form.resas_demandees),
      resas_confirmees: toIntOrNull(form.resas_confirmees),
      venus: toIntOrNull(form.venus),
      spend_cents: toCentsOrNull(form.spend),
    };
    const check = validateLeadStatDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    if (form.editingId) {
      const { error: e } = await supabase
        .from("lead_channel_stats")
        .update(draft)
        .eq("id", form.editingId);
      if (e) {
        setError(`Modification refusée : ${e.message}`);
        return;
      }
    } else {
      const { error: e } = await supabase
        .from("lead_channel_stats")
        .insert({ ...draft, created_by: username });
      if (e) {
        setError(`Saisie refusée : ${e.message}`);
        return;
      }
    }
    resetForm();
    await load();
  }

  // Garde d'affichage (matrice B12 : direction seule). Miroir de canViewLeads — jamais une sécurité en
  // soi (la RLS 0062 filtre déjà toute ligne pour les autres rôles), mais un message honnête plutôt
  // qu'un board vide trompeur.
  if (!canViewLeads(role)) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Le tunnel commercial (leads &amp; retour pub) est réservé à la direction (admin / manager, matrice
        B12). Ce rôle n’y a aucun accès.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-white/40">Chargement du tunnel commercial…</div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      {/* Board présentationnel (funnel par canal + synthèse honnête). */}
      <LeadsPipelineBoard view={view} role={role} />

      {/* Saisie direction : seul l'admin pilote (canManageLeads) ; le manager consulte le board ci-dessus. */}
      {canManage && (
        <div className={CARD}>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-bold uppercase text-white/50">
              {form.editingId ? "Modifier une ligne de canal" : "Saisir une ligne de canal"}
            </div>
            {form.editingId && (
              <button className="text-[11px] font-bold text-white/50 underline" onClick={resetForm}>
                Nouvelle ligne
              </button>
            )}
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select
                className={INPUT}
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
              >
                {LEAD_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {leadChannelTitle(c)}
                  </option>
                ))}
              </select>
              <input
                className={INPUT}
                inputMode="decimal"
                placeholder="Dépense pub € (opt.)"
                value={form.spend}
                onChange={(e) => setForm({ ...form, spend: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] uppercase text-white/40">
                Début période
                <input
                  type="date"
                  className={INPUT}
                  value={form.period_start}
                  onChange={(e) => setForm({ ...form, period_start: e.target.value })}
                />
              </label>
              <label className="text-[10px] uppercase text-white/40">
                Fin période
                <input
                  type="date"
                  className={INPUT}
                  value={form.period_end}
                  onChange={(e) => setForm({ ...form, period_end: e.target.value })}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <input className={INPUT} inputMode="numeric" placeholder="Impressions" value={form.impressions} onChange={(e) => setForm({ ...form, impressions: e.target.value })} />
              <input className={INPUT} inputMode="numeric" placeholder="Leads" value={form.leads} onChange={(e) => setForm({ ...form, leads: e.target.value })} />
              <input className={INPUT} inputMode="numeric" placeholder="Résas dem." value={form.resas_demandees} onChange={(e) => setForm({ ...form, resas_demandees: e.target.value })} />
              <input className={INPUT} inputMode="numeric" placeholder="Résas conf." value={form.resas_confirmees} onChange={(e) => setForm({ ...form, resas_confirmees: e.target.value })} />
              <input className={INPUT} inputMode="numeric" placeholder="Entrées" value={form.venus} onChange={(e) => setForm({ ...form, venus: e.target.value })} />
            </div>
            <p className="text-[10px] text-white/35">
              Laisser un champ VIDE = étape non trackée (« — »), jamais un faux zéro. La dépense n’est engagée
              par personne ici : elle est saisie après GO fondateur.
            </p>
            <div className="flex gap-2">
              <button className={BTN} onClick={submit}>
                {form.editingId ? "Enregistrer les modifications" : "Enregistrer la ligne"}
              </button>
              {form.editingId && (
                <button className={GHOST} onClick={resetForm}>
                  Annuler
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lignes brutes saisies (source du funnel agrégé ci-dessus). Cliquer pour éditer (admin). */}
      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">
          Lignes saisies ({rows.length})
        </div>
        {rows.length === 0 ? (
          <div className="text-center text-sm text-white/40">
            Aucune ligne saisie. La direction renseigne le funnel réel par canal — rien n’est fabriqué.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className={`${CARD} flex items-center justify-between gap-2`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{isLeadChannel(r.channel) ? leadChannelTitle(r.channel) : r.channel}</div>
                  <div className="text-[11px] text-white/50">
                    {r.period_start ?? "—"} → {r.period_end ?? "—"}
                    {" · "}
                    L {fromInt(r.leads) || "—"} / RC {fromInt(r.resas_confirmees) || "—"} / E {fromInt(r.venus) || "—"}
                    {r.spend_cents !== null ? ` · ${fromCents(r.spend_cents)} €` : ""}
                  </div>
                </div>
                {canManage && (
                  <button
                    className="shrink-0 text-[11px] font-bold text-orange-300 underline"
                    onClick={() => loadIntoForm(r)}
                  >
                    Éditer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
