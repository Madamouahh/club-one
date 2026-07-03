"use client";

// components/ArtistCheckinBoard.tsx — tableau d'accueil du module ARTIST CHECK-IN (A8).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe les fiches déjà chargées (que la
// RLS 0027 a déjà filtrées : direction/sécurité seulement), le rôle, et un callback `onAdvance` pour
// faire évoluer une fiche (jalon/statut). Les écritures réelles sont faites par le parent sous RLS —
// ce composant n'accorde AUCUN droit, il reflète et prépare. Les boutons d'avancement ne sont rendus
// que si le rôle peut gérer (matrice A8) ; la sécurité voit en lecture seule.
//
// États vides HONNÊTES : aucune fiche → un message clair, jamais une ligne fabriquée. Toute la logique
// (tri, avancement, résumé) est dans lib/artistCheckin.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  canManageArtistCheckin,
  checkinStatusLabel,
  checkinSteps,
  isReadyForStage,
  sortForBoard,
  summarizeCheckins,
  type ArtistCheckin,
  type CheckinStatus,
} from "@/lib/artistCheckin";

function StepPip({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={done ? "text-emerald-300" : "text-white/30"}>
      {done ? "●" : "○"} {label}
    </span>
  );
}

function CheckinCard({
  checkin,
  canManage,
  onAdvance,
}: {
  checkin: ArtistCheckin;
  canManage: boolean;
  onAdvance: (id: string, next: CheckinStatus) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const steps = checkinSteps(checkin);
  const ready = isReadyForStage(checkin);

  async function advance(next: CheckinStatus) {
    setBusy(true);
    try {
      await onAdvance(checkin.id, next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white">{checkin.artist_name}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/80">
          {checkinStatusLabel(checkin.status)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-2 text-xs text-white/50">
        {checkin.slot_label && <span>{checkin.slot_label}</span>}
        {checkin.dressing_room && <span>· Loge {checkin.dressing_room}</span>}
        {checkin.companions > 0 && <span>· +{checkin.companions} accomp.</span>}
        {ready && <span className="text-emerald-300">· Prêt scène</span>}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <StepPip done={steps.arrived} label="Arrivé" />
        <StepPip done={steps.soundcheck} label="Balance" />
        <StepPip done={steps.techValidated} label="Tech OK" />
      </div>

      {canManage && checkin.status !== "termine" && checkin.status !== "annule" && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {!steps.arrived && (
            <button
              type="button"
              disabled={busy}
              onClick={() => advance("arrive")}
              className="rounded-lg bg-white/10 px-2 py-0.5 text-white disabled:opacity-40"
            >
              Marquer arrivé
            </button>
          )}
          {steps.arrived && checkin.status !== "en_scene" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => advance("en_scene")}
              className="rounded-lg bg-white/10 px-2 py-0.5 text-white disabled:opacity-40"
            >
              En scène
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => advance("termine")}
            className="rounded-lg bg-emerald-500/20 px-2 py-0.5 text-emerald-200 disabled:opacity-40"
          >
            Terminer
          </button>
        </div>
      )}
    </div>
  );
}

export default function ArtistCheckinBoard({
  checkins,
  role,
  onAdvance,
}: {
  checkins: readonly ArtistCheckin[];
  role: StaffRole;
  onAdvance: (id: string, next: CheckinStatus) => Promise<void>;
}) {
  const canManage = canManageArtistCheckin(role);
  const ordered = sortForBoard(checkins);
  const summary = summarizeCheckins(checkins);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-white/60">
        <span>{summary.total} fiche(s)</span>
        {summary.attendus > 0 && <span>{summary.attendus} attendu(s)</span>}
        {summary.arrives > 0 && <span className="text-emerald-300">{summary.arrives} arrivé(s)</span>}
        {summary.prets > 0 && <span>{summary.prets} prêt(s)</span>}
        {summary.noShow > 0 && <span className="text-rose-300">{summary.noShow} no-show</span>}
      </div>

      {ordered.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Aucun artiste pour cette soirée.
        </p>
      ) : (
        <div className="space-y-2">
          {ordered.map((c) => (
            <CheckinCard key={c.id} checkin={c} canManage={canManage} onAdvance={onAdvance} />
          ))}
        </div>
      )}
    </div>
  );
}
