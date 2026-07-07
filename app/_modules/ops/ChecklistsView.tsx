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
  canManageChecklistItems,
  canViewChecklists,
  categoryLabel,
  groupByPhase,
  linesForPoste,
  phaseLabel,
  progressByPhase,
  summarizeChecklist,
  validateItemDraft,
  CHECKLIST_CATEGORIES,
  CHECKLIST_PHASES,
  CHECKLIST_ROLES,
  type ChecklistCompletion,
  type ChecklistItem,
  type ChecklistItemDraft,
  type ChecklistLine,
} from "@/lib/checklists";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const FIELD =
  "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 [&>option]:text-black";

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

  // Composition du modèle (direction seule) : brouillon d'item saisi au runtime (le module ship VIDE).
  const canCompose = canManageChecklistItems(role);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftPhase, setDraftPhase] = useState<string>(CHECKLIST_PHASES[0]);
  const [draftCategory, setDraftCategory] = useState<string>(CHECKLIST_CATEGORIES[0]);
  const [draftPoste, setDraftPoste] = useState<string>(""); // "" = tous les postes (null)
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

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

  // Composition d'un item : validation UI (validateItemDraft/canManageChecklistItems) MIROIR de la RLS 0028
  // (checklist_items_insert = direction seule). auteur_username reste fixé SERVEUR (current_staff_username,
  // default 0028) → jamais fourni par le client, sinon le WITH CHECK rejette. Reload après succès.
  async function createItem(): Promise<void> {
    setFormError("");
    const draft: ChecklistItemDraft = {
      phase: draftPhase,
      category: draftCategory,
      label: draftLabel,
      poste: draftPoste === "" ? null : draftPoste,
    };
    const v = validateItemDraft(draft, role);
    if (!v.ok) {
      setFormError(v.errors.join(" · "));
      return;
    }
    setCreating(true);
    try {
      const { error: e } = await supabase.from("checklist_items").insert({
        venue: null,
        phase: draft.phase,
        category: draft.category,
        poste: draft.poste,
        label: draft.label.trim(),
        // auteur_username omis : rempli côté serveur par current_staff_username() (default 0028).
      });
      if (e) {
        setFormError(`Création refusée : ${e.message}`);
        return;
      }
      setDraftLabel(""); // on garde phase/catégorie/poste pour saisir plusieurs items d'affilée
      await load();
    } finally {
      setCreating(false);
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

      {/* Composition du modèle : direction seule (canManageChecklistItems). La RLS 0028 reste l'AUTORITÉ ;
          ce formulaire reflète la même règle et fin le « ship vide » (les libellés sont saisis au runtime). */}
      {canCompose && (
        <div className={`${CARD} space-y-2`}>
          <div className="text-xs font-black uppercase tracking-wide text-white/60">
            Composer un item · direction
          </div>
          <p className="text-[11px] text-white/40">
            Le modèle ship vide : ajoutez les vraies lignes d&apos;ouverture / fermeture. Elles s&apos;appliquent à
            toutes les soirées.
          </p>
          <input
            type="text"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="Libellé de l'item (ex. Vérifier les extincteurs)"
            maxLength={200}
            disabled={creating}
            className={FIELD}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-white/40">Phase</span>
              <select
                value={draftPhase}
                onChange={(e) => setDraftPhase(e.target.value)}
                disabled={creating}
                className={FIELD}
              >
                {CHECKLIST_PHASES.map((p) => (
                  <option key={p} value={p}>
                    {phaseLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-white/40">Catégorie</span>
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                disabled={creating}
                className={FIELD}
              >
                {CHECKLIST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-white/40">Poste responsable</span>
            <select
              value={draftPoste}
              onChange={(e) => setDraftPoste(e.target.value)}
              disabled={creating}
              className={FIELD}
            >
              <option value="">Tous postes</option>
              {CHECKLIST_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {formError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
              {formError}
            </div>
          )}
          <button
            type="button"
            onClick={createItem}
            disabled={creating || draftLabel.trim().length === 0}
            className={BTN}
          >
            {creating ? "Ajout…" : "Ajouter l'item"}
          </button>
        </div>
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
