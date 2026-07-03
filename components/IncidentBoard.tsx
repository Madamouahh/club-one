"use client";

// components/IncidentBoard.tsx — registre des incidents de soirée (A6).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe les incidents de la soirée (déjà
// filtrés par la RLS 0023), le rôle + l'identifiant de l'utilisateur, et un callback `onTransition` pour
// faire avancer un statut. Les écritures réelles sont faites par le parent sous RLS — ce composant
// n'accorde AUCUN droit :
//   · il RE-filtre la liste au périmètre visible du rôle (visibleIncidents, défense en profondeur : la
//     RLS a déjà filtré côté base ; direction/sécurité voient tout, les autres seulement leurs signalements) ;
//   · il ne montre les boutons de transition que si le rôle peut MUTER (canManageIncidents) ;
//   · si le rôle n'a AUCUN accès (canAccessIncidents faux → promoteur/artiste), il ne rend rien
//     d'exploitable (message clair).
//
// États vides HONNÊTES : aucun incident → un message clair + un résumé à zéro, jamais une ligne fabriquée.
// Toute la logique (visibilité, tri, transitions, agrégat) est dans lib/incidents.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  canManageIncidents,
  canAccessIncidents,
  incidentLevelLabel,
  incidentStatusLabel,
  incidentTypeLabel,
  isActiveStatus,
  nextStatuses,
  sortByPriority,
  summarizeIncidents,
  visibleIncidents,
  type Incident,
  type IncidentLevel,
  type IncidentStatus,
} from "@/lib/incidents";

function LevelBadge({ level }: { level: IncidentLevel }) {
  const tone =
    level === "critique"
      ? "bg-rose-500/25 text-rose-100"
      : level === "grave"
        ? "bg-orange-500/25 text-orange-100"
        : level === "moyen"
          ? "bg-amber-500/20 text-amber-100"
          : "bg-white/10 text-white/60";
  return <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold ${tone}`}>{incidentLevelLabel(level)}</span>;
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  const tone = isActiveStatus(status)
    ? status === "escalade"
      ? "bg-rose-500/20 text-rose-200"
      : "bg-sky-500/20 text-sky-200"
    : "bg-white/10 text-white/50";
  return <span className={`shrink-0 rounded-lg px-2 py-0.5 text-xs ${tone}`}>{incidentStatusLabel(status)}</span>;
}

function IncidentRow({
  incident,
  role,
  onTransition,
}: {
  incident: Incident;
  role: StaffRole;
  onTransition: (id: string, to: IncidentStatus) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const canManage = canManageIncidents(role);
  const transitions = canManage ? nextStatuses(incident.status) : [];

  async function transition(to: IncidentStatus) {
    setBusy(true);
    try {
      await onTransition(incident.id, to);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white">{incidentTypeLabel(incident.type)}</span>
            <LevelBadge level={incident.niveau} />
            <StatusBadge status={incident.status} />
            {incident.escalade && (
              <span className="shrink-0 rounded-lg bg-rose-500/15 px-2 py-0.5 text-xs text-rose-200">Escaladé ⚑</span>
            )}
          </div>
          <p className="mt-1 text-sm text-white/80">{incident.description}</p>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-white/40">
            {incident.lieu && <span>📍 {incident.lieu}</span>}
            {incident.personne_concernee && <span>👤 {incident.personne_concernee}</span>}
            <span>par {incident.auteur_username}</span>
            {incident.photo_refs.length > 0 && (
              <span>
                {incident.photo_refs.length} photo{incident.photo_refs.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {transitions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {transitions.map((to) => (
            <button
              key={to}
              type="button"
              disabled={busy}
              onClick={() => transition(to)}
              className="rounded-lg bg-white/[0.06] px-2 py-0.5 text-xs text-white/60 hover:text-white disabled:opacity-40"
            >
              → {incidentStatusLabel(to)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IncidentBoard({
  incidents,
  role,
  username,
  onTransition,
}: {
  incidents: readonly Incident[];
  role: StaffRole;
  username: string;
  onTransition: (id: string, to: IncidentStatus) => Promise<void>;
}) {
  // La visibilité du registre est RESTREINTE (donnée sensible) — la RLS 0023 est l'autorité ; ces gardes
  // ne sont qu'un miroir UI. Promoteur/artiste : aucun accès.
  if (!canAccessIncidents(role)) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Le registre des incidents n’est pas accessible à ce rôle (visibilité restreinte — matrice A6).
      </p>
    );
  }

  // Défense en profondeur : re-filtre au périmètre visible du rôle (direction/sécurité voient tout ; les
  // autres seulement leurs propres signalements), puis tri de priorité (actifs d'abord, gravité, récent).
  const visible = sortByPriority(visibleIncidents(incidents, role, username));
  const summary = summarizeIncidents(visible);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
        <span>{summary.total} incident{summary.total > 1 ? "s" : ""}</span>
        <span className={summary.actifs > 0 ? "text-sky-300" : ""}>{summary.actifs} actif{summary.actifs > 1 ? "s" : ""}</span>
        {summary.escalades > 0 && <span className="text-rose-300">{summary.escalades} escaladé{summary.escalades > 1 ? "s" : ""}</span>}
        <span>{summary.resolus} résolu{summary.resolus > 1 ? "s" : ""}</span>
        {summary.total === 0 && <span className="text-emerald-300">Aucun incident ✓</span>}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Aucun incident visible pour ce rôle. Un registre vide n’affiche que des zéros — jamais une ligne
          fabriquée.
        </p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((inc) => (
            <IncidentRow key={inc.id} incident={inc} role={role} onTransition={onTransition} />
          ))}
        </div>
      )}
    </div>
  );
}
