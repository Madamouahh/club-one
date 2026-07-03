"use client";

// components/ReservationRequestQueue.tsx — FILE STAFF de validation des demandes de résa (chunk 4).
//
// Composant PRÉSENTATIONNEL : aucun réseau. On lui passe les demandes (table_reservation_requests,
// migration 0025, déjà cantonnées par la RLS : direction voit tout, promoteur voit SES clients), le
// rôle courant, et un callback `onDecide(id, decision, reason)`. La décision réelle (RPC
// decide_table_reservation_v1, réservée admin/manager) est faite par le PARENT — ce composant
// n'accorde AUCUN droit : il n'affiche les boutons Valider/Refuser QUE si le rôle peut décider, mais
// c'est la RLS/RPC qui tranche vraiment.
//
// Discipline d'honnêteté : file vide → état vide explicite ; une demande déjà traitée n'est plus
// décidable (miroir du garde SQL `not_pending`) ; les compteurs sont RÉELS (aucune donnée fabriquée).

import { useState } from "react";
import {
  canDecideResa,
  isDecidable,
  requestSummaryLabel,
  resaQueueSummary,
  sortForQueue,
  RESA_STATUS_STYLE,
  type ReservationRequestRow,
  type ResaDecision,
} from "@/lib/resaRequest";

function RequestCard({
  row,
  canDecide,
  onDecide,
}: {
  row: ReservationRequestRow;
  canDecide: boolean;
  onDecide: (id: string, decision: ResaDecision, reason: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState<ResaDecision | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const style = RESA_STATUS_STYLE[row.status];
  const decidable = isDecidable(row) && canDecide;

  async function decide(decision: ResaDecision) {
    if (!decidable || busy) return;
    setBusy(decision);
    setError("");
    try {
      await onDecide(row.id, decision, decision === "decline" ? reason.trim() || null : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-white">{requestSummaryLabel(row)}</p>
          <p className="text-[11px] text-white/45">
            {row.guest_name || "Client"}
            {row.slot ? ` · créneau ${row.slot}` : ""}
            {` · ${row.exploitation_date}`}
          </p>
          {row.guest_note && <p className="mt-1 text-[11px] italic text-white/40">« {row.guest_note} »</p>}
        </div>
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ borderColor: style.stroke, color: style.text }}
        >
          {style.label}
        </span>
      </div>

      {decidable ? (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motif de refus (facultatif)"
            className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-white/40"
          />
          <div className="flex gap-2">
            <button
              onClick={() => decide("approve")}
              disabled={busy !== null}
              className="flex-1 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-40"
            >
              {busy === "approve" ? "…" : "Valider"}
            </button>
            <button
              onClick={() => decide("decline")}
              disabled={busy !== null}
              className="flex-1 rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-200 transition hover:bg-red-500/25 disabled:opacity-40"
            >
              {busy === "decline" ? "…" : "Refuser"}
            </button>
          </div>
          {error && <p className="text-[11px] text-red-300">{error}</p>}
        </div>
      ) : (
        row.status !== "pending" &&
        (row.decided_by || row.decline_reason) && (
          <p className="mt-2 text-[11px] text-white/40">
            {row.decided_by ? `Traitée par ${row.decided_by}` : "Traitée"}
            {row.decline_reason ? ` · ${row.decline_reason}` : ""}
          </p>
        )
      )}
    </div>
  );
}

export function ReservationRequestQueue({
  requests,
  role,
  onDecide,
}: {
  requests: ReservationRequestRow[];
  role: string | null | undefined;
  onDecide: (id: string, decision: ResaDecision, reason: string | null) => Promise<void>;
}) {
  const ordered = sortForQueue(requests);
  const summary = resaQueueSummary(requests);
  const canDecide = canDecideResa(role);

  if (ordered.length === 0) {
    // État vide HONNÊTE : aucune demande de réservation (jamais une file fabriquée).
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/45">
        Aucune demande de réservation.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">
          Demandes de réservation
        </p>
        <p className="text-[11px] text-white/45">
          <span className="font-bold text-amber-300">{summary.pending}</span> en attente ·{" "}
          <span className="font-bold text-emerald-300">{summary.approved}</span> validées ·{" "}
          {summary.declined} refusées
        </p>
      </div>

      {!canDecide && summary.pending > 0 && (
        <p className="text-[11px] text-white/40">
          La validation des demandes est réservée à la direction.
        </p>
      )}

      {ordered.map((r) => (
        <RequestCard key={r.id} row={r} canDecide={canDecide} onDecide={onDecide} />
      ))}
    </div>
  );
}
