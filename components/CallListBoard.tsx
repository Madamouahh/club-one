"use client";

// components/CallListBoard.tsx — LA CALL-LIST DU MARDI (CRM V1, spec MODULE_CRM_CLIENTS_VIP.md §V1).
//
// Composant PRÉSENTATIONNEL : aucun réseau, aucun Supabase. On lui passe le résultat DÉJÀ construit par
// buildCallList (lib/crmCallList, pur + testé) — la priorisation, les plafonds et le « pourquoi » sont
// calculés en amont. Le composant se contente d'AFFICHER et de préparer, pour chaque client, le lien
// wa.me via buildCallEntryContact (qui refait TOUTES les gardes : opt-out, consentement marketing, loi
// Évin, numéro absent). Il n'accorde aucun droit et n'envoie RIEN.
//
// Règles dures rappelées à l'écran (spec §V1) :
//   · AUCUN envoi automatisé : l'outil PRÉPARE un lien wa.me, LE PROMOTEUR clique et envoie depuis SON
//     téléphone. Techniquement, aucun message ne peut partir d'ici.
//   · bouton wa.me ABSENT si le contact est refusé (opt-out / pas de consentement / Évin / pas de
//     numéro) — et on DIT pourquoi (jamais un refus muet).
//   · LOI ÉVIN : le message est revalidé à chaque frappe (checkMessageEvin via buildCallEntryContact) —
//     toute mention d'alcool coupe le lien.
//   · résultat tracé localement (booked / no_answer / declined / opt_out) : ici c'est un BROUILLON LOCAL
//     non persisté ; l'écriture réelle dans guest_contacts (0013) est le branchement d'un chunk séparé.

import { useMemo, useState } from "react";

import {
  CALL_REASON_META,
  buildCallEntryContact,
  suggestCallMessage,
  tallyCallReasons,
  CONTACT_REFUSAL_LABEL,
  type CallListEntry,
  type CallListResult,
  type CallReason,
} from "@/lib/crmCallList";
import { GUEST_SEGMENT_LABELS } from "@/lib/crmClients";

// Résultat d'appel journalisé (miroir strict de la spec §V1 : booked/no_answer/declined/opt_out).
// Ici uniquement en mémoire (brouillon local) : l'écriture réelle est un chunk d'intégration séparé.
const CALL_OUTCOMES = [
  { key: "booked", label: "Réservé", tone: "emerald" },
  { key: "no_answer", label: "Pas de réponse", tone: "slate" },
  { key: "declined", label: "Décliné", tone: "amber" },
  { key: "opt_out", label: "STOP (opt-out)", tone: "red" },
] as const;
type CallOutcome = (typeof CALL_OUTCOMES)[number]["key"];

// Couleur d'accent par motif (UI seulement — la priorité vient de CALL_REASON_META).
const REASON_TONE: Record<CallReason, string> = {
  confirm_j1: "#34d399", // service contractuel (le plus prioritaire)
  vip_no_resa: "#a78bfa",
  one_shot: "#f472b6",
  birthday: "#fbbf24",
  dormant: "#60a5fa",
};

function CallCard({ entry, eventDate }: { entry: CallListEntry; eventDate?: string | null }) {
  const meta = CALL_REASON_META[entry.reason];
  const [message, setMessage] = useState(() =>
    suggestCallMessage(entry.reason, entry.guest.first_name, eventDate ?? undefined),
  );
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);

  // Le lien wa.me est recalculé à CHAQUE frappe : toute mention d'alcool (Évin) ou un client opt-out
  // coupe immédiatement le lien, avec un motif explicite.
  const prep = useMemo(() => buildCallEntryContact(entry, message), [entry, message]);
  const tone = REASON_TONE[entry.reason];
  const g = entry.guest;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">
            {g.first_name} {g.last_name ?? ""}
          </p>
          <p className="text-[11px] text-white/45">
            {GUEST_SEGMENT_LABELS[g.segment]}
            {g.owner_promoter ? ` · ${g.owner_promoter}` : ""}
            {g.phone ? ` · ${g.phone}` : " · aucun numéro"}
          </p>
          <p className="mt-1 text-[11px] italic text-white/55">{entry.why}</p>
        </div>
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ borderColor: tone, color: tone }}
        >
          {meta.label}
        </span>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        className="mt-3 w-full resize-none rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-white/40"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {prep.ok ? (
          <a
            href={prep.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/25"
          >
            Ouvrir wa.me ↗
          </a>
        ) : (
          // Refus MOTIVÉ (jamais un bouton muet) — miroir de ContactPrep.reason.
          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/50">
            Lien indisponible — {CONTACT_REFUSAL_LABEL[prep.reason]}
          </span>
        )}
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            color: meta.waPurpose === "service" ? "#34d399" : "#a78bfa",
          }}
        >
          {meta.waPurpose === "service" ? "service (contractuel)" : "marketing"}
        </span>
      </div>

      {/* Traçage LOCAL du résultat (brouillon, non persisté). */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {CALL_OUTCOMES.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setOutcome(outcome === o.key ? null : o.key)}
            className={`rounded-md border px-2 py-1 text-[10px] font-bold transition ${
              outcome === o.key
                ? "border-white/40 bg-white/15 text-white"
                : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white/80"
            }`}
          >
            {o.label}
          </button>
        ))}
        <span className="text-[10px] text-white/30">brouillon local — non enregistré</span>
      </div>
    </div>
  );
}

export function CallListBoard({
  result,
  promoterLabel,
  weekLabel,
  eventDate,
}: {
  result: CallListResult;
  promoterLabel: string;
  weekLabel: string;
  eventDate?: string | null;
}) {
  const tally = tallyCallReasons(result.entries);
  const contactable = result.entries.filter(
    (e) => buildCallEntryContact(e, suggestCallMessage(e.reason, e.guest.first_name, eventDate ?? undefined)).ok,
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">
            Call-list · {promoterLabel}
          </p>
          <p className="text-[11px] text-white/45">{weekLabel}</p>
        </div>
        <p className="mt-2 text-[11px] text-white/55">
          <span className="font-bold text-white">{result.entries.length}</span> à appeler ·{" "}
          <span className="font-bold text-emerald-300">{contactable}</span> contactables (lien prêt)
          {result.entries.length > 0 && " · ≤ 30 messages/jour conseillé (anti-ban)"}
        </p>
        {result.entries.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/45">
            {(Object.keys(tally) as CallReason[])
              .filter((r) => tally[r] > 0)
              .map((r) => (
                <span key={r}>
                  <span style={{ color: REASON_TONE[r] }}>●</span> {CALL_REASON_META[r].label} :{" "}
                  <span className="font-bold text-white/70">{tally[r]}</span>
                </span>
              ))}
          </p>
        )}
        {/* Honnêteté : ce qui a été ÉCARTÉ par les plafonds (jamais silencieux). */}
        {(result.dormantDropped > 0 || result.totalDropped > 0) && (
          <p className="mt-1 text-[11px] text-amber-300/80">
            {result.eligibleCount} éligibles ·{" "}
            {result.dormantDropped > 0 && `${result.dormantDropped} dormants écartés (plafond 5/sem) `}
            {result.totalDropped > 0 && `· ${result.totalDropped} au-delà du plafond 25`}
          </p>
        )}
      </div>

      {result.entries.length === 0 ? (
        // État vide HONNÊTE : aucun client n'entre dans le rituel (jamais une liste fabriquée).
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/45">
          Aucun client à appeler cette semaine.
        </div>
      ) : (
        result.entries.map((e) => <CallCard key={e.guest.guest_id} entry={e} eventDate={eventDate} />)
      )}
    </div>
  );
}
