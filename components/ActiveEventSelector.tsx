"use client";

// components/ActiveEventSelector.tsx — SÉLECTEUR UNIVERS + ÉVÉNEMENT ACTIF (module 0.4, Socle).
//
// Composant PRÉSENTATIONNEL : AUCUN réseau. On lui passe une vue déjà agrégée par
// buildActiveEventSelector (lib/activeEventSelector) — construite à partir du contexte serveur DÉJÀ
// chargé par lib/activeEvent (get_active_event_context + list_activatable_club_events). Il ne recalcule
// ni ne redécide rien, et n'accorde aucun droit :
//   · TOUS les rôles voient QUELLE soirée est active (bandeau contextuel). Un rôle non-staff → fermeture.
//   · seule la DIRECTION (canManageActiveEvent) déclenche amorçage / activation. La décision
//     bootstrap-vs-activation vient du contexte serveur (résolue dans la lib), jamais d'un message d'erreur.
//   · les CALLBACKS (onBootstrap/onActivate/onSelect) sont fournis par l'appelant : en réel ils appellent
//     les RPC SECURITY DEFINER (bootstrap_club_event_v2 / activate_club_event_v2). Ce composant ne mute rien.
//   · liste VIDE honnête : sans candidat activable, on n'affiche aucune soirée fabriquée.

import type { StaffRole } from "@/lib/permissions";
import {
  candidateStatusLabel,
  lifecycleActionLabel,
  lifecycleReasonMessage,
  type ActiveEventSelectorView,
  type SelectorCandidate,
} from "@/lib/activeEventSelector";

// Formatage FR déterministe d'une date ISO/AAAA-MM-JJ → « 10/07/2026 » (aucune new Date() : rendu stable
// serveur/client). On lit les composantes de la chaîne sans horloge locale ; illisible → chaîne brute.
function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className={`text-lg font-bold ${tone ?? "text-white"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}

function CandidateRow({
  candidate,
  selectable,
  selected,
  onSelect,
}: {
  candidate: SelectorCandidate;
  selectable: boolean;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const inner = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{candidate.title}</p>
        <p className="mt-0.5 text-[11px] text-white/45">
          {formatDate(candidate.eventDate)} · {candidate.venueLabel}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          candidate.activatable
            ? "border-emerald-400/40 text-emerald-200"
            : "border-white/15 text-white/40"
        }`}
      >
        {candidateStatusLabel(candidate.status)}
      </span>
    </div>
  );

  const base = `w-full rounded-xl border p-3 text-left transition ${
    selected
      ? "border-sky-400/60 bg-sky-500/10"
      : candidate.activatable
        ? "border-white/10 bg-white/[0.02] hover:border-white/25"
        : "border-white/10 bg-white/[0.01]"
  }`;

  if (selectable && candidate.activatable) {
    return (
      <button type="button" onClick={() => onSelect?.(candidate.id)} className={base}>
        {inner}
      </button>
    );
  }
  return (
    <div className={base} aria-disabled>
      {inner}
      {!candidate.activatable && (
        <p className="mt-1 text-[10px] text-white/35">Non activable (statut non brouillon/publié).</p>
      )}
    </div>
  );
}

