"use client";

// app/internal-comm-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (COMMUNICATION INTERNE, A7).
//
// Raison d'être : les composants InternalCommFeed (fil de lecture : messages, annonces, alertes,
// urgences, tâches avec accusés de lecture) et InternalCommComposer (publication d'un message,
// annonce réservée à la direction) et leur logique PURE (lib/internalComms — visibilité par rôle,
// tri des épinglés, accusés de lecture, résumé, gardes A7) étaient construits et testés mais
// n'étaient montés NULLE PART (comme l'étaient FloorPlan S51, VenueTableEditor S52, le flux résa S53,
// la call-list S54, le scan porte S55, le cockpit Mode Soirée S56, les checklists S57, l'accueil
// artiste S58 avant leur aperçu). Cette page câble les composants RÉELS à des données FICTIVES
// étiquetées, pour que le fondateur voie le journal de communication tourner : publication, accusé
// de réception, résolution d'une tâche/urgence — et, surtout, le CADRAGE DE RÔLE (miroir de la RLS
// 0026 : direction + manager + serveur + sécurité + compteur voient le fil ; seule la direction peut
// poster une ANNONCE ; chacun ne voit que le broadcast, ce qui cible son rôle/lui, et ses propres
// messages ; promoteur = AUCUN accès).
//
// Périmètre volontairement étroit et SÛR (même discipline que /artist-checkin-preview, /checklist-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les données sont un JEU DE DÉMONSTRATION en mémoire. En réel,
//     app/page.tsx charge les messages/accusés via des requêtes déjà filtrées par la RLS 0026 et fait les
//     écritures (insert message / insert accusé / résolution) sous RLS. Ici, publier/accuser/résoudre ne
//     touche qu'un ÉTAT LOCAL simulé qui miroite internal_messages / internal_message_reads côté serveur —
//     JAMAIS une sécurité, JAMAIS une écriture ;
//   · les composants NE DUPLIQUENT AUCUNE règle : le feed appelle visibleMessages/sortForFeed/summarizeFeed/
//     hasRead/canResolveMessage, le composer appelle canPostKind/validateMessageDraft (les MÊMES fonctions
//     que la production). Changer le rôle rejoue exactement le cadrage réel — c'est ce qui rend la démo
//     honnête ;
//   · tous les messages sont des FICTIONS de démonstration (corps « (démo) », auteurs « -demo »,
//     dates de banc fixes). AUCUN vrai message, AUCUN vrai staff n'est lu ni inventé en base ;
//   · AUCUNE écriture, AUCUN envoi, AUCUNE mise en ligne.

import { useMemo, useRef, useState } from "react";

import InternalCommFeed from "@/components/InternalCommFeed";
import InternalCommComposer from "@/components/InternalCommComposer";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import {
  canAccessInternalComm,
  canPostAnnouncement,
  summarizeFeed,
  type InternalMessage,
  type MessageDraft,
  type MessageRead,
} from "@/lib/internalComms";

// ————————————————————————————————————————————————————————————————
// Repères de banc STABLES (aucun new Date() → aucun décalage de fuseau, valeurs figées de démonstration).
// ————————————————————————————————————————————————————————————————
const REF_DATE = "2026-07-07";
const TS = "2026-07-07T20:00:00.000Z";

// Identifiant de démonstration associé à chaque rôle, pour que la logique « ce message est le mien /
// m'est assigné » (hasRead / canResolveMessage / visibilité nominative) soit exercée réellement quand
// on change de rôle. AUCUN vrai staff : ce sont des étiquettes « -demo ».
const DEMO_USERNAME: Record<StaffRole, string> = {
  admin: "admin-demo",
  manager: "manager-demo",
  server: "server-demo",
  security: "security-demo",
  security_counter: "compteur-demo",
  promoter: "promoter-demo",
};

function message(
  over: Partial<InternalMessage> &
    Pick<InternalMessage, "id" | "kind" | "body" | "auteur_username" | "created_at">,
): InternalMessage {
  return {
    event_id: null,
    exploitation_date: REF_DATE,
    target_role: null,
    assignee_username: null,
    resolved_at: null,
    updated_at: over.created_at,
    ...over,
  };
}

