"use client";

// app/_modules/agenda/AgendaTab.tsx — CONTENEUR autonome (intégrateur) de l'agenda INTERACTIF (0054).
// Récupère events + venues via Supabase, gère l'état de mois et l'éditeur, et branche les RPC
// create/update/duplicate/cancel_event_v1 (SECURITY DEFINER, admin/manager — RLS = frontière dure).
// Rend le composant présentationnel <MonthCalendar> + <EventEditorForm>. Tout staff VOIT le calendrier ;
// seule la direction (canManageEvents) crée/édite. Aucune logique métier ici : délègue à lib/eventManagement.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageEvents, type CalendarEvent } from "@/lib/eventManagement";
import type { StaffRole } from "@/lib/permissions";
import MonthCalendar from "@/app/_modules/agenda/MonthCalendar";
import EventEditorForm, { type EventFormValue, type VenueOption } from "@/app/_modules/agenda/EventEditorForm";

type EventRow = {
  id: string;
  title: string | null;
  event_date: string;
  status: string | null;
  venue_id: string | null;
  artistes: string | null;
  horaire_debut: string | null;
  horaire_fin: string | null;
  espace: string | null;
  capacite: number | null;
  equipe: unknown;
  notes: string | null;
};

const EMPTY_FORM: EventFormValue = {
  title: "",
  venue_id: "",
  event_date: "",
  status: "draft",
  artistes: "",
  horaire_debut: "",
  horaire_fin: "",
  espace: "",
  capacite: "",
  equipe: "",
  notes: "",
};

// jsonb equipe (tableau de noms) → texte libre pour l'éditeur, et inverse pour la RPC.
function equipeToText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "string") return v;
  return "";
}
function textToEquipe(t: string): string[] | null {
  const arr = t.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : null;
}

