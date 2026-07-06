"use client";

// app/_modules/tasks/TasksView.tsx — écran Tâches / to-do interne (0055), mobile-first, PRÉSENTATIONNEL.
// 100% piloté par les props : aucune I/O, aucun fetch, aucun import de page.tsx. La RLS 0055 = frontière
// dure (direction = tout ; assigné = SES tâches, statut/priorité). Kanban par statut, assigné, échéance.

import { useMemo, useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  UNASSIGNED_KEY,
  canManageTasks,
  countByStatus,
  groupByStatus,
  isOverdue,
  priorityRank,
  sortByPriority,
  validateTaskDraft,
  validateTransition,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "À faire",
  doing: "En cours",
  done: "Terminé",
  cancelled: "Annulé",
};
const STATUS_ACCENT: Record<TaskStatus, string> = {
  todo: "text-white/70",
  doing: "text-sky-300",
  done: "text-emerald-300",
  cancelled: "text-white/40",
};
const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Basse", normal: "Normale", high: "Haute" };
const PRIORITY_DOT: Record<TaskPriority, string> = {
  high: "bg-red-400",
  normal: "bg-amber-300",
  low: "bg-white/30",
};

export type TaskDraft = {
  title: string;
  description: string;
  assignee_username: string;
  due_date: string;
  priority: TaskPriority;
};

export default function TasksView({
  tasks,
  role,
  today,
  staffUsernames = [],
  error = "",
  onCreate,
  onTransition,
  onPriorityChange,
}: {
  tasks: Task[];
  role: StaffRole;
  today: string; // YYYY-MM-DD (fourni par l'intégrateur, jamais deviné ici)
  staffUsernames?: string[];
  error?: string;
  onCreate?: (draft: TaskDraft) => void;
  onTransition?: (taskId: string, to: TaskStatus) => void;
  onPriorityChange?: (taskId: string, priority: TaskPriority) => void;
}) {
  const canManage = canManageTasks(role);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [formError, setFormError] = useState("");

  const columns = useMemo(() => groupByStatus(tasks), [tasks]);
  const counts = useMemo(() => countByStatus(tasks), [tasks]);
  const overdueCount = useMemo(() => tasks.filter((t) => isOverdue(t, today)).length, [tasks, today]);

  function submit() {
    setFormError("");
    const draft = { title, status: "todo", priority, due_date: dueDate };
    const check = validateTaskDraft(draft);
    if (!check.ok) {
      setFormError(check.message);
      return;
    }
    onCreate?.({
      title: title.trim(),
      description: description.trim(),
      assignee_username: assignee.trim(),
      due_date: dueDate,
      priority,
    });
    setTitle("");
    setDescription("");
    setAssignee("");
    setDueDate("");
    setPriority("normal");
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-4 gap-2 text-center">
        {TASK_STATUSES.map((s) => (
          <div key={s} className={CARD}>
            <div className={`text-2xl font-black ${STATUS_ACCENT[s]}`}>{counts[s]}</div>
            <div className="text-[10px] uppercase text-white/50">{STATUS_LABEL[s]}</div>
          </div>
        ))}
      </div>
      <div className="text-center text-xs text-white/60">
        En retard : <b className={overdueCount > 0 ? "text-red-400" : "text-white"}>{overdueCount}</b>
      </div>

      {(error || formError) && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {formError || error}
        </div>
      )}

      {canManage && (
        <div className={CARD}>
          <div className="mb-2 text-xs font-bold uppercase text-white/50">Nouvelle tâche</div>
          <div className="space-y-2">
            <input className={INPUT} placeholder="Titre (ex. Vérifier les extincteurs)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className={INPUT} placeholder="Description (optionnel)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={INPUT} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">— non assignée —</option>
                {staffUsernames.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <select className={INPUT} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <input className={INPUT} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <button className={BTN} onClick={submit} disabled={!title.trim()}>Créer la tâche</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TASK_STATUSES.map((s) => (
          <div key={s} className="space-y-2">
            <div className={`text-xs font-bold uppercase ${STATUS_ACCENT[s]}`}>
              {STATUS_LABEL[s]} ({columns[s].length})
            </div>
            {columns[s].length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-white/30">—</div>
            ) : (
              <ul className="space-y-2">
                {sortByPriority(columns[s]).map((t) => {
                  const overdue = isOverdue(t, today);
                  const pr = (["high", "normal", "low"] as const)[priorityRank(t.priority)] as TaskPriority;
                  return (
                    <li key={t.id} className={`${CARD} ${overdue ? "border-red-500/40 bg-red-500/10" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{t.title}</div>
                          {t.description ? <div className="mt-0.5 text-[11px] text-white/50 line-clamp-2">{t.description}</div> : null}
                        </div>
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[pr]}`} title={PRIORITY_LABEL[pr]} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-white/50">
                        <span>{t.assignee_username || "non assignée"}</span>
                        {t.due_date ? (
                          <span className={overdue ? "font-bold text-red-400" : ""}>· {t.due_date}{overdue ? " (retard)" : ""}</span>
                        ) : null}
                      </div>
                      {onTransition ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {TASK_STATUSES.filter((to) => to !== t.status && validateTransition(t.status, to).ok).map((to) => (
                            <button
                              key={to}
                              onClick={() => onTransition(t.id, to)}
                              className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-bold text-white/80"
                            >
                              → {STATUS_LABEL[to]}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {onPriorityChange ? (
                        <div className="mt-1.5">
                          <select
                            className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/70"
                            value={pr}
                            onChange={(e) => onPriorityChange(t.id, e.target.value as TaskPriority)}
                          >
                            {TASK_PRIORITIES.map((p) => (
                              <option key={p} value={p}>Priorité : {PRIORITY_LABEL[p]}</option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>

      {tasks.length === 0 && (
        <div className="text-center text-sm text-white/40">Aucune tâche. La direction saisit les actions à suivre.</div>
      )}
    </div>
  );
}

// Regroupement par assigné exposé pour un futur mode « par personne » (piloté par la logique pure).
export { groupByStatus, UNASSIGNED_KEY };
