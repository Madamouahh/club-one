// lib/rhPlanning.ts — logique PURE du module RH / Planning (B7), aucun accès réseau.
//
// Ce module transforme le planning + pointage (tables staff_members / staff_shifts, migration 0011)
// en MASSE HORAIRE puis en COÛT STAFF — la charge que le P&L par soirée (lib/pnlSoiree) attend
// honnêtement à null tant qu'elle n'est pas branchée. Rien n'est inventé :
//   · aucun salarié n'est fabriqué (la vraie liste vient du fondateur) ;
//   · le coût staff reste null tant qu'un taux horaire réel n'est pas renseigné (PII / paie) ;
//   · les heures ne sont calculées que si les horaires (prévu / pointé) existent réellement.
// L'accès Supabase reste dans app/page.tsx (comme caisse_z), ce module ne fait que valider/agréger.

import { round2 } from "./caisseZ.ts";

// ————————————————————————————————————————————————————————————————
// Modèle (miroir des tables 0011)
// ————————————————————————————————————————————————————————————————

// Types de contrat reconnus (catégories légales, pas des données inventées). null = non renseigné.
export const CONTRAT_TYPES = ["cdi", "cdd", "extra", "prestataire", "stage"] as const;
export type ContratType = (typeof CONTRAT_TYPES)[number];

// États d'un shift dans le workflow planning → pointage (structure, pas une donnée fondateur).
export const SHIFT_STATUSES = [
  "planifie",
  "confirme",
  "present",
  "absent",
  "retard",
  "annule",
] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

// Un statut compte dans la masse horaire RÉELLE (pointage) : la personne était là.
const PRESENT_STATUSES: ReadonlySet<ShiftStatus> = new Set<ShiftStatus>(["present", "retard"]);
// Un statut compte dans la masse horaire PLANIFIÉE (prévisionnel) : shift non annulé/absent.
const PLANNED_STATUSES: ReadonlySet<ShiftStatus> = new Set<ShiftStatus>([
  "planifie",
  "confirme",
  "present",
  "retard",
]);

export type StaffMember = {
  id: string;
  username: string;
  full_name: string;
  poste: string | null;
  contrat_type: ContratType | null;
  taux_horaire: number | null; // PII : null tant que le fondateur n'a pas fourni la paie
  actif: boolean;
  notes_direction?: string | null; // jamais exposé à la vue salarié
};

export type StaffShift = {
  id: string;
  staff_member_id: string;
  event_id: string | null;
  exploitation_date: string;
  poste: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: ShiftStatus;
  commentaire: string | null;
};

export function isContratType(value: string): value is ContratType {
  return (CONTRAT_TYPES as readonly string[]).includes(value);
}

export function isShiftStatus(value: string): value is ShiftStatus {
  return (SHIFT_STATUSES as readonly string[]).includes(value);
}

// ————————————————————————————————————————————————————————————————
// Calcul d'heures (les soirées club chevauchent minuit)
// ————————————————————————————————————————————————————————————————

// Durée en heures entre deux instants ISO. Retourne null si un horaire manque ou est invalide.
// Une fin antérieure au début est interprétée comme le lendemain (soirée qui passe minuit) :
// on ajoute 24 h une seule fois. Un écart aberrant (> 24 h après correction) est refusé (null).
export function hoursBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  let diffMs = e - s;
  if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000; // passage de minuit
  if (diffMs < 0 || diffMs > 24 * 60 * 60 * 1000) return null; // aberrant : on n'invente rien
  return round2(diffMs / (60 * 60 * 1000));
}

// Heures PRÉVUES d'un shift (planning), null si horaires prévus absents ou shift hors prévisionnel.
export function plannedHours(shift: StaffShift): number | null {
  if (!PLANNED_STATUSES.has(shift.status)) return null;
  return hoursBetween(shift.planned_start, shift.planned_end);
}

// Heures RÉELLES d'un shift (pointage), null si non pointé ou personne absente.
export function actualHours(shift: StaffShift): number | null {
  if (!PRESENT_STATUSES.has(shift.status)) return null;
  return hoursBetween(shift.actual_start, shift.actual_end);
}

// Coût réel d'un shift = heures réelles × taux horaire du salarié. null si l'un des deux manque
// (heures non pointées OU taux horaire non renseigné) : AUCUN coût fantôme.
export function shiftCost(shift: StaffShift, member: StaffMember | undefined): number | null {
  if (!member || member.taux_horaire == null) return null;
  const h = actualHours(shift);
  if (h == null) return null;
  return round2(h * member.taux_horaire);
}

// ————————————————————————————————————————————————————————————————
// Masse horaire par soirée (le producteur du « coût staff » du P&L)
// ————————————————————————————————————————————————————————————————

