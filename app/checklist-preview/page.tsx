"use client";

// app/checklist-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (CHECKLISTS OUVERTURE/FERMETURE, A9).
//
// Raison d'être : les composants ChecklistBoard (tableau des listes de vérification) et
// ChecklistItemComposer (composition d'un item, direction seule) et leur logique PURE
// (lib/checklists — fusion items/coches, groupage phase→catégorie, avancement, gardes de rôle A9)
// étaient construits et testés mais n'étaient montés NULLE PART (comme l'étaient FloorPlan S51,
// VenueTableEditor S52, le flux résa S53, la call-list S54, le scan porte S55, le cockpit Mode Soirée
// S56 avant leur aperçu). Cette page câble les composants RÉELS à des données FICTIVES étiquetées, pour
// que le fondateur voie la checklist tourner : avancement par phase, cochage, composition d'items — et,
// surtout, le CADRAGE DE RÔLE (miroir de la RLS 0028 : le promoteur n'a pas de checklist ; un serveur ne
// voit et ne coche que ses items ; seule la direction compose le modèle).
//
// Périmètre volontairement étroit et SÛR (même discipline que /mode-soiree-preview, /scan-porte-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les données sont un JEU DE DÉMONSTRATION en mémoire. En réel,
//     app/page.tsx charge items + coches via des requêtes déjà filtrées par la RLS 0028 et fait les
//     écritures (insert item / coche) sous RLS. Ici, cocher/composer ne touche qu'un ÉTAT LOCAL simulé qui
//     miroite checklist_completions/checklist_items côté serveur — JAMAIS une sécurité, JAMAIS une écriture ;
//   · les composants NE DUPLIQUENT AUCUNE règle : le board appelle buildLines/linesForPoste/canCompleteItem,
//     le composer appelle validateItemDraft/canManageChecklistItems (les MÊMES fonctions que la production).
//     Changer le rôle rejoue exactement le cadrage réel — c'est ce qui rend la démo honnête ;
//   · toutes les lignes sont des FICTIONS de démonstration (libellés « (démo) », auteurs « démo », dates de
//     banc fixes). AUCUN vrai item de checklist, AUCUN vrai staff n'est lu ni inventé en base ;
//   · AUCUNE écriture, AUCUN envoi, AUCUNE mise en ligne.

import { useMemo, useRef, useState } from "react";

import ChecklistBoard from "@/components/ChecklistBoard";
import ChecklistItemComposer from "@/components/ChecklistItemComposer";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import {
  canManageChecklistItems,
  canViewChecklists,
  summarizeChecklist,
  buildLines,
  linesForPoste,
  type ChecklistCompletion,
  type ChecklistItem,
  type ChecklistItemDraft,
} from "@/lib/checklists";

// ————————————————————————————————————————————————————————————————
// Repères de banc STABLES (aucun new Date() → aucun décalage de fuseau, valeurs figées de démonstration).
// L'utilisateur courant du banc est « sofia (démo) » ; certains items sont assignés au poste server pour
// montrer que sofia-serveur ne voit et ne coche QUE ses items (le cantonnement A9 « par poste »).
// ————————————————————————————————————————————————————————————————
const REF_DATE = "2026-07-07";
const TS = "2026-07-07T20:00:00.000Z";
const VIEWER = "sofia"; // « moi » du banc (username courant)

