"use client";

// app/_modules/tasks/TasksTab.tsx — CONTENEUR autonome (intégrateur) pour le module Tâches (0055).
// Récupère les données via le client Supabase (RLS 0055 = frontière dure), calcule `today`, et pilote
// le composant PRÉSENTATIONNEL <TasksView>. Même contrat d'appel que les autres modules (StockView) :
// { supabase, role, username }. Aucune logique métier ici — délègue à lib/tasks + RLS.

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import type { Task, TaskPriority, TaskStatus } from "@/lib/tasks";
import TasksView, { type TaskDraft } from "@/app/_modules/tasks/TasksView";

export default function TasksTab({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staffUsernames, setStaffUsernames] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().slice(0, 10);

  const loadTasks = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });
    if (e) setError(e.message);
    else setTasks((data || []) as Task[]);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [tk, st] = await Promise.all([
        supabase.from("tasks").select("*").order("created_at", { ascending: false }),
        supabase.from("staff_members").select("username").eq("actif", true).order("username", { ascending: true }),
      ]);
      if (!active) return;
      if (tk.error) setError(tk.error.message);
      else setTasks((tk.data || []) as Task[]);
      // La liste des assignés est un confort : une erreur RLS ici ne bloque pas l'écran.
      if (!st.error) setStaffUsernames(((st.data || []) as { username: string }[]).map((r) => r.username));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  async function handleCreate(draft: TaskDraft) {
    setError("");
    const { error: e } = await supabase.from("tasks").insert({
      title: draft.title,
      description: draft.description || null,
      assignee_username: draft.assignee_username || null,
      assigned_by: username,
      due_date: draft.due_date || null,
      priority: draft.priority,
      status: "todo",
    });
    if (e) {
      setError(`Création refusée : ${e.message}`);
      return;
    }
    await loadTasks();
  }

  async function handleTransition(taskId: string, to: TaskStatus) {
    setError("");
    const { error: e } = await supabase
      .from("tasks")
      .update({ status: to, updated_at: new Date().toISOString() })
      .eq("id", taskId);
    if (e) {
      setError(`Changement de statut refusé : ${e.message}`);
      return;
    }
    await loadTasks();
  }

  async function handlePriorityChange(taskId: string, priority: TaskPriority) {
    setError("");
    const { error: e } = await supabase
      .from("tasks")
      .update({ priority, updated_at: new Date().toISOString() })
      .eq("id", taskId);
    if (e) {
      setError(`Changement de priorité refusé : ${e.message}`);
      return;
    }
    await loadTasks();
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-white/40">Chargement des tâches…</div>;
  }

  return (
    <TasksView
      tasks={tasks}
      role={role}
      today={today}
      staffUsernames={staffUsernames}
      error={error}
      onCreate={handleCreate}
      onTransition={handleTransition}
      onPriorityChange={handlePriorityChange}
    />
  );
}
