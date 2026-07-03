// lib/internalComms.ts — logique PURE du module Communication interne (A7), aucun accès réseau.
//
// Le journal de communication de soirée (migration 0026) : messages courts, annonces manager,
// alertes, bouton urgence interne, tâches, avec accusés de lecture. Ce module :
//   · décrit le modèle (miroir des tables internal_messages / internal_message_reads) ;
//   · valide un brouillon de message AVANT insert (vocabulaire fermé, corps requis, droit d'annonce) ;
//   · porte les gardes de rôle de la matrice A7 (source de vérité UI ; la RLS 0026 reste l'autorité) ;
//   · calcule les accusés de lecture / le non-lu et agrège un résumé de fil (états vides HONNÊTES :
//     un fil vide → des zéros, jamais un message fabriqué).
// L'accès Supabase reste dans app/page.tsx (comme incidents / caisse_z) ; ce module ne fait que
// valider, filtrer et agréger. Rien n'est inventé : aucun message n'est fabriqué ici.

import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Modèle (miroir des tables 0026)
// ————————————————————————————————————————————————————————————————

// Natures de message (vocabulaire fermé — une structure métier, pas une donnée fondateur).
export const MESSAGE_KINDS = [
  "message", // message court
  "annonce", // annonce manager (admin/manager uniquement)
  "alerte", // alerte opérationnelle
  "urgence", // bouton urgence interne
  "tache", // tâche (attend un accusé de lecture)
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

// Rôles disposant d'un accès au fil interne (matrice A7). Promoteur/artiste = aucun accès.
export const COMM_ROLES = [
  "admin",
  "manager",
  "server",
  "security",
  "security_counter",
] as const satisfies readonly StaffRole[];

// Nature qui « épingle » le fil tant qu'elle n'est pas résolue (remontée en tête).
const PINNED_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>(["urgence", "alerte"]);

// Nature qui attend un accusé de lecture pour être « traitée ».
const ACK_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>(["tache", "urgence", "annonce"]);

export type InternalMessage = {
  id: string;
  event_id: string | null;
  exploitation_date: string;
  kind: MessageKind;
  body: string;
  target_role: StaffRole | null; // null = diffusion générale
  assignee_username: string | null; // null = pas d'assignation nominative
  auteur_username: string;
  resolved_at: string | null; // null = ouvert
  created_at: string;
  updated_at: string;
};

export type MessageRead = {
  id: string;
  message_id: string;
  reader_username: string;
  created_at: string;
};

// Brouillon saisi côté client (sans les champs fixés serveur : id/auteur/timestamps).
export type MessageDraft = {
  exploitation_date: string;
  kind: string;
  body: string;
  target_role?: StaffRole | null;
  assignee_username?: string | null;
  event_id?: string | null;
};

// ————————————————————————————————————————————————————————————————
// Gardes de type (vocabulaires fermés)
// ————————————————————————————————————————————————————————————————

export function isMessageKind(value: string): value is MessageKind {
  return (MESSAGE_KINDS as readonly string[]).includes(value);
}

export function isCommRole(role: StaffRole): boolean {
  return (COMM_ROLES as readonly string[]).includes(role);
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — matrice A7 (CLUB_ONE_OS_MASTER §4.2)
//   Direction/Patronat ✅ · Manager ✅➕ · Serveur 👁➕ · Sécurité 👁➕ · Compteur 👁➕ ·
//   Promoteur ⛔ · Artiste ⛔
// La RLS 0026 reste l'AUTORITÉ ; ces helpers ne font que refléter la même règle côté UI.
// ————————————————————————————————————————————————————————————————

// A accès au fil interne (lecture + au moins poster un message court).
export function canAccessInternalComm(role: StaffRole): boolean {
  return isCommRole(role);
}

// Peut poster une ANNONCE (annonce manager) : direction uniquement.
export function canPostAnnouncement(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// Lit TOUT le fil (supervision) : direction. Les autres ne voient que leur périmètre.
export function canViewAllMessages(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// Peut poster une nature donnée. L'annonce est réservée à la direction ; le reste, à tout rôle
// avec accès. Miroir exact du WITH CHECK de internal_messages_insert.
export function canPostKind(role: StaffRole, kind: MessageKind): boolean {
  if (!canAccessInternalComm(role)) return false;
  if (kind === "annonce") return canPostAnnouncement(role);
  return true;
}

// Peut marquer une tâche/urgence résolue : direction OU l'auteur du message.
export function canResolveMessage(
  role: StaffRole,
  message: Pick<InternalMessage, "auteur_username">,
  username: string,
): boolean {
  return canViewAllMessages(role) || message.auteur_username === username;
}

// Visibilité d'UN message, miroir exact du prédicat RLS internal_messages_read : direction voit
// tout ; les autres voient le broadcast, ce qui cible leur rôle/eux nommément, et leurs messages.
export function canViewMessage(
  role: StaffRole,
  message: Pick<InternalMessage, "target_role" | "assignee_username" | "auteur_username">,
  username: string,
): boolean {
  if (canViewAllMessages(role)) return true;
  if (!isCommRole(role)) return false;
  if (message.target_role === null && message.assignee_username === null) return true; // broadcast
  if (message.target_role === role) return true;
  if (message.assignee_username === username) return true;
  if (message.auteur_username === username) return true;
  return false;
}

// Restreint une liste déjà chargée au périmètre visible du rôle (défense en profondeur côté client ;
// la RLS a déjà filtré côté base). PURE : ne fabrique jamais de ligne.
export function visibleMessages(
  messages: readonly InternalMessage[],
  role: StaffRole,
  username: string,
): InternalMessage[] {
  return messages.filter((m) => canViewMessage(role, m, username));
}

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon (avant insert)
// ————————————————————————————————————————————————————————————————

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DraftValidation = { ok: boolean; errors: string[] };

// Le rôle est requis pour vérifier le droit d'annonce (miroir du WITH CHECK).
export function validateMessageDraft(draft: MessageDraft, role: StaffRole): DraftValidation {
  const errors: string[] = [];
  if (!ISO_DATE.test(draft.exploitation_date)) {
    errors.push("date de soirée invalide (attendu AAAA-MM-JJ)");
  }
  if (!isMessageKind(draft.kind)) {
    errors.push("nature de message inconnue");
  }
  if (draft.body.trim().length === 0) {
    errors.push("message vide");
  }
  if (
    draft.target_role !== null &&
    draft.target_role !== undefined &&
    !(COMM_ROLES as readonly string[]).includes(draft.target_role)
  ) {
    errors.push("rôle cible invalide");
  }
  if (isMessageKind(draft.kind) && !canPostKind(role, draft.kind)) {
    errors.push(
      draft.kind === "annonce"
        ? "seule la direction peut poster une annonce"
        : "ce rôle ne peut pas poster ce type de message",
    );
  }
  return { ok: errors.length === 0, errors };
}

// ————————————————————————————————————————————————————————————————
// Accusés de lecture (accusé = présence d'une ligne read ; l'auteur a lu son propre message)
// ————————————————————————————————————————————————————————————————

// Attend-elle un accusé de lecture ? (tâche, urgence, annonce)
export function expectsAck(kind: MessageKind): boolean {
  return ACK_KINDS.has(kind);
}

// Un utilisateur a-t-il « lu » ce message ? Vrai s'il en est l'auteur ou s'il a posé un accusé.
export function hasRead(
  message: Pick<InternalMessage, "id" | "auteur_username">,
  reads: readonly MessageRead[],
  username: string,
): boolean {
  if (message.auteur_username === username) return true;
  return reads.some((r) => r.message_id === message.id && r.reader_username === username);
}

// Lecteurs distincts ayant accusé réception d'un message (hors auteur). Ordre stable d'apparition.
export function readersOf(
  messageId: string,
  reads: readonly MessageRead[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of reads) {
    if (r.message_id !== messageId || seen.has(r.reader_username)) continue;
    seen.add(r.reader_username);
    out.push(r.reader_username);
  }
  return out;
}

// Messages VISIBLES non lus par moi (ni auteur, ni accusé). Base du badge « non lu ».
export function unreadMessagesFor(
  messages: readonly InternalMessage[],
  reads: readonly MessageRead[],
  role: StaffRole,
  username: string,
): InternalMessage[] {
  return visibleMessages(messages, role, username).filter(
    (m) => !hasRead(m, reads, username),
  );
}

// ————————————————————————————————————————————————————————————————
// Tri du fil : d'abord les épinglés NON résolus (urgence/alerte), puis le plus récent.
// ————————————————————————————————————————————————————————————————

function isPinnedOpen(m: InternalMessage): boolean {
  return PINNED_KINDS.has(m.kind) && m.resolved_at === null;
}

export function sortForFeed(messages: readonly InternalMessage[]): InternalMessage[] {
  return [...messages].sort((a, b) => {
    const pa = isPinnedOpen(a) ? 1 : 0;
    const pb = isPinnedOpen(b) ? 1 : 0;
    if (pa !== pb) return pb - pa; // épinglés ouverts d'abord
    // plus récent d'abord (comparaison de chaînes ISO, aucun new Date() → aucun décalage de fuseau)
    if (a.created_at === b.created_at) return 0;
    return a.created_at < b.created_at ? 1 : -1;
  });
}

// ————————————————————————————————————————————————————————————————
// Résumé du fil (états vides HONNÊTES : fil vide → zéros)
// ————————————————————————————————————————————————————————————————

export type CommSummary = {
  total: number;
  parNature: Record<MessageKind, number>;
  urgencesOuvertes: number; // kind=urgence & resolved_at null
  tachesOuvertes: number; // kind=tache & resolved_at null
  nonLus: number; // messages visibles non lus par l'utilisateur courant
};

function zeroByKind(): Record<MessageKind, number> {
  return MESSAGE_KINDS.reduce(
    (acc, k) => ({ ...acc, [k]: 0 }),
    {} as Record<MessageKind, number>,
  );
}

// Résumé du périmètre VISIBLE de l'utilisateur (jamais au-delà de ce que la RLS laisserait lire).
export function summarizeFeed(
  messages: readonly InternalMessage[],
  reads: readonly MessageRead[],
  role: StaffRole,
  username: string,
): CommSummary {
  const visible = visibleMessages(messages, role, username);
  const parNature = zeroByKind();
  let urgencesOuvertes = 0;
  let tachesOuvertes = 0;

  for (const m of visible) {
    parNature[m.kind] += 1;
    if (m.resolved_at === null && m.kind === "urgence") urgencesOuvertes += 1;
    if (m.resolved_at === null && m.kind === "tache") tachesOuvertes += 1;
  }

  const nonLus = visible.filter((m) => !hasRead(m, reads, username)).length;

  return {
    total: visible.length,
    parNature,
    urgencesOuvertes,
    tachesOuvertes,
    nonLus,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes (aucun fuseau/locale runtime)
// ————————————————————————————————————————————————————————————————

const KIND_LABELS: Record<MessageKind, string> = {
  message: "Message",
  annonce: "Annonce",
  alerte: "Alerte",
  urgence: "Urgence",
  tache: "Tâche",
};

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Direction",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Compteur",
  promoter: "Promoteur",
};

export function messageKindLabel(kind: MessageKind): string {
  return KIND_LABELS[kind];
}

export function targetLabel(target: StaffRole | null): string {
  return target === null ? "Tous" : ROLE_LABELS[target];
}
