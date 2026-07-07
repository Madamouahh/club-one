"use client";

// app/_modules/agenda/MonthCalendar.tsx — calendrier mensuel INTERACTIF, présentationnel (props-driven).
// Aucune donnée fetchée ici, aucun import de page.tsx : reçoit year/month/events + callbacks. Le conteneur
// (page.tsx sous l'onglet agenda) fournit les soirées et gère create/edit via lib/eventManagement + RPC 0054.

import { buildMonthGrid, prevMonth, nextMonth, type CalendarEvent, type MonthGridDay } from "@/lib/eventManagement";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

// Palette de statut alignée sur AgendaView (soirée = fuchsia) + nuances de statut de planification.
const STATUS_DOT: Record<string, string> = {
  draft: "bg-white/40",
  published: "bg-fuchsia-400",
  open: "bg-emerald-400",
  closed: "bg-white/20",
  archived: "bg-white/15",
};

export type MonthCalendarProps = {
  year: number;
  month: number; // 1..12
  events: CalendarEvent[];
  today?: string | null; // YYYY-MM-DD (surlignage du jour) — fourni par le conteneur, pas de Date() ici
  selectedDate?: string | null;
  onMonthChange?: (next: { year: number; month: number }) => void;
  onSelectDay?: (date: string) => void;
  onSelectEvent?: (event: CalendarEvent) => void;
};

export default function MonthCalendar({
  year,
  month,
  events,
  today = null,
  selectedDate = null,
  onMonthChange,
  onSelectDay,
  onSelectEvent,
}: MonthCalendarProps) {
  const grid = buildMonthGrid(year, month, events);

  return (
    <div className="space-y-2 text-white">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-bold text-white/80 hover:bg-white/10"
          onClick={() => onMonthChange?.(prevMonth(year, month))}
          aria-label="Mois précédent"
        >
          ‹
        </button>
        <div className="text-sm font-black capitalize">{grid.label}</div>
        <button
          type="button"
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-bold text-white/80 hover:bg-white/10"
          onClick={() => onMonthChange?.(nextMonth(year, month))}
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-white/40">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.weeks.flat().map((cell) => (
          <DayCell
            key={cell.date}
            cell={cell}
            isToday={today === cell.date}
            isSelected={selectedDate === cell.date}
            onSelectDay={onSelectDay}
            onSelectEvent={onSelectEvent}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  cell,
  isToday,
  isSelected,
  onSelectDay,
  onSelectEvent,
}: {
  cell: MonthGridDay;
  isToday: boolean;
  isSelected: boolean;
  onSelectDay?: (date: string) => void;
  onSelectEvent?: (event: CalendarEvent) => void;
}) {
  const base = "flex min-h-[64px] flex-col rounded-xl border p-1 text-left transition";
  const tone = cell.inMonth
    ? "border-white/10 bg-white/5 hover:bg-white/10"
    : "border-white/5 bg-white/[0.02] text-white/30";
  const selected = isSelected ? "ring-2 ring-fuchsia-400/70" : "";

  return (
    <button
      type="button"
      data-testid={`day-${cell.date}`}
      className={`${base} ${tone} ${selected}`}
      onClick={() => onSelectDay?.(cell.date)}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[11px] font-bold ${isToday ? "text-fuchsia-300" : cell.inMonth ? "text-white/70" : "text-white/30"}`}>
          {cell.day}
        </span>
        {cell.events.length > 0 && (
          <span className="text-[9px] font-black text-white/40">{cell.events.length}</span>
        )}
      </div>
      <div className="mt-0.5 space-y-0.5">
        {cell.events.slice(0, 3).map((ev, i) => (
          <span
            key={ev.id ?? `${cell.date}-${i}`}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEvent?.(ev);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onSelectEvent?.(ev);
              }
            }}
            className="flex items-center gap-1 truncate rounded bg-black/30 px-1 py-0.5 text-[9px] text-white/80 hover:bg-black/50"
            title={ev.title ?? ""}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[ev.status ?? "draft"] ?? STATUS_DOT.draft}`} />
            <span className="truncate">{ev.title ?? "Soirée"}</span>
          </span>
        ))}
        {cell.events.length > 3 && (
          <span className="block text-[9px] text-white/40">+{cell.events.length - 3}</span>
        )}
      </div>
    </button>
  );
}
