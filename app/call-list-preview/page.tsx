"use client";

// app/call-list-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (CRM V1 : LA CALL-LIST DU MARDI, spec §V1).
//
// Raison d'être : la « call-list du mardi » — que la spec MODULE_CRM_CLIENTS_VIP.md désigne comme LE
// facteur de succès du module (le rituel, pas la technique) — avait sa logique PURE construite et testée
// (lib/crmCallList : buildCallList / assignCallReason / suggestCallMessage / buildCallEntryContact) mais
// n'était montée NULLE PART. Cette page câble cette logique dans le composant CallListBoard pour que le
// fondateur voie le rituel tourner : par promoteur → 15-25 noms max → chacun son « pourquoi » → un lien
// wa.me prêt (ou un refus motivé) → un traçage local du résultat.
//
// Périmètre volontairement étroit et SÛR (même discipline que /plan-salle-preview & /plan-salle-resa-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les clients affichés sont des FICTIONS de démonstration,
//     explicitement étiquetées (bandeau ambre). AUCUN vrai client (les 2050 OctoTable du LABO) n'est lu ;
//   · l'écran RÉEL branché sur la vue guest_scores (0013, cantonnée par la RLS : chaque promoteur ne voit
//     que SES clients) est un chunk d'intégration séparé, LABO d'abord ;
//   · AUCUN envoi : l'outil PRÉPARE un lien wa.me, l'humain clique. Aucun message ne part d'ici ;
//   · aucune mention d'alcool (loi Évin) : les gabarits n'en contiennent pas et buildCallEntryContact
//     revalide le texte à chaque frappe.
//
// Le filtre « par promoteur » est fait ICI dans la page (démonstration) ; en réel, c'est la RLS 0013 qui
// impose « SES clients uniquement » — jamais un filtre applicatif.

import { useMemo, useState } from "react";

import { CallListBoard } from "@/components/CallListBoard";
import { buildCallList, type CallListGuest } from "@/lib/crmCallList";

// Date de référence de démonstration (stable → anniversaires / dormants reviewables). PAS « aujourd'hui »
// réel : c'est un banc, pas l'écran opérationnel.
const DEMO_TODAY = new Date("2026-07-07T00:00:00Z");
const DEMO_WEEK_LABEL = "Semaine du 7 juillet 2026 (date de référence de démonstration)";
const DEMO_EVENT_DATE = "2026-07-08"; // prochaine soirée fictive (injectée dans les gabarits de message)

// Deux promoteurs de démonstration (identifiants fictifs).
const DEMO_PROMOTERS = [
  { id: "promo-demo-a", label: "Promo Démo A" },
  { id: "promo-demo-b", label: "Promo Démo B" },
] as const;

// ————————————————————————————————————————————————————————————————
// Clients de DÉMONSTRATION (100 % fictifs — préfixe « Démo », numéros réservés +33 6 00 00 00 0x).
// Aucun vrai client. Ils couvrent les 5 motifs + les cas de refus (opt-out, pas de consentement, pas de
// numéro) pour montrer que le bouton wa.me disparaît AVEC un motif explicite.
// ————————————————————————————————————————————————————————————————
function demoGuest(over: Partial<CallListGuest> & Pick<CallListGuest, "guest_id" | "first_name">): CallListGuest {
  return {
    last_name: null,
    owner_promoter: "promo-demo-a",
    phone: null,
    consent_marketing: true,
    opt_out: false,
    birthday: null,
    segment: "occasional",
    days_since_last_seated: null,
    spend_seated_12m: null,
    no_show_rate: null,
    upcoming_resa_date: null,
    ...over,
  };
}

