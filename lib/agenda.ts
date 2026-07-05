// lib/agenda.ts — agrégateur d'AGENDA central (pur). AUCUNE table propre (D-01) : fusionne des échéances
// hétérogènes déjà issues des sources existantes (événements, artistes, maintenance, campagnes, commercial)
// en une timeline triée. Évite un second système d'événements concurrent (D-00).

export type AgendaKind = "soiree" | "artiste" | "maintenance" | "campagne" | "commercial";

export type AgendaItem = {
  date: string; // ISO date (YYYY-MM-DD) — clé de tri
  kind: AgendaKind;
  label: string;
  sublabel?: string | null;
};

const KIND_ORDER: Record<AgendaKind, number> = {
  soiree: 0,
  artiste: 1,
  commercial: 2,
  campagne: 3,
  maintenance: 4,
};

// Fusionne et trie par date croissante (puis par type pour un ordre stable). Ignore les items sans date
// (honnêteté : on n'invente pas d'échéance). Optionnellement borné à partir d'une date `from`.
export function buildAgenda(items: AgendaItem[], from?: string | null): AgendaItem[] {
  return items
    .filter((i) => !!i.date && (!from || i.date >= from))
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    });
}

// Regroupe la timeline par date (pour un affichage en sections).
export function groupAgendaByDate(items: AgendaItem[]): { date: string; items: AgendaItem[] }[] {
  const map = new Map<string, AgendaItem[]>();
  for (const it of buildAgenda(items)) {
    if (!map.has(it.date)) map.set(it.date, []);
    map.get(it.date)!.push(it);
  }
  return [...map.entries()].map(([date, items]) => ({ date, items }));
}

export function agendaKindLabel(kind: AgendaKind): string {
  return { soiree: "Soirée", artiste: "Artiste", maintenance: "Maintenance", campagne: "Campagne", commercial: "Commercial" }[kind];
}