export default function AgendaTab({
  supabase,
  role,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
}) {
  const canManage = canManageEvents(role);
  const now = new Date();
  const [ym, setYm] = useState<{ year: number; month: number }>({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const today = now.toISOString().slice(0, 10);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventFormValue>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [dupDate, setDupDate] = useState("");

  const load = useCallback(async () => {
    const [ev, vn] = await Promise.all([
      supabase
        .from("events")
        .select("id, title, event_date, status, venue_id, artistes, horaire_debut, horaire_fin, espace, capacite, equipe, notes")
        .order("event_date", { ascending: true }),
      supabase.from("venues").select("id, name").order("sort_order", { ascending: true }),
    ]);
    if (ev.error) setError(ev.error.message);
    else setEvents((ev.data || []) as EventRow[]);
    if (!vn.error) setVenues(((vn.data || []) as { id: string; name: string }[]).map((v) => ({ id: v.id, name: v.name })));
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const calendarEvents = useMemo<CalendarEvent[]>(
    () => events.map((e) => ({ id: e.id, title: e.title, event_date: e.event_date, status: e.status, venue_id: e.venue_id })),
    [events],
  );

  function openCreate(date: string) {
    if (!canManage) return;
    setMode("create");
    setEditingId(null);
    setForm({ ...EMPTY_FORM, event_date: date, venue_id: venues[0]?.id ?? "" });
    setDupDate("");
    setError("");
    setEditorOpen(true);
  }

  function openEdit(id: string) {
    if (!canManage) return;
    const row = events.find((e) => e.id === id);
    if (!row) return;
    setMode("edit");
    setEditingId(id);
    setForm({
      title: row.title ?? "",
      venue_id: row.venue_id ?? "",
      event_date: row.event_date,
      status: row.status ?? "draft",
      artistes: row.artistes ?? "",
      horaire_debut: row.horaire_debut ?? "",
      horaire_fin: row.horaire_fin ?? "",
      espace: row.espace ?? "",
      capacite: row.capacite != null ? String(row.capacite) : "",
      equipe: equipeToText(row.equipe),
      notes: row.notes ?? "",
    });
    setDupDate(row.event_date);
    setError("");
    setEditorOpen(true);
  }

  function patch(p: Partial<EventFormValue>) {
    setForm((f) => ({ ...f, ...p }));
  }

  // RETURNS TABLE (ok, code, message, event_id) → première ligne.
  function readRpcResult(data: unknown): { ok: boolean; message: string } {
    const row = Array.isArray(data) ? (data[0] as { ok?: boolean; message?: string } | undefined) : (data as { ok?: boolean; message?: string } | null);
    return { ok: !!row?.ok, message: row?.message ?? "" };
  }

  async function submit() {
    if (!canManage) return;
    setSubmitting(true);
    setError("");
    const capacite = form.capacite.trim() === "" ? null : Number(form.capacite);
    try {
      if (mode === "create") {
        const { data, error: e } = await supabase.rpc("create_event_v1", {
          p_venue_id: form.venue_id,
          p_title: form.title,
          p_event_date: form.event_date,
          p_status: form.status || "draft",
          p_artistes: form.artistes || null,
          p_horaire_debut: form.horaire_debut || null,
          p_horaire_fin: form.horaire_fin || null,
          p_espace: form.espace || null,
          p_capacite: capacite,
          p_equipe: textToEquipe(form.equipe),
          p_notes: form.notes || null,
        });
        if (e) throw new Error(e.message);
        const r = readRpcResult(data);
        if (!r.ok) throw new Error(r.message || "Création refusée.");
      } else if (editingId) {
        const { data, error: e } = await supabase.rpc("update_event_v1", {
          p_event_id: editingId,
          p_title: form.title,
          p_venue_id: form.venue_id,
          p_event_date: form.event_date,
          p_status: form.status,
          p_artistes: form.artistes || null,
          p_horaire_debut: form.horaire_debut || null,
          p_horaire_fin: form.horaire_fin || null,
          p_espace: form.espace || null,
          p_capacite: capacite,
          p_equipe: textToEquipe(form.equipe),
          p_notes: form.notes || null,
        });
        if (e) throw new Error(e.message);
        const r = readRpcResult(data);
        if (!r.ok) throw new Error(r.message || "Modification refusée.");
      }
      setEditorOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelEvent() {
    if (!canManage || !editingId) return;
    setSubmitting(true);
    setError("");
    try {
      const { data, error: e } = await supabase.rpc("cancel_event_v1", { p_event_id: editingId });
      if (e) throw new Error(e.message);
      const r = readRpcResult(data);
      if (!r.ok) throw new Error(r.message || "Annulation refusée.");
      setEditorOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSubmitting(false);
    }
  }

  async function duplicateEvent() {
    if (!canManage || !editingId || !dupDate) return;
    setSubmitting(true);
    setError("");
    try {
      const { data, error: e } = await supabase.rpc("duplicate_event_v1", {
        p_source_event_id: editingId,
        p_new_date: dupDate,
      });
      if (e) throw new Error(e.message);
      const r = readRpcResult(data);
      if (!r.ok) throw new Error(r.message || "Duplication refusée.");
      setEditorOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-white/40">Chargement de l'agenda…</div>;
  }

  return (
    <div className="space-y-3">
      {error && !editorOpen && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>
      )}

      <MonthCalendar
        year={ym.year}
        month={ym.month}
        events={calendarEvents}
        today={today}
        selectedDate={editorOpen ? form.event_date : null}
        onMonthChange={setYm}
        onSelectDay={openCreate}
        onSelectEvent={(ev) => ev.id && openEdit(ev.id)}
      />

      {!canManage && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
          Lecture seule · seule la direction crée ou modifie une soirée
        </div>
      )}

      {editorOpen && canManage && (
        <div className="space-y-2">
          <EventEditorForm
            mode={mode}
            value={form}
            venues={venues}
            onChange={patch}
            onSubmit={submit}
            onCancel={() => setEditorOpen(false)}
            onDelete={mode === "edit" ? cancelEvent : undefined}
            submitting={submitting}
            error={error}
          />
          {mode === "edit" && (
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wide text-white/40">Dupliquer vers</span>
              <input
                type="date"
                className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
                value={dupDate}
                onChange={(e) => setDupDate(e.target.value)}
              />
              <button
                type="button"
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white/70 hover:bg-white/10 disabled:opacity-40"
                onClick={duplicateEvent}
                disabled={submitting || !dupDate}
              >
                Dupliquer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
