"use client";

// app/mode-soiree-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (COCKPIT « MODE SOIRÉE » A1).
//
// Raison d'être : le composant ModeSoireeCockpit (A1) et sa logique PURE d'agrégation temps réel
// (lib/modeSoiree.buildCockpit — qui compose A6 incidents · A7 comm interne · A8 artiste · A9 checklists)
// étaient construits et testés mais n'étaient montés NULLE PART (comme l'étaient FloorPlan S51,
// VenueTableEditor S52, le flux résa S53, la call-list S54, le scan porte S55 avant leur aperçu). Cette
// page câble le composant RÉEL à des données FICTIVES étiquetées, pour que le fondateur voie le cockpit
// tourner : niveau global (calme/vigilance/tension), fil d'alertes déterministe, tuiles par module — et,
// surtout, le CADRAGE DE RÔLE (chaque panneau miroite la RLS de son module ; le promoteur voit un cockpit
// fermé).
//
// Périmètre volontairement étroit et SÛR (même discipline que /plan-salle-preview, /call-list-preview,
// /scan-porte-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les données sont un JEU DE DÉMONSTRATION en mémoire. En réel,
//     app/page.tsx charge incidents/messages/artistes/checklists via des requêtes déjà filtrées par la
//     RLS (0023/0026/0027/0028) et les passe au cockpit ; ce banc ne fait qu'exercer la présentation et
//     le cadrage de rôle de lib/modeSoiree, JAMAIS une sécurité ;
//   · le cockpit NE DUPLIQUE AUCUNE règle : on appelle buildCockpit (la MÊME fonction que la production)
//     avec le rôle choisi. Changer le rôle rejoue exactement le cadrage réel — c'est ce qui rend la démo
//     honnête (le promoteur → cockpit fermé ; serveur/compteur → pas de panneau Artistes ; etc.) ;
//   · toutes les lignes sont des FICTIONS de démonstration (auteurs « (démo) », dates de banc). AUCUN vrai
//     client, AUCUN vrai incident, AUCUN vrai staff n'est lu ni inventé en base ;
//   · AUCUNE écriture, AUCUN envoi, AUCUNE mise en ligne.

import { useMemo, useState } from "react";

import ModeSoireeCockpit from "@/components/ModeSoireeCockpit";
import type { Incident } from "@/lib/incidents";
import type { InternalMessage, MessageRead } from "@/lib/internalComms";
import type { ArtistCheckin } from "@/lib/artistCheckin";
import type { ChecklistItem, ChecklistLine } from "@/lib/checklists";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { buildCockpit, canViewModeSoiree } from "@/lib/modeSoiree";

// ————————————————————————————————————————————————————————————————
// Repères de banc STABLES (aucun new Date() → aucun décalage de fuseau, valeurs figées de démonstration).
// L'utilisateur courant du banc est « sofia (démo) » : certaines lignes lui sont attribuées pour montrer
// le cantonnement « ses propres signalements » (serveur/compteur) sans rien inventer d'autre.
// ————————————————————————————————————————————————————————————————
const REF_DATE = "2026-07-07";
const TS = "2026-07-07T22:30:00.000Z";
const VIEWER = "sofia"; // « moi » du banc (username courant)