// Jeu de messages FICTIF couvrant plusieurs états pour rendre visible le cadrage : une annonce
// broadcast (direction seule sait la poster), un message court broadcast, une urgence ouverte
// (épinglée en tête), une tâche ciblée sur le poste serveur et assignée à server-demo (accusé
// attendu), un message ciblé sur la sécurité (invisible aux autres non-direction), une alerte
// résolue. AUCUN vrai message : corps « (démo) ».
const DEMO_MESSAGES: InternalMessage[] = [
  message({
    id: "im-1",
    kind: "annonce",
    body: "Ouverture des portes décalée à 23h30 ce soir (démo).",
    auteur_username: "manager-demo",
    created_at: "2026-07-07T18:00:00.000Z",
  }),
  message({
    id: "im-2",
    kind: "message",
    body: "Stock de gobelets réassorti au bar principal (démo).",
    auteur_username: "server-demo",
    created_at: "2026-07-07T18:10:00.000Z",
  }),
  message({
    id: "im-3",
    kind: "urgence",
    body: "Individu à surveiller près de l'entrée VIP (démo).",
    auteur_username: "security-demo",
    created_at: "2026-07-07T18:20:00.000Z",
  }),
  message({
    id: "im-4",
    kind: "tache",
    body: "Vérifier les extincteurs de la mezzanine avant l'affluence (démo).",
    target_role: "server",
    assignee_username: "server-demo",
    auteur_username: "manager-demo",
    created_at: "2026-07-07T18:30:00.000Z",
  }),
  message({
    id: "im-5",
    kind: "message",
    body: "Renfort demandé au sas d'entrée vers 01h (démo).",
    target_role: "security",
    auteur_username: "manager-demo",
    created_at: "2026-07-07T18:40:00.000Z",
  }),
  message({
    id: "im-6",
    kind: "alerte",
    body: "Fuite au vestiaire — signalée puis colmatée (démo).",
    auteur_username: "manager-demo",
    resolved_at: "2026-07-07T19:00:00.000Z",
    created_at: "2026-07-07T18:50:00.000Z",
  }),
];

// Accusés de lecture FICTIFS (miroir de internal_message_reads) : l'annonce a été lue par deux postes.
const DEMO_READS: MessageRead[] = [
  {
    id: "mr-1",
    message_id: "im-1",
    reader_username: "server-demo",
    created_at: "2026-07-07T18:05:00.000Z",
  },
  {
    id: "mr-2",
    message_id: "im-1",
    reader_username: "security-demo",
    created_at: "2026-07-07T18:06:00.000Z",
  },
];

// ————————————————————————————————————————————————————————————————
// Ce que chaque rôle est censé voir/faire (repère de lecture pour le fondateur — dérivé de la matrice A7
// §4.2, PAS une seconde source de vérité : le feed réel est calculé par lib/internalComms ci-dessous).
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
  if (!canAccessInternalComm(role)) {
    return "Aucun fil interne (promoteur exclu — matrice A7).";
  }
  if (canPostAnnouncement(role)) {
    return "Voit tout le fil · publie tout, y compris une annonce · peut marquer traité";
  }
  return "Voit le broadcast + ce qui le cible + ses messages · publie sans annonce · résout ses propres messages";
}

