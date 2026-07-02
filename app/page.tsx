"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@supabase/supabase-js";
import { QrCheckInPanel } from "@/components/QrCheckInPanel";
import {
  activateClubEvent,
  bootstrapClubEvent,
  chooseActiveEventLifecycleAction,
  closeClubEvent,
  loadActiveEventRuntimeContext,
  loadActivatableClubEvents,
  loadSecurityTableSnapshot,
  requireActiveEvent,
  type ActiveEventCandidate,
  type ActiveEventContext,
  type ActiveEventRuntimeContext,
  type SecurityTableSnapshot,
} from "@/lib/activeEvent";
import {
  addExpenseMessage,
  buildAddExpenseArgs,
  buildCheckInArgs,
  checkInMessage,
  normalizeAddExpenseResponse,
  normalizeCheckInResponse,
  type AtomicExpenseResult,
  type CheckInResult,
} from "@/lib/atomicOperations";
import {
  authorizeTableGroupMutation,
  authorizeTableMutation,
} from "@/lib/authorizedOperations";
import {
  restoreStaffSession,
  signInStaffUser,
  signOutStaffUser,
  subscribeStaffAuthState,
} from "@/lib/authSession";
import {
  canAccessTable,
  canAccessQrFromTab,
  canEditTable,
  canSeeAllPromoters,
  canUseCriticalAction,
  canViewTab,
  initialTabForRole,
  permissionsForRole,
  visibleTabsForRole,
  type AppTab,
  type StaffRole,
} from "@/lib/permissions";
import {
  CAISSE_VENUES,
  VENUE_LABELS,
  buildCaisseZUpsert,
  catalogueDataReady,
  emptyCaisseZForm,
  formFromRecord,
  formatEuro,
  groupProduitsByCategorie,
  liveTotals,
  parseEuro,
  type CaisseZFormValues,
  type CaisseZRecord,
  type ProduitBar,
  type VenueId,
} from "@/lib/caisseZ";
import { buildPnlSoiree } from "@/lib/pnlSoiree";
import {
  CHARGE_CATEGORIES,
  CHARGE_STATUSES,
  CHARGE_CATEGORIE_LABELS,
  artistesChargeAmount,
  artistesDataReady,
  isChargeCategorie,
  isChargeStatus,
  summarizeArtistesCharges,
  type ArtistesSummary,
  type ChargeCategorie,
  type ChargeStatus,
  type SoireeCharge,
} from "@/lib/artistesExtras";
import {
  Bell,
  LayoutGrid,
  Table2,
  Users,
  CalendarDays,
  BarChart3,
  Phone,
  MessageCircle,
  X,
  Save,
  Search,
  Trash2,
  RotateCcw,
  Plus,
  Minus,
  LogOut,
  Wallet,
  AlertTriangle,
  TrendingUp,
  CalendarClock,
  Music,
} from "lucide-react";
import {
  rhDataReady,
  staffChargeAmount,
  summarizeMasseHoraire,
  type MasseHoraire,
  type StaffMember,
  type StaffShift,
} from "@/lib/rhPlanning";

type Status = "free" | "option" | "booked" | "arrived" | "vip";
type Tab = AppTab;

function requiredPublicEnv(
  name: string,
  value: string | undefined,
) {
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }

  return value;
}

const supabaseUrl = requiredPublicEnv(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

const supabaseAnonKey = requiredPublicEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const supabase = createClient(supabaseUrl, supabaseAnonKey);

type ExpenseItem = {
  id: string;
  label: string;
  amount: number;
  createdAt: string;
  dateKey?: string;
};

type StaffUser = {
  id: string;
  username: string;
  role: StaffRole;
  full_name: string;
};

type EntryLog = {
  id: string;
  type: "entry" | "exit";
  staff_username: string;
  created_at: string;
  event_id?: string | null;
  event_date?: string | null;
};

type AddExpenseOutcome = {
  ok: boolean;
  message?: string;
  table?: ClubTable | null;
};

type PromoterContact = {
  id: string;
  promoter_username: string;
  first_name: string;
  last_name: string;
  phone: string;
  notes: string;
  created_at: string;
  last_seen_at?: string | null;
  total_visits: number;
};

type PromoterGuestEntry = {
  id: string;
  event_date: string;
  promoter_username: string;
  contact_id?: string | null;
  guest_name: string;
  phone: string;
  access_mode: "avec_alcool" | "sans_alcool";
  payment_status: "regle" | "en_attente" | "offert";
  qr_token: string;
  checked_in: boolean;
  checked_in_at?: string | null;
  checked_in_by?: string;
  created_at: string;
};


// Annuaire d'AFFICHAGE uniquement — AUCUN secret ici.
// L'authentification passe par Supabase Auth (Phase 0b) ; les mots de passe vivent
// dans auth.users (hashés par Supabase), jamais dans le code ni dans staff_users.
// Ce tableau ne sert qu'à afficher un nom lisible à partir d'un identifiant.
const STAFF_DIRECTORY: { username: string; full_name: string }[] = [
  { username: "maxime", full_name: "Maxime" },
  { username: "jerome", full_name: "Jérôme" },
  { username: "anthony", full_name: "Anthony" },
  { username: "enguerrand", full_name: "Enguerrand" },
  { username: "jeremy", full_name: "Jeremy" },
  { username: "hanass", full_name: "Hanass" },
  { username: "mohamed", full_name: "Mohamed" },
  { username: "mathias", full_name: "Mathias" },
  { username: "quentin", full_name: "Quentin" },
  { username: "lawrence", full_name: "Lawrence" },
];

type ClubTable = {
  id: string;
  zone: string;
  x: number;
  y: number;
  status: Status;
  capacity: number;
  client?: string;
  phone?: string;
  people?: string;
  notes?: string;
  eventDate?: string;
  eventId?: string;
  booker?: string;
  assignedTo?: string;
  linkedGroupId?: string;
  linkedTables?: string[];
  expenses?: ExpenseItem[];
  revenueTotal?: number;
};

const STATUS: Record<
  Status,
  { label: string; dot: string; border: string; text: string; glow: string; bg: string }
> = {
  free: {
    label: "Libre",
    dot: "bg-emerald-400",
    border: "border-orange-500/70",
    text: "text-orange-500",
    glow: "shadow-[0_0_8px_rgba(236,73,0,.28)]",
    bg: "bg-orange-500/5",
  },
  option: {
    label: "Option",
    dot: "bg-amber-400",
    border: "border-amber-400",
    text: "text-amber-300",
    glow: "shadow-[0_0_12px_rgba(251,191,36,.45)]",
    bg: "bg-amber-500/15",
  },
  booked: {
    label: "Réservée",
    dot: "bg-red-500",
    border: "border-red-500",
    text: "text-red-300",
    glow: "shadow-[0_0_20px_rgba(239,68,68,.95)]",
    bg: "bg-red-500/25",
  },
  arrived: {
    label: "Arrivée",
    dot: "bg-cyan-400",
    border: "border-cyan-400",
    text: "text-cyan-300",
    glow: "shadow-[0_0_16px_rgba(34,211,238,.75)]",
    bg: "bg-cyan-500/15",
  },
  vip: {
    label: "VIP",
    dot: "bg-purple-500",
    border: "border-purple-500",
    text: "text-purple-200",
    glow: "shadow-[0_0_18px_rgba(168,85,247,.85)]",
    bg: "bg-purple-500/15",
  },
};

const INITIAL_TABLES: ClubTable[] = [
  { id: "B1", zone: "Espace B", x: 23, y: 11, status: "free", capacity: 6 },
  { id: "B2", zone: "Espace B", x: 23, y: 21, status: "free", capacity: 6 },
  { id: "B3", zone: "Espace B", x: 23, y: 31, status: "free", capacity: 6 },
  { id: "B4", zone: "Espace B", x: 23, y: 41, status: "free", capacity: 6 },

  { id: "C1", zone: "Face DJ", x: 23, y: 61, status: "free", capacity: 6 },
  { id: "C2", zone: "Face DJ", x: 23, y: 71, status: "free", capacity: 6 },
  { id: "C3", zone: "Face DJ", x: 23, y: 81, status: "free", capacity: 6 },
  { id: "C4", zone: "Face DJ", x: 23, y: 91, status: "free", capacity: 6 },

  { id: "A1", zone: "Espace A · table seule", x: 76, y: 10, status: "free", capacity: 6 },

  { id: "A2", zone: "Espace A · bloc central", x: 76, y: 22, status: "free", capacity: 6 },
  { id: "A3", zone: "Espace A · bloc central", x: 76, y: 32, status: "free", capacity: 6 },
  { id: "A4", zone: "Espace A · bloc central", x: 76, y: 42, status: "free", capacity: 6 },

  { id: "A5", zone: "Espace A · bloc bas", x: 76, y: 54, status: "free", capacity: 6 },
  { id: "A6", zone: "Espace A · bloc bas", x: 76, y: 64, status: "free", capacity: 6 },
  { id: "A7", zone: "Espace A · bloc bas", x: 76, y: 74, status: "free", capacity: 6 },

  { id: "VIP1", zone: "Carré VIP", x: 63, y: 86, status: "free", capacity: 10 },
  { id: "VIP2", zone: "Carré VIP", x: 84, y: 86, status: "free", capacity: 10 },
  { id: "VIP3", zone: "Carré VIP", x: 63, y: 94, status: "free", capacity: 12 },
];


function todayInputValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function phoneForWhatsapp(phone?: string) {
  if (!phone) return "";
  return phone.replace(/\D/g, "").replace(/^0/, "33");
}

function sortTables(a: ClubTable, b: ClubTable) {
  return a.id.localeCompare(b.id, "fr", { numeric: true });
}

function tableTotal(table: ClubTable) {
  return (table.expenses || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

function todayKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function tableTotalForDate(table: ClubTable, eventDate: string) {
  return (table.expenses || []).reduce((sum, item) => {
    // Les anciennes dépenses sans dateKey sont rattachées à la soirée active
    // pour ne pas perdre les saisies déjà faites pendant les tests.
    if (!item.dateKey || item.dateKey === eventDate) {
      return sum + (Number(item.amount) || 0);
    }

    return sum;
  }, 0);
}

function getGroupKey(table: ClubTable) {
  if (table.linkedGroupId) return table.linkedGroupId;

  if ((table.linkedTables || []).length) {
    return [table.id, ...(table.linkedTables || [])].sort().join("+");
  }

  return table.id;
}

function getGroupTables(table: ClubTable, allTables: ClubTable[]) {
  const groupKey = getGroupKey(table);

  if (groupKey === table.id && !(table.linkedTables || []).length) {
    return [table];
  }

  if (table.linkedGroupId) {
    const groupTables = allTables.filter((item) => item.linkedGroupId === table.linkedGroupId);
    return groupTables.length ? groupTables : [table];
  }

  const ids = new Set([table.id, ...(table.linkedTables || [])]);
  return allTables.filter((item) => ids.has(item.id));
}

function groupTotal(table: ClubTable, allTables: ClubTable[]) {
  const groupTables = getGroupTables(table, allTables);
  const seenExpenseIds = new Set<string>();

  return groupTables.reduce((groupSum, currentTable) => {
    const subtotal = (currentTable.expenses || []).reduce((sum, item) => {
      const expenseKey = item.id || `${currentTable.id}-${item.label}-${item.amount}-${item.createdAt}`;

      if (seenExpenseIds.has(expenseKey)) return sum;
      seenExpenseIds.add(expenseKey);

      return sum + (Number(item.amount) || 0);
    }, 0);

    return groupSum + subtotal;
  }, 0);
}

function groupTotalForDate(table: ClubTable, allTables: ClubTable[], eventDate: string) {
  const groupTables = getGroupTables(table, allTables);
  const seenExpenseIds = new Set<string>();

  return groupTables.reduce((groupSum, currentTable) => {
    const subtotal = (currentTable.expenses || []).reduce((sum, item) => {
      if (item.dateKey && item.dateKey !== eventDate) return sum;

      const expenseKey = item.id || `${currentTable.id}-${item.label}-${item.amount}-${item.createdAt}`;

      if (seenExpenseIds.has(expenseKey)) return sum;
      seenExpenseIds.add(expenseKey);

      return sum + (Number(item.amount) || 0);
    }, 0);

    return groupSum + subtotal;
  }, 0);
}

function uniqueGroupRows(tables: ClubTable[]) {
  const seen = new Set<string>();
  const rows: ClubTable[] = [];

  tables.forEach((table) => {
    const key = getGroupKey(table);

    if (seen.has(key)) return;

    seen.add(key);
    rows.push(table);
  });

  return rows;
}

function totalRevenueForDate(tables: ClubTable[], eventDate: string) {
  return uniqueGroupRows(tables).reduce(
    (sum, table) => sum + groupTotalForDate(table, tables, eventDate),
    0
  );
}

function spendGroupCountForDate(tables: ClubTable[], eventDate: string) {
  return uniqueGroupRows(tables).filter(
    (table) => groupTotalForDate(table, tables, eventDate) > 0
  ).length;
}

function groupIsActive(table: ClubTable, allTables: ClubTable[]) {
  const groupTables = getGroupTables(table, allTables);

  return groupTables.some(
    (item) =>
      item.status !== "free" ||
      !!item.client ||
      !!item.phone ||
      tableTotal(item) > 0
  );
}

function groupLabel(table: ClubTable) {
  return [table.id, ...(table.linkedTables || [])].join(" + ");
}

function groupBadge(table: ClubTable, allTables?: ClubTable[]) {
  if (!table.linkedGroupId && !(table.linkedTables || []).length) return "";

  if (!allTables || !table.linkedGroupId) return "G";

  const groupIds = Array.from(
    new Set(
      allTables
        .filter((item) => item.linkedGroupId)
        .map((item) => item.linkedGroupId)
    )
  ).sort();

  const index = groupIds.indexOf(table.linkedGroupId);

  return index >= 0 ? `G${index + 1}` : "G";
}

function normalizeLinkedTables(tableId: string, linkedTables?: string[]) {
  return Array.from(
    new Set(
      (linkedTables || [])
        .map((item) => item.trim().toUpperCase())
        .filter((item) => item && item !== tableId)
    )
  );
}

type DbTable = {
  id: string;
  zone: string;
  status: Status;
  capacity: number;
  client: string | null;
  phone: string | null;
  people: string | null;
  notes: string | null;
  event_date: string | null;
  event_id: string | null;
  booker: string | null;
  assigned_to: string | null;
  linked_group_id: string | null;
  linked_tables: string[] | null;
  expenses: ExpenseItem[] | null;
};

function mergeWithLayout(dbRows: DbTable[]): ClubTable[] {
  const byId = new Map(dbRows.map((row) => [row.id, row]));

  return INITIAL_TABLES.map((layoutTable) => {
    const row = byId.get(layoutTable.id);

    if (!row) {
      return { ...layoutTable, expenses: [] };
    }

    return {
      ...layoutTable,
      status: row.status === "vip" ? "free" : row.status || layoutTable.status,
      capacity: row.capacity ?? layoutTable.capacity,
      client: row.client || "",
      phone: row.phone || "",
      people: row.people || "",
      notes: row.notes || "",
      eventDate: row.event_date || "",
      eventId: row.event_id || "",
      booker: row.booker || "",
      assignedTo: row.assigned_to || "",
      linkedGroupId: row.linked_group_id || "",
      linkedTables: row.linked_tables || [],
      expenses: row.expenses || [],
    };
  });
}

function securityRowsToTables(rows: SecurityTableSnapshot[]): ClubTable[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  return INITIAL_TABLES.map((layoutTable) => {
    const row = byId.get(layoutTable.id);
    if (!row) return { ...layoutTable, expenses: [], revenueTotal: 0 };

    return {
      ...layoutTable,
      status: row.status === "vip" ? "free" : (row.status as Status) || layoutTable.status,
      client: row.client || "",
      phone: row.phone || "",
      people: row.people || "",
      notes: row.notes || "",
      eventDate: row.event_date || "",
      eventId: row.event_id || "",
      revenueTotal: Number(row.revenue_total) || 0,
      expenses: [],
    };
  });
}

function toDbRow(table: ClubTable, activeEvent: ActiveEventContext) {
  return {
    id: table.id,
    zone: table.zone,
    status: table.status,
    capacity: table.capacity,
    client: table.client || "",
    phone: table.phone || "",
    people: table.people || "",
    notes: table.notes || "",
    event_date: activeEvent.eventDate,
    event_id: activeEvent.eventId,
    booker: table.booker || "",
    assigned_to: table.assignedTo || "",
    linked_group_id: table.linkedGroupId || "",
    linked_tables: table.linkedTables || [],
    expenses: table.expenses || [],
    updated_at: new Date().toISOString(),
  };
}

async function seedTablesIfNeeded(user: StaffUser | null, activeEvent: ActiveEventContext | null) {
  const { data, error } = await supabase.from("club_tables").select("id");

  if (error) {
    console.error("Supabase select error:", error.message);
    return;
  }

  if (data && data.length > 0) return;
  if (!user || !canUseCriticalAction(user.role, "canManageGlobal")) return;
  if (!activeEvent) return;

  const rows = INITIAL_TABLES.map((table) =>
    toDbRow({ ...table, eventDate: activeEvent.eventDate, eventId: activeEvent.eventId, expenses: [] }, activeEvent)
  );

  const { error: insertError } = await supabase.from("club_tables").insert(rows);

  if (insertError) {
    console.error("Supabase seed error:", insertError.message);
  }
}

async function fetchTables() {
  const { data, error } = await supabase.from("club_tables").select("*");

  if (error) {
    console.error("Supabase fetch error:", error.message);
    return INITIAL_TABLES;
  }

  return mergeWithLayout((data || []) as DbTable[]);
}



function roleLabel(role: StaffUser["role"]) {
  const labels: Record<StaffUser["role"], string> = {
    admin: "Admin",
    manager: "Manager",
    server: "Serveur",
    security: "Sécurité",
    security_counter: "Compteur",
    promoter: "Promoteur",
  };

  return labels[role] || role;
}

async function fetchEntryLogs() {
  const { data, error } = await supabase
    .from("entry_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("Supabase entry_logs fetch error:", error.message);
    return [];
  }

  return (data || []) as EntryLog[];
}

async function fetchPromoterContacts() {
  const { data, error } = await supabase
    .from("promoter_contacts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("Supabase promoter_contacts fetch error:", error.message);
    return [];
  }

  return (data || []) as PromoterContact[];
}

async function fetchPromoterEntries(eventDate?: string) {
  let query = supabase
    .from("promoter_guest_entries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(800);

  if (eventDate) {
    query = query.eq("event_date", eventDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Supabase promoter_guest_entries fetch error:", error.message);
    return [];
  }

  return (data || []) as PromoterGuestEntry[];
}

// Catalogue produits bar (seed réel 0010). RLS : lisible du staff connecté. prix_achat/stock NULL
// tant que le fondateur n'a pas fourni facture + inventaire → états vides HONNÊTES côté UI.
async function fetchProduitsBar(): Promise<ProduitBar[]> {
  const { data, error } = await supabase
    .from("produits_bar")
    .select("*")
    .eq("actif", true)
    .order("categorie", { ascending: true })
    .order("nom", { ascending: true });

  if (error) {
    console.error("Supabase produits_bar fetch error:", error.message);
    return [];
  }

  return (data || []) as ProduitBar[];
}

// Relevés de clôture (Z) pour une date d'exploitation. RLS : directionnel uniquement (admin/manager).
// Un serveur/promoteur reçoit simplement une liste vide (policy caisse_z_direction_read).
async function fetchCaisseZForDate(exploitationDate: string): Promise<CaisseZRecord[]> {
  const { data, error } = await supabase
    .from("caisse_z")
    .select("*")
    .eq("exploitation_date", exploitationDate)
    .order("venue", { ascending: true });

  if (error) {
    console.error("Supabase caisse_z fetch error:", error.message);
    return [];
  }

  return (data || []) as CaisseZRecord[];
}

// RH / Planning (B7). RLS 0011 : la direction voit tout le personnel, un salarié verrait seulement
// sa fiche. Tables VIDES tant que le fondateur n'a pas fourni la vraie liste → état vide honnête.
async function fetchStaffMembers(): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from("staff_members")
    .select("*")
    .order("actif", { ascending: false })
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Supabase staff_members fetch error:", error.message);
    return [];
  }

  return (data || []) as StaffMember[];
}

// Shifts (planning prévu + pointage réel) d'une soirée. RLS 0011 : direction = tous, salarié = les siens.
async function fetchStaffShiftsForDate(exploitationDate: string): Promise<StaffShift[]> {
  const { data, error } = await supabase
    .from("staff_shifts")
    .select("*")
    .eq("exploitation_date", exploitationDate)
    .order("status", { ascending: true });

  if (error) {
    console.error("Supabase staff_shifts fetch error:", error.message);
    return [];
  }

  return (data || []) as StaffShift[];
}

// Coûts artistes/extras d'une soirée (B2/B3, table 0012). RLS directionnelle : la direction voit
// tout, tout autre rôle reçoit une liste vide (le budget de soirée n'est jamais exposé). Table VIDE
// tant que le fondateur n'a pas saisi les postes/cachets → état vide honnête.
async function fetchSoireeChargesForDate(exploitationDate: string): Promise<SoireeCharge[]> {
  const { data, error } = await supabase
    .from("soiree_charges")
    .select("*")
    .eq("exploitation_date", exploitationDate)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Supabase soiree_charges fetch error:", error.message);
    return [];
  }

  return (data || []) as SoireeCharge[];
}

function normalizeQrInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("qr") || url.pathname.split("/").filter(Boolean).pop() || trimmed;
  } catch {
    return trimmed;
  }
}


