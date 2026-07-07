"use client";

// components/ArtistFichesView.tsx — écran Fiches artistes (module C5, migration 0069), présentationnel.
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. Il reçoit le répertoire (artists), les soirées
// (events) et les rattachements (links) déjà chargés par le parent, et remonte toute écriture via des
// callbacks. Les inserts/updates réels sont faits par le parent en DML direct sous RLS 0069
// (direction-only) — ce composant n'accorde AUCUN droit : si le rôle n'est pas direction (matrice C5),
// le formulaire n'est simplement pas rendu (miroir UI ; la RLS reste l'autorité).
//
// Rien n'est inventé : états vides HONNÊTES, cachet « à confirmer » quand il n'est pas fixé, et le tri
// (actifs d'abord) vient des vraies lignes via lib/artists.ts (logique PURE, testée).

import { useMemo, useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  artistStatusLabel,
  canViewArtists,
  formatFee,
  sortArtists,
  summarizeArtists,
  validateArtistDraft,
  type Artist,
  type ArtistDraft,
  type ArtistEventLink,
} from "@/lib/artists";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT =
  "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const BTN_GHOST = "rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white disabled:opacity-40";

// État local du formulaire : tout en chaînes (saisie), le cachet en EUROS côté UI (converti en centimes
// à la soumission). Aucune de ces valeurs n'est une donnée serveur — c'est de l'état de saisie pur.
type FormState = {
  stage_name: string;
  legal_name: string;
  email: string;
  phone: string;
  style: string;
  feeEuros: string; // cachet en euros saisi ("" = à confirmer)
  tech_requirements: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  stage_name: "",
  legal_name: "",
  email: "",
  phone: "",
  style: "",
  feeEuros: "",
  tech_requirements: "",
  notes: "",
};

// Pré-remplit le formulaire depuis une fiche existante (édition). Cachet : centimes → euros affichés.
function formFromArtist(a: Artist): FormState {
  return {
    stage_name: a.stage_name,
    legal_name: a.legal_name ?? "",
    email: a.email ?? "",
    phone: a.phone ?? "",
    style: a.style ?? "",
    feeEuros: a.fee_cents === null ? "" : String(a.fee_cents / 100),
    tech_requirements: a.tech_requirements ?? "",
    notes: a.notes ?? "",
  };
}

// Convertit un cachet saisi en euros vers des centimes (entier). "" ou saisie vide → null (à confirmer).
// NaN → NaN (laissé à validateArtistDraft pour rejet propre : Number.isInteger(NaN) === false).
function eurosToCents(feeEuros: string): number | null {
  const trimmed = feeEuros.trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(",", ".");
  const euros = Number(normalized);
  if (!Number.isFinite(euros)) return NaN;
  return Math.round(euros * 100);
}

// Construit le brouillon métier depuis l'état de saisie. Les champs vides deviennent null (jamais "").
function draftFromForm(form: FormState): ArtistDraft {
  const clean = (s: string): string | null => (s.trim() === "" ? null : s.trim());
  return {
    stage_name: form.stage_name.trim(),
    legal_name: clean(form.legal_name),
    email: clean(form.email),
    phone: clean(form.phone),
    style: clean(form.style),
    fee_cents: eurosToCents(form.feeEuros),
    tech_requirements: clean(form.tech_requirements),
    notes: clean(form.notes),
  };
}

