// lib/crmSpace.ts — logique PURE du MINI-ESPACE CLIENT (V0, spec MODULE_CRM_CLIENTS_VIP.md §V0 « Mini-espace »).
// Aucun accès réseau. MIROIR côté client de la RPC get_guest_space_v1 (migration 0019) : interpréter le
// payload jsonb (données PROPRES du client, minimisées) en un affichage honnête, lecture seule.
//
// Règles dures respectées :
//   · lecture seule, aucune écriture, aucun listing d'autres clients (le serveur ne renvoie que CE client) ;
//   · on n'invente aucune donnée : jeton inconnu → « espace introuvable » ; aucune visite → état vide honnête ;
//   · les photos ne sont PAS exposées (droit à l'image non recueilli) → la section reste un « à venir » sans data.

// ————————————————————————————————————————————————————————————————
// Forme du jeton d'espace : un uuid (renvoyé par la RPC d'inscription via resolve_space_from_pass_v1).
// On valide la forme AVANT tout appel réseau pour éviter d'envoyer un jeton manifestement invalide.
// ————————————————————————————————————————————————————————————————
const SPACE_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function extractSpaceToken(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  // Le mini-espace peut être ouvert via une URL collée : on tolère « …/espace/<uuid> » et on extrait l'uuid.
  const fromPath = value.includes("/") ? value.split("/").filter(Boolean).pop() ?? "" : value;
  const candidate = fromPath.split(/[?#]/)[0];
  return SPACE_TOKEN_RE.test(candidate) ? candidate : null;
}

// ————————————————————————————————————————————————————————————————
// Types du payload (miroir strict de get_guest_space_v1 — jsonb).
// ————————————————————————————————————————————————————————————————
export type SpaceVisit = {
  exploitation_date: string; // 'YYYY-MM-DD' (jour d'exploitation, chevauche minuit)
  univers: string | null;
  status: string; // booked | confirmed | seated | no_show | cancelled
  is_host: boolean | null;
  event_title: string | null;
};

export type SpacePass = {
  // BRUT seulement pour un pass présentable (issued + soirée à venir) ; null sinon (mitigation amplification, 0019).
  qr_token: string | null;
  exploitation_date: string;
  univers: string | null;
  status: string; // issued | scanned | expired | cancelled
  is_host: boolean | null;
  event_title: string | null;
};

export type GuestSpacePayload = {
  found: boolean;
  first_name?: string | null;
  visits?: SpaceVisit[];
  passes?: SpacePass[];
};

// Normalise une valeur inconnue (réponse RPC) en payload sûr — jamais d'exception, valeurs par défaut honnêtes.
export function normalizeSpacePayload(input: unknown): GuestSpacePayload {
  if (!input || typeof input !== "object") return { found: false };
  const obj = input as Record<string, unknown>;
  if (obj.found !== true) return { found: false };
  const visits = Array.isArray(obj.visits) ? (obj.visits as SpaceVisit[]) : [];
  const passes = Array.isArray(obj.passes) ? (obj.passes as SpacePass[]) : [];
  return {
    found: true,
    first_name: typeof obj.first_name === "string" ? obj.first_name : null,
    visits,
    passes,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés (aucun terme inventé ; inconnu → repli neutre, jamais une affirmation fausse).
// ————————————————————————————————————————————————————————————————
export function universLabel(univers: string | null | undefined): string {
  switch (univers) {
    case "eden":
      return "Eden";
    case "cercle":
      return "Cercle";
    case "terminus":
      return "Terminus";
    default:
      return "Soirée";
  }
}

// Statut d'une VISITE traduit pour le client (son point de vue, pas celui de la direction).
export function visitStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "booked":
      return "Réservé";
    case "confirmed":
      return "Confirmé";
    case "seated":
      return "Vous y étiez";
    case "no_show":
      return "Non honoré";
    case "cancelled":
      return "Annulé";
    default:
      return "—";
  }
}

// Un pass est-il encore présentable comme QR d'entrée utilisable ? (issued = pas encore scanné).
export function isPassLive(status: string | null | undefined): boolean {
  return status === "issued";
}

// ————————————————————————————————————————————————————————————————
// Découpage à-venir / passé, déterministe vis-à-vis d'une date de référence (testable).
// refDate = 'YYYY-MM-DD' (jour d'exploitation courant). Une visite du jour même est « à venir »
// (la soirée n'est pas finie). Comparaison lexicographique sûre sur des dates ISO.
// ————————————————————————————————————————————————————————————————
export function splitVisits(
  visits: SpaceVisit[],
  refDate: string,
): { upcoming: SpaceVisit[]; past: SpaceVisit[] } {
  const upcoming: SpaceVisit[] = [];
  const past: SpaceVisit[] = [];
  for (const v of visits) {
    if (v.exploitation_date >= refDate) upcoming.push(v);
    else past.push(v);
  }
  // à-venir : du plus proche au plus lointain ; passé : du plus récent au plus ancien.
  upcoming.sort((a, b) => a.exploitation_date.localeCompare(b.exploitation_date));
  past.sort((a, b) => b.exploitation_date.localeCompare(a.exploitation_date));
  return { upcoming, past };
}

// QR d'entrée « actifs » à présenter en tête (pass issued sur une soirée pas encore passée).
// On exige un qr_token non-null : le serveur ne le renvoie QUE pour ces passes (mitigation amplification, 0019) —
// double garde côté présentation, jamais on n'affiche un QR sans jeton.
export function liveUpcomingPasses(passes: SpacePass[], refDate: string): SpacePass[] {
  return passes
    .filter((p) => isPassLive(p.status) && p.exploitation_date >= refDate && !!p.qr_token)
    .sort((a, b) => a.exploitation_date.localeCompare(b.exploitation_date));
}

// URL publique du mini-espace (miroir de app/espace/[token]). Base configurable, jamais de secret.
export function guestSpaceUrl(baseUrl: string, spaceToken: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/espace/${encodeURIComponent(spaceToken)}`;
}
