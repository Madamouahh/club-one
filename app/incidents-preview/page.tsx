"use client";

// app/incidents-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (INCIDENTS, A6).
//
// Raison d'être : la logique PURE du registre d'incidents (lib/incidents — gardes de rôle A6, visibilité
// RESTREINTE miroir de la RLS 0023, validation d'un signalement, workflow de statut ouvert→clos, tri de
// priorité, agrégat post-soirée, test:incidents 16/16 vert) existait mais n'était montée NULLE PART :
// contrairement aux composants des séries S51→S60, le module A6 n'avait AUCUN composant (ni board, ni
// composer). Cette session construit les DEUX composants présentationnels (IncidentBoard, IncidentComposer)
// et les câble ici à des données FICTIVES étiquetées, pour que le fondateur voie le registre tourner :
// signalement d'un incident, avancement d'un statut (ouvert → en cours → escaladé → résolu → clos),
// résumé post-soirée — et surtout le CADRAGE DE RÔLE, cœur de ce module SENSIBLE (miroir de la RLS 0023 :
// direction + sécurité voient TOUT et mutent ; serveur + compteur peuvent SIGNALER mais ne voient QUE
// leurs propres signalements ; promoteur = AUCUN accès).
//
// Périmètre volontairement étroit et SÛR (même discipline que /captation-preview, /internal-comm-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les données sont un JEU DE DÉMONSTRATION en mémoire. En réel,
//     app/page.tsx charge les incidents via des requêtes déjà filtrées par la RLS 0023 et fait les
//     écritures (insert d'un signalement, transition de statut) sous RLS. Ici, signaler ou faire avancer
//     ne touche qu'un ÉTAT LOCAL simulé — JAMAIS une sécurité, JAMAIS une écriture ;
//   · les composants NE DUPLIQUENT AUCUNE règle : ils appellent visibleIncidents / sortByPriority /
//     summarizeIncidents / canAccessIncidents / canManageIncidents / canReportIncident / validateIncidentDraft /
//     nextStatuses (les MÊMES fonctions que la production). Changer le rôle rejoue exactement le cadrage réel ;
//   · tous les incidents sont des FICTIONS de démonstration (descriptions « (démo) », auteurs « -demo »,
//     personnes NON nominatives, dates de banc fixes). AUCUN vrai incident n'est lu ni inventé en base — le
//     module ship VIDE en production (le vrai registre se remplit en soirée réelle) ;
//   · AUCUNE écriture, AUCUN envoi, AUCUNE mise en ligne.

import { useRef, useState } from "react";

import IncidentBoard from "@/components/IncidentBoard";
import IncidentComposer from "@/components/IncidentComposer";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import {
  canAccessIncidents,
  canManageIncidents,
  canReportIncident,
  type Incident,
  type IncidentDraft,
  type IncidentStatus,
} from "@/lib/incidents";

// ————————————————————————————————————————————————————————————————
// Repères de banc STABLES (aucun new Date() → aucun décalage de fuseau, valeurs figées de démonstration).
// ————————————————————————————————————————————————————————————————
const REF_DATE = "2026-07-07";
const TS = "2026-07-07T23:30:00.000Z";

// Identité de banc par rôle (auteur simulé d'un signalement / d'une transition). AUCUN vrai staff : ces
// identifiants « -demo » servent uniquement à exercer la visibilité restreinte (« ce signalement est le mien »).
const DEMO_USERNAME: Record<StaffRole, string> = {
  admin: "admin-demo",
  manager: "manager-demo",
  server: "server-demo",
  security: "security-demo",
  security_counter: "compteur-demo",
  promoter: "promo-demo",
};

function incident(
  over: Partial<Incident> &
    Pick<Incident, "id" | "type" | "niveau" | "description" | "status" | "auteur_username" | "created_at">,
): Incident {
  return {
    event_id: null,
    exploitation_date: REF_DATE,
    lieu: null,
    personne_concernee: null,
    photo_refs: [],
    escalade: false,
    resolved_at: null,
    updated_at: over.created_at,
    ...over,
  };
}

