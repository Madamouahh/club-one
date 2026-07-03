// lib/leadsPipeline.ts — logique PURE du module LEADS & TUNNEL COMMERCIAL (B12), aucun accès réseau.
//
// B12 est un écran DIRECTION du plan maître (CLUB_ONE_OS_MASTER §2 « B12. LEADS & TUNNEL
// COMMERCIAL », matrice §3.1 : admin ✅➕ / manager 👁 / tout le reste ⛔). Sa mission (plan §3.2) :
//   · A4 (QR) + B11 (promoteurs) → B12 (leads) → B9 (CRM) : l'origine des entrées TRACE le lead,
//     nourrit le CRM et mesure la pub ;
//   · « chaque euro de pub est rattaché à des résas trackées, SINON on coupe » — B12 ferme la
//     boucle dépense → valeur de résa générée, par CANAL.
//
// Ce module N'EST PAS un moteur d'achat : il ne déclenche AUCUNE dépense. Les paliers pub
// (300 / 600 / 1200 €, plan §2) sont des montants que la DIRECTION saisit après un GO fondateur
// explicite ; l'app ne fait que les rapporter et calculer le retour honnêtement.
//
// TROIS principes DURS (gouvernance Club One) :
//   1. AUCUNE MÉTRIQUE FABRIQUÉE. Une étape non mesurée vaut `null` (« non tracké »), JAMAIS 0.
//      Un taux ou un coût n'est calculé QUE si ses deux extrémités sont mesurées et le
//      dénominateur > 0 ; sinon il reste `null` (« non mesurable »). On ne rassure jamais avec un
//      faux zéro ni un ROI inventé.
//   2. LA DÉPENSE VIENT DU FONDATEUR. Aucune dépense n'est supposée : `spentCents = null` tant que
//      la direction n'a rien saisi. Un palier n'existe qu'après GO fondateur (jamais auto-appliqué).
//   3. « SINON ON COUPE ». Un canal payant dont la valeur générée est inférieure à la dépense est
//      marqué « à couper » — l'app aide à arrêter une pub non rentable, jamais à la pousser.
//
// PURETÉ : aucun `new Date()` / `Date.now()` — tout est déterminé par les entrées.

import type { StaffRole } from "./permissions.ts";
import type { Venue } from "./venueTables.ts";

// ————————————————————————————————————————————————————————————————
// Gardes de rôle — B12 = écran DIRECTION (matrice plan §3.1)
// ————————————————————————————————————————————————————————————————
//
// admin ✅➕ (voit ET pilote) · manager 👁 (voit seulement) · serveur/sécurité/compteur/promoteur ⛔.
// Ce n'est PAS une sécurité en soi (B12 agrège des signaux déjà protégés par la RLS de chaque
// source) : ces prédicats reflètent le périmètre direction côté UI.
export function canViewLeads(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}

// Seul l'admin peut PILOTER le tunnel (saisir une dépense/palier après GO fondateur). Le manager
// consulte sans agir. Miroir de la colonne ✅➕ (admin) vs 👁 (manager) de la matrice B12.
export function canManageLeads(role: StaffRole): boolean {
  return role === "admin";
}

// ————————————————————————————————————————————————————————————————
// Canaux d'origine — liste ORDONNÉE, miroir des sources traçant un lead au plan maître.
// (A4 QR · B11 promoteurs · pub payante · Google Business · lien direct · base historique OctoTable)
// ————————————————————————————————————————————————————————————————
export const LEAD_CHANNELS = [
  "qr",
  "promoteur",
  "campagne",
  "google_business",
  "direct",
  "import",
] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

const CHANNEL_TITLES: Record<LeadChannel, string> = {
  qr: "QR soirée (A4)",
  promoteur: "Promoteurs (B11)",
  campagne: "Pub payante (Meta / Google Ads)",
  google_business: "Google Business (SEO local)",
  direct: "Lien direct / bouche-à-oreille",
  import: "Base historique (OctoTable)",
};

export function leadChannelTitle(channel: LeadChannel): string {
  return CHANNEL_TITLES[channel];
}

