// tests/messaging.test.mts — logique pure de la file messagerie (lib/messaging) + invariant DRY_RUN.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consentGate,
  findByDedupKey,
  countInWindow,
  enqueue,
  processQueue,
  type QueuedMessage,
  type EnqueueContext,
} from "../lib/messaging/index.ts";
import {
  dryRunAdapter,
  outbox,
  resetOutbox,
} from "../lib/messaging/adapters/dryRunAdapter.ts";
import type { MessageAdapter } from "../lib/messaging/types.ts";

const T0 = Date.parse("2026-07-07T20:00:00.000Z");

function draft(id: string, over: Partial<Parameters<typeof enqueue>[0]> = {}) {
  return {
    id,
    channel: "sms" as const,
    guest_id: "g1",
    to_address: "+33600000000",
    template_key: "invite",
    payload: { first_name: "Alex" },
    ...over,
  };
}

test("consentGate : opt-out ⇒ opted_out ; marketing=false ⇒ skipped ; consentement ⇒ allowed", () => {
  assert.deepEqual(consentGate({ opt_out_at: "2026-01-01T00:00:00Z", consent_marketing: true }), {
    allowed: false,
    status: "opted_out",
    reason: "guest opted out (STOP)",
  });
  const s = consentGate({ consent_marketing: false });
  assert.equal(s.allowed, false);
  assert.equal((s as { status: string }).status, "skipped");
  assert.equal(consentGate({ consent_marketing: true }).allowed, true);
  // Aucun consentement fourni (undefined) ⇒ autorisé (le gate ne bloque que sur donnée explicite).
  assert.equal(consentGate(undefined).allowed, true);
});

test("enqueue : message conforme ⇒ ligne 'queued' ajoutée", () => {
  const queue: QueuedMessage[] = [];
  const ctx: EnqueueContext = { queue, consent: { consent_marketing: true }, now: T0 };
  const r = enqueue(draft("m1", { dedup_key: "k1" }), ctx);
  assert.equal(r.outcome, "queued");
  assert.equal(r.appended, true);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, "queued");
  assert.equal(queue[0].attempts, 0);
  assert.equal(queue[0].max_attempts, 3);
});

test("enqueue : DÉDUP — une dedup_key déjà présente ne crée pas de doublon", () => {
  const queue: QueuedMessage[] = [];
  const ctx: EnqueueContext = { queue, consent: { consent_marketing: true }, now: T0 };
  enqueue(draft("m1", { dedup_key: "same" }), ctx);
  const r2 = enqueue(draft("m2", { dedup_key: "same" }), ctx);
  assert.equal(r2.outcome, "deduped");
  assert.equal(r2.appended, false);
  assert.equal(queue.length, 1, "la file ne contient qu'une ligne pour la dedup_key");
  assert.equal(r2.message.id, "m1", "renvoie la ligne existante");
});

test("enqueue : CONSENTEMENT — opt-out ⇒ statut 'opted_out', jamais 'queued'", () => {
  const queue: QueuedMessage[] = [];
  const r = enqueue(draft("m1"), {
    queue,
    consent: { opt_out_at: "2026-01-01T00:00:00Z", consent_marketing: true },
    now: T0,
  });
  assert.equal(r.outcome, "opted_out");
  assert.equal(queue[0].status, "opted_out");
});

test("enqueue : CONSENTEMENT — marketing=false ⇒ statut 'skipped'", () => {
  const queue: QueuedMessage[] = [];
  const r = enqueue(draft("m1"), { queue, consent: { consent_marketing: false }, now: T0 });
  assert.equal(r.outcome, "skipped");
  assert.equal(queue[0].status, "skipped");
});

test("countInWindow + enqueue : CAP DE FRÉQUENCE par guest sur la fenêtre", () => {
  const queue: QueuedMessage[] = [];
  const consent = { consent_marketing: true };
  const cap = { windowMs: 24 * 60 * 60 * 1000, maxInWindow: 2 };
  const base: EnqueueContext = { queue, consent, now: T0, frequencyCap: cap };

  enqueue(draft("m1", { dedup_key: "a" }), base);
  enqueue(draft("m2", { dedup_key: "b" }), base);
  assert.equal(countInWindow(queue, "g1", T0, cap), 2);

  const r3 = enqueue(draft("m3", { dedup_key: "c" }), base);
  assert.equal(r3.outcome, "skipped", "au-delà du plafond ⇒ skipped");
  assert.equal(r3.message.status, "skipped");
  // Un autre guest n'est pas impacté.
  const r4 = enqueue(draft("m4", { guest_id: "g2", dedup_key: "d" }), base);
  assert.equal(r4.outcome, "queued");
});

