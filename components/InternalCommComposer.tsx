"use client";

// components/InternalCommComposer.tsx — composer du module COMMUNICATION INTERNE (A7).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe le rôle de l'utilisateur et un
// callback `onPost(draft)`. L'INSERT réel (internal_messages, sous RLS 0026) est fait par le parent —
// ce composant n'accorde AUCUN droit : la nature « annonce » est réservée à la direction PAR LA RLS,
// l'UI ne fait que refléter cette règle (option masquée + revalidation lib avant envoi).
//
// Aucune donnée inventée : le champ démarre vide ; rien n'est pré-rempli. Toute la logique de
// validation/permission est dans lib/internalComms.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  COMM_ROLES,
  MESSAGE_KINDS,
  canPostKind,
  messageKindLabel,
  targetLabel,
  validateMessageDraft,
  type MessageDraft,
  type MessageKind,
} from "@/lib/internalComms";

type PostState = { tone: "ok" | "err"; message: string } | null;

export default function InternalCommComposer({
  role,
  exploitationDate,
  eventId = null,
  onPost,
}: {
  role: StaffRole;
  exploitationDate: string; // AAAA-MM-JJ (résolu par le parent, jamais saisi ici)
  eventId?: string | null;
  onPost: (draft: MessageDraft) => Promise<void>;
}) {
  const [kind, setKind] = useState<MessageKind>("message");
  const [body, setBody] = useState("");
  const [targetRole, setTargetRole] = useState<StaffRole | "">("");
  const [assignee, setAssignee] = useState("");
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<PostState>(null);

  // Natures que CE rôle a le droit de poster (miroir RLS ; l'annonce disparaît pour un non-direction).
  const allowedKinds = MESSAGE_KINDS.filter((k) => canPostKind(role, k));

  const draft: MessageDraft = {
    exploitation_date: exploitationDate,
    kind,
    body,
    target_role: targetRole === "" ? null : targetRole,
    assignee_username: assignee.trim() === "" ? null : assignee.trim(),
    event_id: eventId,
  };
  const validation = validateMessageDraft(draft, role);
  const canSend = !sending && validation.ok;

  async function handlePost() {
    if (!canSend) return;
    setSending(true);
    setState(null);
    try {
      await onPost(draft);
      setState({ tone: "ok", message: "Message publié." });
      setBody("");
      setAssignee("");
    } catch (e) {
      setState({ tone: "err", message: e instanceof Error ? e.message : "Échec de la publication." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Nature
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MessageKind)}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
          >
            {allowedKinds.map((k) => (
              <option key={k} value={k}>
                {messageKindLabel(k)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-white/60">
          Destinataire
          <select
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value as StaffRole | "")}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
          >
            <option value="">{targetLabel(null)}</option>
            {COMM_ROLES.map((r) => (
              <option key={r} value={r}>
                {targetLabel(r)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-white/60">
          Assigné à (facultatif)
          <input
            type="text"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="identifiant staff"
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
          />
        </label>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Message court…"
        aria-invalid={body.trim().length === 0}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
      />

      {!validation.ok && body.trim().length > 0 && (
        <p className="text-xs text-amber-300">{validation.errors[0]}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!canSend}
          onClick={handlePost}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "Publication…" : "Publier"}
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
