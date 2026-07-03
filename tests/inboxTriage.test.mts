import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUEST_QUEUES,
  REQUEST_STATUSES,
  REQUESTER_TYPES,
  QUEUE_SLA_HOURS,
  buildInboxTriage,
  canReplyInbox,
  canViewInbox,
  formatAge,
  isWaitingStatus,
  prepareReplyLink,
  requestQueueTitle,
  requestStatusLabel,
  requesterTypeLabel,
  routeRequesterType,
  type InboxRequest,
} from "../lib/inboxTriage.ts";
import { STAFF_ROLES, type StaffRole } from "../lib/permissions.ts";

// ————————————————————————————————————————————————————————————————
// Gardes de rôle : B13 = direction/com (PII). admin/manager OUI ; le reste ⛔.
// ————————————————————————————————————————————————————————————————
test("canViewInbox : admin/manager OUI ; employés/promoteur NON", () => {
  assert.equal(canViewInbox("admin"), true);
  assert.equal(canViewInbox("manager"), true);
  for (const role of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canViewInbox(role), false, `${role} ne doit PAS voir l'inbox (PII)`);
  }
});

test("canReplyInbox : admin/manager peuvent valider une réponse ; le reste NON", () => {
  assert.equal(canReplyInbox("admin"), true);
  assert.equal(canReplyInbox("manager"), true);
  for (const role of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canReplyInbox(role), false);
  }
});

test("les gardes couvrent tous les rôles connus sans exception", () => {
  for (const role of STAFF_ROLES) {
    assert.equal(typeof canViewInbox(role), "boolean");
    assert.equal(typeof canReplyInbox(role), "boolean");
  }
});

// ————————————————————————————————————————————————————————————————
// Aiguillage « vous êtes » → file. Explicite, jamais deviné.
// ————————————————————————————————————————————————————————————————
test("routeRequesterType : chaque profil connu tombe dans sa file, routed=true", () => {
  assert.deepEqual(routeRequesterType("client"), { queue: "resa", routed: true });
  assert.deepEqual(routeRequesterType("entreprise"), { queue: "privatisation", routed: true });
  assert.deepEqual(routeRequesterType("artiste"), { queue: "booking", routed: true });
  assert.deepEqual(routeRequesterType("autre"), { queue: "general", routed: true });
});

test("routeRequesterType : type ABSENT → file générale, routed=false (à trier à la main, jamais deviné)", () => {
  assert.deepEqual(routeRequesterType(null), { queue: "general", routed: false });
});

test("tous les profils du formulaire ont un aiguillage vers une file connue", () => {
  for (const type of REQUESTER_TYPES) {
    const { queue } = routeRequesterType(type);
    assert.ok(REQUEST_QUEUES.includes(queue), `${type} → file inconnue`);
    assert.equal(typeof requesterTypeLabel(type), "string");
  }
});

// ————————————————————————————————————————————————————————————————
// Statuts.
// ————————————————————————————————————————————————————————————————
test("isWaitingStatus : nouveau/en_cours attendent ; répondu/clos non", () => {
  assert.equal(isWaitingStatus("nouveau"), true);
  assert.equal(isWaitingStatus("en_cours"), true);
  assert.equal(isWaitingStatus("repondu"), false);
  assert.equal(isWaitingStatus("clos"), false);
});

test("chaque statut et chaque file ont un libellé", () => {
  for (const s of REQUEST_STATUSES) assert.equal(typeof requestStatusLabel(s), "string");
  for (const q of REQUEST_QUEUES) assert.equal(typeof requestQueueTitle(q), "string");
});

// ————————————————————————————————————————————————————————————————
// Jeu de demandes de référence.
// ————————————————————————————————————————————————————————————————
const REF_NOW = "2026-07-03T20:00:00.000Z";

function req(over: Partial<InboxRequest> & Pick<InboxRequest, "id">): InboxRequest {
  return {
    requesterType: "client",
    displayName: "Test",
    subject: "Sujet",
    status: "nouveau",
    receivedAt: "2026-07-03T18:00:00.000Z", // 2 h avant REF_NOW
    hasDraft: false,
    ...over,
  };
}

