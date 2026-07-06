// lib/tasks.ts — logique métier PURE du module Tâches / to-do interne (0055). 100% testable.
// Aucune I/O : transitions de statut, ordre de priorité, regroupements, retard, validation de brouillon.
// La RLS 0055 reste l'autorité (direction = tout ; assigné = SES tâches en lecture + statut/priorité).

import type { StaffRole } from "./permissions.ts";

export const TASK_STATUSES = ["todo", "doing", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  assignee_username?: string | null;
  assigned_by?: string | null;
  due_date?: string | null; // YYYY-MM-DD
  status: string;
  priority: string;
  event_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

// Seule la direction (admin/manager) crée/assigne/supprime ; les autres rôles salariés consultent
// et font avancer LEURS tâches (le promoteur n'est pas dans l'effectif → exclu, comme la matrice RH).
export function canManageTasks(role: StaffRole): boolean {
  return role === "admin" || role === "manager";
}
export function canViewTasks(role: StaffRole): boolean {
  return role !== "promoter";
}

// ── Transitions de statut ────────────────────────────────────────────────────────────────────────
// Graphe minimal et sûr : on peut démarrer, terminer, annuler, revenir en arrière ou rouvrir.
const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["doing", "cancelled", "done"],
  doing: ["todo", "done", "cancelled"],
  done: ["doing"], // réouverture
  cancelled: ["todo"], // réactivation
};

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
}
export function isTaskPriority(v: unknown): v is TaskPriority {
  return typeof v === "string" && (TASK_PRIORITIES as readonly string[]).includes(v);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true; // idempotent (ré-enregistrer le même statut est toléré)
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function validateTransition(from: string, to: string): { ok: boolean; message: string } {
  if (!isTaskStatus(from)) return { ok: false, message: "Statut de départ inconnu." };
  if (!isTaskStatus(to)) return { ok: false, message: "Statut cible inconnu." };
  if (!canTransition(from, to)) return { ok: false, message: `Transition ${from} → ${to} interdite.` };
  return { ok: true, message: "" };
}

export function isClosedStatus(status: string): boolean {
  return status === "done" || status === "cancelled";
}

// ── Ordre de priorité ────────────────────────────────────────────────────────────────────────────
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

export function priorityRank(priority: string): number {
  return isTaskPriority(priority) ? PRIORITY_RANK[priority] : PRIORITY_RANK.normal;
}

// Tri stable : priorité décroissante (high d'abord), puis échéance croissante (les sans date en fin).
export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    const da = a.due_date || "9999-12-31";
    const db = b.due_date || "9999-12-31";
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

// ── Regroupements ────────────────────────────────────────────────────────────────────────────────
export const UNASSIGNED_KEY = "__unassigned__";

export function groupByAssignee(tasks: Task[]): Record<string, Task[]> {
  const out: Record<string, Task[]> = {};
  for (const t of tasks) {
    const key = t.assignee_username && t.assignee_username.trim() ? t.assignee_username : UNASSIGNED_KEY;
    (out[key] ||= []).push(t);
  }
  return out;
}

// Toujours les 4 colonnes (même vides) pour un rendu kanban stable.
export function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const out = { todo: [], doing: [], done: [], cancelled: [] } as Record<TaskStatus, Task[]>;
  for (const t of tasks) {
    if (isTaskStatus(t.status)) out[t.status].push(t);
  }
  return out;
}

// ── Retard ───────────────────────────────────────────────────────────────────────────────────────
// En retard = échéance passée (strictement avant aujourd'hui) ET tâche non close (ni done ni cancelled).
export function isOverdue(task: Task, today: string): boolean {
  if (!task.due_date) return false;
  if (isClosedStatus(task.status)) return false;
  return task.due_date < today;
}

export function overdueTasks(tasks: Task[], today: string): Task[] {
  return tasks.filter((t) => isOverdue(t, today));
}

export function countByStatus(tasks: Task[]): Record<TaskStatus, number> {
  const g = groupByStatus(tasks);
  return { todo: g.todo.length, doing: g.doing.length, done: g.done.length, cancelled: g.cancelled.length };
}

// ── Validation de brouillon (formulaire de création) ─────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTaskDraft(d: {
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  due_date?: string | null;
}): { ok: boolean; message: string } {
  if (!d.title || !d.title.trim()) return { ok: false, message: "Titre requis." };
  if (d.title.trim().length > 200) return { ok: false, message: "Titre trop long (200 max)." };
  if (d.status != null && d.status !== "" && !isTaskStatus(d.status)) return { ok: false, message: "Statut inconnu." };
  if (d.priority != null && d.priority !== "" && !isTaskPriority(d.priority)) return { ok: false, message: "Priorité inconnue." };
  if (d.due_date != null && d.due_date !== "") {
    if (!ISO_DATE.test(d.due_date)) return { ok: false, message: "Échéance invalide (AAAA-MM-JJ)." };
    if (Number.isNaN(Date.parse(d.due_date))) return { ok: false, message: "Échéance invalide." };
  }
  return { ok: true, message: "" };
}
