"use client";

// app/_modules/agenda/AgendaView.tsx — AGENDA central (agrégateur lecture, sans table propre, D-01).
// Fusionne les échéances existantes (soirées, artistes, maintenance préventive, campagnes, commercial)
// en une timeline. N'écrit rien, n'invente aucune échéance (items sans date ignorés).

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import { buildAgenda, agendaKindLabel, type AgendaItem, type AgendaKind } from "@/lib/agenda";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const KIND_COLOR: Record<AgendaKind, string> = {
  soiree: "text-fuchsia-300",
  artiste: "text-cyan-300",
  commercial: "text-emerald-300",
  campagne: "text-amber-300",
  maintenance: "text-orange-300",
};

type Row = Record<string, unknown>;

export default function AgendaView({ supabase, role }: { supabase: SupabaseClient; role: StaffRole }) {
  const isDirection = role === "admin" || role === "manager";
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(isDirection);

  useEffect(() => {
    if (!isDirection) return;
    let active = true;
    (async () => {
      const res = await Promise.all([
        supabase.from("events").select("event_date, name, venue_id").order("event_date", { ascending: true }),
        supabase.from("artist_checkins").select("exploitation_date, artist_name"),
        supabase.from("maintenance_interventions").select("due_date, kind"),
        supabase.from("marketing_campaigns").select("period_start, name"),
        supabase.from("commercial_leads").select("event_date_wanted, contact_name, kind"),
      ]);
      if (!active) return;
      const [ev, art, mnt, camp, lead] = res.map((r) => (r.data || []) as Row[]);
      const merged: AgendaItem[] = [];
      for (const e of ev as Row[]) if (e.event_date) merged.push({ date: String(e.event_date).slice(0, 10), kind: "soiree", label: String(e.name || "Soirée"), sublabel: (e.venue_id as string) || null });
      for (const a of art as Row[]) if (a.exploitation_date) merged.push({ date: String(a.exploitation_date).slice(0, 10), kind: "artiste", label: String(a.artist_name || "Artiste") });
      for (const m of mnt as Row[]) if (m.due_date) merged.push({ date: String(m.due_date).slice(0, 10), kind: "maintenance", label: `Maintenance ${m.kind || ""}` });
      for (const c of camp as Row[]) if (c.period_start) merged.push({ date: String(c.period_start).slice(0, 10), kind: "campagne", label: String(c.name || "Campagne") });
      for (const l of lead as Row[]) if (l.event_date_wanted) merged.push({ date: String(l.event_date_wanted).slice(0, 10), kind: "commercial", label: `${l.kind || "Demande"} — ${l.contact_name || ""}` });
      setItems(merged);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, isDirection]);

  if (!isDirection) return <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">Agenda réservé à la direction (admin / manager).</p>;
  if (loading) return <div className="p-6 text-center text-sm text-white/40">Chargement de l’agenda…</div>;

  const timeline = buildAgenda(items);

  return (
    <div className="space-y-2 pb-4 text-white">
      <div className="text-center text-xs text-white/50">Agenda central — échéances agrégées (soirées, artistes, maintenance, campagnes, commercial)</div>
      {timeline.length === 0 ? (
        <div className="text-center text-sm text-white/40">Aucune échéance planifiée. L’agenda se remplit depuis les autres modules.</div>
      ) : (
        <ul className="space-y-2">
          {timeline.map((it, idx) => (
            <li key={`${it.date}-${idx}`} className={`${CARD} flex items-center gap-3`}>
              <div className="w-16 shrink-0 text-center text-xs font-black text-white/70">{it.date.slice(5)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{it.label}</div>
                <div className={`text-[10px] uppercase ${KIND_COLOR[it.kind]}`}>{agendaKindLabel(it.kind)}{it.sublabel ? ` · ${it.sublabel}` : ""}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
