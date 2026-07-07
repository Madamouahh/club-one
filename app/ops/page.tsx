"use client";

// /ops — SURFACE AUTONOME D'EXPLOITATION LIVE (mobile-first), réellement utilisable en soirée.
// Socle Auth partagé. Bottom-nav ≤5 (Soirée · Tables · Réservations · Équipe · Plus). Contenu cadré par
// RÔLE et RLS. « Plus » monte de VRAIS modules existants (scan QR, flux, incidents, checklist, clients,
// tâches). Le promoteur dispose de « Partager un lien » (create_invite_link_v1 + partage natif/copie/QR).
// Aucun backend nouveau : RPC/RLS/composants existants réutilisés. Action critique en ≤3 taps.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import { AuthProvider, RequireAuth, useAuth, defaultSurfaceForRole } from "@/app/_components/StaffAuth";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import ModeSoireeCockpit from "@/components/ModeSoireeCockpit";
import { loadActiveEventContext, type ActiveEventContext } from "@/lib/activeEvent";
import { buildLines, summarizeChecklist, type ChecklistItem, type ChecklistCompletion, type ChecklistLine } from "@/lib/checklists";
import type { InternalMessage, MessageRead } from "@/lib/internalComms";
import type { ArtistCheckin } from "@/lib/artistCheckin";
import type { Incident } from "@/lib/incidents";
import type { StaffRole } from "@/lib/permissions";

const OPS_ROLES: readonly StaffRole[] = ["admin", "manager", "server", "security", "security_counter", "promoter"];

type OpsTab = "soiree" | "tables" | "resas" | "equipe" | "plus";
type PlusMod = "menu" | "scan" | "flux" | "incidents" | "checklist" | "clients" | "taches" | "funnel";
type Funnel = { link_created?: number; link_opened?: number; profile_completed?: number; reservation_requested?: number; reservation_approved?: number; pass_issued?: number; checked_in?: number; client_returned?: number };
type LinkRow = { id: string; token: string; kind: string; univers: string; max_uses: number; uses_count: number; expires_at: string | null; created_at: string };
type VenueTable = { id: string; venue: string; label: string; standing: boolean; capacity: number | null };
type ResaRow = { id: string; status: string; party_size: number; slot: string | null; venue_table_id: string };
type ShiftRow = { id: string; poste: string | null; status: string; staff_members: { full_name: string } | null };
type GuestRow = { id: string; first_name: string | null; last_name: string | null; phone: string | null };
type TaskRow = { id: string; title: string; status: string; priority: string; due_date: string | null };

const shell = "min-h-screen bg-black text-white pb-20";
const card = "rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3";
const OPS = "#f5495b";
const STATUS_STYLE: Record<string, string> = {
  confirme: "text-emerald-300", present: "text-emerald-300", planifie: "text-amber-300",
  retard: "text-amber-300", absent: "text-red-300", annule: "text-white/40",
  pending: "text-amber-300", approved: "text-emerald-300", declined: "text-red-300", cancelled: "text-white/40",
  todo: "text-amber-300", doing: "text-sky-300", done: "text-emerald-300",
};
function today(): string { return new Date().toISOString().slice(0, 10); }

// Modules « Plus » disponibles selon le rôle (miroir UI ; la RLS reste l'autorité).
function plusModulesFor(role: StaffRole): { key: PlusMod; label: string }[] {
  const all: { key: PlusMod; label: string; roles: StaffRole[] }[] = [
    { key: "scan", label: "Scan QR", roles: ["admin", "manager", "security", "security_counter"] },
    { key: "flux", label: "Flux entrées", roles: ["admin", "manager", "security", "security_counter"] },
    { key: "incidents", label: "Incidents", roles: ["admin", "manager", "server", "security", "security_counter"] },
    { key: "checklist", label: "Checklist", roles: ["admin", "manager", "server", "security", "security_counter"] },
    { key: "clients", label: "Clients", roles: ["admin", "manager", "server", "promoter"] },
    { key: "taches", label: "Mes tâches", roles: ["admin", "manager", "server", "security", "security_counter", "promoter"] },
    { key: "funnel", label: "Mes conversions", roles: ["admin", "manager", "promoter"] },
  ];
  return all.filter((m) => m.roles.includes(role)).map(({ key, label }) => ({ key, label }));
}

