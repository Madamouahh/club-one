import assert from "node:assert/strict";
import test from "node:test";

import {
  COMM_ROLES,
  MESSAGE_KINDS,
  canAccessInternalComm,
  canPostAnnouncement,
  canPostKind,
  canResolveMessage,
  canViewAllMessages,
  canViewMessage,
  expectsAck,
  hasRead,
  isCommRole,
  isMessageKind,
  messageKindLabel,
  readersOf,
  sortForFeed,
  summarizeFeed,
  targetLabel,
  unreadMessagesFor,
  validateMessageDraft,
  visibleMessages,
  type InternalMessage,
  type MessageDraft,
  type MessageRead,
} from "../lib/internalComms.ts";
import type { StaffRole } from "../lib/permissions.ts";

function msg(over: Partial<InternalMessage> = {}): InternalMessage {
  return {
    id: over.id ?? "m1",
    event_id: over.event_id ?? null,
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    kind: over.kind ?? "message",
    body: over.body ?? "coucou",
    target_role: over.target_role ?? null,
    assignee_username: over.assignee_username ?? null,
    auteur_username: over.auteur_username ?? "manuel",
    resolved_at: over.resolved_at ?? null,
    created_at: over.created_at ?? "2026-07-03T22:00:00Z",
    updated_at: over.updated_at ?? "2026-07-03T22:00:00Z",
  };
}

function read(over: Partial<MessageRead> = {}): MessageRead {
  return {
    id: over.id ?? "r1",
    message_id: over.message_id ?? "m1",
    reader_username: over.reader_username ?? "lea",
    created_at: over.created_at ?? "2026-07-03T22:05:00Z",
  };
}

function draft(over: Partial<MessageDraft> = {}): MessageDraft {
  return {
    exploitation_date: over.exploitation_date ?? "2026-07-03",
    kind: over.kind ?? "message",
    body: over.body ?? "texte",
    target_role: over.target_role,
    assignee_username: over.assignee_username,
    event_id: over.event_id,
  };
}

// ————————————————————————————————————————————————————————————————
// Vocabulaires fermés & gardes de type
// ————————————————————————————————————————————————————————————————

test("MESSAGE_KINDS couvre exactement les 5 natures A7", () => {
  assert.deepEqual([...MESSAGE_KINDS], ["message", "annonce", "alerte", "urgence", "tache"]);
});

test("COMM_ROLES exclut promoteur (⛔ matrice A7)", () => {
  assert.ok(!(COMM_ROLES as readonly string[]).includes("promoter"));
  assert.equal(COMM_ROLES.length, 5);
});

test("isMessageKind accepte le connu, refuse l'inconnu", () => {
  assert.ok(isMessageKind("urgence"));
  assert.ok(!isMessageKind("spam"));
});

test("isCommRole : promoteur non, les 5 autres oui", () => {
  assert.ok(!isCommRole("promoter"));
  for (const r of COMM_ROLES) assert.ok(isCommRole(r));
});

// ————————————————————————————————————————————————————————————————
// Gardes de rôle (matrice A7)
// ————————————————————————————————————————————————————————————————

test("canAccessInternalComm : 5 rôles oui, promoteur non", () => {
  for (const r of COMM_ROLES) assert.ok(canAccessInternalComm(r));
  assert.ok(!canAccessInternalComm("promoter"));
});

test("canPostAnnouncement : direction seule", () => {
  assert.ok(canPostAnnouncement("admin"));
  assert.ok(canPostAnnouncement("manager"));
  for (const r of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.ok(!canPostAnnouncement(r));
  }
});

test("canViewAllMessages : direction seule (supervision)", () => {
  assert.ok(canViewAllMessages("admin"));
  assert.ok(canViewAllMessages("manager"));
  assert.ok(!canViewAllMessages("security"));
});

test("canPostKind : annonce réservée direction, autres natures ouvertes aux 5 rôles", () => {
  assert.ok(canPostKind("server", "message"));
  assert.ok(canPostKind("security_counter", "urgence"));
  assert.ok(!canPostKind("server", "annonce"));
  assert.ok(canPostKind("manager", "annonce"));
  assert.ok(!canPostKind("promoter", "message")); // aucun accès
});

test("canResolveMessage : direction OU auteur", () => {
  const m = msg({ auteur_username: "manuel" });
  assert.ok(canResolveMessage("admin", m, "autre"));
  assert.ok(canResolveMessage("server", m, "manuel")); // auteur
  assert.ok(!canResolveMessage("server", m, "lea")); // ni direction ni auteur
});