export type MasseHoraire = {
  exploitationDate: string;
  shiftsTotal: number; // nombre de shifts de la soirée (tous statuts)
  presents: number; // shifts pointés présents (present + retard)
  absents: number; // shifts marqués absents
  heuresPlanifiees: number; // somme des heures prévues (0 si aucun horaire prévu)
  heuresReelles: number | null; // somme des heures pointées ; null si AUCUN shift pointé
  coutStaff: number | null; // somme des coûts réels ; null si aucun coût calculable (voir dessous)
  coutComplet: boolean; // true seulement si TOUS les présents ont taux + heures → coût fiable
  presentsSansTaux: number; // présents dont le coût est incalculable (taux ou heures manquants)
};

// Agrège les shifts d'UNE soirée en masse horaire + coût staff. Le coût n'est « complet » que si
// chaque présent a un coût calculable (taux horaire ET heures pointées). Sinon coutComplet=false et
// on expose combien de présents restent sans coût — le P&L ne présentera donc pas un total tronqué
// comme définitif.
export function summarizeMasseHoraire(
  exploitationDate: string,
  shifts: StaffShift[],
  members: StaffMember[],
): MasseHoraire {
  const byId = new Map(members.map((m) => [m.id, m]));
  const nightShifts = shifts.filter((s) => s.exploitation_date === exploitationDate);

  let heuresPlanifiees = 0;
  let heuresReelles = 0;
  let anyReelle = false;
  let coutStaff = 0;
  let anyCout = false;
  let presents = 0;
  let absents = 0;
  let presentsSansTaux = 0;

  for (const shift of nightShifts) {
    const ph = plannedHours(shift);
    if (ph != null) heuresPlanifiees += ph;

    if (shift.status === "absent") absents += 1;

    if (PRESENT_STATUSES.has(shift.status)) {
      presents += 1;
      const ah = actualHours(shift);
      if (ah != null) {
        heuresReelles += ah;
        anyReelle = true;
      }
      const cost = shiftCost(shift, byId.get(shift.staff_member_id));
      if (cost != null) {
        coutStaff += cost;
        anyCout = true;
      } else {
        presentsSansTaux += 1;
      }
    }
  }

  return {
    exploitationDate,
    shiftsTotal: nightShifts.length,
    presents,
    absents,
    heuresPlanifiees: round2(heuresPlanifiees),
    heuresReelles: anyReelle ? round2(heuresReelles) : null,
    coutStaff: anyCout ? round2(coutStaff) : null,
    coutComplet: presents > 0 && presentsSansTaux === 0 && anyCout,
    presentsSansTaux,
  };
}

// ————————————————————————————————————————————————————————————————
// Indicateurs d'honnêteté (état vide)
// ————————————————————————————————————————————————————————————————

// Vrai reflet de ce que le fondateur a réellement fourni : combien de salariés, combien ont un taux
// horaire (sans quoi aucun coût staff n'est calculable). Sert à afficher un état vide honnête.
export function rhDataReady(members: StaffMember[]): {
  total: number;
  actifs: number;
  withTaux: number;
} {
  return {
    total: members.length,
    actifs: members.filter((m) => m.actif).length,
    withTaux: members.filter((m) => m.taux_horaire != null).length,
  };
}

// Projette la masse horaire d'une soirée vers la charge « staff » attendue par le P&L (pnlSoiree).
// amount reste null tant que le coût n'est pas COMPLET (au moins un présent sans taux/heures) :
// on ne branche jamais un coût partiel comme s'il était le coût staff réel de la soirée.
export function staffChargeAmount(masse: MasseHoraire): number | null {
  return masse.coutComplet ? masse.coutStaff : null;
}

// ————————————————————————————————————————————————————————————————
// Saisie (write) — validation PURE des formulaires direction (aucun accès réseau)
// La vraie garde reste la RLS 0011 (direction seule écrit). Ces fonctions ne font que
// normaliser/refuser une saisie AVANT l'insert : rien n'est fabriqué, un champ vide reste null
// (état honnête « inconnu »), jamais une valeur par défaut inventée.
// ————————————————————————————————————————————————————————————————

// Identifiant de rattachement au compte staff (current_staff_username()) : minuscules, sans espace.
const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;
// Heure d'un shift au format 24 h HH:MM (les instants absolus sont construits sur la date de soirée).
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

// Taux horaire : champ texte libre → nombre ≥ 0, ou null si vide (paie non fournie = honnête).
// Accepte la virgule décimale française. Refuse un texte non numérique ou un montant négatif.
export function parseTauxHoraire(
  raw: string | null,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw.trim() === "") return { ok: true, value: null };
  const n = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false, error: "Taux horaire invalide." };
  if (n < 0) return { ok: false, error: "Le taux horaire ne peut pas être négatif." };
  return { ok: true, value: round2(n) };
}

export type StaffMemberDraft = {
  fullName: string;
  username: string;
  poste: string | null;
  contratType: string | null;
  tauxHoraire: string | null; // texte brut du champ ; vide = taux inconnu (null honnête)
  actif: boolean;
};