// Jeu d'incidents FICTIF couvrant plusieurs types / gravités / statuts / auteurs, pour rendre visibles le
// tri de priorité (actifs d'abord, gravité décroissante) ET la visibilité restreinte (le serveur ne voit
// que ses propres signalements). Descriptions « (démo) », personnes NON nominatives. AUCUN vrai incident.
const DEMO_INCIDENTS: Incident[] = [
  incident({
    id: "inc-1",
    type: "vol",
    niveau: "critique",
    description: "Vol de sac signalé au vestiaire (démo).",
    lieu: "Vestiaire Eden",
    personne_concernee: "cliente vestiaire",
    status: "ouvert",
    auteur_username: DEMO_USERNAME.security,
    created_at: "2026-07-07T23:20:00.000Z",
  }),
  incident({
    id: "inc-2",
    type: "altercation",
    niveau: "grave",
    description: "Altercation entre deux groupes à l'entrée, escaladée à la direction (démo).",
    lieu: "Entrée Eden",
    status: "escalade",
    escalade: true,
    auteur_username: DEMO_USERNAME.security,
    photo_refs: ["ref-demo-1"],
    created_at: "2026-07-07T22:50:00.000Z",
  }),
  incident({
    id: "inc-3",
    type: "malaise",
    niveau: "moyen",
    description: "Malaise d'un client au bar, pris en charge (démo).",
    lieu: "Bar Terminus",
    personne_concernee: "client table 12",
    status: "en_cours",
    auteur_username: DEMO_USERNAME.server,
    created_at: "2026-07-07T23:05:00.000Z",
  }),
  incident({
    id: "inc-4",
    type: "refus_entree",
    niveau: "mineur",
    description: "Refus d'entrée pour tenue non conforme, sans incident (démo).",
    lieu: "Sas d'accueil",
    status: "resolu",
    resolved_at: TS,
    auteur_username: DEMO_USERNAME.security_counter,
    created_at: "2026-07-07T22:10:00.000Z",
  }),
  incident({
    id: "inc-5",
    type: "technique",
    niveau: "mineur",
    description: "Coupure son booth Terminus, rétablie (démo).",
    lieu: "Booth Terminus",
    status: "clos",
    resolved_at: TS,
    auteur_username: DEMO_USERNAME.server,
    created_at: "2026-07-07T21:40:00.000Z",
  }),
];

// ————————————————————————————————————————————————————————————————
// Ce que chaque rôle est censé voir/faire (repère de lecture pour le fondateur — dérivé de la matrice A6,
// PAS une seconde source de vérité : les composants réels sont gardés par lib/incidents ci-dessous).
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
  if (!canAccessIncidents(role)) {
    return "Aucun accès au registre (visibilité restreinte — matrice A6).";
  }
  const view = canManageIncidents(role) ? "voit TOUT le registre + fait avancer les statuts" : "voit UNIQUEMENT ses propres signalements";
  const report = canReportIncident(role) ? " · peut signaler" : "";
  return `${view}${report}`;
}