// ————————————————————————————————————————————————————————————————
// Visibilité d'un message (miroir RLS select)
// ————————————————————————————————————————————————————————————————

test("direction voit tout (même un message ciblé sur un autre rôle)", () => {
  const m = msg({ target_role: "security", auteur_username: "x" });
  assert.ok(canViewMessage("admin", m, "moi"));
});

test("broadcast (target null + assignee null) visible par tous les rôles avec accès", () => {
  const m = msg({ target_role: null, assignee_username: null });
  for (const r of COMM_ROLES) assert.ok(canViewMessage(r, m, "moi"));
});

test("message ciblé sur un rôle : visible par ce rôle, invisible aux autres non-direction", () => {
  const m = msg({ target_role: "server", auteur_username: "chef" });
  assert.ok(canViewMessage("server", m, "lea"));
  assert.ok(!canViewMessage("security", m, "bob")); // autre rôle
});

test("tâche assignée nominativement : visible par l'assigné, pas par un autre serveur", () => {
  const m = msg({ kind: "tache", target_role: null, assignee_username: "lea", auteur_username: "chef" });
  assert.ok(canViewMessage("server", m, "lea")); // l'assigné
  assert.ok(!canViewMessage("server", m, "bob")); // autre serveur non assigné
});

test("l'auteur voit toujours son propre message ciblé", () => {
  const m = msg({ target_role: "security", auteur_username: "lea" });
  assert.ok(canViewMessage("server", m, "lea"));
});

test("promoteur ne voit rien, même un broadcast", () => {
  assert.ok(!canViewMessage("promoter", msg(), "moi"));
});

test("visibleMessages filtre au périmètre ; liste vide → liste vide", () => {
  const list = [
    msg({ id: "a", target_role: null, assignee_username: null }), // broadcast
    msg({ id: "b", target_role: "security", auteur_username: "x" }), // pas pour un serveur
    msg({ id: "c", assignee_username: "lea", target_role: null, auteur_username: "x" }),
  ];
  const seen = visibleMessages(list, "server", "lea").map((m) => m.id);
  assert.deepEqual(seen, ["a", "c"]);
  assert.deepEqual(visibleMessages([], "admin", "x"), []);
});

// ————————————————————————————————————————————————————————————————
// Validation de brouillon
// ————————————————————————————————————————————————————————————————

test("brouillon valide → ok", () => {
  assert.ok(validateMessageDraft(draft(), "server").ok);
});

test("corps vide refusé", () => {
  const v = validateMessageDraft(draft({ body: "   " }), "server");
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes("vide")));
});

test("nature inconnue refusée", () => {
  const v = validateMessageDraft(draft({ kind: "gossip" }), "manager");
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes("nature")));
});

test("date non ISO refusée", () => {
  const v = validateMessageDraft(draft({ exploitation_date: "03/07/2026" }), "server");
  assert.ok(!v.ok);
});

test("annonce par un serveur refusée ; par un manager acceptée", () => {
  const bad = validateMessageDraft(draft({ kind: "annonce" }), "server");
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => e.includes("annonce")));
  assert.ok(validateMessageDraft(draft({ kind: "annonce" }), "manager").ok);
});

test("rôle cible invalide refusé", () => {
  const v = validateMessageDraft(
    draft({ target_role: "promoter" as StaffRole }),
    "manager",
  );
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => e.includes("cible")));
});

// ————————————————————————————————————————————————————————————————
// Accusés de lecture / non-lu
// ————————————————————————————————————————————————————————————————

test("expectsAck : tâche/urgence/annonce oui, message/alerte non", () => {
  assert.ok(expectsAck("tache"));
  assert.ok(expectsAck("urgence"));
  assert.ok(expectsAck("annonce"));
  assert.ok(!expectsAck("message"));
  assert.ok(!expectsAck("alerte"));
});

test("hasRead : l'auteur a lu son propre message sans accusé", () => {
  assert.ok(hasRead(msg({ auteur_username: "lea" }), [], "lea"));
});

test("hasRead : vrai si un accusé existe, faux sinon", () => {
  const reads = [read({ message_id: "m1", reader_username: "bob" })];
  assert.ok(hasRead(msg({ id: "m1", auteur_username: "chef" }), reads, "bob"));
  assert.ok(!hasRead(msg({ id: "m1", auteur_username: "chef" }), reads, "lea"));
});

