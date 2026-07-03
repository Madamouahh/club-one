"use client";

// app/active-event-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (SÉLECTEUR UNIVERS + ÉVÉNEMENT ACTIF, 0.4).
//
// Raison d'être : le module 0.4 (CLUB_ONE_OS_MASTER §3.1 « Sélecteur univers + événement actif · Socle ·
// Tous · P1 ») avait sa couche d'ACCÈS (lib/activeEvent : get_active_event_context,
// list_activatable_club_events, bootstrap/activate/close) mais AUCUN écran de sélection. Sa logique pure
// (lib/activeEventSelector : classe les candidates par univers, résout le cycle de vie amorçage-vs-
// activation depuis le contexte serveur, garde direction ; test:activeeventselector vert) et son
// composant présentationnel (components/ActiveEventSelector) sont neufs cette session ; cette route les
// câble à un contexte de DÉMONSTRATION pour donner à voir le sélecteur, avec 3 scénarios serveur.
//
// Les POINTS-CLÉS démontrés :
//   · DÉCISION SERVEUR : amorçage (jamais amorcé) vs activation (amorcé, aucun actif) vs aucune action
//     (une soirée est déjà active) — jamais déduite d'un message d'erreur.
//   · STATUTS : seules les soirées draft/published sont activables ; une soirée archived reste visible
//     mais NON activable (jamais promue en silence).
//   · UNIVERS non inventé : les candidates portent leur propre venue ; une soirée sans venue tombe dans
//     « Univers non renseigné », jamais rattachée d'office à eden/terminus/cercle.
//
// Périmètre volontairement étroit et SÛR (même discipline que /audit-journal-preview, /resa-board-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN Supabase — contexte en mémoire. En réel, app/page.tsx charge le contexte via
//     lib/activeEvent puis le passe à buildActiveEventSelector ; l'action devient une RPC SECURITY DEFINER ;
//   · le composant NE DUPLIQUE AUCUNE garde : il s'appuie sur la vue calculée par la lib ;
//   · aucune donnée réelle : titres et univers explicitement fictifs et étiquetés.

import { useMemo, useState } from "react";

import { ActiveEventSelector } from "@/components/ActiveEventSelector";
import {
  buildActiveEventSelector,
  canManageActiveEvent,
} from "@/lib/activeEventSelector";
import type {
  ActiveEventCandidate,
  ActiveEventRuntimeContext,
} from "@/lib/activeEvent";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";

// Candidates 100 % FICTIVES et étiquetées. Déterministes (aucune horloge). Elles couvrent deux univers
// nommés (« Le Cercle », « Eden — démo »), une soirée SANS univers, et une soirée archived NON activable.
const DEMO_CANDIDATES: ActiveEventCandidate[] = [
  { id: "d1", title: "démo — vendredi techno", eventDate: "2026-07-10", status: "published", venueId: "v-eden", venueName: "Eden — démo" },
  { id: "d2", title: "démo — samedi hip-hop", eventDate: "2026-07-11", status: "draft", venueId: "v-eden", venueName: "Eden — démo" },
  { id: "d3", title: "démo — carte blanche", eventDate: "2026-07-17", status: "published", venueId: "v-cercle", venueName: "Le Cercle — démo" },
  { id: "d4", title: "démo — soirée sans univers", eventDate: "2026-07-18", status: "published", venueId: null, venueName: null },
  // statut archived → visible mais JAMAIS activable (aucune promotion silencieuse).
  { id: "d5", title: "démo — ancienne soirée", eventDate: "2026-06-20", status: "archived", venueId: "v-eden", venueName: "Eden — démo" },
];

type Scenario = "bootstrap" | "activate" | "active";

// Trois contextes SERVEUR de démonstration — c'est le contexte, pas un message d'erreur, qui décide.
const SCENARIOS: Record<Scenario, { label: string; runtime: ActiveEventRuntimeContext }> = {
  bootstrap: {
    label: "Jamais amorcé (bootstrap)",
    runtime: { activeEvent: null, bootstrapCompleted: false, bootstrapCompletedAt: null, lastClosedEventId: null },
  },
  activate: {
    label: "Amorcé, aucune soirée active (activation)",
    runtime: {
      activeEvent: null,
      bootstrapCompleted: true,
      bootstrapCompletedAt: "2026-06-01T00:00:00Z",
      lastClosedEventId: "démo-e-close",
    },
  },
  active: {
    label: "Une soirée est déjà active",
    runtime: {
      activeEvent: { eventId: "démo-e-live", eventDate: "2026-07-04", title: "démo — soirée en cours", status: "active" },
      bootstrapCompleted: true,
      bootstrapCompletedAt: "2026-06-01T00:00:00Z",
      lastClosedEventId: "démo-e-prev",
    },
  },
};

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction (admin)",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Accueil / compteur",
  promoter: "Promoteur",
};

export default function ActiveEventPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  const [scenario, setScenario] = useState<Scenario>("activate");
  const [venueFilter, setVenueFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Trace du dernier geste simulé (aucune écriture réseau) — juste un retour visuel.
  const [lastAction, setLastAction] = useState<string | null>(null);

  const view = useMemo(
    () =>
      buildActiveEventSelector({
        role,
        runtime: SCENARIOS[scenario].runtime,
        candidates: DEMO_CANDIDATES,
        venueFilter,
        selectedId,
      }),
    [role, scenario, venueFilter, selectedId],
  );

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — contexte fictif, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucune donnée réelle. Le sélecteur (0.4) affiche <strong>quelle soirée est active</strong> et,
          pour la direction, comment en activer une. Le choix <strong>amorçage vs activation</strong> vient
          du <strong>contexte serveur</strong> (jamais d’un message d’erreur). Changer le scénario rejoue
          les trois états serveur ; changer le rôle rejoue la garde (<code>canManageActiveEvent</code>).
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Sélecteur univers + événement actif (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module 0.4 (Socle · Tous en consultation, direction en gestion). Il compose le contexte serveur
          déjà chargé par <code>lib/activeEvent</code> (<code>get_active_event_context</code>,
          <code>list_activatable_club_events</code>) en un écran de choix. L’amorçage / l’activation sont
          des RPC SECURITY DEFINER — ici seulement simulées en mémoire.
        </p>
      </header>

      {/* Scénario serveur */}
      <section className="mb-4">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">Contexte serveur</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SCENARIOS) as Scenario[]).map((s) => {
            const selected = s === scenario;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setScenario(s);
                  setSelectedId(null);
                  setLastAction(null);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                  selected
                    ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
                }`}
              >
                {SCENARIOS[s].label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Sélecteur de rôle : démontre la garde de gestion, pas une sécurité. */}
      <section className="mb-5">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
          Rôle du spectateur (tous consultent ; seule la direction gère)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            const manages = canManageActiveEvent(r);
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
                <span className={`ml-1.5 text-[10px] ${manages ? "text-emerald-300/80" : "text-white/30"}`}>
                  {manages ? "gère" : "consulte"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {lastAction && (
        <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.06] px-4 py-2 text-[12px] text-emerald-100">
          Geste simulé (aucune écriture réseau) : {lastAction}
        </div>
      )}

      <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <ActiveEventSelector
          view={view}
          role={role}
          venueFilter={venueFilter}
          onVenueFilter={setVenueFilter}
          onSelect={setSelectedId}
          onBootstrap={(id) => setLastAction(`amorçage demandé pour ${id} (RPC bootstrap_club_event_v2)`)}
          onActivate={(id) => setLastAction(`activation demandée pour ${id} (RPC activate_club_event_v2)`)}
        />
      </div>
    </main>
  );
}
