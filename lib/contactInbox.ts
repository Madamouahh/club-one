// lib/contactInbox.ts — pont PUR (aucun réseau, aucun React) entre la table `contact_requests`
// (migration 0063) et le modèle d'affichage de l'inbox triée (lib/inboxTriage → InboxTriageBoard).
//
// Séparé du conteneur pour rester testable (tests/inboxBoard.test.mts). On ne fabrique RIEN :
//   · une coordonnée absente reste null (jamais « — » ni valeur inventée) ;
//   · le statut de STOCKAGE `traite` (pipeline B13) est mappé sur le statut d'AFFICHAGE `repondu`
//     attendu par le board — une demande « traitée » a reçu sa réponse humaine (aucun envoi auto) ;
//   · aucun brouillon/aucun instant de réponse n'est fabriqué (la table n'en stocke pas).

import {
  REQUESTER_TYPES,
  type InboxRequest,
  type RequesterType,
  type RequestStatus,
} from "./inboxTriage.ts";
import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Statuts de STOCKAGE (pipeline B13, miroir strict du CHECK SQL de 0063).
// ————————————————————————————————————————————————————————————————
export const CONTACT_STATUSES = ["nouveau", "en_cours", "traite", "clos"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  nouveau: "Nouveau",
  en_cours: "En cours",
  traite: "Traité",
  clos: "Clos",
};

export function contactStatusLabel(status: ContactStatus): string {
  return CONTACT_STATUS_LABELS[status];
}

export function isContactStatus(value: unknown): value is ContactStatus {
  return typeof value === "string" && (CONTACT_STATUSES as readonly string[]).includes(value);
}

export function isRequesterType(value: unknown): value is RequesterType {
  return typeof value === "string" && (REQUESTER_TYPES as readonly string[]).includes(value);
}

// Statut STOCKAGE → statut AFFICHAGE (board). Seul `traite` diffère (« traité » = « répondu » à l'écran) ;
// un statut illisible retombe honnêtement sur `nouveau` (jamais deviné « traité »/« clos »).
export function contactStatusToBoard(status: string): RequestStatus {
  switch (status) {
    case "en_cours":
      return "en_cours";
    case "traite":
      return "repondu";
    case "clos":
      return "clos";
    default:
      return "nouveau";
  }
}

// ————————————————————————————————————————————————————————————————
// Ligne brute telle que renvoyée par supabase.from("contact_requests").select("*").
// ————————————————————————————————————————————————————————————————
export type ContactRequestRow = {
  id: string;
  requester_type: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  subject: string;
  message: string | null;
  status: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export const CONTACT_REQUEST_SELECT = "*";

// Nom d'affichage : le nom saisi, sinon « Sans nom » (jamais une chaîne vide qui casserait l'affichage).
export function contactDisplayName(fullName: string | null | undefined): string {
  const name = (fullName ?? "").trim();
  return name.length > 0 ? name : "Sans nom";
}

// Convertit UNE ligne DB en InboxRequest (entrée du board). Aucun défaut fabriqué :
//   · requesterType : le profil stocké s'il est valide, sinon null (→ file générale « à trier ») ;
//   · contact : téléphone/e-mail seulement s'ils existent (aucune coordonnée inventée) ;
//   · hasDraft:false et respondedAt:null — la table 0063 ne stocke ni brouillon ni instant de réponse.
export function mapContactRequestRow(raw: ContactRequestRow): InboxRequest {
  const phone = (raw.phone ?? "").trim();
  const email = (raw.email ?? "").trim();
  const hasContact = phone.length > 0 || email.length > 0;
  return {
    id: raw.id,
    requesterType: isRequesterType(raw.requester_type) ? raw.requester_type : null,
    displayName: contactDisplayName(raw.full_name),
    subject: raw.subject,
    status: contactStatusToBoard(raw.status),
    receivedAt: raw.created_at,
    hasDraft: false,
    respondedAt: null,
    contact: hasContact
      ? { phoneE164: phone.length > 0 ? phone : null, email: email.length > 0 ? email : null }
      : null,
  };
}

export function mapContactRequestRows(rows: readonly ContactRequestRow[]): InboxRequest[] {
  return rows.map(mapContactRequestRow);
}

// ————————————————————————————————————————————————————————————————
// Garde d'AFFICHAGE (confort UI, miroir de la RLS 0063 — PAS une sécurité).
// ————————————————————————————————————————————————————————————————
export function canViewContactInbox(role: StaffRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// Validation du formulaire de SAISIE staff (direction saisit une demande reçue hors ligne).
// Miroir des contraintes NOT NULL / CHECK de 0063 — la base reste l'autorité (RLS + CHECK).
// ————————————————————————————————————————————————————————————————
export type ContactRequestDraft = {
  requester_type: string;
  subject: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
};

export type DraftCheck = { ok: true } | { ok: false; message: string };

export function validateContactRequestDraft(draft: ContactRequestDraft): DraftCheck {
  if (!isRequesterType(draft.requester_type)) {
    return { ok: false, message: "Profil « vous êtes » requis (client / entreprise / artiste / autre)." };
  }
  if (!draft.subject || draft.subject.trim().length === 0) {
    return { ok: false, message: "Sujet requis." };
  }
  // Au moins un moyen de recontacter : sinon la demande ne pourra jamais recevoir de réponse.
  const hasContact =
    (draft.phone ?? "").trim().length > 0 || (draft.email ?? "").trim().length > 0;
  if (!hasContact) {
    return { ok: false, message: "Au moins un contact (téléphone ou e-mail) est requis pour pouvoir répondre." };
  }
  return { ok: true };
}