test("buildInboxTriage : chaque demande tombe dans la file de son profil", () => {
  const view = buildInboxTriage({
    requests: [
      req({ id: "a", requesterType: "client" }),
      req({ id: "b", requesterType: "entreprise" }),
      req({ id: "c", requesterType: "artiste" }),
      req({ id: "d", requesterType: "autre" }),
      req({ id: "e", requesterType: null }), // non renseigné → général, non routé
    ],
    nowIso: REF_NOW,
  });
  assert.deepEqual(
    view.rowsByQueue.resa.map((r) => r.id),
    ["a"],
  );
  assert.deepEqual(
    view.rowsByQueue.privatisation.map((r) => r.id),
    ["b"],
  );
  assert.deepEqual(
    view.rowsByQueue.booking.map((r) => r.id),
    ["c"],
  );
  assert.deepEqual(
    view.rowsByQueue.general.map((r) => r.id).sort(),
    ["d", "e"],
  );
  assert.equal(view.totals.nonRoutes, 1);
});

test("les files sont dans l'ordre canonique", () => {
  const view = buildInboxTriage({ requests: [], nowIso: REF_NOW });
  assert.deepEqual(
    view.queues.map((q) => q.queue),
    [...REQUEST_QUEUES],
  );
});

// ————————————————————————————————————————————————————————————————
// SLA honnête : le retard ne se calcule qu'avec un instant de référence.
// ————————————————————————————————————————————————————————————————
test("retard : une demande en attente au-delà du SLA de sa file est en retard", () => {
  // resa SLA = 24 h ; reçue 30 h avant → en retard.
  const view = buildInboxTriage({
    requests: [req({ id: "old", requesterType: "client", receivedAt: "2026-07-02T14:00:00.000Z" })],
    nowIso: REF_NOW,
  });
  const row = view.rowsByQueue.resa[0];
  assert.equal(row.overdue, true);
  assert.equal(view.queues.find((q) => q.queue === "resa")!.overdue, 1);
  assert.equal(view.totals.overdue, 1);
});

test("retard : une demande fraîche (sous le SLA) N'est PAS en retard", () => {
  const view = buildInboxTriage({
    requests: [req({ id: "fresh", requesterType: "client", receivedAt: "2026-07-03T18:00:00.000Z" })],
    nowIso: REF_NOW,
  });
  assert.equal(view.rowsByQueue.resa[0].overdue, false);
  assert.equal(view.totals.overdue, 0);
});

test("retard : une demande DÉJÀ répondue/close n'est jamais en retard, même vieille", () => {
  const view = buildInboxTriage({
    requests: [
      req({
        id: "done",
        requesterType: "client",
        receivedAt: "2026-06-01T00:00:00.000Z",
        status: "repondu",
        respondedAt: "2026-06-01T02:00:00.000Z",
      }),
      req({
        id: "closed",
        requesterType: "client",
        receivedAt: "2026-06-01T00:00:00.000Z",
        status: "clos",
      }),
    ],
    nowIso: REF_NOW,
  });
  for (const r of view.rowsByQueue.resa) assert.equal(r.overdue, false);
  assert.equal(view.totals.overdue, 0);
});

test("SLA non calculable sans nowIso : aucun retard affirmé, âge = null (jamais fabriqué)", () => {
  const view = buildInboxTriage({
    requests: [req({ id: "x", requesterType: "client", receivedAt: "2020-01-01T00:00:00.000Z" })],
    // pas de nowIso
  });
  assert.equal(view.slaComputable, false);
  assert.equal(view.rowsByQueue.resa[0].ageHours, null);
  assert.equal(view.rowsByQueue.resa[0].overdue, false);
  assert.equal(view.totals.overdue, 0);
});

test("date de réception illisible : âge null, jamais en retard (pas de délai fabriqué)", () => {
  const view = buildInboxTriage({
    requests: [req({ id: "bad", requesterType: "client", receivedAt: "pas-une-date" })],
    nowIso: REF_NOW,
  });
  assert.equal(view.rowsByQueue.resa[0].ageHours, null);
  assert.equal(view.rowsByQueue.resa[0].overdue, false);
});

// ————————————————————————————————————————————————————————————————
// Tri dans une file : en attente d'abord, puis le plus ancien.
// ————————————————————————————————————————————————————————————————
test("tri d'une file : nouveau/en_cours avant répondu/clos, puis le plus ancien d'abord", () => {
  const view = buildInboxTriage({
    requests: [
      req({ id: "closed", requesterType: "client", status: "clos", receivedAt: "2026-07-03T10:00:00.000Z" }),
      req({ id: "recent", requesterType: "client", status: "nouveau", receivedAt: "2026-07-03T19:00:00.000Z" }),
      req({ id: "old", requesterType: "client", status: "nouveau", receivedAt: "2026-07-03T08:00:00.000Z" }),
      req({ id: "encours", requesterType: "client", status: "en_cours", receivedAt: "2026-07-03T09:00:00.000Z" }),
    ],
    nowIso: REF_NOW,
  });
  // nouveau(old) < nouveau(recent) < en_cours < clos — old avant recent (plus ancien d'abord).
  assert.deepEqual(
    view.rowsByQueue.resa.map((r) => r.id),
    ["old", "recent", "encours", "closed"],
  );
});

