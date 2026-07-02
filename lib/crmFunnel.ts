// lib/crmFunnel.ts — logique PURE du FUNNEL QR d'inscription (V0, spec MODULE_CRM_CLIENTS_VIP.md §V0).
// Aucun accès réseau. C'est le SOCLE côté client de la page publique d'inscription : validation des
// champs, contrôle 18+ (loi L.3342-1), statut d'un lien d'invitation. Le vrai enforcement (dédup,
// création du guest, jeton d'entrée) est en SQL (RPC SECURITY DEFINER de la migration 0014, appelée
// par la page publique) — ces fonctions TS ne font que MIROIR pour l'UI, jamais une sécurité.
//
// Règles dures reprises de la spec :
//   · le client s'inscrit LUI-MÊME (jamais l'hôte qui saisit les données d'un tiers) ;
//   · blocage automatique < 18 ans AVANT toute entrée en base marketing (la DDN sert d'abord au
//     contrôle légal, ensuite au segment anniversaire) ;
//   · l'entrée gratuite ne peut PAS être conditionnée à la case marketing (elle reste optionnelle :
//     un QR d'entrée est délivré même si la case marketing n'est pas cochée) ;
//   · consentement DÉGROUPÉ + journalisé : si une case est cochée, le TEXTE EXACT présenté doit
//     accompagner le consentement (preuve CNIL) — sinon on refuse d'enregistrer un consentement « nu ».

import { isE164 } from "./crmClients.ts";

// ————————————————————————————————————————————————————————————————
// Constantes (miroir des CHECK de la migration 0014)
// ————————————————————————————————————————————————————————————————

// Type de lien d'invitation. guest_list = invitation individuelle ; team_vip = QR d'équipe rattaché
// à une résa de table (l'hôte fait entrer son groupe inscrit) — table obligatoire pour team_vip.
export const INVITE_KINDS = ["guest_list", "team_vip"] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

// Salle concrète (un invité est dans UNE salle). Aligné sur guest_visits.univers (0013).
export const FUNNEL_UNIVERS = ["eden", "cercle", "terminus"] as const;
export type FunnelUnivers = (typeof FUNNEL_UNIVERS)[number];

// Statut d'un QR d'entrée (guest_pass). scanned = présence constatée automatiquement à la porte.
export const PASS_STATUSES = ["issued", "scanned", "expired", "cancelled"] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

// Âge minimum légal d'entrée en base marketing (L.3342-1). Non ajustable : c'est la loi.
export const MIN_AGE_YEARS = 18;

// ————————————————————————————————————————————————————————————————
// Contrôle 18+ (loi L.3342-1) — calculé sur une date de référence (la soirée, à défaut aujourd'hui).
// ————————————————————————————————————————————————————————————————

// Parse une date ISO (YYYY-MM-DD) en composantes UTC. null si illisible (aucune date fabriquée).
function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  // Rejette les dates non canoniques (ex. 2020-02-31) via un aller-retour Date.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

// Âge révolu (années entières) à la date de référence. null si l'une des dates est illisible ou
// si la naissance est postérieure à la référence (donnée incohérente — jamais un âge négatif inventé).
export function ageOn(birthdayIso: string, refDate: Date): number | null {
  const b = parseIsoDate(birthdayIso);
  if (!b) return null;
  const ry = refDate.getUTCFullYear();
  const rm = refDate.getUTCMonth() + 1;
  const rd = refDate.getUTCDate();
  let age = ry - b.y;
  // Retire une année si l'anniversaire n'est pas encore passé à la date de référence.
  if (rm < b.m || (rm === b.m && rd < b.d)) age -= 1;
  if (age < 0) return null;
  return age;
}

// true si majeur (>= 18 ans révolus) à la date de référence. null si la date de naissance est illisible.
export function isAdult(birthdayIso: string, refDate: Date): boolean | null {
  const age = ageOn(birthdayIso, refDate);
  if (age == null) return null;
  return age >= MIN_AGE_YEARS;
}

// ————————————————————————————————————————————————————————————————
// Validation d'un formulaire d'inscription (mêmes règles que la RPC 0014, côté UI seulement).
// ————————————————————————————————————————————————————————————————

// Le téléphone est censé être DÉJÀ normalisé E.164 par l'appelant (normalizeE164 de crmClients).
export type RegistrationInput = {
  firstName: string;
  lastName?: string | null;
  phoneE164: string | null; // sortie de normalizeE164 ; null si le numéro saisi n'est pas normalisable
  birthday: string; // ISO YYYY-MM-DD (obligatoire pour le contrôle 18+)
  consentService: boolean;
  consentServiceText?: string | null; // texte EXACT présenté si la case service est cochée
  consentMarketing: boolean;
  consentMarketingText?: string | null; // texte EXACT présenté si la case marketing est cochée
};

export type RegistrationError =
  | "first_name_required"
  | "phone_invalid"
  | "birthday_required"
  | "birthday_invalid"
  | "underage"
  | "consent_service_text_missing"
  | "consent_marketing_text_missing";

