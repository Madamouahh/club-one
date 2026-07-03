"use client";

// app/artist-checkin-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (ARTIST CHECK-IN, A8).
//
// Raison d'être : les composants ArtistCheckinBoard (tableau d'accueil des artistes) et
// ArtistCheckinComposer (création d'une fiche, direction seule) et leur logique PURE
// (lib/artistCheckin — tri, jalons arrivée/balance/tech, résumé, gardes de rôle A8) étaient
// construits et testés mais n'étaient montés NULLE PART (comme l'étaient FloorPlan S51,
// VenueTableEditor S52, le flux résa S53, la call-list S54, le scan porte S55, le cockpit Mode
// Soirée S56, les checklists S57 avant leur aperçu). Cette page câble les composants RÉELS à des
// données FICTIVES étiquetées, pour que le fondateur voie la fiche d'accueil tourner : avancement
// arrivée → balance → tech → prêt scène, saisie d'une fiche — et, surtout, le CADRAGE DE RÔLE
// (miroir de la RLS 0027 : seules direction + sécurité voient l'accueil ; seule la direction crée
// et fait avancer une fiche ; la sécurité voit en lecture seule ; serveur / compteur / promoteur
// n'ont AUCUN accès).
//
// Périmètre volontairement étroit et SÛR (même discipline que /checklist-preview, /mode-soiree-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les données sont un JEU DE DÉMONSTRATION en mémoire. En réel,
//     app/page.tsx charge les fiches via des requêtes déjà filtrées par la RLS 0027 et fait les écritures
//     (insert fiche / avancement de statut) sous RLS. Ici, avancer/composer ne touche qu'un ÉTAT LOCAL
//     simulé qui miroite artist_checkins côté serveur — JAMAIS une sécurité, JAMAIS une écriture ;
//   · les composants NE DUPLIQUENT AUCUNE règle : le board appelle sortForBoard/summarizeCheckins/
//     checkinSteps/canManageArtistCheckin, le composer appelle validateCheckinDraft/canManageArtistCheckin
//     (les MÊMES fonctions que la production). Changer le rôle rejoue exactement le cadrage réel — c'est
//     ce qui rend la démo honnête ;
//   · toutes les fiches sont des FICTIONS de démonstration (noms de scène « (démo) », auteurs « démo »,
//     dates de banc fixes). AUCUN vrai artiste, AUCUN vrai cachet n'est lu ni inventé en base ;
//   · AUCUNE écriture, AUCUN envoi, AUCUNE mise en ligne.

import { useMemo, useRef, useState } from "react";

import ArtistCheckinBoard from "@/components/ArtistCheckinBoard";
import ArtistCheckinComposer from "@/components/ArtistCheckinComposer";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import {
  canManageArtistCheckin,
  canViewArtistCheckin,
  summarizeCheckins,
  type ArtistCheckin,
  type CheckinDraft,
  type CheckinStatus,
} from "@/lib/artistCheckin";

// ————————————————————————————————————————————————————————————————
// Repères de banc STABLES (aucun new Date() → aucun décalage de fuseau, valeurs figées de démonstration).
// ————————————————————————————————————————————————————————————————
const REF_DATE = "2026-07-07";
const TS = "2026-07-07T20:00:00.000Z";
const TS_ARR = "2026-07-07T23:30:00.000Z";
const TS_BAL = "2026-07-08T00:10:00.000Z";
const TS_TECH = "2026-07-08T00:20:00.000Z";

