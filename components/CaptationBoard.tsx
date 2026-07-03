"use client";

// components/CaptationBoard.tsx — shot list de captation en soirée (A10).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe les plans + les captures de la soirée
// (déjà filtrés par la RLS 0029), le rôle, et un callback `onSetStatus` pour faire avancer le statut. Les
// écritures réelles sont faites par le parent sous RLS — ce composant n'accorde AUCUN droit : il ne montre
// les boutons de statut que si le rôle peut capter (direction, plan actif). Si le rôle n'a pas accès à la
// captation, il ne rend rien d'exploitable (message clair).
//
// États vides HONNÊTES : aucun plan → un message clair, jamais une ligne fabriquée. Toute la logique
// (fusion, groupage, avancement) est dans lib/captation.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  buildShotLines,
  canCaptureShot,
  canViewCaptation,
  CAPTATION_STATUSES,
  groupByVenue,
  statusLabel,
  summarizeCaptation,
  venueLabel,
  type CaptationStatus,
  type ShotCapture,
  type ShotLine,
  type ShotListItem,
} from "@/lib/captation";

function StatusBadge({ status }: { status: CaptationStatus }) {
  const tone =
    status === "depose"
      ? "bg-emerald-500/20 text-emerald-200"
      : status === "capture"
        ? "bg-sky-500/20 text-sky-200"
        : "bg-white/10 text-white/60";
  return <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs ${tone}`}>{statusLabel(status)}</span>;
}

function ShotRow({
  line,
  role,
  onSetStatus,
}: {
  line: ShotLine;
  role: StaffRole;
  onSetStatus: (itemId: string, status: CaptationStatus) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const canCapture = canCaptureShot(role, line.item);

  async function setStatus(status: CaptationStatus) {
    setBusy(true);
    try {
      await onSetStatus(line.item.id, status);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="min-w-0">
        <span className="text-sm text-white">
          {line.item.prioritaire && <span className="mr-1 text-amber-300">★</span>}
          {line.item.label}
        </span>
        <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-white/40">
          {line.item.sujet && <span>{line.item.sujet}</span>}
          {line.item.format && <span>{line.item.format}</span>}
          {line.item.heure_ideale && <span>⏱ {line.item.heure_ideale}</span>}
        </div>
      </div>
      {canCapture ? (
        <div className="flex shrink-0 gap-1">
          {CAPTATION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy || s === line.status}
              onClick={() => setStatus(s)}
              className={
                s === line.status
                  ? "rounded-lg bg-white/15 px-2 py-0.5 text-xs text-white disabled:opacity-100"
                  : "rounded-lg bg-white/[0.06] px-2 py-0.5 text-xs text-white/50 disabled:opacity-40"
              }
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
      ) : (
        <StatusBadge status={line.status} />
      )}
    </div>
  );
}

export default function CaptationBoard({
  items,
  captures,
  exploitationDate,
  role,
  onSetStatus,
}: {
  items: readonly ShotListItem[];
  captures: readonly ShotCapture[];
  exploitationDate: string;
  role: StaffRole;
  onSetStatus: (itemId: string, status: CaptationStatus) => Promise<void>;
}) {
  // La captation est réservée à la direction (créa dans le socle) — la RLS 0029 est l'autorité ; ce garde
  // n'est qu'un miroir UI.
  if (!canViewCaptation(role)) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        La captation n’est pas accessible à ce rôle.
      </p>
    );
  }

  const lines = buildShotLines(items, captures, exploitationDate);
  const groups = groupByVenue(lines);
  const summary = summarizeCaptation(lines);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
        <span>
          {summary.deposited}/{summary.total} déposé{summary.total > 1 ? "s" : ""}
        </span>
        <span>{summary.captured} capturé{summary.captured > 1 ? "s" : ""}</span>
        <span>{summary.remaining} à capturer</span>
        {summary.complete && <span className="text-emerald-300">Tout est déposé ✓</span>}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Aucun plan de captation. La créa peut composer la shot list de la soirée (moments prioritaires,
          sujets, formats).
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.venue ?? "toutes"} className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-white/40">{venueLabel(g.venue)}</p>
            {g.lines.map((line) => (
              <ShotRow key={line.item.id} line={line} role={role} onSetStatus={onSetStatus} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