export default function InternalCommPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  // État LOCAL simulé (miroir client de internal_messages / internal_message_reads — aucune écriture réelle).
  const [messages, setMessages] = useState<InternalMessage[]>(DEMO_MESSAGES);
  const [reads, setReads] = useState<MessageRead[]>(DEMO_READS);
  // Compteurs déterministes pour les id ajoutés (aucun Math.random, aucun new Date()).
  const postCount = useRef(0);
  const readCount = useRef(0);

  const username = DEMO_USERNAME[role];

  // onAck simulé : le feed n'affiche le bouton QUE si le message attend un accusé et n'est pas déjà lu
  // (expectsAck / hasRead — aucune règle dupliquée ici). Ce simulateur reflète l'écriture serveur :
  // ajoute une ligne d'accusé au nom de l'utilisateur courant (miroir de internal_message_reads). Aucun
  // doublon : si l'accusé existe déjà, on ne le réinsère pas.
  async function handleAck(messageId: string): Promise<void> {
    setReads((prev) => {
      if (prev.some((r) => r.message_id === messageId && r.reader_username === username)) {
        return prev;
      }
      readCount.current += 1;
      return [
        ...prev,
        {
          id: `mr-new-${readCount.current}`,
          message_id: messageId,
          reader_username: username,
          created_at: TS,
        },
      ];
    });
  }

  // onResolve simulé : le feed n'affiche le bouton QUE pour une tâche/urgence ouverte et si
  // canResolveMessage (direction OU auteur — aucune règle dupliquée ici). Ce simulateur pose le
  // timestamp resolved_at (miroir de l'update serveur sous RLS). Aucun autre champ n'est inventé.
  async function handleResolve(messageId: string): Promise<void> {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.resolved_at === null
          ? { ...m, resolved_at: TS, updated_at: TS }
          : m,
      ),
    );
  }

  // onPost simulé : le composer a DÉJÀ validé le brouillon (validateMessageDraft) et masque l'annonce
  // aux non-direction (canPostKind). Ce simulateur ajoute le message à l'état local avec des champs
  // serveur fabriqués de façon déterministe (id incrémental, auteur = utilisateur courant, dates de
  // banc) — aucune écriture réelle. Le corps est suffixé « (démo) » pour rester une fiction visible.
  async function handlePost(draft: MessageDraft): Promise<void> {
    postCount.current += 1;
    const body = draft.body.trim();
    const msg = message({
      id: `im-new-${postCount.current}`,
      kind: draft.kind as InternalMessage["kind"],
      body: body.endsWith("(démo)") ? body : `${body} (démo)`,
      target_role: draft.target_role ?? null,
      assignee_username: draft.assignee_username ?? null,
      auteur_username: username,
      created_at: `2026-07-07T19:1${postCount.current}:00.000Z`,
    });
    setMessages((prev) => [...prev, msg]);
  }

  function reset() {
    setMessages(DEMO_MESSAGES);
    setReads(DEMO_READS);
    postCount.current = 0;
    readCount.current = 0;
  }

  // Récap honnête : agrégat calculé par la MÊME fonction que la production (summarizeFeed), au périmètre
  // VISIBLE du rôle courant (jamais au-delà de ce que la RLS laisserait lire).
  const summary = useMemo(
    () => summarizeFeed(messages, reads, role, username),
    [messages, reads, role, username],
  );

  const accessible = canAccessInternalComm(role);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai message, aucun vrai staff. En réel, <code>app/page.tsx</code> charge le fil déjà
          filtré par la RLS (<code>0026</code>) et fait les écritures (publication / accusé de lecture /
          résolution) sous RLS. Ici, publier, accuser réception et marquer traité ne touchent qu&apos;un{" "}
          <strong>état local simulé</strong> ; le fil et le composer sont calculés par les MÊMES fonctions
          que la production (<code>visibleMessages</code>, <code>sortForFeed</code>,{" "}
          <code>canResolveMessage</code>, <code>validateMessageDraft</code>). Changer le rôle rejoue
          exactement le cadrage réel. Ce banc n&apos;exerce que la présentation, JAMAIS une sécurité.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Communication interne (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Journal de communication du soir (A7) : messages courts, annonces manager, alertes, urgences,
          tâches avec accusés de lecture. Les urgences/alertes ouvertes remontent en tête (tri réel). États
          vides honnêtes : un fil vide → des zéros, jamais un message fabriqué.
        </p>
      </header>

      {/* Sélecteur de rôle : démontre le cadrage (miroir de la RLS 0026), pas une sécurité applicative. */}
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
          Rôle <code>{role}</code> (identité de banc <code>{username}</code>) ·{" "}
          {accessible ? "fil accessible" : "fil fermé"} — attendu : {roleExpectation(role)}
        </p>
      </section>

      {accessible ? (
        <>
          {/* Le composer RÉEL — l'option « annonce » n'apparaît que pour la direction (canPostKind). */}
          <section className="mb-5">
            <InternalCommComposer
              role={role}
              exploitationDate={REF_DATE}
              eventId={null}
              onPost={handlePost}
            />
            {!canPostAnnouncement(role) && (
              <p className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/40">
                Nature « Annonce » masquée pour ce rôle : seule la direction peut poster une annonce
                (matrice A7, miroir du WITH CHECK de la RLS 0026).
              </p>
            )}
          </section>

          {/* Le fil RÉEL, alimenté par l'état local simulé. */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
            <InternalCommFeed
              messages={messages}
              reads={reads}
              role={role}
              username={username}
              onAck={handleAck}
              onResolve={handleResolve}
            />
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Onglet Communication interne non disponible pour ce rôle. Le promoteur n&apos;a aucun accès au
          fil interne (matrice A7, miroir de la RLS 0026).
        </section>
      )}

      {/* Récapitulatif honnête : agrégat calculé par summarizeFeed (même fonction que la production),
          au périmètre VISIBLE du rôle courant. */}
      {accessible && (
        <section className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[12px] text-white/60">
          <span>
            Visibles : <span className="text-white/80">{summary.total}</span>
          </span>
          {summary.nonLus > 0 && <span className="text-amber-300">non lus : {summary.nonLus}</span>}
          {summary.urgencesOuvertes > 0 && (
            <span className="text-rose-300">urgences ouvertes : {summary.urgencesOuvertes}</span>
          )}
          <span>
            tâches ouvertes : <span className="text-white/80">{summary.tachesOuvertes}</span>
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
