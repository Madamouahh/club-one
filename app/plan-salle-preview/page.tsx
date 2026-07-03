"use client";

// app/plan-salle-preview/page.tsx — PLAN EDEN, format ÉQUIPES (exigence fondateur 2026-07-04) :
// « rectangle comme la vue Terminus, pour le téléphone, juste les tables placées ».
//
// Même patron exact que PlanView Terminus (app/page.tsx) : un rectangle vertical épuré plein
// écran téléphone, les tables en boutons positionnés en %, le badge DJ — RIEN d'autre. Pas de
// murs dessinés, pas de bandeaux, pas de légende : le tap sur une table donne le détail.
// Les 44 tables viennent d'EDEN_SEED_V2 (types/capacités fondateur), tournées en portrait par
// seedToPortraitPct (la longueur du rooftop = la hauteur de l'écran).
// Route d'aperçu isolée : AUCUN réseau, ne touche pas au monolithe.

import { useState } from "react";

import {
  EDEN_SEED_V2,
  seedToPortraitPct,
  tableKindLabelV2,
  type EdenSeedV2Entry,
} from "@/lib/venueTables";

type PlacedTable = EdenSeedV2Entry & { x: number; y: number };

const TABLES: PlacedTable[] = EDEN_SEED_V2.map((t) => {
  const { x_pct, y_pct } = seedToPortraitPct(t);
  return { ...t, x: x_pct, y: y_pct };
});

// Position portrait de la cabine DJ (fondateur : entre la 304 et la 406) — même rotation.
const DJ = seedToPortraitPct({ px: 302, py: 280 });

// Style de bouton par type d'assise — même vocabulaire visuel que les tables Terminus (rectangles
// arrondis, or Eden au lieu d'orange), différencié SOBREMENT : canapé plus large, olivier liseré
// végétal, table haute en pointillé, modulable petit.
function tableClass(t: PlacedTable): string {
  const base =
    "absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-black/60 active:scale-95";
  switch (t.kind) {
    case "canape":
      return `${base} h-[30px] w-[62px] border-[#c8a24a]/80 shadow-[0_0_7px_rgba(200,162,74,.25)]`;
    case "olivier":
      return `${base} h-[34px] w-[48px] rounded-xl border-emerald-500/80 shadow-[0_0_7px_rgba(16,185,129,.25)]`;
    case "haute":
      return `${base} h-[26px] w-[40px] rounded-full border-dashed border-white/60`;
    default: // modulable
      return `${base} h-[26px] w-[42px] border-white/35`;
  }
}

export default function PlanSallePreviewPage() {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const selected = TABLES.find((t) => t.label === selectedLabel) ?? null;

  return (
    <main className="min-h-screen bg-[#070707] px-3 py-4 text-white">
      <div className="mx-auto flex max-w-[430px] flex-col gap-3">
        <header className="flex items-baseline justify-between px-1">
          <h1 className="text-sm font-black uppercase tracking-widest text-[#c8a24a]">
            Plan Eden
          </h1>
          <span className="text-[10px] font-bold uppercase text-white/40">44 tables</span>
        </header>

        {/* LE rectangle — même patron que la vue Terminus, format téléphone. */}
        <section className="relative aspect-[506/952] w-full overflow-hidden rounded-3xl border border-white/10 bg-[#070707]">
          <div className="absolute inset-3 rounded-[1.35rem] border border-white/10" />

          {/* Cabine DJ (fondateur : entre la 304 et la 406) */}
          <div
            className="absolute flex h-[30px] w-[52px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-[#c8a24a] bg-black text-xs font-black text-[#c8a24a] shadow-[0_0_7px_rgba(200,162,74,.4)]"
            style={{ left: `${DJ.x_pct}%`, top: `${DJ.y_pct}%` }}
          >
            DJ
          </div>

          {TABLES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setSelectedLabel((cur) => (cur === t.label ? null : t.label))}
              className={`${tableClass(t)} ${selectedLabel === t.label ? "ring-2 ring-[#c8a24a]" : ""}`}
              style={{ left: `${t.x}%`, top: `${t.y}%` }}
            >
              <span className="text-[10px] font-black leading-none text-white">{t.label}</span>
              {t.cap !== null && (
                <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/15 text-[8px] font-black text-white/80">
                  {t.cap}
                </span>
              )}
            </button>
          ))}
        </section>

        {/* Détail au tap — la seule « légende » nécessaire. */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          {selected ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="font-black text-white">Table {selected.label}</span>
              <span className="text-white/70">{tableKindLabelV2(selected)}</span>
              {selected.cap !== null ? (
                <span className="text-white/50">{selected.cap} places</span>
              ) : (
                <span className="text-white/50">groupe debout — sans chaise</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-white/40">Touche une table pour voir son détail.</p>
          )}
        </section>
      </div>
    </main>
  );
}