function ShareLinkModal({ event, onClose }: { event: ActiveEventContext | null; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  const create = useCallback(async () => {
    setBusy(true); setErr("");
    // univers doit appartenir à {eden,cercle,terminus} (contrainte create_invite_link_v1). Si la soirée
    // active porte un univers non standard (données LABO), on retombe sur 'eden' pour générer un lien réel.
    const univers = ["eden", "cercle", "terminus"].includes(event?.venueId ?? "") ? (event!.venueId as string) : "eden";
    const r = await supabase.rpc("create_invite_link_v1", { p_kind: "guest_list", p_univers: univers, p_table_ref: null, p_max_uses: 20, p_expires_at: null });
    setBusy(false);
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (r.error || !row?.ok) { setErr(row?.message || "Impossible de générer le lien (soirée active requise)."); return; }
    setLink(`${window.location.origin}/i/${row.token}`);
  }, [event]);

  useEffect(() => { void create(); }, [create]);

  async function nativeShare() {
    if (link && typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "Invitation Club One", url: link }); } catch { /* annulé */ }
    }
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 sm:place-items-center" data-testid="share-modal" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border border-white/10 bg-[#0b0b0d] p-6 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">Partager une invitation</p>
        {err ? <p className="mt-3 text-sm text-red-300" data-testid="share-error">{err}</p> : null}
        {busy ? <p className="mt-3 text-sm text-white/50">Génération…</p> : null}
        {link ? (
          <>
            <div className="mt-4 grid place-items-center rounded-2xl bg-white p-4"><QRCodeSVG value={link} size={168} data-testid="share-qr" /></div>
            <p className="mt-3 break-all rounded-xl bg-white/[0.04] px-3 py-2 text-center text-[11px] text-white/50" data-testid="share-link">{link}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={nativeShare} data-testid="share-native" className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black">Partager</button>
              <button onClick={copy} data-testid="share-copy" className="rounded-2xl border border-white/15 px-4 py-3 font-black text-white/80">{copied ? "Copié ✓" : "Copier le lien"}</button>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[10px] text-white/40">
              <a href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 py-2">WhatsApp</a>
              <a href={`sms:?&body=${encodeURIComponent(link)}`} className="rounded-lg border border-white/10 py-2">SMS</a>
              <a href={`https://www.messenger.com/`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 py-2">Messenger</a>
              <button onClick={copy} className="rounded-lg border border-white/10 py-2">Insta</button>
            </div>
          </>
        ) : null}
        <button onClick={onClose} className="mt-5 w-full text-center text-xs font-black text-white/35 underline">Fermer</button>
      </div>
    </div>
  );
}

