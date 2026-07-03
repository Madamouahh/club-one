"use client";

// components/InboxTriageBoard.tsx — DEMANDES / INBOX TRIÉES direction/com (B13).
//
// Composant PRÉSENTATIONNEL : AUCUN réseau. On lui passe une vue déjà agrégée par buildInboxTriage
// (lib/inboxTriage) — construite en amont à partir des demandes du formulaire de contact public
// (bloc 08 « vous êtes »), déjà filtrées par la RLS des tables de demandes. Il ne recalcule ni ne
// redécide rien ; il n'accorde aucun droit :
//   · B13 est réservé à la DIRECTION / COM (admin/manager) — garde canViewInbox. Tout autre rôle → fermeture.
//   · AUCUN ENVOI : « Valider & envoyer » PRÉPARE un lien wa.me/mailto que l'humain clique. Le statut
//     `repondu` n'est jamais posé par l'app — c'est un geste humain. On ne fabrique aucun message.
//   · HONNÊTETÉ ASSUMÉE À L'ÉCRAN : une demande sans champ « vous êtes » est marquée « à trier »
//     (jamais devinée) ; un âge/retard non calculable s'affiche « — » (jamais un faux « à l'heure »).

import { useState } from "react";

import type { StaffRole } from "@/lib/permissions";
import {
  canReplyInbox,
  canViewInbox,
  formatAge,
  prepareReplyLink,
  requestStatusLabel,
  requesterTypeLabel,
  type InboxRequestRow,
  type InboxTriageView,
  type QueueSummary,
  type RequestStatus,
} from "@/lib/inboxTriage";

const STATUS_STYLE: Record<RequestStatus, { dot: string; text: string }> = {
  nouveau: { dot: "bg-sky-400", text: "text-sky-300" },
  en_cours: { dot: "bg-amber-400", text: "text-amber-300" },
  repondu: { dot: "bg-emerald-400", text: "text-emerald-300" },
  clos: { dot: "bg-white/30", text: "text-white/45" },
};

function RequestRow({ row, canReply }: { row: InboxRequestRow; canReply: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const s = STATUS_STYLE[row.status];
  // Message de service NEUTRE : aucun contenu injecté (l'humain écrit sa réponse ; aucune mention
  // d'alcool — loi Evin). Ici, texte vide au clic : on ouvre le canal, l'humain compose.
  const prep = prepareReplyLink({ contact: row.contact, subject: row.subject }, "");

  return (
    <div
      className={`rounded-xl border ${
        row.overdue ? "border-rose-500/40 bg-rose-500/[0.04]" : "border-white/10 bg-white/[0.02]"
      } p-3`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{row.subject}</p>
          <p className="mt-0.5 text-[11px] text-white/45">
            {row.displayName}
            {" · "}
            {row.requesterType ? requesterTypeLabel(row.requesterType) : "profil non renseigné"}
            {!row.routed && <span className="ml-1 text-amber-300/80">· à trier</span>}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
          <span className={`text-[10px] font-bold uppercase tracking-wide ${s.text}`}>
            {requestStatusLabel(row.status)}
          </span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45">
        <span>
          Attente : <strong className="text-white/70">{formatAge(row.ageHours)}</strong>
          {row.overdue && <span className="ml-1 font-semibold text-rose-300">en retard</span>}
        </span>
        {row.hasDraft && <span className="text-white/60">brouillon prêt</span>}
        <span className="text-white/30">SLA {row.slaHours} h</span>
      </div>

      {/* « Valider & envoyer » = geste HUMAIN. Le bouton PRÉPARE le lien, n'envoie rien. */}
      {row.waiting && (
        <div className="mt-2.5">
          {!canReply ? (
            <p className="text-[11px] text-white/35">Réponse réservée à la direction / com.</p>
          ) : prep.ok ? (
            !revealed ? (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-500/20"
              >
                Valider &amp; envoyer (prépare le lien {prep.channel === "wa" ? "WhatsApp" : "e-mail"})
              </button>
            ) : (
              <a
                href={prep.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-1.5 text-[11px] font-bold text-emerald-100"
              >
                Ouvrir {prep.channel === "wa" ? "WhatsApp" : "l’e-mail"} → répondre à la main
              </a>
            )
          ) : (
            <p className="text-[11px] text-white/35">
              Aucun contact exploitable — impossible de préparer un lien (jamais d’envoi fabriqué).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function QueueColumn({
  summary,
  rows,
  canReply,
}: {
  summary: QueueSummary;
  rows: InboxRequestRow[];
  canReply: boolean;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-white/60">{summary.title}</p>
        <span className="text-[10px] text-white/40">
          {summary.total} demande{summary.total > 1 ? "s" : ""}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/45">
        <span>{summary.waiting} en attente</span>
        {summary.overdue > 0 && <span className="text-rose-300">{summary.overdue} en retard</span>}
        {summary.withDraft > 0 && <span>{summary.withDraft} brouillon(s)</span>}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-white/30">
          Aucune demande dans cette file.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <RequestRow key={row.id} row={row} canReply={canReply} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function InboxTriageBoard({
  view,
  role,
}: {
  view: InboxTriageView;
  role: StaffRole;
}) {
  // Garde UI (palier direction/com). B13 contient des PII : la vraie garde reste la RLS des tables
  // de demandes ; ce prédicat ne fait que refléter le périmètre direction côté écran.
  if (!canViewInbox(role)) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Les demandes / l’inbox triée sont réservées à la direction / com (admin / manager, matrice B13).
        Ce rôle n’y a aucun accès (les demandes contiennent des coordonnées personnelles).
      </p>
    );
  }

  const { queues, rowsByQueue, totals, slaComputable } = view;
  const canReply = canReplyInbox(role);

  return (
    <div className="space-y-5">
      {/* Synthèse globale honnête. */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">
            Demandes &amp; inbox triée
          </p>
          <span className="text-[11px] text-white/45">
            {canReply ? "Vue direction — réponse humaine (aucun envoi automatisé)" : "Vue direction — consultation"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">En attente</p>
            <p className="text-base font-bold text-white">{totals.waiting}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">En retard</p>
            <p className="text-base font-bold text-white">
              {slaComputable ? totals.overdue : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Brouillons</p>
            <p className="text-base font-bold text-white">{totals.withDraft}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Répondu / clos</p>
            <p className="text-base font-bold text-white">
              {totals.repondu + totals.clos}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
          {totals.nonRoutes > 0 && (
            <span className="text-amber-300">
              {totals.nonRoutes} demande{totals.nonRoutes > 1 ? "s" : ""} sans profil — à trier à la main
            </span>
          )}
          {!slaComputable && (
            <span className="text-white/35">
              Retard non calculable (aucun instant de référence — jamais un faux « à l’heure »)
            </span>
          )}
        </div>
      </section>

      {/* Une colonne par file, ordre canonique. */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {queues.map((summary) => (
          <QueueColumn
            key={summary.queue}
            summary={summary}
            rows={rowsByQueue[summary.queue]}
            canReply={canReply}
          />
        ))}
      </section>

      <p className="text-[11px] leading-relaxed text-white/35">
        Aucun message n’est envoyé par l’app : « Valider &amp; envoyer » prépare un lien wa.me / e-mail
        que l’humain clique et rédige lui-même (réponse de service à une demande reçue). Une demande sans
        champ « vous êtes » tombe en file générale « à trier » — jamais devinée. Le retard n’est affirmé
        que contre un instant de référence réel.
      </p>
    </div>
  );
}
