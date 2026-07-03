"use client";

// app/agent-orchestrator-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (ORCHESTRATEUR D'AGENTS IA, 0.6).
//
// Raison d'être : le module 0.6 (CLUB_ONE_OS_MASTER §3.1 « Orchestrateur agents IA (autonomie 0→4) ·
// Socle · Direction · P2 ») n'avait aucune brique. Sa logique pure (lib/agentOrchestrator : clampe le
// niveau effectif par plafond de capacité + interrupteur + arrêt global, agrège la posture ;
// test:agentorchestrator vert) et son composant présentationnel (components/AgentOrchestrator) sont neufs
// cette session ; cette route les câble à un registre de DÉMONSTRATION.
//
// Les POINTS-CLÉS démontrés :
//   · PLAFOND = RÈGLE DURE : un agent « message client » configuré à N4 est ramené à N2 (Loi Evin + aucun
//     envoi automatisé) ; un agent « écriture prod » configuré à N4 est ramené à N1. Le moteur ne relève
//     JAMAIS un niveau, il ne fait que l'abaisser.
//   · ARRÊT GLOBAL : le gros bouton rouge force TOUT le monde à N0, quel que soit le réglage.
//   · REGISTRE VIDE honnête : sans agent, l'écran dit « aucun agent enregistré » — aucun agent fabriqué.
//   · TÉLÉMÉTRIE : « non disponible » tant qu'aucune observabilité n'est branchée (jamais un chiffre inventé).
//
// Périmètre volontairement étroit et SÛR (même discipline que /active-event-preview, /audit-journal-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN Supabase — registre en mémoire. En réel, une future table d'agents + réglages
//     alimente buildOrchestratorView ; les gestes deviennent des écritures serveur + coupure des workers ;
//   · le composant NE DUPLIQUE AUCUNE garde : il s'appuie sur la vue calculée par la lib ;
//   · aucune donnée réelle : Club One n'a AUCUN agent IA aujourd'hui ; les agents ci-dessous sont fictifs
//     et étiquetés, choisis pour illustrer les plafonds, pas pour préfigurer un déploiement.

import { useMemo, useState } from "react";

import { AgentOrchestrator } from "@/components/AgentOrchestrator";
import {
  buildOrchestratorView,
  canManageOrchestrator,
  type AgentDescriptor,
  type AutonomyLevel,
} from "@/lib/agentOrchestrator";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";

// Agents 100 % FICTIFS et étiquetés. Déterministes. Choisis pour couvrir chaque capacité et montrer les
// plafonds : deux agents sont volontairement sur-configurés (N4) pour être visiblement ramenés au plafond.
const DEMO_AGENTS: AgentDescriptor[] = [
  {
    id: "demo-insight",
    name: "démo — synthèse P&L de fin de soirée",
    capability: "internal_insight",
    configuredLevel: 4,
    enabled: true,
    description: "Lecture seule : agrège caisse/entrées et rédige un résumé pour la direction.",
  },
  {
    id: "demo-classif",
    name: "démo — pré-classification des demandes (inbox)",
    capability: "content_classification",
    configuredLevel: 3,
    enabled: true,
    description: "Étiquette et route une demande entrante ; annulable.",
  },
  {
    id: "demo-score",
    name: "démo — scoring client VIP",
    capability: "pii_processing",
    configuredLevel: 4, // sera plafonné à N2
    enabled: true,
    description: "Calcule un score à partir des visites ; touche de la PII.",
  },
  {
    id: "demo-msg",
    name: "démo — relance client (liens wa.me)",
    capability: "client_messaging",
    configuredLevel: 4, // sera plafonné à N2 (Loi Evin + aucun envoi automatisé)
    enabled: true,
    description: "Prépare un brouillon de message ; l'humain clique le lien wa.me.",
  },
  {
    id: "demo-prod",
    name: "démo — clôture automatique de soirée",
    capability: "prod_mutation",
    configuredLevel: 3, // sera plafonné à N1 (aucune écriture prod autonome)
    enabled: false,
    description: "Proposerait une clôture ; jamais autonome.",
  },
];

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction (admin)",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Accueil / compteur",
  promoter: "Promoteur",
};

export default function AgentOrchestratorPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  const [empty, setEmpty] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);
  // Réglages simulés en mémoire (aucune écriture réseau).
  const [levels, setLevels] = useState<Record<string, AutonomyLevel>>({});
  const [enabledOverride, setEnabledOverride] = useState<Record<string, boolean>>({});

  const agents = useMemo<AgentDescriptor[]>(() => {
    if (empty) return [];
    return DEMO_AGENTS.map((a) => ({
      ...a,
      configuredLevel: levels[a.id] ?? a.configuredLevel,
      enabled: enabledOverride[a.id] ?? a.enabled,
    }));
  }, [empty, levels, enabledOverride]);

  const view = useMemo(
    () =>
      buildOrchestratorView({
        role,
        agents,
        settings: { killSwitchEngaged: killSwitch },
        // Télémétrie volontairement absente : démontre l'état honnête « non disponible ».
        telemetry: null,
      }),
    [role, agents, killSwitch],
  );

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — registre fictif, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucune donnée réelle. Club One n’a <strong>aucun agent IA</strong> aujourd’hui ; les agents
          ci-dessous sont fictifs, choisis pour montrer que le niveau <strong>effectif</strong> ne dépasse
          jamais le <strong>plafond de la capacité</strong> (Loi Evin, aucune écriture prod autonome) et que
          l’<strong>arrêt global</strong> coupe tout. Changer le rôle rejoue la garde direction.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Orchestrateur d’agents IA + registre d’autonomie (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module 0.6 (Socle · Direction). Il compose un registre d’agents (future table) + les réglages en
          une vue de gouvernance : niveau effectif borné par le plafond de capacité, interrupteur par agent,
          arrêt global. Les gestes sont ici <strong>simulés en mémoire</strong> ; en réel ce sont des
          écritures serveur + coupure des workers.
        </p>
      </header>

      {/* Sélecteur de rôle : démontre la garde direction, pas une sécurité. */}
      <section className="mb-4">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
          Rôle du spectateur (seule la direction voit et gère)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            const manages = canManageOrchestrator(r);
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
                  {manages ? "gère" : "aucun accès"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Bascule registre vide / peuplé — démontre l'état vide honnête. */}
      <section className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEmpty((v) => !v)}
          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-bold text-white/70 hover:text-white/90"
        >
          {empty ? "Afficher le registre de démonstration" : "Simuler un registre vide (état honnête)"}
        </button>
        <button
          type="button"
          onClick={() => {
            setLevels({});
            setEnabledOverride({});
            setKillSwitch(false);
          }}
          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-bold text-white/50 hover:text-white/80"
        >
          Réinitialiser la démo
        </button>
      </section>

      <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <AgentOrchestrator
          view={view}
          role={role}
          onSetLevel={(id, level) => setLevels((prev) => ({ ...prev, [id]: level }))}
          onToggleEnabled={(id, enabled) =>
            setEnabledOverride((prev) => ({ ...prev, [id]: enabled }))
          }
          onToggleKillSwitch={(engaged) => setKillSwitch(engaged)}
        />
      </div>
    </main>
  );
}
