"use client";

// components/CommandCenter.tsx — CENTRE DE COMMANDEMENT direction (B1).
//
// Composant PRÉSENTATIONNEL : AUCUN réseau. On lui passe une vue déjà agrégée par
// buildCommandCenter (lib/commandCenter) — construite en amont à partir des signaux compacts des
// modules déjà protégés par leur RLS. Ce composant ne recalcule ni ne redécide rien ; il n'accorde
// aucun droit :
//   · B1 est réservé à la DIRECTION (admin/manager) — garde canViewCommandCenter, miroir UI du
//     palier direction qui voit déjà le board RH et le P&L. Tout autre rôle → message de fermeture.
//   · HONNÊTETÉ DE COUVERTURE assumée à l'écran : un module non branché s'affiche « Non branché »,
//     jamais un faux zéro rassurant. Le compteur de couverture (branchés / total) est mis en avant.
//   · États vides honnêtes : aucune soirée active → cockpit en veille, pas de données fabriquées.

import type { AppTab, StaffRole } from "@/lib/permissions";
import {
  canViewCommandCenter,
  commandCenterDomainTab,
  commandCenterSeverityLabel,
  type CommandCenterSeverity,
  type CommandCenterTile,
  type CommandCenterView,
} from "@/lib/commandCenter";

// Style par sévérité (bordure + pastille). Le « non branché » est visuellement en retrait (gris),
// jamais confondu avec un « OK » vert.
const SEVERITY_STYLE: Record<
  CommandCenterSeverity,
  { ring: string; dot: string; text: string }
> = {
  critique: { ring: "border-rose-500/40", dot: "bg-rose-400", text: "text-rose-300" },
  attention: { ring: "border-amber-500/40", dot: "bg-amber-400", text: "text-amber-300" },
  ok: { ring: "border-emerald-500/30", dot: "bg-emerald-400", text: "text-emerald-300" },
  vide: { ring: "border-white/10", dot: "bg-white/30", text: "text-white/50" },
  non_connecte: { ring: "border-white/5", dot: "bg-white/15", text: "text-white/35" },
};

// Contenu d'une tuile (identique branchée/non branchée). Le wrapper cliquable est décidé par Tile.
function TileBody({ tile }: { tile: CommandCenterTile }) {
  const s = SEVERITY_STYLE[tile.severity];
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-white/50">
          {tile.title}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
          <span className={`text-[10px] font-bold uppercase tracking-wide ${s.text}`}>
            {commandCenterSeverityLabel(tile.severity)}
          </span>
        </span>
      </div>
      <p className={`mt-2 text-lg font-bold ${tile.connected ? "text-white" : "text-white/40"}`}>
        {tile.headline}
      </p>
      {tile.detail && <p className="mt-1 text-xs text-white/45">{tile.detail}</p>}
    </>
  );
}

// Une tuile BRANCHÉE est cliquable (bouton) : elle ouvre l'onglet du module réel via onOpen. Une
// tuile « non branché » reste un simple bloc non interactif (rien à ouvrir honnêtement).
function Tile({
  tile,
  onOpen,
}: {
  tile: CommandCenterTile;
  onOpen?: (tab: AppTab) => void;
}) {
  const s = SEVERITY_STYLE[tile.severity];
  const base = `rounded-2xl border ${s.ring} ${
    tile.connected ? "bg-white/[0.03]" : "bg-white/[0.01]"
  } p-4`;

  if (tile.connected && onOpen) {
    return (
      <button
        type="button"
        data-testid={`cc-tile-${tile.key}`}
        onClick={() => onOpen(commandCenterDomainTab(tile.key))}
        className={`${base} w-full text-left transition hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30`}
      >
        <TileBody tile={tile} />
      </button>
    );
  }

  return (
    <div data-testid={`cc-tile-${tile.key}`} className={base}>
      <TileBody tile={tile} />
    </div>
  );
}

export default function CommandCenter({
  view,
  role,
  onOpen,
  loading = false,
  error = null,
}: {
  view: CommandCenterView;
  role: StaffRole;
  onOpen?: (tab: AppTab) => void;
  loading?: boolean;
  error?: string | null;
}) {
  // Garde UI (palier direction). B1 ne lit aucune table propre : la vraie sécurité reste la RLS de
  // chaque source ; ce prédicat ne fait que refléter le périmètre direction côté écran.
  if (!canViewCommandCenter(role)) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Le centre de commandement (vue direction consolidée) est réservé à la direction
        (admin / manager, matrice B1). Ce rôle n’y a aucun accès.
      </p>
    );
  }

  // État de chargement : squelette honnête, aucune donnée fabriquée le temps que les signaux arrivent.
  if (loading) {
    return (
      <div
        data-testid="command-center"
        className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/50"
      >
        Chargement du centre de commandement…
      </div>
    );
  }

  // État d'erreur : encart rouge avec le message, et rien d'autre (on n'affiche pas de fausse vue).
  if (error) {
    return (
      <div
        data-testid="command-center"
        className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.06] p-4 text-sm text-rose-200"
      >
        {error}
      </div>
    );
  }

  const { event, tiles, coverage, overall, attentionCount, critiqueCount } = view;
  const overallStyle = SEVERITY_STYLE[overall];

  return (
    <div data-testid="command-center" className="space-y-5">
      {/* En-tête : soirée active + synthèse globale (pire sévérité branchée). */}
      <section className={`rounded-2xl border ${overallStyle.ring} bg-white/[0.02] p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">
              Centre de commandement
            </p>
            {event ? (
              <p className="mt-1 text-sm text-white/80">
                <span className="font-semibold text-white">{event.label}</span>{" "}
                <span className="text-white/50">
                  · {event.date} · {event.venue}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-white/50">
                Aucune soirée active — cockpit en veille. Rien n’est fabriqué en l’absence de soirée.
              </p>
            )}
          </div>
          <span className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${overallStyle.dot}`} aria-hidden />
            <span className={`text-xs font-bold uppercase tracking-wide ${overallStyle.text}`}>
              {commandCenterSeverityLabel(overall)}
            </span>
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
          {critiqueCount > 0 && (
            <span className="text-rose-300">
              {critiqueCount} domaine{critiqueCount > 1 ? "s" : ""} critique
              {critiqueCount > 1 ? "s" : ""}
            </span>
          )}
          {attentionCount > 0 && (
            <span className="text-amber-300">
              {attentionCount} à traiter
            </span>
          )}
          {/* Honnêteté de couverture mise en avant : combien de modules RÉELLEMENT branchés. */}
          <span>
            Couverture{" "}
            <span data-testid="cc-coverage" className="font-semibold text-white/75">
              {coverage.connected}/{coverage.total}
            </span>{" "}
            module{coverage.total > 1 ? "s" : ""} branché{coverage.connected > 1 ? "s" : ""}
          </span>
          {coverage.notConnected > 0 && (
            <span className="text-white/35">
              {coverage.notConnected} non branché{coverage.notConnected > 1 ? "s" : ""} (structure en
              place, source à venir)
            </span>
          )}
        </div>
      </section>

      {/* Grille des tuiles, dans l'ordre canonique. Les non-branchées restent visibles, en retrait. */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Tile key={tile.key} tile={tile} onOpen={onOpen} />
        ))}
      </section>

      <p className="text-[11px] leading-relaxed text-white/35">
        Le centre de commandement n’a pas de données propres : il agrège les signaux des modules déjà
        protégés par leur RLS. Un module « Non branché » n’est pas une erreur — c’est une source
        pas encore reliée, affichée honnêtement plutôt que masquée ou remplie d’un faux zéro.
      </p>
    </div>
  );
}
