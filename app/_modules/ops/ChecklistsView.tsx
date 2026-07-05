"use client";

// app/_modules/ops/ChecklistsView.tsx — écran Checklists ouverture/fermeture (module 0028), mobile-first.
// Autonome : reçoit le client supabase partagé + le rôle + l'username. La RLS 0028 est la frontière dure
// (composition = direction ; cochage « par poste ») ; le front reflète la MÊME règle via lib/checklists
// (canManageChecklistItems / canCompleteItem / linesForPoste) — aucune règle dupliquée, aucune donnée
// inventée. L'écran ship VIDE (aucun item de contenu n'est défini en code) : ce sont de vrais items saisis
// par la direction, coches sur la SOIRÉE ACTIVE réelle (get_active_event_context). Pas de soirée → état vide
// honnête, jamais une ligne fabriquée.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import { loadActiveEventContext, type ActiveEventContext } from "@/lib/activeEvent";
import {
  buildLines,
  canCompleteItem,
  canViewChecklists,
  categoryLabel,
  groupByPhase,
  linesForPoste,
  phaseLabel,
  progressByPhase,
  summarizeChecklist,
  type ChecklistCompletion,
  type ChecklistItem,
  type ChecklistLine,
} from "@/lib/checklists";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export default function ChecklistsView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const viewable = canViewChecklists(role);
  const [event, setEvent] = useState<ActiveEventContext | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [completions, setCompletions] = useState<ChecklistCompletion[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Rechargement après mutation. Le premier setState est POST-await (jamais synchrone dans l'effet).
  const load = useCallback(async () => {
    // Le promoteur n'a pas de checklist (miroir RLS 0028) → on ne sonde même pas la base.
    if (!viewable) {
      setLoading(false);
      return;
    }
    const ctx = await loadActiveEventContext(supabase).catch((e) => {
      setError(e instanceof Error ? e.message : "Soirée active indisponible.");
      return null;
    });
    setEvent(ctx);
    const [it, cp] = await Promise.all([
      supabase.from("checklist_items").select("*").eq("active", true),
      ctx
        ? supabase.from("checklist_completions").select("*").eq("exploitation_date", ctx.eventDate)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (it.error) setError(it.error.message);
    else setItems((it.data || []) as ChecklistItem[]);
    if (!cp.error) setCompletions((cp.data || []) as ChecklistCompletion[]);
    setLoading(false);
  }, [supabase, viewable]);

  // Chargement initial : IIFE async avec garde de montage. setState POST-await → pas de cascade de rendus.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!viewable) {
        if (active) setLoading(false);
        return;
      }
      let ctx: ActiveEventContext | null = null;
      try {
        ctx = await loadActiveEventContext(supabase);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Soirée active indisponible.");
      }
      const [it, cp] = await Promise.all([
        supabase.from("checklist_items").select("*").eq("active", true),
        ctx
          ? supabase.from("checklist_completions").select("*").eq("exploitation_date", ctx.eventDate)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      setEvent(ctx);
      if (it.error) setError(it.error.message);
      else setItems((it.data || []) as ChecklistItem[]);
      if (!cp.error) setCompletions((cp.data || []) as ChecklistCompletion[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, viewable]);

  // Lignes (items + coches de LA soirée active), cadrées par poste, puis groupées par phase → catégorie.
  const exploitationDate = event?.eventDate ?? "";
  const allLines = useMemo(
    () => (event ? buildLines(items, completions, exploitationDate) : []),
    [items, completions, exploitationDate, event],
  );
  const visibleLines = useMemo(() => linesForPoste(allLines, role), [allLines, role]);
  const phaseGroups = useMemo(() => groupByPhase(visibleLines), [visibleLines]);
  const progress = useMemo(() => progressByPhase(visibleLines), [visibleLines]);
  const summary = useMemo(() => summarizeChecklist(visibleLines), [visibleLines]);

  // Coche : INSERT dans checklist_completions (la RLS 0028 est l'AUTORITÉ ; canCompleteItem miroite le WITH
  // CHECK côté UI pour ne pas proposer un bouton que le serveur rejetterait).
  async function toggle(line: ChecklistLine): Promise<void> {
    if (!event) return;
    setError("");
    setBusy(line.item.id);
    try {
      if (!line.done) {
        const { error: e } = await supabase.from("checklist_completions").insert({
          item_id: line.item.id,
          event_id: event.eventId,
          exploitation_date: event.eventDate,
          done_by: username,
        });
        if (e) {
          setError(`Coche refusée : ${e.message}`);
          return;
        }
      } else {
        const { error: e } = await supabase
          .from("checklist_completions")
          .delete()
          .eq("item_id", line.item.id)
          .eq("exploitation_date", event.eventDate);
        if (e) {
          setError(`Décoche refusée : ${e.message}`);
          return;
        }
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  // Promoteur : pas de poste d'ouverture/fermeture → aucune checklist (miroir RLS 0028).
  if (!viewable) {
    return (
      <div className="space-y-3 pb-4 text-white">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-4 text-center text-sm text-white/50">
          Checklists non disponibles pour ce rôle. Le promoteur n&apos;a pas de poste
          d&apos;ouverture/fermeture (exclu comme incidents et comm interne).
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      {/* Bandeau soirée : les coches portent sur LA soirée active réelle (honnête, aucune date fabriquée). */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[11px] text-white/60">
        {event ? (
          <>
            Soirée active : <b className="text-white">{event.title || event.venueName || "en cours"}</b>
            {" · "}
            <span className="tabular-nums">{event.eventDate}</span>
          </>
        ) : (
          "Aucune soirée active — ouvrez une soirée pour cocher la checklist."
        )}
      </div>

      {/* Avancement par phase (états vides honnêtes : aucun item visible → des zéros, pas de division). */}
      <div className="grid grid-cols-2 gap-2 text-center">
        {progress.map((p) => (
          <div key={p.phase} className={CARD}>
            <div className="text-2xl font-black">
              <span className={p.total > 0 && p.done === p.total ? "text-emerald-300" : ""}>{p.done}</span>
              <span className="text-white/40">/{p.total}</span>
            </div>
            <div className="text-[10px] uppercase text-white/50">{phaseLabel(p.phase)}</div>
          </div>
        ))}
      </div>
      <div className="text-center text-xs text-white/60">
        Visibles : <b className="text-white">{summary.total}</b> · faits : <b className="text-white">{summary.done}</b> · reste :{" "}
        <b className="text-white">{summary.remaining}</b>
        {summary.complete && <span className="text-emerald-300"> · tout est fait ✓</span>}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>
      )}

      {loading ? (
        <div className="text-center text-sm text-white/40">Chargement…</div>
      ) : !event ? (
        <div className="text-center text-sm text-white/40">
          Aucune soirée active. La checklist se coche sur la soirée en cours.
        </div>
      ) : phaseGroups.length === 0 ? (
        <div className="text-center text-sm text-white/40">
          Aucun item de checklist visible pour ce poste. La direction compose le modèle (ouverture / fermeture).
        </div>
      ) : (
        <div className="space-y-4">
          {phaseGroups.map((pg) => (
            <div key={pg.phase}>
              <div className="mb-2 text-xs font-black uppercase tracking-wide text-white/60">{phaseLabel(pg.phase)}</div>
              <div className="space-y-3">
                {pg.groups.map((cg) => (
                  <div key={cg.category}>
                    <div className="mb-1 text-[10px] font-bold uppercase text-white/40">{categoryLabel(cg.category)}</div>
                    <ul className="space-y-2">
                      {cg.lines.map((line) => {
                        const canCheck = canCompleteItem(role, line.item);
                        const isBusy = busy === line.item.id;
                        return (
                          <li key={line.item.id} className={`${CARD} flex items-center gap-3`}>
                            <button
                              type="button"
                              onClick={() => toggle(line)}
                              disabled={!canCheck || isBusy || !event}
                              aria-pressed={line.done}
                              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-sm font-black transition ${
                                line.done
                                  ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200"
                                  : "border-white/20 bg-black/40 text-transparent"
                              } ${!canCheck ? "opacity-40" : ""}`}
                            >
                              {line.done ? "✓" : ""}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className={`truncate text-sm font-bold ${line.done ? "text-white/60 line-through" : ""}`}>
                                {line.item.label}
                              </div>
                              <div className="text-[11px] text-white/40">
                                {line.item.poste ? `Poste ${line.item.poste}` : "Tous postes"}
                                {line.done && line.doneBy ? ` · fait par ${line.doneBy}` : ""}
                                {!canCheck && !line.done ? " · autre poste" : ""}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
