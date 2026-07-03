"use client";

// app/plan-salle-editor-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (chunk 3 PLAN_SALLE_EDEN : ÉDITER TABLE).
//
// Raison d'être (mise à jour V2 — 2026-07-03) : le fondateur a désormais donné TOUTES les capacités et
// types définitifs du plan Eden (EDEN_SEED_V2 / migration 0031). La collecte des « 26 capacités à
// confirmer » du screenshot (V1, EDEN_SEED / 0024) est donc CLOSE : il n'y a plus rien à deviner. Ce
// banc bascule sur le plan V2 et change de rôle : il sert maintenant à CONFIRMER ou AJUSTER les
// capacités du plan définitif (une correction ponctuelle de la direction), pas à combler des trous.
// Les tables DEBOUT (kind = « haute ») ont une capacité NULL par NATURE (groupe sans capacité assise) —
// ce n'est PAS « à confirmer » : la progression ne compte donc que les tables ASSISES.
//
// Périmètre volontairement étroit et SÛR (même discipline que app/plan-salle-preview de la S51) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — le `onSave` du composant écrit dans un BROUILLON LOCAL en
//     mémoire, jamais en base. La persistance réelle (UPDATE venue_tables, RLS admin/manager) reste un
//     chunk SÉPARÉ à faire relire, LABO d'abord ;
//   · AUCUNE donnée inventée : le plan de départ vient d'EDEN_SEED_V2 (capacités données par le
//     fondateur) ; l'export ne contient QUE les AJUSTEMENTS qu'un humain a réellement tapés ;
//   · l'écran produit un ARTEFACT JSON à transmettre au fondateur / à la revue, pas une écriture.
//
// Ce n'est pas l'écran opérationnel : c'est le banc de confirmation / ajustement du plan Eden V2.

import { useMemo, useState } from "react";

import { VenueTableEditor } from "@/components/VenueTableEditor";
import type { VenueTableUpdate } from "@/lib/venueTableEditor";
import { EDEN_SEED_V2, seedToPct, type VenueTable } from "@/lib/venueTables";
import {
  buildCapacityExport,
  capacityExportJson,
  capacityFillProgress,
  diffCapacities,
  summarizeCapacityDiffs,
} from "@/lib/venueCapacityExport";

// Les 44 tables Eden du plan V2 « proprement » (types/capacités définitifs fondateur — mêmes maths
// %→SVG que la migration 0031) — plan d'ORIGINE de ce banc.
const EDEN_ORIGINAL: VenueTable[] = EDEN_SEED_V2.map((entry) => {
  const { x_pct, y_pct } = seedToPct(entry);
  return {
    id: `eden-${entry.label}`,
    venue: "eden",
    label: entry.label,
    x_pct,
    y_pct,
    shape: entry.shape,
    standing: entry.standing,
    capacity: entry.cap,
    active: true,
    kind: entry.kind,
  };
});

