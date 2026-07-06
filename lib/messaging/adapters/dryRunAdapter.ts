// lib/messaging/adapters/dryRunAdapter.ts — le SEUL adaptateur d'envoi. 100% LOCAL, DRY_RUN, déterministe.
//
// INVARIANT ABSOLU : aucun envoi réel. Aucun `import` de fournisseur (Twilio/SendGrid/WhatsApp/FCM),
// aucun `fetch`/`XMLHttpRequest`/`WebSocket`, aucune I/O réseau, aucune lecture de credentials.
// `send()` calcule un providerRef déterministe à partir du contenu du message et RENVOIE {status:'sent'}.
// Il pousse aussi une entrée dans `outbox` (tableau exporté) pour inspection/tests. Rien ne quitte le process.

import type { MessageAdapter, QueuedMessage, SendResult } from "../types.ts";

// Outbox local inspectable (le « réseau » du DRY_RUN est ce tableau en mémoire).
export type OutboxEntry = {
  id: string;
  channel: QueuedMessage["channel"];
  to_address?: string | null;
  template_key?: string | null;
  providerRef: string;
};

export const outbox: OutboxEntry[] = [];

// Hash déterministe (FNV-1a 32 bits) — pas de crypto, pas d'aléatoire, pas d'horloge.
// Deux messages au contenu identique produisent le même providerRef (reproductibilité des tests).
function deterministicRef(msg: QueuedMessage): string {
  const basis = [
    msg.id,
    msg.channel,
    msg.guest_id ?? "",
    msg.to_address ?? "",
    msg.template_key ?? "",
    msg.dedup_key ?? "",
    JSON.stringify(msg.payload ?? {}),
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 pour rester non signé, en hex zéro-padded (8 chars) → référence stable.
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const dryRunAdapter: MessageAdapter = {
  name: "dry-run",
  send(msg: QueuedMessage): SendResult {
    const providerRef = `DRYRUN:${deterministicRef(msg)}`;
    outbox.push({
      id: msg.id,
      channel: msg.channel,
      to_address: msg.to_address ?? null,
      template_key: msg.template_key ?? null,
      providerRef,
    });
    return { status: "sent", providerRef };
  },
};

// Utilitaire de test : vider l'outbox entre deux scénarios.
export function resetOutbox(): void {
  outbox.length = 0;
}
