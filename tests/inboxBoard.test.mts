import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACT_STATUSES,
  CONTACT_REQUEST_SELECT,
  canViewContactInbox,
  contactDisplayName,
  contactStatusLabel,
  contactStatusToBoard,
  isContactStatus,
  isRequesterType,
  mapContactRequestRow,
  mapContactRequestRows,
  validateContactRequestDraft,
  type ContactRequestRow,
} from "../lib/contactInbox.ts";
import { buildInboxTriage } from "../lib/inboxTriage.ts";
import type { StaffRole } from "../lib/permissions.ts";

function row(over: Partial<ContactRequestRow> = {}): ContactRequestRow {
  return {
    id: "r1",
    requester_type: "client",
    full_name: "Alice Martin",
    phone: "+33612345678",
    email: "alice@example.com",
    subject: "Réservation table",
    message: "Bonjour",
    status: "nouveau",
    assigned_to: null,
    created_at: "2026-07-01T20:00:00.000Z",
    updated_at: "2026-07-01T20:00:00.000Z",
    ...over,
  };
}

// ————————————————————————————————————————————————————————————————
// Garde d'affichage : miroir de la RLS 0063 (direction seule).
// ————————————————————————————————————————————————————————————————
test("canViewContactInbox : admin/manager OUI ; le reste NON", () => {
  assert.equal(canViewContactInbox("admin"), true);
  assert.equal(canViewContactInbox("manager"), true);
  for (const r of ["server", "security", "security_counter", "promoter"] as StaffRole[]) {
    assert.equal(canViewContactInbox(r), false, `${r} ne doit pas voir l'inbox (PII)`);
  }
  assert.equal(canViewContactInbox(null), false);
  assert.equal(canViewContactInbox(undefined), false);
});

// ————————————————————————————————————————————————————————————————
// Statuts de stockage ↔ statuts d'affichage.
// ————————————————————————————————————————————————————————————————
test("CONTACT_STATUSES = pipeline 0063 exact", () => {
  assert.deepEqual([...CONTACT_STATUSES], ["nouveau", "en_cours", "traite", "clos"]);
});

test("contactStatusToBoard : traite→repondu, autres inchangés, illisible→nouveau", () => {
  assert.equal(contactStatusToBoard("nouveau"), "nouveau");
  assert.equal(contactStatusToBoard("en_cours"), "en_cours");
  assert.equal(contactStatusToBoard("traite"), "repondu");
  assert.equal(contactStatusToBoard("clos"), "clos");
  assert.equal(contactStatusToBoard("n_importe_quoi"), "nouveau");
});

test("contactStatusLabel : libellés FR", () => {
  assert.equal(contactStatusLabel("nouveau"), "Nouveau");
  assert.equal(contactStatusLabel("en_cours"), "En cours");
  assert.equal(contactStatusLabel("traite"), "Traité");
  assert.equal(contactStatusLabel("clos"), "Clos");
});

test("isContactStatus / isRequesterType : gardes de type", () => {
  assert.equal(isContactStatus("traite"), true);
  assert.equal(isContactStatus("repondu"), false);
  assert.equal(isContactStatus(42), false);
  assert.equal(isRequesterType("entreprise"), true);
  assert.equal(isRequesterType("vip"), false);
});

// ————————————————————————————————————————————————————————————————
// Nom d'affichage : jamais de chaîne vide.
// ————————————————————————————————————————————————————————————————
test("contactDisplayName : nom saisi, sinon « Sans nom »", () => {
  assert.equal(contactDisplayName("Alice"), "Alice");
  assert.equal(contactDisplayName("  Bob  "), "Bob");
  assert.equal(contactDisplayName(""), "Sans nom");
  assert.equal(contactDisplayName("   "), "Sans nom");
  assert.equal(contactDisplayName(null), "Sans nom");
  assert.equal(contactDisplayName(undefined), "Sans nom");
});

