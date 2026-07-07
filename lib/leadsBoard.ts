// lib/leadsBoard.ts — pont PUR entre la table `lead_channel_stats` (migration 0062) et le composant
// présentationnel <LeadsPipelineBoard> (via buildLeadsPipeline de lib/leadsPipeline). Aucun accès réseau,
// aucun `new Date()` / `Date.now()` : tout est déterminé par les entrées.
//
// La table stocke des lignes brutes SAISIES par canal/période/soirée. Ici on les AGRÈGE par canal pour
// nourrir le funnel du board. Principe d'honnêteté conservé bout à bout : une étape jamais mesurée reste
// NULL (« non tracké »), jamais 0 fabriqué. On ne somme QUE les valeurs mesurées ; si aucune ligne d'un
// canal n'a mesuré une étape, cette étape reste null. Idem pour la dépense.
//
// La table 0062 ne porte PAS de « valeur de résa générée » (valueCents) : sans attribution honnête d'un
// CA aux résas, le ROAS reste volontairement NON MESURABLE (buildLeadsPipeline affichera « — », jamais
// un ROI inventé). C'est cohérent avec la gouvernance : aucune API pub, aucune métrique fabriquée.

import {
  LEAD_CHANNELS,
  LEAD_STAGES,
  buildLeadsPipeline,
  type LeadChannel,
  type LeadChannelInput,
  type LeadStage,
  type LeadStageCounts,
  type LeadsPipelineView,
} from "./leadsPipeline.ts";
import type { Venue } from "./venueTables.ts";

// Ligne brute telle que retournée par supabase.from("lead_channel_stats").select("*").
export type LeadChannelStatRow = {
  id: string;
  event_id: string | null;
  channel: string;
  period_start: string | null;
  period_end: string | null;
  impressions: number | null;
  leads: number | null;
  resas_demandees: number | null;
  resas_confirmees: number | null;
  venus: number | null;
  spend_cents: number | null;
  created_by: string | null;
  created_at: string;
};

// Correspondance étape (camelCase du board) → colonne (snake_case de la table 0062).
const STAGE_DB_KEY: Record<LeadStage, keyof LeadChannelStatRow> = {
  impressions: "impressions",
  leads: "leads",
  resasDemandees: "resas_demandees",
  resasConfirmees: "resas_confirmees",
  venus: "venus",
};

const CHANNEL_SET: ReadonlySet<string> = new Set<string>(LEAD_CHANNELS);

// Garde : un `channel` inconnu (donnée corrompue / valeur hors liste fermée) est IGNORÉ plutôt que de
// fabriquer une ligne trompeuse. La contrainte CHECK de 0062 empêche normalement d'en insérer.
export function isLeadChannel(x: string): x is LeadChannel {
  return CHANNEL_SET.has(x);
}

type StageAcc = { sum: number; has: boolean };
type ChannelAcc = { stages: Record<LeadStage, StageAcc>; spendSum: number; spendHas: boolean };

function newChannelAcc(): ChannelAcc {
  const stages = {} as Record<LeadStage, StageAcc>;
  for (const s of LEAD_STAGES) stages[s] = { sum: 0, has: false };
  return { stages, spendSum: 0, spendHas: false };
}

// Agrège les lignes brutes par canal → entrées prêtes pour buildLeadsPipeline. Somme UNIQUEMENT les
// valeurs mesurées (les null ignorés, jamais comptés 0). Un canal dont aucune ligne n'a mesuré une étape
// laisse cette étape null (« non tracké »). L'ordre canonique final est rétabli par buildLeadsPipeline.
export function aggregateChannelStats(rows: readonly LeadChannelStatRow[]): LeadChannelInput[] {
  const acc = new Map<LeadChannel, ChannelAcc>();

  for (const r of rows) {
    if (!isLeadChannel(r.channel)) continue;
    let a = acc.get(r.channel);
    if (!a) {
      a = newChannelAcc();
      acc.set(r.channel, a);
    }
    for (const stage of LEAD_STAGES) {
      const v = r[STAGE_DB_KEY[stage]];
      if (typeof v === "number") {
        a.stages[stage].sum += v;
        a.stages[stage].has = true;
      }
    }
    if (typeof r.spend_cents === "number") {
      a.spendSum += r.spend_cents;
      a.spendHas = true;
    }
  }

  const out: LeadChannelInput[] = [];
  for (const [channel, a] of acc) {
    const stages: Partial<LeadStageCounts> = {};
    for (const stage of LEAD_STAGES) {
      stages[stage] = a.stages[stage].has ? a.stages[stage].sum : null;
    }
    // spentCents n'a d'effet que sur les canaux payants (buildRow force null sinon) ; on le fournit tel quel.
    out.push({ channel, stages, spentCents: a.spendHas ? a.spendSum : null });
  }
  return out;
}

// Convenance : lignes brutes + soirée active → vue complète pour <LeadsPipelineBoard>.
export function buildLeadsBoardView(
  rows: readonly LeadChannelStatRow[],
  activeEvent: { label: string; date: string; venue: Venue } | null,
): LeadsPipelineView {
  return buildLeadsPipeline({ activeEvent, channels: aggregateChannelStats(rows) });
}

// ————————————————————————————————————————————————————————————————
// Saisie : validation PURE d'un brouillon de ligne (create/edit) avant insert/update.
// ————————————————————————————————————————————————————————————————
export type LeadStatDraft = {
  channel: string;
  period_start: string | null;
  period_end: string | null;
  impressions: number | null;
  leads: number | null;
  resas_demandees: number | null;
  resas_confirmees: number | null;
  venus: number | null;
  spend_cents: number | null;
};

export type DraftCheck = { ok: true } | { ok: false; message: string };

const NUMERIC_FIELDS = [
  "impressions",
  "leads",
  "resas_demandees",
  "resas_confirmees",
  "venus",
  "spend_cents",
] as const;

export function validateLeadStatDraft(draft: LeadStatDraft): DraftCheck {
  if (!isLeadChannel(draft.channel)) {
    return { ok: false, message: "Canal invalide (hors liste des canaux d'origine)." };
  }
  for (const f of NUMERIC_FIELDS) {
    const v = draft[f];
    if (v === null) continue;
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      return { ok: false, message: `Valeur invalide pour « ${f} » : entier positif ou vide attendu.` };
    }
  }
  if (
    draft.period_start !== null &&
    draft.period_end !== null &&
    draft.period_end < draft.period_start
  ) {
    return { ok: false, message: "La fin de période ne peut pas précéder son début." };
  }
  // Refuse une ligne entièrement vide (aucune étape mesurée, aucune dépense) : rien à enregistrer.
  const hasAnyValue = NUMERIC_FIELDS.some((f) => draft[f] !== null);
  if (!hasAnyValue) {
    return { ok: false, message: "Rien à enregistrer : renseignez au moins une étape ou la dépense." };
  }
  return { ok: true };
}
