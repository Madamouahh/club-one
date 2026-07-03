"use client";

// app/command-center-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (CENTRE DE COMMANDEMENT, B1).
//
// Raison d'être : le module B1 (écran direction consolidé) n'existait NULLE PART. Sa logique pure
// (lib/commandCenter : agrégation des signaux + garde direction, test:commandcenter vert) et son
// composant présentationnel (components/CommandCenter) sont neufs cette session ; cette route les
// câble à un jeu de DÉMONSTRATION pour que le fondateur voie tourner le cockpit direction.
//
// Le POINT-CLÉ démontré : l'HONNÊTETÉ DE COUVERTURE. Deux modules seulement sont réellement branchés
// ici (incidents A6 via summarizeIncidents ; résas B10 via resaQueueSummary — les MÊMES fonctions
// que la production) ; les autres tuiles chiffrées (remplissage, présence, captation, checklists, CA)
// reçoivent un signal de démonstration, et TOUT le reste (leads, avis, campagnes, contrats, reco IA,
// agents, météo, prévision…) reste « Non branché » — affiché honnêtement, jamais rempli d'un faux zéro.
//
// Périmètre volontairement étroit et SÛR (même discipline que /rh-preview, /incidents-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN Supabase — signaux en mémoire. En réel, app/page.tsx calcule ces signaux à
//     partir des données déjà filtrées par la RLS de CHAQUE module, puis les passe à buildCommandCenter ;
//   · le composant NE DUPLIQUE AUCUNE garde : il appelle canViewCommandCenter (miroir du palier
//     direction). Changer le rôle rejoue exactement le cadrage réel ;
//   · aucune donnée réelle : incidents/résas/CA de démonstration explicitement fictifs.

import { useMemo, useState } from "react";

import CommandCenter from "@/components/CommandCenter";
import {
  buildCommandCenter,
  canViewCommandCenter,
  type CommandCenterInput,
} from "@/lib/commandCenter";
import {
  isActiveStatus,
  summarizeIncidents,
  type Incident,
} from "@/lib/incidents";
import { resaQueueSummary, type ResaStatus } from "@/lib/resaRequest";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";

// ————————————————————————————————————————————————————————————————
// Données de DÉMONSTRATION (fictives, étiquetées). Aucune donnée réelle.
// ————————————————————————————————————————————————————————————————

function inc(over: Partial<Incident> & Pick<Incident, "id" | "type" | "niveau" | "status">): Incident {
  return {
    event_id: null,
    exploitation_date: "2026-07-04",
    lieu: null,
    personne_concernee: null,
    description: "incident de démonstration",
    photo_refs: [],
    escalade: over.status === "escalade",
    auteur_username: "securite-demo",
    resolved_at: null,
    created_at: "2026-07-04T23:00:00.000Z",
    updated_at: "2026-07-04T23:00:00.000Z",
    ...over,
  };
}

// Trois scénarios pour montrer le cockpit réagir (et l'état de veille honnête).
type Scenario = "en_cours" | "critique" | "veille";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "en_cours", label: "Soirée en cours" },
  { key: "critique", label: "Nuit critique" },
  { key: "veille", label: "Aucune soirée" },
];

// Incidents de démo par scénario (exercés par les VRAIES fonctions summarizeIncidents / isActiveStatus).
const DEMO_INCIDENTS: Record<Scenario, Incident[]> = {
  en_cours: [
    inc({ id: "i1", type: "refus_entree", niveau: "mineur", status: "resolu" }),
    inc({ id: "i2", type: "malaise", niveau: "moyen", status: "en_cours" }),
  ],
  critique: [
    inc({ id: "i3", type: "altercation", niveau: "critique", status: "escalade" }),
    inc({ id: "i4", type: "vol", niveau: "grave", status: "ouvert" }),
    inc({ id: "i5", type: "technique", niveau: "mineur", status: "resolu" }),
  ],
  veille: [],
};

// Résas de démo par scénario.
const DEMO_RESAS: Record<Scenario, ResaStatus[]> = {
  en_cours: ["pending", "pending", "approved", "declined"],
  critique: ["pending", "approved", "approved"],
  veille: [],
};

