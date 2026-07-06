// lib/messaging/types.ts — types du module messagerie (infra F5). PROVIDER-NEUTRE, DRY_RUN.
// AUCUN fournisseur externe n'est référencé ici : ni Twilio, ni SendGrid, ni WhatsApp, ni FCM.
// Le « send » est un OUTBOX local qui ne fait que produire un SendResult déterministe.

export const CHANNELS = ["sms", "email", "whatsapp", "push"] as const;
export type Channel = (typeof CHANNELS)[number];

export const MESSAGE_STATUSES = [
  "queued",
  "sending",
  "sent",
  "failed",
  "skipped",
  "opted_out",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

// Un message dans la file (miroir applicatif de public.message_queue).
export type QueuedMessage = {
  id: string;
  channel: Channel;
  guest_id?: string | null;
  to_address?: string | null;
  template_key?: string | null;
  payload?: Record<string, unknown>;
  status: MessageStatus;
  dedup_key?: string | null;
  scheduled_at?: string | null; // ISO — null = dès que possible
  attempts: number;
  max_attempts: number;
  last_error?: string | null;
  created_at?: string | null;
  sent_at?: string | null;
};

// Résultat d'un « send » DRY_RUN : jamais un accusé réseau réel, un providerRef déterministe local.
export type SendResult = {
  status: Extract<MessageStatus, "sent" | "failed" | "skipped">;
  providerRef?: string | null; // ex. "DRYRUN:<hash déterministe>" — aucune signification côté opérateur réel
  error?: string | null;
};

// État de consentement d'un guest, tel que lu depuis public.guests (0013).
// La porte de consentement est appliquée AVANT tout envoi : opt-out ou marketing=false ⇒ pas d'envoi.
export type ConsentState = {
  guest_id?: string | null;
  consent_marketing?: boolean | null;
  opt_out_at?: string | null; // non-null = STOP définitif
};

// Contrat d'un adaptateur d'envoi. Le SEUL adaptateur fourni est dryRunAdapter (aucun réseau).
export interface MessageAdapter {
  readonly name: string;
  send(msg: QueuedMessage): SendResult;
}