test("readersOf : lecteurs distincts dans l'ordre d'apparition", () => {
  const reads = [
    read({ message_id: "m1", reader_username: "bob" }),
    read({ message_id: "m1", reader_username: "lea" }),
    read({ message_id: "m1", reader_username: "bob" }), // doublon
    read({ message_id: "m2", reader_username: "zoe" }), // autre message
  ];
  assert.deepEqual(readersOf("m1", reads), ["bob", "lea"]);
  assert.deepEqual(readersOf("mX", reads), []);
});

test("unreadMessagesFor : exclut auteur & déjà accusés, respecte la visibilité", () => {
  const messages = [
    msg({ id: "a", target_role: null, assignee_username: null, auteur_username: "chef" }), // broadcast non lu
    msg({ id: "b", target_role: null, assignee_username: null, auteur_username: "lea" }), // je suis auteur → lu
    msg({ id: "c", target_role: null, assignee_username: null, auteur_username: "chef" }), // accusé
    msg({ id: "d", target_role: "security", auteur_username: "chef" }), // pas visible pour un serveur
  ];
  const reads = [read({ message_id: "c", reader_username: "lea" })];
  const unread = unreadMessagesFor(messages, reads, "server", "lea").map((m) => m.id);
  assert.deepEqual(unread, ["a"]);
});

// ————————————————————————————————————————————————————————————————
// Tri du fil
// ————————————————————————————————————————————————————————————————

test("sortForFeed : urgence ouverte remonte en tête, puis plus récent d'abord", () => {
  const messages = [
    msg({ id: "old", kind: "message", created_at: "2026-07-03T20:00:00Z" }),
    msg({ id: "new", kind: "message", created_at: "2026-07-03T23:00:00Z" }),
    msg({ id: "urg", kind: "urgence", resolved_at: null, created_at: "2026-07-03T21:00:00Z" }),
    msg({ id: "urgclos", kind: "urgence", resolved_at: "2026-07-03T21:30:00Z", created_at: "2026-07-03T22:30:00Z" }),
  ];
  const order = sortForFeed(messages).map((m) => m.id);
  assert.equal(order[0], "urg"); // urgence ouverte épinglée
  // les autres triés par récence décroissante
  assert.deepEqual(order.slice(1), ["new", "urgclos", "old"]);
});

test("sortForFeed : copie non mutante", () => {
  const src = [msg({ id: "a" }), msg({ id: "b" })];
  const snapshot = src.map((m) => m.id);
  sortForFeed(src);
  assert.deepEqual(src.map((m) => m.id), snapshot);
});

// ————————————————————————————————————————————————————————————————
// Résumé du fil (états vides honnêtes)
// ————————————————————————————————————————————————————————————————

test("summarizeFeed : fil vide → zéros honnêtes", () => {
  const s = summarizeFeed([], [], "admin", "x");
  assert.equal(s.total, 0);
  assert.equal(s.urgencesOuvertes, 0);
  assert.equal(s.tachesOuvertes, 0);
  assert.equal(s.nonLus, 0);
  for (const k of MESSAGE_KINDS) assert.equal(s.parNature[k], 0);
});

test("summarizeFeed : compte le périmètre visible, urgences/tâches ouvertes et non-lus", () => {
  const messages = [
    msg({ id: "a", kind: "urgence", resolved_at: null, target_role: null, assignee_username: null, auteur_username: "chef" }),
    msg({ id: "b", kind: "urgence", resolved_at: "2026-07-03T22:10:00Z", target_role: null, assignee_username: null, auteur_username: "chef" }),
    msg({ id: "c", kind: "tache", resolved_at: null, assignee_username: "lea", target_role: null, auteur_username: "chef" }),
    msg({ id: "d", kind: "message", target_role: "security", auteur_username: "chef" }), // invisible pour serveur
  ];
  const reads: MessageRead[] = []; // rien accusé
  const s = summarizeFeed(messages, reads, "server", "lea");
  assert.equal(s.total, 3); // d exclu (pas visible)
  assert.equal(s.urgencesOuvertes, 1); // a seule (b résolue)
  assert.equal(s.tachesOuvertes, 1); // c
  assert.equal(s.nonLus, 3); // a, b, c non accusés (lea n'en est pas l'auteur)
  assert.equal(s.parNature.urgence, 2);
  assert.equal(s.parNature.tache, 1);
});

// ————————————————————————————————————————————————————————————————
// Libellés
// ————————————————————————————————————————————————————————————————

test("messageKindLabel & targetLabel", () => {
  assert.equal(messageKindLabel("annonce"), "Annonce");
  assert.equal(targetLabel(null), "Tous");
  assert.equal(targetLabel("security"), "Sécurité");
});