export default function Page() {
  const [tables, setTables] = useState<ClubTable[]>(INITIAL_TABLES);
  const [selected, setSelected] = useState<ClubTable | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [search, setSearch] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [entryLogs, setEntryLogs] = useState<EntryLog[]>([]);
  const [promoterContacts, setPromoterContacts] = useState<PromoterContact[]>([]);
  const [promoterEntries, setPromoterEntries] = useState<PromoterGuestEntry[]>([]);
  const [securityTables, setSecurityTables] = useState<ClubTable[]>([]);
  const [produitsBar, setProduitsBar] = useState<ProduitBar[]>([]);
  const [caisseZRecords, setCaisseZRecords] = useState<CaisseZRecord[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [staffShifts, setStaffShifts] = useState<StaffShift[]>([]);
  const [soireeCharges, setSoireeCharges] = useState<SoireeCharge[]>([]);
  const [saveError, setSaveError] = useState("");
  const [activeEvent, setActiveEvent] = useState<ActiveEventContext | null>(null);
  const [activeEventRuntime, setActiveEventRuntime] = useState<ActiveEventRuntimeContext>({
    activeEvent: null,
    bootstrapCompleted: false,
    bootstrapCompletedAt: null,
    lastClosedEventId: null,
  });
  const [activeEventChecked, setActiveEventChecked] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const activeEventDate = activeEvent?.eventDate || todayKey();

  const applySignedOutState = useCallback(() => {
    setCurrentUser(null);
    setSelected(null);
    setActiveTab("plan");
    setTables(INITIAL_TABLES);
    setEntryLogs([]);
    setPromoterContacts([]);
    setPromoterEntries([]);
    setSecurityTables([]);
    setProduitsBar([]);
    setCaisseZRecords([]);
    setSoireeCharges([]);
    setActiveEvent(null);
    setActiveEventRuntime({
      activeEvent: null,
      bootstrapCompleted: false,
      bootstrapCompletedAt: null,
      lastClosedEventId: null,
    });
    setActiveEventChecked(false);
    setDataRefreshKey(0);
    setIsOnline(false);
  }, []);

  // Référence toujours à jour de la soirée active, pour les handlers realtime
  // (évite une closure figée sur la valeur initiale — bug corrigé).
  const activeEventDateRef = useRef(activeEventDate);
  useEffect(() => {
    activeEventDateRef.current = activeEventDate;
  }, [activeEventDate]);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const user = await restoreStaffSession<StaffUser>(supabase);
      if (active && user) {
        setCurrentUser(user);
        setActiveTab(initialTabForRole(user.role));
        try {
          const runtime = await loadActiveEventRuntimeContext(supabase);
          setActiveEventRuntime(runtime);
          setActiveEvent(runtime.activeEvent);
        } catch (error) {
          console.error("Active event restore error:", error);
          setActiveEventRuntime({
            activeEvent: null,
            bootstrapCompleted: false,
            bootstrapCompletedAt: null,
            lastClosedEventId: null,
          });
          setActiveEvent(null);
        } finally {
          setActiveEventChecked(true);
        }
      }
    }

    loadProfile();

    // Si la session Supabase expire / est revoquee, on deconnecte l'UI.
    const unsubscribe = subscribeStaffAuthState<StaffUser>(supabase, (user) => {
      if (!active) return;
      if (!user) {
        applySignedOutState();
        return;
      }
      setCurrentUser(user);
      setActiveTab(initialTabForRole(user.role));
      loadActiveEventRuntimeContext(supabase)
        .then((runtime) => {
          setActiveEventRuntime(runtime);
          setActiveEvent(runtime.activeEvent);
        })
        .catch((error) => {
          console.error("Active event auth error:", error);
          setActiveEventRuntime({
            activeEvent: null,
            bootstrapCompleted: false,
            bootstrapCompletedAt: null,
            lastClosedEventId: null,
          });
          setActiveEvent(null);
        })
        .finally(() => {
          setActiveEventChecked(true);
        });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySignedOutState]);

  // Données + temps réel : UNIQUEMENT une fois authentifié.
  // Sous RLS (Phase 0b), un client non authentifié ne peut rien lire : il faut
  // donc charger après le login (sinon écran vide), et (ré)abonner le realtime
  // avec le JWT pour recevoir les changements autorisés.
  useEffect(() => {
    if (!currentUser) return;
    const user = currentUser;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function init() {
      let liveEvent: ActiveEventContext | null = null;
      try {
        const runtime = await loadActiveEventRuntimeContext(supabase);
        liveEvent = runtime.activeEvent;
        if (!active) return;
        setActiveEventRuntime(runtime);
        setActiveEvent(liveEvent);
      } catch (error) {
        console.error("Active event load error:", error);
        if (!active) return;
        setActiveEventRuntime({
          activeEvent: null,
          bootstrapCompleted: false,
          bootstrapCompletedAt: null,
          lastClosedEventId: null,
        });
        setActiveEvent(null);
      } finally {
        if (active) setActiveEventChecked(true);
      }

      if (!liveEvent) {
        if (!active) return;
        setTables(INITIAL_TABLES);
        setEntryLogs([]);
        setPromoterContacts([]);
        setPromoterEntries([]);
        setSecurityTables([]);
        setIsOnline(true);
        return;
      }

      await seedTablesIfNeeded(user, liveEvent);
      const [liveTables, liveLogs, liveContacts, livePromoterEntries] = await Promise.all([
        user.role === "security" ? Promise.resolve(INITIAL_TABLES) : fetchTables(),
        fetchEntryLogs(),
        fetchPromoterContacts(),
        fetchPromoterEntries(liveEvent?.eventDate),
      ]);
      if (!active) return;
      setTables(liveTables);
      setEntryLogs(liveLogs);
      setPromoterContacts(liveContacts);
      setPromoterEntries(livePromoterEntries);
      if (user.role === "security") {
        try {
          setSecurityTables(securityRowsToTables(await loadSecurityTableSnapshot(supabase)));
        } catch (error) {
          console.error("Security snapshot load error:", error);
          setSecurityTables([]);
        }
      } else {
        setSecurityTables([]);
      }
      setIsOnline(true);

      channel = supabase.channel("club_live_realtime");

      if (user.role !== "security") {
        channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "club_tables" }, async () => {
          setTables(await fetchTables());
        });
      }

      channel = channel
        .on("postgres_changes", { event: "*", schema: "public", table: "entry_logs" }, async () => {
          setEntryLogs(await fetchEntryLogs());
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "promoter_contacts" }, async () => {
          setPromoterContacts(await fetchPromoterContacts());
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "promoter_guest_entries" }, async () => {
          setPromoterEntries(await fetchPromoterEntries(activeEventDateRef.current));
        });

      channel.subscribe();
    }

    init();

    return () => {
      active = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [currentUser, dataRefreshKey]);

  useEffect(() => {
    if (!currentUser || !activeEvent || currentUser.role !== "security" || activeTab !== "security") return;

    let active = true;
    async function refreshSecuritySnapshot() {
      try {
        const rows = await loadSecurityTableSnapshot(supabase);
        if (active) setSecurityTables(securityRowsToTables(rows));
      } catch (error) {
        console.error("Security snapshot refresh error:", error);
      }
    }

    refreshSecuritySnapshot();
    const timer = window.setInterval(refreshSecuritySnapshot, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [currentUser, activeEvent, activeTab]);

  // Caisse / Z de clôture — directionnel uniquement. On ne charge le catalogue et les relevés que
  // lorsque l'onglet Caisse OU l'onglet P&L (qui relit les mêmes lignes caisse_z) est ouvert par un
  // admin/manager (la RLS renverrait de toute façon une liste vide aux autres rôles ; on évite la
  // requête inutile).
  useEffect(() => {
    const caisseTab = activeTab === "caisse" || activeTab === "pnl";
    if (!currentUser || !caisseTab || !canViewTab(currentUser.role, activeTab)) return;

    let active = true;
    async function loadCaisseData() {
      const [produits, records] = await Promise.all([
        fetchProduitsBar(),
        fetchCaisseZForDate(activeEventDate),
      ]);
      if (!active) return;
      setProduitsBar(produits);
      setCaisseZRecords(records);
    }

    loadCaisseData();
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, activeEventDate]);

  // RH / Planning (B7) — directionnel. On charge le personnel et les shifts lorsque l'onglet RH OU
  // l'onglet P&L (qui injecte le coût staff issu de la masse horaire) est ouvert par un admin/manager.
  // La RLS 0011 renverrait de toute façon une liste restreinte (ou vide) aux autres rôles ; on évite
  // la requête inutile. Le coût staff reste honnêtement null tant qu'aucun taux réel n'est renseigné.
  useEffect(() => {
    const rhTab = activeTab === "rh" || activeTab === "pnl";
    if (!currentUser || !rhTab || !canViewTab(currentUser.role, "rh")) return;

    let active = true;
    async function loadRhData() {
      const [members, shifts] = await Promise.all([
        fetchStaffMembers(),
        fetchStaffShiftsForDate(activeEventDate),
      ]);
      if (!active) return;
      setStaffMembers(members);
      setStaffShifts(shifts);
    }

    loadRhData();
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, activeEventDate]);

  // Coûts artistes/extras (B2/B3) — directionnel. Chargés lorsque l'onglet Artistes OU l'onglet P&L
  // (qui injecte la charge « artistes » issue de ces postes) est ouvert par un admin/manager. La RLS
  // 0012 renverrait de toute façon une liste vide aux autres rôles. Le coût reste honnêtement null
  // tant qu'un poste engagé n'a pas de montant.
  useEffect(() => {
    const artistesTab = activeTab === "artistes" || activeTab === "pnl";
    if (!currentUser || !artistesTab || !canViewTab(currentUser.role, "artistes")) return;

    let active = true;
    async function loadArtistesData() {
      const charges = await fetchSoireeChargesForDate(activeEventDate);
      if (!active) return;
      setSoireeCharges(charges);
    }

    loadArtistesData();
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, activeEventDate]);

  useEffect(() => {
    if (!currentUser) return;

    let active = true;
    async function refreshActiveEventOnFocus() {
      if (document.visibilityState !== "visible") return;
      try {
        const runtime = await loadActiveEventRuntimeContext(supabase);
        if (!active) return;
        setActiveEventRuntime(runtime);
        setActiveEvent(runtime.activeEvent);
        setActiveEventChecked(true);
      } catch (error) {
        console.error("Active event focus refresh error:", error);
        if (!active) return;
        setActiveEventRuntime({
          activeEvent: null,
          bootstrapCompleted: false,
          bootstrapCompletedAt: null,
          lastClosedEventId: null,
        });
        setActiveEvent(null);
        setActiveEventChecked(true);
      }
    }

    window.addEventListener("focus", refreshActiveEventOnFocus);
    document.addEventListener("visibilitychange", refreshActiveEventOnFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshActiveEventOnFocus);
      document.removeEventListener("visibilitychange", refreshActiveEventOnFocus);
    };
  }, [currentUser]);

  const visibleTables = useMemo(
    () => tables.filter((table) => canAccessTable(table, currentUser)),
    [tables, currentUser]
  );

  const securityActiveTables = useMemo(
    () =>
      securityTables
        .filter((table) => table.status !== "free" || table.client || table.phone)
        .sort(sortTables),
    [securityTables]
  );

  const statTables = currentUser?.role === "security" ? securityTables : visibleTables;

  const stats = useMemo(
    () => ({
      free: statTables.filter((table) => table.status === "free").length,
      option: statTables.filter((table) => table.status === "option").length,
      booked: statTables.filter((table) => table.status === "booked").length,
      arrived: statTables.filter((table) => table.status === "arrived").length,
      vip: statTables.filter((table) => table.id.startsWith("VIP")).length,
      // CA live de la soirée ouverte : même logique que les montants affichés sur le plan.
      // On ne filtre pas par dateKey ici, car la clôture/reset remet les tables à zéro.
      revenue: uniqueGroupRows(statTables).reduce(
        (sum, table) => sum + (table.revenueTotal ?? groupTotal(table, statTables)),
        0
      ),
      spendTables: uniqueGroupRows(statTables).filter(
        (table) => (table.revenueTotal ?? groupTotal(table, statTables)) > 0
      ).length,
    }),
    [statTables]
  );

  const activeTables = useMemo(
    () =>
      visibleTables
        .filter(
          (table) =>
            groupIsActive(table, visibleTables)
        )
        .sort(sortTables),
    [visibleTables]
  );

  const clients = useMemo(() => {
    const map = new Map<string, ClubTable[]>();

    visibleTables.forEach((table) => {
      if (!table.client && !table.phone) return;
      const key = `${table.client || "Sans nom"}|${table.phone || ""}`;
      const current = map.get(key) || [];
      current.push(table);
      map.set(key, current);
    });

    const rows = Array.from(map.entries()).map(([key, clientTables]) => {
      const [name, phone] = key.split("|");
      return {
        name,
        phone,
        tables: clientTables.sort(sortTables),
        totalSpend: uniqueGroupRows(clientTables).reduce(
          (sum, table) => sum + groupTotal(table, visibleTables),
          0
        ),
      };
    });

    return rows.filter((client) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return `${client.name} ${client.phone}`.toLowerCase().includes(q);
    });
  }, [visibleTables, search]);

  function denyMutation(message = "Action non autorisee pour ce role.") {
    setSaveError(message);
    alert(message);
  }

  async function saveTable(next: ClubTable) {
    setSaveError("");
    let liveEvent: ActiveEventContext;
    try {
      liveEvent = requireActiveEvent(activeEvent);
    } catch (error) {
      denyMutation(error instanceof Error ? error.message : "Aucun evenement actif fiable n'est configure.");
      return;
    }

    const currentTable = tables.find((table) => table.id === next.id);
    const authorization = authorizeTableMutation({
      user: currentUser,
      currentTable,
      nextTable: next,
    });
    if (!authorization.ok) {
      denyMutation(authorization.message);
      return;
    }

    const row = toDbRow(next, liveEvent);

    setTables((current) => current.map((table) => (table.id === next.id ? next : table)));
    setSelected(null);

    const { error } = await supabase
      .from("club_tables")
      .upsert(row, { onConflict: "id" });

    if (error) {
      const message = `ERREUR SAUVEGARDE ${next.id} : ${error.message}`;
      console.error(message, error);
      setSaveError(message);
      alert(message);
      return;
    }

    const liveTables = await fetchTables();
    setTables(liveTables);
  }

  async function addTableExpense(input: {
    tableId: string;
    label: string;
    amount: number;
  }): Promise<AddExpenseOutcome> {
    setSaveError("");
    try {
      requireActiveEvent(activeEvent);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Aucun evenement actif fiable n'est configure." };
    }

    const currentTable = tables.find((table) => table.id === input.tableId);
    const authorization = authorizeTableMutation({
      user: currentUser,
      currentTable,
    });
    if (!authorization.ok || !currentUser || !canUseCriticalAction(currentUser.role, "canAddExpense")) {
      return { ok: false, message: "Action non autorisee pour ce role." };
    }

    const built = buildAddExpenseArgs({
      tableId: input.tableId,
      label: input.label,
      amount: input.amount,
      dateKey: activeEventDate,
    });

    if (!built.ok) {
      return { ok: false, message: built.message };
    }

    let result: AtomicExpenseResult;
    try {
      const response = await supabase.rpc("add_expense_v3", built.args);
      result = normalizeAddExpenseResponse({
        data: response.data as AtomicExpenseResult[] | AtomicExpenseResult | null,
        error: response.error,
      });
    } catch (error) {
      result = {
        ok: false,
        code: "network_error",
        message: error instanceof Error ? error.message : "Erreur réseau pendant l'ajout de dépense.",
      };
    }

    if (!result.ok) {
      const message = addExpenseMessage(result);
      setSaveError(message);
      return { ok: false, message };
    }

    const liveTables = await fetchTables();
    setTables(liveTables);
    const liveTable = liveTables.find((table) => table.id === input.tableId) || null;
    if (liveTable) setSelected(liveTable);
    return { ok: true, table: liveTable };
  }

  async function saveTableWithGroup(next: ClubTable) {
    setSaveError("");
    let liveEvent: ActiveEventContext;
    try {
      liveEvent = requireActiveEvent(activeEvent);
    } catch (error) {
      denyMutation(error instanceof Error ? error.message : "Aucun evenement actif fiable n'est configure.");
      return;
    }

    const cleanLinkedTables = normalizeLinkedTables(next.id, next.linkedTables);
    const groupMembers = Array.from(new Set([next.id, ...cleanLinkedTables]));
    const shouldGroup = groupMembers.length > 1;
    const groupId = shouldGroup
      ? next.linkedGroupId || `GROUP-${Date.now()}`
      : "";

    const sharedData = {
      client: next.client || "",
      phone: next.phone || "",
      people: next.people || "",
      status: next.status,
      eventDate: liveEvent.eventDate,
      eventId: liveEvent.eventId,
      booker: next.booker || "",
      assignedTo: next.assignedTo || "",
      notes: next.notes || "",
    };

    const nextTables = tables.map((table) => {
      if (!groupMembers.includes(table.id)) {
        return table;
      }

      if (table.id === next.id) {
        return {
          ...next,
          ...sharedData,
          linkedGroupId: groupId,
          linkedTables: cleanLinkedTables,
        };
      }

      return {
        ...table,
        ...sharedData,
        linkedGroupId: groupId,
        linkedTables: groupMembers.filter((id) => id !== table.id),
      };
    });

    const currentGroupTables = groupMembers
      .map((id) => tables.find((table) => table.id === id))
      .filter((table): table is ClubTable => Boolean(table));
    const nextGroupTables = nextTables.filter((table) => groupMembers.includes(table.id));
    const authorization = authorizeTableGroupMutation({
      user: currentUser,
      currentTables: currentGroupTables,
      nextTables: nextGroupTables,
    });
    if (!authorization.ok) {
      denyMutation(authorization.message);
      return;
    }

    setTables(nextTables);
    setSelected(null);

    const rowsToSave = nextTables
      .filter((table) => groupMembers.includes(table.id))
      .map((table) => toDbRow(table, liveEvent));

    const { error } = await supabase
      .from("club_tables")
      .upsert(rowsToSave, { onConflict: "id" });

    if (error) {
      const message = `ERREUR GROUPE : ${error.message}`;
      console.error(message, error);
      setSaveError(message);
      alert(message);
      return;
    }

    const liveTables = await fetchTables();
    setTables(liveTables);
  }

  async function resetTable(tableId: string) {
    let liveEvent: ActiveEventContext;
    try {
      liveEvent = requireActiveEvent(activeEvent);
    } catch (error) {
      denyMutation(error instanceof Error ? error.message : "Aucun evenement actif fiable n'est configure.");
      return;
    }

    const initial = INITIAL_TABLES.find((item) => item.id === tableId);
    if (!initial) return;
    const currentTable = tables.find((item) => item.id === tableId);

    const reset: ClubTable = {
      ...initial,
      status: "free",
      client: "",
      phone: "",
      people: "",
      notes: "",
      eventDate: liveEvent.eventDate,
      eventId: liveEvent.eventId,
      booker: "",
      assignedTo: "",
      linkedGroupId: "",
      linkedTables: [],
      expenses: [],
    };

    const authorization = authorizeTableMutation({
      user: currentUser,
      currentTable,
      nextTable: reset,
    });
    if (!authorization.ok) {
      denyMutation(authorization.message);
      return;
    }

    setTables((current) => current.map((table) => (table.id === tableId ? reset : table)));
    setSelected(null);

    const { error } = await supabase
      .from("club_tables")
      .upsert(toDbRow(reset, liveEvent), { onConflict: "id" });

    if (error) {
      const message = `ERREUR RESET ${tableId} : ${error.message}`;
      console.error(message, error);
      setSaveError(message);
      alert(message);
    }
  }

  async function resetAll() {
    if (!currentUser || !canUseCriticalAction(currentUser.role, "canManageGlobal")) {
      alert("Action non autorisee pour ce role.");
      return;
    }

    let liveEvent: ActiveEventContext;
    try {
      liveEvent = requireActiveEvent(activeEvent);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Aucun evenement actif fiable n'est configure.");
      return;
    }

    const resetTables: ClubTable[] = INITIAL_TABLES.map((table) => ({
      ...table,
      status: "free",
      client: "",
      phone: "",
      people: "",
      notes: "",
      eventDate: liveEvent.eventDate,
      eventId: liveEvent.eventId,
      booker: "",
      assignedTo: "",
      linkedGroupId: "",
      linkedTables: [],
      expenses: [],
    }));

    setTables(resetTables);

    const { error } = await supabase
      .from("club_tables")
      .upsert(resetTables.map((table) => toDbRow(table, liveEvent)), { onConflict: "id" });

    if (error) {
      console.error("Supabase reset all error:", error.message);
    }
  }
  async function login(username: string, password: string) {
    const user = await signInStaffUser<StaffUser>(supabase, username, password);
    if (!user) return false;

    setCurrentUser(user);
    setActiveTab(initialTabForRole(user.role));
    try {
      const runtime = await loadActiveEventRuntimeContext(supabase);
      setActiveEventRuntime(runtime);
      setActiveEvent(runtime.activeEvent);
    } catch (error) {
      console.error("Active event login error:", error);
      setActiveEventRuntime({
        activeEvent: null,
        bootstrapCompleted: false,
        bootstrapCompletedAt: null,
        lastClosedEventId: null,
      });
      setActiveEvent(null);
    } finally {
      setActiveEventChecked(true);
    }
    return true;
  }

  async function logout() {
    await signOutStaffUser<StaffUser>(supabase);
    applySignedOutState();
  }

  async function refreshActiveEventAfterLifecycle() {
    const runtime = await loadActiveEventRuntimeContext(supabase);
    setActiveEventRuntime(runtime);
    setActiveEvent(runtime.activeEvent);
    setActiveEventChecked(true);
    setSelected(null);
    setDataRefreshKey((current) => current + 1);
    return runtime.activeEvent;
  }

  async function activateSelectedEvent(eventId: string) {
    const action = chooseActiveEventLifecycleAction({
      role: currentUser?.role || "",
      bootstrapCompleted: activeEventRuntime.bootstrapCompleted,
    });
    if (action === "none") {
      throw new Error("Action non autorisee pour ce role.");
    }

    const result = action === "activate"
      ? await activateClubEvent(supabase, eventId)
      : await bootstrapClubEvent(supabase, eventId);

    if (!result.ok) {
      throw new Error(result.message);
    }

    await refreshActiveEventAfterLifecycle();
  }

  async function addEntryLog(type: "entry" | "exit") {
    if (!currentUser) return;
    if (!canUseCriticalAction(currentUser.role, "canViewFlux")) {
      alert("Action non autorisee pour ce role.");
      return;
    }

    const { error } = await supabase.rpc("add_entry_log_v2", { p_type: type });

    if (error) {
      console.error("Supabase entry log error:", error.message);
    }
  }


  async function refreshPromoterModule() {
    const liveContacts = await fetchPromoterContacts();
    const livePromoterEntries = await fetchPromoterEntries(activeEventDate);
    setPromoterContacts(liveContacts);
    setPromoterEntries(livePromoterEntries);
  }

  async function createPromoterContact(input: {
    promoterUsername: string;
    firstName: string;
    lastName: string;
    phone: string;
    notes: string;
  }) {
    if (!currentUser || !canUseCriticalAction(currentUser.role, "canManagePromoters")) {
      alert("Action non autorisee pour ce role.");
      return false;
    }

    const promoterUsername = input.promoterUsername.trim().toLowerCase();
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const phone = input.phone.trim();

    if (!promoterUsername || (!firstName && !lastName && !phone)) {
      alert("Renseigne au moins un promoteur et un nom ou téléphone.");
      return false;
    }

    const { error } = await supabase.from("promoter_contacts").insert({
      promoter_username: promoterUsername,
      first_name: firstName,
      last_name: lastName,
      phone,
      notes: input.notes.trim(),
    });

    if (error) {
      alert(`ERREUR CLIENT PROMOTEUR : ${error.message}`);
      return false;
    }

    await refreshPromoterModule();
    return true;
  }

  // Saisie manuelle du Z de clôture (upsert idempotent sur (date, univers)). Club One LIT la caisse,
  // il n'encaisse jamais : ceci écrit une ligne de REPORTING, pas un journal de caisse. La RLS 0010
  // refuse déjà tout rôle non directionnel ; on double-garde côté client par cohérence UX.
  async function saveCaisseZ(form: CaisseZFormValues): Promise<{ ok: boolean; message: string }> {
    if (!currentUser || !canViewTab(currentUser.role, "caisse")) {
      return { ok: false, message: "Action réservée à la direction." };
    }

    // Ne rattache à l'événement actif que si la date du Z correspond à la soirée active
    // (sinon on laisse event_id null plutôt que de créer un lien faux).
    const eventId =
      activeEvent && activeEvent.eventDate === form.exploitationDate ? activeEvent.eventId : null;

    const built = buildCaisseZUpsert(form, { eventId, saisiPar: currentUser.username });
    if (!built.ok) {
      return { ok: false, message: built.message };
    }

    const { error } = await supabase
      .from("caisse_z")
      .upsert(built.row, { onConflict: "exploitation_date,venue" });

    if (error) {
      return { ok: false, message: `Enregistrement refusé : ${error.message}` };
    }

    setCaisseZRecords(await fetchCaisseZForDate(built.row.exploitation_date));
    return { ok: true, message: `Z enregistré — ${VENUE_LABELS[built.row.venue]}.` };
  }

  // Ajoute un poste de coût artistes/extras à la soirée (insert). Le montant peut rester vide (poste
  // pressenti pas encore chiffré) : on n'invente jamais un cachet. La RLS 0012 refuse déjà tout rôle
  // non directionnel ; double-garde côté client par cohérence UX.
  async function addSoireeCharge(input: {
    categorie: ChargeCategorie;
    label: string;
    montant: number | null;
    statut: ChargeStatus;
  }): Promise<{ ok: boolean; message: string }> {
    if (!currentUser || !canViewTab(currentUser.role, "artistes")) {
      return { ok: false, message: "Action réservée à la direction." };
    }
    if (!input.label.trim()) {
      return { ok: false, message: "Libellé du poste manquant." };
    }

    const eventId =
      activeEvent && activeEvent.eventDate === activeEventDate ? activeEvent.eventId : null;

    const { error } = await supabase.from("soiree_charges").insert({
      exploitation_date: activeEventDate,
      event_id: eventId,
      categorie: input.categorie,
      label: input.label.trim(),
      montant_ttc: input.montant,
      statut: input.statut,
      saisi_par: currentUser.username,
    });

    if (error) {
      return { ok: false, message: `Enregistrement refusé : ${error.message}` };
    }

    setSoireeCharges(await fetchSoireeChargesForDate(activeEventDate));
    return { ok: true, message: "Poste ajouté." };
  }

  // Supprime un poste de coût (une ligne saisie par erreur). RLS directionnelle (policy delete 0012).
  async function deleteSoireeCharge(id: string): Promise<{ ok: boolean; message: string }> {
    if (!currentUser || !canViewTab(currentUser.role, "artistes")) {
      return { ok: false, message: "Action réservée à la direction." };
    }
    const { error } = await supabase.from("soiree_charges").delete().eq("id", id);
    if (error) {
      return { ok: false, message: `Suppression refusée : ${error.message}` };
    }
    setSoireeCharges(await fetchSoireeChargesForDate(activeEventDate));
    return { ok: true, message: "Poste supprimé." };
  }

  async function createPromoterInvitation(input: {
    contact: PromoterContact;
    accessMode: "avec_alcool" | "sans_alcool";
    paymentStatus: "regle" | "en_attente" | "offert";
  }) {
    if (!currentUser || !canUseCriticalAction(currentUser.role, "canManageInvitations")) {
      alert("Action non autorisee pour ce role.");
      return false;
    }

    const guestName = `${input.contact.first_name || ""} ${input.contact.last_name || ""}`.trim() || input.contact.phone || "Client";
    try {
      requireActiveEvent(activeEvent);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Aucun evenement actif fiable n'est configure.");
      return false;
    }

    const { data, error } = await supabase.rpc("create_promoter_invitation_v2", {
      p_promoter_username: input.contact.promoter_username,
      p_contact_id: input.contact.id,
      p_guest_name: guestName,
      p_phone: input.contact.phone || "",
      p_access_mode: input.accessMode,
      p_payment_status: input.paymentStatus,
    });

    const result = Array.isArray(data) ? data[0] : data;
    if (error || !result?.ok) {
      alert(`ERREUR QR PROMOTEUR : ${error?.message || result?.message || "Invitation impossible."}`);
      return false;
    }

    await refreshPromoterModule();
    return true;
  }

  async function updatePromoterEntryPayment(entryId: string, paymentStatus: "regle" | "en_attente" | "offert") {
    if (!currentUser || !canUseCriticalAction(currentUser.role, "canManageInvitations")) {
      alert("Action non autorisee pour ce role.");
      return;
    }

    const { error } = await supabase
      .from("promoter_guest_entries")
      .update({ payment_status: paymentStatus })
      .eq("id", entryId);

    if (error) {
      alert(`ERREUR PAIEMENT : ${error.message}`);
      return;
    }

    await refreshPromoterModule();
  }

  async function validatePromoterQr(rawToken: string): Promise<boolean> {
    if (!currentUser) return false;
    if (!canUseCriticalAction(currentUser.role, "canCheckInQr")) {
      alert("Action non autorisee pour ce role.");
      return false;
    }

    const token = normalizeQrInput(rawToken);
    const built = buildCheckInArgs({ token, eventDate: activeEventDate });
    if (!built.ok) {
      alert(built.message);
      return false;
    }

    let result: CheckInResult;
    try {
      const response = await supabase.rpc("check_in_invitation_v2", built.args);
      result = normalizeCheckInResponse({
        data: response.data as CheckInResult[] | CheckInResult | null,
        error: response.error,
      });
    } catch (error) {
      result = {
        ok: false,
        code: "network_error",
        message: error instanceof Error ? error.message : "Erreur réseau pendant la validation QR.",
      };
    }

    await refreshPromoterModule();
    if (currentUser.role === "security") {
      try {
        setSecurityTables(securityRowsToTables(await loadSecurityTableSnapshot(supabase)));
      } catch (error) {
        console.error("Security snapshot QR refresh error:", error);
      }
    }
    alert(checkInMessage(result));
    return result.ok;
  }


  async function closeSession() {
    if (!currentUser || !canUseCriticalAction(currentUser.role, "canCloseEvent")) {
      alert("Action non autorisee pour ce role.");
      return;
    }

    const confirmed = window.confirm(
      `Clôturer la soirée du ${activeEventDate} ? Les stats seront archivées puis les tables seront remises à zéro.`
    );

    if (!confirmed) return;
    try {
      const result = await closeClubEvent(supabase);
      if (!result.ok) {
        alert(result.message);
        return;
      }
      setActiveEvent(null);
      setActiveEventRuntime({
        activeEvent: null,
        bootstrapCompleted: true,
        bootstrapCompletedAt: activeEventRuntime.bootstrapCompletedAt,
        lastClosedEventId: result.eventId,
      });
      setTables(INITIAL_TABLES);
      setEntryLogs([]);
      setPromoterEntries([]);
      setSecurityTables([]);
      setSelected(null);
      setDataRefreshKey((current) => current + 1);
      alert(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur pendant la cloture atomique.";
      console.error("Supabase close event error:", error);
      alert(message);
    }
  }



  function markArrived(tableId: string) {
    const table = tables.find((item) => item.id === tableId);
    if (!table) return;

    saveTable({ ...table, status: "arrived" });
  }

  if (!currentUser) {
    return <LoginView onLogin={login} />;
  }

  if (!activeEventChecked) {
    return (
      <div className="h-screen bg-black text-white">
        <div className="mx-auto flex h-screen w-full max-w-[430px] items-center justify-center border-x border-white/10 px-6 text-center">
          <div>
            <div className="text-lg font-black">Chargement de la soiree</div>
            <p className="mt-2 text-sm text-white/50">Verification du contexte operationnel.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <ActiveEventBootstrapView
        role={currentUser.role}
        username={currentUser.username}
        bootstrapCompleted={activeEventRuntime.bootstrapCompleted}
        onLogout={logout}
        onActivateEvent={activateSelectedEvent}
      />
    );
  }

  const effectiveActiveTab = canViewTab(currentUser.role, activeTab)
    ? activeTab
    : initialTabForRole(currentUser.role);
  const currentPermissions = permissionsForRole(currentUser.role);

  return (
    <div className="h-screen overflow-hidden bg-[#050505] text-white">
      <div className="mx-auto flex h-screen w-full max-w-[430px] flex-col overflow-hidden border-x border-white/10 bg-black">
        <header className="shrink-0 border-b border-white/10 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[20px] font-light tracking-[0.38em]">
                CLUB <span className="text-orange-500">O</span>NE
              </h1>
              <p className="mt-1 text-[8px] uppercase tracking-[0.28em] text-white/40">
                {isOnline ? `Live · soirée du ${activeEventDate}` : "Connexion live..."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-[10px] font-black text-white/70">{currentUser.full_name}</p>
                <p className="text-[8px] uppercase tracking-[0.15em] text-orange-400">{roleLabel(currentUser.role)}</p>
              </div>
              <button onClick={logout} className="rounded-2xl border border-white/10 bg-white/5 p-2">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        <div className={`grid shrink-0 ${currentPermissions.canViewStats ? "grid-cols-4" : "grid-cols-3"} gap-2 p-2 text-center text-[8px]`}>
          <Stat value={stats.free} label="Libres" color="text-emerald-400" />
          <Stat value={stats.option} label="Options" color="text-amber-300" />
          <Stat value={stats.booked} label="Réservées" color="text-red-300" />
          {/* CA global réservé au directionnel : masqué pour promoteur/serveur (canViewStats=false). */}
          {currentPermissions.canViewStats && (
            <Stat value={`${stats.revenue}€`} label="CA tables" color="text-cyan-300" />
          )}
        </div>

        {saveError && (
          <div className="mx-2 mb-2 rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
            {saveError}
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-hidden p-2">
          {effectiveActiveTab === "plan" && canViewTab(currentUser.role, "plan") && (
            <PlanView tables={visibleTables} onSelect={setSelected} />
          )}

          {effectiveActiveTab === "reservations" && canViewTab(currentUser.role, "reservations") && (
            <ReservationsView
              tables={activeTables}
              allTables={visibleTables}
              onSelect={setSelected}
              onReset={resetTable}
            />
          )}

          {effectiveActiveTab === "clients" && canViewTab(currentUser.role, "clients") && (
            <ClientsView
              clients={clients}
              allTables={visibleTables}
              search={search}
              onSearch={setSearch}
              onSelectTable={setSelected}
            />
          )}

          {effectiveActiveTab === "security" && canViewTab(currentUser.role, "security") && (
            <SecurityView
              role={currentUser.role}
              tables={currentUser.role === "security" ? securityActiveTables : activeTables}
              search={search}
              onSearch={setSearch}
              onSelect={setSelected}
              onMarkArrived={markArrived}
              onValidateQr={validatePromoterQr}
            />
          )}

          {effectiveActiveTab === "flux" && canViewTab(currentUser.role, "flux") && (
            <FluxView
              role={currentUser.role}
              logs={entryLogs}
              onEntry={() => addEntryLog("entry")}
              onExit={() => addEntryLog("exit")}
              onValidateQr={validatePromoterQr}
            />
          )}

          {effectiveActiveTab === "promoters" && canViewTab(currentUser.role, "promoters") && (
            <PromotersView
              currentUser={currentUser}
              activeEventDate={activeEventDate}
              contacts={promoterContacts}
              entries={promoterEntries}
              onCreateContact={createPromoterContact}
              onCreateInvitation={createPromoterInvitation}
              onUpdatePayment={updatePromoterEntryPayment}
            />
          )}

          {effectiveActiveTab === "stats" && canViewTab(currentUser.role, "stats") && (
            <StatsView
              stats={stats}
              tables={visibleTables}
              entryLogs={entryLogs}
              activeEventDate={activeEventDate}
              onChangeEventDate={() => undefined}
              onCloseSession={closeSession}
              onResetAll={resetAll}
              canCloseSession={currentPermissions.canCloseEvent}
              canResetAll={currentPermissions.canManageGlobal}
            />
          )}

          {effectiveActiveTab === "caisse" && canViewTab(currentUser.role, "caisse") && (
            <CaisseView
              exploitationDate={activeEventDate}
              hasActiveEvent={!!activeEvent}
              produits={produitsBar}
              records={caisseZRecords}
              onSave={saveCaisseZ}
            />
          )}

          {effectiveActiveTab === "pnl" && canViewTab(currentUser.role, "pnl") && (
            <PnlView
              exploitationDate={activeEventDate}
              hasActiveEvent={!!activeEvent}
              caisseRecords={caisseZRecords}
              caTables={stats.revenue}
              entryLogs={entryLogs}
              staffMembers={staffMembers}
              staffShifts={staffShifts}
              soireeCharges={soireeCharges}
            />
          )}

          {effectiveActiveTab === "rh" && canViewTab(currentUser.role, "rh") && (
            <RhView
              exploitationDate={activeEventDate}
              hasActiveEvent={!!activeEvent}
              members={staffMembers}
              shifts={staffShifts}
            />
          )}

          {effectiveActiveTab === "artistes" && canViewTab(currentUser.role, "artistes") && (
            <ArtistesView
              exploitationDate={activeEventDate}
              hasActiveEvent={!!activeEvent}
              charges={soireeCharges}
              onAdd={addSoireeCharge}
              onDelete={deleteSoireeCharge}
            />
          )}
        </main>

        <BottomNav activeTab={effectiveActiveTab} onChange={setActiveTab} user={currentUser} />
      </div>

      <TableModal
        key={selected?.id ?? "closed-table-modal"}
        table={selected}
        onClose={() => setSelected(null)}
        onSave={saveTable}
        onSaveGroup={saveTableWithGroup}
        onAddExpense={addTableExpense}
        onReset={resetTable}
        currentUser={currentUser}
        allTables={visibleTables}
        activeEventDate={activeEventDate}
      />
    </div>
  );
}

function PlanView({
  tables,
  onSelect,
}: {
  tables: ClubTable[];
  onSelect: (table: ClubTable) => void;
}) {
  return (
    <section className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-[#070707]">
      <div className="absolute inset-3 rounded-[1.35rem] border border-white/10" />

      <div className="absolute left-[8%] top-[4%] h-[42%] w-[30%] rounded-l-[1.6rem] border-l-2 border-t-2 border-orange-500/65" />
      <div className="absolute left-[8%] top-[58%] h-[38%] w-[30%] rounded-l-[1.6rem] border-b-2 border-l-2 border-orange-500/65" />
      <div className="absolute left-[8%] top-[46%] h-[12%] w-[30%] border-l-2 border-orange-500/65" />

      <div className="absolute left-[12%] top-[50.5%] flex h-[34px] w-[58px] -translate-y-1/2 items-center justify-center rounded-r-[1.5rem] border border-orange-500/80 bg-black text-sm font-black text-orange-500 shadow-[0_0_7px_rgba(236,73,0,.35)]">
        DJ
      </div>

      <div className="absolute right-[11%] top-[15.5%] h-[2px] w-[27%] bg-orange-500/80 shadow-[0_0_7px_rgba(236,73,0,.45)]" />
      <div className="absolute right-[11%] top-[48.5%] h-[2px] w-[27%] bg-orange-500/80 shadow-[0_0_7px_rgba(236,73,0,.45)]" />

      <div className="absolute bottom-[2.5%] right-[4%] h-[17%] w-[47%] rounded-2xl border-2 border-purple-600/85 shadow-[0_0_10px_rgba(168,85,247,.50)]" />
      <div className="absolute bottom-[17%] right-[22%] text-[10px] font-black text-purple-400">
        VIP
      </div>

      {tables.map((table) => (
        <TableButton key={table.id} table={table} allTables={tables} onClick={onSelect} />
      ))}
    </section>
  );
}

function TableButton({
  table,
  allTables,
  onClick,
}: {
  table: ClubTable;
  allTables: ClubTable[];
  onClick: (table: ClubTable) => void;
}) {
  const isVip = table.id.startsWith("VIP");
  const visual = isVip && table.status === "free" ? STATUS.vip : STATUS[table.status];
  const total = groupTotal(table, allTables);
  const rawName = (table.client || table.assignedTo || "").trim();
  const displayName =
    rawName.length > 12 ? `${rawName.slice(0, 12).toUpperCase()}…` : rawName.toUpperCase();

  return (
    <button
      type="button"
      onClick={() => onClick(table)}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border active:scale-95 ${visual.border} ${visual.glow} ${visual.bg} ${
        isVip ? "h-[42px] w-[72px]" : "h-[40px] w-[62px]"
      }`}
      style={{ left: `${table.x}%`, top: `${table.y}%` }}
    >
      <span
        className={`absolute left-1/2 top-1 -translate-x-1/2 font-black leading-none ${
          isVip ? "text-[9px]" : "text-[9px]"
        } ${visual.text}`}
      >
        {table.id}
      </span>

      {displayName && (
        <span className="absolute left-1/2 top-[16px] w-[96%] -translate-x-1/2 truncate text-center text-[9px] font-black uppercase leading-none text-white">
          {displayName}
        </span>
      )}

      <span
        className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${visual.dot}`}
      />

      {total > 0 && (
        <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-500 px-1.5 py-0.5 text-[8px] font-black text-black">
          {total}€
        </span>
      )}
    </button>
  );
}

function TableModal({
  table,
  onClose,
  onSave,
  onSaveGroup,
  onAddExpense,
  onReset,
  currentUser,
  allTables,
  activeEventDate,
}: {
  table: ClubTable | null;
  onClose: () => void;
  onSave: (table: ClubTable) => void;
  onSaveGroup: (table: ClubTable) => void;
  onAddExpense: (input: { tableId: string; label: string; amount: number }) => Promise<AddExpenseOutcome>;
  onReset: (tableId: string) => void;
  currentUser: StaffUser;
  allTables: ClubTable[];
  activeEventDate: string;
}) {
  const [form, setForm] = useState<ClubTable | null>(table);
  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseError, setExpenseError] = useState("");

  if (!table || !form) return null;

  const total = groupTotal(form, allTables);
  const cleanPhone = phoneForWhatsapp(form.phone);
  const canEdit = canEditTable(form, currentUser);
  const canAssign = canUseCriticalAction(currentUser.role, "canAssignTables");
  const canAddExpense = canUseCriticalAction(currentUser.role, "canAddExpense");
  const whatsappText = encodeURIComponent(
    `Salut ${form.client || ""}, on te confirme ta table ${form.id} pour ce soir.`
  );

  async function addCustomExpense() {
    if (!form || expenseSaving) return;
    if (!canAddExpense) {
      setExpenseError("Action non autorisee pour ce role.");
      return;
    }

    const amount = Number(expenseAmount);
    if (!amount || amount <= 0) {
      setExpenseError("Montant invalide.");
      return;
    }

    setExpenseSaving(true);
    setExpenseError("");
    const result = await onAddExpense({
      tableId: form.id,
      label: expenseLabel || "Dépense libre",
      amount,
    });
    setExpenseSaving(false);

    if (!result.ok) {
      setExpenseError(result.message || "Impossible d'ajouter la dépense.");
      return;
    }

    if (result.table) setForm(result.table);
    setExpenseLabel("");
    setExpenseAmount("");
  }

  function removeExpense(expenseId: string) {
    if (!form || !canEdit) return;

    const nextForm: ClubTable = {
      ...form,
      expenses: (form.expenses || []).filter((item) => item.id !== expenseId),
    };

    setForm(nextForm);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#080808] p-5 text-white">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-500">
              Table
            </p>
            <h2 className="text-3xl font-black">{form.id}</h2>
            <p className="text-sm text-white/45">{form.zone}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-white/10 p-2">
            <X size={20} />
          </button>
        </div>

        <div className="mb-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Dépense table / groupe</p>
          <p className="text-3xl font-black text-cyan-300">{total}€</p>
        </div>

        <div className="mb-3 grid grid-cols-4 gap-2">
          {(["free", "option", "booked", "arrived"] as Status[]).map((status) => (
            <button
              key={status}
              type="button"
              disabled={!canEdit}
              onClick={() => setForm({ ...form, status })}
              className={`rounded-2xl border px-2 py-2 text-[10px] font-bold ${
                form.status === status
                  ? `${STATUS[status].bg} ${STATUS[status].text} border-white/20`
                  : "border-white/10 bg-white/5 text-white/45"
              }`}
            >
              {STATUS[status].label}
            </button>
          ))}
        </div>

        <div className="grid gap-3">
          <input
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            placeholder="Nom client"
            value={form.client || ""}
            disabled={!canEdit}
            onChange={(event) => setForm({ ...form, client: event.target.value })}
          />
          <input
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            placeholder="Téléphone"
            value={form.phone || ""}
            disabled={!canEdit}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
          <div className="grid grid-cols-3 gap-3">
            <input
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 outline-none"
              placeholder="Pers."
              value={form.people || ""}
              disabled={!canEdit}
              onChange={(event) => setForm({ ...form, people: event.target.value })}
            />
            <input
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 outline-none"
              placeholder="Staff"
              value={form.booker || ""}
              disabled={!canEdit}
              onChange={(event) => setForm({ ...form, booker: event.target.value })}
            />
            <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3 text-[11px] text-white/55">
              Soirée<br />
              <span className="font-black text-orange-300">{activeEventDate}</span>
            </div>
          </div>
          {canAssign && (
            <select
              className="rounded-2xl border border-white/10 bg-[#151515] px-4 py-3 outline-none"
              value={form.assignedTo || ""}
              onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}
            >
              <option value="">Serveur / table normale</option>
              <option value="mathias">Mathias · Promoteur</option>
              <option value="quentin">Quentin · Promoteur</option>
              <option value="lawrence">Lawrence · Promoteur</option>
              <option value="jeremy">Jeremy · Serveur</option>
            </select>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Jumeler avec
              </p>
              {!!(form.linkedTables || []).length && (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    setForm({
                      ...form,
                      linkedGroupId: "",
                      linkedTables: [],
                    })
                  }
                  className="rounded-xl bg-white/10 px-2 py-1 text-[10px] font-black text-white/55"
                >
                  Dissocier
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2">
              {allTables
                .filter((item) => item.id !== form.id)
                .sort(sortTables)
                .map((item) => {
                  const selected = (form.linkedTables || []).includes(item.id);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => {
                        const current = form.linkedTables || [];
                        const nextLinked = selected
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id];

                        setForm({
                          ...form,
                          linkedTables: normalizeLinkedTables(form.id, nextLinked),
                        });
                      }}
                      className={`rounded-xl border px-2 py-2 text-xs font-black ${
                        selected
                          ? "border-orange-500 bg-orange-500 text-black"
                          : "border-white/10 bg-black text-white/55"
                      }`}
                    >
                      {item.id}
                    </button>
                  );
                })}
            </div>

            {!!(form.linkedTables || []).length && (
              <p className="mt-2 text-[11px] text-orange-300">
                Groupe : {[form.id, ...(form.linkedTables || [])].join(" + ")}
              </p>
            )}
          </div>

          <textarea
            className="min-h-16 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            placeholder="Notes staff"
            value={form.notes || ""}
            disabled={!canEdit}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Ajouter un montant
          </p>

          <div className="grid grid-cols-[1fr_80px_44px] gap-2">
            <input
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              placeholder="Ex: consommation table"
              value={expenseLabel}
              disabled={expenseSaving || !canAddExpense}
              onChange={(event) => setExpenseLabel(event.target.value)}
            />
            <input
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              placeholder="Montant"
              inputMode="numeric"
              value={expenseAmount}
              disabled={expenseSaving || !canAddExpense}
              onChange={(event) => setExpenseAmount(event.target.value)}
            />
            <button
              onClick={addCustomExpense}
              disabled={expenseSaving || !canAddExpense}
              className="grid place-items-center rounded-xl bg-cyan-500 text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-xs font-black">{expenseSaving ? "..." : "ADD"}</span>
            </button>
          </div>
          {expenseSaving && <p className="mt-2 text-xs font-bold text-cyan-300">Ajout en cours...</p>}
          {expenseError && <p className="mt-2 text-xs font-bold text-red-300">{expenseError}</p>}
        </div>

        {!!(form.expenses || []).length && (
          <div className="mt-3 grid gap-2">
            {(form.expenses || []).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <div>
                  <p className="text-sm font-bold">{item.label}</p>
                  <p className="text-[10px] text-white/35">{item.createdAt}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-black text-cyan-300">{item.amount}€</p>
                  <button
                    onClick={() => removeExpense(item.id)}
                    disabled={!canEdit}
                    className="rounded-lg bg-white/10 p-1 text-white/55"
                  >
                    <Minus size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-4 gap-2">
          <a
            href={form.phone ? `tel:${form.phone}` : "#"}
            className="flex items-center justify-center gap-1 rounded-2xl bg-white/10 py-3 text-xs font-bold"
          >
            <Phone size={15} /> Appel
          </a>
          <a
            href={cleanPhone ? `https://wa.me/${cleanPhone}?text=${whatsappText}` : "#"}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1 rounded-2xl bg-white/10 py-3 text-xs font-bold"
          >
            <MessageCircle size={15} /> WA
          </a>
          <button
            onClick={() => onReset(form.id)}
            disabled={!canEdit}
            className="flex items-center justify-center gap-1 rounded-2xl bg-white/10 py-3 text-xs font-bold text-white/70"
          >
            <Trash2 size={15} /> Reset
          </button>
          <button
            onClick={() => {
              if (!canEdit) return;
              if ((form.linkedTables || []).length || form.linkedGroupId) {
                onSaveGroup(form);
              } else {
                onSave(form);
              }
            }}
            disabled={!canEdit}
            className="flex items-center justify-center gap-1 rounded-2xl bg-orange-600 py-3 text-xs font-black"
          >
            <Save size={15} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ReservationsView({
  tables,
  allTables,
  onSelect,
  onReset,
}: {
  tables: ClubTable[];
  allTables: ClubTable[];
  onSelect: (table: ClubTable) => void;
  onReset: (tableId: string) => void;
}) {
  if (!tables.length) {
    return <Empty title="Aucune table active" text="Clique sur une table du plan pour créer une réservation ou ajouter une dépense." />;
  }

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <h2 className="mb-3 text-lg font-black">Tables actives</h2>

      <div className="grid gap-2">
        {tables.map((table) => (
          <div
            key={table.id}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`text-xl font-black ${STATUS[table.status].text}`}>
                  {table.id}
                </p>
                <p className="text-xs text-white/45">
                  {table.client || "Client à renseigner"} · {table.people || "?"} pers.
                </p>
                <p className="mt-1 text-xs text-cyan-300">
                  Dépense groupe : {groupTotal(table, allTables)}€ · {STATUS[table.status].label}
                </p>
                {!!(table.linkedTables || []).length && (
                  <p className="mt-1 text-[11px] text-orange-300">
                    Jumelée : {[table.id, ...(table.linkedTables || [])].join(" + ")}
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => onSelect(table)}
                  className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-black"
                >
                  Ouvrir
                </button>
                <button
                  onClick={() => onReset(table.id)}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white/65"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientsView({
  clients,
  allTables,
  search,
  onSearch,
  onSelectTable,
}: {
  clients: { name: string; phone: string; tables: ClubTable[]; totalSpend: number }[];
  allTables: ClubTable[];
  search: string;
  onSearch: (value: string) => void;
  onSelectTable: (table: ClubTable) => void;
}) {
  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <h2 className="mb-3 text-lg font-black">Clients</h2>

      <div className="mb-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
        <Search size={16} className="text-white/35" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Rechercher client ou téléphone"
          className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
        />
      </div>

      {!clients.length && <Empty title="Aucun client" text="Les clients apparaÃ®tront ici après ajout sur une table." />}

      <div className="grid gap-2">
        {clients.map((client) => (
          <div
            key={`${client.name}-${client.phone}`}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black">{client.name}</p>
                <p className="text-xs text-white/45">{client.phone || "Téléphone non renseigné"}</p>
                <p className="mt-1 text-xs text-cyan-300">{client.totalSpend}€ dépensés</p>
              </div>
              {client.phone && (
                <a
                  href={`tel:${client.phone}`}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black"
                >
                  Appel
                </a>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {client.tables.map((table) => (
                <button
                  key={table.id}
                  onClick={() => onSelectTable(table)}
                  className="rounded-xl border border-white/10 bg-black px-3 py-1.5 text-xs font-black text-orange-400"
                >
                  {table.id} · {groupTotal(table, allTables)}€
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}




function promoterDisplayName(username: string) {
  const staff = STAFF_DIRECTORY.find((user) => user.username === username);
  return staff?.full_name || username;
}

function contactDisplayName(contact: PromoterContact) {
  return `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || contact.phone || "Client sans nom";
}

function qrUrl(token: string) {
  return `https://club-one-bay.vercel.app/invite/${encodeURIComponent(token)}`;
}

function whatsappInviteUrl(entry: PromoterGuestEntry) {
  const cleanPhone = phoneForWhatsapp(entry.phone);
  if (!cleanPhone) return "";

  const accessLabel = entry.access_mode === "avec_alcool" ? "Avec alcool" : "Sans alcool";
  const paymentLabel =
    entry.payment_status === "regle"
      ? "Réglé"
      : entry.payment_status === "offert"
      ? "Offert"
      : "En attente";

  const text = `Bonjour ${entry.guest_name},

Tu es invité(e) ce soir au Club One.

Promoteur : ${promoterDisplayName(entry.promoter_username)}
Accès : ${accessLabel}
Statut : ${paymentLabel}

Présente ce QR unique à l’entrée :
${qrUrl(entry.qr_token)}

Attention : ce QR est personnel et utilisable une seule fois.`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

function PromotersView({
  currentUser,
  activeEventDate,
  contacts,
  entries,
  onCreateContact,
  onCreateInvitation,
  onUpdatePayment,
}: {
  currentUser: StaffUser;
  activeEventDate: string;
  contacts: PromoterContact[];
  entries: PromoterGuestEntry[];
  onCreateContact: (input: {
    promoterUsername: string;
    firstName: string;
    lastName: string;
    phone: string;
    notes: string;
  }) => Promise<boolean>;
  onCreateInvitation: (input: {
    contact: PromoterContact;
    accessMode: "avec_alcool" | "sans_alcool";
    paymentStatus: "regle" | "en_attente" | "offert";
  }) => Promise<boolean>;
  onUpdatePayment: (entryId: string, paymentStatus: "regle" | "en_attente" | "offert") => void;
}) {
  const promoters = ["mathias", "quentin", "lawrence"];
  const canSeeAll = canSeeAllPromoters(currentUser.role);
  const canManagePromoters = canUseCriticalAction(currentUser.role, "canManagePromoters");
  const canManageInvitations = canUseCriticalAction(currentUser.role, "canManageInvitations");
  const defaultPromoter = currentUser.role === "promoter" ? currentUser.username : promoters[0];

  const [selectedPromoter, setSelectedPromoter] = useState(defaultPromoter);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [modeByContact, setModeByContact] = useState<Record<string, "avec_alcool" | "sans_alcool">>({});
  const [paymentByContact, setPaymentByContact] = useState<Record<string, "regle" | "en_attente" | "offert">>({});

  const scopedContacts = contacts.filter((contact) =>
    canSeeAll ? true : contact.promoter_username === currentUser.username
  );

  const scopedEntries = entries.filter((entry) =>
    canSeeAll ? true : entry.promoter_username === currentUser.username
  );

  const generated = scopedEntries.length;
  const checkedIn = scopedEntries.filter((entry) => entry.checked_in).length;
  const paid = scopedEntries.filter((entry) => entry.payment_status === "regle").length;
  const pending = scopedEntries.filter((entry) => entry.payment_status === "en_attente").length;
  const offered = scopedEntries.filter((entry) => entry.payment_status === "offert").length;

  // Podium/classement inter-promoteurs SUPPRIMÉ (décision fondateur : compétition contre-productive).
  // Un promoteur ne voit que SON propre périmètre ; plus aucun calcul de classement entre eux.

  async function submitContact() {
    if (!canManagePromoters) return;

    const ok = await onCreateContact({
      promoterUsername: canSeeAll ? selectedPromoter : currentUser.username,
      firstName,
      lastName,
      phone,
      notes,
    });

    if (ok) {
      setFirstName("");
      setLastName("");
      setPhone("");
      setNotes("");
    }
  }

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Promoteurs</h2>
          <p className="text-xs uppercase tracking-[0.18em] text-white/35">
            Répertoire · QR uniques · règlements internes
          </p>
        </div>
        <span className="rounded-full bg-orange-500/15 px-3 py-1 text-[10px] font-black uppercase text-orange-300">
          {activeEventDate}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-5 gap-2 text-center text-[8px]">
        <Stat value={generated} label="QR" color="text-orange-300" />
        <Stat value={checkedIn} label="Entrés" color="text-emerald-300" />
        <Stat value={paid} label="Réglés" color="text-cyan-300" />
        <Stat value={pending} label="Attente" color="text-red-300" />
        <Stat value={offered} label="Offerts" color="text-purple-300" />
      </div>


      {canManagePromoters && (
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Ajouter au répertoire
        </p>

        <div className="grid gap-2">
          {canSeeAll && (
            <select
              className="rounded-xl border border-white/10 bg-[#151515] px-3 py-2 text-sm outline-none"
              value={selectedPromoter}
              onChange={(event) => setSelectedPromoter(event.target.value)}
            >
              {promoters.map((promoter) => (
                <option key={promoter} value={promoter}>{promoterDisplayName(promoter)}</option>
              ))}
            </select>
          )}

          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              placeholder="Prénom"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
            <input
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              placeholder="Nom"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </div>

          <input
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
            placeholder="Téléphone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />

          <input
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
            placeholder="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />

          <button
            onClick={submitContact}
            className="rounded-xl bg-orange-600 px-3 py-3 text-xs font-black"
          >
            Ajouter client
          </button>
        </div>
        </div>
      )}

      {/* Bloc « Classement invitations » (podium 🥇🥈🥉 entre promoteurs) SUPPRIMÉ — décision fondateur. */}

      <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Répertoire clients
        </p>

        {!scopedContacts.length && <Empty title="Aucun client" text="Ajoute un client promoteur pour générer un QR unique." />}

        <div className="grid gap-2">
          {scopedContacts.map((contact) => {
            const accessMode = modeByContact[contact.id] || "sans_alcool";
            const paymentStatus = paymentByContact[contact.id] || "en_attente";

            return (
              <div key={contact.id} className="rounded-2xl border border-white/10 bg-black/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black">{contactDisplayName(contact)}</p>
                    <p className="text-xs text-white/45">{contact.phone || "Téléphone non renseigné"}</p>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-orange-300">
                      {promoterDisplayName(contact.promoter_username)}
                    </p>
                    {contact.notes && <p className="mt-1 text-xs text-white/40">{contact.notes}</p>}
                  </div>
                </div>

                {canManageInvitations && (
                  <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <select
                    className="rounded-xl border border-white/10 bg-[#151515] px-2 py-2 text-xs outline-none"
                    value={accessMode}
                    onChange={(event) =>
                      setModeByContact({
                        ...modeByContact,
                        [contact.id]: event.target.value as "avec_alcool" | "sans_alcool",
                      })
                    }
                  >
                    <option value="sans_alcool">Sans alcool</option>
                    <option value="avec_alcool">Avec alcool</option>
                  </select>

                  <select
                    className="rounded-xl border border-white/10 bg-[#151515] px-2 py-2 text-xs outline-none"
                    value={paymentStatus}
                    onChange={(event) =>
                      setPaymentByContact({
                        ...paymentByContact,
                        [contact.id]: event.target.value as "regle" | "en_attente" | "offert",
                      })
                    }
                  >
                    <option value="en_attente">En attente</option>
                    <option value="regle">Réglé</option>
                    <option value="offert">Offert</option>
                  </select>
                </div>

                <button
                  onClick={() =>
                    onCreateInvitation({
                      contact,
                      accessMode,
                      paymentStatus,
                    })
                  }
                  className="mt-2 w-full rounded-xl bg-cyan-500 px-3 py-2 text-xs font-black text-black"
                >
                  Générer QR unique
                </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Invitations soirée
        </p>

        {!scopedEntries.length && <Empty title="Aucun QR" text="Les QR générés pour cette soirée apparaîtront ici." />}

        <div className="grid gap-2">
          {scopedEntries.map((entry) => (
            <div
              key={entry.id}
              className={`rounded-2xl border p-3 ${
                entry.checked_in
                  ? "border-emerald-400/40 bg-emerald-500/10"
                  : "border-white/10 bg-black/40"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black">{entry.guest_name}</p>
                  <p className="text-xs text-white/45">{entry.phone || "Téléphone non renseigné"}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-orange-300">
                    {promoterDisplayName(entry.promoter_username)} · {entry.access_mode === "avec_alcool" ? "Avec alcool" : "Sans alcool"}
                  </p>
                  <p className={entry.checked_in ? "text-xs font-black text-emerald-300" : "text-xs font-black text-white/40"}>
                    {entry.checked_in ? "Entré" : "Non utilisé"}
                  </p>
                </div>
                <div className="text-right">
                  <select
                    value={entry.payment_status}
                    disabled={!canManageInvitations}
                    onChange={(event) =>
                      onUpdatePayment(
                        entry.id,
                        event.target.value as "regle" | "en_attente" | "offert"
                      )
                    }
                    className={`rounded-xl border border-white/10 px-2 py-1 text-[10px] font-black outline-none ${
                      entry.payment_status === "regle"
                        ? "bg-cyan-500 text-black"
                        : entry.payment_status === "offert"
                        ? "bg-purple-500 text-white"
                        : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    <option value="en_attente">En attente</option>
                    <option value="regle">Réglé</option>
                    <option value="offert">Offert</option>
                  </select>
                </div>
              </div>

              {!entry.checked_in && (
                <div className="mt-3 grid grid-cols-[84px_1fr] gap-3">
                  <div className="grid h-20 w-20 place-items-center rounded-xl bg-white p-1">
                    <QRCodeSVG value={qrUrl(entry.qr_token)} size={72} />
                  </div>
                  <div className="min-w-0">
                    <p className="break-all text-[10px] text-white/40">{qrUrl(entry.qr_token)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {whatsappInviteUrl(entry) ? (
                        <a
                          href={whatsappInviteUrl(entry)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl bg-emerald-500 px-3 py-2 text-center text-[10px] font-black text-black"
                        >
                          WhatsApp
                        </a>
                      ) : (
                        <button
                          disabled
                          className="rounded-xl bg-white/5 px-3 py-2 text-[10px] font-black text-white/25"
                        >
                          Pas de tél.
                        </button>
                      )}
                      <button
                        onClick={() => navigator.clipboard?.writeText(qrUrl(entry.qr_token))}
                        className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-black text-white/70"
                      >
                        Copier
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActiveEventBootstrapView({
  role,
  username,
  bootstrapCompleted,
  onLogout,
  onActivateEvent,
}: {
  role: StaffUser["role"];
  username: string;
  bootstrapCompleted: boolean;
  onLogout: () => void;
  onActivateEvent: (eventId: string) => Promise<void>;
}) {
  const canActivate = role === "admin" || role === "manager";
  const [events, setEvents] = useState<ActiveEventCandidate[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loading, setLoading] = useState(canActivate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canActivate) return;
    let active = true;

    async function loadEvents() {
      setLoading(true);
      setError("");
      try {
        const rows = await loadActivatableClubEvents(supabase);
        if (!active) return;
        setEvents(rows);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Evenements indisponibles.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadEvents();
    return () => {
      active = false;
    };
  }, [canActivate]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) || null;

  async function activate() {
    if (!selectedEvent) {
      setError("Choisis une soiree a activer.");
      return;
    }

    const confirmed = window.confirm(`${bootstrapCompleted ? "Activer" : "Initialiser"} ${selectedEvent.title} du ${selectedEvent.eventDate} ?`);
    if (!confirmed) return;

    setSaving(true);
    setError("");
    try {
      await onActivateEvent(selectedEvent.id);
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "Activation impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-[#050505] text-white">
      <div className="mx-auto flex h-screen w-full max-w-[430px] flex-col border-x border-white/10 bg-black">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/35">Club One</div>
            <div className="text-lg font-black">Aucune soiree active</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70"
            title="Deconnexion"
          >
            <LogOut size={18} />
          </button>
        </header>

        <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <section className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
            <div className="text-base font-black">Aucune soiree active</div>
            <p className="mt-2 text-sm text-white/60">
              Les tables, entrees, QR et depenses restent bloques tant que le plan reste sans evenement rattache.
            </p>
          </section>

          {!canActivate && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-black">Acces en attente</div>
              <p className="mt-2 text-sm text-white/55">
                Un admin ou manager doit activer la soiree avant toute utilisation operationnelle.
              </p>
            </section>
          )}

          {canActivate && (
            <section className="rounded-2xl border border-white/10 bg-[#070707] p-4">
              <div className="mb-3 flex items-center gap-2">
                <CalendarDays size={18} className="text-amber-300" />
                <div>
                  <div className="text-sm font-black">
                    {bootstrapCompleted ? "Activer la prochaine soiree" : "Initialiser la premiere soiree"}
                  </div>
                  <div className="text-xs text-white/40">{username}</div>
                </div>
              </div>

              {loading && <p className="text-sm text-white/50">Chargement des evenements...</p>}

              {!loading && (
                <div className="space-y-3">
                  <select
                    value={selectedEventId}
                    onChange={(event) => setSelectedEventId(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-black px-3 py-3 text-sm text-white outline-none"
                  >
                    <option value="">Choisir une soiree</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.eventDate} - {event.title} - {event.status || "statut vide"}
                      </option>
                    ))}
                  </select>

                  {selectedEvent && (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                      <div className="font-black">{selectedEvent.title}</div>
                      <div className="mt-1 text-white/55">{selectedEvent.eventDate}</div>
                      <div className="mt-1 text-white/55">Statut : {selectedEvent.status || "non renseigne"}</div>
                      {selectedEvent.venueName && (
                        <div className="mt-1 text-white/55">Lieu : {selectedEvent.venueName}</div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!selectedEvent || saving}
                    onClick={activate}
                    className="w-full rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving ? "Activation..." : bootstrapCompleted ? "Activer cette soiree" : "Initialiser cette soiree"}
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-100">
                  {error}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: (username: string, password: string) => Promise<boolean> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    const ok = await onLogin(username, password);

    if (!ok) {
      setError("Identifiants incorrects");
    }
  }

  return (
    <div className="grid h-screen place-items-center bg-black p-5 text-white">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#070707] p-5">
        <h1 className="text-2xl font-light tracking-[0.35em]">
          CLUB <span className="text-orange-500">O</span>NE
        </h1>
        <p className="mt-2 text-xs uppercase tracking-[0.2em] text-white/40">
          Connexion staff
        </p>

        <div className="mt-6 grid gap-3">
          <input
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            placeholder="Identifiant"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <input
            type="password"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            placeholder="Code"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />

          {error && <p className="text-sm font-bold text-red-400">{error}</p>}

          <button
            onClick={submit}
            className="rounded-2xl bg-orange-600 px-4 py-3 text-sm font-black"
          >
            Entrer
          </button>
        </div>
      </div>
    </div>
  );
}

function FluxView({
  role,
  logs,
  onEntry,
  onExit,
  onValidateQr,
}: {
  role: StaffUser["role"];
  logs: EntryLog[];
  onEntry: () => void;
  onExit: () => void;
  onValidateQr: (token: string) => Promise<boolean>;
}) {
  const entries = logs.filter((log) => log.type === "entry").length;
  const exits = logs.filter((log) => log.type === "exit").length;
  const inside = Math.max(entries - exits, 0);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <h2 className="mb-3 text-lg font-black">Flux entrées / sorties</h2>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <BigStat label="Dedans" value={String(inside)} />
        <BigStat label="Entrées" value={String(entries)} />
        <BigStat label="Sorties" value={String(exits)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onEntry}
          className="rounded-3xl bg-emerald-500 py-8 text-3xl font-black text-black active:scale-95"
        >
          + ENTRÉE
        </button>
        <button
          onClick={onExit}
          className="rounded-3xl bg-red-500 py-8 text-3xl font-black text-white active:scale-95"
        >
          - SORTIE
        </button>
      </div>

      {canAccessQrFromTab(role, "flux") && (
        <QrCheckInPanel onValidateQr={onValidateQr} />
      )}

      <div className="mt-4 grid gap-2">
        {logs.slice(0, 40).map((log) => (
          <div
            key={log.id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <span className={log.type === "entry" ? "font-black text-emerald-400" : "font-black text-red-400"}>
              {log.type === "entry" ? "Entrée" : "Sortie"}
            </span>
            <span className="text-xs text-white/40">
              {new Date(log.created_at).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


function SecurityView({
  role,
  tables,
  search,
  onSearch,
  onSelect,
  onMarkArrived,
  onValidateQr,
}: {
  role: StaffUser["role"];
  tables: ClubTable[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (table: ClubTable) => void;
  onMarkArrived: (tableId: string) => void;
  onValidateQr: (token: string) => Promise<boolean>;
}) {
  const filteredTables = tables
    .filter((table) => table.status !== "free" || table.client || table.phone)
    .filter((table) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;

      return `${table.client || ""} ${table.phone || ""} ${table.id} ${table.zone || ""}`
        .toLowerCase()
        .includes(q);
    })
    .sort(sortTables);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <h2 className="mb-3 text-lg font-black">Entrée / Sécurité</h2>

      {canAccessQrFromTab(role, "security") && (
        <QrCheckInPanel onValidateQr={onValidateQr} compact />
      )}

      <div className="mb-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
        <Search size={16} className="text-white/35" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Nom, téléphone, table..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
        />
      </div>

      {!filteredTables.length && (
        <Empty
          title="Aucune réservation trouvée"
          text="Les tables réservées ou optionnées apparaÃ®tront ici pour la sécurité."
        />
      )}

      <div className="grid gap-2">
        {filteredTables.map((table) => (
          <div
            key={table.id}
            className={`rounded-2xl border p-3 ${
              table.status === "arrived"
                ? "border-cyan-400/40 bg-cyan-500/10"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-2xl font-black ${STATUS[table.status].text}`}>
                  {table.id}
                </p>
                <p className="text-sm font-black">
                  {table.client || "Nom à renseigner"}
                </p>
                <p className="text-xs text-white/45">
                  {table.people || "?"} pers. · {table.phone || "tel non renseigné"}
                </p>
                <p className="mt-1 text-xs text-white/35">
                  {table.zone} · {STATUS[table.status].label}
                </p>
                {table.notes && (
                  <p className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/65">
                    {table.notes}
                  </p>
                )}
              </div>

              {(role === "admin" || role === "manager") && (
              <div className="grid gap-2">
                <button
                  onClick={() => onMarkArrived(table.id)}
                  className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-black text-black"
                >
                  Arrivé
                </button>
                <button
                  onClick={() => onSelect(table)}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black"
                >
                  Fiche
                </button>
              </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgendaView({
  currentDate,
  onDateChange,
  tables,
  onSelect,
}: {
  currentDate: string;
  onDateChange: (value: string) => void;
  tables: ClubTable[];
  onSelect: (table: ClubTable) => void;
}) {
  const dayTables = tables
    .filter((table) => table.eventDate === currentDate || (!table.eventDate && table.status !== "free"))
    .sort(sortTables);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <h2 className="mb-3 text-lg font-black">Agenda</h2>

      <input
        type="date"
        value={currentDate}
        onChange={(event) => onDateChange(event.target.value)}
        className="mb-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
      />

      {!dayTables.length && <Empty title="Aucune table ce jour" text="Ajoute une date dans la fiche d’une table." />}

      <div className="grid gap-2">
        {dayTables.map((table) => (
          <button
            key={table.id}
            onClick={() => onSelect(table)}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left"
          >
            <div className="flex items-center justify-between">
              <span className={`text-xl font-black ${STATUS[table.status].text}`}>
                {table.id}
              </span>
              <span className="rounded-full bg-white/10 px-2 py-1 text-[10px]">
                {STATUS[table.status].label}
              </span>
            </div>
            <p className="mt-1 text-xs text-white/45">
              {table.client || "Client à renseigner"} · {table.people || "?"} pers. · {tableTotal(table)}€
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsView({
  stats,
  tables,
  entryLogs,
  activeEventDate,
  onChangeEventDate,
  onCloseSession,
  onResetAll,
  canCloseSession,
  canResetAll,
}: {
  stats: {
    free: number;
    option: number;
    booked: number;
    arrived: number;
    vip: number;
    revenue: number;
    spendTables: number;
  };
  tables: ClubTable[];
  entryLogs: EntryLog[];
  activeEventDate: string;
  onChangeEventDate: (value: string) => void;
  onCloseSession: () => void;
  onResetAll: () => void;
  canCloseSession: boolean;
  canResetAll: boolean;
}) {
  const totalTables = tables.length || 1;
  const activeTables = tables.filter(
    (table) =>
      groupIsActive(table, tables)
  );

  const filled = activeTables.length;
  const occupancy = Math.round((filled / totalTables) * 100);
  const averageSpend = stats.spendTables ? Math.round(stats.revenue / stats.spendTables) : 0;

  const todayLogs = entryLogs.filter((log) => {
    const d = new Date(log.created_at);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}` === activeEventDate;
  });

  const entries = todayLogs.filter((log) => log.type === "entry").length;
  const exits = todayLogs.filter((log) => log.type === "exit").length;
  const inside = Math.max(entries - exits, 0);

  const topTables = uniqueGroupRows(tables)
    .filter((table) => groupTotal(table, tables) > 0)
    .sort((a, b) => groupTotal(b, tables) - groupTotal(a, tables))
    .slice(0, 5);

  const zoneRows = [
    {
      label: "Zone A",
      tables: tables.filter((table) => table.id.startsWith("A")),
    },
    {
      label: "Zone B",
      tables: tables.filter((table) => table.id.startsWith("B")),
    },
    {
      label: "Zone C",
      tables: tables.filter((table) => table.id.startsWith("C")),
    },
    {
      label: "VIP",
      tables: tables.filter((table) => table.id.startsWith("VIP")),
    },
  ].map((zone) => {
    const revenue = uniqueGroupRows(zone.tables).reduce(
      (sum, table) => sum + groupTotal(table, tables),
      0
    );
    const active = zone.tables.filter(
      (table) =>
        groupIsActive(table, tables)
    ).length;

    return {
      ...zone,
      revenue,
      active,
      total: zone.tables.length || 1,
      occupancy: Math.round((active / (zone.tables.length || 1)) * 100),
    };
  });

  const promoterRows = ["mathias", "quentin", "lawrence"].map((promoter) => {
    const promoterTables = tables.filter((table) => table.assignedTo === promoter);
    const revenue = uniqueGroupRows(promoterTables).reduce(
      (sum, table) => sum + groupTotal(table, tables),
      0
    );

    return {
      promoter,
      revenue,
      active: promoterTables.filter(
        (table) =>
          groupIsActive(table, tables)
      ).length,
    };
  });

  const hourlyRows = Array.from(
    todayLogs.reduce((map, log) => {
      const date = new Date(log.created_at);
      const hour = date.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
      });

      const current = map.get(hour) || { hour, entries: 0, exits: 0 };

      if (log.type === "entry") current.entries += 1;
      if (log.type === "exit") current.exits += 1;

      map.set(hour, current);
      return map;
    }, new Map<string, { hour: string; entries: number; exits: number }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => a.hour.localeCompare(b.hour));

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Dashboard soirée</h2>
          <p className="text-xs uppercase tracking-[0.18em] text-white/35">
            Stats rattachées à la date globale
          </p>
        </div>

        <input
          type="date"
          value={activeEventDate}
          onChange={(event) => onChangeEventDate(event.target.value)}
          className="w-[130px] rounded-2xl border border-white/10 bg-white/5 px-2 py-2 text-xs outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <BigStat label="CA tables" value={`${stats.revenue}€`} />
        <BigStat label="Occupation" value={`${filled}/${totalTables}`} />
        <BigStat label="Taux remplissage" value={`${occupancy}%`} />
        <BigStat label="Panier moyen" value={`${averageSpend}€`} />
        <BigStat label="Entrées" value={String(entries)} />
        <BigStat label="Dans le club" value={String(inside)} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          CA par zone
        </p>

        <div className="grid gap-2">
          {zoneRows.map((zone) => (
            <div
              key={zone.label}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-black text-orange-400">{zone.label}</span>
                <span className="font-black text-cyan-300">{zone.revenue}€</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
                <span>{zone.active}/{zone.total} tables actives</span>
                <span>{zone.occupancy}% remplissage</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Top tables
        </p>

        {!topTables.length && <p className="text-sm text-white/40">Aucune dépense enregistrée.</p>}

        <div className="grid gap-2">
          {topTables.map((table) => (
            <div key={table.id} className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-2">
              <div>
                <span className="font-black text-orange-400">{table.id}</span>
                <p className="text-[11px] text-white/35">
                  {table.client || "Client non renseigné"}
                  {!!(table.linkedTables || []).length &&
                    ` · ${[table.id, ...(table.linkedTables || [])].join(" + ")}`}
                </p>
              </div>
              <span className="font-black text-cyan-300">{groupTotal(table, tables)}€</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Promoteurs
        </p>

        {/* Vue directionnelle : contribution par promoteur, NEUTRE — pas de podium/médaille,
            tri alphabétique (décision fondateur : plus de classement compétitif entre promoteurs). */}
        <div className="grid gap-2">
          {promoterRows
            .slice()
            .sort((a, b) => a.promoter.localeCompare(b.promoter))
            .map((row) => (
              <div
                key={row.promoter}
                className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-2"
              >
                <div>
                  <p className="font-black capitalize text-orange-400">{row.promoter}</p>
                  <p className="text-[11px] text-white/35">{row.active} table(s) active(s)</p>
                </div>
                <p className="font-black text-cyan-300">{row.revenue}€</p>
              </div>
            ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Flux par heure
        </p>

        {!hourlyRows.length && <p className="text-sm text-white/40">Aucun flux enregistré.</p>}

        <div className="grid gap-2">
          {hourlyRows.map((row) => (
            <div
              key={row.hour}
              className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-2"
            >
              <span className="font-black text-white/70">{row.hour}h</span>
              <span className="text-sm text-emerald-400">+{row.entries} entrées</span>
              <span className="text-sm text-red-400">-{row.exits} sorties</span>
            </div>
          ))}
        </div>
      </div>

      {canCloseSession && (
        <button
          onClick={onCloseSession}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-500/40 bg-orange-500/15 px-4 py-3 text-sm font-black text-orange-200"
        >
          Clôturer et archiver la soirée
        </button>
      )}

      {canResetAll && (
        <button
          onClick={onResetAll}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-300"
        >
          <RotateCcw size={16} />
          Réinitialiser sans archive
        </button>
      )}
    </div>
  );
}

function CaisseField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  inputMode = "decimal",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-white/45">{label}</span>
      {hint && <span className="ml-1 text-[10px] text-white/25">{hint}</span>}
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-orange-500/50"
      />
    </label>
  );
}

// Écran de SAISIE du Z de clôture — directionnel. État vide HONNÊTE : rien n'est pré-rempli tant
// que le manager n'a pas saisi le ticket Z physique. Le catalogue bar (seed 0010) est affiché en
// référence ; prix d'achat / stock restent « — » tant que le fondateur n'a pas fourni facture +
// inventaire (aucune marge inventée).
// Formulaire de saisie du Z pour UN univers. État local remonté par la clé du parent (aucun effet
// de synchronisation). Toute la validation vit dans lib/caisseZ (buildCaisseZUpsert), testée à part.
function CaisseForm({
  exploitationDate,
  venue,
  existingRecord,
  onSave,
}: {
  exploitationDate: string;
  venue: VenueId;
  existingRecord: CaisseZRecord | null;
  onSave: (form: CaisseZFormValues) => Promise<{ ok: boolean; message: string }>;
}) {
  const [form, setForm] = useState<CaisseZFormValues>(() =>
    existingRecord ? formFromRecord(existingRecord) : emptyCaisseZForm(exploitationDate, venue),
  );
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const totals = liveTotals(form);

  function setField<K extends keyof CaisseZFormValues>(key: K, value: CaisseZFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value, exploitationDate, venue }));
    setFeedback(null);
  }

  async function handleSave() {
    setSaving(true);
    const result = await onSave({ ...form, exploitationDate, venue });
    setFeedback(result);
    setSaving(false);
  }

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <CaisseField label="CA bar TTC" hint="€" value={form.caBar} onChange={(v) => setField("caBar", v)} placeholder="0,00" />
        <CaisseField label="CA entrées TTC" hint="€" value={form.caEntrees} onChange={(v) => setField("caEntrees", v)} placeholder="0,00" />
        <CaisseField label="Vestiaire TTC" hint="€ · opt." value={form.caVestiaire} onChange={(v) => setField("caVestiaire", v)} placeholder="0,00" />
        <CaisseField label="Nb tickets" hint="opt." value={form.nbTickets} onChange={(v) => setField("nbTickets", v)} placeholder="0" inputMode="numeric" />
        <CaisseField label="CB encaissée" hint="€" value={form.cb} onChange={(v) => setField("cb", v)} placeholder="0,00" />
        <CaisseField label="Espèces" hint="€" value={form.especes} onChange={(v) => setField("especes", v)} placeholder="0,00" />
        <CaisseField label="Offerts TTC" hint="€ · opt." value={form.offerts} onChange={(v) => setField("offerts", v)} placeholder="0,00" />
      </div>

      <label className="mt-2 block">
        <span className="text-[11px] font-black uppercase tracking-[0.12em] text-white/45">Commentaire</span>
        <textarea
          value={form.commentaire}
          onChange={(event) => setField("commentaire", event.target.value)}
          rows={2}
          placeholder="Note de clôture (facultatif)"
          className="mt-1 w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-orange-500/50"
        />
      </label>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <BigStat label="CA total TTC" value={formatEuro(totals.caTtc)} />
        <BigStat label="Encaissé" value={formatEuro(totals.paid)} />
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs text-white/40">Écart caisse</p>
          {totals.ecart === null ? (
            <p className="mt-1 text-2xl font-black text-white/30">—</p>
          ) : Math.abs(totals.ecart) < 0.01 ? (
            <p className="mt-1 text-2xl font-black text-emerald-400">0 €</p>
          ) : (
            <p className={`mt-1 text-2xl font-black ${totals.ecart < 0 ? "text-red-400" : "text-amber-300"}`}>
              {totals.ecart > 0 ? "+" : ""}{formatEuro(totals.ecart)}
            </p>
          )}
        </div>
      </div>

      {totals.ecart !== null && Math.abs(totals.ecart) >= 0.01 && (
        <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
          <AlertTriangle size={13} />
          {totals.ecart < 0 ? "Manquant" : "Excédent"} de caisse : CB + espèces {totals.ecart < 0 ? "inférieur" : "supérieur"} au CA total.
        </p>
      )}

      {feedback && (
        <p
          className={`mt-2 rounded-xl border px-3 py-2 text-[12px] font-bold ${
            feedback.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || totals.caTtc <= 0}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-500/40 bg-orange-500/15 px-4 py-3 text-sm font-black text-orange-200 disabled:opacity-40"
      >
        <Save size={16} />
        {existingRecord ? "Mettre à jour le Z" : "Enregistrer le Z"}
      </button>
    </>
  );
}

function CaisseView({
  exploitationDate,
  hasActiveEvent,
  produits,
  records,
  onSave,
}: {
  exploitationDate: string;
  hasActiveEvent: boolean;
  produits: ProduitBar[];
  records: CaisseZRecord[];
  onSave: (form: CaisseZFormValues) => Promise<{ ok: boolean; message: string }>;
}) {
  const [venue, setVenue] = useState<VenueId>("complexe");
  const existingRecord = records.find((row) => row.venue === venue) ?? null;
  const catalogue = catalogueDataReady(produits);
  const grouped = groupProduitsByCategorie(produits);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <Wallet size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">Caisse — Z de clôture</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Club One <b className="text-white/60">lit</b> la caisse (le ticket Z), il n&apos;encaisse jamais.
        Reporting pour le P&amp;L par soirée — pas un journal de caisse.
      </p>

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Soirée</p>
            <p className="text-sm font-black text-orange-400">{exploitationDate}</p>
          </div>
          {existingRecord ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black text-emerald-300">
              Z déjà saisi · modifiable
            </span>
          ) : (
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-black text-white/45">
              Aucun Z pour cet univers
            </span>
          )}
        </div>

        {!hasActiveEvent && (
          <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
            Aucune soirée active : le Z sera enregistré sur la date du jour, non rattaché à un événement.
          </p>
        )}

        <div className="mt-3">
          <p className="mb-1 text-[11px] font-black uppercase tracking-[0.12em] text-white/45">Univers</p>
          <div className="grid grid-cols-4 gap-1.5">
            {CAISSE_VENUES.map((v) => (
              <button
                key={v}
                onClick={() => setVenue(v)}
                className={`rounded-xl border px-1 py-2 text-[10px] font-black ${
                  venue === v
                    ? "border-orange-500/60 bg-orange-500/15 text-orange-200"
                    : "border-white/10 bg-white/5 text-white/50"
                }`}
              >
                {VENUE_LABELS[v]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Le formulaire est remonté (key) à chaque changement d'univers / de Z existant : son état
          local s'initialise alors depuis le relevé (correction) ou vide (saisie neuve), sans effet
          de synchronisation — pattern React recommandé plutôt qu'un setState dans un useEffect. */}
      <CaisseForm
        key={`${venue}:${exploitationDate}:${existingRecord?.id ?? "new"}`}
        exploitationDate={exploitationDate}
        venue={venue}
        existingRecord={existingRecord}
        onSave={onSave}
      />

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Catalogue bar</p>
          <span className="text-[10px] text-white/35">{catalogue.total} produits</span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-white/35">
          Prix d&apos;achat renseignés : {catalogue.withCost}/{catalogue.total} · stock : {catalogue.withStock}/{catalogue.total}.
          {catalogue.withCost === 0 && " Marge et valorisation indisponibles tant que facture et inventaire ne sont pas fournis."}
        </p>

        {!produits.length && (
          <Empty title="Catalogue vide" text="Aucun produit actif remonté (vérifier la migration 0010 sur la base cible)." />
        )}

        <div className="mt-2 grid gap-3">
          {grouped.map((group) => (
            <div key={group.categorie}>
              <p className="mb-1 text-[11px] font-black text-orange-400">{group.categorie}</p>
              <div className="grid gap-1">
                {group.produits.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-bold text-white/80">
                        {p.nom}
                        {p.format && <span className="text-white/35"> · {p.format}</span>}
                      </p>
                      <p className="text-[10px] text-white/30">
                        Achat {p.prix_achat == null ? "—" : formatEuro(p.prix_achat)} · stock {p.stock == null ? "—" : p.stock}
                      </p>
                    </div>
                    <span className="ml-2 shrink-0 text-[12px] font-black text-cyan-300">{formatEuro(p.prix_vente)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// P&L par soirée (directionnel). Croise trois sources DÉJÀ existantes : le Z de caisse (caisse_z,
// produit comptable), le CA des tables (club_tables, saisie soirée) et les entrées (entry_logs).
// Toute la logique vit dans lib/pnlSoiree (testée). Les charges (coût staff RH, coûts artistes)
// ne sont PAS encore branchées : le résultat net est présenté comme indisponible, jamais fabriqué.
function PnlView({
  exploitationDate,
  hasActiveEvent,
  caisseRecords,
  caTables,
  entryLogs,
  staffMembers,
  staffShifts,
  soireeCharges,
}: {
  exploitationDate: string;
  hasActiveEvent: boolean;
  caisseRecords: CaisseZRecord[];
  caTables: number;
  entryLogs: EntryLog[];
  staffMembers: StaffMember[];
  staffShifts: StaffShift[];
  soireeCharges: SoireeCharge[];
}) {
  // Entrées de la soirée = compteur cumulé (type "entry") sur la date active — même filtre que le
  // Dashboard soirée, pour rester cohérent avec la fréquentation affichée ailleurs.
  const entries = entryLogs.filter((log) => {
    if (log.type !== "entry") return false;
    const d = new Date(log.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return key === exploitationDate;
  }).length;

  // Producteur RH → charge staff. La masse horaire de la soirée (pointage) est convertie en coût
  // staff par lib/rhPlanning. staffChargeAmount reste null tant que le coût n'est pas COMPLET (un
  // présent sans taux/heures) : on branche le producteur mais on n'injecte jamais un coût partiel.
  const masse = summarizeMasseHoraire(exploitationDate, staffShifts, staffMembers);
  const staffCharge = staffChargeAmount(masse);

  // Raison honnête tant que le coût staff n'est pas chiffré (affichée sous la charge « staff »).
  const staffHint: string | null =
    staffCharge != null
      ? null
      : staffMembers.length === 0
        ? "Personnel non renseigné (RH) : coût staff en attente de la vraie liste + des taux horaires."
        : masse.presents === 0
          ? "Aucun présent pointé pour cette soirée : rien à chiffrer."
          : `${masse.presentsSansTaux} présent(s) sans taux horaire ou pointage complet : coût non injecté (jamais de total tronqué).`;

  // Producteur booking → charge artistes. La synthèse des postes (B2/B3) est convertie en coût
  // artistes par lib/artistesExtras. artistesChargeAmount reste null tant qu'un poste engagé n'est
  // pas chiffré : on branche le producteur mais on n'injecte jamais un coût partiel.
  const artistesSummary = summarizeArtistesCharges(exploitationDate, soireeCharges);
  const artistesCharge = artistesChargeAmount(artistesSummary);

  // Raison honnête tant que le coût artistes n'est pas chiffré (affichée sous la charge « artistes »).
  const artistesHint: string | null =
    artistesCharge != null
      ? null
      : artistesSummary.engagees === 0
        ? "Aucun poste artiste/extra engagé (Artistes) : coût en attente des contrats booking."
        : `${artistesSummary.engageesSansMontant} poste(s) engagé(s) sans cachet renseigné : coût non injecté (jamais de total tronqué).`;

  const pnl = buildPnlSoiree({
    exploitationDate,
    caisseRecords,
    caTables,
    entries,
    staffCharge,
    artistesCharge,
  });
  const { caisse, reconciliation: rec } = pnl;

  // Libellé du résultat : « net » seulement si plus aucune charge en attente ; « après charges
  // connues » dès qu'au moins une charge réelle est déduite ; sinon « produit avant charges ».
  const resultLabel = pnl.resultatNetComplet
    ? "Résultat net"
    : pnl.chargesConnues > 0
      ? "Marge après charges connues"
      : "Produit avant charges";

  const basisLabel =
    caisse.basis === "complexe"
      ? "Z global (complexe)"
      : caisse.basis === "par-univers"
        ? `Z par univers (${caisse.venuesCount})`
        : "Aucun Z";

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <TrendingUp size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">P&amp;L par soirée</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Croise le Z de caisse (produit comptable), le CA des tables et les entrées.
        Club One <b className="text-white/60">lit</b>, il n&apos;encaisse jamais (NF525).
      </p>

      <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Soirée</p>
          <p className="text-sm font-black text-orange-400">{exploitationDate}</p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-black text-white/45">
          {basisLabel}
        </span>
      </div>

      {!hasActiveEvent && (
        <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
          Aucune soirée active : P&amp;L calculé sur la date du jour, non rattaché à un événement.
        </p>
      )}

      {!caisse.available ? (
        <Empty
          title="Aucun Z de caisse pour cette soirée"
          text="Le produit comptable vient du Z de clôture. Saisir le Z dans l'onglet Caisse pour alimenter le P&L — rien n'est estimé à sa place."
        />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <BigStat label="CA caisse (Z)" value={formatEuro(pnl.produitTotal)} />
          <BigStat label="Entrées" value={String(entries)} />
          <BigStat label="Panier / entrée" value={pnl.panierParEntree == null ? "—" : formatEuro(pnl.panierParEntree)} />
          <BigStat label="Tickets Z" value={caisse.nbTickets == null ? "—" : String(caisse.nbTickets)} />
        </div>
      )}

      {caisse.available && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Décomposition du produit (Z)
          </p>
          <div className="grid gap-1.5 text-sm">
            <PnlRow label="Bar" value={formatEuro(caisse.caBar)} />
            <PnlRow label="Entrées" value={formatEuro(caisse.caEntrees)} />
            <PnlRow label="Vestiaire" value={formatEuro(caisse.caVestiaire)} />
            <div className="mt-1 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="font-black text-white/70">CA total TTC</span>
              <span className="font-black text-cyan-300">{formatEuro(caisse.caTotal)}</span>
            </div>
            {caisse.offerts > 0 && (
              <p className="text-[11px] text-white/35">Offerts (hors CA) : {formatEuro(caisse.offerts)}</p>
            )}
          </div>
        </div>
      )}

      {/* Le moat : rapprochement CA bar comptable ↔ CA des tables saisi en soirée. */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Rapprochement tables ↔ caisse
        </p>
        {rec.caBarCaisse == null ? (
          <p className="text-sm text-white/45">
            Pas de famille « bar » dans le Z : rapprochement indisponible (aucune base comptable à comparer).
          </p>
        ) : (
          <div className="grid gap-1.5 text-sm">
            <PnlRow label="CA bar (Z, comptable)" value={formatEuro(rec.caBarCaisse)} />
            <PnlRow label="CA tables (saisi soirée)" value={formatEuro(rec.caTables)} />
            <div className="mt-1 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="font-black text-white/70">Écart (bar − tables)</span>
              <span className={`font-black ${(rec.ecart ?? 0) > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                {formatEuro(rec.ecart ?? 0)}
              </span>
            </div>
            <p className="text-[11px] leading-snug text-white/35">
              Saisie table = {rec.tauxSaisie == null ? "—" : `${Math.round(rec.tauxSaisie * 100)}%`} du bar comptable.
              {(rec.ecart ?? 0) > 0 && " Écart positif = dépenses bar non tapées par table (sous-saisie à investiguer)."}
            </p>
          </div>
        )}
      </div>

      {/* Charges : honnêtement en attente. Aucun montant fabriqué tant que RH/booking ne sont pas branchés. */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Charges de la soirée
        </p>
        <div className="grid gap-1.5">
          {pnl.charges.map((charge) => (
            <div key={charge.key} className="rounded-xl bg-black/40 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white/80">{charge.label}</p>
                  <p className="text-[10px] text-white/35">
                    {charge.source}
                    {charge.wired && charge.amount == null && " · branché, en attente de données"}
                  </p>
                </div>
                <span
                  className={`ml-2 shrink-0 text-sm font-black ${charge.amount == null ? "text-white/40" : "text-cyan-300"}`}
                >
                  {charge.amount == null ? "—" : formatEuro(charge.amount)}
                </span>
              </div>
              {charge.key === "staff" && staffHint && (
                <p className="mt-1 text-[10px] leading-snug text-white/30">{staffHint}</p>
              )}
              {charge.key === "artistes" && artistesHint && (
                <p className="mt-1 text-[10px] leading-snug text-white/30">{artistesHint}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Résultat : jamais présenté comme définitif tant que des charges restent en attente. */}
      <div className="mt-4 rounded-2xl border border-orange-500/25 bg-orange-500/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-[0.18em] text-white/55">
            {resultLabel}
          </span>
          <span className="text-xl font-black text-orange-400">
            {pnl.margeApresChargesConnues == null ? "—" : formatEuro(pnl.margeApresChargesConnues)}
          </span>
        </div>
        {!pnl.resultatNetComplet && (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-200">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              Résultat net indisponible : {pnl.chargesEnAttente.map((c) => c.label.toLowerCase()).join(" et ")} pas
              encore branchés. Le chiffre ci-dessus est le produit AVANT ces charges, pas une marge nette.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

function PnlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/55">{label}</span>
      <span className="font-bold text-white/80">{value}</span>
    </div>
  );
}

// RH / Planning (B7) — vue direction/patronat. STRUCTURE : lit staff_members / staff_shifts (0011),
// affiche la masse horaire de la soirée et le coût staff. Tant que le fondateur n'a pas fourni la
// vraie liste (noms, taux horaire), les tables sont VIDES → état vide HONNÊTE, aucun salarié inventé.
// Cette vue est le PRODUCTEUR du « coût staff » que le P&L attend (aujourd'hui non branché).
function RhView({
  exploitationDate,
  hasActiveEvent,
  members,
  shifts,
}: {
  exploitationDate: string;
  hasActiveEvent: boolean;
  members: StaffMember[];
  shifts: StaffShift[];
}) {
  const ready = rhDataReady(members);
  const masse: MasseHoraire = summarizeMasseHoraire(exploitationDate, shifts, members);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">RH &amp; Planning</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Composition du planning, pointage réel et masse horaire → <b className="text-white/60">coût staff</b> du
        P&amp;L. Suivi transparent et annoncé (droit du travail), jamais une surveillance cachée.
      </p>

      <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Soirée</p>
          <p className="text-sm font-black text-orange-400">{exploitationDate}</p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-black text-white/45">
          {ready.actifs} actif{ready.actifs > 1 ? "s" : ""} / {ready.total}
        </span>
      </div>

      {!hasActiveEvent && (
        <p className="mt-3 text-[11px] text-white/35">
          Aucune soirée active : le planning se compose sur la date d&apos;exploitation courante.
        </p>
      )}

      {ready.total === 0 ? (
        <div className="mt-3">
          <Empty
            title="Personnel non renseigné"
            text="La vraie liste du personnel (noms, postes, taux horaire) n'a pas encore été fournie. Les tables staff_members / staff_shifts (0011) sont vides — rien n'est inventé. Renseigne l'équipe pour composer le planning et calculer le coût staff."
          />
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <BigStat label="Heures planifiées" value={`${masse.heuresPlanifiees} h`} />
            <BigStat
              label="Heures réelles"
              value={masse.heuresReelles == null ? "—" : `${masse.heuresReelles} h`}
            />
          </div>

          <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm">
            <PnlRow label="Shifts de la soirée" value={String(masse.shiftsTotal)} />
            <PnlRow label="Présents (pointés)" value={String(masse.presents)} />
            <PnlRow label="Absents" value={String(masse.absents)} />
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="font-black text-white/70">Coût staff</span>
              <span className="font-black text-cyan-300">
                {masse.coutStaff == null ? "—" : formatEuro(masse.coutStaff)}
              </span>
            </div>
            {ready.withTaux < ready.actifs && (
              <p className="mt-2 text-[11px] text-white/35">
                Taux horaire renseigné pour {ready.withTaux}/{ready.actifs} actifs — le coût reste
                partiel tant que la paie n&apos;est pas complète.
              </p>
            )}
          </div>

          {!masse.coutComplet && (
            <div className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
              <p className="text-[11px] leading-snug text-amber-200/80">
                Coût staff <b>non branché au P&amp;L</b> : {masse.presentsSansTaux} présent
                {masse.presentsSansTaux > 1 ? "s" : ""} sans taux/heures. On ne présente jamais un
                coût partiel comme le coût staff définitif de la soirée.
              </p>
            </div>
          )}

          <ul className="mt-3 space-y-1.5">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"
              >
                <span className="font-bold text-white/80">
                  {m.full_name}
                  {m.poste ? <span className="text-white/40"> · {m.poste}</span> : null}
                  {!m.actif ? <span className="text-white/30"> · inactif</span> : null}
                </span>
                <span className="text-[11px] font-black text-white/45">
                  {m.taux_horaire == null ? "taux —" : `${formatEuro(m.taux_horaire)}/h`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-white/35">
        Structure B7 : la vue salarié (chacun voit SON planning et SES heures) et la saisie du
        pointage arrivent ensuite. La RLS 0011 cantonne déjà chaque salarié à sa propre fiche.
      </p>
    </div>
  );
}

const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  prevu: "Prévu",
  confirme: "Confirmé",
  paye: "Payé",
  annule: "Annulé",
};

// Artistes & extras (B2/B3) — vue direction/patronat. STRUCTURE : lit/écrit soiree_charges (0012),
// liste les postes de coût de la soirée (DJ, technique, extra…) et produit le « coût artistes » du
// P&L. Le montant (cachet) reste NULL tant que le fondateur ne l'a pas saisi → état vide HONNÊTE,
// aucun cachet inventé. C'est la 2ᵉ charge attendue par le P&L (après le coût staff RH).
function ArtistesView({
  exploitationDate,
  hasActiveEvent,
  charges,
  onAdd,
  onDelete,
}: {
  exploitationDate: string;
  hasActiveEvent: boolean;
  charges: SoireeCharge[];
  onAdd: (input: {
    categorie: ChargeCategorie;
    label: string;
    montant: number | null;
    statut: ChargeStatus;
  }) => Promise<{ ok: boolean; message: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const ready = artistesDataReady(charges);
  const summary: ArtistesSummary = summarizeArtistesCharges(exploitationDate, charges);

  const [categorie, setCategorie] = useState<ChargeCategorie>("dj");
  const [label, setLabel] = useState("");
  const [montant, setMontant] = useState("");
  const [statut, setStatut] = useState<ChargeStatus>("confirme");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setFeedback("");
    if (!label.trim()) {
      setFeedback("Libellé du poste manquant.");
      return;
    }
    let parsedMontant: number | null = null;
    if (montant.trim() !== "") {
      const parsed = parseEuro(montant);
      if (!parsed.ok) {
        setFeedback("Montant invalide (laisser vide si le cachet n'est pas encore connu).");
        return;
      }
      parsedMontant = parsed.value;
    }
    setBusy(true);
    const res = await onAdd({ categorie, label, montant: parsedMontant, statut });
    setBusy(false);
    setFeedback(res.message);
    if (res.ok) {
      setLabel("");
      setMontant("");
    }
  }

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <Music size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">Artistes &amp; extras</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Postes de coût de la soirée (DJ, technique, extras…) → <b className="text-white/60">coût artistes</b> du
        P&amp;L. Le cachet reste vide tant qu&apos;il n&apos;est pas connu — aucun montant inventé.
      </p>

      <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Soirée</p>
          <p className="text-sm font-black text-orange-400">{exploitationDate}</p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-black text-white/45">
          {ready.engagees} engagé{ready.engagees > 1 ? "s" : ""} / {ready.total}
        </span>
      </div>

      {!hasActiveEvent && (
        <p className="mt-3 text-[11px] text-white/35">
          Aucune soirée active : les postes se saisissent sur la date d&apos;exploitation courante.
        </p>
      )}

      {/* Synthèse coût artistes (le producteur de la charge P&L). */}
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm">
        <PnlRow label="Postes engagés (confirmé/payé)" value={String(summary.engagees)} />
        <PnlRow label="Provisionnels (prévu)" value={String(summary.provisionnelles)} />
        {summary.montantProvisionnel != null && (
          <PnlRow
            label="Montant provisionnel (indicatif)"
            value={formatEuro(summary.montantProvisionnel)}
          />
        )}
        <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
          <span className="font-black text-white/70">Coût artistes</span>
          <span className="font-black text-cyan-300">
            {summary.coutArtistes == null ? "—" : formatEuro(summary.coutArtistes)}
          </span>
        </div>
      </div>

      {summary.engagees > 0 && !summary.coutComplet && (
        <div className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-snug text-amber-200/80">
            Coût artistes <b>non branché au P&amp;L</b> : {summary.engageesSansMontant} poste
            {summary.engageesSansMontant > 1 ? "s" : ""} engagé{summary.engageesSansMontant > 1 ? "s" : ""} sans
            cachet. On ne présente jamais un coût partiel comme le coût artistes définitif de la soirée.
          </p>
        </div>
      )}

      {/* Liste des postes ou état vide honnête. */}
      {ready.total === 0 ? (
        <div className="mt-3">
          <Empty
            title="Aucun poste artiste/extra"
            text="Les cachets et coûts extras (contrats booking, factures presta) n'ont pas encore été saisis pour cette soirée. La table soiree_charges (0012) est vide — rien n'est inventé. Ajoute un poste ci-dessous ; le cachet peut rester vide tant qu'il n'est pas connu."
          />
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {charges.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-bold text-white/80">{c.label}</p>
                <p className="text-[10px] text-white/35">
                  {CHARGE_CATEGORIE_LABELS[c.categorie]} · {CHARGE_STATUS_LABELS[c.statut]}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] font-black text-white/45">
                  {c.montant_ttc == null ? "cachet —" : formatEuro(c.montant_ttc)}
                </span>
                <button
                  onClick={() => onDelete(c.id)}
                  className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-red-400"
                  aria-label="Supprimer le poste"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Formulaire d'ajout d'un poste. Le montant est optionnel (cachet pas encore connu). */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Ajouter un poste
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
            Catégorie
            <select
              value={categorie}
              onChange={(e) => isChargeCategorie(e.target.value) && setCategorie(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
            >
              {CHARGE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {CHARGE_CATEGORIE_LABELS[cat]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
            Statut
            <select
              value={statut}
              onChange={(e) => isChargeStatus(e.target.value) && setStatut(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
            >
              {CHARGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CHARGE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
            Libellé (nom de scène / description)
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ex. DJ Untel, ingé son, videur renfort"
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
            />
          </label>
          <CaisseField
            label="Cachet / coût TTC"
            hint="€ · opt."
            value={montant}
            onChange={setMontant}
            placeholder="laisser vide si inconnu"
          />
        </div>
        {feedback && <p className="mt-2 text-[11px] text-white/50">{feedback}</p>}
        <button
          onClick={submit}
          disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-black text-black disabled:opacity-50"
        >
          <Plus size={16} /> {busy ? "Enregistrement…" : "Ajouter le poste"}
        </button>
      </div>

      <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-white/35">
        Le P&amp;L s&apos;allume tout seul dès que chaque poste engagé a un cachet : le coût artistes
        devient alors la 2ᵉ charge déduite (après le coût staff). Budget directionnel (RLS 0012).
      </p>
    </div>
  );
}

function BottomNav({
  activeTab,
  onChange,
  user,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
  user: StaffUser;
}) {
  const allItems: [Tab, React.ElementType, string][] = [
    ["plan", LayoutGrid, "Plan"],
    ["reservations", Table2, "Tables"],
    ["clients", Users, "Clients"],
    ["security", CalendarDays, "Sécu"],
    ["flux", Plus, "Flux"],
    ["promoters", Bell, "Promos"],
    ["stats", BarChart3, "Stats"],
    ["caisse", Wallet, "Caisse"],
    ["pnl", TrendingUp, "P&L"],
    ["rh", CalendarClock, "RH"],
    ["artistes", Music, "Artistes"],
  ];

  const visibleTabs = visibleTabsForRole(user.role);
  const items = allItems.filter(([tab]) => visibleTabs.includes(tab));

  return (
    <nav className={`grid shrink-0 border-t border-white/10 bg-black text-[9px] text-white/60 ${items.length === 11 ? "grid-cols-11" : items.length === 10 ? "grid-cols-10" : items.length === 9 ? "grid-cols-9" : items.length === 8 ? "grid-cols-8" : items.length === 7 ? "grid-cols-7" : items.length === 6 ? "grid-cols-6" : items.length === 4 ? "grid-cols-4" : items.length === 3 ? "grid-cols-3" : "grid-cols-5"}`}>
      {items.map(([tab, Icon, label]) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`flex flex-col items-center gap-0.5 py-2 ${
            activeTab === tab ? "text-orange-500" : ""
          }`}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Stat({
  value,
  label,
  color,
}: {
  value: number | string;
  label: string;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <b className={`text-sm ${color}`}>{value}</b>
      <br />
      {label}
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-black text-orange-500">{value}</p>
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
      <p className="font-black">{title}</p>
      <p className="mt-1 text-sm text-white/45">{text}</p>
    </div>
  );
}
