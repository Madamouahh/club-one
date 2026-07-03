// lib/crmCallList.ts — la CALL-LIST DU MARDI (CRM V1), logique PURE, aucun accès réseau.
// Spec MODULE_CRM_CLIENTS_VIP.md §V1 : « le rituel du mardi » est LE facteur de succès du module
// (pas la technique). Chaque semaine, par promoteur et sur SES clients uniquement (RLS 0013 déjà
// cantonnée), on produit 15-25 noms MAX, chacun avec son « pourquoi », classés par valeur d'action :
//   1. résas à CONFIRMER J-1  (l'arme n°1 anti no-show — contractuel, pas de la prospection)
//   2. VIP sans réservation   (à réengager en priorité)
//   3. one-shot gros ticket   (relance rapide sous 7-10 j)
//   4. anniversaires à J-14
//   5. dormants               (45-60 j sans venue = meilleur ROI, plafonné à 5/semaine)
//
// RÈGLES DURES (identiques au reste du module) :
//   · AUCUN envoi automatisé : ce module PRÉPARE une liste + un texte, l'humain clique le lien wa.me
//     (fabriqué par prepareContactLink de crmClients, qui refait les gardes opt-out/consentement/Évin).
//   · AUCUN client inventé : buildCallList ne produit que ce qu'on lui passe (base vide → liste vide).
//   · LOI ÉVIN : les gabarits de message ci-dessous ne mentionnent JAMAIS l'alcool (sanction 75 000 €) ;
//     ils promeuvent LA SOIRÉE / LA TABLE, jamais une bouteille. checkMessageEvin (crmClients) revalide.
//   · Le « confirm J-1 » est un message de SERVICE (exécution du contrat) : il n'exige pas le consentement
//     marketing (mais reste bloqué si opt-out) — cohérent avec prepareContactLink(purpose:"service").
//   · Pas de troncature silencieuse : buildCallList renvoie explicitement ce qui a été écarté (plafonds).

import {
  prepareContactLink,
  type ContactGuardInput,
  type ContactPrep,
  type GuestSegment,
} from "./crmClients.ts";

// ————————————————————————————————————————————————————————————————
// Modèle d'entrée : un client enrichi (vue guest_scores 0013 + colonnes guests + résa à venir).
// Le SEGMENT est déjà calculé en amont (classifyGuest de crmClients) — ce module ne re-score pas,
// il PRIORISE. Séparer scoring et priorisation garde chaque brique testable indépendamment.
// ————————————————————————————————————————————————————————————————

export type CallListGuest = {
  guest_id: string;
  first_name: string;
  last_name: string | null;
  owner_promoter: string | null;
  phone: string | null; // E.164 (ou null si non normalisable — aucun numéro fabriqué)
  consent_marketing: boolean; // opt-in prospection (requis pour un message marketing, pas pour un service)
  opt_out: boolean; // STOP reçu — aucun lien wa.me ne sera préparé (garde définitive)
  birthday: string | null; // ISO YYYY-MM-DD (ou null)
  segment: GuestSegment; // segment primaire déjà classé (classifyGuest)
  days_since_last_seated: number | null; // récence (null si jamais assis)
  spend_seated_12m: number | null; // dépense identifiée 12 m (null si jamais attribuée)
  no_show_rate: number | null; // taux de no-show (null si aucune visite résolue)
  upcoming_resa_date: string | null; // date ISO de la prochaine résa booked/confirmed, sinon null
};

// ————————————————————————————————————————————————————————————————
// Motifs d'appel — ordre = priorité d'action (0 = plus prioritaire). Un client apparaît UNE fois,
// avec son motif le plus prioritaire. La cartographie fixe aussi le purpose wa.me (service/marketing)
// et le purpose journalisé dans guest_contacts (enum CHECK de 0013 — miroir strict, aucune dérive).
// ————————————————————————————————————————————————————————————————

export const CALL_REASONS = [
  "confirm_j1",
  "vip_no_resa",
  "one_shot",
  "birthday",
  "dormant",
] as const;
export type CallReason = (typeof CALL_REASONS)[number];

export type CallReasonMeta = {
  priority: number;
  waPurpose: "service" | "marketing";
  // Valeur du CHECK guest_contacts.purpose (0013) : 'invitation'|'confirmation'|'relance_dormant'|'anniversaire'|'one_shot'|'autre'
  contactPurpose: "confirmation" | "invitation" | "one_shot" | "anniversaire" | "relance_dormant";
  label: string;
};

