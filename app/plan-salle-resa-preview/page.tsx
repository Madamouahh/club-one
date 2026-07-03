"use client";

// app/plan-salle-resa-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (chunk 4 PLAN_SALLE_EDEN : FLUX RÉSA CLIENT).
//
// Raison d'être : le « cœur de la demande » fondateur (spec §3) — le SCHÉMA INTERACTIF DE RÉSA CLIENT —
// n'était monté nulle part. Ses briques existent et sont prouvées PURES (FloorPlan, TableReservationRequest,
// ReservationRequestQueue, lib/resaRequest), mais aucune route ne les câblait ENSEMBLE en une boucle que le
// fondateur puisse voir tourner : plan → tap d'une table libre → demande client (pending) → file staff →
// validation direction → le plan se met à jour. Cette page monte cette boucle DE BOUT EN BOUT, en local.
//
// Périmètre volontairement étroit et SÛR (même discipline que /plan-salle-preview S51 & /plan-salle-editor-preview S52) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — l'état des demandes vit dans un tableau React EN MÉMOIRE ;
//     les vraies RPC (request_table_reservation_v1 / decide_table_reservation_v1, SECURITY DEFINER + RLS
//     de la migration 0025) restent le branchement RÉEL d'un chunk d'intégration séparé, LABO d'abord ;
//   · AUCUN client inventé : la file démarre VIDE. Chaque demande visible est celle que le fondateur crée
//     lui-même en tapant le plan et en remplissant le formulaire (funnel réel : 4 champs + 18+ + consentements) ;
//   · aucune fausse disponibilité : la carte d'états du plan est DÉRIVÉE des demandes réelles en mémoire
//     (buildAvailabilityMap), jamais fabriquée ;
//   · AUCUN envoi : valider une demande la passe « approuvée » et rappelle que la confirmation de SERVICE
//     part manuellement (wa.me) — rien n'est expédié ici ;
//   · aucune mention d'alcool (les textes de consentement n'en contiennent pas ; garde loi Évin en amont).
//
// Ce n'est pas l'écran opérationnel : c'est le banc de démonstration de la boucle de résa pour le fondateur.

import { useMemo, useState } from "react";

import { FloorPlan } from "@/components/FloorPlan";
import { TableReservationRequest, type ReservationSubmitPayload } from "@/components/TableReservationRequest";
import { ReservationRequestQueue } from "@/components/ReservationRequestQueue";
import type { ConsentValues } from "@/lib/crmClients";
import {
  EDEN_SEED,
  seedToPct,
  tableKindLabel,
  type VenueTable,
} from "@/lib/venueTables";
import {
  applyResaDecision,
  assemblePendingRow,
  buildAvailabilityMap,
  canDecideResa,
  resaQueueSummary,
  type ReservationRequestRow,
  type ResaDecision,
} from "@/lib/resaRequest";

// Les 44 tables Eden dérivées de la transcription (mêmes maths %→SVG que le seed SQL 0024).
const EDEN_TABLES: VenueTable[] = EDEN_SEED.map((entry) => {
  const { x_pct, y_pct } = seedToPct(entry);
  return {
    id: `eden-${entry.label}`,
    venue: "eden",
    label: entry.label,
    x_pct,
    y_pct,
    shape: entry.shape,
    standing: entry.standing,
    capacity: entry.cap,
    active: true,
  };
});

// Contexte de soirée du banc (fictif, explicitement étiqueté). Aucune vraie clôture / event chargé.
const DEMO_EVENT_TITLE = "Soirée de démonstration";
const DEMO_EVENT_DATE = "2026-07-03"; // sert AUSSI de date de référence pour le contrôle 18+ (registrationRefDate)

