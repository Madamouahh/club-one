"use client";

// components/ChecklistItemComposer.tsx — composition d'un item de checklist (A9), direction seulement.
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. Il prépare un brouillon d'item (phase, catégorie,
// poste assigné, libellé) et le remet au parent via `onSubmit`. L'insert réel est fait par le parent sous
// RLS 0028 — ce composant n'accorde AUCUN droit : si le rôle ne peut pas composer la checklist (matrice
// A9 : direction seule), le formulaire n'est simplement pas rendu (miroir UI ; la RLS reste l'autorité).
//
// Le module ship VIDE : aucun item de contenu n'est pré-rempli ici. Seules les CATÉGORIES et PHASES
// (vocabulaire fermé du master §2) sont proposées ; le libellé est saisi par le manager au runtime.

import { useState } from "react";
import type { StaffRole } from "@/lib/permissions";
import {
  CHECKLIST_CATEGORIES,
  CHECKLIST_PHASES,
  CHECKLIST_ROLES,
  canManageChecklistItems,
  categoryLabel,
  phaseLabel,
  validateItemDraft,
  type ChecklistItemDraft,
} from "@/lib/checklists";

export default function ChecklistItemComposer({
  role,
  onSubmit,
}: {
  role: StaffRole;
  onSubmit: (draft: ChecklistItemDraft) => Promise<void>;
}) {
  const [phase, setPhase] = useState<string>(CHECKLIST_PHASES[0]);
  const [category, setCategory] = useState<string>(CHECKLIST_CATEGORIES[0]);
  const [poste, setPoste] = useState<string>(""); // "" = tous les postes
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Le rôle ne peut pas composer la checklist → aucun formulaire (miroir de canManageChecklistItems).
  if (!canManageChecklistItems(role)) return null;

  function buildDraft(): ChecklistItemDraft {
    return {
      phase,
      category,
      label,
      poste: poste === "" ? null : poste,
    };
  }

  async function submit() {
    const draft = buildDraft();
    const check = validateItemDraft(draft, role);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      await onSubmit(draft);
      setLabel("");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/30";

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs uppercase tracking-wide text-white/50">Composer un item de checklist</p>

      <div className="flex flex-wrap gap-2">
        <select className={field} value={phase} onChange={(e) => setPhase(e.target.value)}>
          {CHECKLIST_PHASES.map((p) => (
            <option key={p} value={p}>
              {phaseLabel(p)}
            </option>
          ))}
        </select>
        <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CHECKLIST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <select className={field} value={poste} onChange={(e) => setPoste(e.target.value)}>
          <option value="">Tous les postes</option>
          {CHECKLIST_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <input
        className={field + " w-full"}
        placeholder="Libellé de l'item (ex. « Vérifier les extincteurs »)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
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
        Ajouter l’item
      </button>
    </div>
  );
}
