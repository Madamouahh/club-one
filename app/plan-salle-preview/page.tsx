"use client";

// app/plan-salle-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (chunk PLAN_SALLE_EDEN, Phase A).
//
// Raison d'être : le composant <FloorPlan> (chunk 2) existe et est prouvé PUR, mais il n'était monté
// nulle part — le fondateur ne pouvait donc PAS rendre son « verdict visuel Phase A » (bloquant de la
// Phase B backdrop + porte de tout le flux de résa client). Cette page rend l'Eden depuis la SEULE
// source de vérité transcrite du screenshot fondateur (EDEN_SEED, lib/venueTables), afin qu'il ouvre
// une URL et tranche le design.
//
// Périmètre volontairement étroit et SÛR :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — rendu 100 % local depuis la constante transcrite ;
//   · AUCUNE donnée inventée : les 44 tables, formes, tables hautes « debout » et capacités viennent
//     d'EDEN_SEED ; une capacité illisible sur le screenshot reste « à confirmer » (jamais forcée) ;
//   · le plan s'affiche par défaut en CONSULTATION honnête (aucune fausse dispo). Un aperçu du code
//     couleur des états est proposé, mais EXPLICITEMENT étiqueté « données fictives — pas une soirée ».
//
// Ce n'est pas l'écran opérationnel : c'est un banc de validation visuelle pour le fondateur.

import { useState } from "react";

import { FloorPlan } from "@/components/FloorPlan";
import {
  EDEN_SEED,
  EDEN_STANDING_LABELS,
  capacityKnown,
  capacityLabel,
  planSummary,
  seedToPct,
  tableKindLabel,
  type VenueTable,
} from "@/lib/venueTables";
import type { TableAvailability } from "@/lib/floorPlanView";

// Les 44 tables Eden dérivées de la transcription (mêmes maths %→SVG que le seed SQL 0024).
// active=true : le seed 0024 insère les tables actives par défaut ; aucune n'est marquée inactive.
const EDEN_TABLES: VenueTable[] = EDEN_SEED.map((entry) => {
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
  };
});

const SUMMARY = planSummary(EDEN_TABLES);

// Libellés dont la capacité RESTE à confirmer (ce que la direction devra saisir dans l'écran d'édition).
const UNKNOWN_CAPACITY_LABELS = EDEN_TABLES.filter((t) => !capacityKnown(t)).map((t) => t.label);

// Carte d'états PUREMENT DÉMONSTRATIVE — sert à montrer au fondateur le code couleur (libre / demandée /
// confirmée / indisponible). Ce ne sont PAS des disponibilités réelles : aucune soirée n'est chargée ici.
// En mode « live », toute table absente de cette carte s'affiche « libre » (comportement de resolveAvailability).
const DEMO_AVAILABILITY: Record<string, TableAvailability> = {
  "eden-205": "requested",
  "eden-500": "requested",
  "eden-200": "confirmed",
  "eden-100": "confirmed",
  "eden-101": "confirmed",
  "eden-704": "unavailable",
  "eden-606": "unavailable",
};

export default function PlanSallePreviewPage() {
  // Aperçu du code couleur des états (démo) vs consultation honnête (défaut).
  const [showDemoStates, setShowDemoStates] = useState(false);
  // Table sélectionnée par un tap — démontre le point d'entrée du futur flux « demande de résa » client.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = EDEN_TABLES.find((t) => t.id === selectedId) ?? null;

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* En-tête honnête : ce que c'est, ce que ce n'est pas. */}
        <header className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c8a24a]">
            Club One · Plan de salle — aperçu
          </p>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Eden — verdict visuel (Phase A)</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-white/60">
            Banc de validation visuelle isolé, pour trancher la direction artistique du plan Eden avant de
            lancer la Phase B (habillage image). Ce n&apos;est <strong>pas</strong> l&apos;écran opérationnel :
            aucune donnée de soirée n&apos;est chargée, aucune réservation n&apos;est possible ici. Les 44 tables,
            leurs positions, leurs formes et les tables hautes « debout » sont la transcription du screenshot
            fourni ; une capacité illisible reste « à confirmer » — jamais inventée.
          </p>
        </header>

        {/* Synthèse honnête de l'état du plan. */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Tables" value={String(SUMMARY.total)} />
          <Stat label="Actives" value={String(SUMMARY.active)} />
          <Stat label="Hautes (debout)" value={String(SUMMARY.standing)} />
          <Stat label="Capacités à confirmer" value={String(SUMMARY.capacityUnknown)} accent />
        </section>

        {/* Bascule consultation ↔ aperçu du code couleur (démo). */}
        <section className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDemoStates((v) => !v)}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white/80 transition hover:bg-white/10"
          >
            {showDemoStates ? "Revenir en consultation honnête" : "Aperçu du code couleur des états"}
          </button>
          {showDemoStates && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-200">
              Démonstration — états fictifs, pas une vraie soirée
            </span>
          )}
        </section>

        {/* Le plan. Consultation (availability absent) par défaut ; démo colorée si demandé. */}
        <FloorPlan
          venue="eden"
          tables={EDEN_TABLES}
          availability={showDemoStates ? DEMO_AVAILABILITY : undefined}
          selectedId={selectedId}
          onSelectTable={(table) => setSelectedId((cur) => (cur === table.id ? null : table.id))}
        />

        {/* Détail de la table sélectionnée — préfigure le point d'entrée du flux de résa client (tap → demande). */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">Table sélectionnée</h2>
          {selected ? (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span className="text-lg font-black text-white">Table {selected.label}</span>
              <span className="text-white/70">{tableKindLabel(selected)}</span>
              <span className="text-white/70">
                Capacité :{" "}
                <strong className={capacityKnown(selected) ? "text-white" : "text-[#c8a24a]"}>
                  {capacityKnown(selected) ? `${capacityLabel(selected.capacity)} places` : "à confirmer"}
                </strong>
              </span>
            </div>
          ) : (
            <p className="text-sm text-white/40">
              Touchez une table sur le plan (ce tap sera, côté client, le début d&apos;une demande de réservation).
            </p>
          )}
        </section>

        {/* Rappel des tables hautes « debout » (liste EXACTE du fondateur) + capacités à confirmer. */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">
              Tables hautes — debout (sans chaise)
            </h2>
            <p className="text-sm text-white/70">{EDEN_STANDING_LABELS.join(" · ")}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">
              Capacités à confirmer ({UNKNOWN_CAPACITY_LABELS.length})
            </h2>
            <p className="text-sm text-white/70">
              {UNKNOWN_CAPACITY_LABELS.length > 0 ? UNKNOWN_CAPACITY_LABELS.join(" · ") : "Aucune — toutes renseignées."}
            </p>
          </div>
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