export const CALL_REASON_META: Record<CallReason, CallReasonMeta> = {
  confirm_j1: {
    priority: 0,
    waPurpose: "service", // confirmation contractuelle : n'exige pas le consentement marketing
    contactPurpose: "confirmation",
    label: "Résa à confirmer (J-1)",
  },
  vip_no_resa: {
    priority: 1,
    waPurpose: "marketing",
    contactPurpose: "invitation",
    label: "VIP sans réservation",
  },
  one_shot: {
    priority: 2,
    waPurpose: "marketing",
    contactPurpose: "one_shot",
    label: "One-shot récent (gros ticket)",
  },
  birthday: {
    priority: 3,
    waPurpose: "marketing",
    contactPurpose: "anniversaire",
    label: "Anniversaire proche",
  },
  dormant: {
    priority: 4,
    waPurpose: "marketing",
    contactPurpose: "relance_dormant",
    label: "Dormant à relancer",
  },
};

// Seuils de la spec, explicites et ajustables (pas cachés). Cohérents avec SEGMENT_RULES de crmClients.
export const CALL_LIST_RULES = {
  oneShotMaxDays: 10, // relance one-shot dans la fenêtre 7-10 j
  birthdayWindowDays: 14, // anniversaires à J-14
  dormantMax: 5, // plafond dormants par semaine (anti-saturation, spec)
  totalMax: 25, // 15-25 noms max (au-delà, la call-list n'est plus un rituel tenable)
} as const;

// ————————————————————————————————————————————————————————————————
// Helpers de dates purs.
// ————————————————————————————————————————————————————————————————

// Jours jusqu'au prochain anniversaire (0..365), en ignorant l'année. null si date illisible/absente.
// Le 29/02 tombe sur le 01/03 en année non bissextile (comportement JS) — acceptable pour un rappel.
export function daysUntilBirthday(birthday: string | null, today: Date): number | null {
  if (!birthday) return null;
  const parsed = new Date(`${birthday}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = parsed.getUTCMonth();
  const day = parsed.getUTCDate();

  const ref = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let next = Date.UTC(today.getUTCFullYear(), month, day);
  if (next < ref) next = Date.UTC(today.getUTCFullYear() + 1, month, day);
  return Math.round((next - ref) / 86_400_000);
}

// ————————————————————————————————————————————————————————————————
// Attribution du motif (le motif le plus prioritaire qui s'applique), ou null (hors call-list).
// ————————————————————————————————————————————————————————————————

export function assignCallReason(guest: CallListGuest, today: Date): CallReason | null {
  // 1. Une résa à venir prime tout : la confirmer J-1 est l'action à plus haute valeur (anti no-show).
  if (guest.upcoming_resa_date) return "confirm_j1";
  // 2. VIP sans résa : à réengager en priorité.
  if (guest.segment === "vip") return "vip_no_resa";
  // 3. One-shot gros ticket dans la fenêtre de relance (7-10 j).
  if (
    guest.segment === "one_shot" &&
    guest.days_since_last_seated != null &&
    guest.days_since_last_seated <= CALL_LIST_RULES.oneShotMaxDays
  ) {
    return "one_shot";
  }
  // 4. Anniversaire proche (cross-segment) — un excellent prétexte de reprise de contact.
  const dib = daysUntilBirthday(guest.birthday, today);
  if (dib != null && dib <= CALL_LIST_RULES.birthdayWindowDays) return "birthday";
  // 5. Dormant : meilleur ROI de relance (plafonné plus bas).
  if (guest.segment === "dormant") return "dormant";
  return null;
}

// ————————————————————————————————————————————————————————————————
// Le « pourquoi » affiché (français, chiffré, honnête — jamais de promesse fabriquée).
// ————————————————————————————————————————————————————————————————

export function callReasonWhy(guest: CallListGuest, reason: CallReason, today: Date): string {
  switch (reason) {
    case "confirm_j1":
      return guest.upcoming_resa_date
        ? `Réservation le ${guest.upcoming_resa_date} à confirmer (J-1) — l'arme n°1 contre le no-show.`
        : "Réservation à confirmer (J-1) — l'arme n°1 contre le no-show.";
    case "vip_no_resa": {
      const spend =
        guest.spend_seated_12m != null ? ` · ${Math.round(guest.spend_seated_12m)} € sur 12 mois` : "";
      return `VIP sans réservation${spend} — à réengager en priorité.`;
    }
    case "one_shot":
      return guest.days_since_last_seated != null
        ? `Gros ticket, une seule venue il y a ${guest.days_since_last_seated} j — relance sous 7-10 j.`
        : "Gros ticket, une seule venue — relance rapide.";
    case "birthday": {
      const dib = daysUntilBirthday(guest.birthday, today);
      return dib != null
        ? `Anniversaire dans ${dib} j — un prétexte pour reprendre contact.`
        : "Anniversaire proche — un prétexte pour reprendre contact.";
    }
    case "dormant":
      return guest.days_since_last_seated != null
        ? `Dormant depuis ${guest.days_since_last_seated} j — meilleur ROI de relance.`
        : "Dormant — meilleur ROI de relance.";
  }
}