// Signaux « démonstration » pour les domaines à lib non branchée dans ce banc (remplissage, présence,
// captation, checklists, CA). Fictifs et étiquetés — pas de vraie donnée.
const DEMO_OTHER: Record<Scenario, Pick<CommandCenterInput, "remplissage" | "presence" | "captation" | "checklists" | "ca" | "activeEvent">> = {
  en_cours: {
    activeEvent: { label: "Soirée démo — Eden", date: "2026-07-04", venue: "eden" },
    remplissage: { occupees: 31, total: 44 },
    presence: { presents: 6, attendus: 6, coutComplet: false },
    captation: { aFaire: 2, total: 5 },
    checklists: { ouverts: 1, total: 8 },
    ca: { montantCents: 742500, complet: false },
  },
  critique: {
    activeEvent: { label: "Soirée démo — Eden", date: "2026-07-04", venue: "eden" },
    remplissage: { occupees: 44, total: 44 },
    presence: { presents: 4, attendus: 7, coutComplet: false },
    captation: { aFaire: 4, total: 6 },
    checklists: { ouverts: 3, total: 8 },
    ca: { montantCents: 1289000, complet: false },
  },
  veille: {
    activeEvent: null,
    remplissage: { occupees: 0, total: 0 },
    presence: { presents: 0, attendus: 0, coutComplet: true },
    captation: { aFaire: 0, total: 0 },
    checklists: { ouverts: 0, total: 0 },
    ca: { montantCents: 0, complet: true },
  },
};

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Compteur (flux)",
  promoter: "Promoteur",
};

export default function CommandCenterPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  const [scenario, setScenario] = useState<Scenario>("en_cours");

  // Construction des signaux via les VRAIES fonctions de production (incidents, résas), puis agrégation
  // par buildCommandCenter. Aucun recalcul propre au banc.
  const view = useMemo(() => {
    const incidents = DEMO_INCIDENTS[scenario];
    const incSummary = summarizeIncidents(incidents);
    const critiquesActifs = incidents.filter(
      (i) => isActiveStatus(i.status) && i.niveau === "critique",
    ).length;

    const resaSummary = resaQueueSummary(DEMO_RESAS[scenario].map((status) => ({ status })));
    const other = DEMO_OTHER[scenario];

    const input: CommandCenterInput = {
      activeEvent: other.activeEvent,
      incidents: { actifs: incSummary.actifs, escalades: incSummary.escalades, critiquesActifs },
      resa: { pending: resaSummary.pending },
      remplissage: other.remplissage,
      presence: other.presence,
      captation: other.captation,
      checklists: other.checklists,
      ca: other.ca,
      // Volontairement NON fournis (→ « Non branché » honnête) : leads, avis, campagnes, contrats,
      // contenus, objectifs, reco IA, agents, automatisations, météo, prévision, événements à venir,
      // validations en attente. Ces modules n'existent pas encore : B1 les montre comme lacunes de
      // couverture assumées, pas comme des zéros rassurants.
    };
    return buildCommandCenter(input);
  }, [scenario]);

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucune donnée réelle. Le centre de commandement (B1) n’a pas de table propre : il{" "}
          <strong>agrège</strong> les signaux des autres modules, déjà protégés par leur RLS. Ici, seuls
          les <strong>incidents</strong> (via <code>summarizeIncidents</code>) et les{" "}
          <strong>résas</strong> (via <code>resaQueueSummary</code>) passent par les MÊMES fonctions que la
          production ; les autres tuiles chiffrées reçoivent un signal de démonstration. Tous les modules{" "}
          <strong>non encore construits</strong> (leads, avis, campagnes, contrats, reco IA, agents,
          météo, prévision…) s’affichent honnêtement « <strong>Non branché</strong> » — jamais un faux
          zéro. Changer le rôle rejoue le cadrage direction réel (<code>canViewCommandCenter</code>).
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Centre de commandement — vue direction (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module B1 : agrège en une vue de pilotage les signaux de soirée (incidents, remplissage,
          présence équipe, résas en attente, captation, checklists, CA) et expose honnêtement quels
          modules restent à brancher. Réservé à la direction (admin / manager).
        </p>
      </header>

      {/* Sélecteur de scénario. */}
      <section className="mb-4">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">Scénario</p>
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((s) => {
            const selected = s.key === scenario;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setScenario(s.key)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                  selected
                    ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Sélecteur de rôle : démontre la garde direction (miroir palier direction), pas une sécurité. */}
      <section className="mb-5">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
          Rôle du spectateur (le cockpit est réservé à la direction)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            const open = canViewCommandCenter(r);
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
                <span className={`ml-1.5 text-[10px] ${open ? "text-emerald-300/80" : "text-white/30"}`}>
                  {open ? "●" : "○"}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-white/40">
          Rôle <code>{role}</code> — {canViewCommandCenter(role) ? "accès direction (cockpit visible)" : "aucun accès (message de fermeture)"}
        </p>
      </section>

      <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <CommandCenter view={view} role={role} />
      </div>
    </main>
  );
}
