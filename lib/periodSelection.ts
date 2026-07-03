// lib/periodSelection.ts — SÉLECTEUR DE PÉRIODE (fenêtre glissante · mois calendaire précis · plage
// personnalisée from/to). Logique PURE, aucun accès réseau — même discipline que lib/rhRollup / lib/pnlPeriode.
//
// Les panneaux de cumul (RH · coût staff, P&L de période) affichent la fenêtre glissante fixe
// (ROLLUP_WINDOW_DAYS, chargée à l'ouverture de l'onglet). Ce module NE recharge rien depuis le réseau
// et NE recalcule aucun montant : il se contente de FILTRER, côté client, la liste déjà chargée pour
// cibler soit toute la fenêtre (comportement historique), soit un mois calendaire précis, soit une plage
// de dates explicite, avant de la passer aux moteurs purs (buildPeriodStaffRollup / buildPnlPeriode).
// Aucun montant n'est fabriqué : filtrer une liste vide donne une liste vide, et les moteurs restent
// seuls juges de l'honnêteté des totaux (« — » plutôt qu'un 0).
//
// RÈGLES DURES :
//   · aucune donnée fabriquée : on ne fait que RESTREINDRE la liste réellement chargée ;
//   · les mois proposés au sélecteur = ceux réellement présents dans la fenêtre (jamais un mois vide
//     inventé) ; une date illisible n'ouvre aucune option (elle serait ignorée par les moteurs de toute
//     façon) ;
//   · une plage aux bornes incomplètes ou illisibles retombe sur la fenêtre entière (jamais un vide
//     fabriqué le temps que l'utilisateur saisit la seconde date) ;
//   · le choix par défaut reste la fenêtre entière → aucun changement de comportement tant que
//     l'utilisateur ne sélectionne rien.

// Forme d'une date d'exploitation ISO (YYYY-MM-DD). Une seule source pour tout le module.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Vrai si la valeur est une date ISO lisible (YYYY-MM-DD). Sert au contrôle des bornes de plage.
export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

// Clé de mois (YYYY-MM) d'une date d'exploitation ISO (YYYY-MM-DD). "" si illisible.
// (Même règle que rhRollup.monthKey / pnlPeriode.periodeMonthKey — dupliquée volontairement pour garder
// ce module sans dépendance vers les moteurs qu'il alimente.)
export function isoMonthKey(exploitationDate: string | null | undefined): string {
  return isIsoDate(exploitationDate) ? exploitationDate.slice(0, 7) : "";
}

// Choix de période appliqué à un panneau de cumul.
//   · window : toute la fenêtre glissante chargée (défaut, comportement historique) ;
//   · month  : un mois calendaire précis (YYYY-MM) présent dans la fenêtre ;
//   · range  : une plage de dates explicite [from, to] inclus (YYYY-MM-DD). Bornes tolérées inversées
//              (ordonnées par normalizeChoice) ; incomplètes → repli sur la fenêtre entière.
export type PeriodChoice =
  | { kind: "window" }
  | { kind: "month"; month: string }
  | { kind: "range"; from: string; to: string };

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

// Ordonne les deux bornes d'une plage (petite d'abord), sans muter. Tolère des bornes inversées saisies
// par l'utilisateur (« du 28 au 3 » → « du 3 au 28 »).
function orderedBounds(from: string, to: string): [string, string] {
  return from <= to ? [from, to] : [to, from];
}

// Applique un choix de période à une liste d'items datés (PURE, sans effet de bord).
//   · window → la liste entière (aucun filtrage) ;
//   · month  → seulement les items dont la date tombe dans le mois choisi ;
//   · range  → seulement les items dont la date tombe dans [from, to] inclus ; bornes incomplètes/
//              illisibles → aucun filtrage (fenêtre entière), cohérent avec normalizeChoice.
// getDate extrait la date d'exploitation ISO de chaque item.
export function applyPeriodChoice<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  choice: PeriodChoice,
): T[] {
  if (choice.kind === "window") return items;
  if (choice.kind === "month") return items.filter((item) => isoMonthKey(getDate(item)) === choice.month);
  // range
  if (!isIsoDate(choice.from) || !isIsoDate(choice.to)) return items;
  const [lo, hi] = orderedBounds(choice.from, choice.to);
  return items.filter((item) => {
    const d = getDate(item);
    return isIsoDate(d) && d >= lo && d <= hi;
  });
}

// Vrai si le choix ne peut plus s'appliquer proprement — utile pour retomber sur la fenêtre entière si
// la fenêtre chargée a changé sous les pieds du sélecteur, ou si une plage n'a pas ses deux bornes.
//   · month → périmé si le mois n'est plus dans les options disponibles ;
//   · range → périmé si une borne est manquante/illisible (plage en cours de saisie) ;
//   · window → jamais périmé.
export function isChoiceStale(choice: PeriodChoice, availableMonths: string[]): boolean {
  if (choice.kind === "month") return !availableMonths.includes(choice.month);
  if (choice.kind === "range") return !isIsoDate(choice.from) || !isIsoDate(choice.to);
  return false;
}

// Normalise un choix : un mois disparu ou une plage incomplète → fenêtre entière ; une plage aux bornes
// inversées est réordonnée (petite d'abord). Aucune mutation.
export function normalizeChoice(choice: PeriodChoice, availableMonths: string[]): PeriodChoice {
  if (isChoiceStale(choice, availableMonths)) return WINDOW_CHOICE;
  if (choice.kind === "range" && choice.from > choice.to) {
    return { kind: "range", from: choice.to, to: choice.from };
  }
  return choice;
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

// Date « YYYY-MM-DD » → libellé français déterministe (« 3 juillet 2026 »). Renvoie la valeur brute si
// illisible. Aucun new Date()/toLocaleString → aucun décalage de fuseau.
export function dateLabelFr(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${Number(d)} ${FR_MONTHS[idx]} ${y}` : iso;
}

// Libellé humain d'un choix, pour l'en-tête d'un panneau de cumul.
//   · window → « les N derniers jours (fenêtre glissante) » ;
//   · month  → « <mois AAAA> » ;
//   · range  → « du <jour mois AAAA> au <jour mois AAAA> » (bornes ordonnées).
export function periodChoiceLabel(choice: PeriodChoice, windowDays: number): string {
  if (choice.kind === "window") return `les ${windowDays} derniers jours (fenêtre glissante)`;
  if (choice.kind === "month") return `${monthLabelFr(choice.month)}`;
  const [lo, hi] = orderedBounds(choice.from, choice.to);
  return `du ${dateLabelFr(lo)} au ${dateLabelFr(hi)}`;
}