function item(
  over: Partial<ChecklistItem> &
    Pick<ChecklistItem, "id" | "phase" | "category" | "label">,
): ChecklistItem {
  return {
    venue: "eden",
    poste: null,
    position: 0,
    active: true,
    auteur_username: "manager-demo",
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

// Modèle de checklist FICTIF couvrant les deux phases, plusieurs catégories et plusieurs postes, pour
// rendre visible le cadrage : un item « poste server » est masqué à la sécurité/au compteur ; un item
// sans poste est vu (et cochable) par tous les rôles opérationnels.
const DEMO_ITEMS: ChecklistItem[] = [
  item({ id: "cl-1", phase: "ouverture", category: "secu", label: "Issues de secours dégagées (démo)", position: 0 }),
  item({ id: "cl-2", phase: "ouverture", category: "issues", label: "Extincteurs en place et scellés (démo)", position: 1 }),
  item({ id: "cl-3", phase: "ouverture", category: "caisse", label: "Fond de caisse compté (démo)", poste: "server", position: 0 }),
  item({ id: "cl-4", phase: "ouverture", category: "son", label: "Balance son validée avec le DJ (démo)", position: 0 }),
  item({ id: "cl-5", phase: "fermeture", category: "caisse", label: "Clôture caisse / ticket Z (démo)", poste: "server", position: 0 }),
  item({ id: "cl-6", phase: "fermeture", category: "nettoyage", label: "Nettoyage sol + bar (démo)", position: 0 }),
];

// Coche initiale FICTIVE : seul « Issues de secours » est déjà fait à l'ouverture.
const INITIAL_DONE = new Set<string>(["cl-1"]);

// ————————————————————————————————————————————————————————————————
// Ce que chaque rôle est censé voir/faire (repère de lecture pour le fondateur — dérivé de la matrice A9
// §3.1, PAS une seconde source de vérité : le board réel est calculé par lib/checklists ci-dessous).
// ————————————————————————————————————————————————————————————————
const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Compteur (flux)",
  promoter: "Promoteur",
};

function roleExpectation(role: StaffRole): string {
  if (!canViewChecklists(role)) return "Aucune checklist (promoteur exclu — pas de poste d'ouverture/fermeture).";
  const parts: string[] = [];
  parts.push(
    role === "admin" || role === "manager"
      ? "Voit tous les items"
      : "Voit ses items (sans poste + son poste)",
  );
  parts.push(
    canManageChecklistItems(role) ? "Compose le modèle" : "Ne compose pas (coche seulement)",
  );
  return parts.join(" · ");
}

export default function ChecklistPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  // État LOCAL simulé (miroir client de checklist_items / checklist_completions — aucune écriture réelle).
  const [items, setItems] = useState<ChecklistItem[]>(DEMO_ITEMS);
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set(INITIAL_DONE));
  // Compteur déterministe pour les id d'items ajoutés (aucun Math.random, aucun new Date()).
  const addedCount = useRef(0);

  // Les coches de la soirée, reconstruites à partir du Set simulé (miroir de checklist_completions).
  const completions = useMemo<ChecklistCompletion[]>(
    () =>
      [...doneIds].map((itemId) => ({
        id: `comp-${itemId}`,
        item_id: itemId,
        event_id: null,
        exploitation_date: REF_DATE,
        note: null,
        done_by: VIEWER,
        done_at: TS,
      })),
    [doneIds],
  );

  // onToggle simulé : coche/décoche dans le Set local. Le board a DÉJÀ vérifié canCompleteItem avant
  // d'afficher le bouton (aucune règle dupliquée ici) ; ce simulateur ne fait que refléter l'écriture.
  async function handleToggle(itemId: string, done: boolean): Promise<void> {
    setDoneIds((prev) => {
      const next = new Set(prev);
      if (done) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  // onSubmit simulé : le composer a DÉJÀ validé le brouillon (validateItemDraft) et n'est rendu que pour la
  // direction (canManageChecklistItems). Ce simulateur ajoute l'item à l'état local avec des champs serveur
  // fabriqués de façon déterministe (id incrémental, dates de banc) — aucune écriture réelle.
  async function handleAddItem(draft: ChecklistItemDraft): Promise<void> {
    addedCount.current += 1;
    const newItem = item({
      id: `cl-new-${addedCount.current}`,
      // Le composer ne remet que du vocabulaire fermé validé ; on le recopie tel quel.
      phase: draft.phase as ChecklistItem["phase"],
      category: draft.category as ChecklistItem["category"],
      poste: (draft.poste ?? null) as ChecklistItem["poste"],
      label: `${draft.label} (démo)`,
      position: 90 + addedCount.current,
      auteur_username: `${role}-demo`,
    });
    setItems((prev) => [...prev, newItem]);
  }

  function reset() {
    setItems(DEMO_ITEMS);
    setDoneIds(new Set(INITIAL_DONE));
    addedCount.current = 0;
  }

  // Récap honnête : ce que ce rôle voit réellement (calculé par les MÊMES fonctions que la production).
  const recap = useMemo(() => {
    const allLines = buildLines(items, completions, REF_DATE);
    const visible = linesForPoste(allLines, role);
    return summarizeChecklist(visible);
  }, [items, completions, role]);

  const viewable = canViewChecklists(role);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai item de checklist, aucun vrai staff. En réel, <code>app/page.tsx</code> charge items +
          coches déjà filtrés par la RLS (<code>0028</code>) et fait les écritures sous RLS. Ici, cocher et
          composer ne touchent qu&apos;un <strong>état local simulé</strong> ; le board et le composer sont
          calculés par les MÊMES fonctions que la production (<code>buildLines</code>,{" "}
          <code>canCompleteItem</code>, <code>validateItemDraft</code>). Changer le rôle rejoue exactement le
          cadrage réel. Ce banc n&apos;exerce que la présentation, JAMAIS une sécurité.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Checklists ouverture / fermeture (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Listes de vérification par phase, catégorie et poste (A9). Avancement dérivé UNIQUEMENT des items
          et coches reçus (états vides honnêtes : aucun item → des zéros, jamais une ligne fabriquée).
        </p>
      </header>

      {/* Sélecteur de rôle : démontre le cadrage (miroir de la RLS 0028), pas une sécurité applicative. */}
      <section className="mb-5">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
          Rôle du spectateur (même donnée, cadrage différent)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                  selected
                    ? "border-sky-400/60 bg-sky-500/20 text-sky-100"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
                }`}
              >
                {ROLE_LABEL[r]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-white/40">
          Vu comme <code>{VIEWER}</code> · rôle <code>{role}</code> ·{" "}
          {viewable ? "checklist accessible" : "checklist fermée"} — attendu : {roleExpectation(role)}
        </p>
      </section>

      {viewable ? (
        <>
          {/* Le composant RÉEL de composition — n'apparaît que pour la direction (canManageChecklistItems). */}
          <section className="mb-5">
            <ChecklistItemComposer role={role} onSubmit={handleAddItem} />
            {!canManageChecklistItems(role) && (
              <p className="text-[11px] text-white/40">
                Composition masquée pour ce rôle (seule la direction compose le modèle A9).
              </p>
            )}
          </section>

          {/* Le board RÉEL, alimenté par l'état local simulé. */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
            <ChecklistBoard
              items={items}
              completions={completions}
              exploitationDate={REF_DATE}
              role={role}
              onToggle={handleToggle}
            />
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Onglet Checklists non disponible pour ce rôle. Le promoteur n&apos;a pas de poste
          d&apos;ouverture/fermeture (exclu comme pour incidents 0023 et comm interne 0026).
        </section>
      )}

      {/* Récapitulatif honnête de l'avancement visible pour ce rôle. */}
      <section className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[12px] text-white/60">
        <span>
          Items visibles : <span className="text-white/80">{recap.total}</span>
        </span>
        <span>
          Faits : <span className="text-white/80">{recap.done}</span> · reste :{" "}
          <span className="text-white/80">{recap.remaining}</span>
        </span>
        {recap.complete && <span className="text-emerald-300">Tout est fait ✓</span>}
        <button
          type="button"
          onClick={reset}
          className="ml-auto rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70 hover:text-white"
        >
          Réinitialiser le banc
        </button>
      </section>
    </main>
  );
}
