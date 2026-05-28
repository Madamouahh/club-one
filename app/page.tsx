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
} from "lucide-react";

type Status = "free" | "option" | "booked" | "arrived" | "vip";
type Tab = "plan" | "reservations" | "clients" | "security" | "stats";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type ExpenseItem = {
  id: string;
  label: string;
  amount: number;
  createdAt: string;
};

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
  expenses?: ExpenseItem[];
};

const STORAGE_KEY = "club-one-v3-live-expenses";

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

  { id: "VIP1", zone: "Carré VIP", x: 63, y: 86, status: "vip", capacity: 10 },
  { id: "VIP2", zone: "Carré VIP", x: 84, y: 86, status: "vip", capacity: 10 },
  { id: "VIP3", zone: "Carré VIP", x: 63, y: 94, status: "vip", capacity: 12 },
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
      status: row.status || layoutTable.status,
      capacity: row.capacity ?? layoutTable.capacity,
      client: row.client || "",
      phone: row.phone || "",
      people: row.people || "",
      notes: row.notes || "",
      eventDate: row.event_date || "",
      booker: row.booker || "",
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

export default function Page() {
  const [tables, setTables] = useState<ClubTable[]>(INITIAL_TABLES);
  const [selected, setSelected] = useState<ClubTable | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [search, setSearch] = useState("");
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    async function init() {
      await seedTablesIfNeeded();
      const liveTables = await fetchTables();
      setTables(liveTables);
      setIsOnline(true);
    }

    init();

    const channel = supabase
      .channel("club_tables_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "club_tables" },
        async () => {
          const liveTables = await fetchTables();
          setTables(liveTables);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const stats = useMemo(
    () => ({
      free: tables.filter((table) => table.status === "free").length,
      option: tables.filter((table) => table.status === "option").length,
      booked: tables.filter((table) => table.status === "booked").length,
      arrived: tables.filter((table) => table.status === "arrived").length,
      vip: tables.filter((table) => table.id.startsWith("VIP")).length,
      revenue: tables.reduce((sum, table) => sum + tableTotal(table), 0),
      spendTables: tables.filter((table) => tableTotal(table) > 0).length,
    }),
    [tables]
  );

  const activeTables = useMemo(
    () =>
      tables
        .filter(
          (table) =>
            table.status !== "free" ||
            table.client ||
            table.phone ||
            tableTotal(table) > 0
        )
        .sort(sortTables),
    [tables]
  );

  const clients = useMemo(() => {
    const map = new Map<string, ClubTable[]>();

    tables.forEach((table) => {
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
  }, [tables, search]);

  async function saveTable(next: ClubTable) {
    setTables((current) => current.map((table) => (table.id === next.id ? next : table)));
    setSelected(null);

    const { error } = await supabase
      .from("club_tables")
      .upsert(toDbRow(next), { onConflict: "id" });

    if (error) {
      console.error("Supabase save error:", error.message);
      const liveTables = await fetchTables();
      setTables(liveTables);
    }
  }

  async function resetTable(tableId: string) {
    const initial = INITIAL_TABLES.find((item) => item.id === tableId);
    if (!initial) return;

    const reset: ClubTable = {
      ...initial,
      status: initial.id.startsWith("VIP") ? "vip" : "free",
      client: "",
      phone: "",
      people: "",
      notes: "",
      eventDate: "",
      booker: "",
      expenses: [],
    };

    setTables((current) => current.map((table) => (table.id === tableId ? reset : table)));
    setSelected(null);

    const { error } = await supabase
      .from("club_tables")
      .upsert(toDbRow(reset), { onConflict: "id" });

    if (error) {
      console.error("Supabase reset error:", error.message);
    }
  }

  async function resetAll() {
    const resetTables: ClubTable[] = INITIAL_TABLES.map((table) => ({
      ...table,
      status: table.id.startsWith("VIP") ? "vip" : "free",
      client: "",
      phone: "",
      people: "",
      notes: "",
      eventDate: "",
      booker: "",
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

  function markArrived(tableId: string) {
    const table = tables.find((item) => item.id === tableId);
    if (!table) return;

    saveTable({ ...table, status: "arrived" });
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
                {isOnline ? "Live synchronisé Supabase" : "Connexion live..."}
              </p>
            </div>
            <div className="relative rounded-2xl border border-white/10 bg-white/5 p-2">
              <Bell size={17} />
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-xs font-black">
                {activeTables.length}
              </span>
            </div>
          </div>
        </header>

        <div className="grid shrink-0 grid-cols-4 gap-2 p-2 text-center text-[8px]">
          <Stat value={stats.free} label="Libres" color="text-emerald-400" />
          <Stat value={stats.option} label="Options" color="text-amber-300" />
          <Stat value={stats.booked} label="Réservées" color="text-red-300" />
          <Stat value={`${stats.revenue}€`} label="Dépenses" color="text-cyan-300" />
        </div>

        <main className="min-h-0 flex-1 overflow-hidden p-2">
          {activeTab === "plan" && (
            <PlanView tables={tables} onSelect={setSelected} />
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

          {activeTab === "stats" && (
            <StatsView stats={stats} tables={tables} onResetAll={resetAll} />
          )}
        </main>

        <BottomNav activeTab={activeTab} onChange={setActiveTab} />
      </div>

      <TableModal
        table={selected}
        onClose={() => setSelected(null)}
        onSave={saveTable}
        onReset={resetTable}
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
        <TableButton key={table.id} table={table} onClick={onSelect} />
      ))}
    </section>
  );
}

function TableButton({
  table,
  onClick,
}: {
  table: ClubTable;
  onClick: (table: ClubTable) => void;
}) {
  const visual = STATUS[table.status];
  const isVip = table.id.startsWith("VIP");
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
  onReset,
}: {
  table: ClubTable | null;
  onClose: () => void;
  onSave: (table: ClubTable) => void;
  onReset: (tableId: string) => void;
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
      expenses: [...(form.expenses || []), createExpense(label || "Dépense", amount)],
      status: form.status === "free" ? "arrived" : form.status,
    };

    setForm(nextForm);
  }

  function addCustomExpense() {
    const amount = Number(expenseAmount);
    if (!amount || amount <= 0) return;

    addExpense(expenseLabel || "Dépense libre", amount);
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
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Dépense table</p>
          <p className="text-3xl font-black text-cyan-300">{total}€</p>
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
            placeholder="Téléphone"
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
            <input
              type="date"
              className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3 text-[11px] outline-none"
              value={form.eventDate || ""}
              onChange={(event) => setForm({ ...form, eventDate: event.target.value })}
            />
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
                  <p className="font-black text-cyan-300">{item.amount}€</p>
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
            onClick={() => onSave(form)}
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
                  Dépense : {tableTotal(table)}€ · {STATUS[table.status].label}
                </p>
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
          placeholder="Rechercher client ou téléphone"
          className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
        />
      </div>

      {!clients.length && <Empty title="Aucun client" text="Les clients apparaîtront ici après ajout sur une table." />}

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
                  {table.id} · {tableTotal(table)}€
                </button>
              ))}
            </div>
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
      <h2 className="mb-3 text-lg font-black">Entrée / Sécurité</h2>

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
          text="Les tables réservées ou optionnées apparaîtront ici pour la sécurité."
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
  onResetAll: () => void;
}) {
  const filled = tables.filter((table) => table.status !== "free").length;
  const occupancy = Math.round((filled / tables.length) * 100);
  const averageSpend = stats.spendTables ? Math.round(stats.revenue / stats.spendTables) : 0;

  const topTables = [...tables]
    .filter((table) => tableTotal(table) > 0)
    .sort((a, b) => tableTotal(b) - tableTotal(a))
    .slice(0, 5);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <h2 className="mb-3 text-lg font-black">Stats soirée</h2>

      <div className="grid grid-cols-2 gap-2">
        <BigStat label="Occupation" value={`${occupancy}%`} />
        <BigStat label="CA réel" value={`${stats.revenue}€`} />
        <BigStat label="Tables actives" value={String(filled)} />
        <BigStat label="Panier moyen" value={`${averageSpend}€`} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Top tables
        </p>

        {!topTables.length && <p className="text-sm text-white/40">Aucune dépense enregistrée.</p>}

        <div className="grid gap-2">
          {topTables.map((table) => (
            <div key={table.id} className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-2">
              <span className="font-black text-orange-400">{table.id}</span>
              <span className="font-black text-cyan-300">{tableTotal(table)}€</span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onResetAll}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-300"
      >
        <RotateCcw size={16} />
        Réinitialiser la soirée
      </button>
    </div>
  );
}

function BottomNav({
  activeTab,
  onChange,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}) {
  const items: [Tab, React.ElementType, string][] = [
    ["plan", LayoutGrid, "Plan"],
    ["reservations", Table2, "Tables"],
    ["clients", Users, "Clients"],
    ["security", CalendarDays, "Sécu"],
    ["stats", BarChart3, "Stats"],
  ];

  return (
    <nav className="grid shrink-0 grid-cols-5 border-t border-white/10 bg-black text-[9px] text-white/60">
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








