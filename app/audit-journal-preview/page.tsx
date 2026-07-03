"use client";

// app/audit-journal-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (JOURNAL D'AUDIT, module 0.5 du Socle).
//
// Raison d'être : le journal d'audit global (« qui / quoi / quand, réversible », CLUB_ONE_OS_MASTER §0)
// n'existait NULLE PART. Sa logique pure (lib/auditJournal : classe les événements par la matrice RBAC
// §0.2, filtre/trie/agrège, garde direction, annulation en miroir d'UI ; test:auditjournal vert) et son
// composant présentationnel (components/AuditJournalBoard) sont neufs cette session ; cette route les
// câble à un jeu de DÉMONSTRATION pour donner à voir le journal, avec filtres et annulation interactive
// (en mémoire).
//
// Les POINTS-CLÉS démontrés :
//   · AUCUN événement fabriqué : le journal réel est VIDE tant qu'aucune source d'audit n'est branchée.
//     Ici, les lignes sont explicitement des ÉVÉNEMENTS DE DÉMONSTRATION étiquetés.
//   · CLASSEMENT HONNÊTE : chaque action est rangée par la matrice RBAC (exploitation / sensible /
//     administration) ; une action hors catalogue reste « non classée », jamais réinterprétée.
//   · ANNULATION = geste humain à fort risque : proposée seulement pour une action réversible non déjà
//     annulée, réservée à l'admin. L'aperçu ne fait qu'un miroir d'UI (aucune écriture).
//
// Périmètre volontairement étroit et SÛR (même discipline que /command-center-preview, /resa-board-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN Supabase — événements en mémoire. En réel, app/page.tsx dérive ces lignes de
//     la table `audit_log` déjà filtrée par la RLS puis les passe à buildAuditJournal ; l'annulation
//     devient une RPC SECURITY DEFINER (aucune écriture par l'aperçu) ;
//   · le composant NE DUPLIQUE AUCUNE garde : il appelle canViewAuditJournal / canRevertAuditEvent ;
//   · aucune donnée réelle : acteurs et cibles explicitement fictifs et étiquetés.

import { useMemo, useState } from "react";

import { AuditJournalBoard } from "@/components/AuditJournalBoard";
import {
  AUDIT_CATEGORIES,
  buildAuditJournal,
  canRevertAuditEvent,
  canViewAuditJournal,
  categoryLabel,
  markReverted,
  type AuditCategory,
  type AuditEventRow,
} from "@/lib/auditJournal";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";

// Événements 100 % FICTIFS et étiquetés. Déterministes (id + at fournis, aucune horloge). Ils couvrent
// les trois catégories + une action hors catalogue (pour prouver le classement « non classé »), un
// événement réversible non annulé, et un déjà annulé.
const DEMO_EVENTS: AuditEventRow[] = [
  { id: "a1", at: "2026-07-03T22:05:00Z", actor: "démo — direction", actorRole: "admin", action: "settings.manage", targetLabel: "Cadence messages", venue: null, reversible: true, revertedAt: null },
  { id: "a2", at: "2026-07-03T22:20:00Z", actor: "démo — manager", actorRole: "manager", action: "table.assign", targetLabel: "Table 205", venue: "eden", reversible: true, revertedAt: null },
  { id: "a3", at: "2026-07-03T22:35:00Z", actor: "démo — direction", actorRole: "admin", action: "analytics.financial.read", targetLabel: "P&L soirée", venue: "eden", reversible: false, revertedAt: null },
  { id: "a4", at: "2026-07-03T22:50:00Z", actor: "démo — sécurité", actorRole: "security", action: "incident.sensitive.read", targetLabel: "Incident #12", venue: "eden", reversible: false, revertedAt: null },
  { id: "a5", at: "2026-07-03T23:10:00Z", actor: "démo — compteur", actorRole: "security_counter", action: "entry.increment", targetLabel: "Porte Eden", venue: "eden", reversible: false, revertedAt: null },
  { id: "a6", at: "2026-07-03T23:25:00Z", actor: "démo — manager", actorRole: "manager", action: "content.publish", targetLabel: "Story renouveau", venue: null, reversible: true, revertedAt: "2026-07-03T23:40:00Z" },
  { id: "a7", at: "2026-07-03T23:55:00Z", actor: "démo — direction", actorRole: "admin", action: "campaign.launch", targetLabel: "Palier pub #1", venue: null, reversible: true, revertedAt: null },
  // action HORS catalogue RBAC → classée « non classé », libellé brut conservé (aucune invention).
  { id: "a8", at: "2026-07-04T00:15:00Z", actor: "démo — système", actorRole: null, action: "worker.retry", targetLabel: "File OctoTable", venue: null, reversible: false, revertedAt: null },
];

