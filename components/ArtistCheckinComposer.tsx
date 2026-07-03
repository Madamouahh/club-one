"use client";

// components/ArtistCheckinComposer.tsx — création d'une fiche d'accueil ARTIST CHECK-IN (A8).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. Il prépare un brouillon (nom de scène, créneau,
// accompagnants, loge, contact, rider, matériel) et le remet au parent via `onSubmit`. L'insert réel
// est fait par le parent sous RLS 0027 — ce composant n'accorde AUCUN droit : si le rôle ne peut pas
// gérer l'accueil artiste (matrice A8), le formulaire n'est simplement pas rendu (miroir UI ; la RLS
// reste l'autorité). Rien n'est inventé : le module ship VIDE, l'équipe saisit un artiste réel.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  canManageArtistCheckin,
  validateCheckinDraft,
  type CheckinDraft,
} from "@/lib/artistCheckin";

export default function ArtistCheckinComposer({
  role,
  exploitationDate,
  eventId,
  onSubmit,
}: {
  role: StaffRole;
  exploitationDate: string;
  eventId: string | null;
  onSubmit: (draft: CheckinDraft) => Promise<void>;
}) {
  const [artistName, setArtistName] = useState("");
  const [slot, setSlot] = useState("");
  const [companions, setCompanions] = useState("0");
  const [dressingRoom, setDressingRoom] = useState("");
  const [contact, setContact] = useState("");
  const [rider, setRider] = useState("");
  const [material, setMaterial] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Le rôle ne peut pas gérer l'accueil artiste → aucun formulaire (miroir de canManageArtistCheckin).
  if (!canManageArtistCheckin(role)) return null;

  function buildDraft(): CheckinDraft {
    const n = Number(companions);
    return {
      exploitation_date: exploitationDate,
      artist_name: artistName,
      companions: Number.isFinite(n) ? n : NaN, // NaN → refusé par la validation (entier ≥ 0)
      slot_label: slot.trim() === "" ? null : slot.trim(),
      dressing_room: dressingRoom.trim() === "" ? null : dressingRoom.trim(),
      contact: contact.trim() === "" ? null : contact.trim(),
      rider_notes: rider.trim() === "" ? null : rider.trim(),
      material_notes: material.trim() === "" ? null : material.trim(),
      event_id: eventId,
    };
  }

  async function submit() {
    const draft = buildDraft();
    const check = validateCheckinDraft(draft, role);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      await onSubmit(draft);
      setArtistName("");
      setSlot("");
      setCompanions("0");
      setDressingRoom("");
      setContact("");
      setRider("");
      setMaterial("");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/30";

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs uppercase tracking-wide text-white/50">Accueil artiste</p>

      <input
        className={field}
        placeholder="Nom de scène"
        value={artistName}
        onChange={(e) => setArtistName(e.target.value)}
      />

      <div className="flex gap-2">
        <input
          className={field}
          placeholder="Créneau (ex. 01h-03h)"
          value={slot}
          onChange={(e) => setSlot(e.target.value)}
        />
        <input
          className={field + " max-w-[8rem]"}
          type="number"
          min={0}
          step={1}
          placeholder="Accomp."
          value={companions}
          onChange={(e) => setCompanions(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <input
          className={field}
          placeholder="Loge"
          value={dressingRoom}
          onChange={(e) => setDressingRoom(e.target.value)}
        />
        <input
          className={field}
          placeholder="Contact du soir"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </div>

      <textarea
        className={field}
        placeholder="Rider / hospitality"
        rows={2}
        value={rider}
        onChange={(e) => setRider(e.target.value)}
      />
      <textarea
        className={field}
        placeholder="Matériel / besoins techniques"
        rows={2}
        value={material}
        onChange={(e) => setMaterial(e.target.value)}
      />

      {errors.length > 0 && (
        <ul className="text-xs text-rose-300">
          {errors.map((err) => (
            <li key={err}>• {err}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-40"
      >
        Enregistrer la fiche
      </button>
    </div>
  );
}
