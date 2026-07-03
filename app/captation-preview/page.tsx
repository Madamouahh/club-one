"use client";

// app/captation-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (CAPTATION / SHOT LIST, A10).
//
// Raison d'être : le composant CaptationBoard (shot list de captation photo/vidéo de la soirée : plans
// groupés par univers, statut « à capturer → capturé → déposé au DAM », avancement) et sa logique PURE
// (lib/captation — fusion plans + captures, groupage par univers, comptes par statut, résumé, gardes de
// rôle A10) étaient construits et testés (test:captation 25/25) mais n'étaient montés NULLE PART. C'était
// le DERNIER composant orphelin : FloorPlan (S51), VenueTableEditor (S52), flux résa (S53), call-list
// (S54), scan porte (S55), cockpit Mode Soirée (S56), checklists (S57), accueil artiste (S58) et
// communication interne (S59) avaient déjà leur aperçu isolé. Cette page câble le composant RÉEL à des
// données FICTIVES étiquetées, pour que le fondateur voie la shot list tourner : avancement d'un plan
// (à capturer → capturé → déposé), progression, groupage par univers — et, surtout, le CADRAGE DE RÔLE
// (miroir de la RLS 0029 : seule la DIRECTION — admin/manager, la « créa » dans le socle — voit et fait
// avancer la captation ; serveur / sécurité / compteur / promoteur = AUCUN accès).
//
// Périmètre volontairement étroit et SÛR (même discipline que /internal-comm-preview, /artist-checkin-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les données sont un JEU DE DÉMONSTRATION en mémoire. En réel,
//     app/page.tsx charge les plans/captures via des requêtes déjà filtrées par la RLS 0029 et fait les
//     écritures (upsert du statut de capture) sous RLS. Ici, faire avancer un plan ne touche qu'un ÉTAT
//     LOCAL simulé qui miroite shot_captures côté serveur — JAMAIS une sécurité, JAMAIS une écriture ;
//   · le composant NE DUPLIQUE AUCUNE règle : le board appelle buildShotLines / groupByVenue /
//     summarizeCaptation / canCaptureShot / canViewCaptation (les MÊMES fonctions que la production).
//     Changer le rôle rejoue exactement le cadrage réel — c'est ce qui rend la démo honnête ;
//   · tous les plans sont des FICTIONS de démonstration (libellés « (démo) », auteur « -demo », dates de
//     banc fixes). AUCUN vrai plan de captation, AUCUNE vraie shot list n'est lue ni inventée en base — le
//     module ship VIDE en production (la vraie shot list reste en attente du fondateur, A10) ;
//   · AUCUNE écriture, AUCUN envoi, AUCUNE mise en ligne.

import { useRef, useState } from "react";

import CaptationBoard from "@/components/CaptationBoard";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import {
  canManageShotList,
  canViewCaptation,
  type CaptationStatus,
  type ShotCapture,
  type ShotListItem,
} from "@/lib/captation";

// ————————————————————————————————————————————————————————————————
// Repères de banc STABLES (aucun new Date() → aucun décalage de fuseau, valeurs figées de démonstration).
// ————————————————————————————————————————————————————————————————
const REF_DATE = "2026-07-07";
const TS = "2026-07-07T20:00:00.000Z";

// Identité de banc de la direction (pour l'auteur simulé d'une mise à jour de capture). AUCUN vrai staff.
const DEMO_DIRECTION = "manager-demo";

