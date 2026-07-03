"use client";

// app/rh-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (RH / PLANNING, B7).
//
// Raison d'être : la logique PURE du module RH / Planning (lib/rhPlanning = masse horaire + coût staff,
// lib/rhRollup = cumul période/mois, lib/rhSelf = vue salarié + confirmation 1-tap ; test:rh + test:rhrollup
// + test:rhself verts) existait mais n'était montée NULLE PART : contrairement aux modules des séries
// S51→S61, RH n'avait AUCUN composant (ni board direction, ni vue salarié) ni aperçu. Cette session
// construit les DEUX composants présentationnels (RhPlanningBoard, MonPlanningView) et les câble ici à des
// données FICTIVES étiquetées, pour que le fondateur voie tourner : la masse horaire + le coût staff par
// soirée, le cumul de période (récap paie) avec son honnêteté de complétude, la vue salarié « Mon planning »
// et la confirmation de présence en 1 tap — et surtout le CADRAGE DE RÔLE (miroir de la RLS 0011/0021 :
// direction voit l'effectif + la paie ; chaque salarié ne voit que SES créneaux, jamais un coût ; le
// promoteur n'est pas dans l'effectif → aucun accès).
//
// Périmètre volontairement étroit et SÛR (même discipline que /incidents-preview, /captation-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — les données sont un JEU DE DÉMONSTRATION en mémoire. En réel,
//     app/page.tsx charge l'effectif/les shifts déjà filtrés par la RLS 0011 et écrit (saisie direction,
//     confirmation 1-tap via confirm_my_shift_v1 de 0020) sous RLS. Ici, confirmer ne touche qu'un ÉTAT
//     LOCAL simulé — JAMAIS une sécurité, JAMAIS une écriture ;
//   · les composants NE DUPLIQUENT AUCUNE règle : ils appellent canViewTab / summarizeMasseHoraire /
//     buildPeriodStaffRollup / rhDataReady / summarizeMyHours / splitMyShifts / canSelfConfirm (les MÊMES
//     fonctions que la production). Changer le rôle rejoue exactement le cadrage réel ;
//   · tout l'effectif est FICTIF (noms « Salarié démo », identifiants « -demo », un taux de démonstration
//     sur certains, null sur d'autres pour montrer l'honnêteté « coût non calculable »). AUCUN vrai salarié
//     n'est lu ni inventé en base — le module ship VIDE en production (la vraie liste vient du fondateur) ;
//   · AUCUNE écriture, AUCUN envoi, AUCUNE mise en ligne. Le taux horaire de démo n'est PAS de la vraie paie.

import { useState } from "react";

import RhPlanningBoard from "@/components/RhPlanningBoard";
import MonPlanningView from "@/components/MonPlanningView";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { canViewTab } from "@/lib/permissions";
import type { StaffMember, StaffShift } from "@/lib/rhPlanning";

// ————————————————————————————————————————————————————————————————
// Repère de banc STABLE : « aujourd'hui » figé au 2026-07-05, entre les soirées passées (04) et à venir
// (06, 07). Date fixe et déterministe (pas Date.now()) — le cadrage à venir/passé ne dépend pas de l'horloge.
// ————————————————————————————————————————————————————————————————
const REF_DATE = new Date("2026-07-05T12:00:00.000Z");

// Effectif FICTIF de démonstration. Identifiants « -demo », taux de DÉMONSTRATION (pas de vraie paie) :
// certains renseignés (coût calculable), sec-demo sans taux (montre « présent sans coût », honnêteté).
const DEMO_MEMBERS: StaffMember[] = [
  { id: "srv-demo", username: "serveur-demo", full_name: "Salarié démo — Bar", poste: "Bar", contrat_type: "extra", taux_horaire: 12.5, actif: true },
  { id: "sec-demo", username: "securite-demo", full_name: "Salarié démo — Sécurité", poste: "Sécurité", contrat_type: "prestataire", taux_horaire: null, actif: true },
  { id: "cnt-demo", username: "compteur-demo", full_name: "Salarié démo — Compteur", poste: "Entrée", contrat_type: "extra", taux_horaire: 11.8, actif: true },
  { id: "dir-demo", username: "manager-demo", full_name: "Salarié démo — Manager", poste: "Direction", contrat_type: "cdi", taux_horaire: 20, actif: true },
  { id: "old-demo", username: "ancien-demo", full_name: "Salarié démo — Inactif", poste: "Bar", contrat_type: "cdd", taux_horaire: 12, actif: false },
];