// Seuls les canaux PAYANTS peuvent porter une dépense/palier. Les autres sont gratuits :
// la notion de coût par lead / ROAS ne s'y applique pas (rentabilité « gratuit »).
const PAID_CHANNELS: ReadonlySet<LeadChannel> = new Set<LeadChannel>(["campagne"]);

export function isPaidChannel(channel: LeadChannel): boolean {
  return PAID_CHANNELS.has(channel);
}

// Paliers pub validés par le fondateur (plan §2). Un palier n'est jamais auto-appliqué.
export const LEAD_PALIERS = [300, 600, 1200] as const;
export type LeadPalier = (typeof LEAD_PALIERS)[number];

export function isValidPalier(value: number): value is LeadPalier {
  return (LEAD_PALIERS as readonly number[]).includes(value);
}

// Seuil de ROAS (valeur de résa générée / dépense) au-delà duquel un canal payant est « rentable ».
// En deçà de 1 : la pub coûte plus qu'elle ne rapporte → « à couper ». Entre les deux : « à surveiller ».
const ROAS_RENTABLE = 2;

// ————————————————————————————————————————————————————————————————
// Étapes du tunnel — chacune MESURÉE (number) ou NON TRACKÉE (null). null ≠ 0.
// ————————————————————————————————————————————————————————————————
//
//   impressions  — vues / scans / clics (souvent non tracké hors pub → null honnête)
//   leads        — contacts captés (a laissé des coordonnées / demandé une résa)
//   resasDemandees   — demandes de résa issues de ce canal (branché sur B10)
//   resasConfirmees  — résas confirmées (conversion)
//   venus        — entrées effectives rattachées (via QR porte A4)
export type LeadStage =
  | "impressions"
  | "leads"
  | "resasDemandees"
  | "resasConfirmees"
  | "venus";

export type LeadStageCounts = Record<LeadStage, number | null>;

export const LEAD_STAGES: readonly LeadStage[] = [
  "impressions",
  "leads",
  "resasDemandees",
  "resasConfirmees",
  "venus",
];

const STAGE_TITLES: Record<LeadStage, string> = {
  impressions: "Impressions",
  leads: "Leads captés",
  resasDemandees: "Résas demandées",
  resasConfirmees: "Résas confirmées",
  venus: "Entrées",
};

export function leadStageTitle(stage: LeadStage): string {
  return STAGE_TITLES[stage];
}

// ————————————————————————————————————————————————————————————————
// Entrée — chaque canal fourni est traité ; un canal absent reste « non tracké » honnête.
// ————————————————————————————————————————————————————————————————
export type LeadChannelInput = {
  channel: LeadChannel;
  // Étapes mesurées. Les clés absentes valent `null` (non tracké), jamais 0.
  stages?: Partial<LeadStageCounts> | null;
  // Dépense pub RÉELLE saisie par la direction (cents). null = non renseignée. Ignorée si canal gratuit.
  spentCents?: number | null;
  // Palier validé par le fondateur (GO requis). null = aucun palier engagé. Ignoré si canal gratuit.
  palier?: LeadPalier | null;
  // Valeur de résa attribuée à ce canal (cents). null = non mesurée. Sert au calcul du ROAS.
  valueCents?: number | null;
};

export type LeadsPipelineInput = {
  activeEvent: { label: string; date: string; venue: Venue } | null;
  channels: LeadChannelInput[];
};

// ————————————————————————————————————————————————————————————————
// Sortie
// ————————————————————————————————————————————————————————————————
export const LEAD_RENTABILITES = [
  "rentable",
  "a_surveiller",
  "a_couper",
  "non_mesurable",
  "gratuit",
] as const;
export type LeadRentabilite = (typeof LEAD_RENTABILITES)[number];

const RENTABILITE_LABELS: Record<LeadRentabilite, string> = {
  rentable: "Rentable",
  a_surveiller: "À surveiller",
  a_couper: "À couper",
  non_mesurable: "Non mesurable",
  gratuit: "Gratuit",
};

export function leadRentabiliteLabel(r: LeadRentabilite): string {
  return RENTABILITE_LABELS[r];
}