function checkin(
  over: Partial<ArtistCheckin> &
    Pick<ArtistCheckin, "id" | "artist_name" | "status">,
): ArtistCheckin {
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

// Jeu de fiches FICTIF couvrant plusieurs états du cycle de vie pour rendre visible l'avancement :
// un artiste attendu (aucun jalon), un arrivé (balance à faire), un prêt scène (3 jalons franchis),
// un no-show (statut terminal négatif). AUCUN artiste réel : noms « (démo) », cachets absents.
const DEMO_CHECKINS: ArtistCheckin[] = [
  checkin({
    id: "ac-1",
    artist_name: "DJ Aurore (démo)",
    status: "attendu",
    slot_label: "00h-02h",
    companions: 2,
    dressing_room: "A",
    contact: "manager (démo)",
    created_at: "2026-07-07T18:00:00.000Z",
  }),
  checkin({
    id: "ac-2",
    artist_name: "Collectif Néon (démo)",
    status: "arrive",
    slot_label: "02h-04h",
    companions: 4,
    dressing_room: "B",
    arrived_at: TS_ARR,
    rider_notes: "Eau plate + serviettes (démo)",
    created_at: "2026-07-07T18:05:00.000Z",
  }),
  checkin({
    id: "ac-3",
    artist_name: "MC Halo (démo)",
    status: "pret",
    slot_label: "04h-06h",
    companions: 1,
    dressing_room: "A",
    arrived_at: TS_ARR,
    soundcheck_at: TS_BAL,
    tech_validated_at: TS_TECH,
    tech_validated_by: "manager-demo",
    material_notes: "Micro SM58 + retour (démo)",
    created_at: "2026-07-07T18:10:00.000Z",
  }),
  checkin({
    id: "ac-4",
    artist_name: "Invité surprise (démo)",
    status: "no_show",
    slot_label: null,
    companions: 0,
    created_at: "2026-07-07T18:15:00.000Z",
  }),
];

// ————————————————————————————————————————————————————————————————
// Ce que chaque rôle est censé voir/faire (repère de lecture pour le fondateur — dérivé de la matrice A8
// §4.2, PAS une seconde source de vérité : le board réel est calculé par lib/artistCheckin ci-dessous).
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
  if (!canViewArtistCheckin(role)) {
    return "Aucun accueil artiste (serveur / compteur / promoteur exclus — matrice A8).";
  }
  return canManageArtistCheckin(role)
    ? "Voit toutes les fiches · crée et fait avancer une fiche"
    : "Voit les fiches en LECTURE SEULE (sécurité : pas de création ni d'avancement)";
}

