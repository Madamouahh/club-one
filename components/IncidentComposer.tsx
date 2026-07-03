"use client";

// components/IncidentComposer.tsx — signalement d'un incident (A6).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe le rôle + la date de soirée (résolue
// par le parent, jamais saisie ici) et un callback `onReport(draft)`. L'INSERT réel (table incidents, sous
// RLS 0023) est fait par le parent — ce composant n'accorde AUCUN droit : le droit de SIGNALER est porté
// par la RLS ; l'UI ne fait que refléter la même règle (formulaire masqué si canReportIncident faux +
// revalidation lib avant envoi).
//
// Aucune donnée inventée : tous les champs démarrent vides ; rien n'est pré-rempli. Toute la logique de
// validation/permission est dans lib/incidents.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  INCIDENT_LEVELS,
  INCIDENT_TYPES,
  canReportIncident,
  incidentLevelLabel,
  incidentTypeLabel,
  validateIncidentDraft,
  type IncidentDraft,
  type IncidentLevel,
  type IncidentType,
} from "@/lib/incidents";

type PostState = { tone: "ok" | "err"; message: string } | null;

export default function IncidentComposer({
  role,
  exploitationDate,
  eventId = null,
  onReport,
}: {
  role: StaffRole;
  exploitationDate: string; // AAAA-MM-JJ (résolu par le parent, jamais saisi ici)
  eventId?: string | null;
  onReport: (draft: IncidentDraft) => Promise<void>;
}) {
  const [type, setType] = useState<IncidentType>("autre");
  const [niveau, setNiveau] = useState<IncidentLevel>("mineur");
  const [lieu, setLieu] = useState("");
  const [personne, setPersonne] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<PostState>(null);

  // Le droit de signaler est porté par la RLS ; ce garde n'est qu'un miroir UI. Promoteur/artiste : rien.
  if (!canReportIncident(role)) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Ce rôle ne peut pas signaler d’incident (matrice A6).
      </p>
    );
  }

  const draft: IncidentDraft = {
    exploitation_date: exploitationDate,
    type,
    niveau,
    lieu: lieu.trim() === "" ? null : lieu.trim(),
    personne_concernee: personne.trim() === "" ? null : personne.trim(),
    description,
    event_id: eventId,
  };
  const validation = validateIncidentDraft(draft);
  const canSend = !sending && validation.ok;

  async function handleReport() {
    if (!canSend) return;
    setSending(true);
    setState(null);
    try {
      await onReport(draft);
      setState({ tone: "ok", message: "Incident signalé." });
      setLieu("");
      setPersonne("");
      setDescription("");
      setType("autre");
      setNiveau("mineur");
    } catch (e) {
      setState({ tone: "err", message: e instanceof Error ? e.message : "Échec du signalement." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as IncidentType)}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
          >
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {incidentTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-white/60">
          Gravité
          <select
            value={niveau}
            onChange={(e) => setNiveau(e.target.value as IncidentLevel)}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
          >
            {INCIDENT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {incidentLevelLabel(l)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-white/60">
          Lieu (facultatif)
          <input
            type="text"
            value={lieu}
            onChange={(e) => setLieu(e.target.value)}
            placeholder="ex. entrée Eden"
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-white/60">
          Personne concernée (facultatif)
          <input
            type="text"
            value={personne}
            onChange={(e) => setPersonne(e.target.value)}
            placeholder="description non nominative"
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
          />
        </label>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Que s'est-il passé ?"
        aria-invalid={description.trim().length === 0}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
      />

      {!validation.ok && description.trim().length > 0 && (
        <p className="text-xs text-amber-300">{validation.errors[0]}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!canSend}
          onClick={handleReport}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "Signalement…" : "Signaler l'incident"}
        </button>
        {state && (
          <span className={state.tone === "ok" ? "text-xs text-emerald-300" : "text-xs text-rose-300"}>
            {state.message}
          </span>
        )}
      </div>
    </div>
  );
}
