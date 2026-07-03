"use client";

// app/inbox-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (DEMANDES / INBOX TRIÉES, B13).
//
// Raison d'être : le module B13 (inbox triée direction/com) n'existait NULLE PART. Sa logique pure
// (lib/inboxTriage : aiguillage « vous êtes » → files, SLA honnête, préparation du lien de réponse,
// gardes direction ; test:inbox vert) et son composant présentationnel (components/InboxTriageBoard)
// sont neufs cette session ; cette route les câble à un jeu de DÉMONSTRATION pour donner à voir le tri.
//
// Les POINTS-CLÉS démontrés :
//   · AUCUN ENVOI AUTOMATISÉ : « Valider & envoyer » PRÉPARE un lien wa.me/mailto ; l'humain clique et
//     rédige. Aucun message n'est fabriqué (loi Evin : aucune mention d'alcool injectée par l'outil).
//   · TRI NON DEVINÉ : une demande sans champ « vous êtes » tombe en file « à trier » (jamais devinée).
//   · SLA HONNÊTE : le retard n'est affirmé que contre un instant de référence STABLE (aucun Date.now()).
//
// Périmètre volontairement étroit et SÛR (même discipline que /leads-preview, /command-center-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN Supabase — demandes en mémoire. En réel, app/page.tsx dérive ces demandes
//     des tables déjà filtrées par la RLS (formulaire de contact public bloc 08), puis les passe à
//     buildInboxTriage ; la validation d'une réponse reste un geste humain (aucun envoi par l'app) ;
//   · le composant NE DUPLIQUE AUCUNE garde : il appelle canViewInbox / canReplyInbox. Changer le rôle
//     rejoue exactement le cadrage réel ;
//   · aucune donnée réelle : demandeurs/coordonnées explicitement fictifs et étiquetés.

import { useMemo, useState } from "react";

import InboxTriageBoard from "@/components/InboxTriageBoard";
import {
  buildInboxTriage,
  canReplyInbox,
  canViewInbox,
  type InboxTriageInput,
} from "@/lib/inboxTriage";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";

// Instant de référence STABLE du banc (aucun Date.now() — sinon le retard varierait à chaque rendu).
const REF_NOW = "2026-07-03T20:00:00.000Z";

type Scenario = "journee" | "sans_reference" | "vide";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "journee", label: "Journée type" },
  { key: "sans_reference", label: "Sans horloge (SLA non calculable)" },
  { key: "vide", label: "Inbox vide" },
];

// Demandes 100 % FICTIVES et étiquetées (noms « démo », coordonnées d'exemple non attribuées).
const DEMO_REQUESTS: InboxTriageInput["requests"] = [
  {
    id: "d1",
    requesterType: "client",
    displayName: "Client démo — A.",
    subject: "Résa table 6 personnes samedi",
    status: "nouveau",
    receivedAt: "2026-07-02T10:00:00.000Z", // > 24 h avant REF_NOW → en retard (SLA resa 24 h)
    hasDraft: true,
    contact: { phoneE164: "+33612000001" },
  },
  {
    id: "d2",
    requesterType: "client",
    displayName: "Client démo — B.",
    subject: "Anniversaire, place VIP ?",
    status: "en_cours",
    receivedAt: "2026-07-03T17:30:00.000Z",
    hasDraft: false,
    contact: { phoneE164: "+33612000002" },
  },
  {
    id: "d3",
    requesterType: "entreprise",
    displayName: "Entreprise démo — Société X",
    subject: "Privatisation rooftop Eden fin juillet",
    status: "nouveau",
    receivedAt: "2026-07-03T09:00:00.000Z",
    hasDraft: true,
    contact: { email: "contact@societe-demo.example" },
  },
  {
    id: "d4",
    requesterType: "artiste",
    displayName: "Artiste démo — DJ Démo",
    subject: "Proposition de set / booking",
    status: "en_cours",
    receivedAt: "2026-07-01T12:00:00.000Z",
    hasDraft: false,
    contact: { email: "dj.demo@example.com" },
  },
  {
    id: "d5",
    requesterType: null, // formulaire incomplet → file « à trier », JAMAIS deviné
    displayName: "Contact démo — sans profil",
    subject: "Question sur l'accès / horaires",
    status: "nouveau",
    receivedAt: "2026-07-03T19:15:00.000Z",
    hasDraft: false,
    contact: null, // aucun contact exploitable → le lien de réponse sera refusé honnêtement
  },
  {
    id: "d6",
    requesterType: "client",
    displayName: "Client démo — C.",
    subject: "Merci pour la soirée",
    status: "repondu",
    receivedAt: "2026-07-01T22:00:00.000Z",
    hasDraft: false,
    respondedAt: "2026-07-02T09:00:00.000Z",
    contact: { phoneE164: "+33612000006" },
  },
  {
    id: "d7",
    requesterType: "entreprise",
    displayName: "Entreprise démo — Société Y",
    subject: "Demande de partenariat (traitée)",
    status: "clos",
    receivedAt: "2026-06-20T08:00:00.000Z",
    hasDraft: false,
    contact: { email: "y@example.com" },
  },
];

const DEMO_INPUT: Record<Scenario, InboxTriageInput> = {
  journee: { requests: DEMO_REQUESTS, nowIso: REF_NOW },
  // Même flux mais SANS instant de référence : le retard devient non calculable (honnêteté du SLA).
  sans_reference: { requests: DEMO_REQUESTS },
  vide: { requests: [], nowIso: REF_NOW },
};

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Compteur (flux)",
  promoter: "Promoteur",
};

export default function InboxPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  const [scenario, setScenario] = useState<Scenario>("journee");

  const view = useMemo(() => buildInboxTriage(DEMO_INPUT[scenario]), [scenario]);

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucune donnée réelle, aucune vraie coordonnée. L’inbox triée (B13) répartit les demandes du
          formulaire de contact public (« vous êtes : client / entreprise / artiste / autre ») dans des{" "}
          <strong>files par responsable</strong>. <strong>Aucun envoi automatisé</strong> : « Valider &amp;
          envoyer » prépare un lien wa.me / e-mail que l’humain clique et rédige lui-même. Une demande sans
          profil tombe en file « à trier » (jamais devinée). Changer le rôle rejoue le cadrage direction réel
          (<code>canViewInbox</code> / <code>canReplyInbox</code>).
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Demandes &amp; inbox triée — vue direction (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module B13 : le formulaire de contact du site alimente des files par responsable (réservations,
          privatisation, booking, à trier), avec brouillon → « Valider &amp; envoyer » humain et suivi du
          retard honnête. Réservé à la direction / com (admin / manager, PII).
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

      {/* Sélecteur de rôle : démontre la garde direction/com, pas une sécurité. */}
      <section className="mb-5">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
          Rôle du spectateur (l’inbox est réservée à la direction / com)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            const open = canViewInbox(r);
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
          Rôle <code>{role}</code> —{" "}
          {canViewInbox(role)
            ? canReplyInbox(role)
              ? "accès direction, peut valider une réponse (geste humain, aucun envoi auto)"
              : "accès direction, consultation seule"
            : "aucun accès (message de fermeture — les demandes contiennent des PII)"}
        </p>
      </section>

      <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <InboxTriageBoard view={view} role={role} />
      </div>
    </main>
  );
}