// ————————————————————————————————————————————————————————————————
// Gabarits de message SUGGÉRÉS (éditables par le promoteur avant envoi). ZÉRO alcool (loi Évin) :
// on promeut la soirée / la table, jamais une bouteille. Aucun nom d'établissement fabriqué (le
// promoteur connaît le sien et ajuste). Personnalisés par prénom (variabilité = anti-ban WhatsApp).
// ————————————————————————————————————————————————————————————————

export function suggestCallMessage(
  reason: CallReason,
  firstName: string,
  eventDate?: string | null,
): string {
  const prenom = firstName.trim() || "toi";
  const quand = eventDate ? ` le ${eventDate}` : "";
  switch (reason) {
    case "confirm_j1":
      return `Salut ${prenom} ! On confirme ta table${quand} ? Réponds-moi pour valider ta place 🙌`;
    case "vip_no_resa":
      return `Salut ${prenom} ! On prépare une belle soirée${quand}. Je te garde ta table habituelle ?`;
    case "one_shot":
      return `Salut ${prenom} ! Content de t'avoir reçu la dernière fois. On remet ça${quand} ? Je m'occupe de ta table.`;
    case "birthday":
      return `Salut ${prenom} ! Ton anniversaire approche 🎉 On te réserve une table pour fêter ça${quand} ?`;
    case "dormant":
      return `Salut ${prenom} ! Ça fait un moment 😊 On aimerait te revoir${quand} — je te garde une place ?`;
  }
}

// ————————————————————————————————————————————————————————————————
// Construction de la call-list : priorise, déduplique (1 client = 1 motif), trie, plafonne.
// ————————————————————————————————————————————————————————————————

export type CallListEntry = {
  guest: CallListGuest;
  reason: CallReason;
  priority: number;
  waPurpose: "service" | "marketing";
  contactPurpose: CallReasonMeta["contactPurpose"];
  why: string;
  daysUntilBirthday: number | null;
};

export type CallListResult = {
  entries: CallListEntry[];
  // Honnêteté : ce qui a été ÉCARTÉ par les plafonds (jamais silencieux).
  dormantDropped: number; // dormants au-delà du plafond dormantMax
  totalDropped: number; // entrées au-delà du plafond totalMax (tous motifs)
  eligibleCount: number; // nombre de clients éligibles avant plafonnement
};

// Clé de tri secondaire (à priorité égale) : trie chaque motif par sa métrique la plus utile.
function secondarySortKey(entry: CallListEntry): number {
  const g = entry.guest;
  switch (entry.reason) {
    case "confirm_j1":
      // Résa la plus proche d'abord (ordre chronologique de la date ISO).
      return g.upcoming_resa_date ? Date.parse(`${g.upcoming_resa_date}T00:00:00Z`) : Number.MAX_SAFE_INTEGER;
    case "vip_no_resa":
      // Plus grosse dépense d'abord (dépense inconnue en dernier).
      return g.spend_seated_12m != null ? -g.spend_seated_12m : Number.MAX_SAFE_INTEGER;
    case "one_shot":
      // Venue la plus récente d'abord (relance la plus fraîche).
      return g.days_since_last_seated ?? Number.MAX_SAFE_INTEGER;
    case "birthday":
      // Anniversaire le plus proche d'abord.
      return entry.daysUntilBirthday ?? Number.MAX_SAFE_INTEGER;
    case "dormant":
      // Dormant le plus « frais » d'abord (fenêtre 45-60 j = meilleur ROI).
      return g.days_since_last_seated ?? Number.MAX_SAFE_INTEGER;
  }
}