// Valide un formulaire d'inscription à la date de référence de la soirée (à défaut, aujourd'hui).
// Le consentement marketing N'EST JAMAIS requis : son absence n'apparaît pas dans les erreurs
// (l'entrée gratuite reste délivrée sans lui). En revanche, une case cochée SANS son texte exact
// est refusée (on n'enregistre pas un consentement non journalisé).
export function validateRegistration(
  input: RegistrationInput,
  refDate: Date,
): { ok: boolean; errors: RegistrationError[] } {
  const errors: RegistrationError[] = [];

  if (!input.firstName || !input.firstName.trim()) errors.push("first_name_required");

  if (!input.phoneE164 || !isE164(input.phoneE164)) errors.push("phone_invalid");

  const birthday = (input.birthday ?? "").trim();
  if (!birthday) {
    errors.push("birthday_required");
  } else {
    const adult = isAdult(birthday, refDate);
    if (adult == null) errors.push("birthday_invalid");
    else if (!adult) errors.push("underage");
  }

  // Journalisation du consentement : cocher une case impose de stocker le texte exact présenté.
  if (input.consentService && !(input.consentServiceText && input.consentServiceText.trim())) {
    errors.push("consent_service_text_missing");
  }
  if (input.consentMarketing && !(input.consentMarketingText && input.consentMarketingText.trim())) {
    errors.push("consent_marketing_text_missing");
  }

  return { ok: errors.length === 0, errors };
}

// ————————————————————————————————————————————————————————————————
// Statut d'un lien d'invitation (ce que la page publique reçoit de get_invite_link_public).
// ————————————————————————————————————————————————————————————————

// Vue publique SÛRE d'un lien : aucun username staff, aucune donnée client. Sert à afficher
// « Vous êtes invité(e) à <soirée> le <date> » et à décider si le formulaire s'ouvre.
export type PublicInviteLink = {
  valid: boolean; // le token existe
  kind: InviteKind | null;
  univers: FunnelUnivers | null;
  eventTitle: string | null;
  exploitationDate: string | null; // ISO
  expiresAt: string | null; // ISO timestamp
  usesCount: number;
  maxUses: number;
};

export type InviteAvailability =
  | { open: true }
  | { open: false; reason: "unknown" | "expired" | "exhausted" };

// Décide si le formulaire d'inscription peut s'ouvrir pour ce lien, à l'instant `now`.
// N'invente rien : un lien inconnu/expiré/épuisé renvoie une raison explicite (état honnête).
export function inviteAvailability(link: PublicInviteLink | null, now: Date): InviteAvailability {
  if (!link || !link.valid) return { open: false, reason: "unknown" };
  if (link.expiresAt) {
    const exp = new Date(link.expiresAt);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() <= now.getTime()) {
      return { open: false, reason: "expired" };
    }
  }
  if (link.maxUses > 0 && link.usesCount >= link.maxUses) {
    return { open: false, reason: "exhausted" };
  }
  return { open: true };
}

// Date de référence pour le contrôle 18+ côté page publique. Doit être la DATE DE LA SOIRÉE
// (exploitation_date du lien), pas « aujourd'hui » : c'est exactement ce que refait la RPC en SQL
// (`p_birthday > exploitation_date - interval '18 years'`). Si la date de soirée est absente ou
// illisible, on retombe sur `fallback` (aujourd'hui) — jamais de date fabriquée. La date est ancrée
// à minuit UTC pour un calcul d'âge déterministe (aucune dérive de fuseau).
export function registrationRefDate(exploitationDate: string | null, fallback: Date): Date {
  if (!exploitationDate) return fallback;
  const parsed = parseIsoDate(exploitationDate);
  if (!parsed) return fallback;
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
}

// ————————————————————————————————————————————————————————————————
// Génération d'un lien d'invitation côté staff (paramètres — le TOKEN est généré en SQL, jamais ici).
// ————————————————————————————————————————————————————————————————

export type InviteLinkDraft = {
  kind: InviteKind;
  univers: FunnelUnivers;
  tableRef?: string | null; // obligatoire si kind = team_vip (QR d'équipe rattaché à une table)
  maxUses: number;
  expiresAt?: string | null;
};

export type InviteDraftError =
  | "kind_invalid"
  | "univers_invalid"
  | "table_required_for_team_vip"
  | "max_uses_invalid";

// Valide les paramètres AVANT d'appeler create_invite_link_v1 (mêmes CHECK que la table 0014).
export function validateInviteDraft(draft: InviteLinkDraft): {
  ok: boolean;
  errors: InviteDraftError[];
} {
  const errors: InviteDraftError[] = [];
  if (!INVITE_KINDS.includes(draft.kind)) errors.push("kind_invalid");
  if (!FUNNEL_UNIVERS.includes(draft.univers)) errors.push("univers_invalid");
  if (draft.kind === "team_vip" && !(draft.tableRef && draft.tableRef.trim())) {
    errors.push("table_required_for_team_vip");
  }
  if (!Number.isInteger(draft.maxUses) || draft.maxUses <= 0) errors.push("max_uses_invalid");
  return { ok: errors.length === 0, errors };
}
