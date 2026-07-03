"use client";

// components/ReputationBoard.tsx — RÉPUTATION & AVIS direction/com (B14).
//
// Composant PRÉSENTATIONNEL : AUCUN réseau. On lui passe une vue déjà agrégée par buildReputationView
// (lib/reputation) — construite en amont à partir des avis remontés par le connecteur Google/Meta,
// déjà filtrés par la RLS de la table d'avis. Il ne recalcule ni ne redécide rien ; il n'accorde aucun
// droit :
//   · B14 est réservé à la DIRECTION / COM (admin/manager) — garde canViewReputation. Tout autre rôle → fermeture.
//   · AUCUNE PUBLICATION : « Valider & répondre » PRÉPARE l'ouverture de l'avis sur sa plateforme ;
//     l'humain rédige sa réponse à la main. Le statut `repondu` n'est jamais posé par l'app. On n'injecte
//     aucun texte (loi Evin : aucune mention d'alcool ajoutée par l'outil).
//   · HONNÊTETÉ ASSUMÉE À L'ÉCRAN : sans avis réel le module est VIDE (jamais un faux « 5 étoiles ») ;
//     un sentiment non qualifié reste « non qualifié » (jamais deviné) ; un âge/retard non calculable
//     s'affiche « — » (jamais un faux « à l'heure »).

import { useState } from "react";

import type { StaffRole } from "@/lib/permissions";
import {
  canReplyReputation,
  canViewReputation,
  formatAge,
  formatRating,
  formatResponseRate,
  prepareReviewReplyLink,
  reviewPlatformLabel,
  reviewStatusLabel,
  sentimentLabel,
  type PlatformSummary,
  type ReputationView,
  type ReviewRow,
  type Sentiment,
} from "@/lib/reputation";

const SENTIMENT_STYLE: Record<Sentiment, { dot: string; text: string }> = {
  positif: { dot: "bg-emerald-400", text: "text-emerald-300" },
  neutre: { dot: "bg-sky-400", text: "text-sky-300" },
  negatif: { dot: "bg-rose-400", text: "text-rose-300" },
  inconnu: { dot: "bg-white/30", text: "text-white/45" },
};

const SENTIMENT_SOURCE_NOTE: Record<ReviewRow["sentimentSource"], string> = {
  explicit: "sentiment fourni",
  rating: "déduit de la note",
  unknown: "non qualifié (jamais deviné)",
};

