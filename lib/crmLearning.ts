// lib/crmLearning.ts — « Boucle d'apprentissage » CRM (spec MODULE_CRM_CLIENTS_VIP §148-156).
// Logique PURE, source-agnostique : AUCUN accès réseau. Le module croise deux vérités DÉJÀ
// existantes du produit — le Z de caisse (migration 0010, la vérité comptable) et les visites
// clients (guest_visits, migration 0013) — pour produire, par soirée × univers, les métriques
// d'apprentissage : CA réel, spend identifié, présents VIP, nouveaux captés, retour J+30.
//
// GARDE-FOU HONNÊTETÉ (le cœur du module, exigé par la spec) : on affiche TOUJOURS le taux de
// couverture = spend identifié / CA caisse_z. Sous ~15 % de couverture, on ne conclut PAS sur la
// soirée (la donnée table est trop partielle) — seulement sur les tables identifiées. Aucun chiffre
// n'est inventé : quand une base manque (pas de Z par univers, fenêtre J+30 non écoulée, format non
// étiqueté), le résultat est honnêtement `null` et le motif est explicite.
//
// « Sans étiquette, pas d'apprentissage » (spec) : le rollup mensuel groupe par `format` d'événement
// (genre/DJ/thème/prix). Tant que le fondateur n'a pas étiqueté ses soirées (colonne `events.format`,
// migration 0022, nullable), tout tombe dans un seul seau « non étiqueté » et le module le SIGNALE.

import { round2, type CaisseZRecord, type VenueId } from "./caisseZ.ts";

// Les univers CONCRETS (une salle réelle). "complexe" (ligne Z globale) n'est pas un univers : il
// ne peut pas être ventilé par salle, donc il ne nourrit PAS le CA réel par univers (honnêteté).
export const LEARNING_UNIVERS = ["eden", "cercle", "terminus"] as const;
export type LearningUnivers = (typeof LEARNING_UNIVERS)[number];

export function isLearningUnivers(value: string): value is LearningUnivers {
  return (LEARNING_UNIVERS as readonly string[]).includes(value);
}

// Seuil de confiance de la couverture (spec : « À 15 % de couverture on conclut sur les tables, pas
// sur la soirée »). En-dessous, la métrique CA/soirée n'est pas fiable → verdict `tables-only`.
export const COVERAGE_MIN_CONFIDENCE = 0.15;

// Fenêtre de rétention « nouveau capté » (spec : « taux de retour J+30 des nouveaux » = LA métrique).
export const RETENTION_WINDOW_DAYS = 30;

// Une visite client telle que lue depuis guest_visits (0013). Le module ne s'intéresse qu'aux
// visites CONCRÈTES (status 'seated') pour l'apprentissage ; les autres statuts sont ignorés côté
// présence, mais le champ `status` est conservé pour que l'appelant passe l'historique brut.
export type LearningVisit = {
  guest_id: string;
  exploitation_date: string; // 'YYYY-MM-DD' (la soirée, chevauche minuit — cohérent 0010/0013)
  univers: LearningUnivers;
  status: "booked" | "confirmed" | "seated" | "no_show" | "cancelled";
  spend_attributed: number | null; // dépense attribuée ; null = non identifiée (jamais 0 inventé)
};

// ————————————————————————————————————————————————————————————————
// Utilitaires de date (purs, UTC — pas de dépendance à la timezone locale)
// ————————————————————————————————————————————————————————————————

// Parse 'YYYY-MM-DD' en jours UTC (epoch-day). Retourne null si le format n'est pas exactement 10
// caractères ISO — on ne devine jamais une date malformée.
export function isoToEpochDay(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

// Nombre de jours entiers de `from` à `to` (to − from). null si l'une des dates est invalide.
export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = isoToEpochDay(fromIso);
  const b = isoToEpochDay(toIso);
  if (a == null || b == null) return null;
  return b - a;
}

function cellKey(date: string, univers: LearningUnivers): string {
  return `${date}|${univers}`;
}

// ————————————————————————————————————————————————————————————————
// Métriques par soirée × univers
// ————————————————————————————————————————————————————————————————

// Verdict de couverture — ce qu'on s'AUTORISE à conclure vu la part de CA identifiée par table.
//   'no-data'     : aucune base (pas de Z par univers) → rien n'est conclu.
//   'tables-only' : couverture < seuil → on ne conclut que sur les tables identifiées.
//   'confident'   : couverture ≥ seuil → la lecture par soirée est exploitable.
export type CoverageVerdict = "no-data" | "tables-only" | "confident";

export type RetentionJ30 = {
  eligible: number; // nouveaux dont la fenêtre J+30 est écoulée (date + 30 ≤ today)
  returned: number; // parmi les éligibles, ceux revenus (≥1 seated dans (date, date+30])
  pending: number; // nouveaux dont la fenêtre n'est pas encore écoulée (verdict différé)
  rate: number | null; // returned / eligible ; null si aucun éligible (jamais un 0 trompeur)
};

