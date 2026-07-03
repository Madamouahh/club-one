"use client";

// app/resa-board-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (RÉSERVATIONS VUE SOIRÉE, A3).
//
// Raison d'être : le module A3 (banc d'accueil de la soirée) n'existait NULLE PART. Sa logique pure
// (lib/resaBoard : ne garde que les réservations approuvées, pointage d'arrivée humain, compteurs et
// couverts honnêtes, gardes direction/accueil ; test:resaboard vert) et son composant présentationnel
// (components/ReservationBoard) sont neufs cette session ; cette route les câble à un jeu de
// DÉMONSTRATION pour donner à voir le banc, avec pointage interactif (en mémoire).
//
// Les POINTS-CLÉS démontrés :
//   · A3 ≠ file resaRequest : le banc ne montre QUE les réservations APPROUVÉES (les `pending` restent
//     dans la file de décision) ; A3 ≠ compteur de porte (A4/A5) : on suit les tables réservées.
//   · POINTAGE HUMAIN : les boutons attendu / arrivé / no-show sont un geste de l'accueil ; le défaut est
//     « attendu », jamais deviné « arrivé » ni « no-show » à partir d'une horloge.
//   · BANC VIDE HONNÊTE : sans réservation approuvée, aucun invité n'est fabriqué.
//
// Périmètre volontairement étroit et SÛR (même discipline que /inbox-preview, /leads-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN Supabase — réservations en mémoire. En réel, app/page.tsx dérive ces lignes
//     de la table de réservations déjà filtrée par la RLS (0025) puis les passe à buildReservationBoard ;
//     le pointage reste un geste humain (aucune écriture par l'aperçu) ;
//   · le composant NE DUPLIQUE AUCUNE garde : il appelle canViewResaBoard / canMarkArrival ;
//   · aucune donnée réelle : clients et tables explicitement fictifs et étiquetés.

import { useMemo, useState } from "react";

import { ReservationBoard } from "@/components/ReservationBoard";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import {
  applyArrival,
  buildReservationBoard,
  canMarkArrival,
  canViewResaBoard,
  type ArrivalState,
} from "@/lib/resaBoard";
import { assemblePendingRow, type ReservationRequestRow } from "@/lib/resaRequest";

// Réservations 100 % FICTIVES et étiquetées. On part de brouillons `pending` déterministes (id +
// created_at fournis, aucune horloge) puis on les marque « approved » pour représenter la file après
// décision manager. Une réservation reste `pending` pour prouver qu'elle NE MONTE PAS sur le banc.
function demoRow(over: {
  id: string;
  createdAt: string;
  label: string;
  partySize: number;
  standing?: boolean;
  slot?: string | null;
  guestName: string;
  status?: ReservationRequestRow["status"];
}): ReservationRequestRow {
  const base = assemblePendingRow({
    id: over.id,
    createdAt: over.createdAt,
    table: { id: `t-${over.id}`, venue: "eden", standing: over.standing ?? false, label: over.label },
    guestId: `g-${over.id}`,
    eventId: "ev-demo",
    exploitationDate: "2026-07-03",
    partySize: over.partySize,
    slot: over.slot ?? null,
    guestNote: null,
    guestName: over.guestName,
    guestPhone: null, // aucune vraie coordonnée
  });
  return { ...base, status: over.status ?? "approved" };
}

type Scenario = "soiree" | "vide";

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "soiree", label: "Soirée en cours" },
  { key: "vide", label: "Aucune réservation validée" },
];

const DEMO_REQUESTS: ReservationRequestRow[] = [
  demoRow({ id: "r1", createdAt: "2026-07-03T18:00:00Z", label: "201", partySize: 6, slot: "23:00", guestName: "Client démo — A." }),
  demoRow({ id: "r2", createdAt: "2026-07-03T18:05:00Z", label: "205", partySize: 4, slot: "23:30", guestName: "Client démo — B.", standing: true }),
  demoRow({ id: "r3", createdAt: "2026-07-03T18:10:00Z", label: "Carré VIP", partySize: 8, slot: "00:00", guestName: "Client démo — C." }),
  demoRow({ id: "r4", createdAt: "2026-07-03T18:15:00Z", label: "112", partySize: 2, slot: null, guestName: "Client démo — D." }),
  // Reste `pending` : NE DOIT PAS apparaître sur le banc (prouve le filtre approved-only).
  demoRow({ id: "r5", createdAt: "2026-07-03T18:20:00Z", label: "118", partySize: 3, slot: "22:30", guestName: "Client démo — E.", status: "pending" }),
];

const SCENARIO_REQUESTS: Record<Scenario, ReservationRequestRow[]> = {
  soiree: DEMO_REQUESTS,
  vide: [DEMO_REQUESTS[4]], // uniquement la pending → banc vide honnête
};

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Accueil / compteur",
  promoter: "Promoteur",
};

export default function ResaBoardPreviewPage() {
  const [role, setRole] = useState<StaffRole>("manager");
  const [scenario, setScenario] = useState<Scenario>("soiree");
  // Pointage d'arrivée en mémoire (aucune écriture réseau) — geste humain simulé.
  const [arrivals, setArrivals] = useState<Record<string, ArrivalState>>({ r1: "arrive" });

  const view = useMemo(
    () => buildReservationBoard({ role, requests: SCENARIO_REQUESTS[scenario], arrivals }),
    [role, scenario, arrivals],
  );

  const onMark = (id: string, state: ArrivalState) =>
    setArrivals((prev) => applyArrival(prev, id, state));

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucune donnée réelle, aucune vraie coordonnée. Le banc de soirée (A3) affiche les réservations{" "}
          <strong>déjà validées</strong> (les demandes <code>pending</code> restent dans la file de décision).
          Le <strong>pointage d’arrivée</strong> (attendu / arrivé / no-show) est un geste humain de l’accueil,
          jamais déduit d’une horloge — le défaut est « attendu », jamais deviné. Changer le rôle rejoue le
          cadrage réel (<code>canViewResaBoard</code> / <code>canMarkArrival</code>).
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Réservations — vue soirée (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module A3 : le carnet d’accueil de la nuit. Il compose les réservations approuvées de la file
          (resaRequest / migration 0025) en un banc « qui vient · à quelle table · arrivé / pas encore /
          no-show ». Réservé à la direction et à l’accueil ; le pointage reste un geste humain.
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

      {/* Sélecteur de rôle : démontre la garde direction/accueil, pas une sécurité. */}
      <section className="mb-5">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
          Rôle du spectateur (le banc est réservé à la direction / l’accueil)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            const open = canViewResaBoard(r);
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
          {canViewResaBoard(role)
            ? canMarkArrival(role)
              ? "accès banc, peut pointer une arrivée (geste humain, aucune écriture par l’aperçu)"
              : "accès banc, consultation seule (ne clôt pas le pointage d’accueil)"
            : "aucun accès (message de fermeture)"}
        </p>
      </section>

      <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <ReservationBoard view={view} role={role} onMark={onMark} />
      </div>
    </main>
  );
}