const DEMO_GUESTS: CallListGuest[] = [
  // — Promo Démo A —
  demoGuest({
    guest_id: "d1",
    first_name: "Nadia",
    last_name: "Démo",
    phone: "+33600000001",
    // résa à venir + PAS de consentement marketing → confirm_j1 (SERVICE) : le lien passe quand même.
    consent_marketing: false,
    upcoming_resa_date: "2026-07-08",
    segment: "regular",
  }),
  demoGuest({
    guest_id: "d2",
    first_name: "Karim",
    last_name: "Démo",
    phone: "+33600000002",
    segment: "vip",
    spend_seated_12m: 3200,
    days_since_last_seated: 20,
  }),
  demoGuest({
    guest_id: "d3",
    first_name: "Sonia",
    last_name: "Démo",
    phone: "+33600000003",
    // VIP mais STOP reçu → aucun lien (motif « opt-out » affiché).
    segment: "vip",
    spend_seated_12m: 2800,
    opt_out: true,
  }),
  demoGuest({
    guest_id: "d4",
    first_name: "Théo",
    last_name: "Démo",
    phone: "+33600000004",
    segment: "one_shot",
    spend_seated_12m: 1500,
    days_since_last_seated: 6, // dans la fenêtre 7-10 j
  }),
  demoGuest({
    guest_id: "d5",
    first_name: "Léa",
    last_name: "Démo",
    phone: "+33600000005",
    birthday: "2000-07-15", // J-8 par rapport au 7 juillet
    segment: "regular",
  }),
  demoGuest({
    guest_id: "d6",
    first_name: "Marc",
    last_name: "Démo",
    phone: "+33600000006",
    segment: "dormant",
    days_since_last_seated: 50,
    spend_seated_12m: 900,
  }),
  // — Promo Démo B —
  demoGuest({
    guest_id: "d7",
    first_name: "Inès",
    last_name: "Démo",
    owner_promoter: "promo-demo-b",
    phone: "+33600000007",
    // VIP SANS consentement marketing → lien refusé (motif « pas de consentement »).
    segment: "vip",
    spend_seated_12m: 3000,
    consent_marketing: false,
  }),
  demoGuest({
    guest_id: "d8",
    first_name: "Paul",
    last_name: "Démo",
    owner_promoter: "promo-demo-b",
    phone: null, // aucun numéro → lien refusé (motif « pas de numéro »)
    segment: "dormant",
    days_since_last_seated: 55,
  }),
  demoGuest({
    guest_id: "d9",
    first_name: "Emma",
    last_name: "Démo",
    owner_promoter: "promo-demo-b",
    phone: "+33600000009",
    birthday: "2001-07-10", // J-3
    segment: "regular",
  }),
];

export default function CallListPreviewPage() {
  const [promoterId, setPromoterId] = useState<(typeof DEMO_PROMOTERS)[number]["id"]>("promo-demo-a");

  const promoter = DEMO_PROMOTERS.find((p) => p.id === promoterId) ?? DEMO_PROMOTERS[0];

  // Filtre « SES clients » (démonstration). En réel : RLS 0013, jamais un filtre applicatif.
  const result = useMemo(() => {
    const mine = DEMO_GUESTS.filter((g) => g.owner_promoter === promoterId);
    return buildCallList(mine, DEMO_TODAY);
  }, [promoterId]);

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : c'est un banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai client. Ces 9 fiches sont des fictions de démonstration (préfixe « Démo »,
          numéros réservés). Aucun message n&apos;est envoyé : l&apos;outil prépare un lien wa.me que
          l&apos;humain clique. L&apos;écran réel se branche sur <code>guest_scores</code> (RLS : chaque
          promoteur ne voit que SES clients) — chunk d&apos;intégration séparé, LABO d&apos;abord.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Call-list du mardi — aperçu</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Le rituel hebdomadaire du CRM V1 : par promoteur, 15-25 noms max, chacun avec son « pourquoi »,
          un lien wa.me prêt (ou un refus motivé) et un traçage local du résultat.
        </p>
      </header>

      {/* Sélecteur de promoteur (démonstration du cantonnement « SES clients »). */}
      <div className="mb-4 flex flex-wrap gap-2">
        {DEMO_PROMOTERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPromoterId(p.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
              promoterId === p.id
                ? "border-white/40 bg-white/15 text-white"
                : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white/80"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <CallListBoard
        result={result}
        promoterLabel={promoter.label}
        weekLabel={DEMO_WEEK_LABEL}
        eventDate={DEMO_EVENT_DATE}
      />
    </main>
  );
}
