"use client";

// /dashboard — SURFACE AUTONOME DE MANAGEMENT (desktop). Socle Auth partagé (session fiable), réservé à
// la direction (garde de rôle). Sidebar PERSISTANTE 8 sections + contenu pleine largeur. MONTE DES MODULES
// EXISTANTS par composition — aucun backend nouveau :
//   · Direction → CommandCenter (20 domaines réels, tuiles cliquables) ;
//   · les autres sections → résumés RÉELS (comptes issus des tables métier, RLS = autorité).
// Le contenu détaillé de chaque module est monté de façon incrémentale sur cette coquille.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import { AuthProvider, RequireAuth, useAuth, defaultSurfaceForRole } from "@/app/_components/StaffAuth";
import Link from "next/link";
import CommandCenter from "@/components/CommandCenter";
import { buildCommandCenter, type CommandCenterInput } from "@/lib/commandCenter";
import { loadActiveEventContext, type ActiveEventContext } from "@/lib/activeEvent";
import type { StaffRole } from "@/lib/permissions";

const DASH_ROLES: readonly StaffRole[] = ["admin", "manager"];

type Section = "direction" | "soirees" | "personnel" | "crm" | "relation" | "marketing" | "gestion" | "admin";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "direction", label: "Direction" }, { key: "soirees", label: "Soirées" },
  { key: "personnel", label: "Personnel" }, { key: "crm", label: "CRM" },
  { key: "relation", label: "Relation client" }, { key: "marketing", label: "Marketing" },
  { key: "gestion", label: "Gestion" }, { key: "admin", label: "Administration" },
];

// Résumés réels par section : [libellé, table, filtre éventuel].
const SECTION_KPIS: Record<Exclude<Section, "direction">, { label: string; table: string; filter?: (q: ReturnType<typeof countQuery>) => unknown }[]> = {
  soirees: [{ label: "Soirées publiées", table: "events" }, { label: "Artistes (fiches)", table: "artists" }, { label: "Checklists", table: "checklist_items" }],
  personnel: [{ label: "Effectif actif", table: "staff_members" }, { label: "Créneaux", table: "staff_shifts" }, { label: "Notifications", table: "staff_notifications" }],
  crm: [{ label: "Clients", table: "guests" }, { label: "Visites", table: "guest_visits" }, { label: "Comptes fidélité", table: "loyalty_accounts" }],
  relation: [{ label: "Demandes résa", table: "table_reservation_requests" }, { label: "Inbox", table: "contact_requests" }, { label: "Leads", table: "commercial_leads" }, { label: "Avis", table: "reviews" }],
  marketing: [{ label: "Campagnes", table: "marketing_campaigns" }, { label: "Audiences", table: "campaign_audiences" }, { label: "Codes promo", table: "promo_codes" }],
  gestion: [{ label: "Postes budget", table: "budget_forecasts" }, { label: "Références stock", table: "stock_items" }, { label: "Fournisseurs", table: "suppliers" }, { label: "Interventions", table: "maintenance_interventions" }],
  admin: [{ label: "Comptes staff", table: "staff_users" }, { label: "Tables (plan)", table: "venue_tables" }, { label: "Journal audit", table: "audit_log" }],
};

function countQuery(table: string) {
  return supabase.from(table).select("*", { count: "exact", head: true });
}

const sidebarLink = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition";