// À quel salarié fictif correspond chaque rôle spectateur (pour la vue « Mon planning », scopée RLS 0011).
const ROLE_MEMBER: Partial<Record<StaffRole, string>> = {
  server: "srv-demo",
  security: "sec-demo",
  security_counter: "cnt-demo",
  admin: "dir-demo",
  manager: "dir-demo",
  // promoter : absent de l'effectif → aucune fiche, aucun « Mon planning ».
};

function shift(over: Partial<StaffShift> & Pick<StaffShift, "id" | "staff_member_id" | "exploitation_date" | "status">): StaffShift {
  return {
    event_id: null,
    poste: null,
    planned_start: null,
    planned_end: null,
    actual_start: null,
    actual_end: null,
    commentaire: null,
    ...over,
  };
}

// Shifts FICTIFS sur 3 soirées : 04 (passée, pointée) / 06 & 07 (à venir, confirmables). Couvre présents,
// retard, absent, planifie (confirmable en 1 tap), confirmé — pour exercer masse horaire, cumul et self-view.
const DEMO_SHIFTS: StaffShift[] = [
  // Soirée passée 2026-07-04 (pointée)
  shift({ id: "s1", staff_member_id: "srv-demo", exploitation_date: "2026-07-04", poste: "Bar", status: "present", planned_start: "2026-07-04T22:00:00.000Z", planned_end: "2026-07-05T04:00:00.000Z", actual_start: "2026-07-04T22:05:00.000Z", actual_end: "2026-07-05T04:10:00.000Z" }),
  shift({ id: "s2", staff_member_id: "sec-demo", exploitation_date: "2026-07-04", poste: "Sécurité", status: "present", planned_start: "2026-07-04T23:00:00.000Z", planned_end: "2026-07-05T05:00:00.000Z", actual_start: "2026-07-04T23:00:00.000Z", actual_end: "2026-07-05T05:00:00.000Z" }),
  shift({ id: "s3", staff_member_id: "cnt-demo", exploitation_date: "2026-07-04", poste: "Entrée", status: "retard", planned_start: "2026-07-04T22:00:00.000Z", planned_end: "2026-07-05T04:00:00.000Z", actual_start: "2026-07-04T22:30:00.000Z", actual_end: "2026-07-05T04:00:00.000Z" }),
  shift({ id: "s4", staff_member_id: "dir-demo", exploitation_date: "2026-07-04", poste: "Direction", status: "absent", planned_start: "2026-07-04T22:00:00.000Z", planned_end: "2026-07-05T04:00:00.000Z" }),
  // Soirée à venir 2026-07-06 (planning, confirmable)
  shift({ id: "s5", staff_member_id: "srv-demo", exploitation_date: "2026-07-06", poste: "Bar", status: "planifie", planned_start: "2026-07-06T22:00:00.000Z", planned_end: "2026-07-07T04:00:00.000Z" }),
  shift({ id: "s6", staff_member_id: "sec-demo", exploitation_date: "2026-07-06", poste: "Sécurité", status: "confirme", planned_start: "2026-07-06T22:00:00.000Z", planned_end: "2026-07-07T05:00:00.000Z" }),
  shift({ id: "s7", staff_member_id: "cnt-demo", exploitation_date: "2026-07-06", poste: "Entrée", status: "planifie", planned_start: "2026-07-06T22:00:00.000Z", planned_end: "2026-07-07T04:00:00.000Z" }),
  shift({ id: "s9", staff_member_id: "dir-demo", exploitation_date: "2026-07-06", poste: "Direction", status: "planifie", planned_start: "2026-07-06T21:00:00.000Z", planned_end: "2026-07-07T05:00:00.000Z" }),
  // Soirée à venir 2026-07-07
  shift({ id: "s8", staff_member_id: "srv-demo", exploitation_date: "2026-07-07", poste: "Bar", status: "confirme", planned_start: "2026-07-07T22:00:00.000Z", planned_end: "2026-07-08T04:00:00.000Z" }),
];

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Compteur (flux)",
  promoter: "Promoteur",
};