export default function ArtistFichesView({
  role,
  artists,
  events,
  links,
  onCreate,
  onUpdate,
  onArchive,
  onUnarchive,
  onLinkEvent,
  onUnlinkEvent,
}: {
  role: StaffRole;
  artists: Artist[];
  events: { id: string; label: string }[];
  links: ArtistEventLink[];
  onCreate: (draft: ArtistDraft) => void | Promise<void>;
  onUpdate: (id: string, draft: ArtistDraft) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onLinkEvent: (artistId: string, eventId: string, slotLabel: string) => void;
  onUnlinkEvent: (linkId: string) => void;
}) {
  const canView = canViewArtists(role);

  // État de saisie / d'édition (UI pur, aucun réseau).
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Fiche sélectionnée pour le rattachement aux soirées.
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [linkEventId, setLinkEventId] = useState<string>("");
  const [linkSlot, setLinkSlot] = useState<string>("");

  const sorted = useMemo(() => sortArtists(artists), [artists]);
  const summary = useMemo(() => summarizeArtists(artists), [artists]);

  // Liens de la fiche sélectionnée (historique de ses soirées). Aucun lien fabriqué.
  const selectedLinks = useMemo(
    () => links.filter((l) => l.artist_id === selectedArtistId),
    [links, selectedArtistId],
  );

  // Libellé lisible d'une soirée (fallback sur l'id si la soirée n'est plus dans la liste fournie).
  const eventLabel = (id: string) => events.find((e) => e.id === id)?.label ?? id;

  // Rôle sans accès (tout sauf direction) : miroir honnête de la RLS 0069, aucun formulaire.
  if (!canView) {
    return (
      <div className="space-y-3 pb-4 text-white" data-testid="artist-fiches">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-sm text-white/50">
          Les fiches artistes sont réservées à la direction.
        </div>
      </div>
    );
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors([]);
    setFormOpen(true);
  }

  function openEdit(a: Artist) {
    setEditingId(a.id);
    setForm(formFromArtist(a));
    setErrors([]);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors([]);
  }

  async function submit() {
    const draft = draftFromForm(form);
    const check = validateArtistDraft(draft, role);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      if (editingId) {
        onUpdate(editingId, draft);
      } else {
        await onCreate(draft);
      }
      closeForm();
    } finally {
      setBusy(false);
    }
  }

  function submitLink() {
    if (!selectedArtistId || linkEventId === "") return;
    onLinkEvent(selectedArtistId, linkEventId, linkSlot.trim());
    setLinkSlot("");
  }

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-3 pb-4 text-white" data-testid="artist-fiches">
      {/* Résumé (états vides honnêtes) */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black" data-testid="artist-total">{summary.total}</div>
          <div className="text-[10px] uppercase text-white/50">Artistes</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-emerald-300">{summary.actifs}</div>
          <div className="text-[10px] uppercase text-white/50">Actifs</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-white/40">{summary.archives}</div>
          <div className="text-[10px] uppercase text-white/50">Archivés</div>
        </div>
      </div>

      {/* Barre d'action : ouvrir le formulaire de création */}
      {!formOpen && (
        <button type="button" className={BTN + " w-full"} onClick={openCreate} data-testid="artist-create-btn">
          + Nouvelle fiche artiste
        </button>
      )}

      {/* Formulaire de création / édition */}
      {formOpen && (
        <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3" data-testid="artist-form">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-white/50">
              {editingId ? "Modifier la fiche" : "Nouvelle fiche artiste"}
            </p>
            <button type="button" className="text-xs text-white/50" onClick={closeForm} data-testid="artist-cancel-btn">
              Annuler
            </button>
          </div>

          <input
            className={INPUT}
            placeholder="Nom de scène (requis)"
            value={form.stage_name}
            onChange={(e) => set({ stage_name: e.target.value })}
            data-testid="artist-stage-name-input"
          />
          <input
            className={INPUT}
            placeholder="Nom civil"
            value={form.legal_name}
            onChange={(e) => set({ legal_name: e.target.value })}
            data-testid="artist-legal-name-input"
          />
          <div className="flex gap-2">
            <input
              className={INPUT}
              placeholder="Email"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
              data-testid="artist-email-input"
            />
            <input
              className={INPUT}
              placeholder="Téléphone"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
              data-testid="artist-phone-input"
            />
          </div>
          <div className="flex gap-2">
            <input
              className={INPUT}
              placeholder="Style (ex. techno, house)"
              value={form.style}
              onChange={(e) => set({ style: e.target.value })}
              data-testid="artist-style-input"
            />
            <input
              className={INPUT}
              inputMode="decimal"
              placeholder="Cachet en € (vide = à confirmer)"
              value={form.feeEuros}
              onChange={(e) => set({ feeEuros: e.target.value })}
              data-testid="artist-fee-input"
            />
          </div>
          <textarea
            className={INPUT}
            rows={2}
            placeholder="Contraintes techniques (rider, matériel…)"
            value={form.tech_requirements}
            onChange={(e) => set({ tech_requirements: e.target.value })}
            data-testid="artist-tech-input"
          />
          <textarea
            className={INPUT}
            rows={2}
            placeholder="Notes internes"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            data-testid="artist-notes-input"
          />

          {errors.length > 0 && (
            <ul className="text-xs text-rose-300" data-testid="artist-form-errors">
              {errors.map((err) => (
                <li key={err}>• {err}</li>
              ))}
            </ul>
          )}

          <button type="button" disabled={busy} className={BTN + " w-full"} onClick={submit} data-testid="artist-submit">
            {editingId ? "Enregistrer les modifications" : "Créer la fiche"}
          </button>
        </div>
      )}

      {/* Répertoire trié (actifs d'abord) */}
      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Répertoire</div>
        {sorted.length === 0 ? (
          <div className="text-center text-sm text-white/40" data-testid="artist-empty">
            Aucune fiche artiste. Rien n&apos;est pré-rempli ; les fiches se créent ici.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="artist-list">
            {sorted.map((a) => {
              const archived = a.status === "archived";
              const selected = a.id === selectedArtistId;
              return (
                <li key={a.id} className={CARD} data-testid="artist-row" data-artist-id={a.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-black" data-testid="artist-name">{a.stage_name}</span>
                        {archived && (
                          <span
                            className="shrink-0 rounded-lg bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase text-white/50"
                            data-testid="artist-archived-badge"
                          >
                            {artistStatusLabel(a.status)}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/50">
                        {a.style ? `${a.style} · ` : ""}
                        cachet <b className="text-white/70" data-testid="artist-fee">{formatFee(a.fee_cents)}</b>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        className="rounded-lg border border-white/15 px-2 py-1 text-[11px] font-bold text-white/70"
                        onClick={() => openEdit(a)}
                        data-testid="artist-edit-btn"
                      >
                        Modifier
                      </button>
                      {archived ? (
                        <button
                          type="button"
                          className="rounded-lg border border-white/15 px-2 py-1 text-[11px] font-bold text-emerald-200"
                          onClick={() => onUnarchive(a.id)}
                          data-testid="artist-unarchive-btn"
                        >
                          Désarchiver
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded-lg border border-white/15 px-2 py-1 text-[11px] font-bold text-red-200"
                          onClick={() => onArchive(a.id)}
                          data-testid="artist-archive-btn"
                        >
                          Archiver
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded-lg border border-white/15 px-2 py-1 text-[11px] font-bold text-sky-200"
                        onClick={() => setSelectedArtistId(selected ? null : a.id)}
                        data-testid="artist-select-btn"
                      >
                        {selected ? "Fermer soirées" : "Soirées"}
                      </button>
                    </div>
                  </div>

                  {/* Rattachement aux soirées (historique) — replié sous la fiche sélectionnée */}
                  {selected && (
                    <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/20 p-2" data-testid="artist-links-panel">
                      <div className="text-[10px] uppercase tracking-wide text-white/40">
                        Rattacher à une soirée
                      </div>
                      <div className="flex gap-2">
                        <select
                          className={INPUT}
                          value={linkEventId}
                          onChange={(e) => setLinkEventId(e.target.value)}
                          data-testid="artist-link-event-select"
                        >
                          <option value="">Choisir une soirée…</option>
                          {events.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                              {ev.label}
                            </option>
                          ))}
                        </select>
                        <input
                          className={INPUT}
                          placeholder="Créneau (ex. 00h-02h)"
                          value={linkSlot}
                          onChange={(e) => setLinkSlot(e.target.value)}
                          data-testid="artist-link-slot-input"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={linkEventId === "" || events.length === 0}
                        className={BTN_GHOST + " w-full"}
                        onClick={submitLink}
                        data-testid="artist-link-event-btn"
                      >
                        Rattacher à la soirée
                      </button>

                      {selectedLinks.length === 0 ? (
                        <div className="text-center text-[11px] text-white/40" data-testid="artist-links-empty">
                          Aucune soirée rattachée.
                        </div>
                      ) : (
                        <ul className="space-y-1" data-testid="artist-links-list">
                          {selectedLinks.map((l) => (
                            <li
                              key={l.id}
                              className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1 text-[11px]"
                              data-testid="artist-link-row"
                            >
                              <span className="min-w-0 truncate text-white/70">
                                {eventLabel(l.event_id)}
                                {l.slot_label ? ` · ${l.slot_label}` : ""}
                                {l.fee_cents_override !== null ? ` · ${formatFee(l.fee_cents_override)}` : ""}
                              </span>
                              <button
                                type="button"
                                className="shrink-0 text-red-200"
                                onClick={() => onUnlinkEvent(l.id)}
                                data-testid="artist-unlink-btn"
                              >
                                Retirer
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
