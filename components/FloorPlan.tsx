"use client";

// components/FloorPlan.tsx — plan de salle SVG interactif (chunk 2 de PLAN_SALLE_EDEN).
//
// Composant PRÉSENTATIONNEL pur : il ne fait AUCUN réseau. On lui passe les tables d'un univers
// (venue_tables filtré par venue, migration 0024) et, optionnellement, une carte d'états de soirée.
//   · SANS carte d'états → mode CONSULTATION honnête : aucune table présentée « libre » (résa possible),
//     tout est neutre ; une table inactive reste « indisponible » (fait statique).
//   · AVEC carte d'états → libre / demandée / confirmée / indisponible (couleur + légende).
// La direction artistique, la géométrie, les murs, la palette et la légende viennent de lib/floorPlanView.
// Le rendu des tables (rond = cercle, carré = banquette, debout = pictogramme distinct) suit tableGeometry.
//
// Sécurité : ce composant n'accorde AUCUN droit — il reflète des données déjà cantonnées par la RLS 0024
// (layout lisible par tout le staff ; édition réservée à la direction). Le clic remonte au parent, qui
// décide ce qu'il en fait (staff : ouvrir la table ; client : demander une résa — chunk 4).

import { planReady, type Venue, type VenueTable } from "@/lib/venueTables";
import {
  availabilityStyle,
  buildLegend,
  buildLegendKinds,
  resolveAvailability,
  tableAriaLabel,
  tableGeometry,
  tablePosition,
  venueFixtures,
  venueWalls,
  VENUE_THEME,
  VENUE_VIEWBOX,
  type LegendEntry,
  type PlanFixture,
  type TableAvailability,
} from "@/lib/floorPlanView";