export type SoireeUniversMetrics = {
  exploitationDate: string;
  univers: LearningUnivers;
  format: string | null; // étiquette de programmation (events.format) ; null = non étiqueté
  caReel: number | null; // ca_ttc du Z pour (date, univers) ; null = pas de Z par univers
  spendIdentifie: number; // Σ spend_attributed des seated identifiés (date, univers)
  visitsSeated: number; // nb de présences (seated) ce soir-là dans cette salle
  visitsSpendIdentified: number; // nb de seated avec un spend renseigné (≤ visitsSeated)
  nbNouveaux: number; // clients dont la 1re présence de l'histoire tombe ici
  retention: RetentionJ30; // retour J+30 des nouveaux captés ici
  coverage: number | null; // spendIdentifie / caReel ; null si caReel absent/0
  coverageVerdict: CoverageVerdict;
};

export type BuildLearningInput = {
  caisseRecords: CaisseZRecord[]; // toutes les lignes Z de la période étudiée
  visits: LearningVisit[]; // TOUT l'historique seated pertinent (pour dater les 1res venues)
  today: string; // 'YYYY-MM-DD' — borne d'éligibilité de la fenêtre J+30 (jamais Date.now ici)
  // Résout l'étiquette de programmation d'une soirée × univers (events.format). Optionnel :
  // absent ⇒ tout est « non étiqueté » (état honnête tant que le fondateur n'a pas étiqueté).
  formatFor?: (date: string, univers: LearningUnivers) => string | null;
};

// Index CA réel par (date, univers) à partir des lignes Z. Seules les lignes d'un univers concret
// comptent (eden/cercle/terminus) ; la ligne 'complexe' est ignorée (non ventilable → honnêteté).
function caReelIndex(records: CaisseZRecord[]): Map<string, number> {
  const idx = new Map<string, number>();
  for (const r of records) {
    if (!isLearningUnivers(r.venue as VenueId)) continue;
    const key = cellKey(r.exploitation_date, r.venue as LearningUnivers);
    idx.set(key, round2((idx.get(key) ?? 0) + (r.ca_ttc || 0)));
  }
  return idx;
}

// Première présence (seated) de chaque client dans TOUT l'historique fourni. Détermine où un client
// est « nouveau capté ». Départage : date la plus ancienne, puis ordre des univers (déterministe) —
// un client n'est nouveau QUE dans une seule cellule (jamais double-compté).
function firstSeatedCell(visits: LearningVisit[]): Map<string, string> {
  const best = new Map<string, { date: string; univers: LearningUnivers }>();
  for (const v of visits) {
    if (v.status !== "seated") continue;
    const cur = best.get(v.guest_id);
    if (
      !cur ||
      v.exploitation_date < cur.date ||
      (v.exploitation_date === cur.date &&
        LEARNING_UNIVERS.indexOf(v.univers) < LEARNING_UNIVERS.indexOf(cur.univers))
    ) {
      best.set(v.guest_id, { date: v.exploitation_date, univers: v.univers });
    }
  }
  const cell = new Map<string, string>();
  for (const [guestId, { date, univers }] of best) cell.set(guestId, cellKey(date, univers));
  return cell;
}

function coverageVerdict(coverage: number | null): CoverageVerdict {
  if (coverage == null) return "no-data";
  return coverage >= COVERAGE_MIN_CONFIDENCE ? "confident" : "tables-only";
}

// Calcule le retour J+30 des clients captés dans une cellule. `capturedGuestIds` = ceux dont la 1re
// venue est cette cellule. Un client est « revenu » s'il a ≥1 seated dans (date, date+30]. Éligible
// seulement si la fenêtre est écoulée (date + 30 ≤ today) — sinon `pending` (verdict différé).
function retentionForCell(
  date: string,
  capturedGuestIds: string[],
  seatedByGuest: Map<string, string[]>,
  today: string,
): RetentionJ30 {
  const windowElapsed = (() => {
    const d = daysBetween(date, today);
    return d != null && d >= RETENTION_WINDOW_DAYS;
  })();

  let eligible = 0;
  let returned = 0;
  let pending = 0;
  for (const guestId of capturedGuestIds) {
    if (!windowElapsed) {
      pending += 1;
      continue;
    }
    eligible += 1;
    const dates = seatedByGuest.get(guestId) ?? [];
    const came = dates.some((d) => {
      const delta = daysBetween(date, d);
      return delta != null && delta > 0 && delta <= RETENTION_WINDOW_DAYS;
    });
    if (came) returned += 1;
  }
  return { eligible, returned, pending, rate: eligible > 0 ? round2(returned / eligible) : null };
}

