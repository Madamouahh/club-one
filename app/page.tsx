"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
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
} from "lucide-react";

type Status = "free" | "option" | "booked" | "arrived" | "vip";
type Tab = "plan" | "reservations" | "clients" | "security" | "flux" | "stats";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
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
  password: string;
  role: "admin" | "manager" | "server" | "security" | "security_counter" | "promoter";
  full_name: string;
};

type EntryLog = {
  id: string;
  type: "entry" | "exit";
  staff_username: string;
  created_at: string;
};

const STAFF_FALLBACK: StaffUser[] = [
  { id: "local-maxime", username: "maxime", password: "M4xime-9286", role: "admin", full_name: "Maxime" },
  { id: "local-jerome", username: "jerome", password: "J3rome-4719", role: "admin", full_name: "JÃ©rÃ´me" },
  { id: "local-anthony", username: "anthony", password: "Anth0ny-6382", role: "admin", full_name: "Anthony" },
  { id: "local-enguerrand", username: "enguerrand", password: "Engu3rrand-2047", role: "manager", full_name: "Enguerrand" },
  { id: "local-jeremy", username: "jeremy", password: "J3remy-8154", role: "server", full_name: "Jeremy" },
  { id: "local-hanass", username: "hanass", password: "Hanass-7391", role: "security", full_name: "Hanass" },
  { id: "local-mohamed", username: "mohamed", password: "Mohamed-4821", role: "security_counter", full_name: "Mohamed" },
  { id: "local-mathias", username: "mathias", password: "Mathias-5628", role: "promoter", full_name: "Mathias" },
  { id: "local-quentin", username: "quentin", password: "Qu3ntin-9472", role: "promoter", full_name: "Quentin" },
  { id: "local-lawrence", username: "lawrence", password: "Lawr3nce-3165", role: "promoter", full_name: "Lawrence" },
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
  booker?: string;
  assignedTo?: string;
  linkedGroupId?: string;
  linkedTables?: string[];
  expenses?: ExpenseItem[];
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
    label: "RÃ©servÃ©e",
    dot: "bg-red-500",
    border: "border-red-500",
    text: "text-red-300",
    glow: "shadow-[0_0_20px_rgba(239,68,68,.95)]",
    bg: "bg-red-500/25",
  },
  arrived: {
    label: "ArrivÃ©e",
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

  { id: "A1", zone: "Espace A Â· table seule", x: 76, y: 10, status: "free", capacity: 6 },

  { id: "A2", zone: "Espace A Â· bloc central", x: 76, y: 22, status: "free", capacity: 6 },
  { id: "A3", zone: "Espace A Â· bloc central", x: 76, y: 32, status: "free", capacity: 6 },
  { id: "A4", zone: "Espace A Â· bloc central", x: 76, y: 42, status: "free", capacity: 6 },

  { id: "A5", zone: "Espace A Â· bloc bas", x: 76, y: 54, status: "free", capacity: 6 },
  { id: "A6", zone: "Espace A Â· bloc bas", x: 76, y: 64, status: "free", capacity: 6 },
  { id: "A7", zone: "Espace A Â· bloc bas", x: 76, y: 74, status: "free", capacity: 6 },

  { id: "VIP1", zone: "CarrÃ© VIP", x: 63, y: 86, status: "free", capacity: 10 },
  { id: "VIP2", zone: "CarrÃ© VIP", x: 84, y: 86, status: "free", capacity: 10 },
  { id: "VIP3", zone: "CarrÃ© VIP", x: 63, y: 94, status: "free", capacity: 12 },
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
    // Les anciennes dÃ©penses sans dateKey sont rattachÃ©es Ã  la soirÃ©e active
    // pour ne pas perdre les saisies dÃ©jÃ  faites pendant les tests.
    if (!item.dateKey || item.dateKey === eventDate) {
      return sum + (Number(item.amount) || 0);
    }

    return sum;
  }, 0);
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