export function FloorPlan({
  venue,
  tables,
  availability,
  selectedId,
  onSelectTable,
}: {
  venue: Venue;
  tables: VenueTable[];
  // Carte optionnelle id → état de soirée. Absente = consultation honnête (aucune fausse dispo).
  availability?: Record<string, TableAvailability>;
  selectedId?: string | null;
  onSelectTable?: (table: VenueTable) => void;
}) {
  const theme = VENUE_THEME[venue];
  const viewBox = VENUE_VIEWBOX[venue];
  const walls = venueWalls(venue);
  const mode: "consultation" | "live" = availability ? "live" : "consultation";
  // Plan V2 (tables typées) → légende par type d'assise + éléments fixes (DJ, banquettes murales).
  const hasKinds = tables.some((t) => Boolean(t.kind));
  const legend = hasKinds ? buildLegendKinds(mode) : buildLegend(mode);
  const fixtures = venueFixtures(venue, hasKinds);
  const gradientId = `floorplan-bg-${venue}`;

  // État vide HONNÊTE : aucun univers/aucune table → on n'affiche pas un cadre vide trompeur.
  if (!planReady(tables)) {
    return (
      <section className="rounded-3xl border border-white/10 bg-[#070707] p-8 text-center">
        <p className="text-sm font-semibold text-white/70">Plan {theme.name} — aucune table</p>
        <p className="mt-1 text-xs text-white/40">
          Le layout de cet univers n&apos;a pas encore été renseigné.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-[#070707] p-3">
      <header className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-sm font-black uppercase tracking-wide" style={{ color: theme.label }}>
          Plan {theme.name}
        </h3>
        {mode === "consultation" && (
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold uppercase text-white/50">
            Consultation — hors soirée
          </span>
        )}
      </header>

      <svg
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        className="h-auto w-full rounded-2xl"
        role="img"
        aria-label={`Plan de salle ${theme.name}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.backgroundFrom} />
            <stop offset="100%" stopColor={theme.backgroundTo} />
          </linearGradient>
        </defs>

        {/* Fond DA de l'univers */}
        <rect x={0} y={0} width={viewBox.width} height={viewBox.height} fill={`url(#${gradientId})`} />

        {/* Murs / cloisons (transcription approximative de la spec) */}
        <g stroke={theme.wall} strokeWidth={3} strokeLinecap="round" opacity={0.75}>
          {walls.map((w, i) => (
            <line key={`wall-${i}`} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
          ))}
        </g>

        {/* Éléments fixes V2 : cabine DJ + banquettes murales (non réservables, derrière les tables) */}
        {fixtures.map((f, i) => (
          <FixtureMark key={`fixture-${i}`} fixture={f} wall={theme.wall} />
        ))}

        {/* Tables */}
        {tables.map((table) => (
          <TableMark
            key={table.id}
            table={table}
            viewBox={viewBox}
            availability={resolveAvailability(table, availability)}
            selected={selectedId === table.id}
            onSelectTable={onSelectTable}
            accent={theme.accent}
          />
        ))}
      </svg>

      <Legend entries={legend} accent={theme.accent} />
    </section>
  );
}

// Élément fixe du plan (V2) : cabine DJ (repère central) ou banquette murale (coussins côté paroi).
function FixtureMark({ fixture, wall }: { fixture: PlanFixture; wall: string }) {
  if (fixture.kind === "dj") {
    return (
      <g aria-hidden>
        <rect
          x={fixture.x}
          y={fixture.y}
          width={fixture.w}
          height={fixture.h}
          rx={8}
          fill="rgba(200,162,74,.10)"
          stroke={wall}
          strokeWidth={1.5}
        />
        <text
          x={fixture.x + fixture.w / 2}
          y={fixture.y + fixture.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={14}
          fontWeight={900}
          fill={wall}
          pointerEvents="none"
        >
          {fixture.label}
        </text>
      </g>
    );
  }
  return (
    <rect
      aria-hidden
      x={fixture.x}
      y={fixture.y}
      width={fixture.w}
      height={fixture.h}
      rx={6}
      fill="rgba(239,230,207,.10)"
      stroke="rgba(239,230,207,.35)"
      strokeWidth={1}
    />
  );
}

function TableMark({
  table,
  viewBox,
  availability,
  selected,
  onSelectTable,
  accent,
}: {
  table: VenueTable;
  viewBox: { width: number; height: number };
  availability: TableAvailability | null;
  selected: boolean;
  onSelectTable?: (table: VenueTable) => void;
  accent: string;
}) {
  const { cx, cy } = tablePosition(table, viewBox);
  const geom = tableGeometry(table);
  const style = availabilityStyle(availability);
  const clickable = Boolean(onSelectTable) && table.active;
  const label = tableAriaLabel(table, availability);

  function handleActivate() {
    if (clickable && onSelectTable) onSelectTable(table);
  }

  return (
    <g
      transform={`translate(${cx} ${cy})`}
      onClick={clickable ? handleActivate : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleActivate();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={label}
      style={{ cursor: clickable ? "pointer" : "default", outline: "none" }}
    >
      <title>{label}</title>

      {geom.kind === "rect" ? (
        <rect
          x={-geom.halfW}
          y={-geom.halfH}
          width={geom.halfW * 2}
          height={geom.halfH * 2}
          rx={geom.radius}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={selected ? 3 : 1.5}
        />
      ) : (
        <>
          {/* Table olivier : couronne de feuillage (accent végétal de l'univers) derrière la table. */}
          {geom.foliage && (
            <circle
              r={geom.r + 6}
              fill="none"
              stroke={accent}
              strokeWidth={4}
              strokeDasharray="2 6"
              strokeLinecap="round"
              opacity={0.9}
            />
          )}
          <circle r={geom.r} fill={style.fill} stroke={style.stroke} strokeWidth={selected ? 3 : 1.5} />
          {/* Table haute « debout » : anneau distinct + point central (pictogramme verre debout). */}
          {geom.standing && (
            <>
              <circle
                r={geom.r + 4}
                fill="none"
                stroke={style.stroke}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.8}
              />
              <circle r={2.2} fill={style.stroke} />
            </>
          )}
        </>
      )}

      {/* Libellé de table */}
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={800}
        fill={style.text}
        pointerEvents="none"
      >
        {table.label}
      </text>
    </g>
  );
}

function Legend({ entries, accent }: { entries: LegendEntry[]; accent: string }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1">
      {entries.map((entry) => (
        <li key={entry.key} className="flex items-center gap-1.5 text-[11px] font-semibold text-white/70">
          <LegendSwatch swatch={entry.swatch} accent={accent} />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

// Le swatch est soit une couleur (état de dispo / consultation), soit une forme (round/square/standing),
// soit un TYPE d'assise V2 (canape/olivier/modulable/dj).
function LegendSwatch({ swatch, accent }: { swatch: string; accent: string }) {
  if (swatch === "round") {
    return <span className="h-3 w-3 rounded-full border border-white/60" aria-hidden />;
  }
  if (swatch === "square") {
    return <span className="h-2.5 w-4 rounded-sm border border-white/60" aria-hidden />;
  }
  if (swatch === "standing") {
    return (
      <span
        className="h-3 w-3 rounded-full border border-dashed"
        style={{ borderColor: accent }}
        aria-hidden
      />
    );
  }
  if (swatch === "canape") {
    return <span className="h-2.5 w-5 rounded-md border border-white/60" aria-hidden />;
  }
  if (swatch === "olivier") {
    return (
      <span
        className="h-3.5 w-3.5 rounded-full border-2 border-dotted"
        style={{ borderColor: accent }}
        aria-hidden
      />
    );
  }
  if (swatch === "modulable") {
    return <span className="h-2.5 w-2.5 rounded-full border border-white/60" aria-hidden />;
  }
  if (swatch === "dj") {
    return <span className="h-3 w-4 rounded-sm border border-[#c8a24a] bg-[#c8a24a]/15" aria-hidden />;
  }
  // Couleur d'état (hex)
  return <span className="h-3 w-3 rounded-full" style={{ backgroundColor: swatch }} aria-hidden />;
}
