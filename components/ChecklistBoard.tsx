"use client";

// components/ChecklistBoard.tsx — tableau des checklists ouverture/fermeture (A9).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe les items + les coches de la soirée
// (déjà filtrés par la RLS 0028), le rôle, et deux callbacks (`onToggle` pour cocher/décocher). Les
// écritures réelles sont faites par le parent sous RLS — ce composant n'accorde AUCUN droit : il ne
// montre le bouton « cocher » que si le rôle peut cocher CET item (matrice A9 « par poste »), et masque
// automatiquement les items hors périmètre pour les employés (via linesForPoste).
//
// États vides HONNÊTES : aucun item → un message clair, jamais une ligne fabriquée. Toute la logique
// (fusion, groupage, avancement) est dans lib/checklists.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  buildLines,
  canCompleteItem,
  categoryLabel,
  groupByPhase,
  linesForPoste,
  phaseLabel,
  progressByPhase,
  summarizeChecklist,
  type ChecklistCompletion,
  type ChecklistItem,
  type ChecklistLine,
} from "@/lib/checklists";

function LineRow({
  line,
  role,
  onToggle,
}: {
  line: ChecklistLine;
  role: StaffRole;
  onToggle: (itemId: string, done: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const canToggle = canCompleteItem(role, line.item);

  async function toggle() {
    setBusy(true);
    try {
      await onToggle(line.item.id, !line.done);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="min-w-0">
        <span className={line.done ? "text-sm text-white/50 line-through" : "text-sm text-white"}>
          {line.item.label}
        </span>
        {line.done && line.doneBy && (
          <span className="ml-2 text-xs text-emerald-300/80">✓ {line.doneBy}</span>
        )}
      </div>
      {canToggle ? (
        <button
          type="button"
          disabled={busy}
          onClick={toggle}
          className={
            line.done
              ? "shrink-0 rounded-lg bg-white/10 px-2 py-0.5 text-xs text-white/70 disabled:opacity-40"
              : "shrink-0 rounded-lg bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200 disabled:opacity-40"
          }
        >
          {line.done ? "Décocher" : "Cocher"}
        </button>
      ) : (
        <span className="shrink-0 text-xs text-white/30">{line.done ? "✓" : "○"}</span>
      )}
    </div>
  );
}

export default function ChecklistBoard({
  items,
  completions,
  exploitationDate,
  role,
  onToggle,
}: {
  items: readonly ChecklistItem[];
  completions: readonly ChecklistCompletion[];
  exploitationDate: string;
  role: StaffRole;
  onToggle: (itemId: string, done: boolean) => Promise<void>;
}) {
  const allLines = buildLines(items, completions, exploitationDate);
  // Employés : on ne montre que leurs items (sans-poste + leur poste). Direction : tout.
  const visible = linesForPoste(allLines, role);
  const phases = groupByPhase(visible);
  const summary = summarizeChecklist(visible);
  const progress = progressByPhase(visible);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
        <span>
          {summary.done}/{summary.total} fait{summary.total > 1 ? "s" : ""}
        </span>
        {progress
          .filter((p) => p.total > 0)
          .map((p) => (
            <span key={p.phase}>
              {phaseLabel(p.phase)} {p.done}/{p.total}
            </span>
          ))}
        {summary.complete && <span className="text-emerald-300">Tout est fait ✓</span>}
      </div>

      {phases.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Aucune checklist pour ce périmètre. Un manager peut composer les items d’ouverture et de fermeture.
        </p>
      ) : (
        phases.map((pg) => (
          <div key={pg.phase} className="space-y-3">
            <h3 className="text-sm font-medium text-white/80">{phaseLabel(pg.phase)}</h3>
            {pg.groups.map((cg) => (
              <div key={cg.category} className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-white/40">{categoryLabel(cg.category)}</p>
                {cg.lines.map((line) => (
                  <LineRow key={line.item.id} line={line} role={role} onToggle={onToggle} />
                ))}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