export default function IncidentsPreviewPage() {
  const [role, setRole] = useState<StaffRole>("security");
  // État LOCAL simulé (miroir client de la table incidents — aucune écriture réelle).
  const [incidents, setIncidents] = useState<Incident[]>(DEMO_INCIDENTS);
  // Compteur déterministe pour les id d'incidents ajoutés (aucun Math.random, aucun new Date()).
  const addCount = useRef(0);

  // onReport simulé : reflète l'insert serveur. L'auteur est l'identité de banc du rôle courant (miroir de
  // auteur = current_staff_username() côté RLS). Aucun champ inventé au-delà du brouillon validé.
  async function handleReport(draft: IncidentDraft): Promise<void> {
    addCount.current += 1;
    const newIncident: Incident = {
      id: `inc-new-${addCount.current}`,
      event_id: draft.event_id ?? null,
      exploitation_date: draft.exploitation_date,
      type: draft.type as Incident["type"],
      niveau: draft.niveau as Incident["niveau"],
      lieu: draft.lieu ?? null,
      personne_concernee: draft.personne_concernee ?? null,
      description: draft.description,
      photo_refs: [],
      status: "ouvert",
      escalade: false,
      auteur_username: DEMO_USERNAME[role],
      resolved_at: null,
      created_at: TS,
      updated_at: TS,
    };
    setIncidents((prev) => [...prev, newIncident]);
  }

  // onTransition simulé : reflète l'update serveur (nouveau statut + resolved_at posé au passage résolu/clos).
  // Le board n'expose ces boutons QUE si canManageIncidents (aucune règle dupliquée ici).
  async function handleTransition(id: string, to: IncidentStatus): Promise<void> {
    setIncidents((prev) =>
      prev.map((inc) =>
        inc.id === id
          ? {
              ...inc,
              status: to,
              escalade: to === "escalade" ? true : inc.escalade,
              resolved_at: to === "resolu" || to === "clos" ? TS : inc.resolved_at,
              updated_at: TS,
            }
          : inc,
      ),
    );
  }

  function reset() {
    setIncidents(DEMO_INCIDENTS);
    addCount.current = 0;
  }

  const accessible = canAccessIncidents(role);
  const username = DEMO_USERNAME[role];

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai incident, aucun vrai staff. Le module ship <strong>VIDE</strong> en production (le
          registre se remplit en soirée réelle). En réel, <code>app/page.tsx</code> charge les incidents déjà
          filtrés par la RLS (<code>0023</code>) et fait l&apos;écriture (signalement, transition) sous RLS.
          Ici, signaler ou faire avancer ne touche qu&apos;un <strong>état local simulé</strong> ; les
          composants sont gardés par les MÊMES fonctions que la production (<code>visibleIncidents</code>,{" "}
          <code>canManageIncidents</code>, <code>canReportIncident</code>, <code>validateIncidentDraft</code>).
          Changer le rôle rejoue exactement le cadrage réel. Ce banc n&apos;exerce que la présentation, JAMAIS
          une sécurité.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Incidents — registre de soirée (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Registre des incidents (A6), donnée SENSIBLE à visibilité restreinte : type, gravité, lieu,
          personne (non nominative), statut ouvert → en cours → escaladé → résolu → clos, escalade, auteur.
          Tri de priorité (actifs d&apos;abord, gravité décroissante, récent) et résumé post-soirée. États
          vides honnêtes : aucun incident → des zéros, jamais une ligne fabriquée.
        </p>
      </header>

      {/* Sélecteur de rôle : démontre le cadrage (miroir de la RLS 0023), pas une sécurité applicative. */}
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
          Rôle <code>{role}</code> (<code>{username}</code>) · {accessible ? "registre accessible" : "registre fermé"} —
          attendu : {roleExpectation(role)}
        </p>
      </section>

      {/* Le composer RÉEL : rendu seulement si le rôle peut signaler (le composant lui-même rend le message
          de fermeture sinon — aucune garde dupliquée ici). */}
      <section className="mb-5">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">Signaler un incident</p>
        <IncidentComposer role={role} exploitationDate={REF_DATE} onReport={handleReport} />
      </section>

      {/* Le board RÉEL. Pour les rôles sans accès, c'est le composant lui-même (canAccessIncidents) qui rend
          le message de fermeture — aucune garde dupliquée ici. */}
      <section className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <IncidentBoard incidents={incidents} role={role} username={username} onTransition={handleTransition} />
      </section>

      {accessible && (
        <section className="mt-5 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[12px] text-white/60">
          <span>
            {canManageIncidents(role)
              ? "Direction/sécurité : registre complet + transitions de statut."
              : "Serveur/compteur : signalement seul + relecture de ses propres incidents."}
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