// ————————————————————————————————————————————————————————————————
// Compteurs de file et totaux.
// ————————————————————————————————————————————————————————————————
test("compteurs : byStatus, waiting, withDraft par file + totaux globaux", () => {
  const view = buildInboxTriage({
    requests: [
      req({ id: "1", requesterType: "client", status: "nouveau", hasDraft: true }),
      req({ id: "2", requesterType: "client", status: "en_cours" }),
      req({ id: "3", requesterType: "client", status: "repondu", respondedAt: REF_NOW }),
      req({ id: "4", requesterType: "entreprise", status: "clos" }),
      req({ id: "5", requesterType: "entreprise", status: "nouveau", hasDraft: true }),
    ],
    nowIso: REF_NOW,
  });
  const resa = view.queues.find((q) => q.queue === "resa")!;
  assert.equal(resa.total, 3);
  assert.equal(resa.byStatus.nouveau, 1);
  assert.equal(resa.byStatus.en_cours, 1);
  assert.equal(resa.byStatus.repondu, 1);
  assert.equal(resa.waiting, 2);
  assert.equal(resa.withDraft, 1);

  assert.equal(view.totals.total, 5);
  assert.equal(view.totals.waiting, 3); // 1,2,5
  assert.equal(view.totals.repondu, 1);
  assert.equal(view.totals.clos, 1);
  assert.equal(view.totals.withDraft, 2);
});

test("SLA par file : resa est la plus urgente (24 h), les autres 48 h", () => {
  assert.equal(QUEUE_SLA_HOURS.resa, 24);
  assert.equal(QUEUE_SLA_HOURS.privatisation, 48);
  assert.equal(QUEUE_SLA_HOURS.booking, 48);
  assert.equal(QUEUE_SLA_HOURS.general, 48);
});

// ————————————————————————————————————————————————————————————————
// Préparation du lien de réponse : AUCUN envoi, wa.me si tel, mailto sinon, refus si rien.
// ————————————————————————————————————————————————————————————————
test("prepareReplyLink : téléphone présent → lien wa.me (chiffres sans +), message encodé, aucun envoi", () => {
  const prep = prepareReplyLink(
    { contact: { phoneE164: "+33 6 12 34 56 78" }, subject: "Résa" },
    "Bonjour, voici votre réponse.",
  );
  assert.equal(prep.ok, true);
  if (prep.ok) {
    assert.equal(prep.channel, "wa");
    assert.match(prep.url, /^https:\/\/wa\.me\/33612345678\?text=/);
    assert.ok(prep.url.includes(encodeURIComponent("Bonjour, voici votre réponse.")));
  }
});

test("prepareReplyLink : pas de tel mais email → mailto avec sujet + corps encodés", () => {
  const prep = prepareReplyLink(
    { contact: { email: "client@example.com" }, subject: "Privatisation" },
    "Réponse de service.",
  );
  assert.equal(prep.ok, true);
  if (prep.ok) {
    assert.equal(prep.channel, "email");
    assert.match(prep.url, /^mailto:client@example\.com\?subject=/);
    assert.ok(prep.url.includes("body="));
  }
});

test("prepareReplyLink : le téléphone prime sur l'email quand les deux existent", () => {
  const prep = prepareReplyLink(
    { contact: { phoneE164: "+33612345678", email: "x@y.fr" }, subject: "S" },
    "m",
  );
  assert.equal(prep.ok, true);
  if (prep.ok) assert.equal(prep.channel, "wa");
});

test("prepareReplyLink : aucun contact exploitable → refus honnête (jamais d'URL bidon)", () => {
  assert.deepEqual(prepareReplyLink({ contact: null, subject: "S" }, "m"), {
    ok: false,
    reason: "aucun_contact",
  });
  assert.deepEqual(prepareReplyLink({ contact: { phoneE164: "  ", email: "" }, subject: "S" }, "m"), {
    ok: false,
    reason: "aucun_contact",
  });
});

// ————————————————————————————————————————————————————————————————
// Formatage.
// ————————————————————————————————————————————————————————————————
test("formatAge : null → « — » (jamais 0 fabriqué), heures puis jours", () => {
  assert.equal(formatAge(null), "—");
  assert.equal(formatAge(0.5), "< 1 h");
  assert.equal(formatAge(5), "5 h");
  assert.equal(formatAge(72), "3 j");
});