type CatFilter = "toutes" | AuditCategory;

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Direction (admin)",
  manager: "Manager",
  server: "Serveur",
  security: "Sécurité",
  security_counter: "Accueil / compteur",
  promoter: "Promoteur",
};

export default function AuditJournalPreviewPage() {
  const [role, setRole] = useState<StaffRole>("admin");
  const [catFilter, setCatFilter] = useState<CatFilter>("toutes");
  // Annulations en mémoire (aucune écriture réseau) — geste humain simulé, horodatage fixe fictif.
  const [reverted, setReverted] = useState<Record<string, string>>({});

  const view = useMemo(
    () =>
      buildAuditJournal({
        role,
        events: DEMO_EVENTS,
        filter: catFilter === "toutes" ? undefined : { category: catFilter },
        reverted,
      }),
    [role, catFilter, reverted],
  );

  // L'appelant fournit l'horodatage (la lib n'a pas d'horloge). En aperçu, un ISO fixe fictif suffit.
  const onRevert = (id: string) =>
    setReverted((prev) => markReverted(prev, id, "2026-07-04T09:00:00Z"));

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — événements fictifs, aucun réseau</p>
        <p className="mt-1 text-amber-100/80">
          Aucune donnée réelle. Le journal d’audit (0.5) affiche « <strong>qui a fait quoi, quand</strong> »
          en classant chaque action par la <strong>matrice RBAC</strong> (exploitation / données sensibles /
          administration ; une action inconnue reste « non classée »). Le vrai journal est <strong>vide</strong>
          tant qu’aucune source d’audit n’est branchée. Changer le rôle rejoue le cadrage réel
          (<code>canViewAuditJournal</code> / <code>canRevertAuditEvent</code>).
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Journal d’audit (aperçu)</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Module 0.5 (Socle · direction). Il compose des événements d’audit déjà enregistrés côté serveur
          (future table <code>audit_log</code>, déjà filtrée par la RLS) en une timeline de pilotage.
          L’annulation d’une action réversible est un geste humain à fort risque, réservé à l’admin.
        </p>
      </header>

      {/* Filtre par catégorie. */}
      <section className="mb-4">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">Catégorie</p>
        <div className="flex flex-wrap gap-2">
          {(["toutes", ...AUDIT_CATEGORIES] as CatFilter[]).map((c) => {
            const selected = c === catFilter;
            const label = c === "toutes" ? "Toutes" : categoryLabel(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCatFilter(c)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                  selected
                    ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white/90"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Sélecteur de rôle : démontre la garde direction, pas une sécurité. */}
      <section className="mb-5">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/50">
          Rôle du spectateur (le journal est réservé à la direction)
        </p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => {
            const selected = r === role;
            const open = canViewAuditJournal(r);
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
          {canViewAuditJournal(role)
            ? canRevertAuditEvent(role)
              ? "accès journal, peut annuler une action réversible (geste humain, aucune écriture par l’aperçu)"
              : "accès journal, consultation seule (n’annule pas)"
            : "aucun accès (message de fermeture)"}
        </p>
      </section>

      <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
        <AuditJournalBoard view={view} role={role} onRevert={onRevert} />
      </div>
    </main>
  );
}