export function buildCallList(guests: CallListGuest[], today: Date): CallListResult {
  const eligible: CallListEntry[] = [];
  for (const guest of guests) {
    const reason = assignCallReason(guest, today);
    if (!reason) continue;
    const meta = CALL_REASON_META[reason];
    eligible.push({
      guest,
      reason,
      priority: meta.priority,
      waPurpose: meta.waPurpose,
      contactPurpose: meta.contactPurpose,
      why: callReasonWhy(guest, reason, today),
      daysUntilBirthday: daysUntilBirthday(guest.birthday, today),
    });
  }

  // Tri : priorité croissante, puis clé secondaire par motif, puis prénom (stabilité déterministe).
  eligible.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ka = secondarySortKey(a);
    const kb = secondarySortKey(b);
    if (ka !== kb) return ka - kb;
    return a.guest.first_name.localeCompare(b.guest.first_name);
  });

  // Plafond dormants (max 5/semaine) : on garde les dormantMax premiers (déjà triés par fraîcheur).
  let dormantSeen = 0;
  let dormantDropped = 0;
  const afterDormantCap = eligible.filter((e) => {
    if (e.reason !== "dormant") return true;
    dormantSeen += 1;
    if (dormantSeen <= CALL_LIST_RULES.dormantMax) return true;
    dormantDropped += 1;
    return false;
  });

  // Plafond total (15-25 noms) : au-delà, la call-list cesse d'être un rituel tenable.
  const entries = afterDormantCap.slice(0, CALL_LIST_RULES.totalMax);
  const totalDropped = afterDormantCap.length - entries.length;

  return {
    entries,
    dormantDropped,
    totalDropped,
    eligibleCount: eligible.length,
  };
}

// Répartition de la call-list par motif (pour un en-tête de synthèse honnête).
export function tallyCallReasons(entries: CallListEntry[]): Record<CallReason, number> {
  const tally: Record<CallReason, number> = {
    confirm_j1: 0,
    vip_no_resa: 0,
    one_shot: 0,
    birthday: 0,
    dormant: 0,
  };
  for (const e of entries) tally[e.reason] += 1;
  return tally;
}

// ————————————————————————————————————————————————————————————————
// Pont vers le lien wa.me (PUR, réutilisable par le futur écran réel). Une entrée de call-list porte
// déjà son waPurpose (service pour la confirmation contractuelle, marketing sinon) : on assemble donc
// la garde de contact à partir du guest et on délègue TOUTES les décisions (opt-out / consentement /
// Évin / numéro absent) à prepareContactLink — aucune règle dupliquée ici. L'UI n'a plus qu'à afficher
// le bouton wa.me (prep.ok) ou le motif de refus (prep.reason), jamais à re-juger.
// ————————————————————————————————————————————————————————————————

export function callEntryGuard(entry: CallListEntry): ContactGuardInput {
  return {
    phoneE164: entry.guest.phone,
    optOut: entry.guest.opt_out,
    consentMarketing: entry.guest.consent_marketing,
    purpose: entry.waPurpose,
  };
}

// Prépare le lien wa.me d'une entrée avec le message (édité ou suggéré). Ne construit RIEN d'autre :
// aucun envoi, juste l'URL que l'humain ouvrira depuis SON téléphone (ou le refus motivé).
export function buildCallEntryContact(entry: CallListEntry, message: string): ContactPrep {
  return prepareContactLink(callEntryGuard(entry), message);
}

// Libellés FR des motifs de refus d'un lien wa.me (miroir exact de ContactPrep.reason). Centralisés
// ici pour un affichage cohérent (l'écran n'invente pas ses propres textes) et honnête (on DIT pourquoi
// le bouton est absent, on ne le masque pas silencieusement).
export const CONTACT_REFUSAL_LABEL: Record<
  Extract<ContactPrep, { ok: false }>["reason"],
  string
> = {
  no_phone: "Pas de numéro exploitable (aucun lien possible)",
  opt_out: "Client STOP (opt-out) — aucun contact",
  no_consent: "Pas de consentement marketing — message de prospection interdit",
  evin: "Message refusé (loi Évin : aucune mention d'alcool)",
  empty_message: "Message vide",
};
