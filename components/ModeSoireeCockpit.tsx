"use client";

// components/ModeSoireeCockpit.tsx — cockpit « Mode Soirée » temps réel (A1).
//
// Composant PRÉSENTATIONNEL, LECTURE SEULE : aucun réseau, aucune mutation, aucun callback. On lui passe
// les données déjà chargées et filtrées par la RLS (incidents A6, messages A7, artistes A8, checklists
// A9) ; il les agrège via lib/modeSoiree.buildCockpit et affiche des tuiles + un fil d'alertes.
//
// Ce composant n'accorde AUCUN droit : chaque panneau n'apparaît que si buildCockpit l'a rempli (le
// cadrage de rôle est fait dans la lib, miroir des RLS). Le promoteur reçoit un cockpit fermé → message.
// États vides HONNÊTES partout : aucune donnée → des zéros et « Calme », jamais une alerte fabriquée.

import type { StaffRole } from "@/lib/permissions";
import type { Incident } from "@/lib/incidents";
import type { InternalMessage, MessageRead } from "@/lib/internalComms";
import type { ArtistCheckin } from "@/lib/artistCheckin";
import type { ChecklistLine } from "@/lib/checklists";
import {
  buildCockpit,
  levelLabel,
  severityLabel,
  sourceLabel,
  type CockpitAlert,
  type CockpitLevel,
} from "@/lib/modeSoiree";

const LEVEL_STYLE: Record<CockpitLevel, string> = {
  calme: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  vigilance: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  tension: "border-red-500/40 bg-red-500/10 text-red-200",
};

const SEVERITY_DOT: Record<CockpitAlert["severity"], string> = {
  info: "bg-white/40",
  attention: "bg-amber-400",
  critique: "bg-red-500",
};

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-white/50">{hint}</p>}
    </div>
  );
}

export default function ModeSoireeCockpit({
  role,
  username,
  incidents = [],
  messages = [],
  reads = [],
  checkins = [],
  checklistLines = [],
}: {
  role: StaffRole;
  username: string;
  incidents?: readonly Incident[];
  messages?: readonly InternalMessage[];
  reads?: readonly MessageRead[];
  checkins?: readonly ArtistCheckin[];
  checklistLines?: readonly ChecklistLine[];
}) {
  const cockpit = buildCockpit({ role, username, incidents, messages, reads, checkins, checklistLines });

  if (!cockpit.accessible) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Le cockpit Mode Soirée n’est pas accessible à ce rôle.
      </p>
    );
  }

  const { panels } = cockpit;

  return (
    <div className="space-y-5">
      {/* Niveau global + tâches immédiates */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full border px-3 py-1 text-sm font-medium ${LEVEL_STYLE[cockpit.level]}`}
        >
          {levelLabel(cockpit.level)}
        </span>
        <span className="text-sm text-white/60">
          {cockpit.tachesOuvertes} tâche{cockpit.tachesOuvertes > 1 ? "s" : ""} immédiate
          {cockpit.tachesOuvertes > 1 ? "s" : ""}
        </span>
      </div>

      {/* Fil d'alertes (vide honnête → rien à signaler) */}
      {cockpit.alerts.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          {cockpit.isEmpty
            ? "Aucune donnée de soirée pour le moment."
            : "Rien à signaler pour le moment."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {cockpit.alerts.map((a) => (
            <li
              key={`${a.source}:${a.code}`}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[a.severity]}`} />
              <span className="text-sm text-white">{a.label}</span>
              <span className="ml-auto text-xs text-white/40">
                {sourceLabel(a.source)} · {severityLabel(a.severity)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Tuiles par module (seuls les panneaux accessibles au rôle sont rendus) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {panels.incidents && (
          <Tile
            label="Incidents"
            value={panels.incidents.actifs}
            hint={`${panels.incidents.total} au total · ${panels.incidents.escalades} escaladé${panels.incidents.escalades > 1 ? "s" : ""}`}
          />
        )}
        {panels.comms && (
          <Tile
            label="Comm interne"
            value={panels.comms.nonLus}
            hint={`${panels.comms.urgencesOuvertes} urgence${panels.comms.urgencesOuvertes > 1 ? "s" : ""} · ${panels.comms.tachesOuvertes} tâche${panels.comms.tachesOuvertes > 1 ? "s" : ""}`}
          />
        )}
        {panels.artists && (
          <Tile
            label="Artistes"
            value={`${panels.artists.arrives}/${panels.artists.total}`}
            hint={`${panels.artists.attendus} attendu${panels.artists.attendus > 1 ? "s" : ""} · ${panels.artists.prets} prêt${panels.artists.prets > 1 ? "s" : ""}`}
          />
        )}
        {panels.checklist && (
          <Tile
            label="Checklists"
            value={`${panels.checklist.summary.done}/${panels.checklist.summary.total}`}
            hint={
              panels.checklist.summary.complete
                ? "Tout est fait ✓"
                : `${panels.checklist.summary.remaining} à cocher`
            }
          />
        )}
      </div>
    </div>
  );
}
