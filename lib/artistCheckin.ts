// lib/artistCheckin.ts — logique PURE du module Artist check-in (A8), aucun accès réseau.
//
// Fiche d'accueil de l'artiste le soir de la soirée (migration 0027) : arrivée, loge, balance,
// matériel, horaires, accompagnants, rider, validation technique. Ce module :
//   · décrit le modèle (miroir de la table artist_checkins) ;
//   · valide un brouillon de fiche AVANT insert (nom requis, statut fermé, accompagnants entier ≥ 0) ;
//   · porte les gardes de rôle de la matrice A8 (source de vérité UI ; la RLS 0027 reste l'autorité) ;
//   · calcule l'avancement de l'accueil (jalons arrivée/balance/tech) et un résumé (états vides
//     HONNÊTES : aucune fiche → des zéros, jamais un artiste fabriqué).
// L'accès Supabase reste dans app/page.tsx (comme incidents / comm interne) ; ce module ne fait que
// valider, filtrer et agréger. Rien n'est inventé : aucun artiste, aucun cachet n'est fabriqué ici.

import type { StaffRole } from "./permissions.ts";

// ————————————————————————————————————————————————————————————————
// Modèle (miroir de la table 0027)
// ————————————————————————————————————————————————————————————————

// Cycle de vie de l'accueil (vocabulaire fermé — une structure métier, pas une donnée fondateur).
export const CHECKIN_STATUSES = [
  "attendu", // annoncé, pas encore arrivé
  "arrive", // arrivé sur place
  "en_loge", // installé en loge
  "balance", // balance / soundcheck fait
  "pret", // prêt (validation technique OK)
  "en_scene", // en train de jouer
  "termine", // set terminé
  "no_show", // ne s'est pas présenté
  "annule", // annulé
] as const;
export type CheckinStatus = (typeof CHECKIN_STATUSES)[number];

// Statuts terminaux : plus d'avancement attendu.
const TERMINAL_STATUSES: ReadonlySet<CheckinStatus> = new Set<CheckinStatus>([
  "termine",
  "no_show",
  "annule",
]);

// Rôles disposant d'un accès à l'accueil artiste (matrice A8). server/compteur/promoteur = aucun accès.
// NB : l'accès artiste-soi (« 👁 soi ») est DIFFÉRÉ — il n'existe pas de rôle d'auth « artiste » dans
// le socle actuel (StaffRole). On ne fabrique pas ce rôle ici.
export const ARTIST_CHECKIN_ROLES = [
  "admin",
  "manager",
  "security",
] as const satisfies readonly StaffRole[];

export type ArtistCheckin = {
  id: string;
  event_id: string | null;
  exploitation_date: string;
  artist_name: string;
  slot_label: string | null;
  status: CheckinStatus;
  companions: number;
  dressing_room: string | null;
  contact: string | null;
  rider_notes: string | null;
  material_notes: string | null;
  arrived_at: string | null;
  soundcheck_at: string | null;
  tech_validated_at: string | null;
  tech_validated_by: string | null;
  notes: string | null;
  auteur_username: string;
  created_at: string;
  updated_at: string;
};

// Brouillon saisi côté client (sans les champs fixés serveur : id/auteur/timestamps de ligne).
export type CheckinDraft = {
  exploitation_date: string;
  artist_name: string;
  status?: string;
  companions?: number;
  slot_label?: string | null;
  dressing_room?: string | null;
  contact?: string | null;
  rider_notes?: string | null;
  material_notes?: string | null;
  event_id?: string | null;
};

// ————————————————————————————————————————————————————————————————
// Gardes de type (vocabulaire fermé)
// ————————————————————————————————————————————————————————————————