function nowLabel() {
  return new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createExpense(label: string, amount: number): ExpenseItem {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    amount,
    createdAt: nowLabel(),
    dateKey: todayKey(),
  };
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
      booker: row.booker || "",
      assignedTo: row.assigned_to || "",
      linkedGroupId: row.linked_group_id || "",
      linkedTables: row.linked_tables || [],
      expenses: row.expenses || [],
    };
  });
}

function toDbRow(table: ClubTable) {
  return {
    id: table.id,
    zone: table.zone,
    status: table.status,
    capacity: table.capacity,
    client: table.client || "",
    phone: table.phone || "",
    people: table.people || "",
    notes: table.notes || "",
    event_date: table.eventDate || "",
    booker: table.booker || "",
    assigned_to: table.assignedTo || "",
    linked_group_id: table.linkedGroupId || "",
    linked_tables: table.linkedTables || [],
    expenses: table.expenses || [],
    updated_at: new Date().toISOString(),
  };
}

async function seedTablesIfNeeded() {
  const { data, error } = await supabase.from("club_tables").select("id");

  if (error) {
    console.error("Supabase select error:", error.message);
    return;
  }

  if (data && data.length > 0) return;

  const rows = INITIAL_TABLES.map((table) =>
    toDbRow({ ...table, expenses: [] })
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


function getSavedUser() {
  if (typeof window === "undefined") return null;

  const saved = window.localStorage.getItem("club-one-staff-user");
  if (!saved) return null;

  try {
    return JSON.parse(saved) as StaffUser;
  } catch {
    window.localStorage.removeItem("club-one-staff-user");
    return null;
  }
}

function canAccessTable(table: ClubTable, user: StaffUser | null) {
  if (!user) return false;

  // Admin, manager et promoteurs voient toutes les tables.
  // Un promoteur doit pouvoir choisir / assigner des tables, pas seulement voir les siennes.
  if (user.role === "admin" || user.role === "manager" || user.role === "promoter") {
    return true;
  }

  // SÃ©curitÃ© et compteur ne doivent pas Ãªtre bloquÃ©s par les assignations.
  if (user.role === "security" || user.role === "security_counter") {
    return true;
  }

  // Le serveur voit les tables classiques non attribuÃ©es aux promoteurs.
  if (user.role === "server") {
    return !table.assignedTo || table.assignedTo === "jeremy" || table.assignedTo === "server";
  }

  return false;
}

function canEditTable(table: ClubTable, user: StaffUser | null) {
  if (!user) return false;

  // Admin, manager et promoteurs peuvent modifier/assigner les tables.
  if (user.role === "admin" || user.role === "manager" || user.role === "promoter") {
    return true;
  }

  if (user.role === "server") {
    return !table.assignedTo || table.assignedTo === "jeremy" || table.assignedTo === "server";
  }

  return false;
}

function roleLabel(role: StaffUser["role"]) {
  const labels: Record<StaffUser["role"], string> = {
    admin: "Admin",
    manager: "Manager",
    server: "Serveur",
    security: "SÃ©curitÃ©",
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

export default function Page() {
  const [tables, setTables] = useState<ClubTable[]>(INITIAL_TABLES);
  const [selected, setSelected] = useState<ClubTable | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [search, setSearch] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [entryLogs, setEntryLogs] = useState<EntryLog[]>([]);
  const [saveError, setSaveError] = useState("");
  const [activeEventDate, setActiveEventDate] = useState(todayKey());

  useEffect(() => {
    const savedUser = getSavedUser();
    if (savedUser) {
      setCurrentUser(savedUser);
      if (savedUser.role === "security") setActiveTab("security");
      if (savedUser.role === "security_counter") setActiveTab("flux");
    }
  }, []);

  useEffect(() => {
    async function init() {
      await seedTablesIfNeeded();
      const liveTables = await fetchTables();
      const liveLogs = await fetchEntryLogs();
      setTables(liveTables);
      setEntryLogs(liveLogs);
      setIsOnline(true);
    }

    init();

    const channel = supabase
      .channel("club_live_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "club_tables" },
        async () => {
          const liveTables = await fetchTables();
          setTables(liveTables);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entry_logs" },
        async () => {
          const liveLogs = await fetchEntryLogs();
          setEntryLogs(liveLogs);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const visibleTables = useMemo(
    () => tables.filter((table) => canAccessTable(table, currentUser)),
    [tables, currentUser]
  );

  const stats = useMemo(
    () => ({
      free: visibleTables.filter((table) => table.status === "free").length,
      option: visibleTables.filter((table) => table.status === "option").length,
      booked: visibleTables.filter((table) => table.status === "booked").length,
      arrived: visibleTables.filter((table) => table.status === "arrived").length,
      vip: visibleTables.filter((table) => table.id.startsWith("VIP")).length,
      revenue: visibleTables.reduce((sum, table) => sum + tableTotalForDate(table, activeEventDate), 0),
      spendTables: visibleTables.filter((table) => tableTotalForDate(table, activeEventDate) > 0).length,
    }),
    [visibleTables, activeEventDate]
  );

  const activeTables = useMemo(
    () =>
      visibleTables
        .filter(
          (table) =>
            table.status !== "free" ||
            table.client ||
            table.phone ||
            tableTotal(table) > 0
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
        totalSpend: clientTables.reduce((sum, table) => sum + tableTotal(table), 0),
      };
    });

    return rows.filter((client) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return `${client.name} ${client.phone}`.toLowerCase().includes(q);
    });
  }, [visibleTables, search]);

  async function saveTable(next: ClubTable) {
    setSaveError("");

    const row = toDbRow(next);

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

  async function saveTableWithGroup(next: ClubTable) {
    setSaveError("");

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
      eventDate: next.eventDate || "",
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

    setTables(nextTables);
    setSelected(null);

    const rowsToSave = nextTables
      .filter((table) => groupMembers.includes(table.id))
      .map(toDbRow);

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
    const initial = INITIAL_TABLES.find((item) => item.id === tableId);
    if (!initial) return;

    const reset: ClubTable = {
      ...initial,
      status: "free",
      client: "",
      phone: "",
      people: "",
      notes: "",
      eventDate: "",
      booker: "",
      assignedTo: "",
      linkedGroupId: "",
      linkedTables: [],
      expenses: [],
    };

    setTables((current) => current.map((table) => (table.id === tableId ? reset : table)));
    setSelected(null);

    const { error } = await supabase
      .from("club_tables")
      .upsert(toDbRow(reset), { onConflict: "id" });

    if (error) {
      const message = `ERREUR RESET ${tableId} : ${error.message}`;
      console.error(message, error);
      setSaveError(message);
      alert(message);
    }
  }

  async function resetAll() {
    const resetTables: ClubTable[] = INITIAL_TABLES.map((table) => ({
      ...table,
      status: "free",
      client: "",
      phone: "",
      people: "",
      notes: "",
      eventDate: "",
      booker: "",
      assignedTo: "",
      linkedGroupId: "",
      linkedTables: [],
      expenses: [],
    }));

    setTables(resetTables);

    const { error } = await supabase
      .from("club_tables")
      .upsert(resetTables.map(toDbRow), { onConflict: "id" });

    if (error) {
      console.error("Supabase reset all error:", error.message);
    }
  }
  async function login(username: string, password: string) {
    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    const fallbackUser = STAFF_FALLBACK.find(
      (user) => user.username === cleanUsername && user.password === cleanPassword
    );

    if (fallbackUser) {
      setCurrentUser(fallbackUser);
      window.localStorage.setItem("club-one-staff-user", JSON.stringify(fallbackUser));

      if (fallbackUser.role === "security") setActiveTab("security");
      else if (fallbackUser.role === "security_counter") setActiveTab("flux");
      else setActiveTab("plan");

      return true;
    }

    const { data, error } = await supabase
      .from("staff_users")
      .select("*")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (error) {
      console.error("Login Supabase error:", error.message);
      return false;
    }

    if (!data) {
      return false;
    }

    const user = data as StaffUser;

    if ((user.password || "").trim() !== cleanPassword) {
      return false;
    }

    setCurrentUser(user);
    window.localStorage.setItem("club-one-staff-user", JSON.stringify(user));

    if (user.role === "security") setActiveTab("security");
    else if (user.role === "security_counter") setActiveTab("flux");
    else setActiveTab("plan");

    return true;
  }

  function logout() {
    window.localStorage.removeItem("club-one-staff-user");
    setCurrentUser(null);
    setActiveTab("plan");
  }

  async function addEntryLog(type: "entry" | "exit") {
    if (!currentUser) return;

    const { error } = await supabase.from("entry_logs").insert({
      type,
      staff_username: currentUser.username,
    });

    if (error) {
      console.error("Supabase entry log error:", error.message);
    }
  }


  async function closeSession() {
    const confirmed = window.confirm(
      `ClÃ´turer la soirÃ©e du ${activeEventDate} ? Les stats seront archivÃ©es puis les tables seront remises Ã  zÃ©ro.`
    );

    if (!confirmed) return;

    const entries = entryLogs.filter((log) => {
      const d = new Date(log.created_at);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}` === activeEventDate && log.type === "entry";
    }).length;

    const exits = entryLogs.filter((log) => {
      const d = new Date(log.created_at);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}` === activeEventDate && log.type === "exit";
    }).length;

    const revenue = tables.reduce(
      (sum, table) => sum + tableTotalForDate(table, activeEventDate),
      0
    );

    const { error } = await supabase.from("event_archives").insert({
      event_date: activeEventDate,
      closed_by: currentUser?.username || "",
      total_revenue: revenue,
      total_entries: entries,
      total_exits: exits,
      tables_snapshot: tables,
      entry_logs_snapshot: entryLogs,
    });

    if (error) {
      const message = `ERREUR CLÃ”TURE : ${error.message}`;
      console.error(message, error);
      alert(message);
      return;
    }

    await resetAll();
    alert(`SoirÃ©e du ${activeEventDate} clÃ´turÃ©e et archivÃ©e.`);
  }



  function markArrived(tableId: string) {
    const table = tables.find((item) => item.id === tableId);
    if (!table) return;

    saveTable({ ...table, status: "arrived" });
  }

  if (!currentUser) {
    return <LoginView onLogin={login} />;
  }

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
                {isOnline ? `Live Â· soirÃ©e du ${activeEventDate}` : "Connexion live..."}
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

        <div className="grid shrink-0 grid-cols-4 gap-2 p-2 text-center text-[8px]">
          <Stat value={stats.free} label="Libres" color="text-emerald-400" />
          <Stat value={stats.option} label="Options" color="text-amber-300" />
          <Stat value={stats.booked} label="RÃ©servÃ©es" color="text-red-300" />
          <Stat value={`${stats.revenue}â‚¬`} label="DÃ©penses" color="text-cyan-300" />
        </div>

        {saveError && (
          <div className="mx-2 mb-2 rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
            {saveError}
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-hidden p-2">
          {activeTab === "plan" && (
            <PlanView tables={visibleTables} onSelect={setSelected} />
          )}

          {activeTab === "reservations" && (
            <ReservationsView
              tables={activeTables}
              onSelect={setSelected}
              onReset={resetTable}
            />
          )}

          {activeTab === "clients" && (
            <ClientsView
              clients={clients}
              search={search}
              onSearch={setSearch}
              onSelectTable={setSelected}
            />
          )}

          {activeTab === "security" && (
            <SecurityView
              tables={activeTables}
              search={search}
              onSearch={setSearch}
              onSelect={setSelected}
              onMarkArrived={markArrived}
            />
          )}

          {activeTab === "flux" && (
            <FluxView
              logs={entryLogs}
              onEntry={() => addEntryLog("entry")}
              onExit={() => addEntryLog("exit")}
            />
          )}

          {activeTab === "stats" && (
            <StatsView
              stats={stats}
              tables={visibleTables}
              entryLogs={entryLogs}
              activeEventDate={activeEventDate}
              onChangeEventDate={setActiveEventDate}
              onCloseSession={closeSession}
              onResetAll={resetAll}
            />
          )}
        </main>

        <BottomNav activeTab={activeTab} onChange={setActiveTab} user={currentUser} />
      </div>

      <TableModal
        table={selected}
        onClose={() => setSelected(null)}
        onSave={saveTable}
        onSaveGroup={saveTableWithGroup}
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
        <TableButton key={table.id} table={table} tables={tables} onClick={onSelect} />
      ))}
    </section>
  );
}

function TableButton({
  table,
  tables,
  onClick,
}: {
  table: ClubTable;
  tables: ClubTable[];
  onClick: (table: ClubTable) => void;
}) {
  const isVip = table.id.startsWith("VIP");
  const visual = isVip && table.status === "free" ? STATUS.vip : STATUS[table.status];
  const total = tableTotal(table);

  return (
    <button
      type="button"
      onClick={() => onClick(table)}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border active:scale-95 ${visual.border} ${visual.glow} ${visual.bg} ${
        isVip ? "h-[34px] w-[54px]" : "h-[30px] w-[38px]"
      }`}
      style={{ left: `${table.x}%`, top: `${table.y}%` }}
    >
      <span
        className={`font-black leading-none ${
          isVip ? "text-[10px]" : "text-[11px]"
        } ${visual.text}`}
      >
        {table.id}
      </span>
      <span
        className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${visual.dot}`}
      />
      {groupBadge(table, tables) && (
        <span className="absolute -left-2 -top-2 rounded-full bg-orange-500 px-1.5 py-0.5 text-[8px] font-black text-black">
          {groupBadge(table, tables)}
        </span>
      )}
      {total > 0 && (
        <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-500 px-1.5 py-0.5 text-[8px] font-black text-black">
          {total}â‚¬
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
  onReset,
  currentUser,
  allTables,
  activeEventDate,
}: {
  table: ClubTable | null;
  onClose: () => void;
  onSave: (table: ClubTable) => void;
  onSaveGroup: (table: ClubTable) => void;
  onReset: (tableId: string) => void;
  currentUser: StaffUser;
  allTables: ClubTable[];
  activeEventDate: string;
}) {
  const [form, setForm] = useState<ClubTable | null>(table);
  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");

  useEffect(() => {
    setForm(table);
    setExpenseLabel("");
    setExpenseAmount("");
  }, [table]);

  if (!table || !form) return null;

  const total = tableTotal(form);
  const cleanPhone = phoneForWhatsapp(form.phone);
  const whatsappText = encodeURIComponent(
    `Salut ${form.client || ""}, on te confirme ta table ${form.id} pour ce soir.`
  );

  function addExpense(label: string, amount: number) {
    if (!form || !amount) return;

    const nextForm: ClubTable = {
      ...form,
      expenses: [
        ...(form.expenses || []),
        {
          ...createExpense(label || "DÃ©pense", amount),
          dateKey: activeEventDate,
        },
      ],
      status: form.status === "free" ? "arrived" : form.status,
    };

    setForm(nextForm);
  }

  function addCustomExpense() {
    const amount = Number(expenseAmount);
    if (!amount || amount <= 0) return;

    addExpense(expenseLabel || "DÃ©pense libre", amount);
    setExpenseLabel("");
    setExpenseAmount("");
  }

  function removeExpense(expenseId: string) {
    if (!form) return;

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
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">DÃ©pense table</p>
          <p className="text-3xl font-black text-cyan-300">{total}â‚¬</p>
        </div>

        <div className="mb-3 grid grid-cols-4 gap-2">
          {(["free", "option", "booked", "arrived"] as Status[]).map((status) => (
            <button
              key={status}
              type="button"
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
            onChange={(event) => setForm({ ...form, client: event.target.value })}
          />
          <input
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            placeholder="TÃ©lÃ©phone"
            value={form.phone || ""}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
          <div className="grid grid-cols-3 gap-3">
            <input
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 outline-none"
              placeholder="Pers."
              value={form.people || ""}
              onChange={(event) => setForm({ ...form, people: event.target.value })}
            />
            <input
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 outline-none"
              placeholder="Staff"
              value={form.booker || ""}
              onChange={(event) => setForm({ ...form, booker: event.target.value })}
            />
            <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3 text-[11px] text-white/55">
              SoirÃ©e<br />
              <span className="font-black text-orange-300">{activeEventDate}</span>
            </div>
          </div>
          {(currentUser.role === "admin" || currentUser.role === "manager" || currentUser.role === "promoter") && (
            <select
              className="rounded-2xl border border-white/10 bg-[#151515] px-4 py-3 outline-none"
              value={form.assignedTo || ""}
              onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}
            >
              <option value="">Serveur / table normale</option>
              <option value="mathias">Mathias Â· Promoteur</option>
              <option value="quentin">Quentin Â· Promoteur</option>
              <option value="lawrence">Lawrence Â· Promoteur</option>
              <option value="jeremy">Jeremy Â· Serveur</option>
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
              onChange={(event) => setExpenseLabel(event.target.value)}
            />
            <input
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              placeholder="Montant"
              inputMode="numeric"
              value={expenseAmount}
              onChange={(event) => setExpenseAmount(event.target.value)}
            />
            <button
              onClick={addCustomExpense}
              className="grid place-items-center rounded-xl bg-cyan-500 text-black"
            >
              <span className="text-xs font-black">ADD</span>
            </button>
          </div>
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
                  <p className="font-black text-cyan-300">{item.amount}â‚¬</p>
                  <button
                    onClick={() => removeExpense(item.id)}
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
            className="flex items-center justify-center gap-1 rounded-2xl bg-white/10 py-3 text-xs font-bold text-white/70"
          >
            <Trash2 size={15} /> Reset
          </button>
          <button
            onClick={() => {
              if ((form.linkedTables || []).length) {
                onSaveGroup(form);
              } else {
                onSave(form);
              }
            }}
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
  onSelect,
  onReset,
}: {
  tables: ClubTable[];
  onSelect: (table: ClubTable) => void;
  onReset: (tableId: string) => void;
}) {
  if (!tables.length) {
    return <Empty title="Aucune table active" text="Clique sur une table du plan pour crÃ©er une rÃ©servation ou ajouter une dÃ©pense." />;
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
                  {table.client || "Client Ã  renseigner"} Â· {table.people || "?"} pers.
                </p>
                <p className="mt-1 text-xs text-cyan-300">
                  DÃ©pense : {tableTotal(table)}â‚¬ Â· {STATUS[table.status].label}
                </p>
                {!!(table.linkedTables || []).length && (
                  <p className="mt-1 text-[11px] text-orange-300">
                    JumelÃ©e : {[table.id, ...(table.linkedTables || [])].join(" + ")}
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
  search,
  onSearch,
  onSelectTable,
}: {
  clients: { name: string; phone: string; tables: ClubTable[]; totalSpend: number }[];
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
          placeholder="Rechercher client ou tÃ©lÃ©phone"
          className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
        />
      </div>

      {!clients.length && <Empty title="Aucun client" text="Les clients apparaÃ®tront ici aprÃ¨s ajout sur une table." />}

      <div className="grid gap-2">
        {clients.map((client) => (
          <div
            key={`${client.name}-${client.phone}`}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black">{client.name}</p>
                <p className="text-xs text-white/45">{client.phone || "TÃ©lÃ©phone non renseignÃ©"}</p>
                <p className="mt-1 text-xs text-cyan-300">{client.totalSpend}â‚¬ dÃ©pensÃ©s</p>
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
                  {table.id} Â· {tableTotal(table)}â‚¬
                </button>
              ))}
            </div>
          </div>
        ))}
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
  logs,
  onEntry,
  onExit,
}: {
  logs: EntryLog[];
  onEntry: () => void;
  onExit: () => void;
}) {
  const entries = logs.filter((log) => log.type === "entry").length;
  const exits = logs.filter((log) => log.type === "exit").length;
  const inside = Math.max(entries - exits, 0);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <h2 className="mb-3 text-lg font-black">Flux entrÃ©es / sorties</h2>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <BigStat label="Dedans" value={String(inside)} />
        <BigStat label="EntrÃ©es" value={String(entries)} />
        <BigStat label="Sorties" value={String(exits)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onEntry}
          className="rounded-3xl bg-emerald-500 py-8 text-3xl font-black text-black active:scale-95"
        >
          + ENTRÃ‰E
        </button>
        <button
          onClick={onExit}
          className="rounded-3xl bg-red-500 py-8 text-3xl font-black text-white active:scale-95"
        >
          - SORTIE
        </button>
      </div>

      <div className="mt-4 grid gap-2">
        {logs.slice(0, 40).map((log) => (
          <div
            key={log.id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <span className={log.type === "entry" ? "font-black text-emerald-400" : "font-black text-red-400"}>
              {log.type === "entry" ? "EntrÃ©e" : "Sortie"}
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
  tables,
  search,
  onSearch,
  onSelect,
  onMarkArrived,
}: {
  tables: ClubTable[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (table: ClubTable) => void;
  onMarkArrived: (tableId: string) => void;
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
      <h2 className="mb-3 text-lg font-black">EntrÃ©e / SÃ©curitÃ©</h2>

      <div className="mb-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
        <Search size={16} className="text-white/35" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Nom, tÃ©lÃ©phone, table..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
        />
      </div>

      {!filteredTables.length && (
        <Empty
          title="Aucune rÃ©servation trouvÃ©e"
          text="Les tables rÃ©servÃ©es ou optionnÃ©es apparaÃ®tront ici pour la sÃ©curitÃ©."
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
                  {table.client || "Nom Ã  renseigner"}
                </p>
                <p className="text-xs text-white/45">
                  {table.people || "?"} pers. Â· {table.phone || "tel non renseignÃ©"}
                </p>
                <p className="mt-1 text-xs text-white/35">
                  {table.zone} Â· {STATUS[table.status].label}
                </p>
                {table.notes && (
                  <p className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/65">
                    {table.notes}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <button
                  onClick={() => onMarkArrived(table.id)}
                  className="rounded-xl bg-cyan-500 px-3 py-2 text-xs font-black text-black"
                >
                  ArrivÃ©
                </button>
                <button
                  onClick={() => onSelect(table)}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black"
                >
                  Fiche
                </button>
              </div>
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

      {!dayTables.length && <Empty title="Aucune table ce jour" text="Ajoute une date dans la fiche dâ€™une table." />}

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
              {table.client || "Client Ã  renseigner"} Â· {table.people || "?"} pers. Â· {tableTotal(table)}â‚¬
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
}) {
  const totalTables = tables.length || 1;
  const activeTables = tables.filter(
    (table) =>
      table.status !== "free" ||
      table.client ||
      table.phone ||
      tableTotal(table) > 0
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

  const topTables = [...tables]
    .filter((table) => tableTotalForDate(table, activeEventDate) > 0)
    .sort((a, b) => tableTotalForDate(b, activeEventDate) - tableTotalForDate(a, activeEventDate))
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
    const revenue = zone.tables.reduce((sum, table) => sum + tableTotalForDate(table, activeEventDate), 0);
    const active = zone.tables.filter(
      (table) =>
        table.status !== "free" ||
        table.client ||
        table.phone ||
        tableTotal(table) > 0
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
    const revenue = promoterTables.reduce((sum, table) => sum + tableTotalForDate(table, activeEventDate), 0);

    return {
      promoter,
      revenue,
      active: promoterTables.filter(
        (table) =>
          table.status !== "free" ||
          table.client ||
          table.phone ||
          tableTotal(table) > 0
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
          <h2 className="text-lg font-black">Dashboard soirÃ©e</h2>
          <p className="text-xs uppercase tracking-[0.18em] text-white/35">
            Stats rattachÃ©es Ã  la date globale
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
        <BigStat label="CA tables" value={`${stats.revenue}â‚¬`} />
        <BigStat label="Occupation" value={`${occupancy}%`} />
        <BigStat label="Tables actives" value={String(filled)} />
        <BigStat label="Panier moyen" value={`${averageSpend}â‚¬`} />
        <BigStat label="EntrÃ©es" value={String(entries)} />
        <BigStat label="Dedans" value={String(inside)} />
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
                <span className="font-black text-cyan-300">{zone.revenue}â‚¬</span>
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

        {!topTables.length && <p className="text-sm text-white/40">Aucune dÃ©pense enregistrÃ©e.</p>}

        <div className="grid gap-2">
          {topTables.map((table) => (
            <div key={table.id} className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-2">
              <div>
                <span className="font-black text-orange-400">{table.id}</span>
                <p className="text-[11px] text-white/35">
                  {table.client || "Client non renseignÃ©"}
                  {!!(table.linkedTables || []).length &&
                    ` Â· ${[table.id, ...(table.linkedTables || [])].join(" + ")}`}
                </p>
              </div>
              <span className="font-black text-cyan-300">{tableTotalForDate(table, activeEventDate)}â‚¬</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Promoteurs
        </p>

        <div className="grid gap-2">
          {promoterRows.map((row) => (
            <div
              key={row.promoter}
              className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-2"
            >
              <div>
                <p className="font-black capitalize text-orange-400">{row.promoter}</p>
                <p className="text-[11px] text-white/35">{row.active} table(s) active(s)</p>
              </div>
              <p className="font-black text-cyan-300">{row.revenue}â‚¬</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Flux par heure
        </p>

        {!hourlyRows.length && <p className="text-sm text-white/40">Aucun flux enregistrÃ©.</p>}

        <div className="grid gap-2">
          {hourlyRows.map((row) => (
            <div
              key={row.hour}
              className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-2"
            >
              <span className="font-black text-white/70">{row.hour}h</span>
              <span className="text-sm text-emerald-400">+{row.entries} entrÃ©es</span>
              <span className="text-sm text-red-400">-{row.exits} sorties</span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onCloseSession}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-500/40 bg-orange-500/15 px-4 py-3 text-sm font-black text-orange-200"
      >
        ClÃ´turer et archiver la soirÃ©e
      </button>

      <button
        onClick={onResetAll}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-300"
      >
        <RotateCcw size={16} />
        RÃ©initialiser sans archive
      </button>
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
    ["security", CalendarDays, "SÃ©cu"],
    ["flux", Plus, "Flux"],
    ["stats", BarChart3, "Stats"],
  ];

  const items = allItems.filter(([tab]) => {
    if (user.role === "security") return tab === "security";
    if (user.role === "security_counter") return tab === "flux";
    if (user.role === "server") {
      return tab === "plan" || tab === "reservations" || tab === "clients";
    }

    if (user.role === "promoter") {
      return tab === "plan" || tab === "reservations" || tab === "clients" || tab === "stats";
    }
    return true;
  });

  return (
    <nav className={`grid shrink-0 border-t border-white/10 bg-black text-[9px] text-white/60 ${items.length === 6 ? "grid-cols-6" : items.length === 3 ? "grid-cols-3" : "grid-cols-5"}`}>
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
