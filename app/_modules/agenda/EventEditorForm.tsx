"use client";

// app/_modules/agenda/EventEditorForm.tsx — éditeur de soirée (création/édition), présentationnel & props-driven.
// Formulaire CONTRÔLÉ : reçoit `value` + `onChange` (patch) + `onSubmit`/`onCancel`. Ne fetch rien, n'appelle
// aucun Supabase : le conteneur (page.tsx, onglet agenda) branche create_event_v1 / update_event_v1 (0054).
// La validation métier réelle vit côté RPC (RLS/SECURITY DEFINER) ; ici on ne fait qu'un pré-contrôle UX.

import { EVENT_STATUSES, validateEventDraft } from "@/lib/eventManagement";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const LABEL = "text-[10px] font-bold uppercase tracking-wide text-white/40";
const BTN = "rounded-xl bg-fuchsia-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const BTN_GHOST = "rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white/70 hover:bg-white/10";

export type VenueOption = { id: string; name: string };

// Valeur du formulaire (tous champs chaînes pour la saisie ; capacité/équipe convertis par le conteneur).
export type EventFormValue = {
  title: string;
  venue_id: string;
  event_date: string; // YYYY-MM-DD
  status: string;
  artistes: string;
  horaire_debut: string;
  horaire_fin: string;
  espace: string;
  capacite: string; // saisie libre → entier côté conteneur
  equipe: string; // texte libre (ex. noms séparés par virgule) → jsonb côté conteneur
  notes: string;
};

export type EventEditorFormProps = {
  mode: "create" | "edit";
  value: EventFormValue;
  venues: VenueOption[];
  onChange: (patch: Partial<EventFormValue>) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  onDelete?: () => void; // annuler la soirée (cancel_event_v1) — édition seulement
  submitting?: boolean;
  error?: string | null;
};

// À la création, seuls draft/published sont proposés (miroir de create_event_v1). En édition, tout le
// vocabulaire est offert ; les transitions interdites sont refusées côté RPC (garde 0054).
const CREATE_STATUSES = ["draft", "published"] as const;

export default function EventEditorForm({
  mode,
  value,
  venues,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
  submitting = false,
  error = null,
}: EventEditorFormProps) {
  const capaciteNum = value.capacite.trim() === "" ? null : Number(value.capacite);
  const check = validateEventDraft({
    title: value.title,
    event_date: value.event_date,
    status: value.status || null,
    capacite: capaciteNum,
    horaire_debut: value.horaire_debut || null,
    horaire_fin: value.horaire_fin || null,
  });
  const statuses = mode === "create" ? CREATE_STATUSES : EVENT_STATUSES;

  return (
    <div className={`${CARD} space-y-3`}>
      <div className="text-xs font-bold uppercase text-white/50">
        {mode === "create" ? "Nouvelle soirée" : "Modifier la soirée"}
      </div>

      <div className="space-y-1">
        <label className={LABEL}>Titre</label>
        <input
          className={INPUT}
          placeholder="Ex. Techno All Night"
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className={LABEL}>Univers</label>
          <select className={INPUT} value={value.venue_id} onChange={(e) => onChange({ venue_id: e.target.value })}>
            <option value="">—</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={LABEL}>Date</label>
          <input
            className={INPUT}
            type="date"
            value={value.event_date}
            onChange={(e) => onChange({ event_date: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className={LABEL}>Début</label>
          <input
            className={INPUT}
            inputMode="numeric"
            placeholder="23:30"
            value={value.horaire_debut}
            onChange={(e) => onChange({ horaire_debut: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className={LABEL}>Fin</label>
          <input
            className={INPUT}
            inputMode="numeric"
            placeholder="05:00"
            value={value.horaire_fin}
            onChange={(e) => onChange({ horaire_fin: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className={LABEL}>Espace</label>
          <input
            className={INPUT}
            placeholder="Ex. Rooftop / Cave"
            value={value.espace}
            onChange={(e) => onChange({ espace: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className={LABEL}>Capacité</label>
          <input
            className={INPUT}
            inputMode="numeric"
            placeholder="Ex. 400"
            value={value.capacite}
            onChange={(e) => onChange({ capacite: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className={LABEL}>Artistes / Programmation</label>
        <input
          className={INPUT}
          placeholder="DJ, lineup, guest…"
          value={value.artistes}
          onChange={(e) => onChange({ artistes: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <label className={LABEL}>Équipe</label>
        <input
          className={INPUT}
          placeholder="Noms (séparés par des virgules)"
          value={value.equipe}
          onChange={(e) => onChange({ equipe: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <label className={LABEL}>Statut</label>
        <select className={INPUT} value={value.status} onChange={(e) => onChange({ status: e.target.value })}>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className={LABEL}>Notes</label>
        <textarea
          className={`${INPUT} min-h-[60px]`}
          placeholder="Notes de planification (interne)"
          value={value.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>

      {!check.ok && <div className="text-xs font-bold text-amber-300">{check.message}</div>}
      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={onSubmit} disabled={submitting || !check.ok}>
          {mode === "create" ? "Créer la soirée" : "Enregistrer"}
        </button>
        {onCancel && (
          <button type="button" className={BTN_GHOST} onClick={onCancel} disabled={submitting}>
            Annuler
          </button>
        )}
        {mode === "edit" && onDelete && (
          <button
            type="button"
            className="ml-auto rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200 hover:bg-red-500/20 disabled:opacity-40"
            onClick={onDelete}
            disabled={submitting}
          >
            Annuler la soirée
          </button>
        )}
      </div>
    </div>
  );
}