function DashInner() {
  const { profile, signOut } = useAuth();
  const [section, setSection] = useState<Section>("direction");
  const [ccSignals, setCcSignals] = useState<Partial<CommandCenterInput>>({});
  const [ccEvent, setCcEvent] = useState<ActiveEventContext | null>(null);
  const [ccLoading, setCcLoading] = useState(true);
  const [kpis, setKpis] = useState<Record<string, number>>({});

  const loadCockpit = useCallback(async () => {
    setCcLoading(true);
    const ev = await loadActiveEventContext(supabase);
    setCcEvent(ev);
    const cnt = (b: PromiseLike<{ count: number | null }>) => Promise.resolve(b).then((r) => r.count ?? 0);
    const F = (t: string) => supabase.from(t).select("*", { count: "exact", head: true });
    const dstr = ev?.eventDate ?? new Date().toISOString().slice(0, 10);
    const venue = ev?.venueId ?? null;
    const shotBase = venue ? F("shot_list_items").eq("active", true).eq("venue", venue) : F("shot_list_items").eq("active", true);
    const chkBase = venue ? F("checklist_items").eq("active", true).eq("venue", venue) : F("checklist_items").eq("active", true);
    const [
      incA, incE, incC, resaP, tblOcc, tblTot, taches, leads, avis, camp, contrats, inbox, artistes, fid, budg, stock, maint, invit, evAv,
      presAtt, presPre, shotTot, shotDone, chkTot, chkDone,
    ] = await Promise.all([
      cnt(F("incidents").in("status", ["ouvert", "en_cours", "escalade"])),
      cnt(F("incidents").eq("escalade", true).in("status", ["ouvert", "en_cours", "escalade"])),
      cnt(F("incidents").eq("niveau", "critique").in("status", ["ouvert", "en_cours", "escalade"])),
      cnt(F("table_reservation_requests").eq("status", "pending")),
      cnt(F("table_reservation_requests").in("status", ["pending", "approved"])),
      cnt(F("venue_tables").eq("active", true)),
      cnt(F("tasks").in("status", ["todo", "doing"])),
      cnt(F("commercial_leads")),
      cnt(F("reviews").eq("status", "nouveau")),
      cnt(F("marketing_campaigns")),
      cnt(F("commercial_quotes")),
      cnt(F("contact_requests").in("status", ["nouveau", "en_cours"])),
      cnt(F("artist_checkins").eq("status", "attendu")),
      cnt(F("loyalty_accounts")),
      cnt(F("budget_forecasts")),
      cnt(F("stock_items").eq("active", true)),
      cnt(F("maintenance_interventions").is("resolved_at", null)),
      cnt(F("guest_passes").eq("status", "issued")),
      cnt(F("events").eq("status", "published")),
      cnt(F("staff_shifts").eq("exploitation_date", dstr)),
      cnt(F("staff_shifts").eq("exploitation_date", dstr).not("actual_start", "is", null)),
      cnt(shotBase),
      cnt(F("shot_captures").eq("exploitation_date", dstr).not("dam_ref", "is", null)),
      cnt(chkBase),
      cnt(F("checklist_completions").eq("exploitation_date", dstr)),
    ]);
    setCcSignals({
      incidents: { actifs: incA, escalades: incE, critiquesActifs: incC },
      resa: { pending: resaP },
      remplissage: { occupees: tblOcc, total: tblTot },
      presence: { presents: presPre, attendus: presAtt, coutComplet: true },
      captation: { aFaire: Math.max(0, shotTot - shotDone), total: shotTot },
      checklists: { ouverts: Math.max(0, chkTot - chkDone), total: chkTot },
      ca: { montantCents: 0, complet: false },
      taches: { value: taches, attentionWhen: taches > 0, detailWhenAttention: "à faire", detailOtherwise: "tout est fait" },
      leads_chauds: { value: leads, attentionWhen: leads > 0, detailWhenAttention: "à relancer", detailOtherwise: "aucun lead" },
      avis_a_traiter: { value: avis, attentionWhen: avis > 0, detailWhenAttention: "sans réponse", detailOtherwise: "tous traités" },
      campagnes: { value: camp, attentionWhen: false, detailOtherwise: "campagnes" },
      contrats: { value: contrats, attentionWhen: contrats > 0, detailWhenAttention: "devis en cours", detailOtherwise: "aucun devis" },
      inbox: { value: inbox, attentionWhen: inbox > 0, detailWhenAttention: "à traiter", detailOtherwise: "inbox vide" },
      artistes: { value: artistes, attentionWhen: artistes > 0, detailWhenAttention: "attendus", detailOtherwise: "aucun" },
      fidelite: { value: fid, attentionWhen: false, detailOtherwise: "comptes" },
      budget: { value: budg, attentionWhen: false, detailOtherwise: "postes" },
      stock: { value: stock, attentionWhen: false, detailOtherwise: "références" },
      maintenance: { value: maint, attentionWhen: maint > 0, detailWhenAttention: "ouvertes", detailOtherwise: "aucune" },
      invitations: { value: invit, attentionWhen: false, detailOtherwise: "à venir" },
      evenements: { aVenir: evAv, prochain: null },
    });
    setCcLoading(false);
  }, []);

  useEffect(() => {
    void loadCockpit();
  }, [loadCockpit]);

  // Résumés d'une section (comptes réels) chargés à l'ouverture.
  useEffect(() => {
    if (section === "direction") return;
    const items = SECTION_KPIS[section];
    let active = true;
    (async () => {
      const entries = await Promise.all(
        items.map(async (it) => {
          const r = await countQuery(it.table);
          return [it.table, r.count ?? 0] as const;
        }),
      );
      if (active) setKpis(Object.fromEntries(entries));
    })();
    return () => { active = false; };
  }, [section]);

  const ccView = useMemo(
    () => buildCommandCenter({
      ...ccSignals,
      activeEvent: ccEvent ? { label: ccEvent.venueName || ccEvent.venueId || "Soirée", date: ccEvent.eventDate, venue: ccEvent.venueId === "eden" ? "eden" : "terminus" } : null,
    }),
    [ccSignals, ccEvent],
  );

  if (!profile) return null;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-black text-white" data-testid="dashboard-surface">
      <aside data-testid="dash-sidebar" className="flex h-screen w-60 shrink-0 flex-col border-r border-white/10 bg-[#0a0a0b]">
        <div className="border-b border-white/10 px-5 py-4">
          <h1 className="text-[18px] font-light tracking-[0.3em]">CLUB <span className="text-orange-500">O</span>NE</h1>
          <p className="mt-1 text-[9px] uppercase tracking-[0.24em] text-white/35">Dashboard · {profile.role}</p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {SECTIONS.map((s) => {
            const on = section === s.key;
            return (
              <button key={s.key} data-testid={`dash-section-${s.key}`} onClick={() => setSection(s.key)}
                className={sidebarLink} style={{ borderLeft: `2px solid ${on ? "#ec4900" : "transparent"}`,
                  background: on ? "rgba(255,255,255,.06)" : "transparent", color: on ? "#fff" : "rgba(255,255,255,.55)" }}>
                {s.label}
              </button>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-white/10 p-3">
          <Link href={defaultSurfaceForRole(profile.role)} className="block rounded-lg border border-white/10 px-3 py-2 text-center text-[11px] font-black text-white/60">Accueil</Link>
          <Link href="/ops" className="block rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-[11px] font-black text-red-200">Mode opérationnel</Link>
          <button onClick={() => void signOut()} data-testid="dash-logout" className="w-full text-center text-[11px] font-black text-white/30 underline">Se déconnecter</button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-3">
          <h2 className="text-lg font-black">{SECTIONS.find((s) => s.key === section)?.label}</h2>
          <p className="text-xs text-white/40">{ccEvent ? `Soirée active · ${ccEvent.eventDate}` : "Aucune soirée active"}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {section === "direction" ? (
            <div data-testid="dash-direction" className="max-w-5xl">
              <CommandCenter role={profile.role} view={ccView} loading={ccLoading} onOpen={() => { /* navigation inter-modules : montée incrémentale */ }} />
            </div>
          ) : (
            <div data-testid={`dash-${section}`}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {SECTION_KPIS[section].map((it) => (
                  <div key={it.table} data-testid="dash-kpi" className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <p className="text-3xl font-black tabular-nums">{kpis[it.table] ?? "—"}</p>
                    <p className="mt-1 text-sm text-white/50">{it.label}</p>
                  </div>
                ))}
              </div>
              <p className="mt-6 max-w-2xl rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 text-sm text-white/45">
                Résumé réel de la section. Les vues détaillées (tableaux larges + panneau de détail) sont
                montées de façon incrémentale sur cette coquille, en réutilisant les modules existants.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function DashboardRoute() {
  return (
    <AuthProvider>
      <RequireAuth allow={DASH_ROLES}>
        <DashInner />
      </RequireAuth>
    </AuthProvider>
  );
}