export function isCheckinStatus(value: string): value is CheckinStatus {
  return (CHECKIN_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: CheckinStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — matrice A8 (CLUB_ONE_OS_MASTER §4.2)
//   Direction ✅ · Manager ✅➕ · Sécurité 👁 · Serveur ⛔ · Compteur ⛔ · Promoteur ⛔
// La RLS 0027 reste l'AUTORITÉ ; ces helpers ne font que refléter la même règle côté UI.
// ————————————————————————————————————————————————————————————————

// A accès à l'accueil artiste (au moins en lecture) : direction + sécurité.
export function canViewArtistCheckin(role: StaffRole): boolean {
  return (ARTIST_CHECKIN_ROLES as readonly string[]).includes(role);
}

// Peut créer/modifier une fiche d'accueil : direction (manager inclus). Miroir du WITH CHECK 0027.
export function canManageArtistCheckin(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// ————————————————————————————————————————————————————————————————
// Validation d'un brouillon (avant insert)
// ————————————————————————————————————————————————————————————————

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DraftValidation = { ok: boolean; errors: string[] };

// Le rôle est requis pour vérifier le droit de gestion (miroir du WITH CHECK).
export function validateCheckinDraft(draft: CheckinDraft, role: StaffRole): DraftValidation {
  const errors: string[] = [];
  if (!ISO_DATE.test(draft.exploitation_date)) {
    errors.push("date de soirée invalide (attendu AAAA-MM-JJ)");
  }
  if (draft.artist_name.trim().length === 0) {
    errors.push("nom de l'artiste requis");
  }
  if (draft.status !== undefined && !isCheckinStatus(draft.status)) {
    errors.push("statut d'accueil inconnu");
  }
  if (draft.companions !== undefined) {
    if (!Number.isInteger(draft.companions) || draft.companions < 0) {
      errors.push("nombre d'accompagnants invalide (entier ≥ 0)");
    }
  }
  if (!canManageArtistCheckin(role)) {
    errors.push("ce rôle ne peut pas créer de fiche d'accueil artiste");
  }
  return { ok: errors.length === 0, errors };
}

// ————————————————————————————————————————————————————————————————
// Avancement de l'accueil (jalons) — dérivé des timestamps, jamais inventé
// ————————————————————————————————————————————————————————————————

export type CheckinSteps = {
  arrived: boolean; // arrivée enregistrée
  soundcheck: boolean; // balance faite
  techValidated: boolean; // validation technique OK
};

// Les 3 jalons franchis pour une fiche (présence d'un timestamp = étape faite).
export function checkinSteps(c: Pick<ArtistCheckin, "arrived_at" | "soundcheck_at" | "tech_validated_at">): CheckinSteps {
  return {
    arrived: c.arrived_at !== null,
    soundcheck: c.soundcheck_at !== null,
    techValidated: c.tech_validated_at !== null,
  };
}

// Progression 0..3 (nombre de jalons franchis). Une fiche annulée/no-show reste à ce que ses jalons
// disent : on ne fabrique aucun avancement.
export function checkinProgress(c: Pick<ArtistCheckin, "arrived_at" | "soundcheck_at" | "tech_validated_at">): number {
  const s = checkinSteps(c);
  return (s.arrived ? 1 : 0) + (s.soundcheck ? 1 : 0) + (s.techValidated ? 1 : 0);
}

// Prête à monter en scène ? Les 3 jalons franchis et statut non terminal négatif.
export function isReadyForStage(c: ArtistCheckin): boolean {
  if (c.status === "no_show" || c.status === "annule") return false;
  return checkinProgress(c) === 3;
}

// ————————————————————————————————————————————————————————————————
// Tri du tableau d'accueil : d'abord ce qui est ACTIF (non terminal), puis par créneau/récence.
// ————————————————————————————————————————————————————————————————

export function sortForBoard(checkins: readonly ArtistCheckin[]): ArtistCheckin[] {
  return [...checkins].sort((a, b) => {
    const ta = isTerminalStatus(a.status) ? 1 : 0;
    const tb = isTerminalStatus(b.status) ? 1 : 0;
    if (ta !== tb) return ta - tb; // actifs d'abord
    // créneau connu d'abord, puis ordre alphabétique du créneau (comparaison de chaînes, aucun fuseau)
    const sa = a.slot_label ?? "";
    const sb = b.slot_label ?? "";
    if (sa !== sb) {
      if (sa === "") return 1;
      if (sb === "") return -1;
      return sa < sb ? -1 : 1;
    }
    // à créneau égal : le plus récemment saisi d'abord (chaîne ISO)
    if (a.created_at === b.created_at) return 0;
    return a.created_at < b.created_at ? 1 : -1;
  });
}

// ————————————————————————————————————————————————————————————————
// Résumé (états vides HONNÊTES : aucune fiche → zéros)
// ————————————————————————————————————————————————————————————————

export type CheckinSummary = {
  total: number;
  parStatut: Record<CheckinStatus, number>;
  arrives: number; // au moins arrivés (arrived_at non null)
  attendus: number; // statut 'attendu'
  prets: number; // isReadyForStage
  noShow: number; // statut 'no_show'
  accompagnants: number; // somme des accompagnants (entourage total attendu)
};

function zeroByStatus(): Record<CheckinStatus, number> {
  return CHECKIN_STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<CheckinStatus, number>,
  );
}

export function summarizeCheckins(checkins: readonly ArtistCheckin[]): CheckinSummary {
  const parStatut = zeroByStatus();
  let arrives = 0;
  let attendus = 0;
  let prets = 0;
  let noShow = 0;
  let accompagnants = 0;

  for (const c of checkins) {
    parStatut[c.status] += 1;
    if (c.arrived_at !== null) arrives += 1;
    if (c.status === "attendu") attendus += 1;
    if (c.status === "no_show") noShow += 1;
    if (isReadyForStage(c)) prets += 1;
    accompagnants += c.companions;
  }

  return {
    total: checkins.length,
    parStatut,
    arrives,
    attendus,
    prets,
    noShow,
    accompagnants,
  };
}

// ————————————————————————————————————————————————————————————————
// Libellés FR déterministes (aucun fuseau/locale runtime)
// ————————————————————————————————————————————————————————————————

const STATUS_LABELS: Record<CheckinStatus, string> = {
  attendu: "Attendu",
  arrive: "Arrivé",
  en_loge: "En loge",
  balance: "Balance",
  pret: "Prêt",
  en_scene: "En scène",
  termine: "Terminé",
  no_show: "No-show",
  annule: "Annulé",
};

export function checkinStatusLabel(status: CheckinStatus): string {
  return STATUS_LABELS[status];
}