// ————————————————————————————————————————————————————————————————
// Mapping DB → InboxRequest : aucune donnée fabriquée.
// ————————————————————————————————————————————————————————————————
test("mapContactRequestRow : champs mappés fidèlement", () => {
  const req = mapContactRequestRow(row());
  assert.equal(req.id, "r1");
  assert.equal(req.requesterType, "client");
  assert.equal(req.displayName, "Alice Martin");
  assert.equal(req.subject, "Réservation table");
  assert.equal(req.status, "nouveau");
  assert.equal(req.receivedAt, "2026-07-01T20:00:00.000Z");
  assert.equal(req.hasDraft, false);
  assert.equal(req.respondedAt, null);
  assert.deepEqual(req.contact, { phoneE164: "+33612345678", email: "alice@example.com" });
});

test("mapContactRequestRow : statut traite → repondu à l'affichage", () => {
  assert.equal(mapContactRequestRow(row({ status: "traite" })).status, "repondu");
});

test("mapContactRequestRow : type inconnu → null (file générale, jamais deviné)", () => {
  const req = mapContactRequestRow(row({ requester_type: "???" }));
  assert.equal(req.requesterType, null);
});

test("mapContactRequestRow : contact absent → null (aucune coordonnée fabriquée)", () => {
  const req = mapContactRequestRow(row({ phone: null, email: null }));
  assert.equal(req.contact, null);
});

test("mapContactRequestRow : e-mail seul (téléphone vide) → phoneE164 null", () => {
  const req = mapContactRequestRow(row({ phone: "   ", email: "x@y.fr" }));
  assert.deepEqual(req.contact, { phoneE164: null, email: "x@y.fr" });
});

test("mapContactRequestRows : lot mappé et exploitable par buildInboxTriage", () => {
  const rows = [
    row({ id: "a", requester_type: "client", status: "nouveau" }),
    row({ id: "b", requester_type: "entreprise", status: "en_cours" }),
    row({ id: "c", requester_type: "artiste", status: "traite" }),
    row({ id: "d", requester_type: "autre", status: "clos" }),
  ];
  const view = buildInboxTriage({
    requests: mapContactRequestRows(rows),
    nowIso: "2026-07-02T20:00:00.000Z",
  });
  assert.equal(view.totals.total, 4);
  assert.equal(view.totals.waiting, 2); // nouveau + en_cours
  assert.equal(view.totals.repondu, 1); // traite → repondu
  assert.equal(view.totals.clos, 1);
  assert.equal(view.totals.nonRoutes, 0); // les 4 profils sont routés
  // Routage : client→resa, entreprise→privatisation, artiste→booking, autre→general.
  assert.equal(view.rowsByQueue.resa.length, 1);
  assert.equal(view.rowsByQueue.privatisation.length, 1);
  assert.equal(view.rowsByQueue.booking.length, 1);
  assert.equal(view.rowsByQueue.general.length, 1);
});

// ————————————————————————————————————————————————————————————————
// Validation du formulaire de saisie staff.
// ————————————————————————————————————————————————————————————————
test("validateContactRequestDraft : demande valide acceptée", () => {
  const res = validateContactRequestDraft({
    requester_type: "client",
    subject: "Résa",
    phone: "+33600000000",
  });
  assert.equal(res.ok, true);
});

test("validateContactRequestDraft : profil invalide rejeté", () => {
  const res = validateContactRequestDraft({ requester_type: "vip", subject: "x", email: "a@b.fr" });
  assert.equal(res.ok, false);
});

test("validateContactRequestDraft : sujet vide rejeté", () => {
  const res = validateContactRequestDraft({
    requester_type: "client",
    subject: "   ",
    email: "a@b.fr",
  });
  assert.equal(res.ok, false);
});

test("validateContactRequestDraft : sans contact rejeté (impossible de répondre)", () => {
  const res = validateContactRequestDraft({ requester_type: "client", subject: "Résa" });
  assert.equal(res.ok, false);
});

test("validateContactRequestDraft : e-mail seul suffit", () => {
  const res = validateContactRequestDraft({
    requester_type: "autre",
    subject: "Question",
    email: "a@b.fr",
  });
  assert.equal(res.ok, true);
});

// ————————————————————————————————————————————————————————————————
// Constantes de câblage.
// ————————————————————————————————————————————————————————————————
test("CONTACT_REQUEST_SELECT : select PostgREST complet", () => {
  assert.equal(CONTACT_REQUEST_SELECT, "*");
});