export type ValidatedStaffMember = {
  full_name: string;
  username: string;
  poste: string | null;
  contrat_type: ContratType | null;
  taux_horaire: number | null;
  actif: boolean;
};

// Valide un brouillon de fiche salarié avant insert. Le nom et l'identifiant sont obligatoires
// (l'identifiant relie la fiche au compte staff pour la RLS salarié) ; tout le reste est optionnel.
export function validateStaffMemberDraft(
  draft: StaffMemberDraft,
): { ok: true; value: ValidatedStaffMember } | { ok: false; error: string } {
  const fullName = draft.fullName.trim();
  if (fullName.length < 2) return { ok: false, error: "Nom complet manquant." };

  const username = normalizeUsername(draft.username);
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: "Identifiant invalide (2–40 caractères : a-z, 0-9, . _ -)." };
  }

  const rawContrat = draft.contratType?.trim() ?? "";
  const contrat = rawContrat === "" ? null : rawContrat;
  if (contrat != null && !isContratType(contrat)) {
    return { ok: false, error: "Type de contrat inconnu." };
  }

  const taux = parseTauxHoraire(draft.tauxHoraire);
  if (!taux.ok) return taux;

  const poste = draft.poste?.trim() ? draft.poste.trim() : null;

  return {
    ok: true,
    value: { full_name: fullName, username, poste, contrat_type: contrat, taux_horaire: taux.value, actif: draft.actif },
  };
}

// Un instant absolu (ISO UTC) à partir de la date de soirée + une heure HH:MM. null si vide/invalide.
// On construit en UTC (« Z ») pour un aller-retour déterministe (indépendant du fuseau du navigateur) :
// l'heure ressaisie est celle qui a été tapée, pas une conversion locale.
export function toShiftInstant(exploitationDate: string, hhmm: string | null): string | null {
  const v = hhmm?.trim() ?? "";
  if (v === "" || !HHMM_RE.test(v)) return null;
  return `${exploitationDate}T${v}:00.000Z`;
}

// Une fin à ou avant le début = même heure le LENDEMAIN (les soirées club passent minuit).
function bumpEndPastStart(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return endIso;
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
    return new Date(e + 24 * 60 * 60 * 1000).toISOString();
  }
  return endIso;
}

export type ShiftInstants = {
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
};

// Convertit les 4 heures HH:MM d'un shift en instants absolus, en gérant le passage de minuit
// indépendamment pour la paire prévue et la paire réelle.
export function buildShiftInstants(
  exploitationDate: string,
  raw: { plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null },
): ShiftInstants {
  const ps = toShiftInstant(exploitationDate, raw.plannedStart);
  const as = toShiftInstant(exploitationDate, raw.actualStart);
  return {
    planned_start: ps,
    planned_end: bumpEndPastStart(ps, toShiftInstant(exploitationDate, raw.plannedEnd)),
    actual_start: as,
    actual_end: bumpEndPastStart(as, toShiftInstant(exploitationDate, raw.actualEnd)),
  };
}

// Heure HH:MM (UTC) d'un instant stocké, pour préremplir un champ à la réédition. "" si null.
export function instantToHHMM(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(11, 16);
}

export type ShiftDraft = {
  status: string;
  poste: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
};

export type ValidatedShift = { status: ShiftStatus; poste: string | null } & ShiftInstants;

// Valide un brouillon de shift avant upsert. On autorise un présent sans horaire réel (la masse
// horaire signalera « présent sans coût ») : c'est honnête, pas une donnée inventée. On refuse en
// revanche une fin sans début (impossible à borner) et une heure au mauvais format.
export function validateShiftDraft(
  exploitationDate: string,
  draft: ShiftDraft,
): { ok: true; value: ValidatedShift } | { ok: false; error: string } {
  if (!isShiftStatus(draft.status)) return { ok: false, error: "Statut de shift inconnu." };

  const clean = (t: string | null) => (t?.trim() ? t.trim() : null);
  const pStart = clean(draft.plannedStart);
  const pEnd = clean(draft.plannedEnd);
  const aStart = clean(draft.actualStart);
  const aEnd = clean(draft.actualEnd);

  for (const t of [pStart, pEnd, aStart, aEnd]) {
    if (t != null && !HHMM_RE.test(t)) return { ok: false, error: "Heure invalide (format attendu HH:MM)." };
  }
  if (pEnd && !pStart) return { ok: false, error: "Fin prévue sans début prévu." };
  if (aEnd && !aStart) return { ok: false, error: "Fin réelle sans début réel." };

  const instants = buildShiftInstants(exploitationDate, {
    plannedStart: pStart,
    plannedEnd: pEnd,
    actualStart: aStart,
    actualEnd: aEnd,
  });
  return { ok: true, value: { status: draft.status, poste: clean(draft.poste), ...instants } };
}