function roleExpectation(role: StaffRole): string {
  const rh = canViewTab(role, "rh");
  const mine = canViewTab(role, "monplanning");
  if (!rh && !mine) return "Aucun accès RH (pas dans l’effectif — matrice B7).";
  const parts: string[] = [];
  if (rh) parts.push("voit l’effectif + la masse horaire + la paie (direction)");
  if (mine) parts.push("voit SES créneaux + confirme sa présence (aucun coût)");
  return parts.join(" · ");
}

export default function RhPreviewPage() {
  const [role, setRole] = useState<StaffRole>("manager");
  // État LOCAL simulé (miroir client des tables staff_shifts — aucune écriture réelle).
  const [shifts, setShifts] = useState<StaffShift[]>(DEMO_SHIFTS);

  // onConfirm simulé : reflète la RPC confirm_my_shift_v1 (0020) — planifie → confirme. Le composant
  // n'expose le bouton QUE si canSelfConfirm (aucune règle dupliquée ici).
  async function handleConfirm(id: string): Promise<void> {
    setShifts((prev) => prev.map((s) => (s.id === id ? { ...s, status: "confirme" } : s)));
  }

  function reset() {
    setShifts(DEMO_SHIFTS);
  }

  const memberId = ROLE_MEMBER[role];
  const myShifts = memberId ? shifts.filter((s) => s.staff_member_id === memberId) : [];
  const rhOpen = canViewTab(role, "rh");
  const mineOpen = canViewTab(role, "monplanning");

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — données fictives, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai salarié, aucune vraie paie. Les taux horaires sont des valeurs de{" "}
          <strong>démonstration</strong>, pas la vraie rémunération. Le module ship <strong>VIDE</strong> en
          production (l’effectif se remplit avec la vraie liste du fondateur). En réel, <code>app/page.tsx</code>{" "}
          charge l’effectif/les shifts déjà filtrés par la RLS (<code>0011</code>) et écrit (saisie direction,
          confirmation 1-tap via <code>confirm_my_shift_v1</code>) sous RLS. Ici, confirmer ne touche qu’un{" "}
          <strong>état local simulé</strong> ; les composants sont gardés par les MÊMES fonctions que la
          production (<code>canViewTab</code>, <code>summarizeMasseHoraire</code>, <code>canSelfConfirm</code>).
          Changer le rôle rejoue exactement le cadrage réel. Ce banc n’exerce que la présentation, JAMAIS une
          sécurité.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">RH / Planning — masse horaire & mon planning (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module B7 : planning + pointage → masse horaire → coût staff (le « coût staff » attendu par le P&L
          par soirée). Coût honnête : null tant qu’un présent n’a pas de taux + d’heures pointées ; on expose
          combien de présents restent sans coût, jamais un total tronqué. Vue salarié « Mon planning » :
          confirmation de présence en 1 tap, AUCUN coût affiché (la paie ne quitte pas la direction).
        </p>
      </header>

      {/* Sélecteur de rôle : démontre le cadrage (miroir de la RLS 0011/0021), pas une sécurité applicative. */}
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
          Rôle <code>{role}</code> — attendu : {roleExpectation(role)}
        </p>
      </section>

      {/* Vue DIRECTION (effectif, masse horaire, paie) — le composant lui-même rend le message de fermeture
          pour les rôles sans accès (aucune garde dupliquée ici). */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Vue direction</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${rhOpen ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10 text-white/40"}`}>
            {rhOpen ? "accessible" : "fermé"}
          </span>
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
          <RhPlanningBoard members={DEMO_MEMBERS} shifts={shifts} role={role} />
        </div>
      </section>

      {/* Vue SALARIÉ « Mon planning » — scopée à la fiche du rôle (RLS 0011). Le composant rend le message
          de fermeture pour le promoteur (hors effectif). */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Mon planning (vue salarié)</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${mineOpen ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10 text-white/40"}`}>
            {mineOpen ? "accessible" : "fermé"}
          </span>
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
          <MonPlanningView shifts={myShifts} role={role} refDate={REF_DATE} onConfirm={handleConfirm} />
        </div>
      </section>

      <section className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[12px] text-white/60">
        <span>
          Confirmer une présence ne touche qu’un état local simulé (miroir de <code>confirm_my_shift_v1</code>).
          Aucune écriture, aucun réseau.
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
