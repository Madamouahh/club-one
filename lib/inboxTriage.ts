// lib/inboxTriage.ts — logique PURE du module DEMANDES / INBOX TRIÉES (B13), aucun accès réseau.
//
// B13 est un écran DIRECTION/COM du plan maître (CLUB_ONE_OS_MASTER §2 « B13. DEMANDES / INBOX
// TRIÉES », matrice §3.1 : Direction, com · P2). Sa mission :
//   · le formulaire de contact structuré du site public (bloc 08 « vous êtes : client / entreprise /
//     artiste / autre ») alimente des FILES par responsable dans Club One ;
//   · chaque file propose un brouillon de réponse → « Valider & envoyer » HUMAIN → statistiques.
//
// TROIS principes DURS (gouvernance Club One) :
//   1. AUCUN ENVOI AUTOMATISÉ. Un brouillon reste un brouillon. Le statut `repondu` n'est posé
//      QUE lorsqu'un humain a validé (respondedAt fourni par l'appelant). Ce module PRÉPARE un
//      lien de réponse (wa.me / mailto) que l'humain clique — il n'envoie JAMAIS rien lui-même.
//   2. AUCUN TRI DEVINÉ. La file d'une demande vient du champ « vous êtes » que l'auteur a choisi.
//      Si ce champ est absent (formulaire incomplet), la demande tombe dans la file générale et
//      est marquée `routed:false` (« à trier à la main ») — on ne devine JAMAIS l'intention.
//   3. SLA HONNÊTE. Le retard se calcule UNIQUEMENT contre un instant de référence fourni
//      (`nowIso`). Sans référence, aucun retard n'est affirmé (jamais un faux « à l'heure » ni un
//      faux « en retard »). Une demande déjà répondue/close n'est jamais « en retard ».
//
// PURETÉ : aucun `new Date()` / `Date.now()` implicite — l'instant de référence est une entrée.
// (Le parseur ISO n'utilise `Date` que pour convertir des chaînes DÉJÀ fournies, jamais l'horloge.)

