"use client";

// components/RhPlanningBoard.tsx — vue DIRECTION du module RH / Planning (B7).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe l'effectif (staff_members) et les
// shifts (staff_shifts) déjà chargés/filtrés par la RLS 0011/0021, et il rend une lecture honnête pour la
// direction : état de préparation des données, masse horaire par soirée, cumul de période (récap paie), et
// le roster. Il n'accorde AUCUN droit :
//   · l'onglet RH est réservé à la direction (admin/manager) — la garde est canViewTab(role, "rh"), miroir
//     UI de la RLS 0011 (seule la direction lit l'effectif complet + les taux horaires PII). Sécurité :
//     tout autre rôle voit un message de fermeture, jamais l'effectif ni la paie ;
//   · aucune donnée n'est fabriquée : le coût staff reste null tant qu'un taux horaire réel + des heures
//     pointées ne sont pas là (coutComplet=false), et on EXPOSE combien de présents restent sans coût —
//     jamais un total tronqué présenté comme définitif ;
//   · toute la logique (masse horaire, cumul, honnêteté) vient de lib/rhPlanning + lib/rhRollup ; ce
//     composant ne re-calcule ni ne re-décide rien.
//
// États vides HONNÊTES : effectif vide → des zéros + un message clair, jamais une ligne salarié fabriquée.

import type { StaffRole } from "@/lib/permissions";
import { canViewTab } from "@/lib/permissions";
import {
  rhDataReady,
  type MasseHoraire,
  type StaffMember,
  type StaffShift,
} from "@/lib/rhPlanning";
import {
  buildPeriodStaffRollup,
  periodStaffChargeAmount,
  rollupDataReady,
} from "@/lib/rhRollup";

function eur(n: number | null): string {
  return n == null ? "—" : `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function hours(n: number | null): string {
  return n == null ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
}

function NightRow({ night }: { night: MasseHoraire }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">{night.exploitationDate}</span>
        <span className="text-xs text-white/50">
          {night.shiftsTotal} shift{night.shiftsTotal > 1 ? "s" : ""} · {night.presents} présent
          {night.presents > 1 ? "s" : ""}
          {night.absents > 0 && <span className="text-amber-300"> · {night.absents} absent{night.absents > 1 ? "s" : ""}</span>}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
        <span>Prévu {hours(night.heuresPlanifiees)}</span>
        <span>Réel {hours(night.heuresReelles)}</span>
        <span className={night.coutComplet ? "text-emerald-300" : "text-white/50"}>Coût {eur(night.coutStaff)}</span>
        {!night.coutComplet && night.presentsSansTaux > 0 && (
          <span className="text-amber-300">
            {night.presentsSansTaux} présent{night.presentsSansTaux > 1 ? "s" : ""} sans coût (taux/heures manquants)
          </span>
        )}
      </div>
    </div>
  );
}

export default function RhPlanningBoard({
  members,
  shifts,
  role,
}: {
  members: readonly StaffMember[];
  shifts: readonly StaffShift[];
  role: StaffRole;
}) {
  // Garde UI (miroir de la RLS 0011 : l'effectif complet + la paie ne sortent que pour la direction).
  if (!canViewTab(role, "rh")) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        L’onglet RH / Planning (effectif, masse horaire, paie) est réservé à la direction (matrice B7). Ce
        rôle n’y a aucun accès.
      </p>
    );
  }

  const ready = rhDataReady([...members]);
  const rollup = buildPeriodStaffRollup([...shifts], [...members]);
  const rollupReady = rollupDataReady(rollup);
  const chargeable = periodStaffChargeAmount(rollup);

  return (
    <div className="space-y-5">
      {/* État de préparation honnête : combien de salariés, combien ont un taux horaire réel (sans quoi
          aucun coût staff n'est calculable). Le module ship VIDE tant que le fondateur n'a pas fourni la
          vraie liste + la paie. */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Effectif</p>
        {ready.total === 0 ? (
          <p className="mt-2 text-sm text-white/50">
            Aucun salarié enregistré. L’effectif se remplit avec la vraie liste du fondateur (noms,
            identifiants, taux) — rien n’est fabriqué ici.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/70">
            <span>{ready.total} salarié{ready.total > 1 ? "s" : ""}</span>
            <span>{ready.actifs} actif{ready.actifs > 1 ? "s" : ""}</span>
            <span className={ready.withTaux < ready.total ? "text-amber-300" : "text-emerald-300"}>
              {ready.withTaux}/{ready.total} avec taux horaire
            </span>
            {ready.withTaux < ready.total && (
              <span className="text-white/40">
                (les autres : coût non calculable tant que la paie n’est pas renseignée)
              </span>
            )}
          </div>
        )}
      </section>

      {/* Cumul de période (récap paie) — honnête sur la complétude du coût. */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Cumul de période</p>
        {!rollupReady.hasNights ? (
          <p className="mt-2 text-sm text-white/50">
            Aucune soirée planifiée sur la période. Un planning vide n’affiche que des zéros.
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-white/70 sm:grid-cols-4">
              <div>
                <p className="text-white/40 text-xs">Soirées</p>
                <p className="font-semibold">{rollup.nightsTotal}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs">Présents (cumul)</p>
                <p className="font-semibold">{rollup.presentsTotal}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs">Heures réelles</p>
                <p className="font-semibold">{hours(rollup.heuresReellesTotal)}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs">Coût staff</p>
                <p className={`font-semibold ${rollup.coutComplet ? "text-emerald-300" : ""}`}>
                  {eur(rollup.coutStaffCumul)}
                </p>
              </div>
            </div>
            {rollupReady.costPartial && (
              <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                Coût PARTIEL : {rollup.nightsSansCoutComplet} soirée{rollup.nightsSansCoutComplet > 1 ? "s" : ""} avec
                des présents sans taux/heures ({rollup.presentsSansTaux} présent
                {rollup.presentsSansTaux > 1 ? "s" : ""} sans coût). Ce cumul n’est pas branché au P&L comme
                définitif ({chargeable == null ? "charge de période = non fournie" : eur(chargeable)}).
              </p>
            )}
          </>
        )}
      </section>

      {/* Masse horaire par soirée. */}
      {rollup.nights.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">Masse horaire par soirée</p>
          <div className="space-y-1.5">
            {rollup.nights.map((n) => (
              <NightRow key={n.exploitationDate} night={n} />
            ))}
          </div>
        </section>
      )}

      {/* Roster : taux horaire visible (PII paie — direction seule, miroir RLS 0011/0021). */}
      {members.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">Roster</p>
          <div className="space-y-1.5">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-white">{m.full_name}</span>
                  <span className="ml-2 text-xs text-white/40">@{m.username}</span>
                  {!m.actif && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/50">inactif</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                  {m.poste && <span>{m.poste}</span>}
                  {m.contrat_type && <span className="rounded bg-white/[0.06] px-1.5 py-0.5">{m.contrat_type}</span>}
                  <span className={m.taux_horaire == null ? "text-amber-300" : "text-white/70"}>
                    {m.taux_horaire == null ? "taux non renseigné" : `${eur(m.taux_horaire)}/h`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