test("countInWindow : ne compte que la fenêtre glissante (message trop ancien exclu)", () => {
  const cap = { windowMs: 60 * 60 * 1000, maxInWindow: 5 }; // 1h
  const queue: QueuedMessage[] = [
    {
      id: "old",
      channel: "sms",
      guest_id: "g1",
      status: "sent",
      attempts: 1,
      max_attempts: 3,
      created_at: new Date(T0 - 2 * 60 * 60 * 1000).toISOString(), // il y a 2h
    },
  ];
  assert.equal(countInWindow(queue, "g1", T0, cap), 0);
});

test("processQueue (DRY_RUN par défaut) : lignes 'queued' ⇒ 'sent', outbox alimenté", () => {
  resetOutbox();
  const queue: QueuedMessage[] = [];
  const ctx: EnqueueContext = { queue, consent: { consent_marketing: true }, now: T0 };
  enqueue(draft("m1", { dedup_key: "a" }), ctx);
  enqueue(draft("m2", { guest_id: "g2", dedup_key: "b" }), ctx);
  // une ligne bloquée par consentement ne doit PAS être envoyée
  enqueue(draft("m3", { guest_id: "g3", dedup_key: "c" }), {
    queue,
    consent: { consent_marketing: false },
    now: T0,
  });

  const summary = processQueue(queue, { now: T0 });
  assert.equal(summary.processed, 2, "seules les 2 lignes 'queued' sont traitées");
  assert.equal(summary.sent, 2);
  assert.equal(queue.filter((m) => m.status === "sent").length, 2);
  assert.equal(queue.find((m) => m.id === "m3")!.status, "skipped");
  assert.equal(outbox.length, 2);
  for (const e of outbox) assert.match(e.providerRef, /^DRYRUN:[0-9a-f]{8}$/);
});

test("processQueue : respecte scheduled_at (message futur non envoyé)", () => {
  resetOutbox();
  const queue: QueuedMessage[] = [];
  enqueue(draft("m1", { dedup_key: "a", scheduled_at: new Date(T0 + 3600_000).toISOString() }), {
    queue,
    consent: { consent_marketing: true },
    now: T0,
  });
  const summary = processQueue(queue, { now: T0 });
  assert.equal(summary.processed, 0, "planifié dans le futur ⇒ pas encore traité");
  assert.equal(queue[0].status, "queued");
});

test("processQueue : adaptateur en échec ⇒ retry puis 'failed' terminal", () => {
  const failing: MessageAdapter = {
    name: "always-fail",
    send: () => ({ status: "failed", error: "boom" }),
  };
  const queue: QueuedMessage[] = [];
  enqueue(draft("m1", { dedup_key: "a", max_attempts: 2 }), {
    queue,
    consent: { consent_marketing: true },
    now: T0,
  });

  const s1 = processQueue(queue, { now: T0, adapter: failing });
  assert.equal(s1.retried, 1);
  assert.equal(queue[0].status, "queued", "1er échec non terminal ⇒ reste queued");
  assert.equal(queue[0].attempts, 1);

  const s2 = processQueue(queue, { now: T0, adapter: failing });
  assert.equal(s2.failed, 1);
  assert.equal(queue[0].status, "failed", "attempts atteint max_attempts ⇒ terminal");
  assert.equal(queue[0].attempts, 2);
});

test("INVARIANT DRY_RUN : dryRunAdapter.send ne fait AUCUN réseau et est déterministe", () => {
  resetOutbox();
  const msg: QueuedMessage = {
    id: "x1",
    channel: "email",
    guest_id: "g9",
    to_address: "a@b.c",
    template_key: "t",
    payload: { k: "v" },
    status: "queued",
    dedup_key: "dk",
    attempts: 0,
    max_attempts: 3,
  };
  const r1 = dryRunAdapter.send(msg);
  const r2 = dryRunAdapter.send(msg);
  assert.equal(r1.status, "sent");
  assert.equal(r1.providerRef, r2.providerRef, "même contenu ⇒ même providerRef (déterministe)");
  assert.match(r1.providerRef!, /^DRYRUN:/);
  assert.equal(outbox.length, 2, "chaque send est tracé dans l'outbox local (aucun réseau)");
});

test("INVARIANT DRY_RUN : la source de l'adaptateur n'importe aucun fournisseur ni réseau", async () => {
  // Preuve statique : le fichier adaptateur ne contient ni fetch/XHR/WebSocket ni import de fournisseur.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = fileURLToPath(new URL("../lib/messaging/adapters/dryRunAdapter.ts", import.meta.url));
  // On scanne le CODE, pas les commentaires (qui, eux, mentionnent ces motifs pour les interdire).
  const src = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const forbidden = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /WebSocket/,
    /require\(/,
    /from\s+["']twilio["']/i,
    /from\s+["']@sendgrid/i,
    /whatsapp/i,
    /firebase|fcm/i,
    /node:https?/,
  ];
  for (const rx of forbidden) {
    assert.equal(rx.test(src), false, `motif interdit détecté dans dryRunAdapter: ${rx}`);
  }
});