// Rôles staff proposés pour DÉMONTRER la garde de décision (miroir RLS : seule la direction décide).
const STAFF_ROLES = ["manager", "promoter", "server", "security"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

export default function PlanSalleResaPreviewPage() {
  // File de demandes EN MÉMOIRE — démarre VIDE (aucun client inventé). Le fondateur la remplit lui-même.
  const [requests, setRequests] = useState<ReservationRequestRow[]>([]);
  // Table sélectionnée sur le plan (côté client) → ouvre le formulaire de demande.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Rôle staff simulé (démontre que promoteur/serveur/sécurité NE peuvent PAS valider).
  const [role, setRole] = useState<StaffRole>("manager");
  // Compteur monotone local pour des id de demande stables et déterministes (pas de Math.random).
  const [seq, setSeq] = useState(0);
  // Bascule d'aperçu des textes de consentement avec une raison sociale de DÉMONSTRATION (fictive).
  const [demoConsent, setDemoConsent] = useState(false);

  // Carte d'états DÉRIVÉE des demandes réelles (pending → demandée, approved → confirmée). Jamais fabriquée.
  const availability = useMemo(() => buildAvailabilityMap(requests), [requests]);
  const summary = useMemo(() => resaQueueSummary(requests), [requests]);

  const selected = EDEN_TABLES.find((t) => t.id === selectedId) ?? null;

  // Consentements : par DÉFAUT la raison sociale est absente (état réel — en attente du fondateur), donc
  // les cases restent désactivées (le composant l'explique). Le mode démo injecte des mentions FICTIVES,
  // explicitement étiquetées, pour que le fondateur voie le rendu des textes — rien n'est journalisé (pas de base).
  const consentValues: ConsentValues = demoConsent
    ? {
        raisonSociale: "« Établissement Démo »",
        maxParMois: 4,
        lienPolitique: "https://exemple.test/confidentialite",
      }
    : { raisonSociale: null, maxParMois: null, lienPolitique: null };

  // Soumission client → crée une demande PENDING en mémoire (miroir de request_table_reservation_v1).
  async function handleSubmit(payload: ReservationSubmitPayload) {
    const table = EDEN_TABLES.find((t) => t.id === payload.venueTableId);
    if (!table) {
      return { ok: false, code: "table_not_found", message: "Table introuvable." };
    }
    const nextSeq = seq + 1;
    const row = assemblePendingRow({
      id: `demo-req-${nextSeq}`,
      // created_at RÉEL du navigateur (horodatage local du banc) — pas une date fabriquée.
      createdAt: new Date().toISOString(),
      table,
      guestId: `demo-guest-${nextSeq}`,
      eventId: null,
      exploitationDate: DEMO_EVENT_DATE,
      partySize: payload.partySize,
      slot: payload.slot,
      guestNote: payload.guestNote,
      guestName: [payload.firstName, payload.lastName].filter(Boolean).join(" ") || null,
      guestPhone: payload.phoneE164,
    });
    setRequests((prev) => [...prev, row]);
    setSeq(nextSeq);
    setSelectedId(null); // referme le formulaire ; le plan reflète aussitôt la table « demandée »
    return {
      ok: true,
      code: "pending",
      message: "Demande enregistrée (en attente de validation).",
    };
  }

  // Décision staff → met à jour la demande en mémoire (miroir de decide_table_reservation_v1).
  async function handleDecide(id: string, decision: ResaDecision, reason: string | null) {
    setRequests((prev) => applyResaDecision(prev, id, decision, role, reason, new Date().toISOString()));
  }

  function resetBench() {
    setRequests([]);
    setSelectedId(null);
    setSeq(0);
  }

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* En-tête honnête : ce que c'est, ce que ce n'est pas. */}
        <header className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#c8a24a]">
            Club One · Plan de salle — flux de réservation (aperçu)
          </p>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
            Eden — demande de résa client, de bout en bout
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-white/60">
            Banc de démonstration isolé de la <strong>boucle de réservation</strong> : à gauche, le client
            tape une table libre et remplit sa demande ; à droite, la direction la valide ou la refuse ; le
            plan se met à jour. Une demande naît toujours <strong>« en attente »</strong> — jamais une
            confirmation automatique. Ce n&apos;est <strong>pas</strong> l&apos;écran opérationnel.
          </p>
        </header>

        {/* Bandeau NON NÉGOCIABLE. */}
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[13px] leading-relaxed text-amber-100">
          <strong className="font-bold">Banc local — aucune écriture en base, aucun envoi, aucun vrai client.</strong>{" "}
          La file démarre vide : chaque demande est celle que vous créez ici. Le branchement réel aux RPC{" "}
          <code className="text-amber-200">request_table_reservation_v1</code> /{" "}
          <code className="text-amber-200">decide_table_reservation_v1</code> (avec RLS et contrôle 18+ côté
          PostgreSQL) est un chunk d&apos;intégration séparé, testé sur le LABO d&apos;abord. Valider une demande
          ne fait <strong>rien partir</strong> : la confirmation de service se fait manuellement (wa.me).
        </div>

        {/* Synthèse honnête de l'état de la file. */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Demandes" value={String(summary.total)} />
          <Stat label="En attente" value={String(summary.pending)} accent={summary.pending > 0} />
          <Stat label="Validées" value={String(summary.approved)} />
          <Stat label="Refusées" value={String(summary.declined)} />
        </section>

        {/* Contrôles du banc. */}
        <section className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-white/60">
            <span className="font-bold uppercase tracking-wide">Rôle staff simulé</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white outline-none focus:border-white/40"
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r} className="bg-[#111]">
                  {r}
                </option>
              ))}
            </select>
          </label>
          {!canDecideResa(role) && (
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/60">
              Ce rôle ne peut pas valider (garde RLS : direction seule).
            </span>
          )}
          <button
            type="button"
            onClick={() => setDemoConsent((v) => !v)}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white/80 transition hover:bg-white/10"
          >
            {demoConsent ? "Masquer les mentions de démonstration" : "Aperçu des textes de consentement (fictif)"}
          </button>
          {demoConsent && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-200">
              Mentions fictives — raison sociale réelle en attente
            </span>
          )}
          {summary.total > 0 && (
            <button
              type="button"
              onClick={resetBench}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white/60 transition hover:bg-white/10"
            >
              Vider le banc
            </button>
          )}
        </section>

        {/* Deux colonnes : CLIENT (plan + demande) · STAFF (file de validation). */}
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* ————— Côté CLIENT ————— */}
          <section className="space-y-4">
            <h2 className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Côté client</h2>

            {/* Plan en mode « live » : la carte d'états vient des demandes réelles en mémoire. */}
            <FloorPlan
              venue="eden"
              tables={EDEN_TABLES}
              availability={availability}
              selectedId={selectedId}
              onSelectTable={(table) => setSelectedId((cur) => (cur === table.id ? null : table.id))}
            />

            {/* Formulaire de demande de la table sélectionnée (funnel réel : 18+ + consentements dégroupés). */}
            {selected ? (
              <TableReservationRequest
                table={selected}
                availability={availability[selected.id]}
                eventTitle={DEMO_EVENT_TITLE}
                eventDate={DEMO_EVENT_DATE}
                consentValues={consentValues}
                onSubmit={handleSubmit}
              />
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center text-sm text-white/45">
                Touchez une table <span className="text-emerald-300">libre</span> sur le plan pour ouvrir une
                demande de réservation.
              </div>
            )}
          </section>

          {/* ————— Côté STAFF ————— */}
          <section className="space-y-4">
            <h2 className="text-xs font-black uppercase tracking-[0.18em] text-white/50">
              Côté direction — file de validation
            </h2>
            <ReservationRequestQueue requests={requests} role={role} onDecide={handleDecide} />
            {selected && (
              <p className="text-[11px] text-white/35">
                Table sélectionnée : <strong className="text-white/70">{selected.label}</strong> ·{" "}
                {tableKindLabel(selected)}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className={`text-2xl font-black ${accent ? "text-[#c8a24a]" : "text-white"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/45">{label}</p>
    </div>
  );
}