// Construit les métriques d'apprentissage par soirée × univers. Ne fabrique JAMAIS une valeur : une
// cellule n'est émise que si elle a une réalité (un Z par univers OU au moins une présence seated).
export function buildSoireeUniversMetrics(input: BuildLearningInput): SoireeUniversMetrics[] {
  const caIdx = caReelIndex(input.caisseRecords);
  const firstCell = firstSeatedCell(input.visits);

  // Dates seated par client (pour la rétention).
  const seatedByGuest = new Map<string, string[]>();
  for (const v of input.visits) {
    if (v.status !== "seated") continue;
    const arr = seatedByGuest.get(v.guest_id) ?? [];
    arr.push(v.exploitation_date);
    seatedByGuest.set(v.guest_id, arr);
  }

  // Agrégats par cellule à partir des seated.
  type Agg = {
    spend: number;
    seated: number;
    withSpend: number;
    captured: string[];
  };
  const cells = new Map<string, Agg>();
  const ensure = (key: string): Agg => {
    let a = cells.get(key);
    if (!a) {
      a = { spend: 0, seated: 0, withSpend: 0, captured: [] };
      cells.set(key, a);
    }
    return a;
  };

  for (const v of input.visits) {
    if (v.status !== "seated") continue;
    const key = cellKey(v.exploitation_date, v.univers);
    const a = ensure(key);
    a.seated += 1;
    if (v.spend_attributed != null) {
      a.spend = round2(a.spend + v.spend_attributed);
      a.withSpend += 1;
    }
    if (firstCell.get(v.guest_id) === key) a.captured.push(v.guest_id);
  }

  // Toute cellule ayant un Z par univers mais aucune présence doit exister aussi (CA sans table
  // identifiée = couverture 0 %, information honnête et importante).
  for (const key of caIdx.keys()) if (!cells.has(key)) ensure(key);

  const out: SoireeUniversMetrics[] = [];
  for (const [key, a] of cells) {
    const [date, universRaw] = key.split("|");
    const univers = universRaw as LearningUnivers;
    const caReel = caIdx.get(key) ?? null;
    const coverage = caReel != null && caReel > 0 ? round2(a.spend / caReel) : null;
    out.push({
      exploitationDate: date,
      univers,
      format: input.formatFor?.(date, univers) ?? null,
      caReel,
      spendIdentifie: a.spend,
      visitsSeated: a.seated,
      visitsSpendIdentified: a.withSpend,
      nbNouveaux: a.captured.length,
      retention: retentionForCell(date, a.captured, seatedByGuest, input.today),
      coverage,
      coverageVerdict: coverageVerdict(coverage),
    });
  }

  // Ordre stable : date croissante, puis univers dans l'ordre canonique.
  out.sort(
    (x, y) =>
      x.exploitationDate.localeCompare(y.exploitationDate) ||
      LEARNING_UNIVERS.indexOf(x.univers) - LEARNING_UNIVERS.indexOf(y.univers),
  );
  return out;
}

// ————————————————————————————————————————————————————————————————
// Rollup mensuel par format (sortie mensuelle de la spec : décide la programmation du mois suivant)
// ————————————————————————————————————————————————————————————————

// Étiquette de format non renseignée : un seul seau explicite (« sans étiquette, pas d'apprentissage »).
export const FORMAT_UNLABELED = "__non_etiquete__";

export type FormatMonthlyRollup = {
  month: string; // 'YYYY-MM'
  format: string; // valeur de events.format ; FORMAT_UNLABELED si non étiqueté
  labeled: boolean; // false = seau « non étiqueté » (signalé à l'utilisateur)
  nbSoirees: number; // nb de cellules soirée × univers agrégées
  caMoyen: number | null; // moyenne du CA réel sur les cellules qui en ont un ; null sinon
  caCellsCount: number; // nb de cellules ayant un CA réel (base de caMoyen — transparence)
  vipTotal: number; // Σ présences seated
  vipMoyen: number | null; // vipTotal / nbSoirees
  nouveauxTotal: number; // Σ nouveaux captés
  retenus30Total: number; // Σ nouveaux revenus J+30 (parmi éligibles)
  retention30Eligible: number; // Σ éligibles (dénominateur honnête)
  retention30Rate: number | null; // retenus30Total / retention30Eligible ; null si 0 éligible
  couvertureMoyenne: number | null; // moyenne de la couverture sur cellules mesurables ; null sinon
  couvertureCellsCount: number; // nb de cellules avec couverture mesurable (base de la moyenne)
};

function monthOf(date: string): string {
  return date.slice(0, 7);
}

