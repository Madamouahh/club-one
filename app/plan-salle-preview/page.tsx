"use client";

// app/plan-salle-preview/page.tsx — PLAN EDEN, même GRAMMAIRE VISUELLE que le plan Terminus
// (verdict fondateur 2026-07-04 : « regarde comment est fait celui du Terminus »).
//
// Recette PlanView Terminus (app/page.tsx) appliquée à l'Eden :
//   · rectangle vertical téléphone, cadre discret ;
//   · TABLES = boutons arrondis à liseré + HALO néon (la signature Club One), numéro en typo black ;
//   · ZONES structurantes en contours lumineux étiquetés (comme la scène orange / le carré VIP violet
//     du Terminus) : ici OLIVIERS en émeraude et CANAPÉS en or, banquettes murales en lignes brillantes ;
//   · badge DJ noir à liseré lumineux, au centre (verdict fondateur).
// Accent de l'univers : OR Eden (#c8a24a) là où le Terminus met de l'orange ; émeraude pour le végétal.
// Mode consultation : aucun statut de soirée inventé — toutes les tables au liseré « repos » de l'univers.
// Données : EDEN_SEED_V2 (44 tables réelles) tournées en portrait (seedToPortraitPct).

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

// Vocabulaire visuel par type — même structure que le STATUS du Terminus (border/glow/bg/text).
const KIND_VISUAL: Record<
  string,
  { border: string; glow: string; bg: string; text: string; dashed?: boolean }
> = {
  modulable: {
    border: "border-[#c8a24a]/70",
    glow: "shadow-[0_0_8px_rgba(200,162,74,.28)]",
    bg: "bg-[#c8a24a]/5",
    text: "text-[#e8d5a3]",
  },
  canape: {
    border: "border-[#c8a24a]",
    glow: "shadow-[0_0_14px_rgba(200,162,74,.55)]",
    bg: "bg-[#c8a24a]/15",
    text: "text-[#f3e7c5]",
  },
  olivier: {
    border: "border-emerald-500/85",
    glow: "shadow-[0_0_14px_rgba(16,185,129,.55)]",
    bg: "bg-emerald-500/10",
    text: "text-emerald-200",
  },
  haute: {
    border: "border-white/60",
    glow: "",
    bg: "bg-white/[0.04]",
    text: "text-white/90",
    dashed: true,
  },
};

export default function PlanSallePreviewPage() {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const selected = TABLES.find((t) => t.label === selectedLabel) ?? null;

  return (
    <main className="min-h-screen bg-[#070707] px-3 py-4 text-white">
      <div className="mx-auto flex max-w-[430px] flex-col gap-3">
        <header className="flex items-baseline justify-between px-1">
          <h1 className="text-sm font-black uppercase tracking-widest text-[#c8a24a]">Plan Eden</h1>
          <span className="text-[10px] font-bold uppercase text-white/40">44 tables</span>
        </header>

        {/* Le rectangle — recette PlanView Terminus. */}
        <section className="relative aspect-[506/952] w-full overflow-hidden rounded-3xl border border-white/10 bg-[#070707]">
          <div className="absolute inset-3 rounded-[1.35rem] border border-white/10" />

          {/* Banquettes murales (rangées 700 et 500/300) — lignes brillantes, comme les structures orange du Terminus */}
          <div className="absolute right-[22%] top-[2.5%] h-[54%] w-[2px] bg-[#c8a24a]/70 shadow-[0_0_7px_rgba(200,162,74,.45)]" />
          <div className="absolute left-[20%] top-[3%] h-[52%] w-[2px] bg-[#c8a24a]/70 shadow-[0_0_7px_rgba(200,162,74,.45)]" />

          {/* Zone OLIVIERS — contour lumineux étiqueté, comme le carré VIP du Terminus */}
          <div className="absolute left-[21%] top-[55.5%] h-[26%] w-[29%] rounded-2xl border-2 border-emerald-500/80 shadow-[0_0_10px_rgba(16,185,129,.45)]" />
          <div className="absolute left-[23%] top-[56.5%] text-[10px] font-black tracking-wide text-emerald-400">
            OLIVIERS
          </div>

          {/* Zone CANAPÉS — le salon lounge du fond */}
          <div className="absolute bottom-[2%] left-[3%] h-[10.5%] w-[74%] rounded-2xl border-2 border-[#c8a24a]/85 shadow-[0_0_10px_rgba(200,162,74,.50)]" />
          <div className="absolute bottom-[13%] left-[5%] text-[10px] font-black tracking-wide text-[#c8a24a]">
            CANAPÉS
          </div>

          {/* Cabine DJ — au centre, badge noir à liseré lumineux (recette Terminus) */}
          <div className="absolute left-1/2 top-1/2 flex h-[34px] w-[56px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-[#c8a24a] bg-black text-sm font-black text-[#c8a24a] shadow-[0_0_9px_rgba(200,162,74,.45)]">
            DJ
          </div>

          {TABLES.map((t) => {
            const v = KIND_VISUAL[t.kind] ?? KIND_VISUAL.modulable;
            const isHaute = t.kind === "haute";
            return (
              <button
                key={t.label}
                type="button"
                onClick={() => setSelectedLabel((cur) => (cur === t.label ? null : t.label))}
                className={`absolute -translate-x-1/2 -translate-y-1/2 border active:scale-95 ${v.border} ${v.glow} ${v.bg} ${
                  isHaute ? "h-[32px] w-[40px] rounded-full border-dashed" : "h-[32px] w-[58px] rounded-lg"
                } ${selectedLabel === t.label ? "ring-2 ring-white/70" : ""}`}
                style={{ left: `${t.x}%`, top: `${t.y}%` }}
              >
                <span className={`text-[10px] font-black leading-none ${v.text}`}>{t.label}</span>
                {t.cap !== null && (
                  <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#c8a24a] text-[8px] font-black text-black">
                    {t.cap}
                  </span>
                )}
              </button>
            );
          })}
        </section>

        {/* Détail au tap — même rôle que la fiche table du Terminus. */}
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