export type LeadChannelRow = {
  channel: LeadChannel;
  title: string;
  paid: boolean;
  tracked: boolean; // au moins une étape mesurée
  stages: LeadStageCounts; // valeurs mesurées ou null (non tracké)
  // Conversions entre étapes MESURÉES uniquement (null si une extrémité non mesurée ou dénom. ≤ 0)
  tauxLeadVersResa: number | null; // resasConfirmees / leads
  tauxResaVersVenu: number | null; // venus / resasConfirmees
  // Retour sur dépense (canaux payants seulement ; null si dépense/valeur non renseignée)
  spentCents: number | null;
  palier: LeadPalier | null;
  valueCents: number | null;
  coutParLeadCents: number | null; // spentCents / leads
  coutParResaCents: number | null; // spentCents / resasConfirmees
  roas: number | null; // valueCents / spentCents
  rentabilite: LeadRentabilite;
};

export type LeadsPipelineTotals = {
  leads: number; // somme des leads MESURÉS (les null ignorés)
  resasConfirmees: number;
  venus: number;
  spentCents: number; // somme des dépenses renseignées
  valueCents: number; // somme des valeurs attribuées
  // Honnêteté de complétude : un canal payant sans dépense/valeur rend l'agrégat PARTIEL.
  spendComplete: boolean;
  valueComplete: boolean;
};

export type LeadsPipelineView = {
  event: { label: string; date: string; venue: Venue } | null;
  rows: LeadChannelRow[]; // dans l'ordre de LEAD_CHANNELS
  totals: LeadsPipelineTotals;
  // ROAS global = valeur totale / dépense totale. null si dépense nulle OU incomplète (jamais fabriqué).
  roasGlobal: number | null;
  // Honnêteté de couverture : combien de canaux ont AU MOINS une étape mesurée.
  coverage: { tracked: number; total: number };
  // Nb de canaux payants marqués « à couper » (dépense > valeur générée).
  aCouperCount: number;
};

// ————————————————————————————————————————————————————————————————
// Helpers purs
// ————————————————————————————————————————————————————————————————

// Un ratio n'existe QUE si numérateur et dénominateur sont mesurés et dénominateur > 0.
// Toute imprécision → null (« non mesurable »), jamais 0 fabriqué.
function ratio(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den <= 0) return null;
  return num / den;
}

// Somme des valeurs mesurées d'une étape (les null sont ignorés, pas comptés 0).
function sumMeasured(rows: LeadChannelRow[], stage: LeadStage): number {
  let total = 0;
  for (const r of rows) {
    const v = r.stages[stage];
    if (v !== null) total += v;
  }
  return total;
}

function normalizeStages(input: Partial<LeadStageCounts> | null | undefined): LeadStageCounts {
  const out = {} as LeadStageCounts;
  for (const stage of LEAD_STAGES) {
    const v = input ? input[stage] : undefined;
    // undefined (clé absente) ET null → non tracké. Un nombre → mesuré.
    out[stage] = typeof v === "number" ? v : null;
  }
  return out;
}

function rentabiliteOf(
  paid: boolean,
  spentCents: number | null,
  roas: number | null,
): LeadRentabilite {
  if (!paid) return "gratuit"; // pas de dépense → la notion de rentabilité ne s'applique pas
  if (spentCents === null || spentCents <= 0 || roas === null) return "non_mesurable";
  if (roas < 1) return "a_couper";
  if (roas < ROAS_RENTABLE) return "a_surveiller";
  return "rentable";
}

