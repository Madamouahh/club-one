"use client";

// components/MonPlanningView.tsx — vue SALARIÉ « Mon planning » du module RH / Planning (B7).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe MES shifts (déjà scopés par la RLS
// 0011 : staff_shifts_read cantonne chaque salarié à SA fiche) et une date de référence injectée, et il
// rend une lecture honnête : mes créneaux à venir / passés, mes heures réelles cumulées, et un bouton
// « Confirmer ma présence » en 1 tap là où c'est encore possible. Il n'accorde AUCUN droit :
//   · l'onglet « Mon planning » est ouvert à tous les rôles SALARIÉS sauf le promoteur (matrice B7) — la
//     garde est canViewTab(role, "monplanning"), miroir UI de la RLS 0011. Le promoteur voit un message
//     de fermeture (il n'est pas dans l'effectif) ;
//   · AUCUN coût n'est calculé ni affiché : le taux horaire est de la PII paie qui ne quitte JAMAIS la vue
//     direction — la vue salarié n'affiche que SES heures, jamais son coût ni celui des autres ;
//   · la confirmation 1-tap n'est proposée QUE si canSelfConfirm (créneau encore 'planifie') — miroir exact
//     de la garde SQL de confirm_my_shift_v1 (0020). L'écriture réelle est faite par le parent via la RPC ;
//     ce composant ne fait que MASQUER le bouton quand il n'a plus lieu d'être.
//
// États vides HONNÊTES : aucun créneau → un message clair ; heures réelles null (rien pointé) ≠ « 0 h ».

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import { canViewTab } from "@/lib/permissions";
import type { StaffShift } from "@/lib/rhPlanning";
import {
  canSelfConfirm,
  shiftStatusLabel,
  splitMyShifts,
  summarizeMyHours,
} from "@/lib/rhSelf";

function hours(n: number | null): string {
  return n == null ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
}

function ShiftRow({
  shift,
  onConfirm,
}: {
  shift: StaffShift;
  onConfirm?: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const confirmable = onConfirm != null && canSelfConfirm(shift);

  async function confirm() {
    if (!onConfirm) return;
    setBusy(true);
    try {
      await onConfirm(shift.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="min-w-0">
        <span className="text-sm font-semibold text-white">{shift.exploitation_date}</span>
        {shift.poste && <span className="ml-2 text-xs text-white/40">{shift.poste}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-white/[0.06] px-2 py-0.5 text-xs text-white/60">
          {shiftStatusLabel(shift.status)}
        </span>
        {confirmable && (
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className="rounded-lg bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
          >
            Confirmer ma présence
          </button>
        )}
      </div>
    </div>
  );
}

export default function MonPlanningView({
  shifts,
  role,
  refDate,
  onConfirm,
}: {
  shifts: readonly StaffShift[];
  role: StaffRole;
  refDate: Date;
  onConfirm?: (id: string) => Promise<void>;
}) {
  // Garde UI (miroir RLS 0011 : le promoteur n'est pas dans l'effectif → aucun « Mon planning »).
  if (!canViewTab(role, "monplanning")) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        « Mon planning » est réservé aux membres de l’effectif (matrice B7). Ce rôle n’y a pas accès.
      </p>
    );
  }

  const list = [...shifts];
  const summary = summarizeMyHours(list, refDate);
  const split = splitMyShifts(list, refDate);

  return (
    <div className="space-y-4">
      {/* Synthèse personnelle — aucun coût, uniquement MES heures/créneaux. */}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
          <p className="text-xs text-white/40">À venir</p>
          <p className="font-semibold text-white">{summary.aVenir}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
          <p className="text-xs text-white/40">À confirmer</p>
          <p className={`font-semibold ${summary.aConfirmer > 0 ? "text-emerald-300" : "text-white"}`}>
            {summary.aConfirmer}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
          <p className="text-xs text-white/40">Présences</p>
          <p className="font-semibold text-white">{summary.presents}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
          <p className="text-xs text-white/40">Heures pointées</p>
          <p className="font-semibold text-white">{hours(summary.heuresReellesCumul)}</p>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Aucun créneau à ton nom. Un planning vide n’affiche rien de fabriqué — tes créneaux apparaîtront
          quand la direction les aura saisis.
        </p>
      ) : (
        <>
          <section>
            <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
              À venir ({split.upcoming.length})
            </p>
            {split.upcoming.length === 0 ? (
              <p className="text-sm text-white/40">Aucun créneau à venir.</p>
            ) : (
              <div className="space-y-1.5">
                {split.upcoming.map((s) => (
                  <ShiftRow key={s.id} shift={s} onConfirm={onConfirm} />
                ))}
              </div>
            )}
          </section>

          {split.past.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
                Passés ({split.past.length})
              </p>
              <div className="space-y-1.5">
                {split.past.map((s) => (
                  <ShiftRow key={s.id} shift={s} />
                ))}
              </div>
            </section>
          )}

          {split.undated.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
                Sans date lisible ({split.undated.length})
              </p>
              <div className="space-y-1.5">
                {split.undated.map((s) => (
                  <ShiftRow key={s.id} shift={s} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