// ————————————————————————————————————————————————————————————————
// A6 — INCIDENTS (fictifs). Auteurs mélangés pour rendre visible le cantonnement serveur/compteur :
// direction/sécurité voient tout ; les autres ne voient QUE leurs propres signalements (visibleIncidents).
// ————————————————————————————————————————————————————————————————
function incident(over: Partial<Incident> & Pick<Incident, "id" | "type" | "niveau" | "status" | "auteur_username">): Incident {
  return {
    event_id: null,
    exploitation_date: REF_DATE,
    lieu: null,
    personne_concernee: null,
    description: "",
    photo_refs: [],
    escalade: false,
    resolved_at: null,
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

const DEMO_INCIDENTS: Incident[] = [
  // Escaladé (critique) — attribué à karim → INVISIBLE au serveur/compteur (démo du cantonnement).
  incident({
    id: "inc-1",
    type: "securite",
    niveau: "moyen",
    status: "escalade",
    escalade: true,
    auteur_username: "karim",
    lieu: "Entrée principale",
    description: "Attroupement à l'entrée — renfort demandé (démo).",
  }),
  // Grave en cours (critique) — attribué à sofia → VISIBLE au serveur/compteur.
  incident({
    id: "inc-2",
    type: "malaise",
    niveau: "grave",
    status: "en_cours",
    auteur_username: VIEWER,
    lieu: "Carré VIP",
    description: "Malaise client — secours en cours (démo).",
  }),
  // Actif « ordinaire » (attention) — attribué à sofia → VISIBLE au serveur/compteur.
  incident({
    id: "inc-3",
    type: "technique",
    niveau: "moyen",
    status: "ouvert",
    auteur_username: VIEWER,
    lieu: "Régie son",
    description: "Coupure micro DJ intermittente (démo).",
  }),
  // Clos (aucune alerte) — attribué à karim.
  incident({
    id: "inc-4",
    type: "autre",
    niveau: "mineur",
    status: "clos",
    auteur_username: "karim",
    resolved_at: TS,
    description: "Verre cassé au bar, nettoyé (démo).",
  }),
];

// ————————————————————————————————————————————————————————————————
// A7 — COMM INTERNE (fictifs). target_role permet de montrer le périmètre : le broadcast est vu de tous,
// une tâche ciblée « server » n'est PAS vue par la sécurité/le compteur (démo du périmètre RLS).
// ————————————————————————————————————————————————————————————————
function message(over: Partial<InternalMessage> & Pick<InternalMessage, "id" | "kind" | "body" | "auteur_username">): InternalMessage {
  return {
    event_id: null,
    exploitation_date: REF_DATE,
    target_role: null,
    assignee_username: null,
    resolved_at: null,
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

const DEMO_MESSAGES: InternalMessage[] = [
  // Urgence ouverte (critique), broadcast → vue de tous.
  message({
    id: "msg-1",
    kind: "urgence",
    body: "Fluide sur la piste — vérifier le sol côté bar (démo).",
    auteur_username: "karim",
  }),
  // Tâche ouverte (attention) ciblée « server » → NON vue par sécurité/compteur (démo périmètre).
  message({
    id: "msg-2",
    kind: "tache",
    body: "Réassort verres carré 3 avant minuit (démo).",
    auteur_username: "manager-demo",
    target_role: "server",
  }),
  // Annonce direction, broadcast, résolue → info seulement via « non lu ».
  message({
    id: "msg-3",
    kind: "annonce",
    body: "Fermeture des ventes bar à 4h00 ce soir (démo).",
    auteur_username: "admin-demo",
    resolved_at: TS,
  }),
  // Message ordinaire lu par sofia (n'entre pas dans « non lu »).
  message({
    id: "msg-4",
    kind: "message",
    body: "Merci l'équipe, bonne soirée (démo).",
    auteur_username: "karim",
  }),
];

// sofia a accusé lecture du seul msg-4 → msg-1/2/3 restent « non lus » pour elle.
const DEMO_READS: MessageRead[] = [
  { id: "read-1", message_id: "msg-4", reader_username: VIEWER, created_at: TS },
];

// ————————————————————————————————————————————————————————————————
// A8 — ARTISTES (fictifs). Panneau réservé à direction/sécurité (canViewArtistCheckin) : serveur et
// compteur ne le voient PAS (démo du cadrage de rôle).
// ————————————————————————————————————————————————————————————————
function checkin(over: Partial<ArtistCheckin> & Pick<ArtistCheckin, "id" | "artist_name" | "status">): ArtistCheckin {
  return {
    event_id: null,
    exploitation_date: REF_DATE,
    slot_label: null,
    companions: 0,
    dressing_room: null,
    contact: null,
    rider_notes: null,
    material_notes: null,
    arrived_at: null,
    soundcheck_at: null,
    tech_validated_at: null,
    tech_validated_by: null,
    notes: null,
    auteur_username: "manager-demo",
    created_at: TS,
    updated_at: TS,
    ...over,
  };
}

const DEMO_CHECKINS: ArtistCheckin[] = [
  checkin({ id: "art-1", artist_name: "DJ Démo A", status: "no_show", slot_label: "00h00–01h30" }),
  checkin({ id: "art-2", artist_name: "DJ Démo B", status: "attendu", slot_label: "01h30–03h00" }),
  checkin({ id: "art-3", artist_name: "Live Démo C", status: "attendu", slot_label: "03h00–04h00" }),
  checkin({
    id: "art-4",
    artist_name: "DJ Démo D",
    status: "pret",
    slot_label: "22h30–00h00",
    arrived_at: TS,
    soundcheck_at: TS,
    tech_validated_at: TS,
    tech_validated_by: "manager-demo",
  }),
];

// ————————————————————————————————————————————————————————————————
// A9 — CHECKLISTS (fictifs). Panneau vu de tous les rôles opérationnels (promoteur déjà exclu du cockpit).
// Ouverture presque bouclée (1 reste → info) ; fermeture pas commencée (2 restent → attention).
// ————————————————————————————————————————————————————————————————
function line(over: Partial<ChecklistItem> & Pick<ChecklistItem, "id" | "phase" | "category" | "label">, done: boolean): ChecklistLine {
  const item: ChecklistItem = {
    venue: "eden",
    poste: null,
    position: 0,
    active: true,
    auteur_username: "manager-demo",
    created_at: TS,
    updated_at: TS,
    ...over,
  };
  return { item, done, doneBy: done ? "manager-demo" : null, doneAt: done ? TS : null, note: null };
}

const DEMO_CHECKLIST: ChecklistLine[] = [
  line({ id: "cl-1", phase: "ouverture", category: "secu", label: "Issues de secours dégagées (démo)" }, true),
  line({ id: "cl-2", phase: "ouverture", category: "caisse", label: "Fond de caisse compté (démo)" }, true),
  line({ id: "cl-3", phase: "ouverture", category: "son", label: "Balance son validée (démo)" }, false),
  line({ id: "cl-4", phase: "fermeture", category: "caisse", label: "Clôture caisse / Z (démo)" }, false),
  line({ id: "cl-5", phase: "fermeture", category: "nettoyage", label: "Nettoyage sol + bar (démo)" }, false),
];

// ————————————————————————————————————————————————————————————————
// Ce que chaque rôle est censé voir (repère de lecture pour le fondateur — dérivé de la matrice §4.2, pas
// une seconde source de vérité : le cockpit réel est calculé par buildCockpit ci-dessous).
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
  if (role === "promoter") return "Cockpit FERMÉ (aucun métier de soirée temps réel).";
  const parts: string[] = [];
  // Incidents : direction/sécurité voient tout ; serveur/compteur, seulement les leurs.
  parts.push(
    role === "admin" || role === "manager" || role === "security"
      ? "Incidents : tous"
      : "Incidents : seulement les siens",
  );
  // Artistes : direction/sécurité uniquement.
  parts.push(
    role === "admin" || role === "manager" || role === "security"
      ? "Artistes : oui"
      : "Artistes : masqué",
  );
  // Comm : direction voit tout ; les autres, leur périmètre (broadcast + ciblé rôle/nominatif).
  parts.push(
    role === "admin" || role === "manager"
      ? "Comm : tout le fil"
      : "Comm : son périmètre",
  );
  parts.push("Checklists : oui");
  return parts.join(" · ");
}

export default function ModeSoireePreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");

  // Le cockpit RÉEL, recalculé par la MÊME fonction que la production à chaque changement de rôle.
  const cockpit = useMemo(
    () =>
      buildCockpit({
        role,
        username: VIEWER,
        incidents: DEMO_INCIDENTS,
        messages: DEMO_MESSAGES,
        reads: DEMO_READS,
        checkins: DEMO_CHECKINS,
        checklistLines: DEMO_CHECKLIST,
      }),
    [role],
  );

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai incident, aucun vrai message, aucun vrai artiste, aucun vrai staff. En réel,{" "}
          <code>app/page.tsx</code> charge ces données déjà filtrées par la RLS (
          <code>0023/0026/0027/0028</code>) et les passe au cockpit. Ici, le cockpit est calculé par la MÊME
          fonction que la production (<code>buildCockpit</code>) : changer le rôle rejoue exactement le
          cadrage réel (le promoteur voit un cockpit fermé ; serveur/compteur n&apos;ont pas le panneau
          Artistes). Ce banc n&apos;exerce que la présentation, JAMAIS une sécurité.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Mode Soirée — cockpit temps réel (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Vue d&apos;agrégation des modules d&apos;exploitation (incidents · comm interne · artistes ·
          checklists). Niveau global et fil d&apos;alertes dérivés UNIQUEMENT des données reçues.
        </p>
      </header>

      {/* Sélecteur de rôle : démontre le cadrage (miroir des RLS), pas une sécurité applicative. */}
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
          {canViewModeSoiree(role) ? "cockpit accessible" : "cockpit fermé"} — attendu :{" "}
          {roleExpectation(role)}
        </p>
      </section>

      {/* Le composant RÉEL, alimenté par le cockpit réel. */}
      <section className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <ModeSoireeCockpit
          role={role}
          username={VIEWER}
          incidents={DEMO_INCIDENTS}
          messages={DEMO_MESSAGES}
          reads={DEMO_READS}
          checkins={DEMO_CHECKINS}
          checklistLines={DEMO_CHECKLIST}
        />
      </section>

      {/* Récapitulatif honnête du cockpit calculé (utile pour vérifier le cadrage d'un coup d'œil). */}
      <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[12px] text-white/60">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/40">
          Cockpit calculé pour ce rôle
        </p>
        <ul className="space-y-1">
          <li>
            Accessible : <span className="text-white/80">{cockpit.accessible ? "oui" : "non (fermé)"}</span>
          </li>
          <li>
            Niveau global : <span className="text-white/80">{cockpit.level}</span> · alertes :{" "}
            <span className="text-white/80">{cockpit.alerts.length}</span> · tâches immédiates :{" "}
            <span className="text-white/80">{cockpit.tachesOuvertes}</span>
          </li>
          <li>
            Panneaux rendus :{" "}
            <span className="text-white/80">
              {[
                cockpit.panels.incidents && "Incidents",
                cockpit.panels.comms && "Comm",
                cockpit.panels.artists && "Artistes",
                cockpit.panels.checklist && "Checklists",
              ]
                .filter(Boolean)
                .join(" · ") || "aucun"}
            </span>
          </li>
        </ul>
      </section>
    </main>
  );
}
