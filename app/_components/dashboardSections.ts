// dashboardSections — CONFIGURATION des sections /dashboard : chaque section = des sous-modules RÉELS
// (liste RLS + détail + action métier là où une RPC/écriture existe). Aucune section KPI-only.
// Réutilise les tables/RPC existantes ; la RLS reste l'autorité.

import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import type { SectionModule, DetailPair } from "@/app/_components/ListDetailSection";

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "—" : String(v));
const euros = (cents: unknown): string => (typeof cents === "number" ? `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €` : "—");
const first = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));

async function loadTable(table: string, select: string, opts?: { order?: string; asc?: boolean; limit?: number }): Promise<Row[]> {
  let qb = supabase.from(table).select(select);
  if (opts?.order) qb = qb.order(opts.order, { ascending: opts.asc ?? false });
  if (opts?.limit) qb = qb.limit(opts.limit);
  const r = await qb;
  if (r.error) throw r.error;
  return (r.data as unknown as Row[]) ?? [];
}
const pairs = (...p: [string, unknown][]): DetailPair[] => p.map(([label, value]) => ({ label, value: s(value) }));

export type DashSection = "direction" | "soirees" | "personnel" | "crm" | "relation" | "marketing" | "gestion" | "admin";

export const SECTION_MODULES: Record<Exclude<DashSection, "direction">, SectionModule[]> = {
  // ————————————————— 1. RELATION CLIENT —————————————————
  relation: [
    {
      key: "resas", label: "Demandes résa",
      load: () => loadTable("table_reservation_requests", "id, status, party_size, slot, exploitation_date, decline_reason, guest_id, venue_table_id, venue_tables(label), guests(first_name, phone)", { order: "created_at" }),
      rowMain: (r) => `${s(first<{ label?: string }>(r.venue_tables)?.label ? `Table ${first<{ label?: string }>(r.venue_tables)?.label}` : "Table")} · ${s(r.party_size)} pers.`,
      rowSub: (r) => `${s(first<{ first_name?: string }>(r.guests)?.first_name)} · ${s(r.exploitation_date)}${r.slot ? " · " + s(r.slot) : ""}`,
      rowBadge: (r) => s(r.status),
      matches: (r, q) => (s(first<{ first_name?: string }>(r.guests)?.first_name) + s(r.status)).toLowerCase().includes(q.toLowerCase()),
      detail: (r) => pairs(["Client", first<{ first_name?: string }>(r.guests)?.first_name], ["Téléphone", first<{ phone?: string }>(r.guests)?.phone], ["Personnes", r.party_size], ["Créneau", r.slot], ["Statut", r.status], ["Motif refus", r.decline_reason]),
      actions: (r) => (r.status === "pending" ? [
        { label: "Accepter", tone: "primary", run: async (row) => { const x = await supabase.rpc("decide_table_reservation_v1", { p_request_id: row.id as string, p_decision: "approve", p_decline_reason: null }); return x.error ? "Refusé : " + x.error.message : "Demande approuvée."; } },
        { label: "Refuser", tone: "danger", run: async (row) => { const x = await supabase.rpc("decide_table_reservation_v1", { p_request_id: row.id as string, p_decision: "decline", p_decline_reason: "Complet" }); return x.error ? "Refusé : " + x.error.message : "Demande refusée."; } },
      ] : []),
    },
    {
      key: "invitations", label: "Invitations",
      load: () => loadTable("guest_passes", "id, status, univers, exploitation_date, is_host, guests(first_name)", { order: "created_at" }),
      rowMain: (r) => `${s(first<{ first_name?: string }>(r.guests)?.first_name)} · ${s(r.univers)}`,
      rowSub: (r) => s(r.exploitation_date), rowBadge: (r) => s(r.status),
      detail: (r) => pairs(["Client", first<{ first_name?: string }>(r.guests)?.first_name], ["Univers", r.univers], ["Date", r.exploitation_date], ["Hôte", r.is_host ? "oui" : "non"], ["Statut", r.status]),
      actions: (r) => (r.status === "issued" ? [{ label: "Révoquer", tone: "danger", run: async (row) => { const x = await supabase.rpc("cancel_guest_pass_v1", { p_pass_id: row.id as string }); const d = first<{ message?: string }>(x.data); return x.error ? "Erreur" : d?.message ?? "Invitation révoquée."; } }] : []),
    },
    { key: "leads", label: "Leads", load: () => loadTable("commercial_leads", "id, contact_name, company, kind, status, estimated_value_cents, created_at", { order: "created_at" }), rowMain: (r) => s(r.contact_name), rowSub: (r) => `${s(r.company)} · ${s(r.kind)}`, rowBadge: (r) => s(r.status), matches: (r, q) => s(r.contact_name).toLowerCase().includes(q.toLowerCase()), detail: (r) => pairs(["Contact", r.contact_name], ["Société", r.company], ["Type", r.kind], ["Valeur estimée", euros(r.estimated_value_cents)], ["Statut", r.status]) },
    {
      key: "inbox", label: "Inbox",
      load: () => loadTable("contact_requests", "id, requester_type, full_name, phone, subject, message, status, created_at", { order: "created_at" }),
      rowMain: (r) => s(r.subject), rowSub: (r) => `${s(r.full_name)} · ${s(r.requester_type)}`, rowBadge: (r) => s(r.status),
      matches: (r, q) => (s(r.subject) + s(r.full_name)).toLowerCase().includes(q.toLowerCase()),
      detail: (r) => pairs(["De", r.full_name], ["Téléphone", r.phone], ["Sujet", r.subject], ["Message", r.message], ["Statut", r.status]),
      actions: (r) => (r.status !== "traite" && r.status !== "clos" ? [{ label: "Marquer traité", tone: "primary", run: async (row) => { const x = await supabase.from("contact_requests").update({ status: "traite", updated_at: new Date().toISOString() }).eq("id", row.id as string); return x.error ? "Refusé : " + x.error.message : "Demande traitée."; } }] : []),
    },
    { key: "reputation", label: "Réputation", load: () => loadTable("reviews", "id, source, rating, author, body, status, review_date", { order: "review_date" }), rowMain: (r) => `${s(r.author)} · ${s(r.rating)}★`, rowSub: (r) => `${s(r.source)} · ${s(r.review_date)}`, rowBadge: (r) => s(r.status), detail: (r) => pairs(["Auteur", r.author], ["Source", r.source], ["Note", `${s(r.rating)}/5`], ["Avis", r.body], ["Statut", r.status]) },
  ],

  // ————————————————— 2. CRM —————————————————
  crm: [
    {
      key: "clients", label: "Clients (fiche 360)",
      load: () => loadTable("guests", "id, first_name, last_name, phone, email, owner_promoter, created_at", { order: "created_at", limit: 100 }),
      rowMain: (r) => `${s(r.first_name)} ${s(r.last_name)}`, rowSub: (r) => `${s(r.phone)}${r.owner_promoter ? " · promo " + s(r.owner_promoter) : ""}`,
      matches: (r, q) => (s(r.first_name) + s(r.last_name) + s(r.phone)).toLowerCase().includes(q.toLowerCase()),
      detail: async (r) => {
        const x = await supabase.rpc("guest_360_v1", { p_guest_id: r.id as string });
        const d = first<Record<string, unknown>>(x.data);
        return pairs(["Nom", `${s(r.first_name)} ${s(r.last_name)}`], ["Téléphone", r.phone], ["Promoteur (attribution)", r.owner_promoter], ["Visites assises", d?.visits_seated_total], ["Dépense cumulée", euros(typeof d?.spend_attributed_total === "number" ? Math.round((d.spend_attributed_total as number) * 100) : null)], ["Demandes résa", d?.reservation_requests_total], ["Tags", Array.isArray(d?.tags) ? (d?.tags as string[]).join(", ") : "—"], ["Notes", d?.notes_count]);
      },
      actions: (r) => [{ label: "Ajouter une note", tone: "primary", run: async (row) => { const x = await supabase.from("guest_notes").insert({ guest_id: row.id as string, body: "Note ajoutée depuis le dashboard", author: "dashboard" }); return x.error ? "Refusé : " + x.error.message : "Note ajoutée."; } }],
    },
    { key: "fidelite", label: "Fidélité", load: () => loadTable("loyalty_accounts", "guest_id, points, tier, updated_at", { order: "points" }), rowMain: (r) => `${s(r.points)} pts · ${s(r.tier)}`, rowSub: (r) => s(r.guest_id), detail: (r) => pairs(["Points", r.points], ["Palier", r.tier]) },
  ],

  // ————————————————— 3. PERSONNEL —————————————————
  personnel: [
    {
      key: "planning", label: "Planning",
      load: () => loadTable("staff_shifts", "id, poste, status, exploitation_date, published_at, version, staff_members(full_name)", { order: "exploitation_date" }),
      rowMain: (r) => `${s(first<{ full_name?: string }>(r.staff_members)?.full_name)} · ${s(r.poste)}`, rowSub: (r) => `${s(r.exploitation_date)} · v${s(r.version)}`,
      rowBadge: (r) => (r.published_at ? s(r.status) : "brouillon"),
      matches: (r, q) => s(first<{ full_name?: string }>(r.staff_members)?.full_name).toLowerCase().includes(q.toLowerCase()),
      detail: (r) => pairs(["Salarié", first<{ full_name?: string }>(r.staff_members)?.full_name], ["Poste", r.poste], ["Date", r.exploitation_date], ["Statut", r.published_at ? r.status : "brouillon"], ["Version", r.version]),
      actions: (r) => (!r.published_at ? [{ label: "Publier", tone: "primary", run: async (row) => { const x = await supabase.rpc("publish_shift_v1", { p_shift_id: row.id as string }); const d = first<{ message?: string }>(x.data); return x.error ? "Erreur" : d?.message ?? "Publié."; } }] : []),
    },
    { key: "notifs", label: "Notifications", load: () => loadTable("staff_notifications", "id, staff_username, type, title, severity, status, created_at", { order: "created_at" }), rowMain: (r) => s(r.title), rowSub: (r) => `${s(r.staff_username)} · ${s(r.type)}`, rowBadge: (r) => s(r.status), detail: (r) => pairs(["Destinataire", r.staff_username], ["Type", r.type], ["Sévérité", r.severity], ["Statut", r.status]) },
    { key: "perf", label: "Assiduité", load: () => loadTable("staff_performance_v1", "*", { limit: 100 }), rowMain: (r) => s(r.full_name ?? r.username ?? r.staff_member_id), rowSub: (r) => `présences ${s(r.shifts_present ?? r.presents ?? "—")}`, detail: (r) => Object.entries(r).slice(0, 8).map(([k, v]) => ({ label: k, value: s(v) })) },
  ],

  // ————————————————— 4. SOIRÉES —————————————————
  soirees: [
    { key: "agenda", label: "Agenda", load: () => loadTable("events", "id, title, slug, event_date, venue_id, status, capacite", { order: "event_date" }), rowMain: (r) => s(r.title), rowSub: (r) => `${s(r.event_date)} · ${s(r.venue_id)}`, rowBadge: (r) => s(r.status), matches: (r, q) => s(r.title).toLowerCase().includes(q.toLowerCase()), detail: (r) => pairs(["Titre", r.title], ["Date", r.event_date], ["Univers", r.venue_id], ["Capacité", r.capacite], ["Statut", r.status]) },
    { key: "artistes", label: "Artistes", load: () => loadTable("artists", "id, stage_name, style, fee_cents, status", { order: "stage_name", asc: true }), rowMain: (r) => s(r.stage_name), rowSub: (r) => s(r.style), rowBadge: (r) => s(r.status), matches: (r, q) => s(r.stage_name).toLowerCase().includes(q.toLowerCase()), detail: (r) => pairs(["Nom de scène", r.stage_name], ["Style", r.style], ["Cachet", euros(r.fee_cents)], ["Statut", r.status]) },
    { key: "checklists", label: "Checklists", load: () => loadTable("checklist_items", "id, label, phase, category, venue, active", { order: "position", asc: true }), rowMain: (r) => s(r.label), rowSub: (r) => `${s(r.phase)} · ${s(r.venue)}`, rowBadge: (r) => (r.active ? "active" : "inactive"), detail: (r) => pairs(["Item", r.label], ["Phase", r.phase], ["Catégorie", r.category], ["Univers", r.venue]) },
    { key: "captation", label: "Captation", load: () => loadTable("shot_list_items", "id, label, sujet, format, venue, prioritaire", { order: "position", asc: true }), rowMain: (r) => s(r.label), rowSub: (r) => `${s(r.sujet)} · ${s(r.format)}`, rowBadge: (r) => (r.prioritaire ? "prioritaire" : null), detail: (r) => pairs(["Plan", r.label], ["Sujet", r.sujet], ["Format", r.format], ["Univers", r.venue]) },
  ],

  // ————————————————— 5. GESTION —————————————————
  gestion: [
    { key: "caisse", label: "Caisse (Z)", load: () => loadTable("caisse_z", "*", { order: "created_at", limit: 50 }), rowMain: (r) => s(r.exploitation_date ?? r.event_date ?? r.created_at), rowSub: (r) => euros(r.total_cents ?? r.montant_cents), detail: (r) => Object.entries(r).slice(0, 8).map(([k, v]) => ({ label: k, value: /cents/.test(k) ? euros(v) : s(v) })) },
    { key: "budget", label: "Budget", load: () => loadTable("budget_forecasts", "id, label, poste, montant_prevu_cents, event_id", { order: "created_at" }), rowMain: (r) => s(r.label), rowSub: (r) => s(r.poste), rowBadge: (r) => euros(r.montant_prevu_cents), detail: (r) => pairs(["Poste", r.label], ["Catégorie", r.poste], ["Montant prévu", euros(r.montant_prevu_cents)]) },
    { key: "stock", label: "Stock", load: () => loadTable("stock_items", "id, name, family, unit, par_level, venue, active", { order: "name", asc: true }), rowMain: (r) => s(r.name), rowSub: (r) => `${s(r.family)} · ${s(r.venue)}`, rowBadge: (r) => (r.active ? "actif" : "inactif"), matches: (r, q) => s(r.name).toLowerCase().includes(q.toLowerCase()), detail: (r) => pairs(["Référence", r.name], ["Famille", r.family], ["Unité", r.unit], ["Seuil", r.par_level]) },
    { key: "suppliers", label: "Fournisseurs", load: () => loadTable("suppliers", "*", { order: "created_at", limit: 100 }), rowMain: (r) => s(r.name ?? r.nom), rowSub: (r) => s(r.category ?? r.contact ?? ""), detail: (r) => Object.entries(r).slice(0, 8).map(([k, v]) => ({ label: k, value: s(v) })) },
    {
      key: "maintenance", label: "Maintenance",
      load: () => loadTable("maintenance_interventions", "id, kind, priority, status, description, resolved_at", { order: "created_at" }),
      rowMain: (r) => s(r.kind), rowSub: (r) => s(r.description), rowBadge: (r) => (r.resolved_at ? "résolu" : s(r.status)),
      detail: (r) => pairs(["Type", r.kind], ["Priorité", r.priority], ["Statut", r.status], ["Description", r.description]),
      actions: (r) => (!r.resolved_at ? [{ label: "Clôturer", tone: "primary", run: async (row) => { const x = await supabase.from("maintenance_interventions").update({ status: "resolu", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id as string); return x.error ? "Refusé : " + x.error.message : "Intervention clôturée."; } }] : []),
    },
  ],

  // ————————————————— 6. MARKETING —————————————————
  marketing: [
    { key: "campagnes", label: "Campagnes", load: () => loadTable("marketing_campaigns", "id, name, channel, status, budget_cents, spent_cents", { order: "created_at" }), rowMain: (r) => s(r.name), rowSub: (r) => s(r.channel), rowBadge: (r) => s(r.status), matches: (r, q) => s(r.name).toLowerCase().includes(q.toLowerCase()), detail: (r) => pairs(["Campagne", r.name], ["Canal", r.channel], ["Budget", euros(r.budget_cents)], ["Dépensé", euros(r.spent_cents)], ["Statut", r.status]) },
    { key: "audiences", label: "Audiences", load: () => loadTable("campaign_audiences", "*", { order: "created_at", limit: 100 }), rowMain: (r) => s(r.segment_key ?? r.name ?? r.id), rowSub: (r) => s(r.campaign_id ?? ""), detail: (r) => Object.entries(r).slice(0, 8).map(([k, v]) => ({ label: k, value: s(v) })) },
    { key: "promo", label: "Promotions", load: () => loadTable("promo_codes", "id, code, kind, status, max_uses, uses_count", { order: "created_at" }), rowMain: (r) => s(r.code), rowSub: (r) => s(r.kind), rowBadge: (r) => s(r.status), detail: (r) => pairs(["Code", r.code], ["Type", r.kind], ["Usages", `${s(r.uses_count)}/${s(r.max_uses)}`], ["Statut", r.status]) },
    { key: "outbox", label: "Outbox (journal)", load: () => loadTable("message_queue", "id, channel, status, to_address, created_at", { order: "created_at", limit: 100 }), rowMain: (r) => `${s(r.channel)} · ${s(r.to_address)}`, rowSub: (r) => s(r.created_at), rowBadge: (r) => s(r.status), detail: (r) => pairs(["Canal", r.channel], ["Destinataire", r.to_address], ["Statut", r.status]) },
  ],

  // ————————————————— 7. ADMINISTRATION —————————————————
  admin: [
    { key: "users", label: "Utilisateurs", load: () => loadTable("staff_users", "username, role, auth_id", { order: "username", asc: true }), rowMain: (r) => s(r.username), rowSub: (r) => s(r.role), rowBadge: (r) => s(r.role), matches: (r, q) => s(r.username).toLowerCase().includes(q.toLowerCase()), detail: (r) => pairs(["Identifiant", r.username], ["Rôle", r.role], ["Lié Auth", r.auth_id ? "oui" : "non"]) },
    { key: "tables", label: "Tables (plan)", load: () => loadTable("venue_tables", "id, venue, label, capacity, standing, active", { order: "label", asc: true }), rowMain: (r) => `${s(r.venue)} · ${s(r.label)}`, rowSub: (r) => `${s(r.capacity)}p`, rowBadge: (r) => (r.active ? "active" : "inactive"), matches: (r, q) => s(r.label).toLowerCase().includes(q.toLowerCase()), detail: (r) => pairs(["Univers", r.venue], ["Table", r.label], ["Capacité", r.capacity], ["Type", r.standing ? "haute" : "assise"]) },
    { key: "audit", label: "Journal d'audit", load: () => loadTable("audit_log", "id, occurred_at, actor_username, action, resource_type, summary", { order: "occurred_at", limit: 100 }), rowMain: (r) => s(r.summary ?? r.action), rowSub: (r) => `${s(r.actor_username)} · ${s(r.occurred_at)}`, rowBadge: (r) => s(r.resource_type), matches: (r, q) => (s(r.summary) + s(r.action)).toLowerCase().includes(q.toLowerCase()), detail: (r) => pairs(["Action", r.action], ["Acteur", r.actor_username], ["Ressource", r.resource_type], ["Résumé", r.summary], ["Quand", r.occurred_at]) },
  ],
};
