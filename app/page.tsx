"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@supabase/supabase-js";
import { QrCheckInPanel } from "@/components/QrCheckInPanel";
import { GuestPassScanPanel } from "@/components/GuestPassScanPanel";
import {
  extractPassToken,
  interpretScanResult,
  normalizeScanResponse,
  type ScanFeedback,
  type ScanPassResult,
} from "@/lib/crmScan";
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
import { buildPnlPeriode, type PnlPeriodeNight } from "@/lib/pnlPeriode";
import {
  COVERAGE_MIN_CONFIDENCE,
  RETENTION_WINDOW_DAYS,
  buildFormatMonthlyRollup,
  buildSoireeUniversMetrics,
  isLearningUnivers,
  summarizeLearningHonesty,
  type CoverageVerdict,
  type LearningUnivers,
  type LearningVisit,
  type SoireeUniversMetrics,
} from "@/lib/crmLearning";
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
  CalendarCheck,
  Music,
  QrCode,
  Link2,
  Copy,
  PhoneCall,
  Sparkles,
  Cake,
  Lightbulb,
} from "lucide-react";
import {
  FUNNEL_UNIVERS,
  INVITE_KINDS,
  validateInviteDraft,
  type FunnelUnivers,
  type InviteKind,
} from "@/lib/crmFunnel";
import {
  CONTRAT_TYPES,
  SHIFT_STATUSES,
  instantToHHMM,
  rhDataReady,
  staffChargeAmount,
  summarizeMasseHoraire,
  validateShiftDraft,
  validateStaffMemberDraft,
  type ContratType,
  type MasseHoraire,
  type ShiftDraft,
  type ShiftStatus,
  type StaffMember,
  type StaffMemberDraft,
  type StaffShift,
} from "@/lib/rhPlanning";
import {
  buildMonthlyStaffRollups,
  buildPeriodStaffRollup,
  periodStaffChargeAmount,
  rollupDataReady,
  type MonthlyStaffRollup,
  type PeriodStaffRollup,
} from "@/lib/rhRollup";
import {
  applyPeriodChoice,
  distinctMonths,
  monthLabelFr,
  normalizeChoice,
  periodChoiceLabel,
  WINDOW_CHOICE,
  type PeriodChoice,
} from "@/lib/periodSelection";
import {
  canSelfConfirm,
  shiftStatusLabel,
  splitMyShifts,
  summarizeMyHours,
  type MyHoursSummary,
} from "@/lib/rhSelf";
import {
  GUEST_SEGMENTS,
  GUEST_SEGMENT_LABELS,
  classifyGuest,
  crmDataReady,
  prepareContactLink,
  spendThreshold,
  type GuestScoreRow,
  type GuestSegment,
} from "@/lib/crmClients";
import {
  CALL_REASONS,
  CALL_REASON_META,
  buildCallList,
  suggestCallMessage,
  tallyCallReasons,
  type CallListEntry,
  type CallListGuest,
  type CallReason,
} from "@/lib/crmCallList";
import {
  INCIDENT_TYPES,
  INCIDENT_LEVELS,
  canManageIncidents,
  canReportIncident,
  canViewAllIncidents,
  incidentLevelLabel,
  incidentStatusLabel,
  incidentTypeLabel,
  isActiveStatus,
  nextStatuses,
  sortByPriority,
  summarizeIncidents,
  validateIncidentDraft,
  visibleIncidents,
  type Incident,
  type IncidentDraft,
  type IncidentLevel,
  type IncidentStatus,
  type IncidentType,
  type IncidentUpdate,
} from "@/lib/incidents";

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

