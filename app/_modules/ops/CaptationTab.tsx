"use client";

// app/_modules/ops/CaptationTab.tsx — écran CAPTATION EN SOIRÉE (shot list photo/vidéo, A10 · module 0029).
//
// Container AUTONOME : reçoit le client supabase partagé + le rôle + l'username, va chercher LES VRAIES
// données (shot_list_items + shot_captures de la SOIRÉE ACTIVE via get_active_event_context) et alimente le
// composant présentationnel CaptationBoard. Fin du preview orphelin : plus aucune donnée fictive — les plans
// et les captures sont ceux de la base, DÉJÀ filtrés par la RLS 0029 (direction seule). La RLS reste la
// FRONTIÈRE DURE ; le front ne fait que refléter la même règle via lib/captation (canViewCaptation /
// canManageShotList / canCaptureShot), sans dupliquer aucune logique métier ni inventer aucun plan.
//
// Deux écritures RÉELLES, toutes deux sous RLS 0029 (updated_by / auteur_username = utilisateur courant,
// WITH CHECK anti-usurpation) :
//   · faire avancer le statut d'un plan → UPSERT dans shot_captures pour la soirée active (contrainte unique
//     (item_id, exploitation_date)) — nécessite une soirée active (exploitation_date) ;
//   · composer la shot list (ajouter un plan) → INSERT dans shot_list_items (indépendant de la soirée).
//
// États HONNÊTES : chargement, erreur (message brut de la base), et vides jamais fabriqués (aucun plan → un
// message clair ; pas de soirée active → la capture est fermée mais la shot list reste composable/visible).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import { loadActiveEventContext, type ActiveEventContext } from "@/lib/activeEvent";
import CaptationBoard from "@/components/CaptationBoard";
import {
  VENUES,
  buildCaptureUpsert,
  buildShotInsert,
  canManageShotList,
  canViewCaptation,
  mapShotCaptureRow,
  mapShotListItemRow,
  validateShotDraft,
  venueLabel,
  type CaptationStatus,
  type ShotCapture,
  type ShotListDraft,
  type ShotListItem,
} from "@/lib/captation";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const FIELD =
  "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30";

const EMPTY_DRAFT: ShotListDraft = {
  label: "",
  venue: null,
  sujet: "",
  format: "",
  heure_ideale: "",
  prioritaire: false,
  position: 0,
};

