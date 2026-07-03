"use client";

// components/AgentOrchestrator.tsx — ORCHESTRATEUR D'AGENTS IA + REGISTRE D'AUTONOMIE (module 0.6, Socle).
//
// Composant PRÉSENTATIONNEL : AUCUN réseau. On lui passe une vue déjà agrégée par buildOrchestratorView
// (lib/agentOrchestrator), construite à partir d'un registre d'agents (future table) + des réglages
// globaux. Il ne recalcule ni ne redécide rien, et n'accorde aucun droit :
//   · seule la DIRECTION (canViewOrchestrator) voit l'écran ; un autre rôle → fermeture.
//   · seule la DIRECTION (canManageOrchestrator) peut changer un niveau / l'interrupteur / l'arrêt global —
//     mais ces gestes sont des CALLBACKS fournis par l'appelant. En réel ils écrivent une future table de
//     réglages + coupent les workers ; ce composant ne mute rien.
//   · le niveau EFFECTIF affiché vient de la lib (plafond de capacité + interrupteur + arrêt global) : le
//     composant ne peut pas montrer un niveau supérieur au plafond, il ne fait que RENDRE.
//   · registre VIDE honnête : sans agent, on affiche « aucun agent enregistré », jamais un agent fabriqué.
//   · télémétrie null → « non disponible », jamais un chiffre inventé.

import type { StaffRole } from "@/lib/permissions";
import {
  AUTONOMY_LEVELS,
  autonomyDescription,
  autonomyLabel,
  capabilityLabel,
  postureLabel,
  type AgentGovernance,
  type AutonomyLevel,
  type OrchestratorView,
} from "@/lib/agentOrchestrator";

const POSTURE_TONE: Record<string, string> = {
  halted: "text-rose-200 border-rose-400/40 bg-rose-500/10",
  idle: "text-white/70 border-white/10 bg-white/[0.02]",
  observe: "text-sky-100 border-sky-400/40 bg-sky-500/10",
  draft: "text-amber-100 border-amber-400/40 bg-amber-500/10",
  supervised: "text-violet-100 border-violet-400/40 bg-violet-500/10",
  autonomous: "text-emerald-100 border-emerald-400/40 bg-emerald-500/10",
};

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className={`text-lg font-bold ${tone ?? "text-white"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}

function LevelBadge({ level, muted }: { level: AutonomyLevel; muted?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${
        muted
          ? "border-white/10 bg-white/[0.03] text-white/50"
          : "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100"
      }`}
    >
      N{level} · {autonomyLabel(level)}
    </span>
  );
}

