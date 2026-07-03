"use client";

// app/reputation-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (RÉPUTATION & AVIS, B14).
//
// Raison d'être : le module B14 (réputation & avis direction/com) n'existait NULLE PART. Sa logique pure
// (lib/reputation : agrégation par plateforme, sentiment non deviné, SLA honnête, alertes négatives,
// préparation du lien de réponse, gardes direction ; test:reputation vert) et son composant
// présentationnel (components/ReputationBoard) sont neufs cette session ; cette route les câble à un jeu
// de DÉMONSTRATION pour donner à voir le tri des avis.
//
// Les POINTS-CLÉS démontrés :
//   · AUCUN AVIS INVENTÉ : le scénario « Sans connecteur » montre l'état VIDE honnête — le module ship
//     vide tant qu'aucun connecteur Google/Meta réel n'alimente les avis. Les avis de démonstration sont
//     explicitement fictifs et étiquetés.
//   · SENTIMENT NON DEVINÉ : sentiment fourni OU déduit d'une note ; sans note ni champ → « non qualifié ».
//   · AUCUNE PUBLICATION : « Valider & répondre » ouvre l'avis sur sa plateforme ; l'humain rédige. Aucun
//     texte injecté (loi Evin).
//   · SLA HONNÊTE : le retard n'est affirmé que contre un instant de référence STABLE (aucun Date.now()).
//
// Périmètre volontairement étroit et SÛR (même discipline que /inbox-preview, /leads-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN Supabase — avis en mémoire. En réel, app/page.tsx dérive ces avis du connecteur
//     Google/Meta déjà filtré par la RLS, puis les passe à buildReputationView ; la validation d'une
//     réponse reste un geste humain (aucune publication par l'app) ;
//   · le composant NE DUPLIQUE AUCUNE garde : il appelle canViewReputation / canReplyReputation.

import { useMemo, useState } from "react";

import ReputationBoard from "@/components/ReputationBoard";
import {
  buildReputationView,
  canReplyReputation,
  canViewReputation,
  type ReputationInput,
} from "@/lib/reputation";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";

// Instant de référence STABLE du banc (aucun Date.now() — sinon le retard varierait à chaque rendu).
const REF_NOW = "2026-07-03T20:00:00.000Z";

type Scenario = "flux" | "sans_reference" | "vide";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "flux", label: "Flux d'avis" },
  { key: "sans_reference", label: "Sans horloge (SLA non calculable)" },
  { key: "vide", label: "Sans connecteur (module vide)" },
];

// Avis 100 % FICTIFS et étiquetés (auteurs « démo », permalinks d'exemple non attribués).
const DEMO_REVIEWS: ReputationInput["reviews"] = [
  {
    id: "a1",
    platform: "google",
    author: "Auteur démo — M.",
    rating: 1,
    text: "Attente trop longue à l'entrée, personne pour renseigner.",
    status: "nouveau",
    hasDraft: true,
    postedAt: "2026-07-02T10:00:00.000Z", // > 24 h avant REF_NOW → négatif en retard (SLA 24 h)
    permalink: "https://example.com/avis/a1",
  },
  {
    id: "a2",
    platform: "meta",
    author: "Auteur démo — L.",
    rating: 2,
    text: "Bon DJ mais accueil moyen.",
    status: "en_cours",
    hasDraft: false,
    postedAt: "2026-07-03T16:00:00.000Z",
    permalink: null, // pas de lien → refus honnête, répondre depuis la console
  },
  {
    id: "a3",
    platform: "google",
    author: "Auteur démo — S.",
    rating: 5,
    text: "Super ambiance, on reviendra !",
    status: "nouveau",
    hasDraft: false,
    postedAt: "2026-07-03T19:00:00.000Z",
    permalink: "https://example.com/avis/a3",
  },
  {
    id: "a4",
    platform: "meta",
    author: "Auteur démo — Recommandation",
    rating: null, // Meta binaire : pas de note → sentiment depuis le champ explicite
    sentiment: "positif",
    text: "Recommande cet endroit.",
    status: "repondu",
    hasDraft: false,
    postedAt: "2026-07-01T22:00:00.000Z",
    respondedAt: "2026-07-02T09:00:00.000Z",
    permalink: "https://example.com/avis/a4",
  },
  {
    id: "a5",
    platform: "google",
    author: "Auteur démo — Sans note ni sentiment",
    rating: null,
    sentiment: null, // ni note ni champ → « non qualifié », JAMAIS deviné depuis le texte
    text: "Ok.",
    status: "nouveau",
    hasDraft: false,
    postedAt: "2026-07-03T18:30:00.000Z",
    permalink: "https://example.com/avis/a5",
  },
  {
    id: "a6",
    platform: "google",
    author: "Auteur démo — Spam",
    rating: 1,
    text: "Message hors sujet.",
    status: "ignore",
    hasDraft: false,
    postedAt: "2026-06-15T12:00:00.000Z",
    permalink: "https://example.com/avis/a6",
  },
];

const DEMO_INPUT: Record<Scenario, ReputationInput> = {
  flux: { reviews: DEMO_REVIEWS, nowIso: REF_NOW },
  // Même flux mais SANS instant de référence : le retard devient non calculable (honnêteté du SLA).
  sans_reference: { reviews: DEMO_REVIEWS },
  // Module VIDE : aucun connecteur réel branché → aucun avis. État honnête, jamais un faux « 5 étoiles ».
  vide: { reviews: [], nowIso: REF_NOW },
};

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Compteur (flux)",
  promoter: "Promoteur",
};

export default function ReputationPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  const [scenario, setScenario] = useState<Scenario>("flux");

  const view = useMemo(() => buildReputationView(DEMO_INPUT[scenario]), [scenario]);

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucun avis réel. La réputation (B14) agrège les avis Google Business / Meta, surface les{" "}
          <strong>alertes négatives</strong> et le retard de réponse (objectif &lt; 48 h). <strong>Aucune
          publication automatisée</strong> : « Valider &amp; répondre » ouvre l’avis sur sa plateforme où
          l’humain rédige. Le sentiment vient d’un champ fourni ou d’une note — jamais deviné du texte. Sans
          connecteur réel, le module est <strong>vide</strong> (jamais un faux « 5 étoiles »). Changer le rôle
          rejoue le cadrage direction réel (<code>canViewReputation</code> / <code>canReplyReputation</code>).
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Réputation &amp; avis — vue direction (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module B14 : les avis Google / Meta remontent dans une file triée (négatifs en attente d’abord),
          avec note moyenne, alertes, retard honnête et brouillon → « Valider &amp; répondre » humain.
          Réservé à la direction / com (admin / manager).
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
          Rôle du spectateur (la réputation est réservée à la direction / com)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            const open = canViewReputation(r);
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
          {canViewReputation(role)
            ? canReplyReputation(role)
              ? "accès direction, peut valider une réponse (geste humain, aucune publication auto)"
              : "accès direction, consultation seule"
            : "aucun accès (message de fermeture)"}
        </p>
      </section>

      <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <ReputationBoard view={view} role={role} />
      </div>
    </main>
  );
}
