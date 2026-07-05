"use client";

// app/_modules/ops/InternalCommsView.tsx — écran Communication interne (module 0026), mobile-first.
// Autonome : reçoit le client supabase partagé + le rôle. La RLS 0026 est la frontière dure (lecture
// filtrée par périmètre, insert contrôlé) ; le front reflète la même règle via lib/internalComms.ts
// (canPostKind, canViewMessage, canResolveMessage). Aucun message inventé : fil vide → zéros honnêtes.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  MESSAGE_KINDS,
  canAccessInternalComm,
  canPostKind,
  canResolveMessage,
  hasRead,
  isMessageKind,
  messageKindLabel,
  readersOf,
  sortForFeed,
  summarizeFeed,
  targetLabel,
  validateMessageDraft,
  visibleMessages,
  type InternalMessage,
  type MessageKind,
  type MessageRead,
} from "@/lib/internalComms";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

// Date de soirée = jour courant en Europe/Paris, déterministe (aucun décalage de fuseau silencieux).
function parisToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function InternalCommsView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canAccess = canAccessInternalComm(role);
  const soireeDate = useMemo(() => parisToday(), []);

  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [reads, setReads] = useState<MessageRead[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Nouveau message
  const [nKind, setNKind] = useState<string>("message");
  const [nBody, setNBody] = useState("");

  // Pas de setState SYNCHRONE dans l'effet : `load` sert aux rechargements après mutation ; le premier
  // setState survient APRÈS l'await (cf. StockView/MaintenanceView) → pas de cascade de rendus.
  const load = useCallback(async () => {
    const [ms, rd] = await Promise.all([
      supabase.from("internal_messages").select("*").eq("exploitation_date", soireeDate),
      supabase.from("internal_message_reads").select("*"),
    ]);
    if (ms.error) setError(ms.error.message);
    else setMessages((ms.data || []) as InternalMessage[]);
    if (!rd.error) setReads((rd.data || []) as MessageRead[]);
    setLoading(false);
  }, [supabase, soireeDate]);

  // Chargement initial : IIFE async avec garde de montage, setState POST-await uniquement.
  useEffect(() => {
    let active = true;
    (async () => {
      const [ms, rd] = await Promise.all([
        supabase.from("internal_messages").select("*").eq("exploitation_date", soireeDate),
        supabase.from("internal_message_reads").select("*"),
      ]);
      if (!active) return;
      if (ms.error) setError(ms.error.message);
      else setMessages((ms.data || []) as InternalMessage[]);
      if (!rd.error) setReads((rd.data || []) as MessageRead[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, soireeDate]);

  // Périmètre visible (défense en profondeur : la RLS a déjà filtré), trié pour le fil.
  const feed = useMemo(
    () => sortForFeed(visibleMessages(messages, role, username)),
    [messages, role, username],
  );
  const summary = useMemo(
    () => summarizeFeed(messages, reads, role, username),
    [messages, reads, role, username],
  );

  // Natures que CE rôle a le droit de poster (miroir du WITH CHECK 0026).
  const postableKinds = useMemo(
    () => MESSAGE_KINDS.filter((k) => canPostKind(role, k)),
    [role],
  );

  async function postMessage() {
    setError("");
    if (!isMessageKind(nKind)) {
      setError("Nature de message inconnue.");
      return;
    }
    const draft = {
      exploitation_date: soireeDate,
      kind: nKind,
      body: nBody,
      target_role: null,
      assignee_username: null,
      event_id: null,
    };
    const check = validateMessageDraft(draft, role);
    if (!check.ok) {
      setError(check.errors.join(" · "));
      return;
    }
    const { error: e } = await supabase.from("internal_messages").insert({
      exploitation_date: soireeDate,
      kind: nKind,
      body: nBody.trim(),
      target_role: null,
      assignee_username: null,
      event_id: null,
      auteur_username: username,
    });
    if (e) {
      setError(`Message refusé : ${e.message}`);
      return;
    }
    setNBody("");
    await load();
  }

  async function markRead(id: string) {
    setError("");
    const { error: e } = await supabase.from("internal_message_reads").insert({
      message_id: id,
      reader_username: username,
    });
    if (e) {
      setError(`Accusé de lecture refusé : ${e.message}`);
      return;
    }
    await load();
  }

  async function resolveMessage(id: string) {
    setError("");
    const { error: e } = await supabase
      .from("internal_messages")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (e) {
      setError(`Résolution refusée : ${e.message}`);
      return;
    }
    await load();
  }

  // Rôle sans accès au fil (promoteur / artiste) : cul-de-sac honnête, aucune donnée exposée.
  if (!canAccess) {
    return (
      <div className="space-y-3 pb-4 text-white">
        <div className={`${CARD} text-center text-sm text-white/60`}>
          Le fil de communication interne n’est pas accessible à votre rôle.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black">{summary.total}</div>
          <div className="text-[10px] uppercase text-white/50">Messages</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-red-400">{summary.urgencesOuvertes}</div>
          <div className="text-[10px] uppercase text-white/50">Urgences</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-amber-400">{summary.nonLus}</div>
          <div className="text-[10px] uppercase text-white/50">Non lus</div>
        </div>
      </div>
      <div className="text-center text-xs text-white/60">
        Soirée du <b className="text-white">{soireeDate}</b>
        {summary.tachesOuvertes > 0 ? (
          <>
            {" "}· <b className="text-white">{summary.tachesOuvertes}</b> tâche(s) ouverte(s)
          </>
        ) : null}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>
      )}

      {postableKinds.length > 0 && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Poster un message</div>
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2">
              <select className={INPUT} value={nKind} onChange={(e) => setNKind(e.target.value)}>
                {postableKinds.map((k) => (
                  <option key={k} value={k}>{messageKindLabel(k)}</option>
                ))}
              </select>
              <textarea
                className={INPUT}
                rows={2}
                placeholder="Message court (visible par le périmètre concerné)"
                value={nBody}
                onChange={(e) => setNBody(e.target.value)}
              />
            </div>
            <button className={BTN} onClick={postMessage} disabled={!nBody.trim()}>Envoyer</button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Fil de la soirée</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : feed.length === 0 ? (
          <div className="text-center text-sm text-white/40">Aucun message pour cette soirée. Rien n’a encore été posté.</div>
        ) : (
          <ul className="space-y-2">
            {feed.map((m) => {
              const pinnedOpen =
                (m.kind === "urgence" || m.kind === "alerte") && m.resolved_at === null;
              const readers = readersOf(m.id, reads);
              const iRead = hasRead(m, reads, username);
              const canResolve =
                (m.kind === "urgence" || m.kind === "tache") &&
                m.resolved_at === null &&
                canResolveMessage(role, m, username);
              return (
                <li
                  key={m.id}
                  className={`${CARD} ${pinnedOpen ? "border-red-500/40 bg-red-500/10" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-white/50">
                        <span className={m.kind === "urgence" ? "font-black text-red-400" : "font-bold"}>
                          {messageKindLabel(m.kind)}
                        </span>
                        {" · "}{m.auteur_username}
                        {" · "}{targetLabel(m.target_role)}
                        {m.resolved_at !== null ? " · résolu" : ""}
                      </div>
                      <div className="mt-1 break-words text-sm">{m.body}</div>
                    </div>
                    {canResolve && (
                      <button
                        className="shrink-0 rounded-lg border border-white/20 px-2 py-1 text-[11px]"
                        onClick={() => resolveMessage(m.id)}
                      >
                        Résoudre
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-[10px] text-white/40">
                      {readers.length > 0 ? `Lu par ${readers.length}` : "Pas encore lu"}
                    </div>
                    {iRead ? (
                      <div className="text-[10px] font-bold text-emerald-300">Vous avez lu ✓</div>
                    ) : (
                      <button
                        className="shrink-0 rounded-lg border border-white/20 px-2 py-1 text-[11px]"
                        onClick={() => markRead(m.id)}
                      >
                        Marquer lu
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
