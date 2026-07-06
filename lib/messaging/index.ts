// lib/messaging/index.ts — logique de file d'attente messagerie (infra F5). 100% PURE / DÉTERMINISTE.
//
// PROVIDER-NEUTRE, DRY_RUN : le seul adaptateur par défaut est dryRunAdapter (aucun réseau, aucun fournisseur).
// La sélection du fournisseur est INJECTÉE (paramètre `adapter`). Aucun envoi réel ne peut avoir lieu ici.
//
// Trois garde-fous appliqués AVANT tout envoi :
//   1) DÉDUP  — une dedup_key déjà présente dans la file ne crée pas de doublon (idempotence).
//   2) CONSENTEMENT — opt_out_at renseigné ⇒ statut 'opted_out' ; consent_marketing=false ⇒ statut 'skipped'.
//   3) FRÉQUENCE — cap par guest sur une fenêtre glissante ⇒ statut 'skipped' au-delà du plafond.

import type {
  Channel,
  ConsentState,
  MessageAdapter,
  QueuedMessage,
} from "./types.ts";
import { dryRunAdapter } from "./adapters/dryRunAdapter.ts";

export * from "./types.ts";
export { dryRunAdapter, outbox, resetOutbox } from "./adapters/dryRunAdapter.ts";

// ---------- Horloge déterministe (injectable) ----------
type Clock = number | string | Date | undefined;

function toMs(now: Clock): number {
  if (now == null) return Date.now();
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  const p = Date.parse(now);
  return Number.isNaN(p) ? Date.now() : p;
}
function toISO(now: Clock): string {
  return new Date(toMs(now)).toISOString();
}

// ---------- Consentement ----------
export type ConsentDecision =
  | { allowed: true }
  | { allowed: false; status: "opted_out" | "skipped"; reason: string };

// opt-out = STOP définitif (prioritaire) ; sinon marketing doit être explicitement true.
export function consentGate(consent?: ConsentState | null): ConsentDecision {
  if (consent?.opt_out_at) {
    return { allowed: false, status: "opted_out", reason: "guest opted out (STOP)" };
  }
  if (consent && consent.consent_marketing !== true) {
    return { allowed: false, status: "skipped", reason: "no marketing consent" };
  }
  return { allowed: true };
}

// ---------- Dédup ----------
export function findByDedupKey(
  queue: QueuedMessage[],
  dedupKey?: string | null,
): QueuedMessage | undefined {
  if (!dedupKey) return undefined;
  return queue.find((m) => m.dedup_key === dedupKey);
}

// ---------- Fréquence ----------
export type FrequencyCap = { windowMs: number; maxInWindow: number };

// Compte les messages RETENUS (queued/sending/sent) pour un guest dans [now-window, now].
export function countInWindow(
  queue: QueuedMessage[],
  guestId: string | null | undefined,
  now: Clock,
  cap: FrequencyCap,
): number {
  if (!guestId) return 0;
  const nowMs = toMs(now);
  const from = nowMs - cap.windowMs;
  return queue.filter((m) => {
    if (m.guest_id !== guestId) return false;
    if (m.status !== "queued" && m.status !== "sending" && m.status !== "sent") return false;
    const t = m.created_at ? Date.parse(m.created_at) : nowMs;
    return t >= from && t <= nowMs;
  }).length;
}

// ---------- Enqueue ----------
export type EnqueueInput = {
  id: string;
  channel: Channel;
  guest_id?: string | null;
  to_address?: string | null;
  template_key?: string | null;
  payload?: Record<string, unknown>;
  dedup_key?: string | null;
  scheduled_at?: string | null;
  max_attempts?: number;
};

export type EnqueueContext = {
  queue: QueuedMessage[]; // file existante (dédup + fréquence). Mutée par append si une ligne est créée.
  consent?: ConsentState | null;
  now?: Clock;
  frequencyCap?: FrequencyCap;
};

export type EnqueueOutcome = "queued" | "deduped" | "opted_out" | "skipped";

export type EnqueueResult = {
  outcome: EnqueueOutcome;
  message: QueuedMessage;
  appended: boolean; // true si une NOUVELLE ligne a été ajoutée à la file
  reason?: string;
};