export function ActiveEventSelector({
  view,
  role,
  venueFilter,
  onVenueFilter,
  onSelect,
  onBootstrap,
  onActivate,
}: {
  view: ActiveEventSelectorView;
  role: StaffRole;
  venueFilter: string | null;
  onVenueFilter?: (key: string | null) => void;
  onSelect?: (id: string) => void;
  onBootstrap?: (eventId: string) => void;
  onActivate?: (eventId: string) => void;
}) {
  if (!view.canView) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm text-white/60">Le contexte d’événement actif est réservé au personnel.</p>
        <p className="mt-1 text-[11px] text-white/35">Rôle courant : {role}.</p>
      </div>
    );
  }

  const { lifecycle } = view;
  const selectable = lifecycle.requiresCandidate;

  // Le bouton d'action (amorcer/activer) n'est proposé qu'à la direction, action requise, choix valide.
  const primaryEnabled = view.selectionValid && view.selected !== null;
  const onPrimary = () => {
    if (!view.selected) return;
    if (lifecycle.action === "bootstrap") onBootstrap?.(view.selected.id);
    else if (lifecycle.action === "activate") onActivate?.(view.selected.id);
  };

  return (
    <div className="space-y-4">
      {/* État courant du socle événementiel */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile
          label="Soirée active"
          value={view.activeEvent ? "1" : "0"}
          tone={view.activeEvent ? "text-emerald-300" : "text-white/70"}
        />
        <SummaryTile label="Candidates" value={String(view.totalCandidates)} />
        <SummaryTile
          label="Activables"
          value={String(view.activatableCandidates)}
          tone={view.activatableCandidates > 0 ? "text-white" : "text-white/50"}
        />
        <SummaryTile label="Socle amorcé" value={view.bootstrapCompleted ? "oui" : "non"} />
      </div>

      {/* Bandeau contextuel : quelle soirée est active (ou aucune) */}
      {view.activeEvent ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.06] p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-200/70">Soirée active</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {view.activeEvent.title ?? "Soirée sans titre"}
          </p>
          <p className="mt-0.5 text-[11px] text-white/50">
            {formatDate(view.activeEvent.eventDate)} · id {view.activeEvent.eventId}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.01] p-4 text-center">
          <p className="text-sm text-white/60">Aucune soirée active.</p>
          {view.lastClosedEventId && (
            <p className="mt-1 text-[11px] text-white/35">
              Dernière soirée clôturée : {view.lastClosedEventId}
            </p>
          )}
        </div>
      )}

      {/* Cycle de vie : pourquoi telle action (ou aucune) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/50">
          {lifecycleActionLabel(lifecycle.action)}
        </p>
        <p className="mt-1 text-[12px] text-white/60">{lifecycleReasonMessage(lifecycle.reason)}</p>
      </div>

      {/* Filtre univers — uniquement les univers réellement présents dans les candidates */}
      {view.venueFilterOptions.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">Univers</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onVenueFilter?.(null)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                venueFilter === null
                  ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
              }`}
            >
              Tous
            </button>
            {view.venueFilterOptions.map((opt) => {
              const active = venueFilter === opt.key;
              return (
                <button
                  key={opt.key || "__unset__"}
                  type="button"
                  onClick={() => onVenueFilter?.(opt.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                    active
                      ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
                  }`}
                >
                  {opt.label}
                  <span className="ml-1.5 text-[10px] text-white/40">{opt.activatableCount}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Liste des candidates par univers */}
      {view.groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.01] p-6 text-center">
          <p className="text-sm text-white/60">
            {view.filteredByVenue
              ? "Aucune soirée dans cet univers."
              : "Aucune soirée à activer."}
          </p>
          <p className="mt-1 text-[11px] text-white/35">
            La liste reste vide tant qu’aucun événement activable n’existe côté serveur — aucune soirée
            n’est fabriquée.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {view.groups.map((group) => (
            <section key={group.venueKey || "__unset__"}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">
                  {group.venueLabel}
                </p>
                <p className="text-[10px] text-white/35">
                  {group.activatableCount}/{group.candidates.length} activable
                  {group.candidates.length > 1 ? "s" : ""}
                </p>
              </div>
              <div className="space-y-2">
                {group.candidates.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    selectable={selectable}
                    selected={view.selected?.id === c.id}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Action principale — direction uniquement, choix valide requis */}
      {selectable && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[11px] text-white/50">
            {view.selected
              ? view.selectionValid
                ? `Cible : ${view.selected.title}`
                : "La soirée choisie n’est pas activable."
              : "Choisissez une soirée à activer."}
          </p>
          <button
            type="button"
            disabled={!primaryEnabled}
            onClick={onPrimary}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              primaryEnabled
                ? "border-emerald-400/50 text-emerald-100 hover:border-emerald-300/80"
                : "cursor-not-allowed border-white/10 text-white/30"
            }`}
          >
            {lifecycleActionLabel(lifecycle.action)}
          </button>
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-white/30">
        Le choix amorçage-vs-activation vient du contexte serveur, jamais d’un message d’erreur. La garde
        d’affichage est un confort d’UI ; l’autorité reste les RPC SECURITY DEFINER (amorçage / activation
        / clôture) et la RLS. Ce composant ne modifie rien.
      </p>
    </div>
  );
}