function OpsInner() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<OpsTab>("soiree");
  const [plus, setPlus] = useState<PlusMod>("menu");
  const [share, setShare] = useState(false);
  const [event, setEvent] = useState<ActiveEventContext | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [reads, setReads] = useState<MessageRead[]>([]);
  const [checkins, setCheckins] = useState<ArtistCheckin[]>([]);
  const [lines, setLines] = useState<ChecklistLine[]>([]);
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [resas, setResas] = useState<ResaRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [fluxIn, setFluxIn] = useState(0);
  const [fluxOut, setFluxOut] = useState(0);
  const [guestQuery, setGuestQuery] = useState("");
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [scanToken, setScanToken] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [myLinks, setMyLinks] = useState<LinkRow[]>([]);
  const [busy, setBusy] = useState(false);

  const date = useMemo(() => today(), []);
  const role = profile?.role;
  const username = profile?.username;

  const load = useCallback(async () => {
    const ev = await loadActiveEventContext(supabase);
    setEvent(ev);
    const venue = ev?.venueId ?? null;
    const [incRes, msgRes, readRes, checkRes, itemRes, compRes, tblRes, resaRes, shiftRes, taskRes, fInRes, fOutRes] = await Promise.all([
      supabase.from("incidents").select("*"),
      supabase.from("internal_messages").select("*").eq("exploitation_date", date),
      supabase.from("internal_message_reads").select("*"),
      supabase.from("artist_checkins").select("*").eq("exploitation_date", date),
      supabase.from("checklist_items").select("*").eq("active", true),
      supabase.from("checklist_completions").select("*").eq("exploitation_date", date),
      venue ? supabase.from("venue_tables").select("id, venue, label, standing, capacity").eq("venue", venue).eq("active", true).order("label")
            : supabase.from("venue_tables").select("id, venue, label, standing, capacity").eq("active", true).order("label"),
      supabase.from("table_reservation_requests").select("id, status, party_size, slot, venue_table_id").in("status", ["pending", "approved"]),
      supabase.from("staff_shifts").select("id, poste, status, staff_members(full_name)").eq("exploitation_date", date),
      username ? supabase.from("tasks").select("id, title, status, priority, due_date").eq("assignee_username", username).in("status", ["todo", "doing"]) : Promise.resolve({ data: [] }),
      supabase.from("entry_logs").select("*", { count: "exact", head: true }).eq("type", "entry").eq("event_date", ev?.eventDate ?? date),
      supabase.from("entry_logs").select("*", { count: "exact", head: true }).eq("type", "exit").eq("event_date", ev?.eventDate ?? date),
    ]);
    setIncidents((incRes.data as Incident[]) ?? []);
    setMessages((msgRes.data as InternalMessage[]) ?? []);
    setReads((readRes.data as MessageRead[]) ?? []);
    setCheckins((checkRes.data as ArtistCheckin[]) ?? []);
    setLines(buildLines((itemRes.data as ChecklistItem[]) ?? [], (compRes.data as ChecklistCompletion[]) ?? [], date));
    setTables((tblRes.data as VenueTable[]) ?? []);
    setResas((resaRes.data as ResaRow[]) ?? []);
    setShifts((shiftRes.data as unknown as ShiftRow[]) ?? []);
    setTasks((taskRes.data as TaskRow[]) ?? []);
    setFluxIn((fInRes as { count: number | null }).count ?? 0);
    setFluxOut((fOutRes as { count: number | null }).count ?? 0);
  }, [date, username]);

  useEffect(() => { void load(); }, [load]);

  // Funnel promoteur (Mes conversions) : chargé à l'ouverture du module. Données réelles (promoter_funnel_v1)
  // + liste de SES liens (RLS invite_links). Le funnel ne renvoie que les données du promoteur courant.
  useEffect(() => {
    if (plus !== "funnel") return;
    let active = true;
    (async () => {
      const [f, l] = await Promise.all([
        supabase.rpc("promoter_funnel_v1"),
        supabase.from("invite_links").select("id, token, kind, univers, max_uses, uses_count, expires_at, created_at").order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      const fd = (Array.isArray(f.data) ? f.data[0] : f.data) as (Funnel & { ok?: boolean }) | null;
      setFunnel(fd?.ok === false ? null : (fd as Funnel));
      setMyLinks((l.data as LinkRow[]) ?? []);
    })();
    return () => { active = false; };
  }, [plus]);

  const searchGuests = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setGuests([]); return; }
    const r = await supabase.from("guests").select("id, first_name, last_name, phone").or(`phone.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(15);
    setGuests((r.data as GuestRow[]) ?? []);
  }, []);

  async function addFlux(type: "entry" | "exit") {
    setBusy(true);
    await supabase.rpc("add_entry_log_v2", { p_type: type });
    await load();
    setBusy(false);
  }
  async function doScan() {
    if (!scanToken.trim()) return;
    setBusy(true);
    const r = await supabase.rpc("scan_guest_pass_v1", { p_qr_token: scanToken.trim() });
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    setScanResult(r.error ? "Erreur réseau." : `${row?.ok ? "✓" : "✗"} ${row?.message ?? ""}${row?.first_name ? " — " + row.first_name : ""}`);
    setScanToken("");
    setBusy(false);
  }

  if (!profile || !role) return null;

  const resaByTable = new Map<string, string>();
  for (const r of resas) resaByTable.set(r.venue_table_id, r.status === "approved" ? "réservée" : "option");
  const chk = summarizeChecklist(lines);
  const roleScope: Record<string, string> = { server: "Mon périmètre", promoter: "Mes tables & invitations", security: "Sécurité", security_counter: "Compteur", admin: "Vue globale", manager: "Vue globale" };

  return (
    <main className={shell} data-testid="ops-surface">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/90 px-5 py-3 backdrop-blur">
        <div>
          <p className="text-[11px] font-black tracking-[0.2em]" style={{ color: OPS }}>● LIVE · OPS</p>
          <p className="mt-0.5 text-xs text-white/45" data-testid="ops-event">
            {event ? `${event.venueName || event.venueId || "Soirée"} · ${event.eventDate}` : "Aucune soirée active"} · {roleScope[role]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {role === "promoter" ? (
            <button data-testid="ops-share-link" onClick={() => setShare(true)} className="rounded-lg bg-orange-500 px-2.5 py-1.5 text-[11px] font-black text-black">Partager un lien</button>
          ) : null}
          <Link href={defaultSurfaceForRole(role)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-black text-white/60">Accueil</Link>
        </div>
      </header>

      <div className="p-4">
        {tab === "soiree" && (
          <div data-testid="ops-soiree">
            <ModeSoireeCockpit role={role} username={profile.username} incidents={incidents} messages={messages} reads={reads} checkins={checkins} checklistLines={lines} />
          </div>
        )}

        {tab === "tables" && (
          <div data-testid="ops-tables">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Plan de tables {event?.venueId ? `· ${event.venueId}` : ""}</p>
            {tables.length === 0 ? <p className={`${card} mt-3 text-sm text-white/45`}>Aucune table active.</p> : (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {tables.map((t) => {
                  const st = resaByTable.get(t.id);
                  return (
                    <button key={t.id} data-testid="ops-table" className="rounded-xl border px-2 py-3 text-center"
                      style={{ borderColor: st === "réservée" ? OPS : st === "option" ? "#fbbf24" : "rgba(255,255,255,.1)", background: st ? `${st === "réservée" ? OPS : "#fbbf24"}1a` : "rgba(255,255,255,.02)" }}>
                      <p className="text-sm font-black text-white/85">{t.label}</p>
                      <p className="text-[10px] text-white/45">{t.standing ? "haute" : "assise"}{t.capacity ? ` · ${t.capacity}p` : ""}</p>
                      {st ? <p className="mt-0.5 text-[10px] font-black" style={{ color: st === "réservée" ? OPS : "#fbbf24" }}>{st}</p> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "resas" && (
          <div data-testid="ops-resas">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Réservations du soir</p>
            {resas.length === 0 ? <p className={`${card} mt-3 text-sm text-white/45`}>Aucune réservation active.</p> : (
              <ul className="mt-3 space-y-2">{resas.map((r) => { const t = tables.find((x) => x.id === r.venue_table_id); return (
                <li key={r.id} data-testid="ops-resa-row" className={`${card} flex items-center justify-between`}>
                  <span className="text-sm text-white/80">{t ? `Table ${t.label}` : "Table"} · {r.party_size} pers.{r.slot ? ` · ${r.slot}` : ""}</span>
                  <span className={`text-xs font-black ${STATUS_STYLE[r.status] ?? "text-white/60"}`}>{r.status}</span>
                </li>); })}</ul>
            )}
          </div>
        )}

        {tab === "equipe" && (
          <div data-testid="ops-equipe">
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Équipe du soir</p>
            {shifts.length === 0 ? <p className={`${card} mt-3 text-sm text-white/45`}>Aucun créneau aujourd&apos;hui.</p> : (
              <ul className="mt-3 space-y-2">{shifts.map((s) => (
                <li key={s.id} data-testid="ops-shift-row" className={`${card} flex items-center justify-between`}>
                  <span className="text-sm text-white/80">{s.staff_members?.full_name || "—"}{s.poste ? ` · ${s.poste}` : ""}</span>
                  <span className={`text-xs font-black ${STATUS_STYLE[s.status] ?? "text-white/60"}`}>{s.status}</span>
                </li>))}</ul>
            )}
          </div>
        )}

        {tab === "plus" && (
          <div data-testid="ops-plus">
            {plus === "menu" ? (
              <div className="grid grid-cols-2 gap-2" data-testid="ops-plus-menu">
                {plusModulesFor(role).map((m) => (
                  <button key={m.key} data-testid={`ops-plus-${m.key}`} onClick={() => setPlus(m.key)}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-left text-sm font-black text-white/80">{m.label} →</button>
                ))}
              </div>
            ) : (
              <div>
                <button data-testid="ops-plus-back" onClick={() => setPlus("menu")} className="mb-3 text-xs font-black text-white/40">← Plus</button>

                {plus === "scan" && (
                  <div data-testid="ops-plus-view-scan">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">Scan invitation / QR</p>
                    <div className="mt-3 flex gap-2">
                      <input data-testid="scan-input" value={scanToken} onChange={(e) => setScanToken(e.target.value)} placeholder="Coller le token du QR"
                        className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none" />
                      <button data-testid="scan-btn" disabled={busy || !scanToken} onClick={doScan} className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-black text-black disabled:opacity-50">Valider</button>
                    </div>
                    {scanResult ? <p className={`${card} mt-3 text-sm`} data-testid="scan-result">{scanResult}</p> : null}
                  </div>
                )}

                {plus === "flux" && (
                  <div data-testid="ops-plus-view-flux">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">Flux entrées / sorties</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className={card}><p className="text-3xl font-black tabular-nums" data-testid="flux-in">{fluxIn}</p><p className="text-xs text-white/45">entrées</p></div>
                      <div className={card}><p className="text-3xl font-black tabular-nums" data-testid="flux-out">{fluxOut}</p><p className="text-xs text-white/45">sorties</p></div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button data-testid="flux-add-in" disabled={busy} onClick={() => addFlux("entry")} className="rounded-2xl bg-emerald-500 px-4 py-3 font-black text-black disabled:opacity-50">+ Entrée</button>
                      <button data-testid="flux-add-out" disabled={busy} onClick={() => addFlux("exit")} className="rounded-2xl border border-white/15 px-4 py-3 font-black text-white/80 disabled:opacity-50">+ Sortie</button>
                    </div>
                  </div>
                )}

                {plus === "incidents" && (
                  <div data-testid="ops-plus-view-incidents">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">Incidents en cours</p>
                    {incidents.filter((i) => ["ouvert", "en_cours", "escalade"].includes(i.status)).length === 0 ? (
                      <p className={`${card} mt-3 text-sm text-white/45`}>Aucun incident actif.</p>
                    ) : (
                      <ul className="mt-3 space-y-2">{incidents.filter((i) => ["ouvert", "en_cours", "escalade"].includes(i.status)).map((i) => (
                        <li key={i.id} data-testid="ops-incident-row" className={card}>
                          <div className="flex items-center justify-between"><span className="text-sm font-black text-white/85">{i.type}{i.niveau ? ` · ${i.niveau}` : ""}</span>
                            <span className={`text-xs font-black ${i.escalade ? "text-red-300" : "text-amber-300"}`}>{i.status}</span></div>
                          {i.description ? <p className="mt-1 text-xs text-white/50">{i.description}</p> : null}
                        </li>))}</ul>
                    )}
                  </div>
                )}

                {plus === "checklist" && (
                  <div data-testid="ops-plus-view-checklist">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">Checklist — {chk.done}/{chk.total} faits</p>
                    {lines.length === 0 ? <p className={`${card} mt-3 text-sm text-white/45`}>Aucune checklist active.</p> : (
                      <ul className="mt-3 space-y-1.5">{lines.map((l) => (
                        <li key={l.item.id} data-testid="ops-checklist-row" className={`${card} flex items-center justify-between`}>
                          <span className="text-sm text-white/80">{l.item.label}</span>
                          <span className={`text-xs font-black ${l.done ? "text-emerald-300" : "text-white/40"}`}>{l.done ? "fait" : "à faire"}</span>
                        </li>))}</ul>
                    )}
                  </div>
                )}

                {plus === "clients" && (
                  <div data-testid="ops-plus-view-clients">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">Recherche client</p>
                    <input data-testid="client-search" value={guestQuery} onChange={(e) => { setGuestQuery(e.target.value); void searchGuests(e.target.value); }}
                      placeholder="Nom ou téléphone" className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none" />
                    <ul className="mt-3 space-y-2">{guests.map((g) => (
                      <li key={g.id} data-testid="client-row" className={`${card} text-sm text-white/80`}>{g.first_name || "—"} {g.last_name || ""} · {g.phone || "sans tél."}</li>
                    ))}</ul>
                  </div>
                )}

                {plus === "funnel" && (
                  <div data-testid="ops-plus-view-funnel">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">Mes conversions (funnel)</p>
                    {funnel ? (
                      <div className="mt-3 grid grid-cols-2 gap-2" data-testid="funnel-grid">
                        {([
                          ["Liens créés", funnel.link_created], ["Ouvertures", funnel.link_opened],
                          ["Profils complétés", funnel.profile_completed], ["Résas demandées", funnel.reservation_requested],
                          ["Résas approuvées", funnel.reservation_approved], ["Pass émis", funnel.pass_issued],
                          ["Arrivées scannées", funnel.checked_in], ["Clients revenus", funnel.client_returned],
                        ] as [string, number | undefined][]).map(([label, v], i) => (
                          <div key={i} className={card} data-testid="funnel-stage">
                            <p className="text-2xl font-black tabular-nums">{v ?? 0}</p>
                            <p className="text-[11px] text-white/45">{label}</p>
                          </div>
                        ))}
                      </div>
                    ) : <p className={`${card} mt-3 text-sm text-white/45`}>Funnel indisponible.</p>}
                    <p className="mt-4 text-xs uppercase tracking-[0.18em] text-white/40">Mes liens</p>
                    {myLinks.length === 0 ? <p className={`${card} mt-2 text-sm text-white/45`}>Aucun lien. Utilisez « Partager un lien ».</p> : (
                      <ul className="mt-2 space-y-2">{myLinks.map((l) => (
                        <li key={l.id} data-testid="funnel-link-row" className={`${card} flex items-center justify-between`}>
                          <span className="text-sm text-white/80">{l.univers} · {l.kind}</span>
                          <span className="text-xs text-white/45">{l.uses_count}/{l.max_uses} usages{l.expires_at ? " · expire" : ""}</span>
                        </li>))}</ul>
                    )}
                  </div>
                )}

                {plus === "taches" && (
                  <div data-testid="ops-plus-view-taches">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">Mes tâches immédiates</p>
                    {tasks.length === 0 ? <p className={`${card} mt-3 text-sm text-white/45`}>Aucune tâche en cours.</p> : (
                      <ul className="mt-3 space-y-2">{tasks.map((t) => (
                        <li key={t.id} data-testid="task-row" className={`${card} flex items-center justify-between`}>
                          <span className="text-sm text-white/80">{t.title}</span>
                          <span className={`text-xs font-black ${STATUS_STYLE[t.status] ?? "text-white/60"}`}>{t.status}</span>
                        </li>))}</ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {share ? <ShareLinkModal event={event} onClose={() => setShare(false)} /> : null}

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-white/10 bg-black/95 backdrop-blur">
        {([["soiree", "Soirée"], ["tables", "Tables"], ["resas", "Résas"], ["equipe", "Équipe"], ["plus", "Plus"]] as [OpsTab, string][]).map(([key, label]) => (
          <button key={key} type="button" data-testid={`ops-nav-${key}`} onClick={() => { setTab(key); if (key === "plus") setPlus("menu"); }}
            className={`py-3 text-[11px] font-black ${tab === key ? "" : "text-white/45"}`} style={tab === key ? { color: OPS } : undefined}>{label}</button>
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