function buildMessage(
  input: EnqueueInput,
  status: QueuedMessage["status"],
  now: Clock,
): QueuedMessage {
  return {
    id: input.id,
    channel: input.channel,
    guest_id: input.guest_id ?? null,
    to_address: input.to_address ?? null,
    template_key: input.template_key ?? null,
    payload: input.payload ?? {},
    status,
    dedup_key: input.dedup_key ?? null,
    scheduled_at: input.scheduled_at ?? null,
    attempts: 0,
    max_attempts: input.max_attempts ?? 3,
    last_error: null,
    created_at: toISO(now),
    sent_at: null,
  };
}

// enqueue applique dédup → consentement → fréquence, dans cet ordre, puis crée la ligne adéquate.
// Une ligne « bloquée » (opted_out/skipped) est TOUT DE MÊME persistée (trace de la décision), mais
// elle n'est jamais 'queued' et ne sera donc jamais envoyée par processQueue.
export function enqueue(input: EnqueueInput, ctx: EnqueueContext): EnqueueResult {
  const { queue } = ctx;

  // 1) DÉDUP — pas de doublon.
  const dup = findByDedupKey(queue, input.dedup_key);
  if (dup) {
    return { outcome: "deduped", message: dup, appended: false, reason: "duplicate dedup_key" };
  }

  // 2) CONSENTEMENT.
  const gate = consentGate(ctx.consent);
  if (!gate.allowed) {
    const message = buildMessage(input, gate.status, ctx.now);
    message.last_error = gate.reason;
    queue.push(message);
    return { outcome: gate.status, message, appended: true, reason: gate.reason };
  }

  // 3) FRÉQUENCE.
  if (ctx.frequencyCap && input.guest_id) {
    const seen = countInWindow(queue, input.guest_id, ctx.now, ctx.frequencyCap);
    if (seen >= ctx.frequencyCap.maxInWindow) {
      const message = buildMessage(input, "skipped", ctx.now);
      message.last_error = "frequency cap reached";
      queue.push(message);
      return { outcome: "skipped", message, appended: true, reason: "frequency cap reached" };
    }
  }

  // OK → ligne 'queued'.
  const message = buildMessage(input, "queued", ctx.now);
  queue.push(message);
  return { outcome: "queued", message, appended: true };
}

// ---------- Traitement de la file (DRY_RUN par défaut) ----------
export type ProcessOptions = {
  now?: Clock;
  adapter?: MessageAdapter; // injection ; défaut = dryRunAdapter (aucun réseau)
};

export type ProcessSummary = {
  processed: number;
  sent: number;
  failed: number;
  retried: number; // échecs non terminaux (attempts < max_attempts) laissés 'queued'
};

// processQueue parcourt les lignes 'queued' éligibles (scheduled_at null ou échu) et applique l'adaptateur.
// Il MUTE le statut des lignes en place. Avec dryRunAdapter, chaque ligne éligible passe à 'sent' (jamais un réseau).
export function processQueue(
  queue: QueuedMessage[],
  opts: ProcessOptions = {},
): ProcessSummary {
  const adapter = opts.adapter ?? dryRunAdapter;
  const nowMs = toMs(opts.now);
  const nowISO = toISO(opts.now);
  const summary: ProcessSummary = { processed: 0, sent: 0, failed: 0, retried: 0 };

  for (const msg of queue) {
    if (msg.status !== "queued") continue;
    if (msg.scheduled_at && Date.parse(msg.scheduled_at) > nowMs) continue; // pas encore échu

    summary.processed++;
    msg.status = "sending";
    msg.attempts += 1;

    const res = adapter.send(msg);

    if (res.status === "sent") {
      msg.status = "sent";
      msg.sent_at = nowISO;
      msg.last_error = null;
      summary.sent++;
    } else if (res.status === "skipped") {
      msg.status = "skipped";
      msg.last_error = res.error ?? "skipped by adapter";
      summary.failed++;
    } else {
      // 'failed' : retente tant que attempts < max_attempts, sinon terminal 'failed'.
      msg.last_error = res.error ?? "send failed";
      if (msg.attempts >= msg.max_attempts) {
        msg.status = "failed";
        summary.failed++;
      } else {
        msg.status = "queued"; // reste dans la file pour un prochain passage
        summary.retried++;
      }
    }
  }

  return summary;
}