export default function CaptationTab({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const viewable = canViewCaptation(role);
  const canManage = canManageShotList(role);

  const [event, setEvent] = useState<ActiveEventContext | null>(null);
  const [items, setItems] = useState<ShotListItem[]>([]);
  const [captures, setCaptures] = useState<ShotCapture[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Formulaire « ajouter un plan » (composition de la shot list — direction seule).
  const [draft, setDraft] = useState<ShotListDraft>(EMPTY_DRAFT);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Rechargement après mutation. Premier setState POST-await (jamais synchrone dans un effet).
  const load = useCallback(async () => {
    // Le promoteur / serveur / sécurité / compteur n'ont AUCUN accès (miroir RLS 0029) → on ne sonde pas.
    if (!viewable) {
      setLoading(false);
      return;
    }
    const ctx = await loadActiveEventContext(supabase).catch((e) => {
      setError(e instanceof Error ? e.message : "Soirée active indisponible.");
      return null;
    });
    const [it, cp] = await Promise.all([
      supabase.from("shot_list_items").select("*").eq("active", true).order("position"),
      ctx
        ? supabase.from("shot_captures").select("*").eq("exploitation_date", ctx.eventDate)
        : Promise.resolve({ data: [], error: null }),
    ]);
    setEvent(ctx);
    if (it.error) setError(it.error.message);
    else setItems((it.data || []).map(mapShotListItemRow));
    if (!cp.error) setCaptures((cp.data || []).map(mapShotCaptureRow));
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
        supabase.from("shot_list_items").select("*").eq("active", true).order("position"),
        ctx
          ? supabase.from("shot_captures").select("*").eq("exploitation_date", ctx.eventDate)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      setEvent(ctx);
      if (it.error) setError(it.error.message);
      else setItems((it.data || []).map(mapShotListItemRow));
      if (!cp.error) setCaptures((cp.data || []).map(mapShotCaptureRow));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, viewable]);

  const exploitationDate = event?.eventDate ?? "";

  // Avancement du statut : UPSERT dans shot_captures pour la soirée active. La RLS 0029 est l'AUTORITÉ ;
  // canCaptureShot (dans le board) miroite le WITH CHECK côté UI. Sans soirée active → refus honnête.
  const onSetStatus = useCallback(
    async (itemId: string, status: CaptationStatus): Promise<void> => {
      setError("");
      if (!event) {
        setError("Aucune soirée active : ouvrez une soirée pour enregistrer une capture.");
        return;
      }
      const payload = buildCaptureUpsert(
        itemId,
        status,
        { eventId: event.eventId, eventDate: event.eventDate },
        username,
      );
      const { error: e } = await supabase
        .from("shot_captures")
        .upsert(payload, { onConflict: "item_id,exploitation_date" });
      if (e) {
        setError(`Statut refusé : ${e.message}`);
        return;
      }
      await load();
    },
    [event, supabase, username, load],
  );

  // Ajout d'un plan : INSERT dans shot_list_items (indépendant de la soirée). Validé AVANT insert par
  // validateShotDraft (libellé requis, univers/position bornés, rôle) ; payload nettoyé par buildShotInsert.
  async function addShot(): Promise<void> {
    setError("");
    const validation = validateShotDraft(draft, role);
    if (!validation.ok) {
      setFormErrors(validation.errors);
      return;
    }
    setFormErrors([]);
    setBusy(true);
    try {
      const { error: e } = await supabase.from("shot_list_items").insert(buildShotInsert(draft, username));
      if (e) {
        setError(`Ajout refusé : ${e.message}`);
        return;
      }
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const activeCount = useMemo(() => items.filter((it) => it.active).length, [items]);

  // Aucun accès (miroir RLS 0029 : la captation est un métier créa = direction dans le socle).
  if (!viewable) {
    return (
      <div className="space-y-3 pb-4 text-white">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-4 text-center text-sm text-white/50">
          La captation n&apos;est pas accessible à ce rôle. La shot list photo/vidéo est réservée à la
          direction (créa dans le socle — matrice A10).
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      {/* Bandeau soirée : les captures portent sur LA soirée active réelle (aucune date fabriquée). */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[11px] text-white/60">
        {event ? (
          <>
            Soirée active : <b className="text-white">{event.title || event.venueName || "en cours"}</b>
            {" · "}
            <span className="tabular-nums">{event.eventDate}</span>
          </>
        ) : (
          "Aucune soirée active — la shot list reste composable ; la capture s'enregistre sur la soirée en cours."
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      {/* Composition de la shot list (direction seule) : ajout d'un plan réel. */}
      {canManage && (
        <div className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wide text-white/60">
              Shot list · {activeCount} plan{activeCount > 1 ? "s" : ""} actif{activeCount > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                setShowForm((v) => !v);
                setFormErrors([]);
              }}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-bold text-white/80 hover:text-white"
            >
              {showForm ? "Fermer" : "+ Ajouter un plan"}
            </button>
          </div>

          {showForm && (
            <div className="mt-3 space-y-2">
              <input
                className={FIELD}
                placeholder="Libellé du plan (ex. Arrivée tête d'affiche)"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  className={FIELD}
                  value={draft.venue ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, venue: e.target.value || null }))}
                >
                  <option value="">Toutes salles</option>
                  {VENUES.map((v) => (
                    <option key={v} value={v}>
                      {venueLabel(v)}
                    </option>
                  ))}
                </select>
                <input
                  className={FIELD}
                  placeholder="Heure idéale (ex. 23h45)"
                  value={draft.heure_ideale ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, heure_ideale: e.target.value }))}
                />
                <input
                  className={FIELD}
                  placeholder="Sujet (artiste, public, décor…)"
                  value={draft.sujet ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, sujet: e.target.value }))}
                />
                <input
                  className={FIELD}
                  placeholder="Format (Reel, Story, Photo…)"
                  value={draft.format ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={draft.prioritaire ?? false}
                  onChange={(e) => setDraft((d) => ({ ...d, prioritaire: e.target.checked }))}
                />
                Moment prioritaire
              </label>
              {formErrors.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-200">
                  {formErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={addShot} disabled={busy} className={BTN}>
                {busy ? "Ajout…" : "Ajouter le plan"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Le board RÉEL (présentationnel). buildShotLines/groupByVenue/summarizeCaptation calculent l'état ;
          canCaptureShot garde les boutons d'avancement. Aucune règle dupliquée ici. */}
      {loading ? (
        <div className="text-center text-sm text-white/40">Chargement…</div>
      ) : (
        <CaptationBoard
          items={items}
          captures={captures}
          exploitationDate={exploitationDate}
          role={role}
          onSetStatus={onSetStatus}
        />
      )}
    </div>
  );
}
