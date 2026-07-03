"use client";

// components/LeadsPipelineBoard.tsx — LEADS & TUNNEL COMMERCIAL direction (B12).
//
// Composant PRÉSENTATIONNEL : AUCUN réseau. On lui passe une vue déjà agrégée par
// buildLeadsPipeline (lib/leadsPipeline) — construite en amont à partir des signaux d'origine
// (QR A4, promoteurs B11, résas B10…) déjà protégés par la RLS de chaque source. Ce composant ne
// recalcule ni ne redécide rien ; il n'accorde aucun droit :
//   · B12 est réservé à la DIRECTION (admin/manager) — garde canViewLeads. Tout autre rôle → fermeture.
//   · HONNÊTETÉ ASSUMÉE À L'ÉCRAN : une étape non trackée affiche « — » (jamais un faux zéro) ; un ROAS
//     non mesurable affiche « — » (jamais un ROI inventé) ; un canal payant non rentable est marqué
//     « à couper » (« sinon on coupe » — l'app aide à ARRÊTER une pub, jamais à la pousser).
//   · La dépense pub vient du fondateur (GO par palier) ; l'app ne déclenche aucune dépense.

import type { StaffRole } from "@/lib/permissions";
import {
  canManageLeads,
  canViewLeads,
  formatEurosFromCents,
  formatRoas,
  formatTaux,
  leadRentabiliteLabel,
  LEAD_STAGES,
  leadStageTitle,
  type LeadChannelRow,
  type LeadRentabilite,
  type LeadsPipelineView,
} from "@/lib/leadsPipeline";

// Style par verdict de rentabilité. Le « à couper » est en rose (alerte d'arrêt), le « gratuit »
// en retrait (pas de coût, pas de jugement), le « non mesurable » gris (aucune donnée à juger).
const RENTABILITE_STYLE: Record<LeadRentabilite, { ring: string; dot: string; text: string }> = {
  rentable: { ring: "border-emerald-500/30", dot: "bg-emerald-400", text: "text-emerald-300" },
  a_surveiller: { ring: "border-amber-500/40", dot: "bg-amber-400", text: "text-amber-300" },
  a_couper: { ring: "border-rose-500/40", dot: "bg-rose-400", text: "text-rose-300" },
  non_mesurable: { ring: "border-white/10", dot: "bg-white/30", text: "text-white/45" },
  gratuit: { ring: "border-sky-500/20", dot: "bg-sky-400/70", text: "text-sky-300/80" },
};

function StageChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</p>
      <p className={`text-sm font-bold ${value === null ? "text-white/30" : "text-white"}`}>
        {value === null ? "—" : value.toLocaleString("fr-FR")}
      </p>
    </div>
  );
}