export default function ArtistCheckinPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  // État LOCAL simulé (miroir client de artist_checkins — aucune écriture réelle).
  const [checkins, setCheckins] = useState<ArtistCheckin[]>(DEMO_CHECKINS);
  // Compteur déterministe pour les id de fiches ajoutées (aucun Math.random, aucun new Date()).
  const addedCount = useRef(0);

  // onAdvance simulé : le board n'affiche le bouton QUE si canManageArtistCheckin (aucune règle dupliquée
  // ici). Ce simulateur reflète l'écriture serveur : passe le statut et, en marquant l'arrivée, pose le
  // timestamp arrived_at (miroir de ce que fait app/page.tsx sous RLS). Aucun jalon n'est inventé au-delà.
  async function handleAdvance(id: string, next: CheckinStatus): Promise<void> {
    setCheckins((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const arrived_at =
          next === "arrive" && c.arrived_at === null ? TS_ARR : c.arrived_at;
        return { ...c, status: next, arrived_at, updated_at: TS };
      }),
    );
  }

  // onSubmit simulé : le composer a DÉJÀ validé le brouillon (validateCheckinDraft) et n'est rendu que
  // pour la direction (canManageArtistCheckin). Ce simulateur ajoute la fiche à l'état local avec des
  // champs serveur fabriqués de façon déterministe (id incrémental, dates de banc) — aucune écriture réelle.
  async function handleAddCheckin(draft: CheckinDraft): Promise<void> {
    addedCount.current += 1;
    const fiche = checkin({
      id: `ac-new-${addedCount.current}`,
      artist_name: `${draft.artist_name} (démo)`,
      status: "attendu",
      slot_label: draft.slot_label ?? null,
      companions: draft.companions ?? 0,
      dressing_room: draft.dressing_room ?? null,
      contact: draft.contact ?? null,
      rider_notes: draft.rider_notes ?? null,
      material_notes: draft.material_notes ?? null,
      auteur_username: `${role}-demo`,
      created_at: `2026-07-07T19:0${addedCount.current}:00.000Z`,
    });
    setCheckins((prev) => [...prev, fiche]);
  }

  function reset() {
    setCheckins(DEMO_CHECKINS);
    addedCount.current = 0;
  }

  // Récap honnête : agrégat calculé par la MÊME fonction que la production (summarizeCheckins).
  const summary = useMemo(() => summarizeCheckins(checkins), [checkins]);

  const viewable = canViewArtistCheckin(role);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai artiste, aucun vrai cachet. En réel, <code>app/page.tsx</code> charge les fiches
          d&apos;accueil déjà filtrées par la RLS (<code>0027</code>) et fait les écritures (création /
          avancement) sous RLS. Ici, avancer et composer ne touchent qu&apos;un{" "}
          <strong>état local simulé</strong> ; le board et le composer sont calculés par les MÊMES fonctions
          que la production (<code>sortForBoard</code>, <code>checkinSteps</code>,{" "}
          <code>validateCheckinDraft</code>, <code>canManageArtistCheckin</code>). Changer le rôle rejoue
          exactement le cadrage réel. Ce banc n&apos;exerce que la présentation, JAMAIS une sécurité.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Accueil artiste (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Fiche d&apos;accueil du soir (A8) : arrivée, loge, balance, validation technique, prêt scène.
          Avancement dérivé UNIQUEMENT des jalons des fiches reçues (états vides honnêtes : aucune fiche →
          des zéros, jamais un artiste fabriqué).
        </p>
      </header>

      {/* Sélecteur de rôle : démontre le cadrage (miroir de la RLS 0027), pas une sécurité applicative. */}
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
          Rôle <code>{role}</code> ·{" "}
          {viewable ? "accueil accessible" : "accueil fermé"} — attendu : {roleExpectation(role)}
        </p>
      </section>

      {viewable ? (
        <>
          {/* Le composant RÉEL de composition — n'apparaît que pour la direction (canManageArtistCheckin). */}
          <section className="mb-5">
            <ArtistCheckinComposer
              role={role}
              exploitationDate={REF_DATE}
              eventId={null}
              onSubmit={handleAddCheckin}
            />
            {!canManageArtistCheckin(role) && (
              <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/40">
                Composition masquée pour ce rôle : la sécurité voit l&apos;accueil en LECTURE SEULE
                (seule la direction crée et fait avancer une fiche — matrice A8).
              </p>
            )}
          </section>

          {/* Le board RÉEL, alimenté par l'état local simulé. */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
            <ArtistCheckinBoard checkins={checkins} role={role} onAdvance={handleAdvance} />
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          Onglet Accueil artiste non disponible pour ce rôle. Serveur, compteur et promoteur n&apos;ont
          aucun accès à l&apos;accueil des artistes (matrice A8, miroir de la RLS 0027).
        </section>
      )}

      {/* Récapitulatif honnête : agrégat calculé par summarizeCheckins (même fonction que la production). */}
      <section className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[12px] text-white/60">
        <span>
          Fiches : <span className="text-white/80">{summary.total}</span>
        </span>
        <span>
          Attendus : <span className="text-white/80">{summary.attendus}</span> · arrivés :{" "}
          <span className="text-white/80">{summary.arrives}</span> · prêts :{" "}
          <span className="text-white/80">{summary.prets}</span>
        </span>
        {summary.noShow > 0 && (
          <span className="text-rose-300">no-show : {summary.noShow}</span>
        )}
        <span>
          Entourage total : <span className="text-white/80">{summary.accompagnants}</span>
        </span>
        <button
          type="button"
          onClick={reset}
          className="ml-auto rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70 hover:text-white"
        >
          Réinitialiser le banc
        </button>
      </section>
    </main>
  );
}
