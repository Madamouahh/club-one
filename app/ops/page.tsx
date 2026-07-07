"use client";

// /ops — SURFACE AUTONOME D'EXPLOITATION LIVE (mobile-first). Sur le socle Auth partagé (session fiable).
// Bottom-nav ≤5 (Soirée · Tables · Réservations · Équipe · Plus), contenu cadré par rôle (RLS = autorité).
// MONTE DES MODULES EXISTANTS par composition — aucune fonction métier ni backend nouveau :
//   · Soirée      → ModeSoireeCockpit (agrégat A6/A7/A8/A9, données réelles chargées ici) ;
//   · Tables      → venue_tables de la soirée + superposition « couche demandes » (0025) ;
//   · Réservations→ table_reservation_requests (file du soir) ;
//   · Équipe      → staff_shifts du jour (présence) ;
//   · Plus        → feuille de modules secondaires (incidents…).
// Toutes les lectures passent par la RLS ; aucune donnée fabriquée.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import { AuthProvider, RequireAuth, useAuth, defaultSurfaceForRole } from "@/app/_components/StaffAuth";
import Link from "next/link";
import ModeSoireeCockpit from "@/components/ModeSoireeCockpit";
import { loadActiveEventContext, type ActiveEventContext } from "@/lib/activeEvent";
import { buildLines, type ChecklistItem, type ChecklistCompletion, type ChecklistLine } from "@/lib/checklists";
import type { InternalMessage, MessageRead } from "@/lib/internalComms";
import type { ArtistCheckin } from "@/lib/artistCheckin";
import type { Incident } from "@/lib/incidents";
import type { StaffRole } from "@/lib/permissions";

const OPS_ROLES: readonly StaffRole[] = ["admin", "manager", "server", "security", "security_counter", "promoter"];

type OpsTab = "soiree" | "tables" | "resas" | "equipe" | "plus";
type VenueTable = { id: string; venue: string; label: string; standing: boolean; capacity: number | null };
type ResaRow = { id: string; status: string; party_size: number; slot: string | null; venue_table_id: string; exploitation_date: string };
type ShiftRow = { id: string; poste: string | null; status: string; exploitation_date: string; staff_members: { full_name: string } | null };

const shell = "min-h-screen bg-black text-white pb-20";
const card = "rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3";
const OPS = "#f5495b";