function ChannelCard({ row }: { row: LeadChannelRow }) {
  const s = RENTABILITE_STYLE[row.rentabilite];
  return (
    <div className={`rounded-2xl border ${s.ring} ${row.tracked ? "bg-white/[0.03]" : "bg-white/[0.01]"} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-white/60">{row.title}</p>
          <p className="mt-0.5 text-[11px] text-white/35">
            {row.paid ? "Canal payant" : "Canal gratuit"}
            {!row.tracked && " · non tracké"}
          </p>
        </div>
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
          <span className={`text-[10px] font-bold uppercase tracking-wide ${s.text}`}>
            {leadRentabiliteLabel(row.rentabilite)}
          </span>
        </span>
      </div>

      {/* Tunnel : chaque étape mesurée ou « — » (non trackée, jamais 0 fabriqué). */}
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {LEAD_STAGES.map((stage) => (
          <StageChip key={stage} label={leadStageTitle(stage)} value={row.stages[stage]} />
        ))}
      </div>

      {/* Conversions mesurées. */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50">
        <span>Lead → résa : <strong className="text-white/70">{formatTaux(row.tauxLeadVersResa)}</strong></span>
        <span>Résa → entrée : <strong className="text-white/70">{formatTaux(row.tauxResaVersVenu)}</strong></span>
      </div>

      {/* Retour sur dépense : uniquement pour les canaux payants ; tout « — » si non renseigné. */}
      {row.paid && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50">
            <span>
              Dépense :{" "}
              <strong className="text-white/70">
                {row.spentCents === null ? "non renseignée" : formatEurosFromCents(row.spentCents)}
              </strong>
              {row.palier !== null && <span className="text-white/35"> (palier {row.palier} €)</span>}
            </span>
            <span>
              Valeur générée :{" "}
              <strong className="text-white/70">
                {row.valueCents === null ? "non mesurée" : formatEurosFromCents(row.valueCents)}
              </strong>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50">
            <span>Coût/lead : <strong className="text-white/70">{row.coutParLeadCents === null ? "—" : formatEurosFromCents(row.coutParLeadCents)}</strong></span>
            <span>Coût/résa : <strong className="text-white/70">{row.coutParResaCents === null ? "—" : formatEurosFromCents(row.coutParResaCents)}</strong></span>
            <span>ROAS : <strong className={s.text}>{formatRoas(row.roas)}</strong></span>
          </div>
          {row.rentabilite === "a_couper" && (
            <p className="mt-1.5 text-[11px] font-semibold text-rose-300/90">
              La dépense dépasse la valeur générée — canal à couper (aucune dépense n’est engagée par l’app).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeadsPipelineBoard({
  view,
  role,
}: {
  view: LeadsPipelineView;
  role: StaffRole;
}) {
  // Garde UI (palier direction). B12 agrège des signaux déjà protégés par la RLS de chaque source ;
  // ce prédicat ne fait que refléter le périmètre direction côté écran.
  if (!canViewLeads(role)) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Le tunnel commercial (leads &amp; retour pub) est réservé à la direction (admin / manager,
        matrice B12). Ce rôle n’y a aucun accès.
      </p>
    );
  }

  const { event, rows, totals, roasGlobal, coverage, aCouperCount } = view;
  const canManage = canManageLeads(role);

  return (
    <div className="space-y-5">
      {/* En-tête : soirée + synthèse globale honnête. */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">
              Leads &amp; tunnel commercial
            </p>
            {event ? (
              <p className="mt-1 text-sm text-white/80">
                <span className="font-semibold text-white">{event.label}</span>{" "}
                <span className="text-white/50">· {event.date} · {event.venue}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-white/50">
                Aucune soirée active — rien n’est fabriqué en l’absence de soirée.
              </p>
            )}
          </div>
          <span className="text-right text-[11px] text-white/45">
            {canManage ? "Vue direction — pilotage (saisie dépense après GO fondateur)" : "Vue direction — consultation seule"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Leads</p>
            <p className="text-base font-bold text-white">{totals.leads.toLocaleString("fr-FR")}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Résas confirmées</p>
            <p className="text-base font-bold text-white">{totals.resasConfirmees.toLocaleString("fr-FR")}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Dépense pub</p>
            <p className="text-base font-bold text-white">
              {formatEurosFromCents(totals.spentCents)}
              {!totals.spendComplete && <span className="ml-1 text-[10px] font-semibold text-amber-300">partielle</span>}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">ROAS global</p>
            <p className="text-base font-bold text-white">{formatRoas(roasGlobal)}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
          {aCouperCount > 0 && (
            <span className="text-rose-300">
              {aCouperCount} canal{aCouperCount > 1 ? "aux" : ""} à couper
            </span>
          )}
          <span>
            Couverture {coverage.tracked}/{coverage.total} canaux tracés
          </span>
          {roasGlobal === null && (
            <span className="text-white/35">
              ROAS global non calculable (dépense non renseignée ou incomplète — jamais fabriqué)
            </span>
          )}
        </div>
      </section>

      {/* Une carte par canal, ordre canonique. Les canaux non tracés restent visibles, en retrait. */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <ChannelCard key={row.channel} row={row} />
        ))}
      </section>

      <p className="text-[11px] leading-relaxed text-white/35">
        Le tunnel n’engage aucune dépense : les montants pub sont saisis par la direction après un GO
        fondateur par palier (300 / 600 / 1200 €). Aucune métrique n’est fabriquée — une étape non tracée
        ou un ROAS non mesurable s’affiche « — », jamais un faux zéro. « Chaque euro de pub est rattaché à
        des résas trackées, sinon on coupe. »
      </p>
    </div>
  );
}
