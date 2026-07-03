"use client";

// components/InternalCommFeed.tsx — fil de lecture du module COMMUNICATION INTERNE (A7).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe les messages/accusés déjà
// chargés (que la RLS 0026 a déjà filtrés au périmètre du rôle), plus le rôle et l'identifiant de
// l'utilisateur, et deux callbacks : `onAck(messageId)` (accusé de lecture) et `onResolve(messageId)`
// (marquer une tâche/urgence traitée). Les écritures réelles sont faites par le parent sous RLS —
// ce composant n'accorde AUCUN droit, il reflète et prépare.
//
// États vides HONNÊTES : un fil vide affiche un message clair, jamais une ligne fabriquée. Toute la
// logique (visibilité, tri, résumé, accusés) est dans lib/internalComms.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  canResolveMessage,
  expectsAck,
  hasRead,
  messageKindLabel,
  readersOf,
  sortForFeed,
  summarizeFeed,
  targetLabel,
  visibleMessages,
  type InternalMessage,
  type MessageRead,
} from "@/lib/internalComms";

function MessageCard({
  message,
  reads,
  role,
  username,
  onAck,
  onResolve,
}: {
  message: InternalMessage;
  reads: readonly MessageRead[];
  role: StaffRole;
  username: string;
  onAck: (messageId: string) => Promise<void>;
  onResolve: (messageId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const read = hasRead(message, reads, username);
  const readers = readersOf(message.id, reads);
  const showAck = expectsAck(message.kind) && !read;
  const showResolve =
    (message.kind === "tache" || message.kind === "urgence") &&
    message.resolved_at === null &&
    canResolveMessage(role, message, username);
  const pinned = (message.kind === "urgence" || message.kind === "alerte") && message.resolved_at === null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        "rounded-2xl border p-3 " +
        (pinned ? "border-rose-400/40 bg-rose-500/[0.06]" : "border-white/10 bg-white/[0.03]")
      }
    >
      <div className="flex items-center justify-between gap-2 text-xs text-white/60">
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/80">
            {messageKindLabel(message.kind)}
          </span>
          <span>→ {targetLabel(message.target_role)}</span>
          {message.assignee_username && <span>· @{message.assignee_username}</span>}
        </span>
        <span>{message.auteur_username}</span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-white">{message.body}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/50">
        {message.resolved_at !== null && <span className="text-emerald-300">Traité</span>}
        {readers.length > 0 && <span>Lu par {readers.length}</span>}
        {showAck && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onAck(message.id))}
            className="rounded-lg bg-white/10 px-2 py-0.5 text-white disabled:opacity-40"
          >
            Accuser réception
          </button>
        )}
        {showResolve && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onResolve(message.id))}
            className="rounded-lg bg-emerald-500/20 px-2 py-0.5 text-emerald-200 disabled:opacity-40"
          >
            Marquer traité
          </button>
        )}
      </div>
    </div>
  );
}

export default function InternalCommFeed({
  messages,
  reads,
  role,
  username,
  onAck,
  onResolve,
}: {
  messages: readonly InternalMessage[];
  reads: readonly MessageRead[];
  role: StaffRole;
  username: string;
  onAck: (messageId: string) => Promise<void>;
  onResolve: (messageId: string) => Promise<void>;
}) {
  const visible = sortForFeed(visibleMessages(messages, role, username));
  const summary = summarizeFeed(messages, reads, role, username);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-white/60">
        <span>{summary.total} message(s)</span>
        {summary.nonLus > 0 && <span className="text-amber-300">{summary.nonLus} non lu(s)</span>}
        {summary.urgencesOuvertes > 0 && (
          <span className="text-rose-300">{summary.urgencesOuvertes} urgence(s) ouverte(s)</span>
        )}
        {summary.tachesOuvertes > 0 && <span>{summary.tachesOuvertes} tâche(s) ouverte(s)</span>}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Aucun message pour cette soirée.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((m) => (
            <MessageCard
              key={m.id}
              message={m}
              reads={reads}
              role={role}
              username={username}
              onAck={onAck}
              onResolve={onResolve}
            />
          ))}
        </div>
      )}
    </div>
  );
}