function buildRow(input: LeadChannelInput): LeadChannelRow {
  const channel = input.channel;
  const paid = isPaidChannel(channel);
  const stages = normalizeStages(input.stages);
  const tracked = LEAD_STAGES.some((s) => stages[s] !== null);

  // Dépense / palier / valeur : n'existent que pour un canal payant (sinon forcés null).
  const spentCents = paid ? (input.spentCents ?? null) : null;
  const palier = paid ? (input.palier ?? null) : null;
  const valueCents = paid ? (input.valueCents ?? null) : null;

  const coutParLeadCents = spentCents === null ? null : ratio(spentCents, stages.leads);
  const coutParResaCents = spentCents === null ? null : ratio(spentCents, stages.resasConfirmees);
  const roas = spentCents === null || valueCents === null ? null : ratio(valueCents, spentCents);

  return {
    channel,
    title: CHANNEL_TITLES[channel],
    paid,
    tracked,
    stages,
    tauxLeadVersResa: ratio(stages.resasConfirmees, stages.leads),
    tauxResaVersVenu: ratio(stages.venus, stages.resasConfirmees),
    spentCents,
    palier,
    valueCents,
    coutParLeadCents,
    coutParResaCents,
    roas,
    rentabilite: rentabiliteOf(paid, spentCents, roas),
  };
}

// ————————————————————————————————————————————————————————————————
// Construction de la vue
// ————————————————————————————————————————————————————————————————
export function buildLeadsPipeline(input: LeadsPipelineInput): LeadsPipelineView {
  // Indexer les entrées par canal, puis assembler dans l'ordre canonique. Un canal non fourni
  // devient une ligne « non trackée » honnête (toutes étapes null).
  const byChannel = new Map<LeadChannel, LeadChannelInput>();
  for (const c of input.channels) {
    // Le dernier gagne si un canal est fourni deux fois (pas de fusion silencieuse trompeuse).
    byChannel.set(c.channel, c);
  }

  const rows: LeadChannelRow[] = LEAD_CHANNELS.map((channel) =>
    buildRow(byChannel.get(channel) ?? { channel }),
  );

  // Totaux : uniquement les valeurs mesurées (null ignoré, jamais compté 0).
  const leads = sumMeasured(rows, "leads");
  const resasConfirmees = sumMeasured(rows, "resasConfirmees");
  const venus = sumMeasured(rows, "venus");

  let spentCents = 0;
  let valueCents = 0;
  let spendComplete = true;
  let valueComplete = true;
  for (const r of rows) {
    if (!r.paid) continue; // seuls les canaux payants comptent pour la complétude dépense/valeur
    // Un canal payant simplement PRÉSENT dans la liste canonique mais jamais utilisé (aucune étape
    // mesurée, aucune dépense, aucune valeur) n'est pas une lacune de saisie : on l'ignore. Seul un
    // canal payant ACTIF (tracké ou avec une dépense/valeur amorcée) doit être complété honnêtement.
    const active = r.tracked || r.spentCents !== null || r.valueCents !== null;
    if (!active) continue;
    if (r.spentCents === null) spendComplete = false;
    else spentCents += r.spentCents;
    if (r.valueCents === null) valueComplete = false;
    else valueCents += r.valueCents;
  }
  // Aucun canal payant actif ⇒ rien à compléter (dépense/valeur triviallement « complètes » à 0).

  const tracked = rows.filter((r) => r.tracked).length;
  const aCouperCount = rows.filter((r) => r.rentabilite === "a_couper").length;

  // ROAS global : refuse tout chiffre trompeur. null si dépense nulle OU incomplète OU valeur incomplète.
  const roasGlobal =
    spendComplete && valueComplete && spentCents > 0 ? valueCents / spentCents : null;

  return {
    event: input.activeEvent,
    rows,
    totals: { leads, resasConfirmees, venus, spentCents, valueCents, spendComplete, valueComplete },
    roasGlobal,
    coverage: { tracked, total: LEAD_CHANNELS.length },
    aCouperCount,
  };
}

// ————————————————————————————————————————————————————————————————
// Formatage FR déterministe (aucune dépendance au fuseau/à l'horloge)
// ————————————————————————————————————————————————————————————————
export function formatEurosFromCents(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

// Un taux (0..1) en pourcentage entier ; null → « — » (non mesurable, jamais 0 fabriqué).
export function formatTaux(taux: number | null): string {
  if (taux === null) return "—";
  return `${Math.round(taux * 100)} %`;
}

// ROAS en « ×N.N » ; null → « — ».
export function formatRoas(roas: number | null): string {
  if (roas === null) return "—";
  return `×${roas.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}