// Agrège les métriques soirée × univers en tableau mensuel par format. Chaque moyenne expose SA base
// (caCellsCount, couvertureCellsCount, retention30Eligible) : on ne masque jamais la partialité.
export function buildFormatMonthlyRollup(cells: SoireeUniversMetrics[]): FormatMonthlyRollup[] {
  type Acc = {
    nbSoirees: number;
    caSum: number;
    caCells: number;
    vipTotal: number;
    nouveauxTotal: number;
    retenus: number;
    eligible: number;
    covSum: number;
    covCells: number;
  };
  const groups = new Map<string, Acc>();
  const ensure = (key: string): Acc => {
    let a = groups.get(key);
    if (!a) {
      a = {
        nbSoirees: 0,
        caSum: 0,
        caCells: 0,
        vipTotal: 0,
        nouveauxTotal: 0,
        retenus: 0,
        eligible: 0,
        covSum: 0,
        covCells: 0,
      };
      groups.set(key, a);
    }
    return a;
  };

  for (const c of cells) {
    const format = c.format ?? FORMAT_UNLABELED;
    const key = `${monthOf(c.exploitationDate)}|${format}`;
    const a = ensure(key);
    a.nbSoirees += 1;
    if (c.caReel != null) {
      a.caSum = round2(a.caSum + c.caReel);
      a.caCells += 1;
    }
    a.vipTotal += c.visitsSeated;
    a.nouveauxTotal += c.nbNouveaux;
    a.retenus += c.retention.returned;
    a.eligible += c.retention.eligible;
    if (c.coverage != null) {
      a.covSum = round2(a.covSum + c.coverage);
      a.covCells += 1;
    }
  }

  const out: FormatMonthlyRollup[] = [];
  for (const [key, a] of groups) {
    const [month, format] = key.split("|");
    out.push({
      month,
      format,
      labeled: format !== FORMAT_UNLABELED,
      nbSoirees: a.nbSoirees,
      caMoyen: a.caCells > 0 ? round2(a.caSum / a.caCells) : null,
      caCellsCount: a.caCells,
      vipTotal: a.vipTotal,
      vipMoyen: a.nbSoirees > 0 ? round2(a.vipTotal / a.nbSoirees) : null,
      nouveauxTotal: a.nouveauxTotal,
      retenus30Total: a.retenus,
      retention30Eligible: a.eligible,
      retention30Rate: a.eligible > 0 ? round2(a.retenus / a.eligible) : null,
      couvertureMoyenne: a.covCells > 0 ? round2(a.covSum / a.covCells) : null,
      couvertureCellsCount: a.covCells,
    });
  }

  out.sort((x, y) => x.month.localeCompare(y.month) || x.format.localeCompare(y.format));
  return out;
}

// ————————————————————————————————————————————————————————————————
// Synthèse d'honnêteté globale (bandeau à afficher en tête de l'écran)
// ————————————————————————————————————————————————————————————————

export type LearningHonesty = {
  cellsTotal: number;
  cellsWithCoverage: number; // cellules où la couverture est mesurable (Z par univers présent)
  cellsConfident: number; // cellules ≥ seuil (lecture soirée exploitable)
  cellsTablesOnly: number; // cellules mesurées mais sous le seuil
  cellsUnlabeled: number; // cellules sans format (apprentissage mensuel impossible)
  coverageGlobal: number | null; // Σ spend identifié / Σ CA réel (sur cellules mesurables)
  ready: boolean; // true seulement si ≥1 cellule confiante ET ≥1 cellule étiquetée
};

// Résume l'état d'honnêteté de l'apprentissage : combien de cellules sont exploitables, combien
// restent « tables-only » (couverture trop faible), combien ne sont pas étiquetées. `ready`=false
// dit franchement « pas encore de quoi apprendre » plutôt que d'afficher un faux insight.
export function summarizeLearningHonesty(cells: SoireeUniversMetrics[]): LearningHonesty {
  let cellsWithCoverage = 0;
  let cellsConfident = 0;
  let cellsTablesOnly = 0;
  let cellsUnlabeled = 0;
  let spendSum = 0;
  let caSum = 0;
  for (const c of cells) {
    if (c.coverage != null) {
      cellsWithCoverage += 1;
      spendSum = round2(spendSum + c.spendIdentifie);
      caSum = round2(caSum + (c.caReel ?? 0));
      if (c.coverageVerdict === "confident") cellsConfident += 1;
      else cellsTablesOnly += 1;
    }
    if (c.format == null) cellsUnlabeled += 1;
  }
  return {
    cellsTotal: cells.length,
    cellsWithCoverage,
    cellsConfident,
    cellsTablesOnly,
    cellsUnlabeled,
    coverageGlobal: caSum > 0 ? round2(spendSum / caSum) : null,
    ready: cellsConfident > 0 && cells.some((c) => c.format != null),
  };
}
