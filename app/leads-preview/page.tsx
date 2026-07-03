"use client";

// app/leads-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (LEADS & TUNNEL COMMERCIAL, B12).
//
// Raison d'être : le module B12 (tunnel commercial direction) n'existait NULLE PART. Sa logique pure
// (lib/leadsPipeline : agrégation par canal + retour sur dépense + gardes direction, test:leads vert)
// et son composant présentationnel (components/LeadsPipelineBoard) sont neufs cette session ; cette
// route les câble à un jeu de DÉMONSTRATION pour que le fondateur voie tourner le tunnel.
//
// Les POINTS-CLÉS démontrés :
//   · HONNÊTETÉ : une étape non tracée s'affiche « — » (jamais 0) ; un ROAS non renseigné s'affiche
//     « — » (jamais un ROI inventé) ; la dépense partielle est signalée « partielle ».
//   · « SINON ON COUPE » : un canal payant dont la dépense dépasse la valeur générée est marqué
//     « à couper » — l'app aide à ARRÊTER une pub, jamais à la pousser.
//
// Périmètre volontairement étroit et SÛR (même discipline que /command-center-preview, /rh-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN Supabase — signaux en mémoire. En réel, app/page.tsx dérive ces signaux des
//     données déjà filtrées par la RLS de chaque source (QR A4, promoteurs B11, résas B10), puis les
//     passe à buildLeadsPipeline ; la dépense pub vient de la direction après GO fondateur par palier ;
//   · le composant NE DUPLIQUE AUCUNE garde : il appelle canViewLeads / canManageLeads (miroir du
//     palier direction). Changer le rôle rejoue exactement le cadrage réel ;
//   · aucune donnée réelle : leads/dépenses/valeurs explicitement fictifs et étiquetés.

import { useMemo, useState } from "react";

import LeadsPipelineBoard from "@/components/LeadsPipelineBoard";
import {
  buildLeadsPipeline,
  canManageLeads,
  canViewLeads,
  type LeadsPipelineInput,
} from "@/lib/leadsPipeline";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";

// ————————————————————————————————————————————————————————————————
// Données de DÉMONSTRATION (fictives, étiquetées). Aucune donnée réelle, aucun vrai budget pub.
// ————————————————————————————————————————————————————————————————

type Scenario = "actif" | "pub_a_couper" | "veille";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "actif", label: "Soirée trackée" },
  { key: "pub_a_couper", label: "Pub à couper" },
  { key: "veille", label: "Aucune soirée" },
];

const DEMO_INPUT: Record<Scenario, LeadsPipelineInput> = {
  // Cas nominal : QR + promoteurs bien tracés (gratuits), une campagne payante rentable, Google
  // Business partiellement tracé, import historique sans conversion mesurée cette soirée.
  actif: {
    activeEvent: { label: "Soirée démo — Eden", date: "2026-07-04", venue: "eden" },
    channels: [
      { channel: "qr", stages: { impressions: 480, leads: 96, resasDemandees: 40, resasConfirmees: 28, venus: 22 } },
      { channel: "promoteur", stages: { leads: 60, resasDemandees: 34, resasConfirmees: 25, venus: 20 } },
      {
        channel: "campagne",
        stages: { impressions: 12000, leads: 140, resasDemandees: 30, resasConfirmees: 18 },
        spentCents: 30000, // 300 € (palier validé fondateur)
        palier: 300,
        valueCents: 108000, // 1 080 € de résa générée → ROAS ×3.6
      },
      { channel: "google_business", stages: { impressions: 320, leads: 18 } }, // conversions non tracées
      { channel: "direct", stages: { leads: 12, resasConfirmees: 6, venus: 5 } },
      { channel: "import", stages: { leads: 0 } }, // relancé mais 0 conversion mesurée cette soirée
    ],
  },
  // Démonstration de « sinon on coupe » : la campagne dépense plus qu'elle ne rapporte.
  pub_a_couper: {
    activeEvent: { label: "Soirée démo — Eden", date: "2026-07-11", venue: "eden" },
    channels: [
      { channel: "qr", stages: { leads: 40, resasConfirmees: 12, venus: 10 } },
      { channel: "promoteur", stages: { leads: 55, resasConfirmees: 30, venus: 26 } },
      {
        channel: "campagne",
        stages: { impressions: 15000, leads: 90, resasDemandees: 10, resasConfirmees: 4 },
        spentCents: 60000, // 600 € (palier validé)
        palier: 600,
        valueCents: 24000, // 240 € générés → ROAS ×0.4 → à couper
      },
      // Google Business : payant ? non, gratuit. Ici tracé mais dépense non applicable.
      { channel: "google_business", stages: { impressions: 210, leads: 9 } },
    ],
  },
  // Veille honnête : aucune soirée active, aucun canal tracé.
  veille: { activeEvent: null, channels: [] },
};

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Compteur (flux)",
  promoter: "Promoteur",
};

export default function LeadsPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  const [scenario, setScenario] = useState<Scenario>("actif");

  const view = useMemo(() => buildLeadsPipeline(DEMO_INPUT[scenario]), [scenario]);

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucune donnée réelle, aucun vrai budget pub. Le tunnel commercial (B12) trace l’origine de
          chaque lead (QR A4, promoteurs B11, pub, Google Business, lien direct, base historique) et
          rattache la <strong>dépense pub</strong> à la <strong>valeur de résa générée</strong>. Il
          n’engage <strong>aucune dépense</strong> : les montants sont saisis par la direction après un
          GO fondateur par palier. Aucune métrique n’est fabriquée : une étape non tracée ou un ROAS non
          renseigné s’affiche « — ». Changer le rôle rejoue le cadrage direction réel (
          <code>canViewLeads</code> / <code>canManageLeads</code>).
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Leads &amp; tunnel commercial — vue direction (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module B12 : par canal d’origine, mesure le tunnel (impressions → leads → résas → entrées) et,
          pour la pub payante, le retour sur dépense — « chaque euro de pub rattaché à des résas trackées,
          sinon on coupe ». Réservé à la direction (admin / manager).
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
          Rôle du spectateur (le tunnel est réservé à la direction)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            const open = canViewLeads(r);
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
          {canViewLeads(role)
            ? canManageLeads(role)
              ? "accès direction, pilotage (saisie dépense après GO fondateur)"
              : "accès direction, consultation seule"
            : "aucun accès (message de fermeture)"}
        </p>
      </section>

      <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <LeadsPipelineBoard view={view} role={role} />
      </div>
    </main>
  );
}