import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — B13 = écran DIRECTION / COM (matrice plan §3.1)
// ————————————————————————————————————————————————————————————————
//
// Les demandes contiennent des coordonnées (PII, plan §3.2 : « TOUT ce qui touche B13 (PII) »).
// L'inbox est donc réservée à la direction (admin/manager). Ce prédicat reflète le périmètre
// direction côté UI — ce n'est PAS la sécurité (la vraie garde reste la RLS des tables de demandes).
export function canViewInbox(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// Qui peut VALIDER une réponse (poser `repondu` / ouvrir le lien wa.me/mailto). Même palier que la
// consultation ici : direction/com. La validation reste un geste HUMAIN — jamais un envoi automatisé.
export function canReplyInbox(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// « Vous êtes » — les 4 profils du formulaire de contact public (bloc 08 du site).
// ————————————————————————————————————————————————————————————————
export const REQUESTER_TYPES = ["client", "entreprise", "artiste", "autre"] as const;
export type RequesterType = (typeof REQUESTER_TYPES)[number];

const REQUESTER_LABELS: Record<RequesterType, string> = {
  client: "Client",
  entreprise: "Entreprise",
  artiste: "Artiste",
  autre: "Autre",
};

export function requesterTypeLabel(type: RequesterType): string {
  return REQUESTER_LABELS[type];
}

// ————————————————————————————————————————————————————————————————
// Files par responsable — liste ORDONNÉE (routine de tri du plan B13).
// ————————————————————————————————————————————————————————————————
export const REQUEST_QUEUES = ["resa", "privatisation", "booking", "general"] as const;
export type RequestQueue = (typeof REQUEST_QUEUES)[number];

const QUEUE_TITLES: Record<RequestQueue, string> = {
  resa: "Réservations (clients)",
  privatisation: "Privatisation (entreprises)",
  booking: "Booking (artistes)",
  general: "À trier (général)",
};

export function requestQueueTitle(queue: RequestQueue): string {
  return QUEUE_TITLES[queue];
}

// Aiguillage « vous êtes » → file. UNE seule règle explicite, aucune déduction floue.
// Un type absent (formulaire incomplet) → file générale, marquée non routée (à trier à la main).
const ROUTING: Record<RequesterType, RequestQueue> = {
  client: "resa",
  entreprise: "privatisation",
  artiste: "booking",
  autre: "general",
};

export function routeRequesterType(type: RequesterType | null): {
  queue: RequestQueue;
  routed: boolean;
} {
  if (type === null) return { queue: "general", routed: false };
  return { queue: ROUTING[type], routed: true };
}

// Objectif de réponse par file (heures) — SLA honnête, sert au calcul du retard. Valeurs de
// TRAVAIL (le fondateur pourra les régler) ; la réservation client est la plus urgente.
export const QUEUE_SLA_HOURS: Record<RequestQueue, number> = {
  resa: 24,
  privatisation: 48,
  booking: 48,
  general: 48,
};

// ————————————————————————————————————————————————————————————————
// Statuts — pipeline d'une demande. `repondu` n'est JAMAIS automatique.
// ————————————————————————————————————————————————————————————————
export const REQUEST_STATUSES = ["nouveau", "en_cours", "repondu", "clos"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const STATUS_LABELS: Record<RequestStatus, string> = {
  nouveau: "Nouveau",
  en_cours: "En cours",
  repondu: "Répondu",
  clos: "Clos",
};

export function requestStatusLabel(status: RequestStatus): string {
  return STATUS_LABELS[status];
}

// Une demande « en attente » (nouveau ou en cours) réclame une action humaine. Répondu/clos = traité.
const WAITING_STATUSES: ReadonlySet<RequestStatus> = new Set<RequestStatus>(["nouveau", "en_cours"]);

export function isWaitingStatus(status: RequestStatus): boolean {
  return WAITING_STATUSES.has(status);
}

// ————————————————————————————————————————————————————————————————
// Canal de réponse — comment l'humain répondra (aucun envoi ici, juste la préparation du lien).
// ————————————————————————————————————————————————————————————————
export type ReplyChannel = "wa" | "email";

// ————————————————————————————————————————————————————————————————
// Entrée — une demande telle que remontée par le site public / la RLS des demandes.
// ————————————————————————————————————————————————————————————————
export type InboxRequest = {
  id: string;
  // Profil choisi au formulaire (« vous êtes »). null = champ absent → file générale, non deviné.
  requesterType: RequesterType | null;
  // Nom d'affichage de l'auteur (déjà filtré par la RLS en réel ; fictif en démo).
  displayName: string;
  subject: string;
  status: RequestStatus;
  receivedAt: string; // ISO 8601
  // Un brouillon de réponse existe (préparé à la main ou proposé) — JAMAIS envoyé automatiquement.
  hasDraft: boolean;
  // Posé par un humain au moment de la validation. null tant que non répondu. Sert au délai de réponse.
  respondedAt?: string | null;
  // Coordonnées pour préparer le lien de réponse (aucune obligatoire ; « — » sinon).
  contact?: { phoneE164?: string | null; email?: string | null } | null;
};

export type InboxTriageInput = {
  requests: InboxRequest[];
  // Instant de référence pour le calcul du retard. null/absent ⇒ aucun retard affirmé (SLA non calculable).
  nowIso?: string | null;
};

// ————————————————————————————————————————————————————————————————
// Sortie
// ————————————————————————————————————————————————————————————————
export type InboxRequestRow = InboxRequest & {
  queue: RequestQueue;
  routed: boolean; // false si requesterType absent (file générale par défaut, à trier à la main)
  respondedAt: string | null;
  // Âge en heures depuis la réception (null si nowIso absent ou date illisible — jamais fabriqué).
  ageHours: number | null;
  waiting: boolean; // nouveau|en_cours
  // En attente ET au-delà du SLA de sa file. false si déjà traité, si nowIso absent, ou date illisible.
  overdue: boolean;
  slaHours: number;
};

export type QueueSummary = {
  queue: RequestQueue;
  title: string;
  slaHours: number;
  total: number;
  byStatus: Record<RequestStatus, number>;
  waiting: number; // nouveau + en_cours
  overdue: number; // en attente & au-delà du SLA (0 si nowIso absent — jamais fabriqué)
  withDraft: number; // brouillons prêts à valider (jamais envoyés auto)
};

export type InboxTriageView = {
  queues: QueueSummary[]; // ordre canonique de REQUEST_QUEUES
  rowsByQueue: Record<RequestQueue, InboxRequestRow[]>;
  totals: {
    total: number;
    waiting: number;
    overdue: number;
    repondu: number;
    clos: number;
    withDraft: number;
    // Demandes tombées en file générale faute de champ « vous êtes » — à trier à la main, jamais devinées.
    nonRoutes: number;
  };
  // Le retard n'est calculé que si un instant de référence est fourni. Sinon on l'assume : non calculable.
  slaComputable: boolean;
};

// ————————————————————————————————————————————————————————————————
// Helpers purs
// ————————————————————————————————————————————————————————————————

// Convertit une date ISO en millisecondes, ou null si illisible. N'utilise Date QUE pour parser une
// chaîne DÉJÀ fournie (jamais l'horloge). NaN → null (on ne fabrique aucun délai à partir d'un rebut).
function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function emptyByStatus(): Record<RequestStatus, number> {
  return { nouveau: 0, en_cours: 0, repondu: 0, clos: 0 };
}

function buildRow(request: InboxRequest, nowMs: number | null): InboxRequestRow {
  const { queue, routed } = routeRequesterType(request.requesterType);
  const slaHours = QUEUE_SLA_HOURS[queue];
  const respondedAt = request.respondedAt ?? null;
  const waiting = isWaitingStatus(request.status);

  // Âge : uniquement si l'instant de référence ET la date de réception sont exploitables.
  const receivedMs = parseIsoMs(request.receivedAt);
  const ageHours =
    nowMs !== null && receivedMs !== null ? Math.max(0, (nowMs - receivedMs) / 3_600_000) : null;

  // Retard : en attente ET au-delà du SLA. Jamais pour une demande traitée, jamais sans âge calculable.
  const overdue = waiting && ageHours !== null && ageHours > slaHours;

  return {
    ...request,
    queue,
    routed,
    respondedAt,
    ageHours,
    waiting,
    overdue,
    slaHours,
  };
}

// Ordre d'affichage dans une file : d'abord ce qui attend une action (nouveau, en_cours), puis le
// traité ; à statut égal, le plus ANCIEN d'abord (l'attente la plus longue remonte). Déterministe :
// à date égale, on départage par id pour un ordre stable.
const STATUS_ORDER: Record<RequestStatus, number> = {
  nouveau: 0,
  en_cours: 1,
  repondu: 2,
  clos: 3,
};

function compareRows(a: InboxRequestRow, b: InboxRequestRow): number {
  const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (s !== 0) return s;
  const am = parseIsoMs(a.receivedAt);
  const bm = parseIsoMs(b.receivedAt);
  // Les dates illisibles tombent en fin de file (elles ne peuvent pas revendiquer une ancienneté).
  if (am === null && bm === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (am === null) return 1;
  if (bm === null) return -1;
  if (am !== bm) return am - bm;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ————————————————————————————————————————————————————————————————
// Construction de la vue
// ————————————————————————————————————————————————————————————————
export function buildInboxTriage(input: InboxTriageInput): InboxTriageView {
  const nowMs = parseIsoMs(input.nowIso);
  const slaComputable = nowMs !== null;

  const rows = input.requests.map((r) => buildRow(r, nowMs));

  const rowsByQueue = {} as Record<RequestQueue, InboxRequestRow[]>;
  for (const queue of REQUEST_QUEUES) rowsByQueue[queue] = [];
  for (const row of rows) rowsByQueue[row.queue].push(row);
  for (const queue of REQUEST_QUEUES) rowsByQueue[queue].sort(compareRows);

  const queues: QueueSummary[] = REQUEST_QUEUES.map((queue) => {
    const qrows = rowsByQueue[queue];
    const byStatus = emptyByStatus();
    let waiting = 0;
    let overdue = 0;
    let withDraft = 0;
    for (const row of qrows) {
      byStatus[row.status] += 1;
      if (row.waiting) waiting += 1;
      if (row.overdue) overdue += 1;
      if (row.hasDraft) withDraft += 1;
    }
    return {
      queue,
      title: QUEUE_TITLES[queue],
      slaHours: QUEUE_SLA_HOURS[queue],
      total: qrows.length,
      byStatus,
      waiting,
      overdue,
      withDraft,
    };
  });

  const totals = {
    total: rows.length,
    waiting: rows.filter((r) => r.waiting).length,
    overdue: rows.filter((r) => r.overdue).length,
    repondu: rows.filter((r) => r.status === "repondu").length,
    clos: rows.filter((r) => r.status === "clos").length,
    withDraft: rows.filter((r) => r.hasDraft).length,
    nonRoutes: rows.filter((r) => !r.routed).length,
  };

  return { queues, rowsByQueue, totals, slaComputable };
}

// ————————————————————————————————————————————————————————————————
// Préparation d'un lien de RÉPONSE (aucun envoi) — la « Valider & envoyer » HUMAINE.
// ————————————————————————————————————————————————————————————————
//
// Base légale distincte du contact CRM marketing (lib/crmClients.prepareContactLink) : ici l'auteur
// nous a écrit et attend une réponse de SERVICE (licite, sans consentement marketing requis). On ne
// duplique donc pas la garde d'opt-out marketing — mais on n'envoie RIEN non plus : on PRÉPARE le lien
// que l'humain clique. wa.me si un téléphone est présent, mailto sinon. Aucun message n'est injecté :
// le texte vient de l'humain (respect de la loi Evin — aucune mention d'alcool ajoutée par l'outil).
export type ReplyLinkPrep =
  | { ok: true; channel: ReplyChannel; url: string }
  | { ok: false; reason: "aucun_contact" };

export function prepareReplyLink(
  row: Pick<InboxRequest, "contact" | "subject">,
  message: string,
): ReplyLinkPrep {
  const phone = row.contact?.phoneE164?.trim() || null;
  const email = row.contact?.email?.trim() || null;

  if (phone) {
    const digits = phone.replace(/[^0-9]/g, ""); // wa.me veut les chiffres sans « + »
    if (digits.length > 0) {
      return {
        ok: true,
        channel: "wa",
        url: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      };
    }
  }

  if (email) {
    const subject = encodeURIComponent(row.subject);
    const body = encodeURIComponent(message);
    return { ok: true, channel: "email", url: `mailto:${email}?subject=${subject}&body=${body}` };
  }

  return { ok: false, reason: "aucun_contact" };
}

// ————————————————————————————————————————————————————————————————
// Formatage FR déterministe (aucune dépendance au fuseau/à l'horloge)
// ————————————————————————————————————————————————————————————————

// Âge d'attente en texte court ; null → « — » (non calculable, jamais fabriqué).
export function formatAge(ageHours: number | null): string {
  if (ageHours === null) return "—";
  if (ageHours < 1) return "< 1 h";
  if (ageHours < 48) return `${Math.floor(ageHours)} h`;
  return `${Math.floor(ageHours / 24)} j`;
}
