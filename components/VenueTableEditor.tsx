"use client";

// components/VenueTableEditor.tsx — écran direction « ÉDITER TABLE » (chunk 3 de PLAN_SALLE_EDEN).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe les tables d'un univers
// (venue_tables filtré, migration 0024) et un callback `onSave(id, patch)`. L'écriture réelle
// (UPDATE venue_tables, réservée aux admin/manager par la RLS 0024) est faite par le parent —
// ce composant n'accorde AUCUN droit, il reflète et prépare.
//
// Objectif métier (spec §2) : combler les capacités NULL (26 tables « à confirmer » du seed EDEN)
// avec les VRAIES valeurs, sans redéploiement. Discipline d'honnêteté : un champ capacité vide
// reste `null` (« à confirmer »), jamais forcé à 0. Toute la logique est dans lib/venueTableEditor.

import { useState } from "react";
import { capacityLabel, tableKindLabel, type Venue, type VenueTable } from "@/lib/venueTables";
import {
  buildVenueTableUpdate,
  capacityInputValue,
  capacityProgress,
  parseCapacityInput,
  sortForEditing,
  toEditableDraft,
  CAPACITY_HINT,
  type VenueTableUpdate,
} from "@/lib/venueTableEditor";

type SaveState = { tone: "ok" | "err"; message: string } | null;

function VenueTableRow({
  table,
  onSave,
}: {
  table: VenueTable;
  onSave: (id: string, patch: VenueTableUpdate) => Promise<void>;
}) {
  const [capacityText, setCapacityText] = useState(capacityInputValue(table.capacity));
  const [standing, setStanding] = useState(table.standing);
  const [active, setActive] = useState(table.active);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<SaveState>(null);

  const capParse = parseCapacityInput(capacityText);
  const capError = capParse.ok ? null : capParse.reason;

  // Brouillon courant → patch minimal (ne recalcule QUE les champs éditables ici).
  const draft = { ...toEditableDraft(table), standing, active, capacity: capParse.ok ? capParse.value : table.capacity };
  const built = buildVenueTableUpdate(table, draft);
  const nothingToSave = built.ok && built.update === null;
  const canSave = !saving && capParse.ok && built.ok && !nothingToSave;

  async function handleSave() {
    if (!canSave || !built.ok || built.update === null) return;
    setSaving(true);
    setState(null);
    try {
      await onSave(table.id, built.update);
      setState({ tone: "ok", message: "Enregistré." });
    } catch (e) {
      setState({ tone: "err", message: e instanceof Error ? e.message : "Échec de l'enregistrement." });
    } finally {
      setSaving(false);
    }
  }

  const needsCapacity = table.capacity === null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black tracking-wide text-white">Table {table.label}</span>
          <span className="text-[11px] text-white/45">{tableKindLabel(table)}</span>
        </div>
        {needsCapacity ? (
          <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
            capacité à confirmer
          </span>
        ) : (
          <span className="text-[11px] text-white/40">
            capacité&nbsp;: <span className="font-bold text-white/70">{capacityLabel(table.capacity)}</span>
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/45">Capacité</span>
          <input
            inputMode="numeric"
            value={capacityText}
            onChange={(e) => setCapacityText(e.target.value)}
            placeholder="— (à confirmer)"
            aria-label={`Capacité de la table ${table.label}`}
            aria-invalid={capError !== null}
            className={`w-full rounded-lg border bg-black/30 px-2 py-1.5 text-sm text-white outline-none ${
              capError ? "border-red-400/50" : "border-white/15 focus:border-white/40"
            }`}
          />
        </label>

        <label className="flex items-end gap-2 pb-1.5">
          <input type="checkbox" checked={standing} onChange={(e) => setStanding(e.target.checked)} />
          <span className="text-xs text-white/70">Table haute (debout)</span>
        </label>

        <label className="flex items-end gap-2 pb-1.5">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="text-xs text-white/70">Active</span>
        </label>
      </div>

      {capError && <p className="mt-1 text-[11px] text-red-300">{capError}</p>}
      {!capError && <p className="mt-1 text-[10px] text-white/30">{CAPACITY_HINT}</p>}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px]">
          {state && (
            <span className={state.tone === "ok" ? "text-emerald-300" : "text-red-300"}>{state.message}</span>
          )}
        </span>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Enregistrement…" : nothingToSave ? "Rien à enregistrer" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

export function VenueTableEditor({
  venue,
  tables,
  onSave,
}: {
  venue: Venue;
  tables: VenueTable[];
  onSave: (id: string, patch: VenueTableUpdate) => Promise<void>;
}) {
  const ordered = sortForEditing(tables);
  const progress = capacityProgress(tables);

  if (ordered.length === 0) {
    // État vide HONNÊTE : aucune table pour cet univers (jamais un faux plan).
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/45">
        Aucune table enregistrée pour cet univers.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">
          Éditer les tables — {venue}
        </p>
        <p className="text-[11px] text-white/45">
          Capacités renseignées&nbsp;:{" "}
          <span className="font-bold text-white/80">
            {progress.known}/{progress.total}
          </span>
          {progress.unknown > 0 && (
            <span className="text-amber-300"> · {progress.unknown} à confirmer</span>
          )}
          {progress.complete && <span className="text-emerald-300"> · complet</span>}
        </p>
      </div>

      {progress.unknown > 0 && (
        <p className="text-[11px] text-white/40">
          Les tables dont la capacité reste à confirmer sont affichées en premier. Saisis la vraie
          valeur du plan OctoTable, ou laisse vide tant qu&apos;elle n&apos;est pas connue.
        </p>
      )}

      {ordered.map((t) => (
        <VenueTableRow key={t.id} table={t} onSave={onSave} />
      ))}
    </div>
  );
}