function AgentRow({
  agent,
  canManage,
  onSetLevel,
  onToggleEnabled,
}: {
  agent: AgentGovernance;
  canManage: boolean;
  onSetLevel?: (id: string, level: AutonomyLevel) => void;
  onToggleEnabled?: (id: string, enabled: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">{agent.name}</p>
          <p className="text-[11px] text-white/50">{capabilityLabel(agent.capability)}</p>
          {agent.description ? (
            <p className="mt-0.5 text-[11px] text-white/40">{agent.description}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] uppercase tracking-wide text-white/40">Niveau effectif</span>
          <LevelBadge level={agent.effectiveLevel} muted={agent.effectiveLevel === 0} />
        </div>
      </div>

      {/* Statut des bornes appliquées — honnête, non deviné */}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-white/50">
          Configuré : N{agent.configuredLevel}
        </span>
        <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-white/50">
          Plafond capacité : N{agent.ceiling}
        </span>
        {agent.cappedByCeiling && (
          <span
            className="rounded border border-amber-400/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-200"
            title={agent.ceilingReason}
          >
            plafonné (règle dure)
          </span>
        )}
        {agent.disabledBySwitch && (
          <span className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-white/60">
            interrupteur off
          </span>
        )}
        {agent.haltedByKillSwitch && (
          <span className="rounded border border-rose-400/40 bg-rose-500/10 px-1.5 py-0.5 text-rose-200">
            coupé — arrêt global
          </span>
        )}
      </div>

      {agent.cappedByCeiling && (
        <p className="mt-2 text-[11px] text-amber-200/80">{agent.ceilingReason}</p>
      )}

      {/* Gestes direction — callbacks (aucune mutation ici) */}
      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
          <span className="text-[10px] uppercase tracking-wide text-white/40">Configurer</span>
          {AUTONOMY_LEVELS.map((l) => {
            const active = l === agent.configuredLevel;
            const wouldBeCapped = l > agent.ceiling;
            return (
              <button
                key={l}
                type="button"
                onClick={() => onSetLevel?.(agent.id, l)}
                title={wouldBeCapped ? `Sera plafonné à N${agent.ceiling} : ${agent.ceilingReason}` : undefined}
                className={`rounded-md border px-2 py-0.5 text-[11px] font-bold transition ${
                  active
                    ? "border-sky-400/60 bg-sky-500/20 text-sky-100"
                    : wouldBeCapped
                      ? "border-amber-400/20 bg-white/[0.02] text-amber-200/60 hover:text-amber-100"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
                }`}
              >
                N{l}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onToggleEnabled?.(agent.id, !agent.enabled)}
            className={`ml-auto rounded-md border px-2 py-0.5 text-[11px] font-bold transition ${
              agent.enabled
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                : "border-white/15 bg-white/[0.04] text-white/60"
            }`}
          >
            {agent.enabled ? "Actif" : "Désactivé"}
          </button>
        </div>
      )}
    </div>
  );
}

function TelemetryPanel({ view }: { view: OrchestratorView }) {
  const t = view.telemetry;
  if (!t) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[12px] text-white/50">
        <p className="font-bold text-white/70">Observabilité</p>
        <p className="mt-1">
          Non disponible — aucune télémétrie branchée (coût IA, santé workers, files/retry/dead-letter).
          Aucun chiffre n’est fabriqué en son absence.
        </p>
      </div>
    );
  }
  const cell = (label: string, value: string) => (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <p className="text-sm font-bold text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
  const fmt = (n: number | null) => (n === null ? "—" : String(n));
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[12px] font-bold text-white/70">Observabilité</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cell("Coût IA (cents)", fmt(t.aiCostCents))}
        {cell("File", fmt(t.queuedJobs))}
        {cell("Retry", fmt(t.retryJobs))}
        {cell("Dead-letter", fmt(t.deadLetterJobs))}
        {cell(
          "Workers",
          t.workersHealthy === null ? "—" : t.workersHealthy ? "OK" : "KO",
        )}
      </div>
    </div>
  );
}

export function AgentOrchestrator({
  view,
  onSetLevel,
  onToggleEnabled,
  onToggleKillSwitch,
}: {
  view: OrchestratorView;
  role?: StaffRole;
  onSetLevel?: (id: string, level: AutonomyLevel) => void;
  onToggleEnabled?: (id: string, enabled: boolean) => void;
  onToggleKillSwitch?: (engaged: boolean) => void;
}) {
  if (!view.canView) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[13px] text-white/60">
        Orchestrateur réservé à la direction. Votre rôle n’a pas accès à cet écran.
        <span className="mt-1 block text-[11px] text-white/40">
          (La garde de rôle est un confort d’UI ; l’autorité d’exécution reste côté serveur — RLS, workers, RPC.)
        </span>
      </div>
    );
  }

  const postureTone = POSTURE_TONE[view.posture] ?? POSTURE_TONE.idle;

  return (
    <div className="space-y-4">
      {/* Posture globale + arrêt global */}
      <div className={`rounded-xl border px-4 py-3 ${postureTone}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] opacity-70">Posture globale</p>
            <p className="text-lg font-black">{postureLabel(view.posture)}</p>
          </div>
          <button
            type="button"
            disabled={!view.canManage}
            onClick={() => onToggleKillSwitch?.(!view.killSwitchEngaged)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-black uppercase tracking-wide transition disabled:opacity-40 ${
              view.killSwitchEngaged
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
                : "border-rose-400/50 bg-rose-500/15 text-rose-100"
            }`}
          >
            {view.killSwitchEngaged ? "Lever l’arrêt global" : "Arrêt global"}
          </button>
        </div>
        {view.killSwitchEngaged && (
          <p className="mt-2 text-[12px] opacity-90">
            Arrêt global engagé : le niveau effectif de <strong>tous</strong> les agents est forcé à 0,
            quel que soit leur réglage.
          </p>
        )}
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="Agents" value={String(view.totalAgents)} />
        <SummaryTile label="Actifs (effectif > 0)" value={String(view.activeAgents)} tone="text-emerald-200" />
        <SummaryTile
          label="Plafonnés (règle dure)"
          value={String(view.cappedAgents)}
          tone={view.cappedAgents > 0 ? "text-amber-200" : undefined}
        />
        <SummaryTile
          label="Étouffés (off / arrêt)"
          value={String(view.suppressedAgents)}
          tone={view.suppressedAgents > 0 ? "text-rose-200" : undefined}
        />
      </div>

      {/* Légende de l'échelle 0→4 */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[12px] font-bold text-white/70">Échelle d’autonomie (0→4)</p>
        <ul className="mt-2 space-y-1 text-[11px] text-white/60">
          {AUTONOMY_LEVELS.map((l) => (
            <li key={l} className="flex gap-2">
              <span className="shrink-0 font-bold text-white/80">
                N{l} · {autonomyLabel(l)}
              </span>
              <span className="text-white/45">— {autonomyDescription(l)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Registre d'agents */}
      {view.isEmpty ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[13px] text-white/60">
          Aucun agent enregistré. L’orchestrateur est un <strong>cadre de gouvernance</strong> prêt à
          recevoir des agents ; aucun agent n’est fabriqué tant qu’aucun n’est réellement déclaré.
        </div>
      ) : (
        <div className="space-y-2">
          {view.agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              canManage={view.canManage}
              onSetLevel={onSetLevel}
              onToggleEnabled={onToggleEnabled}
            />
          ))}
        </div>
      )}

      <TelemetryPanel view={view} />
    </div>
  );
}