export default function PlanSalleEditorPreviewPage() {
  // Brouillon LOCAL en mémoire : point de départ = le seed, muté par les « Enregistrer » du composant.
  // Rien ne quitte le navigateur ; aucun réseau. Le `key` par id préserve l'état de chaque ligne au tri.
  const [tables, setTables] = useState<VenueTable[]>(EDEN_ORIGINAL);
  const [copied, setCopied] = useState(false);

  // onSave LOCAL : applique le patch (capacité / debout / actif) au brouillon en mémoire. Pas de base.
  async function handleLocalSave(id: string, patch: VenueTableUpdate) {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setCopied(false);
  }

  const diffs = useMemo(() => diffCapacities(EDEN_ORIGINAL, tables), [tables]);
  const summary = useMemo(() => summarizeCapacityDiffs(diffs), [diffs]);
  // Progression calculée sur les tables ASSISES uniquement : les tables debout (kind « haute ») ont une
  // capacité NULL par nature (groupe sans capacité assise), ce n'est pas un trou « à confirmer ».
  const seatedTables = useMemo(() => tables.filter((t) => !t.standing), [tables]);
  const standingCount = tables.length - seatedTables.length;
  const progress = useMemo(() => capacityFillProgress(seatedTables), [seatedTables]);
  const exportObj = useMemo(() => buildCapacityExport("eden", diffs), [diffs]);
  const exportJson = useMemo(() => capacityExportJson(exportObj), [exportObj]);

  const hasExport = summary.changed > 0;

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportJson);
      setCopied(true);
    } catch {
      // Copie indisponible (contexte non sécurisé) : l'utilisateur peut sélectionner le bloc manuellement.
      setCopied(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* En-tête honnête : ce que c'est, ce que ce n'est pas. */}
        <header className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c8a24a]">
            Club One · Plan de salle — édition (aperçu)
          </p>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
            Eden — confirmer / ajuster le plan V2
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/60">
            Le fondateur a donné toutes les capacités et types définitifs (plan V2). Ce banc part de ce plan
            et sert à <strong>confirmer ou corriger</strong> une capacité au besoin — plus de « case vide à
            deviner ». Les tables <strong>debout</strong> (« hautes ») restent sans capacité assise par nature.
            Seuls les <strong>ajustements réellement tapés</strong> sont collectés en bas de page sous forme
            JSON à transmettre.
          </p>
        </header>

        {/* Bandeau NON NÉGOCIABLE : rien n'est écrit en base ici. */}
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[13px] leading-relaxed text-amber-100">
          <strong className="font-bold">Brouillon local — aucune écriture en base.</strong> Chaque
          « Enregistré » ci-dessous n&apos;écrit que dans ce navigateur. La persistance réelle des capacités
          (UPDATE <code className="text-amber-200">venue_tables</code>) est un chunk séparé, relu et testé sur
          le LABO d&apos;abord. Rien n&apos;est envoyé, rien n&apos;est mis en ligne.
        </div>

        {/* Progression honnête : capacités ASSISES confirmées + rappel des tables debout (null par nature). */}
        <section className="grid grid-cols-3 gap-3">
          <Stat label="Tables (plan V2)" value={String(tables.length)} />
          <Stat label="Assises confirmées" value={`${progress.known}/${progress.total}`} accent={progress.unknown > 0} />
          <Stat label="Debout (sans assise)" value={String(standingCount)} />
        </section>

        {/* L'écran direction, monté tel quel (composant prouvé), branché sur un onSave LOCAL. */}
        <section>
          <VenueTableEditor venue="eden" tables={tables} onSave={handleLocalSave} />
        </section>

        {/* Artefact de transmission : uniquement les valeurs réellement tapées. */}
        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-white/50">
              À transmettre (capacités saisies)
            </h2>
            <button
              type="button"
              onClick={copyExport}
              disabled={!hasExport}
              className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? "Copié ✓" : "Copier le JSON"}
            </button>
          </div>

          {hasExport ? (
            <>
              <p className="text-[12px] text-white/55">
                {summary.filled > 0 && <span>{summary.filled} capacité(s) renseignée(s)</span>}
                {summary.corrected > 0 && (
                  <span>
                    {summary.filled > 0 ? " · " : ""}
                    {summary.corrected} corrigée(s)
                  </span>
                )}
                {summary.cleared > 0 && (
                  <span className="text-amber-300">
                    {summary.filled > 0 || summary.corrected > 0 ? " · " : ""}
                    {summary.cleared} effacée(s) → « à confirmer »
                  </span>
                )}
                .
              </p>
              <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[12px] leading-relaxed text-white/80">
                {exportJson}
              </pre>
              {exportObj.cleared.length > 0 && (
                <p className="text-[11px] text-amber-300/80">
                  Tables remises à « à confirmer » : {exportObj.cleared.join(" · ")}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-white/40">
              Aucune capacité saisie pour l&apos;instant. Renseigne au moins une table ci-dessus pour générer
              le JSON à transmettre.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className={`text-2xl font-black ${accent ? "text-[#c8a24a]" : "text-white"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/45">{label}</p>
    </div>
  );
}
