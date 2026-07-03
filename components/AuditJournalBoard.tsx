"use client";

// components/AuditJournalBoard.tsx — JOURNAL D'AUDIT (module 0.5), écran direction.
//
// Composant PRÉSENTATIONNEL : AUCUN réseau. On lui passe une vue déjà agrégée par buildAuditJournal
// (lib/auditJournal) — construite à partir d'événements d'audit DÉJÀ produits et filtrés par la RLS
// (future table `audit_log`). Il ne recalcule ni ne redécide rien ; il n'accorde aucun droit :
//   · consultation réservée à la direction (canViewAuditJournal). Tout autre rôle → fermeture.
//   · l'ANNULATION (bouton « Annuler ») est un geste HUMAIN à fort risque, réservé à l'admin
//     (canRevertAuditEvent) et proposé uniquement pour une action réversible non déjà annulée ;
//     l'aperçu ne fait qu'un miroir d'UI (aucune écriture) — l'autorité reste une future RPC + la RLS.
//   · journal VIDE honnête : sans source d'audit branchée, aucune ligne n'est fabriquée.

import type { StaffRole } from "@/lib/permissions";
import {
  CATEGORY_STYLE,
  categoryLabel,
  type AuditCategory,
  type AuditJournalRow,
  type AuditJournalView,
} from "@/lib/auditJournal";

// Formatage FR déterministe d'un ISO → « 03/07 · 22:14 » (UTC, aucune horloge locale : le rendu doit
// être stable côté serveur comme client). On lit les composantes de la chaîne ISO sans new Date().
function formatAt(iso: string): string {
  // ISO attendu : YYYY-MM-DDTHH:MM(:SS)?(Z)? — parse tolérant, retombe sur la chaîne brute si illisible.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, , mo, d, h, min] = m;
  return `${d}/${mo} · ${h}:${min}`;
}

function CategoryBadge({ category }: { category: AuditCategory }) {
  const style = CATEGORY_STYLE[category];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ borderColor: style.stroke, color: style.text }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: style.stroke }} aria-hidden />
      {categoryLabel(category)}
    </span>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className={`text-lg font-bold ${tone ?? "text-white"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}

function JournalRow({
  row,
  canRevert,
  onRevert,
}: {
  row: AuditJournalRow;
  canRevert: boolean;
  onRevert?: (id: string, at: string) => void;
}) {
  const { event } = row;
  const canAct = canRevert && event.reversible && !row.reverted;
  return (
    <div
      className={`rounded-xl border p-3 ${
        row.reverted ? "border-white/10 bg-white/[0.01]" : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {row.actionLabel}
            {row.reverted && (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-white/40">
                (annulée)
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-white/45">
            {event.actor}
            {event.actorRole ? ` (${event.actorRole})` : " (rôle non joint)"}
            {" · "}
            {formatAt(event.at)}
            {event.targetLabel ? ` · ${event.targetLabel}` : ""}
            {event.venue ? ` · ${event.venue}` : ""}
          </p>
        </div>
        <CategoryBadge category={row.category} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {event.reversible ? (
          row.reverted ? (
            <span className="text-[11px] text-white/40">
              Annulée{row.revertedAt ? ` le ${formatAt(row.revertedAt)}` : ""}
            </span>
          ) : (
            <span className="text-[11px] text-emerald-300/70">Réversible</span>
          )
        ) : (
          <span className="text-[11px] text-white/30">Non réversible</span>
        )}
        {canAct && (
          <button
            type="button"
            onClick={() => onRevert?.(event.id, event.at)}
            className="rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-200 transition hover:border-rose-400/70 hover:text-rose-100"
          >
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

export function AuditJournalBoard({
  view,
  role,
  onRevert,
}: {
  view: AuditJournalView;
  role: StaffRole;
  onRevert?: (id: string, at: string) => void;
}) {
  if (!view.canView) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm text-white/60">
          Le journal d’audit (qui a fait quoi) est réservé à la direction.
        </p>
        <p className="mt-1 text-[11px] text-white/35">Rôle courant : {role}.</p>
      </div>
    );
  }

  const { summary, rows } = view;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="Événements" value={String(summary.total)} />
        <SummaryTile label="Auteurs distincts" value={String(summary.distinctActors)} />
        <SummaryTile
          label="Sensibles"
          value={String(summary.sensitiveCount)}
          tone={summary.sensitiveCount > 0 ? "text-rose-300" : "text-white/70"}
        />
        <SummaryTile
          label="Annulées"
          value={String(summary.revertedCount)}
          tone={summary.revertedCount > 0 ? "text-amber-300" : "text-white/70"}
        />
      </div>

      <p className="text-[11px] text-white/40">
        Réversibles disponibles : <span className="text-white/70">{summary.reversibleCount}</span>
        {view.filtered && (
          <>
            {" · "}
            <span className="text-white/70">
              {summary.total} sur {view.totalBeforeFilter}
            </span>{" "}
            (filtre actif)
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.01] p-6 text-center">
          <p className="text-sm text-white/60">
            {view.filtered
              ? "Aucun événement ne correspond au filtre."
              : "Aucun événement d’audit."}
          </p>
          <p className="mt-1 text-[11px] text-white/35">
            Le journal reste vide tant qu’aucune source d’audit n’est branchée — aucune activité n’est
            fabriquée.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <JournalRow key={row.event.id} row={row} canRevert={view.canRevert} onRevert={onRevert} />
          ))}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-white/30">
        « Qui / quoi / quand » : ce journal ne fait qu’agréger des événements déjà enregistrés côté
        serveur — il n’en invente aucun. L’annulation d’une action est un geste humain à fort risque
        (réservé à l’admin) ; la garde d’affichage est un confort d’UI, l’autorité reste la RLS.
      </p>
    </div>
  );
}
