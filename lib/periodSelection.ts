// lib/periodSelection.ts — SÉLECTEUR DE PÉRIODE (fenêtre glissante vs mois calendaire précis).
// Logique PURE, aucun accès réseau — même discipline que lib/rhRollup / lib/pnlPeriode.
//
// Les panneaux de cumul (RH · coût staff, P&L de période) affichent aujourd'hui la fenêtre glissante
// fixe (ROLLUP_WINDOW_DAYS, chargée à l'ouverture de l'onglet). Ce module NE recharge rien depuis le
// réseau et NE recalcule aucun montant : il se contente de FILTRER, côté client, la liste déjà chargée
// pour cibler soit toute la fenêtre (comportement historique), soit un mois calendaire précis, avant de
// la passer aux moteurs purs (buildPeriodStaffRollup / buildPnlPeriode). Aucun montant n'est fabriqué :
// filtrer une liste vide donne une liste vide, et les moteurs restent seuls juges de l'honnêteté des
// totaux (« — » plutôt qu'un 0).
//
// RÈGLES DURES :
//   · aucune donnée fabriquée : on ne fait que RESTREINDRE la liste réellement chargée ;
//   · les mois proposés au sélecteur = ceux réellement présents dans la fenêtre (jamais un mois vide
//     inventé) ; une date illisible n'ouvre aucune option (elle serait ignorée par les moteurs de toute
//     façon) ;
//   · le choix par défaut reste la fenêtre entière → aucun changement de comportement tant que
//     l'utilisateur ne sélectionne rien.

// Clé de mois (YYYY-MM) d'une date d'exploitation ISO (YYYY-MM-DD). "" si illisible.
// (Même règle que rhRollup.monthKey / pnlPeriode.periodeMonthKey — dupliquée volontairement pour garder
// ce module sans dépendance vers les moteurs qu'il alimente.)
export function isoMonthKey(exploitationDate: string | null | undefined): string {
  return typeof exploitationDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(exploitationDate)
    ? exploitationDate.slice(0, 7)
    : "";
}

// Choix de période appliqué à un panneau de cumul.
//   · window : toute la fenêtre glissante chargée (défaut, comportement historique) ;
//   · month  : un mois calendaire précis (YYYY-MM) présent dans la fenêtre.
export type PeriodChoice = { kind: "window" } | { kind: "month"; month: string };

export const WINDOW_CHOICE: PeriodChoice = { kind: "window" };

// Mois distincts (YYYY-MM) réellement présents dans une liste de dates, triés DÉCROISSANT (le plus
// récent d'abord — ordre naturel d'un sélecteur de récap paie/P&L). Les dates illisibles sont ignorées
// (aucun mois « inconnu » proposé).
export function distinctMonths(dates: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const d of dates) {
    const mk = isoMonthKey(d);
    if (mk !== "") set.add(mk);
  }
  return [...set].sort().reverse();
}

// Applique un choix de période à une liste d'items datés (PURE, sans effet de bord).
//   · window → la liste entière (aucun filtrage) ;
//   · month  → seulement les items dont la date tombe dans le mois choisi.
// getDate extrait la date d'exploitation ISO de chaque item.
export function applyPeriodChoice<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  choice: PeriodChoice,
): T[] {
  if (choice.kind === "window") return items;
  return items.filter((item) => isoMonthKey(getDate(item)) === choice.month);
}

// Vrai si le choix cible un mois qui n'existe (plus) dans les options disponibles — utile pour retomber
// proprement sur la fenêtre entière si la fenêtre chargée a changé sous les pieds du sélecteur.
export function isChoiceStale(choice: PeriodChoice, availableMonths: string[]): boolean {
  return choice.kind === "month" && !availableMonths.includes(choice.month);
}

// Normalise un choix contre les options disponibles : un mois disparu → fenêtre entière.
export function normalizeChoice(choice: PeriodChoice, availableMonths: string[]): PeriodChoice {
  return isChoiceStale(choice, availableMonths) ? WINDOW_CHOICE : choice;
}

// ————————————————————————————————————————————————————————————————
// Libellés (déterministes, sans dépendance au fuseau/locale du navigateur)
// ————————————————————————————————————————————————————————————————

const FR_MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

// Mois « YYYY-MM » → libellé français déterministe. Renvoie la clé brute si illisible.
export function monthLabelFr(month: string): string {
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 && /^\d{4}$/.test(y) ? `${FR_MONTHS[idx]} ${y}` : month;
}

// Libellé humain d'un choix, pour l'en-tête d'un panneau de cumul.
//   · window → « les N derniers jours (fenêtre glissante) » ;
//   · month  → « mois de <mois AAAA> ».
export function periodChoiceLabel(choice: PeriodChoice, windowDays: number): string {
  return choice.kind === "window"
    ? `les ${windowDays} derniers jours (fenêtre glissante)`
    : `${monthLabelFr(choice.month)}`;
}