function ReviewCard({ row, canReply }: { row: ReviewRow; canReply: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const s = SENTIMENT_STYLE[row.sentiment];
  const prep = prepareReviewReplyLink({ platform: row.platform, permalink: row.permalink });

  return (
    <div
      className={`rounded-xl border ${
        row.alerte
          ? "border-rose-500/40 bg-rose-500/[0.05]"
          : "border-white/10 bg-white/[0.02]"
      } p-3`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="truncate">{row.author}</span>
            {row.rating !== null && row.rating !== undefined && (
              <span className="shrink-0 text-[11px] font-bold text-amber-300">
                {row.rating}/5 ★
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-white/45">
            {reviewPlatformLabel(row.platform)}
            {" · "}
            {reviewStatusLabel(row.status)}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
          <span className={`text-[10px] font-bold uppercase tracking-wide ${s.text}`}>
            {sentimentLabel(row.sentiment)}
          </span>
        </span>
      </div>

      {row.text && (
        <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-white/60">« {row.text} »</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45">
        <span>
          Ancienneté : <strong className="text-white/70">{formatAge(row.ageHours)}</strong>
          {row.overdue && <span className="ml-1 font-semibold text-rose-300">en retard</span>}
        </span>
        {row.alerte && <span className="font-semibold text-rose-300">⚠ alerte négatif</span>}
        {row.hasDraft && <span className="text-white/60">brouillon prêt</span>}
        <span className="text-white/30">SLA {row.slaHours} h · {SENTIMENT_SOURCE_NOTE[row.sentimentSource]}</span>
      </div>

      {/* « Valider & répondre » = geste HUMAIN. Le bouton PRÉPARE l'ouverture de l'avis, ne publie rien. */}
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
                Valider &amp; répondre (ouvre l’avis sur {reviewPlatformLabel(row.platform)})
              </button>
            ) : (
              <a
                href={prep.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-1.5 text-[11px] font-bold text-emerald-100"
              >
                Ouvrir l’avis → répondre à la main sur la plateforme
              </a>
            )
          ) : (
            <p className="text-[11px] text-white/35">
              Aucun lien vers l’avis — répondre depuis la console {reviewPlatformLabel(row.platform)}
              {" "}(jamais de publication fabriquée).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PlatformCard({ summary }: { summary: PlatformSummary }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.1em] text-white/60">{summary.label}</p>
        <span className="text-[10px] text-white/40">
          {summary.total} avis{summary.total > 1 ? "" : ""}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/50">
        <span>
          Moyenne : <strong className="text-amber-300">{formatRating(summary.avgRating)}</strong>
        </span>
        <span>{summary.waiting} en attente</span>
        {summary.alertes > 0 && <span className="text-rose-300">{summary.alertes} alerte(s)</span>}
        {summary.overdue > 0 && <span className="text-rose-300">{summary.overdue} en retard</span>}
      </div>
      {summary.ratedCount === 0 && summary.total > 0 && (
        <p className="mt-1 text-[10px] text-white/30">Aucun avis noté — moyenne non calculable.</p>
      )}
    </div>
  );
}

export default function ReputationBoard({
  view,
  role,
}: {
  view: ReputationView;
  role: StaffRole;
}) {
  // Garde UI (palier direction/com). La vraie garde reste la RLS de la table d'avis ; ce prédicat ne
  // fait que refléter le périmètre direction côté écran.
  if (!canViewReputation(role)) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        La réputation &amp; les avis sont réservés à la direction / com (admin / manager, matrice B14).
        Ce rôle n’y a aucun accès.
      </p>
    );
  }

  const { rows, byPlatform, totals, ratingComputable, slaComputable } = view;
  const canReply = canReplyReputation(role);

  return (
    <div className="space-y-5">
      {/* Synthèse globale honnête. */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Réputation &amp; avis</p>
          <span className="text-[11px] text-white/45">
            {canReply ? "Vue direction — réponse humaine (aucune publication auto)" : "Vue direction — consultation"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Note moyenne</p>
            <p className="text-base font-bold text-amber-300">
              {ratingComputable ? formatRating(totals.avgRating) : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">En attente</p>
            <p className="text-base font-bold text-white">{totals.waiting}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Alertes négatives</p>
            <p className={`text-base font-bold ${totals.alertes > 0 ? "text-rose-300" : "text-white"}`}>
              {totals.alertes}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Taux de réponse</p>
            <p className="text-base font-bold text-white">{formatResponseRate(totals.responseRate)}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
          {totals.overdue > 0 && slaComputable && (
            <span className="text-rose-300">{totals.overdue} avis en retard de réponse</span>
          )}
          {!slaComputable && (
            <span className="text-white/35">
              Retard non calculable (aucun instant de référence — jamais un faux « à l’heure »)
            </span>
          )}
          {!ratingComputable && (
            <span className="text-white/35">Aucun avis noté — note moyenne non calculable (jamais fabriquée)</span>
          )}
        </div>
      </section>

      {/* Résumé par plateforme (structure toujours présente, même à zéro). */}
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {byPlatform.map((summary) => (
          <PlatformCard key={summary.platform} summary={summary} />
        ))}
      </section>

      {/* Liste des avis, triés : alertes/attente d'abord, négatifs prioritaires. */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-white/60">
          Avis ({rows.length})
        </p>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[12px] text-white/35">
            Aucun avis remonté. Le module reste <strong>vide</strong> tant qu’aucun connecteur Google /
            Meta réel n’alimente les avis — aucune note ni aucun avis n’est fabriqué.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <ReviewCard key={row.id} row={row} canReply={canReply} />
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-white/35">
        Aucune réponse n’est publiée par l’app : « Valider &amp; répondre » ouvre l’avis sur sa plateforme
        (Google Business / Meta) où l’humain rédige lui-même. Aucun texte n’est injecté (loi Evin). Le
        sentiment vient d’un champ fourni ou d’une note — jamais deviné depuis le texte. Sans avis réel, le
        module est vide : aucune note, aucun avis n’est inventé.
      </p>
    </div>
  );
}
