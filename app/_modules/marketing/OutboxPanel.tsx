"use client";

// app/_modules/marketing/OutboxPanel.tsx — F5 : outbox local DRY_RUN sur message_queue.
// enqueue (dédup → consentement → fréquence) puis processQueue(dryRunAdapter). AUCUN envoi réel.
// L'unique adaptateur importé est dryRunAdapter (100% local). La persistance est déléguée au conteneur.

import { useEffect, useMemo, useState } from "react";
import {
  CHANNELS,
  consentGate,
  countInWindow,
  dryRunAdapter,
  enqueue,
  processQueue,
  type Channel,
  type EnqueueInput,
  type FrequencyCap,
  type QueuedMessage,
} from "@/lib/messaging";
import {
  consentStateOf,
  outboxSummary,
  statusLabel,
  statusTone,
  type GuestRecord,
} from "@/lib/marketingUi";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

// Cap de fréquence par défaut : au plus 3 messages retenus / guest / 24 h.
const DEFAULT_CAP: FrequencyCap = { windowMs: 24 * 60 * 60 * 1000, maxInWindow: 3 };

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `msg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

export default function OutboxPanel({
  messages,
  guests,
  canManage,
  onPersistEnqueue,
  onPersistProcessed,
}: {
  messages: QueuedMessage[];
  guests: GuestRecord[];
  canManage: boolean;
  onPersistEnqueue?: (msg: QueuedMessage) => Promise<void> | void;
  onPersistProcessed?: (msgs: QueuedMessage[]) => Promise<void> | void;
}) {
  // File de travail locale, initialisée depuis les lignes message_queue (props). Mutée en mémoire par enqueue/process.
  const [queue, setQueue] = useState<QueuedMessage[]>(messages);
  const [channel, setChannel] = useState<Channel>("sms");
  const [guestId, setGuestId] = useState<string>("");
  const [toAddress, setToAddress] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [dedupKey, setDedupKey] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  // Re-synchronise la file de travail quand la source (DB) change (nombre de lignes ou identité).
  useEffect(() => {
    setQueue(messages);
  }, [messages]);

  const selectedGuest = useMemo(
    () => guests.find((g) => g.id === guestId) ?? null,
    [guests, guestId],
  );

  const consent = selectedGuest ? consentStateOf(selectedGuest) : null;
  const gate = consentGate(consent);
  const seenInWindow = countInWindow(queue, guestId || null, undefined, DEFAULT_CAP);
  const summary = useMemo(() => outboxSummary(queue), [queue]);

  async function doEnqueue() {
    setBusy(true);
    setOutcome("");
    try {
      const input: EnqueueInput = {
        id: newId(),
        channel,
        guest_id: guestId || null,
        to_address: toAddress.trim() || null,
        template_key: templateKey.trim() || null,
        dedup_key: dedupKey.trim() || null,
        payload: {},
      };
      // enqueue MUTE la file : dédup → consentement → fréquence. Une ligne bloquée est tracée mais jamais 'queued'.
      const res = enqueue(input, {
        queue,
        consent,
        frequencyCap: DEFAULT_CAP,
      });
      setQueue([...queue]);
      setOutcome(`enqueue → ${res.outcome}${res.reason ? ` (${res.reason})` : ""}`);
      if (res.appended && onPersistEnqueue) {
        await onPersistEnqueue(res.message);
      }
      setDedupKey("");
    } catch (e) {
      setOutcome(`Échec enqueue : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function doProcess() {
    setBusy(true);
    setOutcome("");
    try {
      const before = new Map(queue.map((m) => [m.id, m.status]));
      // DRY_RUN explicite : adaptateur local, aucun réseau. processQueue MUTE les statuts en place.
      const sum = processQueue(queue, { adapter: dryRunAdapter });
      setQueue([...queue]);
      setOutcome(
        `processQueue (DRY_RUN) → traités ${sum.processed} · envoyés ${sum.sent} · échoués ${sum.failed} · relancés ${sum.retried}`,
      );
      const changed = queue.filter((m) => before.get(m.id) !== m.status);
      if (changed.length > 0 && onPersistProcessed) {
        await onPersistProcessed(changed);
      }
    } catch (e) {
      setOutcome(`Échec processQueue : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-bold uppercase tracking-wide text-white/50">
        Outbox · file d'envoi (F5)
      </div>

      {/* Bannière DRY_RUN — invariant absolu, aucune ambiguïté possible. */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-amber-200">
        DRY_RUN — aucun envoi réel · adaptateur « {dryRunAdapter.name} » (local)
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div className={CARD}>
          <div className="text-xl font-black text-sky-300">{summary.queued}</div>
          <div className="text-[9px] uppercase text-white/50">En file</div>
        </div>
        <div className={CARD}>
          <div className="text-xl font-black text-emerald-300">{summary.sent}</div>
          <div className="text-[9px] uppercase text-white/50">Envoyés*</div>
        </div>
        <div className={CARD}>
          <div className="text-xl font-black text-amber-400">{summary.skipped}</div>
          <div className="text-[9px] uppercase text-white/50">Ignorés</div>
        </div>
        <div className={CARD}>
          <div className="text-xl font-black text-fuchsia-300">{summary.opted_out}</div>
          <div className="text-[9px] uppercase text-white/50">Opt-out</div>
        </div>
      </div>

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Composer (DRY_RUN)</div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select className={INPUT} value={guestId} onChange={(e) => setGuestId(e.target.value)}>
                <option value="">— guest (hors répertoire) —</option>
                {guests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.display_name || g.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={INPUT}
                placeholder="Destinataire (num/email)"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
              />
              <input
                className={INPUT}
                placeholder="Clé de gabarit (opt.)"
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value)}
              />
            </div>
            <input
              className={INPUT}
              placeholder="dedup_key (idempotence, opt.)"
              value={dedupKey}
              onChange={(e) => setDedupKey(e.target.value)}
            />

            {/* Garde-fous VISIBLES avant tout enqueue. */}
            <div className="space-y-1 rounded-xl border border-white/10 bg-black/30 p-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-white/50">Consentement</span>
                <span className={gate.allowed ? "font-bold text-emerald-300" : "font-bold text-amber-400"}>
                  {gate.allowed
                    ? selectedGuest
                      ? "OK (opt-in)"
                      : "Hors répertoire (non filtré)"
                    : `Bloqué → ${gate.status} (${gate.reason})`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Dédup</span>
                <span className="text-white/70">
                  {dedupKey.trim()
                    ? queue.some((m) => m.dedup_key === dedupKey.trim())
                      ? "clé déjà présente → deduped"
                      : "clé libre"
                    : "aucune clé"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Fréquence (24 h)</span>
                <span className={seenInWindow >= DEFAULT_CAP.maxInWindow ? "font-bold text-amber-400" : "text-white/70"}>
                  {seenInWindow}/{DEFAULT_CAP.maxInWindow}
                  {seenInWindow >= DEFAULT_CAP.maxInWindow ? " → skipped" : ""}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button className={BTN} onClick={doEnqueue} disabled={busy}>
                Enqueue
              </button>
              <button
                className={`${BTN} bg-sky-700`}
                onClick={doProcess}
                disabled={busy || summary.queued === 0}
              >
                Traiter la file ({summary.queued})
              </button>
            </div>
          </div>
        </div>
      )}

      {outcome && (
        <div className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 font-mono text-xs text-white/70">
          {outcome}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">
          Journal d'envoi · message_queue ({queue.length})
        </div>
        {queue.length === 0 ? (
          <div className="text-center text-sm text-white/40">
            File vide. Aucun message n'a été composé.
          </div>
        ) : (
          <ul className="space-y-1">
            {queue.slice(0, 80).map((m) => (
              <li key={m.id} className={`${CARD} flex items-center justify-between gap-2 py-2`}>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold">
                    {m.channel} · {m.to_address || m.guest_id?.slice(0, 8) || "—"}
                  </div>
                  <div className="truncate text-[10px] text-white/40">
                    {m.template_key || "sans gabarit"}
                    {m.dedup_key ? ` · dedup:${m.dedup_key}` : ""}
                    {m.last_error ? ` · ${m.last_error}` : ""}
                  </div>
                </div>
                <div className={`shrink-0 text-right text-[11px] font-bold ${statusTone(m.status)}`}>
                  {statusLabel(m.status)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="text-center text-[10px] text-white/30">
        * « Envoyés » = statut simulé par l'adaptateur DRY_RUN, jamais une remise opérateur réelle.
      </div>
    </div>
  );
}
