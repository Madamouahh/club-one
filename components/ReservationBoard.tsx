"use client";

// components/ReservationBoard.tsx — RÉSERVATIONS VUE SOIRÉE (A3), banc d'accueil.
//
// Composant PRÉSENTATIONNEL : AUCUN réseau. On lui passe une vue déjà agrégée par buildReservationBoard
// (lib/resaBoard) — construite à partir des réservations APPROUVÉES de la soirée (file resaRequest →
// migration 0025), déjà filtrées par la RLS. Il ne recalcule ni ne redécide rien ; il n'accorde aucun droit :
//   · consultation réservée à la direction + accueil/porte (canViewResaBoard). Tout autre rôle → fermeture.
//   · le POINTAGE d'arrivée est un GESTE HUMAIN (l'accueil clique attendu/arrivé/no-show) — jamais dérivé
//     d'une horloge ; le défaut est « attendu », jamais deviné « arrivé » ni « no-show ».
//   · banc VIDE honnête : sans réservation approuvée, aucun invité n'est fabriqué (message explicite).
//   · la garde de rôle est un confort d'UI, PAS une sécurité (la RLS 0025 reste l'autorité).

import type { StaffRole } from "@/lib/permissions";
import {
  ARRIVAL_STATES,
  ARRIVAL_STATE_STYLE,
  arrivalStateLabel,
  formatCovers,
  type ArrivalState,
  type ReservationBoardRow,
  type ReservationBoardView,
} from "@/lib/resaBoard";

function ArrivalBadge({ state }: { state: ArrivalState }) {
  const style = ARRIVAL_STATE_STYLE[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ borderColor: style.stroke, color: style.text }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: style.stroke }} aria-hidden />
      {arrivalStateLabel(state)}
    </span>
  );
}

function BoardRow({
  row,
  canMark,
  onMark,
}: {
  row: ReservationBoardRow;
  canMark: boolean;
  onMark?: (id: string, state: ArrivalState) => void;
}) {
  const highlight = row.arrival === "no_show";
  return (
    <div
      className={`rounded-xl border ${
        highlight ? "border-rose-500/40 bg-rose-500/[0.04]" : "border-white/10 bg-white/[0.02]"
      } p-3`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{row.label}</p>
          <p className="mt-0.5 text-[11px] text-white/45">
            {row.request.guest_name ?? "Client (nom non joint)"}
            {" · "}
            {formatCovers(row.covers)}
            {row.request.slot ? ` · créneau ${row.request.slot}` : " · sans créneau"}
          </p>
        </div>
        <ArrivalBadge state={row.arrival} />
      </div>

      {canMark && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {ARRIVAL_STATES.map((state) => {
            const active = state === row.arrival;
            return (
              <button
                key={state}
                type="button"
                onClick={() => onMark?.(row.request.id, state)}
                disabled={active}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                  active
                    ? "cursor-default border-white/20 bg-white/10 text-white/80"
                    : "border-white/10 text-white/50 hover:border-white/25 hover:text-white/80"
                }`}
              >
                {arrivalStateLabel(state)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className={`text-lg font-bold ${tone ?? "text-white"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}

export function ReservationBoard({
  view,
  role,
  onMark,
}: {
  view: ReservationBoardView;
  role: StaffRole;
  onMark?: (id: string, state: ArrivalState) => void;
}) {
  if (!view.canView) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm text-white/60">
          Le carnet de réservations de la soirée est réservé à la direction et à l’accueil.
        </p>
        <p className="mt-1 text-[11px] text-white/35">Rôle courant : {role}.</p>
      </div>
    );
  }

  const { summary, rows } = view;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="Réservations" value={String(summary.total)} />
        <SummaryTile
          label="À accueillir"
          value={String(summary.pendingArrivals)}
          tone={summary.pendingArrivals > 0 ? "text-amber-300" : "text-white/70"}
        />
        <SummaryTile label="Arrivés" value={String(summary.byArrival.arrive)} tone="text-emerald-300" />
        <SummaryTile
          label="No-show"
          value={String(summary.byArrival.no_show)}
          tone={summary.byArrival.no_show > 0 ? "text-rose-300" : "text-white/70"}
        />
      </div>

      <p className="text-[11px] text-white/40">
        Couverts attendus (hors no-show) : <span className="text-white/70">{summary.expectedCovers}</span>
        {" · "}
        déjà arrivés : <span className="text-white/70">{summary.arrivedCovers}</span>
      </p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.01] p-6 text-center">
          <p className="text-sm text-white/60">Aucune réservation validée pour cette soirée.</p>
          <p className="mt-1 text-[11px] text-white/35">
            Le banc reste vide tant qu’aucune demande n’est approuvée — aucun invité n’est fabriqué.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <BoardRow key={row.request.id} row={row} canMark={view.canMark} onMark={onMark} />
          ))}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-white/30">
        Le pointage d’arrivée est un geste humain de l’accueil ; il n’est jamais déduit d’une horloge. La
        garde d’affichage est un confort d’UI — la sécurité des coordonnées reste la RLS de la table de
        réservations.
      </p>
    </div>
  );
}