const STATUS_STYLE: Record<string, string> = {
  confirme: "text-emerald-300", present: "text-emerald-300", planifie: "text-amber-300",
  retard: "text-amber-300", absent: "text-red-300", annule: "text-white/40",
  pending: "text-amber-300", approved: "text-emerald-300", declined: "text-red-300", cancelled: "text-white/40",
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function OpsInner() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<OpsTab>("soiree");
  const [event, setEvent] = useState<ActiveEventContext | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [reads, setReads] = useState<MessageRead[]>([]);
  const [checkins, setCheckins] = useState<ArtistCheckin[]>([]);
  const [lines, setLines] = useState<ChecklistLine[]>([]);
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [resas, setResas] = useState<ResaRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);

  const date = useMemo(() => todayIso(), []);

  const load = useCallback(async () => {
    const ev = await loadActiveEventContext(supabase);
    setEvent(ev);
    const venue = ev?.venueId ?? null;
    const [incRes, msgRes, readRes, checkRes, itemRes, compRes, tblRes, resaRes, shiftRes] = await Promise.all([
      supabase.from("incidents").select("*"),
      supabase.from("internal_messages").select("*").eq("exploitation_date", date),
      supabase.from("internal_message_reads").select("*"),
      supabase.from("artist_checkins").select("*").eq("exploitation_date", date),
      supabase.from("checklist_items").select("*").eq("active", true),
      supabase.from("checklist_completions").select("*").eq("exploitation_date", date),
      venue ? supabase.from("venue_tables").select("id, venue, label, standing, capacity").eq("venue", venue).eq("active", true).order("label")
            : supabase.from("venue_tables").select("id, venue, label, standing, capacity").eq("active", true).order("label"),
      supabase.from("table_reservation_requests").select("id, status, party_size, slot, venue_table_id, exploitation_date").in("status", ["pending", "approved"]),
      supabase.from("staff_shifts").select("id, poste, status, exploitation_date, staff_members(full_name)").eq("exploitation_date", date),
    ]);
    setIncidents((incRes.data as Incident[]) ?? []);
    setMessages((msgRes.data as InternalMessage[]) ?? []);
    setReads((readRes.data as MessageRead[]) ?? []);
    setCheckins((checkRes.data as ArtistCheckin[]) ?? []);
    setLines(buildLines((itemRes.data as ChecklistItem[]) ?? [], (compRes.data as ChecklistCompletion[]) ?? [], date));
    setTables((tblRes.data as VenueTable[]) ?? []);
    setResas((resaRes.data as ResaRow[]) ?? []);
    setShifts((shiftRes.data as unknown as ShiftRow[]) ?? []);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!profile) return null;

  const resaByTable = new Map<string, string>();
  for (const r of resas) resaByTable.set(r.venue_table_id, r.status === "approved" ? "réservée" : "option");

  const navItems: [OpsTab, string][] = [
    ["soiree", "Soirée"], ["tables", "Tables"], ["resas", "Résas"], ["equipe", "Équipe"], ["plus", "Plus"],
  ];

  return (
    <main className={shell} data-testid="ops-surface">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/90 px-5 py-3 backdrop-blur">
        <div>
          <p className="text-[11px] font-black tracking-[0.2em]" style={{ color: OPS }}>● LIVE · OPS</p>
          <p className="mt-0.5 text-xs text-white/45" data-testid="ops-event">
            {event ? `${event.venueName || event.venueId || "Soirée"} · ${event.eventDate}` : "Aucune soirée active"}
          </p>
        </div>
        <Link href={defaultSurfaceForRole(profile.role)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-black text-white/60">Accueil</Link>
      </header>

      <div className="p-4">
        {tab === "soiree" && (
          <div data-testid="ops-soiree">
            <ModeSoireeCockpit role={profile.role} username={profile.username}
              incidents={incidents} messages={messages} reads={reads} checkins={checkins} checklistLines={lines} />
          </div>
        )}

        {tab === "tables" && (
          <div data-testid="ops-tables">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Plan de tables {event?.venueId ? `· ${event.venueId}` : ""}</p>
            {tables.length === 0 ? (
              <p className={`${card} mt-3 text-sm text-white/45`}>Aucune table active pour cette salle.</p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {tables.map((t) => {
                  const st = resaByTable.get(t.id);
                  return (
                    <div key={t.id} data-testid="ops-table" className="rounded-xl border px-2 py-3 text-center"
                      style={{ borderColor: st === "réservée" ? OPS : st === "option" ? "#fbbf24" : "rgba(255,255,255,.1)",
                               background: st ? `${st === "réservée" ? OPS : "#fbbf24"}1a` : "rgba(255,255,255,.02)" }}>
                      <p className="text-sm font-black text-white/85">{t.label}</p>
                      <p className="text-[10px] text-white/45">{t.standing ? "haute" : "assise"}{t.capacity ? ` · ${t.capacity}p` : ""}</p>
                      {st ? <p className="mt-0.5 text-[10px] font-black" style={{ color: st === "réservée" ? OPS : "#fbbf24" }}>{st}</p> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "resas" && (
          <div data-testid="ops-resas">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Réservations du soir</p>
            {resas.length === 0 ? (
              <p className={`${card} mt-3 text-sm text-white/45`}>Aucune réservation active.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {resas.map((r) => {
                  const t = tables.find((x) => x.id === r.venue_table_id);
                  return (
                    <li key={r.id} data-testid="ops-resa-row" className={`${card} flex items-center justify-between`}>
                      <span className="text-sm text-white/80">{t ? `Table ${t.label}` : "Table"} · {r.party_size} pers.{r.slot ? ` · ${r.slot}` : ""}</span>
                      <span className={`text-xs font-black ${STATUS_STYLE[r.status] ?? "text-white/60"}`}>{r.status}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "equipe" && (
          <div data-testid="ops-equipe">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Équipe du soir</p>
            {shifts.length === 0 ? (
              <p className={`${card} mt-3 text-sm text-white/45`}>Aucun créneau planifié aujourd&apos;hui.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {shifts.map((s) => (
                  <li key={s.id} data-testid="ops-shift-row" className={`${card} flex items-center justify-between`}>
                    <span className="text-sm text-white/80">{s.staff_members?.full_name || "—"}{s.poste ? ` · ${s.poste}` : ""}</span>
                    <span className={`text-xs font-black ${STATUS_STYLE[s.status] ?? "text-white/60"}`}>{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "plus" && (
          <div data-testid="ops-plus">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Incidents en cours</p>
            {incidents.filter((i) => ["ouvert", "en_cours", "escalade"].includes(i.status)).length === 0 ? (
              <p className={`${card} mt-3 text-sm text-white/45`}>Aucun incident actif. Tout est calme.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {incidents.filter((i) => ["ouvert", "en_cours", "escalade"].includes(i.status)).map((i) => (
                  <li key={i.id} data-testid="ops-incident-row" className={`${card}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-black text-white/85">{i.type}{i.niveau ? ` · ${i.niveau}` : ""}</span>
                      <span className={`text-xs font-black ${i.escalade ? "text-red-300" : "text-amber-300"}`}>{i.status}</span>
                    </div>
                    {i.description ? <p className="mt-1 text-xs text-white/50">{i.description}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-white/10 bg-black/95 backdrop-blur">
        {navItems.map(([key, label]) => (
          <button key={key} type="button" data-testid={`ops-nav-${key}`} onClick={() => setTab(key)}
            className={`py-3 text-[11px] font-black ${tab === key ? "" : "text-white/45"}`}
            style={tab === key ? { color: OPS } : undefined}>
            {label}
          </button>
        ))}
      </nav>
    </main>
  );
}

export default function OpsRoute() {
  return (
    <AuthProvider>
      <RequireAuth allow={OPS_ROLES}>
        <OpsInner />
      </RequireAuth>
    </AuthProvider>
  );
}