// Archive de clôture (close_club_event_v2) : total_entries figé au moment de la clôture depuis les
// vrais entry_logs de l'événement. Source HONNÊTE et persistante des entrées historiques par soirée
// (contrairement à entry_logs, tronqué aux 300 dernières lignes). Lecture direction-only (RLS
// ea_select_admin_manager, 0009).
type EventArchiveEntry = {
  event_date: string | null;
  total_entries: number | null;
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

// PLAN EDEN — SCHÉMA D'EXPLOITATION, construit COMME le Terminus (fondateur 2026-07-04 :
// « c'est pas du tout comme j'ai fait sur le Terminus ») : des COLONNES propres par zone, gros
// boutons espacés (pitch 8%, comme les colonnes B/C/A), étiquettes de zone — PAS une carte
// géographique. 44 tables réelles ; capacity 0 = mange-debout (groupe debout, sans chaise).
const EDEN_TABLES: ClubTable[] = [
  // Colonne RANGÉE 500 puis RANGÉE 300 (x=14)
  { id: "505", zone: "Rangée 500", x: 14, y: 9, status: "free", capacity: 2 },
  { id: "504", zone: "Rangée 500", x: 14, y: 17, status: "free", capacity: 2 },
  { id: "503", zone: "Rangée 500", x: 14, y: 25, status: "free", capacity: 2 },
  { id: "502", zone: "Rangée 500", x: 14, y: 33, status: "free", capacity: 2 },
  { id: "501", zone: "Rangée 500", x: 14, y: 41, status: "free", capacity: 2 },
  { id: "304", zone: "Rangée 300", x: 14, y: 54, status: "free", capacity: 2 },
  { id: "303", zone: "Rangée 300", x: 14, y: 62, status: "free", capacity: 2 },
  { id: "302", zone: "Rangée 300", x: 14, y: 70, status: "free", capacity: 2 },
  { id: "301", zone: "Rangée 300", x: 14, y: 78, status: "free", capacity: 2 },
  { id: "300", zone: "Rangée 300", x: 14, y: 86, status: "free", capacity: 2 },
  // Colonne RANGÉE 600 (x=38) puis oliviers gauche
  { id: "606", zone: "Rangée 600", x: 38, y: 9, status: "free", capacity: 2 },
  { id: "605", zone: "Rangée 600", x: 38, y: 17, status: "free", capacity: 2 },
  { id: "604", zone: "Rangée 600", x: 38, y: 25, status: "free", capacity: 2 },
  { id: "603", zone: "Rangée 600", x: 38, y: 33, status: "free", capacity: 2 },
  { id: "602", zone: "Rangée 600", x: 38, y: 41, status: "free", capacity: 2 },
  { id: "601", zone: "Rangée 600", x: 38, y: 49, status: "free", capacity: 2 },
  { id: "600", zone: "Rangée 600", x: 38, y: 57, status: "free", capacity: 2 },
  { id: "205", zone: "Oliviers", x: 38, y: 70, status: "free", capacity: 6 },
  { id: "203", zone: "Oliviers", x: 38, y: 78, status: "free", capacity: 6 },
  { id: "201", zone: "Oliviers", x: 38, y: 86, status: "free", capacity: 6 },
  // Colonne RANGÉE 700 (x=62) puis oliviers droite
  { id: "704", zone: "Rangée 700", x: 62, y: 9, status: "free", capacity: 2 },
  { id: "703", zone: "Rangée 700", x: 62, y: 17, status: "free", capacity: 2 },
  { id: "702", zone: "Rangée 700", x: 62, y: 25, status: "free", capacity: 2 },
  { id: "701", zone: "Rangée 700", x: 62, y: 33, status: "free", capacity: 2 },
  { id: "700", zone: "Rangée 700", x: 62, y: 41, status: "free", capacity: 2 },
  { id: "204", zone: "Oliviers", x: 62, y: 70, status: "free", capacity: 6 },
  { id: "202", zone: "Oliviers", x: 62, y: 78, status: "free", capacity: 6 },
  { id: "200", zone: "Oliviers", x: 62, y: 86, status: "free", capacity: 6 },
  // Colonne MANGE-DEBOUT (x=86) — groupes debout, sans chaise (capacity 0)
  { id: "405", zone: "Mange-debout", x: 86, y: 9, status: "free", capacity: 0 },
  { id: "406", zone: "Mange-debout", x: 86, y: 17, status: "free", capacity: 0 },
  { id: "404", zone: "Mange-debout", x: 86, y: 25, status: "free", capacity: 0 },
  { id: "403", zone: "Mange-debout", x: 86, y: 33, status: "free", capacity: 0 },
  { id: "402", zone: "Mange-debout", x: 86, y: 41, status: "free", capacity: 0 },
  { id: "401", zone: "Mange-debout", x: 86, y: 49, status: "free", capacity: 0 },
  { id: "400", zone: "Mange-debout", x: 86, y: 57, status: "free", capacity: 0 },
  { id: "500", zone: "Mange-debout", x: 86, y: 65, status: "free", capacity: 0 },
  { id: "107", zone: "Mange-debout", x: 86, y: 73, status: "free", capacity: 0 },
  { id: "106", zone: "Mange-debout", x: 86, y: 81, status: "free", capacity: 0 },
  // Bande CANAPÉS en bas (6 pers chacun)
  { id: "105", zone: "Canapés", x: 11, y: 94, status: "free", capacity: 6 },
  { id: "104", zone: "Canapés", x: 26.5, y: 94, status: "free", capacity: 6 },
  { id: "103", zone: "Canapés", x: 42, y: 94, status: "free", capacity: 6 },
  { id: "102", zone: "Canapés", x: 57.5, y: 94, status: "free", capacity: 6 },
  { id: "101", zone: "Canapés", x: 73, y: 94, status: "free", capacity: 6 },
  { id: "100", zone: "Canapés", x: 88.5, y: 94, status: "free", capacity: 6 },
];

// L'univers de la soirée ACTIVE choisit le layout (Eden ↔ Terminus). Terminus par défaut
// (comportement historique). Mis à jour à chaque chargement du contexte d'événement (0032).
// Match sur venue_id ('eden') — le nom affiché « L'Éden » porte un accent, pas l'identifiant.
function isEdenVenue(venueId: string | null | undefined): boolean {
  return venueId === "eden";
}
let ACTIVE_LAYOUT: ClubTable[] = INITIAL_TABLES;
function setActiveLayoutForVenue(venueId: string | null | undefined) {
  ACTIVE_LAYOUT = isEdenVenue(venueId) ? EDEN_TABLES : INITIAL_TABLES;
}


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

  return ACTIVE_LAYOUT.map((layoutTable) => {
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

  return ACTIVE_LAYOUT.map((layoutTable) => {
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

// R2 (audit lancement 2026-07-05) : les sauvegardes de MÉTADONNÉES de table (client/statut/groupe…)
// ne doivent JAMAIS réécrire la colonne `expenses`. Sinon un upsert full-row avec l'array `expenses`
// figé à l'ouverture du formulaire ÉCRASE une dépense ajoutée entre-temps par `add_expense_v3`
// (perte de CA en pleine soirée, last-write-wins). `omitExpenses` retire donc la clé de l'objet
// upserté : sur un ON CONFLICT (la table est toujours pré-semée), la colonne `expenses` n'est pas
// dans le SET → sa valeur en base est PRÉSERVÉE. Les dépenses ne se pilotent QUE via add_expense_v3 /
// removeExpense. Les remises à zéro EXPLICITES (resetTable/resetAll, direction) gardent, elles,
// `expenses: []` (elles VEULENT vider la table) → omitExpenses=false par défaut.
function toDbRow(
  table: ClubTable,
  activeEvent: ActiveEventContext,
  opts: { omitExpenses?: boolean } = {},
) {
  const row: Record<string, unknown> = {
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
    updated_at: new Date().toISOString(),
  };
  if (!opts.omitExpenses) {
    row.expenses = table.expenses || [];
  }
  return row;
}

async function seedTablesIfNeeded(user: StaffUser | null, activeEvent: ActiveEventContext | null) {
  const { data, error } = await supabase.from("club_tables").select("id");

  if (error) {
    console.error("Supabase select error:", error.message);
    return;
  }

  // Semis PAR LAYOUT : on ne crée que les tables du layout actif encore absentes de la base
  // (Terminus déjà semé → no-op ; première soirée Eden → les 44 tables Eden s'ajoutent).
  const existing = new Set((data ?? []).map((row) => row.id));
  const missing = ACTIVE_LAYOUT.filter((table) => !existing.has(table.id));
  if (missing.length === 0) return;
  if (!user || !canUseCriticalAction(user.role, "canManageGlobal")) return;
  if (!activeEvent) return;

  const rows = missing.map((table) =>
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
    return ACTIVE_LAYOUT;
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

// P&L de PÉRIODE — lignes caisse_z sur une fenêtre glissante [from .. to] (bornes incluses). Même
// RLS directionnelle que la lecture par date ; on borne la lecture pour ne pas rapatrier tout
// l'historique. Base vide → [] → P&L de période honnêtement vide.
async function fetchCaisseZForRange(fromDate: string, toDate: string): Promise<CaisseZRecord[]> {
  const { data, error } = await supabase
    .from("caisse_z")
    .select("*")
    .gte("exploitation_date", fromDate)
    .lte("exploitation_date", toDate)
    .order("exploitation_date", { ascending: true });

  if (error) {
    console.error("Supabase caisse_z range fetch error:", error.message);
    return [];
  }

  return (data || []) as CaisseZRecord[];
}

// P&L de PÉRIODE — entrées historiques par soirée via event_archives (total_entries figé à la
// clôture). Bornées sur la même fenêtre [from .. to] que les Z. Même RLS directionnelle : un
// non-direction reçoit une liste vide. Sert à rallumer le panier moyen de période SANS estimer une
// entrée : chaque nuit sans archive reste « entrées inconnues » (null) côté moteur.
async function fetchEventArchivesForRange(fromDate: string, toDate: string): Promise<EventArchiveEntry[]> {
  const { data, error } = await supabase
    .from("event_archives")
    .select("event_date,total_entries")
    .gte("event_date", fromDate)
    .lte("event_date", toDate)
    .order("event_date", { ascending: true });

  if (error) {
    console.error("Supabase event_archives range fetch error:", error.message);
    return [];
  }

  return (data || []) as EventArchiveEntry[];
}

// RH / Planning (B7) — vue DIRECTION. Depuis la 0021, le répertoire complet (dont taux_horaire et
// notes_direction) passe par la RPC SECURITY DEFINER list_staff_members_v1(), gardée admin/manager :
// le SELECT colonne de ces 2 colonnes sensibles est révoqué au rôle `authenticated`, donc un accès
// table direct .select("*") échouerait désormais. La RPC renvoie l'état RÉEL (VIDE tant que le
// fondateur n'a pas fourni la liste), déjà trié (actif desc, full_name asc). Un non-direction est
// refusé côté SQL (raise forbidden) → tableau vide honnête ici.
async function fetchStaffMembers(): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc("list_staff_members_v1");

  if (error) {
    console.error("Supabase list_staff_members_v1 error:", error.message);
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

// Fenêtre de dates d'exploitation pour le CUMUL MULTI-SOIRÉES (récap période/mois du coût staff, B7).
// On fait le calcul du cumul côté client (lib/rhRollup, pur & testé) — ici on ne fait que borner la
// lecture à une fenêtre glissante pour ne pas rapatrier tout l'historique. La RLS 0011 direction voit
// tous les shifts ; base vide → [] → cumul honnêtement vide.
const ROLLUP_WINDOW_DAYS = 120;

function rollupWindowStart(exploitationDate: string): string {
  const anchor = Date.parse(`${exploitationDate}T00:00:00.000Z`);
  const base = Number.isFinite(anchor) ? anchor : Date.now();
  return new Date(base - ROLLUP_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

// Shifts sur la fenêtre glissante [start .. exploitationDate] (bornes incluses). Même RLS que ci-dessus.
async function fetchStaffShiftsForRange(fromDate: string, toDate: string): Promise<StaffShift[]> {
  const { data, error } = await supabase
    .from("staff_shifts")
    .select("*")
    .gte("exploitation_date", fromDate)
    .lte("exploitation_date", toDate)
    .order("exploitation_date", { ascending: true });

  if (error) {
    console.error("Supabase staff_shifts range fetch error:", error.message);
    return [];
  }

  return (data || []) as StaffShift[];
}

// Vue SALARIÉ (B7) : MA fiche. La RLS 0011 (staff_members_read) ne renvoie au non-direction QUE sa
// propre ligne (username = current_staff_username). Aucune donnée fondateur : vide si pas encore saisi.
// Colonnes EXPLICITES (jamais select("*")) : la vue salarié ne demande PAS taux_horaire (PII paie) ni
// notes_direction (réservé direction, 0011) — ces colonnes ne transitent donc pas dans la charge réseau
// du salarié. (Défense en profondeur : la protection colonne-level durable côté SQL reste un chantier
// prod — voir WORKLOG, la RLS 0011 est row-level et ne borne pas les colonnes.)
async function fetchMyStaffMember(username: string): Promise<StaffMember | null> {
  const { data, error } = await supabase
    .from("staff_members")
    .select("id, username, full_name, poste, contrat_type, actif")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error("Supabase staff_members (self) fetch error:", error.message);
    return null;
  }
  if (!data) return null;
  // taux_horaire / notes_direction volontairement forcés à null : jamais de PII paie/RH côté salarié.
  return { ...(data as Omit<StaffMember, "taux_horaire" | "notes_direction">), taux_horaire: null, notes_direction: null };
}

// Vue SALARIÉ (B7) : TOUS mes créneaux (à venir + passés), scopés par la RLS 0011 (staff_shifts_read)
// à mon seul staff_member_id. On limite à une fenêtre raisonnable (les plus récents/à venir d'abord)
// pour ne pas charger un historique illimité — la répartition à venir/passé se fait ensuite (rhSelf).
async function fetchMyStaffShifts(memberId: string): Promise<StaffShift[]> {
  // Colonnes explicites : on exclut `commentaire` (remarque interne éventuelle de la direction, 0011)
  // de la charge réseau du salarié — la vue « Mon planning » n'en a pas besoin.
  const { data, error } = await supabase
    .from("staff_shifts")
    .select(
      "id, staff_member_id, event_id, exploitation_date, poste, planned_start, planned_end, actual_start, actual_end, status",
    )
    .eq("staff_member_id", memberId)
    .order("exploitation_date", { ascending: false })
    .limit(120);

  if (error) {
    console.error("Supabase staff_shifts (self) fetch error:", error.message);
    return [];
  }
  return (data || []).map((s) => ({ ...(s as Omit<StaffShift, "commentaire">), commentaire: null }));
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

// Un lien/QR d'invitation du funnel CRM (table invite_links, migration 0014). La RLS cantonne la
// lecture : direction voit tout, promoteur voit SES liens (created_by = lui). anon n'a aucun accès
// direct (tout passe par les RPC). La table ship VIDE : aucun lien inventé.
type InviteLinkRow = {
  id: string;
  token: string;
  created_by: string | null;
  exploitation_date: string;
  univers: FunnelUnivers;
  kind: InviteKind;
  table_ref: string | null;
  max_uses: number;
  uses_count: number;
  expires_at: string | null;
  created_at: string;
};

// Lit les liens d'invitation visibles par le rôle courant (RLS invite_links). Le plus récent d'abord.
async function fetchInviteLinks(): Promise<InviteLinkRow[]> {
  const { data, error } = await supabase
    .from("invite_links")
    .select("id, token, created_by, exploitation_date, univers, kind, table_ref, max_uses, uses_count, expires_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase invite_links fetch error:", error.message);
    return [];
  }

  return (data || []) as InviteLinkRow[];
}

// Incidents (module A6, table incidents 0023). La RLS 0023 est l'AUTORITÉ : direction/sécurité voient
// TOUT ; server/security_counter ne reçoivent QUE leurs propres signalements ; promoteur/artiste →
// aucune ligne. On lit sans filtre client (la base a déjà cantonné) et on trie ensuite par priorité.
// La table ship VIDE : aucun incident inventé → état vide honnête.
async function fetchIncidents(): Promise<Incident[]> {
  const { data, error } = await supabase
    .from("incidents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase incidents fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => {
    const r = row as Partial<Incident>;
    return { ...(r as Incident), photo_refs: r.photo_refs ?? [] };
  });
}

// Fil de suivi (table incident_updates 0023) des incidents VISIBLES par le rôle courant. La RLS
// réplique le prédicat de lecture d'incidents (direction/sécurité = tout ; les autres = le fil de
// leurs propres signalements). Le plus ancien d'abord (ordre chronologique du fil).
async function fetchIncidentUpdates(): Promise<IncidentUpdate[]> {
  const { data, error } = await supabase
    .from("incident_updates")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Supabase incident_updates fetch error:", error.message);
    return [];
  }

  return (data || []) as IncidentUpdate[];
}

// ————————————————————————————————————————————————————————————————
// CRM V1 — données de la call-list du mardi (vue guest_scores + colonnes guests + résas à venir).
// TOUT est cantonné par la RLS 0013 : un promoteur ne lit QUE ses clients ; la direction voit tout.
// La base ship VIDE → chaque requête renvoie [] tant qu'aucune résa n'a été captée (aucun client inventé).
// ————————————————————————————————————————————————————————————————

// Métadonnées client hors vue guest_scores (téléphone/consentement/opt-out/anniversaire).
type CrmGuestMeta = {
  phone: string | null;
  consent_marketing: boolean;
  opt_out: boolean;
  birthday: string | null;
};

type CrmData = {
  scores: GuestScoreRow[];
  meta: Record<string, CrmGuestMeta>;
  upcoming: Record<string, string>; // guest_id → date ISO de la prochaine résa (booked/confirmed)
  contactsToday: number; // sollicitations sortantes loggées aujourd'hui par le staff courant (compteur)
};

const EMPTY_CRM_DATA: CrmData = { scores: [], meta: {}, upcoming: {}, contactsToday: 0 };

// Lit toutes les données CRM nécessaires à la call-list. La RLS fait le cantonnement (aucune fuite
// inter-promoteurs). En cas d'erreur, on renvoie l'état vide honnête plutôt qu'une donnée partielle.
async function fetchCrmData(staffUsername: string): Promise<CrmData> {
  const today = todayKey();

  const [scoresRes, guestsRes, visitsRes, contactsRes] = await Promise.all([
    supabase
      .from("guest_scores")
      .select(
        "guest_id, first_name, last_name, owner_promoter, last_seated_date, visits_seated_90d, visits_seated_180d, visits_seated_12m, spend_seated_12m, visits_seated_total, no_shows_total, visits_resolved_total, avg_party_size, univers_prefere, client_historique, first_seen_at, source",
      ),
    supabase.from("guests").select("id, phone, consent_marketing, opt_out_at, birthday"),
    supabase
      .from("guest_visits")
      .select("guest_id, exploitation_date, status")
      .in("status", ["booked", "confirmed"])
      .gte("exploitation_date", today),
    supabase
      .from("guest_contacts")
      .select("id", { count: "exact", head: true })
      .eq("staff_username", staffUsername)
      .eq("direction", "outbound")
      .gte("contacted_at", `${today}T00:00:00`),
  ]);

  if (scoresRes.error) {
    console.error("Supabase guest_scores fetch error:", scoresRes.error.message);
    return EMPTY_CRM_DATA;
  }

  const meta: Record<string, CrmGuestMeta> = {};
  for (const g of guestsRes.data || []) {
    meta[g.id as string] = {
      phone: (g.phone as string | null) ?? null,
      consent_marketing: !!g.consent_marketing,
      opt_out: !!g.opt_out_at,
      birthday: (g.birthday as string | null) ?? null,
    };
  }

  // Prochaine résa par client = la date la plus proche parmi ses visites à venir.
  const upcoming: Record<string, string> = {};
  for (const v of visitsRes.data || []) {
    const gid = v.guest_id as string;
    const d = v.exploitation_date as string;
    if (!upcoming[gid] || d < upcoming[gid]) upcoming[gid] = d;
  }

  return {
    scores: (scoresRes.data || []) as GuestScoreRow[],
    meta,
    upcoming,
    contactsToday: contactsRes.count ?? 0,
  };
}

// ————————————————————————————————————————————————————————————————
// Boucle d'apprentissage CRM (spec §148-156) — lecture DIRECTION stricte.
// Croise trois vérités DÉJÀ en base : le Z de caisse (CA réel, 0010), l'historique des visites
// clients (guest_visits, 0013) et l'étiquette de programmation des soirées (events.format, 0022).
// Le moteur (lib/crmLearning) est PUR : ce fetcher ne fait que lire, sans rien fabriquer. La RLS
// cantonne déjà (direction = tout ; les autres rôles reçoivent des listes vides) → état vide honnête.
// ————————————————————————————————————————————————————————————————

type LearningData = {
  caisseRecords: CaisseZRecord[];
  visits: LearningVisit[];
  // Étiquette de programmation par soirée × salle : clé `${event_date}|${venue_id}`. Absente = null.
  formatMap: Record<string, string | null>;
};

const EMPTY_LEARNING_DATA: LearningData = { caisseRecords: [], visits: [], formatMap: {} };

// L'exactitude des « nouveaux captés » exige l'historique COMPLET des visites (la 1re présence peut
// précéder toute fenêtre glissante) : on pagine guest_visits jusqu'au bout plutôt que de tronquer à
// la limite serveur par défaut (~1000). Les autres tables (caisse_z, events) restent petites.
async function fetchAllGuestVisits(): Promise<LearningVisit[]> {
  const pageSize = 1000;
  const out: LearningVisit[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("guest_visits")
      .select("guest_id, exploitation_date, univers, status, spend_attributed")
      .order("exploitation_date", { ascending: true })
      .order("guest_id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("Supabase guest_visits (learning) fetch error:", error.message);
      return out;
    }
    const rows = data || [];
    for (const v of rows) {
      const univers = v.univers as string;
      // Le CHECK 0013 garantit eden/cercle/terminus, mais on filtre défensivement : le moteur ne
      // travaille que sur des univers concrets (jamais une valeur inattendue promue en silence).
      if (!isLearningUnivers(univers)) continue;
      out.push({
        guest_id: v.guest_id as string,
        exploitation_date: v.exploitation_date as string,
        univers: univers as LearningUnivers,
        status: v.status as LearningVisit["status"],
        spend_attributed: (v.spend_attributed as number | null) ?? null,
      });
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

// Lit tout ce dont la boucle d'apprentissage a besoin. Direction only (la RLS renvoie [] aux autres).
// En cas d'erreur sur le Z (la vérité comptable), on renvoie l'état vide honnête plutôt qu'un croisement
// partiel : sans CA réel, la couverture — cœur du garde-fou d'honnêteté — n'aurait aucun sens.
async function fetchLearningData(): Promise<LearningData> {
  const [caisseRes, eventsRes, visits] = await Promise.all([
    supabase.from("caisse_z").select("*").order("exploitation_date", { ascending: true }),
    supabase.from("events").select("event_date, venue_id, format"),
    fetchAllGuestVisits(),
  ]);

  if (caisseRes.error) {
    console.error("Supabase caisse_z (learning) fetch error:", caisseRes.error.message);
    return EMPTY_LEARNING_DATA;
  }

  const formatMap: Record<string, string | null> = {};
  for (const e of eventsRes.data || []) {
    const date = e.event_date as string | null;
    const venue = e.venue_id as string | null;
    if (!date || !venue) continue;
    // Une soirée par salle porte au plus une étiquette ; en cas de doublon, la 1re étiquette non
    // nulle rencontrée fait foi (on n'écrase jamais une étiquette réelle par un null).
    const key = `${date}|${venue}`;
    if (formatMap[key] == null) formatMap[key] = (e.format as string | null) ?? null;
  }

  return {
    caisseRecords: (caisseRes.data || []) as CaisseZRecord[],
    visits,
    formatMap,
  };
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
  // Cumul MULTI-SOIRÉES (récap période/mois du coût staff, B7) : shifts sur une fenêtre glissante,
  // chargés à l'ouverture de l'onglet RH OU P&L (le P&L de période injecte le coût staff cumulé).
  // Distincts de staffShifts (soirée active) pour ne pas perturber le calcul per-soirée branché au P&L.
  const [staffPeriodShifts, setStaffPeriodShifts] = useState<StaffShift[]>([]);
  // P&L de PÉRIODE : lignes caisse_z sur la même fenêtre glissante, chargées à l'ouverture du P&L.
  // Distinctes de caisseZRecords (soirée active) — le produit cumulé n'écrase jamais le per-soirée.
  const [caisseZPeriodRecords, setCaisseZPeriodRecords] = useState<CaisseZRecord[]>([]);
  // P&L de PÉRIODE : entrées historiques par soirée (event_archives), chargées avec les Z de période.
  // Rallument le panier moyen de période SANS estimer une entrée (nuit sans archive = entrées inconnues).
  const [eventArchivesPeriod, setEventArchivesPeriod] = useState<EventArchiveEntry[]>([]);
  // Vue SALARIÉ (B7) : MA fiche + MES créneaux (RLS-scopés), indépendants de la vue direction ci-dessus.
  const [myMember, setMyMember] = useState<StaffMember | null>(null);
  const [myShifts, setMyShifts] = useState<StaffShift[]>([]);
  const [soireeCharges, setSoireeCharges] = useState<SoireeCharge[]>([]);
  const [inviteLinks, setInviteLinks] = useState<InviteLinkRow[]>([]);
  // Incidents (module A6, table incidents 0023) : registre + fil de suivi, cantonnés par la RLS 0023.
  // Chargés à l'ouverture de l'onglet « Incidents ». Ship VIDE — aucun incident fabriqué.
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentUpdates, setIncidentUpdates] = useState<IncidentUpdate[]>([]);
  const [crmData, setCrmData] = useState<CrmData>(EMPTY_CRM_DATA);
  const [learningData, setLearningData] = useState<LearningData>(EMPTY_LEARNING_DATA);
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
    setCaisseZPeriodRecords([]);
    setEventArchivesPeriod([]);
    setStaffPeriodShifts([]);
    setSoireeCharges([]);
    setInviteLinks([]);
    setCrmData(EMPTY_CRM_DATA);
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
        setActiveLayoutForVenue(liveEvent?.venueId);
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
        setTables(ACTIVE_LAYOUT);
        setEntryLogs([]);
        setPromoterContacts([]);
        setPromoterEntries([]);
        setSecurityTables([]);
        setIsOnline(true);
        return;
      }

      await seedTablesIfNeeded(user, liveEvent);
      const [liveTables, liveLogs, liveContacts, livePromoterEntries] = await Promise.all([
        user.role === "security" ? Promise.resolve(ACTIVE_LAYOUT) : fetchTables(),
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
      // R1 (audit lancement) : le badge « Live » ne doit plus être allumé inconditionnellement.
      // isOnline reflète désormais l'état RÉEL de l'abonnement Realtime (callback de subscribe
      // ci-dessous) — le front dit la vérité si le canal tombe (téléphone en veille, réseau coupé).

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

      channel.subscribe((status) => {
        if (!active) return;
        const subscribed = status === "SUBSCRIBED";
        setIsOnline(subscribed);
        // M3 : à chaque (RE)connexion (ex. sortie de veille du téléphone → le client Supabase
        // rouvre la websocket et re-émet SUBSCRIBED), on RATTRAPE ce qui a pu changer pendant la
        // coupure. Best-effort : on ignore les erreurs réseau transitoires.
        if (subscribed) {
          if (user.role !== "security") {
            fetchTables().then((t) => { if (active) setTables(t); }).catch(() => {});
          }
          fetchEntryLogs().then((l) => { if (active) setEntryLogs(l); }).catch(() => {});
        }
      });
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

    // Le P&L de période relit les Z sur une fenêtre glissante (récap mensuel) — uniquement dans
    // l'onglet P&L, jamais pour la Caisse qui n'a besoin que de la soirée active.
    const wantPeriodCaisse = activeTab === "pnl";

    let active = true;
    async function loadCaisseData() {
      const [produits, records, periodRecords, periodArchives] = await Promise.all([
        fetchProduitsBar(),
        fetchCaisseZForDate(activeEventDate),
        wantPeriodCaisse
          ? fetchCaisseZForRange(rollupWindowStart(activeEventDate), activeEventDate)
          : Promise.resolve<CaisseZRecord[]>([]),
        wantPeriodCaisse
          ? fetchEventArchivesForRange(rollupWindowStart(activeEventDate), activeEventDate)
          : Promise.resolve<EventArchiveEntry[]>([]),
      ]);
      if (!active) return;
      setProduitsBar(produits);
      setCaisseZRecords(records);
      if (wantPeriodCaisse) {
        setCaisseZPeriodRecords(periodRecords);
        setEventArchivesPeriod(periodArchives);
      }
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

    // La fenêtre glissante de shifts alimente DEUX écrans : le cumul RH (RhView) ET le coût staff du
    // P&L de période (PnlView). On la rapatrie donc pour l'onglet RH comme pour l'onglet P&L.
    const wantPeriod = activeTab === "rh" || activeTab === "pnl";

    let active = true;
    async function loadRhData() {
      const [members, shifts, periodShifts] = await Promise.all([
        fetchStaffMembers(),
        fetchStaffShiftsForDate(activeEventDate),
        wantPeriod
          ? fetchStaffShiftsForRange(rollupWindowStart(activeEventDate), activeEventDate)
          : Promise.resolve<StaffShift[]>([]),
      ]);
      if (!active) return;
      setStaffMembers(members);
      setStaffShifts(shifts);
      if (wantPeriod) setStaffPeriodShifts(periodShifts);
    }

    loadRhData();
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, activeEventDate]);

  // Vue SALARIÉ (B7) : charge MA fiche + MES créneaux quand j'ouvre « Mon planning ». La RLS 0011
  // cantonne déjà à ma propre fiche/mes shifts — cette vue est ouverte à tous les rôles sauf promoteur.
  // dataRefreshKey est inclus : une confirmation de présence (1 tap) recharge la liste.
  useEffect(() => {
    if (!currentUser || activeTab !== "monplanning" || !canViewTab(currentUser.role, "monplanning")) {
      return;
    }
    const username = currentUser.username;

    let active = true;
    async function loadMyPlanning() {
      const member = await fetchMyStaffMember(username);
      if (!active) return;
      setMyMember(member);
      const shifts = member ? await fetchMyStaffShifts(member.id) : [];
      if (!active) return;
      setMyShifts(shifts);
    }

    loadMyPlanning();
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, dataRefreshKey]);

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

  // Funnel CRM (0014) : les liens/QR d'invitation visibles par le rôle (direction = tout, promoteur =
  // SES liens via la RLS). Chargés à l'ouverture de l'onglet. La table ship VIDE → état vide honnête.
  useEffect(() => {
    if (!currentUser || activeTab !== "funnel" || !canViewTab(currentUser.role, "funnel")) return;

    let active = true;
    async function loadInviteLinks() {
      const links = await fetchInviteLinks();
      if (!active) return;
      setInviteLinks(links);
    }

    loadInviteLinks();
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, dataRefreshKey]);

  // Incidents (module A6, 0023) : registre + fil de suivi, chargés à l'ouverture de l'onglet. La RLS
  // 0023 est l'autorité (direction/sécurité = tout ; server/compteur = leurs propres signalements ;
  // promoteur/artiste = rien). On ne requête donc que pour les rôles qui ont accès à l'onglet ; le
  // dataRefreshKey recharge après un signalement ou une mise à jour de statut/escalade.
  useEffect(() => {
    if (!currentUser || activeTab !== "incidents" || !canViewTab(currentUser.role, "incidents")) {
      return;
    }

    let active = true;
    async function loadIncidents() {
      const [rows, updates] = await Promise.all([fetchIncidents(), fetchIncidentUpdates()]);
      if (!active) return;
      setIncidents(rows);
      setIncidentUpdates(updates);
    }

    loadIncidents();
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, dataRefreshKey]);

  // CRM V1 (0013) : données de la call-list du mardi (scores + méta guests + résas à venir + compteur
  // du jour). Chargées à l'ouverture de l'onglet crm. La RLS cantonne le promoteur à SES clients ;
  // la base ship VIDE → état vide honnête. Rechargé après un opt-out (le client sort de guest_scores).
  useEffect(() => {
    if (!currentUser || activeTab !== "crm" || !canViewTab(currentUser.role, "crm")) return;

    let active = true;
    async function loadCrm(username: string) {
      const data = await fetchCrmData(username);
      if (!active) return;
      setCrmData(data);
    }

    loadCrm(currentUser.username);
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, dataRefreshKey]);

  // Boucle d'apprentissage CRM (spec §148-156) — DIRECTION only. Charge à l'ouverture de l'onglet le
  // croisement Z de caisse × visites clients × étiquettes de programmation. La RLS renverrait de toute
  // façon des listes vides aux autres rôles ; on évite les requêtes inutiles. Le moteur ship VIDE et
  // tout état manquant reste honnêtement null → aucun faux insight tant que la donnée n'existe pas.
  useEffect(() => {
    if (!currentUser || activeTab !== "apprentissage" || !canViewTab(currentUser.role, "apprentissage")) {
      return;
    }

    let active = true;
    async function loadLearning() {
      const data = await fetchLearningData();
      if (!active) return;
      setLearningData(data);
    }

    loadLearning();
    return () => {
      active = false;
    };
  }, [currentUser, activeTab, dataRefreshKey]);

  useEffect(() => {
    if (!currentUser) return;

    let active = true;
    async function refreshActiveEventOnFocus() {
      if (document.visibilityState !== "visible") return;
      try {
        const runtime = await loadActiveEventRuntimeContext(supabase);
        if (!active) return;
        setActiveLayoutForVenue(runtime.activeEvent?.venueId);
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

    const row = toDbRow(next, liveEvent, { omitExpenses: true });

    // R3 : on capture l'état AVANT la mise à jour optimiste pour pouvoir le restaurer si l'écriture
    // échoue (coupure réseau) — sinon le plan afficherait une résa fantôme jamais persistée.
    const prevTables = tables;
    setTables((current) => current.map((table) => (table.id === next.id ? next : table)));
    setSelected(null);

    const { error } = await supabase
      .from("club_tables")
      .upsert(row, { onConflict: "id" });

    if (error) {
      const message = `ERREUR SAUVEGARDE ${next.id} : ${error.message} — non enregistré, réessaie.`;
      console.error(message, error);
      setTables(prevTables); // rollback optimiste (M1 : plus d'alert() bloquant, le bandeau suffit)
      setSaveError(message);
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

    const prevTables = tables; // R3 : snapshot pour rollback si l'écriture échoue.
    setTables(nextTables);
    setSelected(null);

    const rowsToSave = nextTables
      .filter((table) => groupMembers.includes(table.id))
      .map((table) => toDbRow(table, liveEvent, { omitExpenses: true })); // R2 : ne pas écraser expenses

    const { error } = await supabase
      .from("club_tables")
      .upsert(rowsToSave, { onConflict: "id" });

    if (error) {
      const message = `ERREUR GROUPE : ${error.message} — non enregistré, réessaie.`;
      console.error(message, error);
      setTables(prevTables); // rollback optimiste (M1 : plus d'alert() bloquant)
      setSaveError(message);
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

    const initial = ACTIVE_LAYOUT.find((item) => item.id === tableId);
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

    const prevTables = tables; // R3 : snapshot pour rollback si l'écriture échoue.
    setTables((current) => current.map((table) => (table.id === tableId ? reset : table)));
    setSelected(null);

    // Reset = libération EXPLICITE de la table (direction/serveur) → on VEUT vider expenses : pas d'omitExpenses.
    const { error } = await supabase
      .from("club_tables")
      .upsert(toDbRow(reset, liveEvent), { onConflict: "id" });

    if (error) {
      const message = `ERREUR RESET ${tableId} : ${error.message} — non enregistré, réessaie.`;
      console.error(message, error);
      setTables(prevTables); // rollback optimiste (M1 : plus d'alert() bloquant)
      setSaveError(message);
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

    const resetTables: ClubTable[] = ACTIVE_LAYOUT.map((table) => ({
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

    const prevTables = tables; // R3 : snapshot pour rollback si l'écriture échoue.
    setTables(resetTables);

    const { error } = await supabase
      .from("club_tables")
      .upsert(resetTables.map((table) => toDbRow(table, liveEvent)), { onConflict: "id" });

    if (error) {
      console.error("Supabase reset all error:", error.message);
      setTables(prevTables); // rollback optimiste
      setSaveError(`ERREUR RESET GLOBAL : ${error.message} — non enregistré, réessaie.`);
    }
  }
  async function login(username: string, password: string) {
    const user = await signInStaffUser<StaffUser>(supabase, username, password);
    if (!user) return false;

    setCurrentUser(user);
    setActiveTab(initialTabForRole(user.role));
    try {
      const runtime = await loadActiveEventRuntimeContext(supabase);
      setActiveLayoutForVenue(runtime.activeEvent?.venueId);
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
    setActiveLayoutForVenue(runtime.activeEvent?.venueId);
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

  // Incidents (A6) — SIGNALEMENT. La vraie garde est la RLS 0023 (insert direction/sécurité/server/
  // compteur, PAS promoteur) ET auteur_username = current_staff_username() côté serveur (anti-usurpation).
  // On refait ici la validation UX (type/niveau fermés, description requise) et on NE fournit JAMAIS
  // auteur_username (fixé par le default serveur). event_id relié à la soirée active si la date colle.
  async function reportIncident(draft: IncidentDraft): Promise<{ ok: boolean; message: string }> {
    if (!currentUser || !canReportIncident(currentUser.role)) {
      return { ok: false, message: "Signalement non autorisé pour ce rôle." };
    }
    const v = validateIncidentDraft(draft);
    if (!v.ok) return { ok: false, message: v.errors.join(" · ") };

    const eventId =
      activeEvent && activeEvent.eventDate === draft.exploitation_date ? activeEvent.eventId : null;

    const { error } = await supabase.from("incidents").insert({
      exploitation_date: draft.exploitation_date,
      event_id: eventId,
      type: draft.type,
      niveau: draft.niveau,
      lieu: draft.lieu?.trim() || null,
      personne_concernee: draft.personne_concernee?.trim() || null,
      description: draft.description.trim(),
      // auteur_username : NON fourni → default serveur current_staff_username() (jamais un champ client).
    });
    if (error) {
      return { ok: false, message: `Signalement refusé : ${error.message}` };
    }
    setDataRefreshKey((k) => k + 1);
    return { ok: true, message: "Incident signalé." };
  }

  // Incidents (A6) — MUTATION (statut, escalade) + fil de suivi. Réservé direction + sécurité (RLS
  // 0023 update = admin/manager/security ; server/compteur signalent seulement). Chaque action est
  // consignée dans incident_updates (auteur_username fixé serveur). resolved_at est figé au passage
  // résolu/clos, effacé si l'incident est rouvert. Rien n'est écrit s'il n'y a ni changement ni note.
  async function updateIncident(
    incident: Incident,
    patch: { status?: IncidentStatus; escalade?: boolean },
    note: string,
  ): Promise<{ ok: boolean; message: string }> {
    if (!currentUser || !canManageIncidents(currentUser.role)) {
      return { ok: false, message: "Action réservée à la direction et à la sécurité." };
    }

    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let newStatus: IncidentStatus | null = null;
    if (patch.status && patch.status !== incident.status) {
      fields.status = patch.status;
      newStatus = patch.status;
      if (patch.status === "resolu" || patch.status === "clos") {
        fields.resolved_at = incident.resolved_at ?? new Date().toISOString();
      } else {
        fields.resolved_at = null; // réouverture : la résolution n'est plus datée
      }
    }
    if (patch.escalade !== undefined && patch.escalade !== incident.escalade) {
      fields.escalade = patch.escalade;
    }

    const trimmedNote = note.trim();
    const hasChange = Object.keys(fields).length > 1; // > 1 car updated_at est toujours présent
    if (!hasChange && !trimmedNote) {
      return { ok: false, message: "Aucune modification à enregistrer." };
    }

    if (hasChange) {
      const { error } = await supabase.from("incidents").update(fields).eq("id", incident.id);
      if (error) {
        return { ok: false, message: `Mise à jour refusée : ${error.message}` };
      }
    }

    // Trace du fil : action consignée (transition + note). auteur_username fixé serveur (default 0023).
    const { error: filError } = await supabase.from("incident_updates").insert({
      incident_id: incident.id,
      new_status: newStatus,
      note: trimmedNote || null,
    });
    if (filError) {
      setDataRefreshKey((k) => k + 1); // la mutation a réussi ; on recharge et on signale honnêtement
      return { ok: false, message: `Modifié, mais trace du suivi refusée : ${filError.message}` };
    }
    setDataRefreshKey((k) => k + 1);
    return { ok: true, message: "Suivi enregistré." };
  }

  // RH (B7) — ajoute une fiche salarié (répertoire du personnel). La saisie vient du fondateur ; on
  // ne fabrique rien (taux vide = null honnête). La vraie garde est la RLS 0011 (insert direction
  // seule) ; on refait ici la validation UX (nom + identifiant obligatoires). L'identifiant relie la
  // fiche au compte staff (current_staff_username()) pour la future vue salarié.
  async function addStaffMember(draft: StaffMemberDraft): Promise<{ ok: boolean; message: string }> {
    if (!currentUser || !canViewTab(currentUser.role, "rh")) {
      return { ok: false, message: "Action réservée à la direction." };
    }
    const v = validateStaffMemberDraft(draft);
    if (!v.ok) return { ok: false, message: v.error };

    const { error } = await supabase.from("staff_members").insert(v.value);
    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      return { ok: false, message: dup ? "Identifiant déjà utilisé par une autre fiche." : `Enregistrement refusé : ${error.message}` };
    }
    setStaffMembers(await fetchStaffMembers());
    return { ok: true, message: "Salarié ajouté." };
  }

  // RH (B7) — compose/point un shift pour un salarié sur la soirée active (un seul shift par salarié
  // et par soirée : contrainte unique 0011 → upsert idempotent). Planning prévu ET pointage réel
  // passent par ici. Aucune heure inventée : un présent sans horaire réel reste sans coût (la masse
  // horaire le signale). RLS 0011 : écriture direction seule.
  async function upsertStaffShift(
    staffMemberId: string,
    draft: ShiftDraft,
  ): Promise<{ ok: boolean; message: string }> {
    if (!currentUser || !canViewTab(currentUser.role, "rh")) {
      return { ok: false, message: "Action réservée à la direction." };
    }
    const v = validateShiftDraft(activeEventDate, draft);
    if (!v.ok) return { ok: false, message: v.error };

    const eventId =
      activeEvent && activeEvent.eventDate === activeEventDate ? activeEvent.eventId : null;

    const { error } = await supabase.from("staff_shifts").upsert(
      {
        staff_member_id: staffMemberId,
        event_id: eventId,
        exploitation_date: activeEventDate,
        poste: v.value.poste,
        planned_start: v.value.planned_start,
        planned_end: v.value.planned_end,
        actual_start: v.value.actual_start,
        actual_end: v.value.actual_end,
        status: v.value.status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "staff_member_id,exploitation_date" },
    );
    if (error) {
      return { ok: false, message: `Enregistrement refusé : ${error.message}` };
    }
    setStaffShifts(await fetchStaffShiftsForDate(activeEventDate));
    return { ok: true, message: "Shift enregistré." };
  }

  // Vue SALARIÉ (B7) : confirmation de présence « 1 tap » (planifie → confirme) via la RPC
  // confirm_my_shift_v1 (0020). La RPC borne l'action côté serveur à MON propre créneau et à cette
  // seule transition — l'UI ne fait que masquer le bouton hors 'planifie' (canSelfConfirm). Aucun
  // pointage réel n'est modifiable ici (present/absent restent direction). Recharge via dataRefreshKey.
  async function confirmMyShift(shiftId: string): Promise<{ ok: boolean; message: string }> {
    if (!currentUser || !canViewTab(currentUser.role, "monplanning")) {
      return { ok: false, message: "Action non autorisée." };
    }
    const { data, error } = await supabase.rpc("confirm_my_shift_v1", { p_shift_id: shiftId });
    if (error) return { ok: false, message: `Confirmation refusée : ${error.message}` };

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.ok) {
      return { ok: false, message: row?.message ?? "Confirmation impossible." };
    }
    setDataRefreshKey((k) => k + 1);
    return { ok: true, message: row.message ?? "Présence confirmée." };
  }

  // Génère un lien/QR d'invitation du funnel CRM (RPC create_invite_link_v1, migration 0014). Le TOKEN
  // et la soirée ACTIVE sont fixés CÔTÉ SERVEUR ; created_by = l'émetteur réel (jamais un champ client).
  // Réservé promoteur+direction (RLS invite_links). Retourne le lien créé ou un message d'erreur honnête.
  async function createInviteLink(draft: {
    kind: InviteKind;
    univers: FunnelUnivers;
    tableRef: string | null;
    maxUses: number;
    expiresAt: string | null;
  }): Promise<{ ok: boolean; message: string; token?: string }> {
    if (!currentUser || !canViewTab(currentUser.role, "funnel")) {
      return { ok: false, message: "Action réservée aux promoteurs et à la direction." };
    }
    // Miroir UX des CHECK de la table 0014 (la vraie garde reste la RPC SECURITY DEFINER en SQL).
    const check = validateInviteDraft({
      kind: draft.kind,
      univers: draft.univers,
      tableRef: draft.tableRef,
      maxUses: draft.maxUses,
      expiresAt: draft.expiresAt,
    });
    if (!check.ok) {
      return { ok: false, message: "Paramètres du lien invalides." };
    }

    const { data, error } = await supabase.rpc("create_invite_link_v1", {
      p_kind: draft.kind,
      p_univers: draft.univers,
      p_table_ref: draft.tableRef,
      p_max_uses: draft.maxUses,
      p_expires_at: draft.expiresAt,
    });

    const result = Array.isArray(data) ? data[0] : data;
    if (error || !result?.ok) {
      return { ok: false, message: error?.message || result?.message || "Création du lien impossible." };
    }

    setInviteLinks(await fetchInviteLinks());
    return { ok: true, message: "Lien créé.", token: result.token as string };
  }

  // Journalise une sollicitation de la call-list (guest_contacts, 0013) : mesure de perf par promoteur
  // et preuve de traçage. La RLS cantonne l'insert (le client doit appartenir au promoteur, ou direction).
  // Cas particulier « opt_out » : le client a répondu STOP → on pose AUSSI opt_out_at sur sa fiche (flag
  // bloquant définitif, spec §checklist pt 2). Aucun envoi n'est fait ici : l'humain a cliqué le lien wa.me.
  async function logGuestContact(
    guestId: string,
    purpose: CallListEntry["contactPurpose"],
    outcome: "booked" | "no_answer" | "declined" | "opt_out",
  ): Promise<{ ok: boolean; message?: string }> {
    if (!currentUser || !canViewTab(currentUser.role, "crm")) {
      return { ok: false, message: "Action réservée à la direction et aux promoteurs." };
    }

    const { error } = await supabase.from("guest_contacts").insert({
      guest_id: guestId,
      staff_username: currentUser.username,
      channel: "whatsapp",
      purpose,
      outcome,
      direction: "outbound",
    });
    if (error) return { ok: false, message: error.message };

    if (outcome === "opt_out") {
      // STOP reçu = désinscription immédiate et définitive (le trigger 0013 empêchera toute remise à NULL).
      const { error: optErr } = await supabase
        .from("guests")
        .update({ opt_out_at: new Date().toISOString() })
        .eq("id", guestId);
      if (optErr) return { ok: false, message: `Contact loggé mais opt-out non posé : ${optErr.message}` };
      // Le client sort de guest_scores → on recharge la call-list.
      setDataRefreshKey((k) => k + 1);
    } else {
      setCrmData((d) => ({ ...d, contactsToday: d.contactsToday + 1 }));
    }
    return { ok: true };
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

  // Scan à la porte du QR d'entrée d'un client inscrit via le funnel CRM (RPC scan_guest_pass_v1,
  // migration 0015). Toute la sécurité (rôle, soirée active, idempotence) est refaite en SQL ; ici on
  // ne fait que présenter un feedback honnête. Renvoie un ScanFeedback (jamais un booléen nu) pour que
  // le panneau affiche validé / déjà entré / refusé.
  async function scanGuestPass(rawToken: string): Promise<ScanFeedback> {
    if (!currentUser || !canUseCriticalAction(currentUser.role, "canCheckInQr")) {
      return {
        tone: "error",
        admitted: false,
        title: "Action non autorisée",
        detail: "Ton rôle ne permet pas le scan à la porte.",
      };
    }

    const token = extractPassToken(rawToken);
    if (!token) {
      return {
        tone: "error",
        admitted: false,
        title: "QR invalide",
        detail: "Ce QR n'est pas un jeton d'entrée (un lien d'invitation n'est pas un QR d'entrée).",
      };
    }

    let result: ScanPassResult;
    try {
      const response = await supabase.rpc("scan_guest_pass_v1", { p_qr_token: token });
      result = normalizeScanResponse({
        data: response.data as ScanPassResult[] | ScanPassResult | null,
        error: response.error,
      });
    } catch (error) {
      result = {
        ok: false,
        code: "network_error",
        message: error instanceof Error ? error.message : "Erreur réseau pendant le scan.",
        first_name: null,
        univers: null,
        is_host: null,
        scanned_at: null,
        scanned_by: null,
      };
    }

    return interpretScanResult(result);
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
      setActiveLayoutForVenue(null); // plus de soirée active → layout par défaut
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
            <PlanView
              tables={visibleTables}
              onSelect={setSelected}
              eden={isEdenVenue(activeEvent?.venueId)}
            />
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
              onScanPass={scanGuestPass}
            />
          )}

          {effectiveActiveTab === "flux" && canViewTab(currentUser.role, "flux") && (
            <FluxView
              role={currentUser.role}
              logs={entryLogs}
              onEntry={() => addEntryLog("entry")}
              onExit={() => addEntryLog("exit")}
              onValidateQr={validatePromoterQr}
              onScanPass={scanGuestPass}
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
              periodCaisseRecords={caisseZPeriodRecords}
              periodShifts={staffPeriodShifts}
              periodArchives={eventArchivesPeriod}
            />
          )}

          {effectiveActiveTab === "rh" && canViewTab(currentUser.role, "rh") && (
            <RhView
              exploitationDate={activeEventDate}
              hasActiveEvent={!!activeEvent}
              members={staffMembers}
              shifts={staffShifts}
              periodShifts={staffPeriodShifts}
              onAddMember={addStaffMember}
              onUpsertShift={upsertStaffShift}
            />
          )}

          {effectiveActiveTab === "monplanning" && canViewTab(currentUser.role, "monplanning") && (
            <SelfPlanningView
              fullName={currentUser.full_name}
              member={myMember}
              shifts={myShifts}
              onConfirm={confirmMyShift}
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

          {effectiveActiveTab === "funnel" && canViewTab(currentUser.role, "funnel") && (
            <FunnelView
              role={currentUser.role}
              exploitationDate={activeEventDate}
              hasActiveEvent={!!activeEvent}
              links={inviteLinks}
              onCreate={createInviteLink}
            />
          )}

          {effectiveActiveTab === "crm" && canViewTab(currentUser.role, "crm") && (
            <CrmView
              role={currentUser.role}
              exploitationDate={activeEventDate}
              hasActiveEvent={!!activeEvent}
              data={crmData}
              onLogContact={logGuestContact}
            />
          )}

          {effectiveActiveTab === "incidents" && canViewTab(currentUser.role, "incidents") && (
            <IncidentsView
              role={currentUser.role}
              username={currentUser.username}
              exploitationDate={activeEventDate}
              incidents={incidents}
              updates={incidentUpdates}
              onReport={reportIncident}
              onUpdate={updateIncident}
            />
          )}

          {effectiveActiveTab === "apprentissage" && canViewTab(currentUser.role, "apprentissage") && (
            <LearningView today={todayKey()} data={learningData} />
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
  eden = false,
}: {
  tables: ClubTable[];
  onSelect: (table: ClubTable) => void;
  // Univers de la soirée active : habillage Eden (or/émeraude) ou Terminus (orange/violet).
  // Le moteur (boutons, statuts, actions) est STRICTEMENT le même dans les deux cas.
  eden?: boolean;
}) {
  return (
    <section className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-[#070707]">
      <div className="absolute inset-3 rounded-[1.35rem] border border-white/10" />

      {eden ? (
        <>
          {/* EDEN — étiquettes de colonnes (schéma d'exploitation, comme les zones B/C/A du Terminus) */}
          <div className="absolute left-[14%] top-[3%] -translate-x-1/2 text-[9px] font-black tracking-wider text-[#c8a24a]/80">R.500</div>
          <div className="absolute left-[14%] top-[48%] -translate-x-1/2 text-[9px] font-black tracking-wider text-[#c8a24a]/80">R.300</div>
          <div className="absolute left-[38%] top-[3%] -translate-x-1/2 text-[9px] font-black tracking-wider text-[#c8a24a]/80">R.600</div>
          <div className="absolute left-[62%] top-[3%] -translate-x-1/2 text-[9px] font-black tracking-wider text-[#c8a24a]/80">R.700</div>
          <div className="absolute left-[86%] top-[3%] -translate-x-1/2 text-[9px] font-black tracking-wider text-white/60">DEBOUT</div>

          {/* Carré OLIVIERS — même grammaire que le carré VIP du Terminus */}
          <div className="absolute left-[26%] top-[64.5%] h-[27%] w-[48%] rounded-2xl border-2 border-emerald-500/85 shadow-[0_0_10px_rgba(16,185,129,.50)]" />
          <div className="absolute left-[41%] top-[65.5%] text-[10px] font-black text-emerald-400">
            OLIVIERS
          </div>

          {/* Bande CANAPÉS en bas */}
          <div className="absolute bottom-[1%] left-[2%] h-[10%] w-[96%] rounded-2xl border-2 border-[#c8a24a]/85 shadow-[0_0_10px_rgba(200,162,74,.50)]" />
          <div className="absolute bottom-[11.5%] left-[4%] text-[10px] font-black text-[#c8a24a]">
            CANAPÉS
          </div>

          {/* Cabine DJ — au milieu (verdict fondateur), badge Terminus */}
          <div className="absolute left-[50%] top-[52%] flex h-[34px] w-[58px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-[#c8a24a]/80 bg-black text-sm font-black text-[#c8a24a] shadow-[0_0_7px_rgba(200,162,74,.35)]">
            DJ
          </div>
        </>
      ) : (
        <>
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
        </>
      )}

      {tables.map((table) => (
        <TableButton key={table.id} table={table} allTables={tables} onClick={onSelect} eden={eden} />
      ))}
    </section>
  );
}

// Liseré « libre » de l'univers Eden : OR (là où le Terminus est orange). Les autres statuts
// (option/réservée/arrivée) gardent leurs couleurs — le langage des statuts est UNIVERSEL.
const EDEN_FREE_VISUAL = {
  label: "Libre",
  dot: "bg-emerald-400",
  border: "border-[#c8a24a]/70",
  text: "text-[#e8d5a3]",
  glow: "shadow-[0_0_8px_rgba(200,162,74,.28)]",
  bg: "bg-[#c8a24a]/5",
};

function TableButton({
  table,
  allTables,
  onClick,
  eden = false,
}: {
  table: ClubTable;
  allTables: ClubTable[];
  onClick: (table: ClubTable) => void;
  eden?: boolean;
}) {
  const isVip = table.id.startsWith("VIP");
  const visual =
    eden && table.status === "free"
      ? EDEN_FREE_VISUAL
      : isVip && table.status === "free"
        ? STATUS.vip
        : STATUS[table.status];
  const total = groupTotal(table, allTables);
  const rawName = (table.client || table.assignedTo || "").trim();
  const displayName =
    rawName.length > 12 ? `${rawName.slice(0, 12).toUpperCase()}…` : rawName.toUpperCase();
  // Eden : MÊMES boutons que le Terminus (taille, coins, typo). Seule distinction de forme :
  // un mange-debout (capacity 0) porte un liseré POINTILLÉ.
  const isDebout = eden && table.capacity === 0;

  return (
    <button
      type="button"
      onClick={() => onClick(table)}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border active:scale-95 ${visual.border} ${visual.glow} ${visual.bg} ${
        isDebout ? "border-dashed" : ""
      } ${isVip && !eden ? "h-[42px] w-[72px]" : "h-[40px] w-[62px]"}`}
      style={{ left: `${table.x}%`, top: `${table.y}%` }}
    >
      <span
        className={`absolute left-1/2 -translate-x-1/2 font-black leading-none ${
          eden && !displayName ? "top-1/2 -translate-y-1/2" : "top-1"
        } text-[9px] ${visual.text}`}
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
  onScanPass,
}: {
  role: StaffUser["role"];
  logs: EntryLog[];
  onEntry: () => void;
  onExit: () => void;
  onValidateQr: (token: string) => Promise<boolean>;
  onScanPass: (token: string) => Promise<ScanFeedback>;
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
        <>
          <QrCheckInPanel onValidateQr={onValidateQr} />
          <GuestPassScanPanel onScanPass={onScanPass} />
        </>
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
  onScanPass,
}: {
  role: StaffUser["role"];
  tables: ClubTable[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (table: ClubTable) => void;
  onMarkArrived: (tableId: string) => void;
  onValidateQr: (token: string) => Promise<boolean>;
  onScanPass: (token: string) => Promise<ScanFeedback>;
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
        <>
          <QrCheckInPanel onValidateQr={onValidateQr} compact />
          <GuestPassScanPanel onScanPass={onScanPass} />
        </>
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
  periodCaisseRecords,
  periodShifts,
  periodArchives,
}: {
  exploitationDate: string;
  hasActiveEvent: boolean;
  caisseRecords: CaisseZRecord[];
  caTables: number;
  entryLogs: EntryLog[];
  staffMembers: StaffMember[];
  staffShifts: StaffShift[];
  soireeCharges: SoireeCharge[];
  periodCaisseRecords: CaisseZRecord[];
  periodShifts: StaffShift[];
  periodArchives: EventArchiveEntry[];
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

  // P&L de PÉRIODE (cumul multi-soirées, fenêtre glissante & récap mensuel). Réutilise buildPnlSoiree
  // nuit par nuit pour le produit (aucune divergence avec le per-soirée ci-dessus) et le cumul RH pour
  // le coût staff (une seule source, lib/rhRollup). Le CA des tables historique par nuit n'est PAS
  // reconstituable (les tables sont remises à zéro à la clôture) → on n'affiche aucun rapprochement au
  // niveau période (jamais un 0 fabriqué) ; le rapprochement reste per-soirée ci-dessus.
  // Sélecteur de période : fenêtre glissante entière (défaut, comportement historique) ou un mois
  // calendaire précis présent dans la fenêtre déjà chargée. Ne recharge RIEN depuis le réseau — filtre
  // côté client la liste déjà en mémoire avant de la passer aux moteurs purs. Aucun montant fabriqué :
  // filtrer restreint la base, ne la crée pas ; les moteurs restent seuls juges des « — ».
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>(WINDOW_CHOICE);
  const availableMonths = useMemo(
    () =>
      distinctMonths([
        ...periodCaisseRecords.map((r) => r.exploitation_date),
        ...periodShifts.map((s) => s.exploitation_date),
      ]),
    [periodCaisseRecords, periodShifts],
  );

  const periode = useMemo(() => {
    // Un mois disparu de la fenêtre rechargée retombe proprement sur la fenêtre entière.
    const choice = normalizeChoice(periodChoice, availableMonths);
    const selCaisse = applyPeriodChoice(periodCaisseRecords, (r) => r.exploitation_date, choice);
    const selShifts = applyPeriodChoice(periodShifts, (s) => s.exploitation_date, choice);
    const selArchives = applyPeriodChoice(
      periodArchives.filter((a) => a.event_date != null),
      (a) => a.event_date as string,
      choice,
    );

    // Entrées historiques par soirée (event_archives.total_entries figé à la clôture). Une date sans
    // archive OU sans compteur reste ABSENTE de la carte → la nuit correspondante aura entries=null
    // (inconnues), donc hors panier moyen. Aucune entrée n'est estimée.
    const entriesByDate = new Map<string, number>();
    for (const a of selArchives) {
      if (a.event_date != null && a.total_entries != null) entriesByDate.set(a.event_date, a.total_entries);
    }

    const byDate = new Map<string, CaisseZRecord[]>();
    for (const r of selCaisse) {
      const bucket = byDate.get(r.exploitation_date);
      if (bucket) bucket.push(r);
      else byDate.set(r.exploitation_date, [r]);
    }
    const nights: PnlPeriodeNight[] = [...byDate.entries()].map(([date, records]) => ({
      exploitationDate: date,
      caisseRecords: records,
      caTables: 0, // CA tables historique non reconstituable → hors rapprochement de période
      // Entrées de la nuit depuis event_archives ; null si aucune archive (ex. soirée active pas encore
      // clôturée) → nuit exclue du panier moyen, jamais un 0 qui gonflerait le ratio.
      entries: entriesByDate.has(date) ? entriesByDate.get(date)! : null,
    }));

    const rollup = buildPeriodStaffRollup(selShifts, staffMembers);
    const monthlyRollups = buildMonthlyStaffRollups(selShifts, staffMembers);
    const monthlyStaffCharges: Record<string, number | null> = {};
    for (const m of monthlyRollups) monthlyStaffCharges[m.month] = periodStaffChargeAmount(m.rollup);
    const operatedDates = rollup.nights.filter((n) => n.presents > 0).map((n) => n.exploitationDate);

    return buildPnlPeriode({
      nights,
      staffCharge: periodStaffChargeAmount(rollup),
      operatedDates,
      monthlyStaffCharges,
    });
  }, [periodCaisseRecords, periodShifts, periodArchives, staffMembers, periodChoice, availableMonths]);

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

      <PnlPeriodePanel
        periode={periode}
        windowDays={ROLLUP_WINDOW_DAYS}
        choice={periodChoice}
        months={availableMonths}
        onChoiceChange={setPeriodChoice}
      />
    </div>
  );
}

// Sélecteur de période partagé (RH · cumul staff & P&L de période). Choix : fenêtre glissante entière
// (défaut) ou un mois calendaire précis réellement présent dans la fenêtre chargée. Purement présentation
// : ne filtre ni ne recharge rien lui-même, il remonte le choix au parent qui restreint la liste déjà
// chargée. Aucun mois vide n'est proposé (les options viennent des dates réelles).
function PeriodSelector({
  choice,
  months,
  windowDays,
  onChange,
}: {
  choice: PeriodChoice;
  months: string[];
  windowDays: number;
  onChange: (choice: PeriodChoice) => void;
}) {
  // Valeur affichée du <select>. Un mois périmé (disparu de la fenêtre rechargée) retombe visuellement
  // sur « fenêtre glissante » — jamais une value hors options (qui déclencherait un warning contrôlé).
  const value =
    choice.kind === "window"
      ? "__window__"
      : choice.kind === "range"
        ? "__range__"
        : months.includes(choice.month)
          ? choice.month
          : "__window__";
  return (
    <div className="mt-2 space-y-1.5">
      <label className="flex items-center gap-2 text-[11px] text-white/45">
        <CalendarClock size={13} className="shrink-0 text-white/35" />
        <span className="uppercase tracking-[0.14em]">Période</span>
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === "__window__") onChange(WINDOW_CHOICE);
            else if (e.target.value === "__range__") onChange({ kind: "range", from: "", to: "" });
            else onChange({ kind: "month", month: e.target.value });
          }}
          className="ml-auto rounded-lg border border-white/15 bg-black/50 px-2 py-1 text-[11px] font-bold text-white/80 outline-none focus:border-cyan-400/50"
        >
          <option value="__window__">Fenêtre glissante ({windowDays} j)</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabelFr(m)}
            </option>
          ))}
          <option value="__range__">Plage personnalisée…</option>
        </select>
      </label>
      {choice.kind === "range" && (
        <div className="flex items-center gap-2 pl-[21px] text-[11px] text-white/45">
          <span className="uppercase tracking-[0.14em] text-white/35">Du</span>
          <input
            type="date"
            value={choice.from}
            max={choice.to || undefined}
            onChange={(e) => onChange({ kind: "range", from: e.target.value, to: choice.to })}
            className="rounded-lg border border-white/15 bg-black/50 px-2 py-1 text-[11px] font-bold text-white/80 outline-none focus:border-cyan-400/50"
          />
          <span className="uppercase tracking-[0.14em] text-white/35">au</span>
          <input
            type="date"
            value={choice.to}
            min={choice.from || undefined}
            onChange={(e) => onChange({ kind: "range", from: choice.from, to: e.target.value })}
            className="rounded-lg border border-white/15 bg-black/50 px-2 py-1 text-[11px] font-bold text-white/80 outline-none focus:border-cyan-400/50"
          />
        </div>
      )}
    </div>
  );
}

// P&L de PÉRIODE — panneau cumul multi-soirées (fenêtre glissante + récap mensuel). Réutilise le
// produit agrégé (Z de caisse) + le coût staff cumulé (RH · rhRollup). Direction-only par l'onglet P&L.
// États vides & couverture HONNÊTES : aucune marge « nette » tant qu'une charge reste en attente,
// aucune valeur « — » remplacée par un 0, et les soirées opérées sans Z sont exposées.
function PnlPeriodePanel({
  periode,
  windowDays,
  choice,
  months,
  onChoiceChange,
}: {
  periode: ReturnType<typeof buildPnlPeriode>;
  windowDays: number;
  choice: PeriodChoice;
  months: string[];
  onChoiceChange: (choice: PeriodChoice) => void;
}) {
  const { produit } = periode;
  const hasZ = produit.soireesAvecZ > 0;

  const resultLabel = periode.resultatNetComplet
    ? "Résultat net période"
    : periode.chargesConnues > 0
      ? "Marge période après charges connues"
      : "Produit période avant charges";

  return (
    <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3">
      <div className="mb-1 flex items-center gap-2">
        <TrendingUp size={15} className="text-cyan-400" />
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/55">
          P&amp;L de période (cumul)
        </p>
      </div>
      <PeriodSelector
        choice={choice}
        months={months}
        windowDays={windowDays}
        onChange={onChoiceChange}
      />
      <p className="mt-2 text-[11px] leading-snug text-white/35">
        Cumul des Z de caisse et du coût staff sur {periodChoiceLabel(normalizeChoice(choice, months), windowDays)}. Le
        rapprochement tables ↔ caisse reste par soirée (le CA des tables historique n&apos;est pas
        reconstituable après clôture).
      </p>

      {!hasZ ? (
        <Empty
          title="Aucun Z de caisse sur la période"
          text="Le cumul agrège les Z de clôture des soirées passées. Aucun Z saisi dans la fenêtre → cumul honnêtement vide, rien n'est estimé."
        />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <BigStat label="Soirées chiffrées (Z)" value={String(produit.soireesAvecZ)} />
            <BigStat label="CA caisse cumulé" value={formatEuro(produit.produitTotal)} />
            <BigStat
              label="Tickets Z cumulés"
              value={produit.nbTicketsTotal == null ? "—" : String(produit.nbTicketsTotal)}
            />
            <BigStat
              label="CA bar cumulé"
              value={produit.caBarTotal > 0 ? formatEuro(produit.caBarTotal) : "—"}
            />
            <BigStat
              label="Entrées cumulées"
              value={produit.entriesCouvertureNuits > 0 ? String(produit.entriesTotal) : "—"}
            />
            <BigStat
              label="Panier moyen"
              value={produit.panierMoyen == null ? "—" : formatEuro(produit.panierMoyen)}
            />
          </div>

          {/* Couverture du panier : sur combien de nuits chiffrées les entrées sont réellement connues
              (event_archives). Une nuit à Z mais sans archive (ex. soirée active) est exclue du panier —
              on l'affiche pour que le ratio ne soit jamais lu comme couvrant TOUTES les soirées. */}
          <p className="mt-2 text-[11px] leading-snug text-white/35">
            {produit.entriesCouvertureNuits === 0
              ? "Panier moyen indisponible : aucune soirée chiffrée n'a d'entrées archivées (les entrées se figent à la clôture). La soirée en cours n'est comptée qu'après sa clôture."
              : produit.entriesCouvertureNuits < produit.soireesAvecZ
                ? `Panier calculé sur ${produit.entriesCouvertureNuits}/${produit.soireesAvecZ} soirée(s) chiffrée(s) — les autres n'ont pas encore d'entrées archivées (produit ÷ entrées appariés, jamais surévalué).`
                : `Panier calculé sur les ${produit.soireesAvecZ} soirée(s) chiffrée(s) de la période.`}
          </p>

          {/* Couverture Z honnête : soirées opérées (staff présent) sans Z → produit sous-compté. */}
          {!periode.couvertureZComplete && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                Couverture Z incomplète : {periode.soireesOpereesSansZ.length} soirée(s) opérée(s)
                (staff présent) sans Z saisi ({periode.soireesOpereesSansZ.join(", ")}). Le CA cumulé
                ci-dessus les SOUS-compte — saisir leur Z pour un cumul complet.
              </span>
            </p>
          )}

          {/* Charges de période : mêmes conventions d'honnêteté que le per-soirée. */}
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/45">
              Charges de période
            </p>
            <div className="grid gap-1.5">
              {periode.charges.map((charge) => (
                <div key={charge.key} className="flex items-center justify-between rounded-xl bg-black/40 px-3 py-2">
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
              ))}
            </div>
          </div>

          {/* Résultat de période : jamais « net » tant qu'une charge reste en attente. */}
          <div className="mt-3 rounded-2xl border border-orange-500/25 bg-orange-500/[0.06] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white/55">
                {resultLabel}
              </span>
              <span className="text-lg font-black text-orange-400">
                {periode.margeApresChargesConnues == null ? "—" : formatEuro(periode.margeApresChargesConnues)}
              </span>
            </div>
            {!periode.resultatNetComplet && (
              <p className="mt-2 text-[11px] leading-snug text-white/30">
                {periode.chargesEnAttente.map((c) => c.label.toLowerCase()).join(" et ")} pas encore
                branché(s) : chiffre = produit AVANT ces charges, pas une marge nette.
              </p>
            )}
          </div>

          {/* Récap MENSUEL (paie) : produit + coût staff par mois calendaire. */}
          {periode.months.length > 0 && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/45">
                Récap mensuel
              </p>
              <div className="grid gap-1.5">
                {periode.months.map((m) => (
                  <div key={m.month} className="rounded-xl bg-black/40 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-black text-white/80">{monthLabelFr(m.month)}</span>
                      <span className="text-sm font-black text-cyan-300">
                        {m.produit.soireesAvecZ > 0 ? formatEuro(m.produit.produitTotal) : "—"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-white/45">
                      <span>
                        {m.produit.soireesAvecZ} soirée(s) · staff{" "}
                        {m.staffCharge == null ? "—" : formatEuro(m.staffCharge)}
                      </span>
                      <span className={m.staffDeduit ? "font-bold text-white/70" : "text-white/35"}>
                        {m.margeApresStaff == null
                          ? "—"
                          : `${m.staffDeduit ? "marge" : "avant staff"} ${formatEuro(m.margeApresStaff)}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-white/30">
                « avant staff » = coût staff du mois non encore complet (un présent sans taux) : jamais
                déduit tant qu&apos;il n&apos;est pas entièrement chiffré.
              </p>
            </div>
          )}
        </>
      )}
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
// Libellés d'affichage RH (miroir des CHECK 0011 ; aucune valeur inventée).
const CONTRAT_LABELS: Record<ContratType, string> = {
  cdi: "CDI",
  cdd: "CDD",
  extra: "Extra",
  prestataire: "Prestataire",
  stage: "Stage",
};
const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  planifie: "Planifié",
  confirme: "Confirmé",
  present: "Présent",
  absent: "Absent",
  retard: "Retard",
  annule: "Annulé",
};

function RhView({
  exploitationDate,
  hasActiveEvent,
  members,
  shifts,
  periodShifts,
  onAddMember,
  onUpsertShift,
}: {
  exploitationDate: string;
  hasActiveEvent: boolean;
  members: StaffMember[];
  shifts: StaffShift[];
  periodShifts: StaffShift[];
  onAddMember: (draft: StaffMemberDraft) => Promise<{ ok: boolean; message: string }>;
  onUpsertShift: (
    staffMemberId: string,
    draft: ShiftDraft,
  ) => Promise<{ ok: boolean; message: string }>;
}) {
  const ready = rhDataReady(members);
  const masse: MasseHoraire = summarizeMasseHoraire(exploitationDate, shifts, members);
  const shiftByMember = useMemo(() => {
    const map = new Map<string, StaffShift>();
    for (const s of shifts) if (s.exploitation_date === exploitationDate) map.set(s.staff_member_id, s);
    return map;
  }, [shifts, exploitationDate]);

  // Cumul MULTI-SOIRÉES (récap période/mois du coût staff) — réutilise summarizeMasseHoraire nuit par
  // nuit (aucune divergence avec le per-soirée ci-dessus). periodShifts = fenêtre glissante chargée à
  // l'ouverture de l'onglet ; base vide → cumul honnêtement vide.
  // Sélecteur de période (fenêtre glissante entière par défaut, ou un mois calendaire précis). Filtre
  // côté client les shifts déjà chargés avant les moteurs purs — ne recharge rien, ne fabrique rien.
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>(WINDOW_CHOICE);
  const availableMonths = useMemo(
    () => distinctMonths(periodShifts.map((s) => s.exploitation_date)),
    [periodShifts],
  );
  const selectedShifts = useMemo(
    () => applyPeriodChoice(periodShifts, (s) => s.exploitation_date, normalizeChoice(periodChoice, availableMonths)),
    [periodShifts, periodChoice, availableMonths],
  );
  const period = useMemo(() => buildPeriodStaffRollup(selectedShifts, members), [selectedShifts, members]);
  const monthly = useMemo(() => buildMonthlyStaffRollups(selectedShifts, members), [selectedShifts, members]);

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
            text="La vraie liste du personnel (noms, postes, taux horaire) n'a pas encore été fournie. Les tables staff_members / staff_shifts (0011) sont vides — rien n'est inventé. Ajoute l'équipe ci-dessous pour composer le planning et calculer le coût staff."
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

          <p className="mt-4 mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Planning &amp; pointage de la soirée
          </p>
          <div className="space-y-1.5">
            {members.map((m) => (
              <StaffMemberRow
                key={m.id}
                member={m}
                shift={shiftByMember.get(m.id)}
                onSave={(draft) => onUpsertShift(m.id, draft)}
              />
            ))}
          </div>
        </>
      )}

      <StaffPeriodRollupPanel
        period={period}
        monthly={monthly}
        windowDays={ROLLUP_WINDOW_DAYS}
        choice={periodChoice}
        months={availableMonths}
        onChoiceChange={setPeriodChoice}
      />

      <AddStaffMemberForm onAdd={onAddMember} />

      <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-white/35">
        Structure B7 : chaque salarié dispose de sa propre vue « Mon planning » (SES créneaux, SES
        heures, confirmation de présence en 1 tap). La RLS 0011 cantonne chacun à sa fiche ; l&apos;écriture
        du répertoire, du planning et du pointage réel reste réservée à la direction.
      </p>
    </div>
  );
}

// Panneau CUMUL MULTI-SOIRÉES (récap période/mois du coût staff, B7). Lecture seule, directionnel (rendu
// dans RhView, onglet direction-only). Réutilise le calcul pur de lib/rhRollup : jamais un coût partiel
// présenté comme définitif — le cumul reste « en attente » tant qu'une soirée n'est pas entièrement
// chiffrée, et chaque total absent s'affiche « — », jamais un 0 trompeur.
function StaffPeriodRollupPanel({
  period,
  monthly,
  windowDays,
  choice,
  months,
  onChoiceChange,
}: {
  period: PeriodStaffRollup;
  monthly: MonthlyStaffRollup[];
  windowDays: number;
  choice: PeriodChoice;
  months: string[];
  onChoiceChange: (choice: PeriodChoice) => void;
}) {
  const ready = rollupDataReady(period);
  const chargeable = periodStaffChargeAmount(period);

  return (
    <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock size={16} className="text-orange-500" />
        <h3 className="text-sm font-black text-white/75">Cumul multi-soirées · masse horaire &amp; coût staff</h3>
      </div>
      <PeriodSelector
        choice={choice}
        months={months}
        windowDays={windowDays}
        onChange={onChoiceChange}
      />
      <p className="mt-2 text-[11px] leading-snug text-white/35">
        Récap sur {periodChoiceLabel(normalizeChoice(choice, months), windowDays)} + détail mensuel pour la paie. Additionne le
        pointage soirée par soirée — <b className="text-white/55">rien n&apos;est estimé</b>.
      </p>

      {!ready.hasNights ? (
        <div className="mt-3">
          <Empty
            title="Aucune soirée pointée sur la période"
            text="Aucun shift sur la fenêtre glissante (staff_shifts est vide — rien n'est inventé). Dès que le planning et le pointage sont saisis, le cumul et le récap mensuel s'afficheront ici."
          />
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <BigStat label="Soirées pointées" value={String(period.nightsTotal)} />
            <BigStat label="Présences cumulées" value={String(period.presentsTotal)} />
            <BigStat
              label="Heures réelles"
              value={period.heuresReellesTotal == null ? "—" : `${period.heuresReellesTotal} h`}
            />
            <BigStat
              label="Coût staff cumulé"
              value={period.coutStaffCumul == null ? "—" : formatEuro(period.coutStaffCumul)}
            />
          </div>

          <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm">
            <PnlRow label="Heures planifiées (période)" value={`${period.heuresPlanifieesTotal} h`} />
            <PnlRow label="Présences (present + retard)" value={String(period.presentsTotal)} />
            <PnlRow label="Absences" value={String(period.absentsTotal)} />
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="font-black text-white/70">Charge staff branchable</span>
              <span className="font-black text-cyan-300">
                {chargeable == null ? "—" : formatEuro(chargeable)}
              </span>
            </div>
          </div>

          {chargeable == null && period.coutStaffCumul != null && (
            <div className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
              <p className="text-[11px] leading-snug text-amber-200/80">
                Cumul <b>partiel</b> : {period.nightsSansCoutComplet} soirée
                {period.nightsSansCoutComplet > 1 ? "s" : ""} avec des présents sans taux/heures
                ({period.presentsSansTaux} au total). Le coût cumulé affiché ({formatEuro(period.coutStaffCumul)})
                exclut ces présences — on ne présente jamais un total tronqué comme le coût staff définitif
                de la période.
              </p>
            </div>
          )}

          {/* Récap mensuel (paie). Chaque mois expose SA base ; un total non chiffrable = « — ». */}
          {monthly.length > 0 && (
            <>
              <p className="mt-4 mb-1.5 text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Récap mensuel (paie)
              </p>
              <div className="space-y-1.5">
                {monthly.map(({ month, rollup }) => (
                  <div
                    key={month}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-black text-white/80">{monthLabelFr(month)}</p>
                      <p className="text-[10px] leading-tight text-white/40">
                        {rollup.nightsTotal} soirée{rollup.nightsTotal > 1 ? "s" : ""} ·{" "}
                        {rollup.presentsTotal} présence{rollup.presentsTotal > 1 ? "s" : ""} ·{" "}
                        {rollup.heuresReellesTotal == null ? "—" : `${rollup.heuresReellesTotal} h`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-cyan-300">
                        {rollup.coutStaffCumul == null ? "—" : formatEuro(rollup.coutStaffCumul)}
                      </p>
                      {!rollup.coutComplet && rollup.coutStaffCumul != null && (
                        <p className="text-[9px] font-black uppercase tracking-wider text-amber-400/80">partiel</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Vue SALARIÉ (B7) : chaque salarié voit UNIQUEMENT SES créneaux (RLS 0011) + confirme sa présence en
// 1 tap (RPC confirm_my_shift_v1, 0020). Lecture seule pour le reste : le pointage réel (present/absent),
// les horaires et le taux horaire (PII paie) restent en vue direction — jamais exposés ici. État vide
// honnête tant que la direction n'a pas créé la fiche du salarié (aucune donnée fabriquée).
function SelfPlanningView({
  fullName,
  member,
  shifts,
  onConfirm,
}: {
  fullName: string;
  member: StaffMember | null;
  shifts: StaffShift[];
  onConfirm: (shiftId: string) => Promise<{ ok: boolean; message: string }>;
}) {
  // « Aujourd'hui » figé au montage : la répartition à venir/passé est stable pendant la consultation.
  const today = useMemo(() => new Date(), []);
  const summary: MyHoursSummary = useMemo(() => summarizeMyHours(shifts, today), [shifts, today]);
  const split = useMemo(() => splitMyShifts(shifts, today), [shifts, today]);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <CalendarCheck size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">Mon planning</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Mes créneaux et mes heures. Je confirme ma présence en 1 tap sur un créneau planifié — le
        pointage réel reste géré par la direction. Suivi transparent et annoncé (droit du travail).
      </p>

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Salarié</p>
        <p className="text-sm font-black text-orange-400">{member?.full_name || fullName}</p>
        {member?.poste && <p className="text-[11px] text-white/45">{member.poste}</p>}
      </div>

      {!member ? (
        <div className="mt-3">
          <Empty
            title="Fiche salarié non créée"
            text="La direction n'a pas encore créé ta fiche dans le répertoire du personnel. Dès qu'elle sera composée, tes créneaux et tes heures apparaîtront ici — rien n'est inventé."
          />
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <BigStat label="À venir" value={String(summary.aVenir)} />
            <BigStat
              label="Heures réelles cumulées"
              value={summary.heuresReellesCumul == null ? "—" : `${summary.heuresReellesCumul} h`}
            />
          </div>

          {summary.aConfirmer > 0 && (
            <div className="mt-2 flex items-start gap-2 rounded-2xl border border-orange-500/25 bg-orange-500/[0.06] px-3 py-2">
              <CalendarCheck size={15} className="mt-0.5 shrink-0 text-orange-400" />
              <p className="text-[11px] leading-snug text-orange-200/80">
                {summary.aConfirmer} créneau{summary.aConfirmer > 1 ? "x" : ""} à confirmer — un tap
                sur « Je confirme » suffit.
              </p>
            </div>
          )}

          <p className="mt-4 mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
            À venir
          </p>
          {split.upcoming.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-white/35">
              Aucun créneau à venir pour l&apos;instant.
            </p>
          ) : (
            <div className="space-y-1.5">
              {split.upcoming.map((s) => (
                <MyShiftRow key={s.id} shift={s} onConfirm={onConfirm} />
              ))}
            </div>
          )}

          {split.past.length > 0 && (
            <>
              <p className="mt-4 mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
                Créneaux passés
              </p>
              <div className="space-y-1.5">
                {split.past.map((s) => (
                  <MyShiftRow key={s.id} shift={s} onConfirm={onConfirm} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Une ligne « Mon créneau » : la date, le poste tenu ce soir-là, le statut, et le bouton de
// confirmation 1 tap UNIQUEMENT si le créneau est encore planifié (canSelfConfirm = miroir de la
// garde SQL). Lecture seule sinon : le salarié ne peut ni se marquer présent/absent ni changer d'horaire.
function MyShiftRow({
  shift,
  onConfirm,
}: {
  shift: StaffShift;
  onConfirm: (shiftId: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const confirmable = canSelfConfirm(shift);

  const STATUS_TONE: Record<ShiftStatus, string> = {
    planifie: "border-white/15 bg-white/5 text-white/55",
    confirme: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300",
    present: "border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-300",
    retard: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300",
    absent: "border-rose-500/25 bg-rose-500/[0.08] text-rose-300",
    annule: "border-white/10 bg-white/[0.03] text-white/35",
  };

  async function handleConfirm() {
    setBusy(true);
    setFeedback(null);
    const res = await onConfirm(shift.id);
    setBusy(false);
    if (!res.ok) setFeedback(res.message);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-white/80">{shift.exploitation_date}</p>
          {shift.poste && <p className="truncate text-[11px] text-white/45">{shift.poste}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black ${STATUS_TONE[shift.status]}`}
        >
          {shiftStatusLabel(shift.status)}
        </span>
      </div>
      {confirmable && (
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className="mt-2 w-full rounded-xl border border-orange-500/40 bg-orange-500/15 py-2 text-xs font-black text-orange-300 disabled:opacity-50"
        >
          {busy ? "…" : "Je confirme ma présence"}
        </button>
      )}
      {feedback && <p className="mt-1.5 text-[11px] text-rose-300/80">{feedback}</p>}
    </div>
  );
}

// Une ligne salarié = sa fiche + l'éditeur de SON shift pour la soirée active (planning prévu +
// pointage réel). L'éditeur se déplie au clic. Un seul shift par salarié/soirée (upsert idempotent
// 0011). État local prérempli depuis le shift existant : rien n'est inventé, les champs vides restent
// vides. Le statut « présent/retard » sans horaire réel est autorisé — la masse horaire le signalera.
function StaffMemberRow({
  member,
  shift,
  onSave,
}: {
  member: StaffMember;
  shift: StaffShift | undefined;
  onSave: (draft: ShiftDraft) => Promise<{ ok: boolean; message: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ShiftStatus>(shift?.status ?? "planifie");
  const [poste, setPoste] = useState(shift?.poste ?? member.poste ?? "");
  const [plannedStart, setPlannedStart] = useState(instantToHHMM(shift?.planned_start ?? null));
  const [plannedEnd, setPlannedEnd] = useState(instantToHHMM(shift?.planned_end ?? null));
  const [actualStart, setActualStart] = useState(instantToHHMM(shift?.actual_start ?? null));
  const [actualEnd, setActualEnd] = useState(instantToHHMM(shift?.actual_end ?? null));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function submit() {
    setBusy(true);
    setFeedback("");
    const res = await onSave({
      status,
      poste: poste.trim() || null,
      plannedStart: plannedStart || null,
      plannedEnd: plannedEnd || null,
      actualStart: actualStart || null,
      actualEnd: actualEnd || null,
    });
    setFeedback(res.message);
    setBusy(false);
  }

  const statusBadge = shift ? SHIFT_STATUS_LABELS[shift.status] : "Aucun shift";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
      >
        <span className="min-w-0 truncate font-bold text-white/80">
          {member.full_name}
          {member.poste ? <span className="text-white/40"> · {member.poste}</span> : null}
          {!member.actif ? <span className="text-white/30"> · inactif</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-black text-white/45">
            {statusBadge}
          </span>
          <span className="text-[11px] font-black text-white/40">
            {member.taux_horaire == null ? "taux —" : `${formatEuro(member.taux_horaire)}/h`}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-white/10 px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Statut
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ShiftStatus)}
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
              >
                {SHIFT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Poste ce soir (optionnel)
              <input
                value={poste}
                onChange={(e) => setPoste(e.target.value)}
                placeholder={member.poste ?? "bar, accueil, sécurité…"}
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
              />
            </label>
            <TimeField label="Début prévu" value={plannedStart} onChange={setPlannedStart} />
            <TimeField label="Fin prévue" value={plannedEnd} onChange={setPlannedEnd} />
            <TimeField label="Début réel (pointage)" value={actualStart} onChange={setActualStart} />
            <TimeField label="Fin réelle (pointage)" value={actualEnd} onChange={setActualEnd} />
          </div>
          <p className="mt-2 text-[10px] leading-snug text-white/30">
            Les soirées passent minuit : une fin ≤ début est comptée le lendemain. Un présent sans
            horaire réel reste sans coût (rien n&apos;est inventé).
          </p>
          {feedback && <p className="mt-2 text-[11px] text-white/50">{feedback}</p>}
          <button
            onClick={submit}
            disabled={busy}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-black text-black disabled:opacity-50"
          >
            {busy ? "Enregistrement…" : "Enregistrer le shift"}
          </button>
        </div>
      )}
    </div>
  );
}

// Champ heure HH:MM (input natif). Le pointage se fait à la minute, pas au datetime complet.
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
      {label}
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
      />
    </label>
  );
}

// Formulaire « ajouter un salarié » — le seul point d'entrée de la VRAIE liste du fondateur. Aucun
// champ n'est prérempli : la fiche part vide, le taux reste optionnel (null = paie non fournie).
// L'identifiant relie la fiche au compte staff (RLS salarié). Toujours affiché, même liste vide.
function AddStaffMemberForm({
  onAdd,
}: {
  onAdd: (draft: StaffMemberDraft) => Promise<{ ok: boolean; message: string }>;
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [poste, setPoste] = useState("");
  const [contratType, setContratType] = useState<string>("");
  const [tauxHoraire, setTauxHoraire] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function submit() {
    setBusy(true);
    setFeedback("");
    const res = await onAdd({
      fullName,
      username,
      poste: poste.trim() || null,
      contratType: contratType || null,
      tauxHoraire: tauxHoraire.trim() || null,
      actif: true,
    });
    setFeedback(res.message);
    if (res.ok) {
      setFullName("");
      setUsername("");
      setPoste("");
      setContratType("");
      setTauxHoraire("");
    }
    setBusy(false);
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
        Ajouter un salarié
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
          Nom complet
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="ex. Jérémy Bar"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
          Identifiant staff
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ex. jeremy"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
          Poste (optionnel)
          <input
            value={poste}
            onChange={(e) => setPoste(e.target.value)}
            placeholder="bar, accueil…"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
          Contrat (optionnel)
          <select
            value={contratType}
            onChange={(e) => setContratType(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
          >
            <option value="">—</option>
            {CONTRAT_TYPES.map((c) => (
              <option key={c} value={c}>
                {CONTRAT_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <CaisseField
          label="Taux horaire"
          hint="€/h · opt."
          value={tauxHoraire}
          onChange={setTauxHoraire}
          placeholder="laisser vide si inconnu"
        />
      </div>
      {feedback && <p className="mt-2 text-[11px] text-white/50">{feedback}</p>}
      <button
        onClick={submit}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-black text-black disabled:opacity-50"
      >
        <Plus size={16} /> {busy ? "Enregistrement…" : "Ajouter le salarié"}
      </button>
      <p className="mt-2 text-[10px] leading-snug text-white/30">
        La saisie vient du fondateur (droit du travail + PII paie). Le taux horaire peut rester vide
        tant qu&apos;il n&apos;est pas connu — aucun coût n&apos;est alors fabriqué.
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

// Couleurs de gravité (aucune donnée : purement visuel, ordre = INCIDENT_LEVELS).
const INCIDENT_LEVEL_STYLE: Record<IncidentLevel, string> = {
  mineur: "border-white/15 bg-white/5 text-white/50",
  moyen: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  grave: "border-orange-500/35 bg-orange-500/10 text-orange-300",
  critique: "border-red-500/40 bg-red-500/10 text-red-300",
};

// Affichage horodaté déterministe (chaîne ISO tronquée — aucun new Date(), aucun décalage de fuseau).
function shortStamp(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

// Carte d'UN incident + son fil de suivi. Extraite pour porter l'état LOCAL de la note de suivi
// (chaque carte a son champ), sans map de notes dans le parent. Les actions de mutation ne sont
// rendues que si canManage (miroir de la RLS update 0023 : direction + sécurité).
function IncidentCard({
  incident,
  updates,
  canManage,
  onUpdate,
}: {
  incident: Incident;
  updates: IncidentUpdate[];
  canManage: boolean;
  onUpdate: (
    incident: Incident,
    patch: { status?: IncidentStatus; escalade?: boolean },
    note: string,
  ) => Promise<{ ok: boolean; message: string }>;
  }) {
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const active = isActiveStatus(incident.status);

  async function apply(patch: { status?: IncidentStatus; escalade?: boolean }) {
    setBusy(true);
    setFeedback("");
    const res = await onUpdate(incident, patch, note);
    setBusy(false);
    setFeedback(res.message);
    if (res.ok) setNote("");
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-black text-white/85">{incidentTypeLabel(incident.type)}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${INCIDENT_LEVEL_STYLE[incident.niveau]}`}
        >
          {incidentLevelLabel(incident.niveau)}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${
            active
              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
              : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {incidentStatusLabel(incident.status)}
        </span>
        {incident.escalade && (
          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-black text-red-300">
            Escaladé direction
          </span>
        )}
      </div>

      <p className="mt-1.5 whitespace-pre-wrap text-sm text-white/75">{incident.description}</p>

      <p className="mt-1 text-[10px] text-white/35">
        {incident.lieu ? `Lieu : ${incident.lieu} · ` : ""}
        {incident.personne_concernee ? `Personne : ${incident.personne_concernee} · ` : ""}
        Soirée {incident.exploitation_date} · signalé par {incident.auteur_username} le{" "}
        {shortStamp(incident.created_at)}
      </p>

      {/* Fil de suivi (chronologique). Vide tant qu'aucune action n'a été consignée. */}
      {updates.length > 0 && (
        <ul className="mt-2 space-y-1 border-l border-white/10 pl-2.5">
          {updates.map((u) => (
            <li key={u.id} className="text-[11px] text-white/50">
              <span className="text-white/30">{shortStamp(u.created_at)}</span>{" "}
              {u.new_status && (
                <span className="font-bold text-white/70">
                  → {incidentStatusLabel(u.new_status)}
                </span>
              )}{" "}
              {u.note && <span>{u.note}</span>}
              <span className="text-white/25"> ({u.auteur_username})</span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-2.5 rounded-xl border border-white/10 bg-black/30 p-2.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note de suivi (optionnelle)"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[13px] text-white/80 placeholder:text-white/25"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {nextStatuses(incident.status).map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => apply({ status: s })}
                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-black text-white/70 hover:text-orange-400 disabled:opacity-50"
              >
                {incidentStatusLabel(s)}
              </button>
            ))}
            {!incident.escalade && (
              <button
                disabled={busy}
                onClick={() => apply({ escalade: true })}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-black text-red-300 disabled:opacity-50"
              >
                Escalader
              </button>
            )}
            {note.trim() !== "" && (
              <button
                disabled={busy}
                onClick={() => apply({})}
                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-black text-white/70 hover:text-orange-400 disabled:opacity-50"
              >
                Enregistrer la note
              </button>
            )}
          </div>
          {feedback && <p className="mt-1.5 text-[11px] text-white/50">{feedback}</p>}
        </div>
      )}
    </li>
  );
}

// Onglet « Incidents » (module A6, migration 0023) — registre de soirée à visibilité RESTREINTE.
// Direction + sécurité : lecture complète + mutation (statut/escalade/suivi). Server/compteur :
// signalent et ne relisent QUE leurs propres signalements. Promoteur/artiste : aucun accès (l'onglet
// ne leur est même pas rendu — visibleTabsForRole — et la RLS 0023 leur refuse toute ligne).
// La table ship VIDE : aucun incident inventé → état vide honnête.
function IncidentsView({
  role,
  username,
  exploitationDate,
  incidents,
  updates,
  onReport,
  onUpdate,
}: {
  role: StaffRole;
  username: string;
  exploitationDate: string;
  incidents: Incident[];
  updates: IncidentUpdate[];
  onReport: (draft: IncidentDraft) => Promise<{ ok: boolean; message: string }>;
  onUpdate: (
    incident: Incident,
    patch: { status?: IncidentStatus; escalade?: boolean },
    note: string,
  ) => Promise<{ ok: boolean; message: string }>;
}) {
  const canReport = canReportIncident(role);
  const canManage = canManageIncidents(role);
  const viewAll = canViewAllIncidents(role);

  // Défense en profondeur : la RLS a déjà filtré côté base ; on re-restreint côté client (pure).
  const visible = useMemo(() => visibleIncidents(incidents, role, username), [incidents, role, username]);
  const sorted = useMemo(() => sortByPriority(visible), [visible]);
  const summary = useMemo(() => summarizeIncidents(visible), [visible]);

  // Fil de suivi groupé par incident (les updates arrivent triés chronologiquement).
  const updatesByIncident = useMemo(() => {
    const map = new Map<string, IncidentUpdate[]>();
    for (const u of updates) {
      const list = map.get(u.incident_id);
      if (list) list.push(u);
      else map.set(u.incident_id, [u]);
    }
    return map;
  }, [updates]);

  const [type, setType] = useState<IncidentType>(INCIDENT_TYPES[0]);
  const [niveau, setNiveau] = useState<IncidentLevel>("moyen");
  const [lieu, setLieu] = useState("");
  const [personne, setPersonne] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setFeedback("");
    if (!description.trim()) {
      setFeedback("Description requise (que s'est-il passé ?).");
      return;
    }
    setBusy(true);
    const res = await onReport({
      exploitation_date: exploitationDate,
      type,
      niveau,
      lieu: lieu.trim() || null,
      personne_concernee: personne.trim() || null,
      description,
    });
    setBusy(false);
    setFeedback(res.message);
    if (res.ok) {
      setLieu("");
      setPersonne("");
      setDescription("");
    }
  }

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">Incidents</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Registre de soirée (altercation, refus d&apos;entrée, malaise, vol, dégradation…) à visibilité
        <b className="text-white/60"> restreinte</b>.{" "}
        {viewAll
          ? "Vous voyez tous les signalements (direction/sécurité) et pouvez suivre/escalader."
          : "Vous pouvez signaler un incident ; vous ne relisez ensuite que VOS propres signalements."}
      </p>

      {/* Synthèse post-soirée — réservée aux rôles à lecture complète (direction/sécurité). */}
      {viewAll && (
        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] text-white/50">
          <Stat value={summary.total} label="Total" color="text-white/80" />
          <Stat value={summary.actifs} label="Actifs" color="text-amber-400" />
          <Stat value={summary.escalades} label="Escaladés" color="text-red-400" />
          <Stat value={summary.resolus} label="Résolus" color="text-emerald-400" />
        </div>
      )}

      {/* Formulaire de signalement (canReport = direction/sécurité/server/compteur). */}
      {canReport && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Signaler un incident
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as IncidentType)}
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
              >
                {INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {incidentTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Gravité
              <select
                value={niveau}
                onChange={(e) => setNiveau(e.target.value as IncidentLevel)}
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
              >
                {INCIDENT_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {incidentLevelLabel(l)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Lieu (optionnel)
              <input
                value={lieu}
                onChange={(e) => setLieu(e.target.value)}
                placeholder="entrée, VIP, bar…"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Personne (optionnel)
              <input
                value={personne}
                onChange={(e) => setPersonne(e.target.value)}
                placeholder="description libre"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Que s'est-il passé ? Faits, heure, personnes impliquées."
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
              />
            </label>
          </div>
          {feedback && <p className="mt-2 text-[11px] text-white/50">{feedback}</p>}
          <button
            onClick={submit}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-black text-black disabled:opacity-50"
          >
            <Plus size={16} /> {busy ? "Enregistrement…" : "Signaler"}
          </button>
        </div>
      )}

      {/* Liste des incidents visibles (triés par priorité) ou état vide honnête. */}
      {sorted.length === 0 ? (
        <div className="mt-4">
          <Empty
            title="Aucun incident"
            text={
              viewAll
                ? "Aucun incident n'a été signalé. Le registre (table incidents, 0023) est vide — rien n'est inventé."
                : "Vous n'avez signalé aucun incident. Vous ne voyez ici que vos propres signalements (visibilité restreinte, RLS 0023)."
            }
          />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {sorted.map((inc) => (
            <IncidentCard
              key={inc.id}
              incident={inc}
              updates={updatesByIncident.get(inc.id) ?? []}
              canManage={canManage}
              onUpdate={onUpdate}
            />
          ))}
        </ul>
      )}

      <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-white/35">
        Visibilité imposée en base (RLS 0023), pas par l&apos;UI : promoteur et artiste n&apos;ont aucun
        accès. Les photos d&apos;incident sont une structure prête (photo_refs) — le dépôt fichier
        n&apos;est pas encore câblé.
      </p>
    </div>
  );
}

// Libellés d'affichage du funnel (miroir des CHECK 0014 ; aucune valeur inventée).
const FUNNEL_KIND_LABELS: Record<InviteKind, string> = {
  guest_list: "Invitation individuelle",
  team_vip: "QR d'équipe (table VIP)",
};
const FUNNEL_UNIVERS_LABELS: Record<FunnelUnivers, string> = {
  eden: "Eden",
  cercle: "Cercle",
  terminus: "Terminus",
};

// URL publique d'inscription à partager (ouvre la page /i/[token], funnel V0). L'origine vient du
// navigateur : aucun domaine fabriqué. En SSR (pas de window), on renvoie le chemin relatif.
function inviteRegistrationUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/i/${token}`;
}

// Écran staff « générer un lien/QR d'invitation » (funnel CRM V0, spec MODULE_CRM_CLIENTS_VIP.md §V0).
// Un promoteur (ou la direction) crée un lien pour la soirée ACTIVE ; le client scanne → s'inscrit
// LUI-MÊME sur /i/[token] → reçoit son QR d'entrée. Ici on ne fait QUE générer et partager le lien :
// toute la sécurité (token serveur, soirée active, 18+, dédup) est refaite en SQL par les RPC 0014.
// RLS invite_links : la direction voit tous les liens, le promoteur SES liens uniquement.
function FunnelView({
  role,
  exploitationDate,
  hasActiveEvent,
  links,
  onCreate,
}: {
  role: StaffRole;
  exploitationDate: string;
  hasActiveEvent: boolean;
  links: InviteLinkRow[];
  onCreate: (draft: {
    kind: InviteKind;
    univers: FunnelUnivers;
    tableRef: string | null;
    maxUses: number;
    expiresAt: string | null;
  }) => Promise<{ ok: boolean; message: string; token?: string }>;
}) {
  const isDirection = role === "admin" || role === "manager";

  const [kind, setKind] = useState<InviteKind>("guest_list");
  const [univers, setUnivers] = useState<FunnelUnivers>("eden");
  const [tableRef, setTableRef] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Instant de référence pour l'état « expiré » des liens, capté UNE fois à l'ouverture de l'onglet
  // (initialiseur paresseux, hors chemin de rendu répété). Granularité heure/jour → snapshot suffisant.
  const [nowTs] = useState(() => Date.now());

  async function submit() {
    setFeedback("");
    setCreatedToken(null);

    const parsedMax = Number(maxUses);
    if (!Number.isInteger(parsedMax) || parsedMax <= 0) {
      setFeedback("Nombre d'inscriptions invalide (entier positif).");
      return;
    }
    const trimmedTable = tableRef.trim();
    if (kind === "team_vip" && !trimmedTable) {
      setFeedback("Un QR d'équipe doit être rattaché à une table (anti-gaming).");
      return;
    }
    // Expiration OPTIONNELLE : convertie en ISO seulement si renseignée (aucune date fabriquée).
    let expiresIso: string | null = null;
    if (expiresAt.trim()) {
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        setFeedback("Date d'expiration invalide.");
        return;
      }
      expiresIso = d.toISOString();
    }

    setBusy(true);
    const res = await onCreate({
      kind,
      univers,
      tableRef: kind === "team_vip" ? trimmedTable : null,
      maxUses: parsedMax,
      expiresAt: expiresIso,
    });
    setBusy(false);
    setFeedback(res.message);
    if (res.ok && res.token) {
      setCreatedToken(res.token);
      if (kind === "team_vip") setTableRef("");
    }
  }

  async function copy(text: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(text);
        window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 2000);
      }
    } catch {
      // Copie indisponible (permissions/navigateur) : l'URL reste sélectionnable à l'écran.
    }
  }

  const createdUrl = createdToken ? inviteRegistrationUrl(createdToken) : null;

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <QrCode size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">Invitations QR</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Générez un lien/QR d&apos;invitation pour la soirée active. Le client le scanne, s&apos;inscrit{" "}
        <b className="text-white/60">lui-même</b> (4 champs + consentements) et reçoit son QR d&apos;entrée
        personnel. La sécurité (soirée, contrôle 18+, dédup, jeton) est faite côté serveur.
      </p>

      <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Soirée active</p>
          <p className="text-sm font-black text-orange-400">
            {hasActiveEvent ? exploitationDate : "aucune"}
          </p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-black text-white/45">
          {isDirection ? "tous les liens" : "mes liens"}
        </span>
      </div>

      {!hasActiveEvent && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-snug text-amber-200/80">
            Aucune soirée active : un lien est toujours rattaché à la soirée active côté serveur. Active
            une soirée avant de générer des invitations.
          </p>
        </div>
      )}

      {/* Formulaire de génération d'un lien/QR. */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
          Nouveau lien / QR
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as InviteKind)}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
            >
              {INVITE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {FUNNEL_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
            Salle
            <select
              value={univers}
              onChange={(e) => setUnivers(e.target.value as FunnelUnivers)}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
            >
              {FUNNEL_UNIVERS.map((u) => (
                <option key={u} value={u}>
                  {FUNNEL_UNIVERS_LABELS[u]}
                </option>
              ))}
            </select>
          </label>
          {kind === "team_vip" && (
            <label className="col-span-2 flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Table (obligatoire pour un QR d&apos;équipe)
              <input
                value={tableRef}
                onChange={(e) => setTableRef(e.target.value)}
                placeholder="ex. A3, carré VIP 2"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80 placeholder:text-white/25"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
            Inscriptions max
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/40">
            Expiration (opt.)
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/80"
            />
          </label>
        </div>
        {feedback && <p className="mt-2 text-[11px] text-white/50">{feedback}</p>}
        <button
          onClick={submit}
          disabled={busy || !hasActiveEvent}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 text-sm font-black text-black disabled:opacity-50"
        >
          <Plus size={16} /> {busy ? "Génération…" : "Générer le lien / QR"}
        </button>
      </div>

      {/* Lien fraîchement créé : URL à partager + QR (encode l'URL d'inscription /i/[token]). */}
      {createdUrl && (
        <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.06] p-3">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">
            Lien prêt à partager
          </p>
          <div className="mx-auto mt-3 grid w-fit place-items-center rounded-2xl bg-white p-3">
            <QRCodeSVG value={createdUrl} size={168} />
          </div>
          <p className="mt-3 break-all rounded-lg bg-black/40 px-3 py-2 text-center text-[11px] text-white/60">
            {createdUrl}
          </p>
          <button
            onClick={() => copy(createdUrl)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-black text-white/70"
          >
            <Copy size={14} /> {copied === createdUrl ? "Copié ✓" : "Copier le lien"}
          </button>
        </div>
      )}

      {/* Liste des liens existants (RLS : direction = tout, promoteur = SES liens). */}
      <div className="mt-5 mb-1 flex items-center gap-2">
        <Link2 size={15} className="text-white/50" />
        <h3 className="text-sm font-black text-white/70">
          {isDirection ? "Tous les liens" : "Mes liens"} ({links.length})
        </h3>
      </div>
      {links.length === 0 ? (
        <Empty
          title="Aucun lien d'invitation"
          text="La table invite_links (0014) est vide — aucun lien inventé. Génère un lien ci-dessus : son URL /i/[token] et son QR s'afficheront, prêts à partager avec tes clients."
        />
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => {
            const url = inviteRegistrationUrl(l.token);
            const exhausted = l.max_uses > 0 && l.uses_count >= l.max_uses;
            const expired =
              !!l.expires_at && nowTs > 0 && new Date(l.expires_at).getTime() <= nowTs;
            return (
              <li
                key={l.id}
                className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-white/80">
                      {FUNNEL_KIND_LABELS[l.kind]}
                      {l.table_ref ? ` · ${l.table_ref}` : ""}
                    </p>
                    <p className="text-[10px] text-white/35">
                      {FUNNEL_UNIVERS_LABELS[l.univers]} · {l.exploitation_date}
                      {isDirection && l.created_by ? ` · ${l.created_by}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                        exhausted || expired
                          ? "bg-white/5 text-white/35"
                          : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {expired ? "expiré" : `${l.uses_count}/${l.max_uses}`}
                    </span>
                    <button
                      onClick={() => copy(url)}
                      className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white/80"
                      aria-label="Copier le lien"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
                {copied === url && (
                  <p className="mt-1 text-[10px] text-emerald-300">Lien copié ✓</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-white/35">
        La clientèle appartient à l&apos;établissement : chaque lien est rattaché à son émetteur
        (owner_promoter) côté base. Aucun envoi automatisé — vous partagez le lien/QR vous-même
        (WhatsApp, story, sur place). La présence se constatera au scan du QR d&apos;entrée à la porte.
      </p>
    </div>
  );
}

// Snapshot du jour ancré à minuit UTC (déterministe pour le scoring/anniversaire), capté une fois.
function crmTodaySnapshot(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Mois d'anniversaire (1-12) issu d'une date ISO, ou null. Sert au flag « anniversaire » du scoring.
function birthdayMonthOf(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCMonth() + 1;
}

// Icône + accent par motif de la call-list (cohérence visuelle, aucune donnée).
const CALL_REASON_ICON: Record<CallReason, React.ElementType> = {
  confirm_j1: Phone,
  vip_no_resa: Sparkles,
  one_shot: TrendingUp,
  birthday: Cake,
  dormant: RotateCcw,
};
const CALL_REASON_ACCENT: Record<CallReason, string> = {
  confirm_j1: "text-emerald-300",
  vip_no_resa: "text-orange-400",
  one_shot: "text-amber-300",
  birthday: "text-pink-300",
  dormant: "text-sky-300",
};

// Raison de blocage d'un lien wa.me (miroir de ContactPrep.reason de crmClients), en clair.
const CONTACT_BLOCK_REASON: Record<
  "no_phone" | "opt_out" | "no_consent" | "evin" | "empty_message",
  string
> = {
  no_phone: "Pas de numéro valide",
  opt_out: "Client désinscrit (STOP) — contact bloqué",
  no_consent: "Pas de consentement marketing (opt-in requis)",
  evin: "Texte refusé (loi Évin : mention d'alcool)",
  empty_message: "Message vide",
};

const OUTCOME_LABELS: Record<"booked" | "no_answer" | "declined" | "opt_out", string> = {
  booked: "A réservé",
  no_answer: "Sans réponse",
  declined: "A décliné",
  opt_out: "STOP (désinscrire)",
};

// Une ligne de la call-list : le « pourquoi », un message ÉDITABLE (Évin revalidé), le lien wa.me que
// L'HUMAIN clique, et le traçage du résultat (guest_contacts). Aucun envoi automatisé.
function CallListRow({
  entry,
  isDirection,
  eventDate,
  hasActiveEvent,
  onLogContact,
}: {
  entry: CallListEntry;
  isDirection: boolean;
  eventDate: string;
  hasActiveEvent: boolean;
  onLogContact: (
    guestId: string,
    purpose: CallListEntry["contactPurpose"],
    outcome: "booked" | "no_answer" | "declined" | "opt_out",
  ) => Promise<{ ok: boolean; message?: string }>;
}) {
  const g = entry.guest;
  const msgDate =
    entry.reason === "confirm_j1" ? g.upcoming_resa_date : hasActiveEvent ? eventDate : null;
  const [message, setMessage] = useState(() =>
    suggestCallMessage(entry.reason, g.first_name, msgDate),
  );
  const [logged, setLogged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logErr, setLogErr] = useState("");

  const prep = prepareContactLink(
    {
      phoneE164: g.phone,
      optOut: g.opt_out,
      consentMarketing: g.consent_marketing,
      purpose: entry.waPurpose,
    },
    message,
  );
  const meta = CALL_REASON_META[entry.reason];
  const Icon = CALL_REASON_ICON[entry.reason];
  const fullName = `${g.first_name}${g.last_name ? ` ${g.last_name}` : ""}`;

  async function log(outcome: "booked" | "no_answer" | "declined" | "opt_out") {
    setBusy(true);
    setLogErr("");
    const r = await onLogContact(g.guest_id, entry.contactPurpose, outcome);
    setBusy(false);
    if (r.ok) setLogged(outcome);
    else setLogErr(r.message || "Échec du traçage.");
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white/85">{fullName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/40">
            <Icon size={12} className={CALL_REASON_ACCENT[entry.reason]} />
            <span className={CALL_REASON_ACCENT[entry.reason]}>{meta.label}</span>
            {isDirection && g.owner_promoter ? (
              <span className="text-white/30">· {g.owner_promoter}</span>
            ) : null}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-black uppercase text-white/40">
          {entry.waPurpose === "service" ? "service" : "marketing"}
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-white/50">{entry.why}</p>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white/80"
      />

      {prep.ok ? (
        <a
          href={prep.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2 text-sm font-black text-black"
        >
          <MessageCircle size={15} /> Ouvrir WhatsApp
        </a>
      ) : (
        <p className="mt-2 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200/80">
          <AlertTriangle size={13} className="shrink-0" />
          {CONTACT_BLOCK_REASON[prep.reason]}
        </p>
      )}

      {/* Traçage du résultat (perf promoteur). « STOP » pose l'opt-out définitif côté base. */}
      <div className="mt-2 grid grid-cols-4 gap-1">
        {(["booked", "no_answer", "declined", "opt_out"] as const).map((oc) => (
          <button
            key={oc}
            onClick={() => log(oc)}
            disabled={busy || logged != null}
            className={`rounded-lg border px-1 py-1.5 text-[9px] font-black ${
              logged === oc
                ? "border-orange-500/60 bg-orange-500/15 text-orange-300"
                : "border-white/10 bg-white/[0.02] text-white/45"
            } disabled:opacity-50`}
          >
            {OUTCOME_LABELS[oc]}
          </button>
        ))}
      </div>
      {logged && (
        <p className="mt-1 text-[10px] text-emerald-300">Résultat tracé ({OUTCOME_LABELS[logged as "booked"]}) ✓</p>
      )}
      {logErr && <p className="mt-1 text-[10px] text-red-400">{logErr}</p>}
    </li>
  );
}

// Écran CRM V1 (spec MODULE_CRM_CLIENTS_VIP.md §V1) : segments/scoring + CALL-LIST DU MARDI. Directionnel
// ET promoteur (cantonné à SES clients par la RLS 0013). Le scoring RFM est déterministe (crmClients),
// la priorisation est pure (crmCallList) ; ici on ne fait que rendre + préparer des liens wa.me que
// L'HUMAIN clique. Aucun envoi automatisé, aucun client inventé (base vide → écran vide honnête).
function CrmView({
  role,
  exploitationDate,
  hasActiveEvent,
  data,
  onLogContact,
}: {
  role: StaffRole;
  exploitationDate: string;
  hasActiveEvent: boolean;
  data: CrmData;
  onLogContact: (
    guestId: string,
    purpose: CallListEntry["contactPurpose"],
    outcome: "booked" | "no_answer" | "declined" | "opt_out",
  ) => Promise<{ ok: boolean; message?: string }>;
}) {
  const isDirection = role === "admin" || role === "manager";
  const [today] = useState(() => crmTodaySnapshot());

  const derived = useMemo(() => {
    const spendT = spendThreshold(data.scores);
    const segmentCounts: Record<GuestSegment, number> = {
      vip: 0,
      regular: 0,
      one_shot: 0,
      dormant: 0,
      occasional: 0,
      historique: 0,
      prospect: 0,
    };
    const callGuests: CallListGuest[] = data.scores.map((r) => {
      const m = data.meta[r.guest_id];
      const cls = classifyGuest(r, {
        today,
        spendThreshold: spendT,
        birthdayMonth: birthdayMonthOf(m?.birthday ?? null),
      });
      segmentCounts[cls.segment] += 1;
      return {
        guest_id: r.guest_id,
        first_name: r.first_name,
        last_name: r.last_name,
        owner_promoter: r.owner_promoter,
        phone: m?.phone ?? null,
        consent_marketing: m?.consent_marketing ?? false,
        opt_out: m?.opt_out ?? false,
        birthday: m?.birthday ?? null,
        segment: cls.segment,
        days_since_last_seated: cls.daysSinceLastSeated,
        spend_seated_12m: r.spend_seated_12m,
        no_show_rate: cls.noShowRate,
        upcoming_resa_date: data.upcoming[r.guest_id] ?? null,
      };
    });
    return { list: buildCallList(callGuests, today), segmentCounts };
  }, [data, today]);

  const { list, segmentCounts } = derived;
  const tally = tallyCallReasons(list.entries);
  const ready = crmDataReady(data.scores);
  const overDailyCap = data.contactsToday >= 30;

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <PhoneCall size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">CRM · call-list du mardi</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        {isDirection ? "Tous les clients" : "Vos clients"} · le rituel qui remplit les soirées : quelques
        appels ciblés, chacun avec son <b className="text-white/60">pourquoi</b>. L&apos;outil prépare un
        message et un lien WhatsApp — <b className="text-white/60">vous</b> l&apos;envoyez depuis votre
        téléphone. Aucun envoi automatisé.
      </p>

      {/* Compteur du jour (garde-fou anti-saturation : ~30 sollicitations/jour/promoteur). */}
      <div
        className={`mt-3 flex items-center justify-between rounded-2xl border px-3 py-2 ${
          overDailyCap
            ? "border-amber-500/30 bg-amber-500/[0.07]"
            : "border-white/10 bg-white/[0.03]"
        }`}
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Sollicitations aujourd&apos;hui</p>
        <p className={`text-sm font-black ${overDailyCap ? "text-amber-300" : "text-white/70"}`}>
          {data.contactsToday} {overDailyCap ? "· seuil ~30 atteint" : ""}
        </p>
      </div>

      {ready.total === 0 ? (
        <div className="mt-4">
          <Empty
            title="Base CRM vide"
            text="Aucun client capté pour l'instant (guest_scores est vide — aucun client inventé). Dès que des invités s'inscrivent via le funnel QR et sont vus à la porte, ils apparaîtront ici, classés par segment, avec leur call-list."
          />
        </div>
      ) : (
        <>
          {/* Segments (scoring RFM déterministe). */}
          <p className="mt-4 mb-1.5 text-xs font-black uppercase tracking-[0.18em] text-white/45">
            Segments ({ready.total} clients · {ready.withSpend} avec dépense identifiée)
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {GUEST_SEGMENTS.map((seg) => (
              <div key={seg} className="rounded-xl border border-white/10 bg-white/[0.02] px-2 py-2 text-center">
                <p className="text-lg font-black text-orange-400">{segmentCounts[seg]}</p>
                <p className="text-[9px] leading-tight text-white/40">{GUEST_SEGMENT_LABELS[seg]}</p>
              </div>
            ))}
          </div>
          {segmentCounts.historique > 0 && (
            <p className="mt-2 text-[10px] leading-snug text-white/35">
              <b className="text-white/55">Historique importé</b> = clients ayant déjà fréquenté
              l&apos;établissement, importés sans historique de visites daté (donc sans scoring RFM).
              Ils n&apos;entrent <b className="text-white/55">pas</b> automatiquement dans la call-list :
              toute relance de ces clients demande une validation.
            </p>
          )}

          {/* Call-list priorisée. */}
          <div className="mt-5 mb-1.5 flex items-center gap-2">
            <Sparkles size={15} className="text-white/50" />
            <h3 className="text-sm font-black text-white/70">
              À contacter cette semaine ({list.entries.length})
            </h3>
          </div>
          {list.entries.length > 0 && (
            <p className="mb-2 text-[10px] leading-snug text-white/35">
              {CALL_REASONS.filter((r) => tally[r] > 0)
                .map((r) => `${tally[r]} ${CALL_REASON_META[r].label.toLowerCase()}`)
                .join(" · ")}
            </p>
          )}

          {list.entries.length === 0 ? (
            <Empty
              title="Rien à relancer cette semaine"
              text="Aucun client n'entre dans les motifs de la call-list (résa à confirmer, VIP sans résa, one-shot récent, anniversaire à 14 j, dormant). C'est honnête : mieux vaut zéro appel qu'un blast impersonnel."
            />
          ) : (
            <ul className="space-y-2">
              {list.entries.map((entry) => (
                <CallListRow
                  key={entry.guest.guest_id}
                  entry={entry}
                  isDirection={isDirection}
                  eventDate={exploitationDate}
                  hasActiveEvent={hasActiveEvent}
                  onLogContact={onLogContact}
                />
              ))}
            </ul>
          )}

          {(list.dormantDropped > 0 || list.totalDropped > 0) && (
            <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-white/35">
              {list.eligibleCount} clients éligibles cette semaine ;{" "}
              {list.dormantDropped > 0 && `${list.dormantDropped} dormant(s) au-delà du plafond de 5 · `}
              {list.totalDropped > 0 && `${list.totalDropped} au-delà des 25 noms · `}
              reportés à la semaine prochaine (aucune troncature silencieuse).
            </p>
          )}
        </>
      )}

      <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-white/35">
        Règles : <b className="text-white/55">aucun envoi automatisé</b> (vous cliquez le lien) ·{" "}
        <b className="text-white/55">zéro alcool</b> dans les messages (loi Évin) · un « STOP » désinscrit
        définitivement · la confirmation J-1 est un message de service (pas de la prospection). La
        clientèle appartient à l&apos;établissement (owner_promoter en base, RLS).
      </p>
    </div>
  );
}

// Formatage pourcentage honnête : null (base absente) → « — », jamais un 0 % trompeur.
function learnPct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)} %`;
}

// Aspect visuel du verdict de couverture (miroir de crmLearning.CoverageVerdict).
const VERDICT_META: Record<CoverageVerdict, { label: string; cls: string }> = {
  "no-data": { label: "Pas de Z", cls: "border-white/15 bg-white/5 text-white/40" },
  "tables-only": { label: "Tables seules", cls: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  confident: { label: "Fiable", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" },
};

// Une cellule soirée × univers : CA réel, couverture (garde-fou d'honnêteté), présents, nouveaux captés,
// retour J+30. Aucun chiffre n'est fabriqué : une base absente s'affiche « — » avec son motif.
function LearningCellCard({ cell }: { cell: SoireeUniversMetrics }) {
  const verdict = VERDICT_META[cell.coverageVerdict];
  const ret = cell.retention;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-black text-orange-400">{cell.exploitationDate}</span>
        <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black text-cyan-200">
          {VENUE_LABELS[cell.univers]}
        </span>
        {cell.format ? (
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-black text-white/55">
            {cell.format}
          </span>
        ) : (
          <span className="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[10px] font-black text-amber-300/70">
            sans étiquette
          </span>
        )}
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-black ${verdict.cls}`}>
          {verdict.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-4">
        <div className="rounded-xl bg-black/40 px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-white/35">CA réel (Z)</p>
          <p className="font-black text-white/80">{cell.caReel == null ? "—" : formatEuro(cell.caReel)}</p>
        </div>
        <div className="rounded-xl bg-black/40 px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-white/35">Couverture</p>
          <p className="font-black text-white/80">{learnPct(cell.coverage)}</p>
        </div>
        <div className="rounded-xl bg-black/40 px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-white/35">Présents VIP</p>
          <p className="font-black text-white/80">{cell.visitsSeated}</p>
        </div>
        <div className="rounded-xl bg-black/40 px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-white/35">Nouveaux captés</p>
          <p className="font-black text-white/80">{cell.nbNouveaux}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
        <span>
          Spend identifié : <b className="text-white/60">{formatEuro(cell.spendIdentifie)}</b>{" "}
          ({cell.visitsSpendIdentified}/{cell.visitsSeated} présents chiffrés)
        </span>
        <span>
          Retour J+{RETENTION_WINDOW_DAYS} :{" "}
          <b className="text-white/60">
            {ret.rate == null ? "—" : `${learnPct(ret.rate)} (${ret.returned}/${ret.eligible})`}
          </b>
          {ret.pending > 0 && ` · ${ret.pending} en attente de fenêtre`}
        </span>
      </div>

      {cell.coverageVerdict === "tables-only" && (
        <p className="mt-2 text-[10px] leading-snug text-amber-300/60">
          Couverture &lt; {Math.round(COVERAGE_MIN_CONFIDENCE * 100)} % : on conclut seulement sur les
          tables identifiées, pas sur la soirée entière.
        </p>
      )}
    </div>
  );
}

// Boucle d'apprentissage CRM (spec §148-156) — écran DIRECTION. Le moteur (lib/crmLearning) est pur :
// cette vue ne fait que le câbler à la donnée réelle lue en base et rendre l'état d'honnêteté explicite.
// Aucun insight fabriqué : tant qu'il n'y a pas de matière (Z par univers + visites + étiquettes),
// l'écran le DIT plutôt que d'afficher un faux chiffre.
function LearningView({ today, data }: { today: string; data: LearningData }) {
  const { cells, rollup, honesty } = useMemo(() => {
    const formatFor = (date: string, univers: LearningUnivers) =>
      data.formatMap[`${date}|${univers}`] ?? null;
    const built = buildSoireeUniversMetrics({
      caisseRecords: data.caisseRecords,
      visits: data.visits,
      today,
      formatFor,
    });
    return {
      cells: built,
      rollup: buildFormatMonthlyRollup(built),
      honesty: summarizeLearningHonesty(built),
    };
  }, [data, today]);

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3">
      <div className="mb-1 flex items-center gap-2">
        <Lightbulb size={18} className="text-orange-500" />
        <h2 className="text-lg font-black">Boucle d&apos;apprentissage</h2>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Compare les soirées entre elles en croisant le <b className="text-white/60">Z de caisse</b> (CA
        réel comptable) et les <b className="text-white/60">visites clients</b>. Rien n&apos;est estimé :
        chaque base absente reste « — ». Le taux de couverture (spend identifié / CA réel) dit ce qu&apos;on
        s&apos;autorise à conclure.
      </p>

      {/* Bandeau d'honnêteté : dit franchement s'il y a — ou non — de quoi apprendre. */}
      <div
        className={`mt-3 rounded-2xl border p-3 ${
          honesty.ready
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-amber-500/30 bg-amber-500/10"
        }`}
      >
        <p className={`text-sm font-black ${honesty.ready ? "text-emerald-200" : "text-amber-200"}`}>
          {honesty.ready
            ? "Assez de matière pour commencer à lire les soirées"
            : "Pas encore de quoi apprendre"}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-white/45">
          {honesty.ready
            ? "Au moins une soirée a une couverture fiable ET une étiquette de format : la synthèse mensuelle devient exploitable."
            : "Il faut au moins une soirée avec couverture ≥ seuil ET une étiquette de format. La donnée s'accumule au fil des soirées saisies (Z) et des visites captées."}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-4">
          <div className="rounded-xl bg-black/30 px-2.5 py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-white/35">Couverture globale</p>
            <p className="font-black text-white/80">{learnPct(honesty.coverageGlobal)}</p>
          </div>
          <div className="rounded-xl bg-black/30 px-2.5 py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-white/35">Cellules fiables</p>
            <p className="font-black text-white/80">
              {honesty.cellsConfident}/{honesty.cellsWithCoverage}
            </p>
          </div>
          <div className="rounded-xl bg-black/30 px-2.5 py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-white/35">Tables seules</p>
            <p className="font-black text-white/80">{honesty.cellsTablesOnly}</p>
          </div>
          <div className="rounded-xl bg-black/30 px-2.5 py-1.5">
            <p className="text-[9px] uppercase tracking-wider text-white/35">Sans étiquette</p>
            <p className="font-black text-white/80">{honesty.cellsUnlabeled}</p>
          </div>
        </div>
      </div>

      {cells.length === 0 ? (
        <div className="mt-3">
          <Empty
            title="Aucune soirée à comparer pour l'instant"
            text="La boucle a besoin d'au moins un Z de caisse par univers OU une visite client (seated). Saisir les Z (Caisse) et capter des visites (CRM) alimente l'apprentissage — rien n'est inventé à leur place."
          />
        </div>
      ) : (
        <>
          {/* Détail par soirée × univers : la granularité de lecture. */}
          <div className="mt-4">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
              Par soirée × salle ({cells.length})
            </p>
            <div className="grid gap-2">
              {cells.map((cell) => (
                <LearningCellCard key={`${cell.exploitationDate}|${cell.univers}`} cell={cell} />
              ))}
            </div>
          </div>

          {/* Synthèse mensuelle par format : la sortie qui aide à décider la programmation. */}
          <div className="mt-4">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">
              Synthèse mensuelle par format
            </p>
            <p className="mb-2 text-[11px] leading-snug text-white/35">
              « Sans étiquette, pas d&apos;apprentissage » : les soirées non étiquetées tombent dans un
              seau à part. Chaque moyenne indique SA base (nb de cellules mesurées) — la partialité n&apos;est
              jamais masquée.
            </p>
            <div className="grid gap-2">
              {rollup.map((r) => (
                <div
                  key={`${r.month}|${r.format}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-orange-400">{r.month}</span>
                    {r.labeled ? (
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-black text-white/55">
                        {r.format}
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[10px] font-black text-amber-300/70">
                        non étiqueté
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-white/40">{r.nbSoirees} cellule(s)</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-4">
                    <div className="rounded-xl bg-black/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wider text-white/35">CA moyen</p>
                      <p className="font-black text-white/80">
                        {r.caMoyen == null ? "—" : formatEuro(r.caMoyen)}
                      </p>
                      <p className="text-[9px] text-white/30">base {r.caCellsCount}</p>
                    </div>
                    <div className="rounded-xl bg-black/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wider text-white/35">VIP moyen</p>
                      <p className="font-black text-white/80">{r.vipMoyen == null ? "—" : r.vipMoyen}</p>
                      <p className="text-[9px] text-white/30">{r.vipTotal} présents</p>
                    </div>
                    <div className="rounded-xl bg-black/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wider text-white/35">Retour J+{RETENTION_WINDOW_DAYS}</p>
                      <p className="font-black text-white/80">{learnPct(r.retention30Rate)}</p>
                      <p className="text-[9px] text-white/30">
                        {r.retenus30Total}/{r.retention30Eligible} éligibles
                      </p>
                    </div>
                    <div className="rounded-xl bg-black/40 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wider text-white/35">Couverture moy.</p>
                      <p className="font-black text-white/80">{learnPct(r.couvertureMoyenne)}</p>
                      <p className="text-[9px] text-white/30">base {r.couvertureCellsCount}</p>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] text-white/35">{r.nouveauxTotal} nouveaux captés sur le mois</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-snug text-white/35">
        Lecture seule, direction. Le CA réel vient du <b className="text-white/55">Z de caisse</b> (jamais
        estimé) ; la ligne « complexe » (non ventilable par salle) n&apos;alimente aucun univers. Un client
        n&apos;est « nouveau capté » que sur sa 1re présence de tout l&apos;historique. Le retour J+{RETENTION_WINDOW_DAYS}{" "}
        n&apos;est compté que quand la fenêtre est écoulée (sinon « en attente », jamais un 0 trompeur).
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
    ["monplanning", CalendarCheck, "Mon shift"],
    ["artistes", Music, "Artistes"],
    ["funnel", QrCode, "Invit QR"],
    ["crm", PhoneCall, "CRM"],
    ["incidents", AlertTriangle, "Incidents"],
    ["apprentissage", Lightbulb, "Appren."],
  ];

  const visibleTabs = visibleTabsForRole(user.role);
  const items = allItems.filter(([tab]) => visibleTabs.includes(tab));

  return (
    // Grille dynamique (gridTemplateColumns inline) : le nombre d'onglets dépasse désormais grid-cols-12
    // (13 pour la direction), au-delà des classes Tailwind par défaut. Une colonne par onglet visible.
    <nav
      className="grid shrink-0 border-t border-white/10 bg-black text-[9px] text-white/60"
      style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
    >
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