function item(
  over: Partial<ShotListItem> &
    Pick<ShotListItem, "id" | "label" | "venue" | "position">,
): ShotListItem {
  return {
    sujet: null,
    format: null,
    heure_ideale: null,
    prioritaire: false,
    active: true,
    auteur_username: DEMO_DIRECTION,
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

// Jeu de plans FICTIF couvrant plusieurs univers (eden / terminus / cercle + toutes salles), des priorités,
// des sujets/formats/heures libres, pour rendre visibles le groupage par univers et l'avancement. AUCUN
// vrai plan : libellés « (démo) ». Un plan est marqué inactif pour prouver qu'il est bien EXCLU de la liste
// courante (buildShotLines filtre les inactifs) — état honnête, jamais une ligne fabriquée.
const DEMO_ITEMS: ShotListItem[] = [
  item({
    id: "sl-1",
    label: "Arrivée tête d'affiche — Eden (démo)",
    venue: "eden",
    sujet: "Artiste",
    format: "Reel vertical",
    heure_ideale: "23h45",
    prioritaire: true,
    position: 0,
  }),
  item({
    id: "sl-2",
    label: "Ambiance dancefloor Eden (démo)",
    venue: "eden",
    sujet: "Public",
    format: "Vidéo courte",
    heure_ideale: "01h00",
    position: 1,
  }),
  item({
    id: "sl-3",
    label: "Set booth Terminus (démo)",
    venue: "terminus",
    sujet: "DJ",
    format: "Photo",
    heure_ideale: "00h30",
    prioritaire: true,
    position: 0,
  }),
  item({
    id: "sl-4",
    label: "Décor & lumières — Le Cercle (démo)",
    venue: "cercle",
    sujet: "Décor",
    format: "Photo",
    position: 0,
  }),
  item({
    id: "sl-5",
    label: "Story ouverture des portes (démo)",
    venue: null, // toutes salles
    sujet: "Public",
    format: "Story",
    heure_ideale: "23h00",
    position: 0,
  }),
  item({
    id: "sl-6",
    label: "Ancien plan archivé (démo, inactif)",
    venue: "eden",
    position: 9,
    active: false,
  }),
];

// Captures FICTIVES de la soirée (miroir de shot_captures) : un plan déposé au DAM, un plan capturé, le
// reste reste « à capturer » par défaut (buildShotLines n'invente aucun statut). AUCUNE vraie capture.
const DEMO_CAPTURES: ShotCapture[] = [
  {
    id: "sc-1",
    item_id: "sl-1",
    event_id: null,
    exploitation_date: REF_DATE,
    status: "depose",
    dam_ref: "DAM-EDEN-001 (démo)",
    note: null,
    updated_by: DEMO_DIRECTION,
    updated_at: TS,
  },
  {
    id: "sc-2",
    item_id: "sl-3",
    event_id: null,
    exploitation_date: REF_DATE,
    status: "capture",
    dam_ref: null,
    note: null,
    updated_by: DEMO_DIRECTION,
    updated_at: TS,
  },
];

// ————————————————————————————————————————————————————————————————
// Ce que chaque rôle est censé voir/faire (repère de lecture pour le fondateur — dérivé de la matrice A10
// §3.1, PAS une seconde source de vérité : le board réel est gardé par lib/captation ci-dessous).
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
  if (!canViewCaptation(role)) {
    return "Aucun accès à la captation (réservée à la direction — matrice A10).";
  }
  return "Voit la shot list · fait avancer un plan (à capturer → capturé → déposé au DAM)";
}

export default function CaptationPreviewPage() {
  const [role, setRole] = useState<StaffRole>("manager");
  // État LOCAL simulé (miroir client de shot_captures — aucune écriture réelle).
  const [captures, setCaptures] = useState<ShotCapture[]>(DEMO_CAPTURES);
  // Compteur déterministe pour les id de captures ajoutées (aucun Math.random, aucun new Date()).
  const captureCount = useRef(0);

  // onSetStatus simulé : le board n'affiche les boutons de statut QUE si canCaptureShot (direction + plan
  // actif — aucune règle dupliquée ici). Ce simulateur reflète l'upsert serveur : met à jour la capture du
  // plan pour la soirée si elle existe, sinon en crée une (miroir de shot_captures sous RLS). Aucun autre
  // champ n'est inventé au-delà du statut / de l'auteur / de l'horodatage.
  async function handleSetStatus(itemId: string, status: CaptationStatus): Promise<void> {
    setCaptures((prev) => {
      const existing = prev.find(
        (c) => c.item_id === itemId && c.exploitation_date === REF_DATE,
      );
      if (existing) {
        return prev.map((c) =>
          c === existing ? { ...c, status, updated_by: DEMO_DIRECTION, updated_at: TS } : c,
        );
      }
      captureCount.current += 1;
      return [
        ...prev,
        {
          id: `sc-new-${captureCount.current}`,
          item_id: itemId,
          event_id: null,
          exploitation_date: REF_DATE,
          status,
          dam_ref: null,
          note: null,
          updated_by: DEMO_DIRECTION,
          updated_at: TS,
        },
      ];
    });
  }

  function reset() {
    setCaptures(DEMO_CAPTURES);
    captureCount.current = 0;
  }

  const accessible = canViewCaptation(role);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai plan de captation, aucune vraie shot list. Le module ship <strong>VIDE</strong> en
          production (la vraie shot list reste en attente, A10). En réel, <code>app/page.tsx</code> charge
          les plans/captures déjà filtrés par la RLS (<code>0029</code>) et fait l&apos;écriture (avancement
          du statut) sous RLS. Ici, faire avancer un plan ne touche qu&apos;un <strong>état local simulé</strong>
          {" "}(miroir de <code>shot_captures</code>) ; le board est calculé par les MÊMES fonctions que la
          production (<code>buildShotLines</code>, <code>groupByVenue</code>, <code>summarizeCaptation</code>,{" "}
          <code>canCaptureShot</code>). Changer le rôle rejoue exactement le cadrage réel. Ce banc n&apos;exerce
          que la présentation, JAMAIS une sécurité.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Captation — shot list (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Shot list photo/vidéo du soir (A10) : plans groupés par univers (Eden, Terminus, Le Cercle +
          toutes salles), moments prioritaires en tête, avancement « à capturer → capturé → déposé au DAM ».
          États vides honnêtes : aucun plan → des zéros, jamais une ligne fabriquée ; un plan inactif est
          exclu de la liste courante.
        </p>
      </header>

      {/* Sélecteur de rôle : démontre le cadrage (miroir de la RLS 0029), pas une sécurité applicative. */}
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
          Rôle <code>{role}</code> · {accessible ? "captation accessible" : "captation fermée"} — attendu :{" "}
          {roleExpectation(role)}
        </p>
      </section>

      {/* Le board RÉEL. Pour les rôles sans accès, c'est le composant lui-même (canViewCaptation) qui rend
          le message de fermeture — aucune garde dupliquée ici. */}
      <section className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <CaptationBoard
          items={DEMO_ITEMS}
          captures={captures}
          exploitationDate={REF_DATE}
          role={role}
          onSetStatus={handleSetStatus}
        />
      </section>

      {accessible && (
        <section className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[12px] text-white/60">
          <span>
            {canManageShotList(role)
              ? "La direction compose la shot list dans l'écran réel (RLS 0029) ; ce banc n'exerce que l'avancement."
              : ""}
          </span>
          <button
            type="button"
            onClick={reset}
            className="ml-auto rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70 hover:text-white"
          >
            Réinitialiser le banc
          </button>
        </section>
      )}
    </main>
  );
}
