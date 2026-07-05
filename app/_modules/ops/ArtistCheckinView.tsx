"use client";

// app/_modules/ops/ArtistCheckinView.tsx — écran Accueil artiste (module A8, migration 0027), mobile-first.
// Autonome : reçoit le client supabase partagé + le rôle + l'username. La RLS 0027 est la frontière dure
// (lecture direction + sécurité ; écriture direction seule) ; le front reflète la MÊME règle via la lib
// PURE lib/artistCheckin.ts (canViewArtistCheckin / canManageArtistCheckin). Aucun artiste inventé :
// états vides HONNÊTES, et le cycle d'accueil (attendu → arrivé → balance → prêt) provient des vraies
// lignes de la table. Ce module ne crée PAS de fiche (champs libres sensibles minimisés) : il fait
// AVANCER le statut/les jalons d'accueil d'une fiche existante. La saisie des fiches reste ailleurs.

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  CHECKIN_STATUSES,
  canManageArtistCheckin,
  canViewArtistCheckin,
  checkinProgress,
  checkinStatusLabel,
  isReadyForStage,
  isTerminalStatus,
  sortForBoard,
  summarizeCheckins,
  type ArtistCheckin,
  type CheckinStatus,
} from "@/lib/artistCheckin";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

// Les 3 jalons d'accueil, dans l'ordre du cycle, avec la colonne timestamp qui les matérialise.
// « prêt » (validation technique) est le dernier verrou avant la scène.
const MILESTONES: { key: "arrived_at" | "soundcheck_at" | "tech_validated_at"; label: string }[] = [
  { key: "arrived_at", label: "Arrivé" },
  { key: "soundcheck_at", label: "Balance" },
  { key: "tech_validated_at", label: "Prêt (tech)" },
];

export default function ArtistCheckinView({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canView = canViewArtistCheckin(role);
  const canManage = canManageArtistCheckin(role);
  const [checkins, setCheckins] = useState<ArtistCheckin[]>([]);
  const [error, setError] = useState("");
  // loading initialisé selon le garde → pas de setState synchrone dans l'effet (react-hooks/set-state-in-effect).
  const [loading, setLoading] = useState(canView);

  // Chargement initial : IIFE async avec garde de montage. Le setState est POST-await (jamais synchrone
  // dans l'effet). Un rôle sans accès (server/compteur/promoteur) ne déclenche AUCUN fetch.
  useEffect(() => {
    if (!canView) return;
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("artist_checkins")
        .select("*")
        .order("exploitation_date", { ascending: false });
      if (!active) return;
      if (e) setError(e.message);
      else setCheckins((data || []) as ArtistCheckin[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, canView]);

  async function reload() {
    const { data, error: e } = await supabase
      .from("artist_checkins")
      .select("*")
      .order("exploitation_date", { ascending: false });
    if (e) {
      setError(e.message);
      return;
    }
    setCheckins((data || []) as ArtistCheckin[]);
  }

  // Soirée active côté écran autonome : la date la plus récente présente en base. On ne fabrique aucune
  // soirée — s'il n'y a aucune fiche, il n'y a pas de soirée à afficher (état vide honnête).
  const activeDate = useMemo(() => {
    let latest: string | null = null;
    for (const c of checkins) {
      if (latest === null || c.exploitation_date > latest) latest = c.exploitation_date;
    }
    return latest;
  }, [checkins]);

  const soireeCheckins = useMemo(
    () => sortForBoard(checkins.filter((c) => c.exploitation_date === activeDate)),
    [checkins, activeDate],
  );
  const summary = useMemo(() => summarizeCheckins(soireeCheckins), [soireeCheckins]);

  // Fait avancer le statut d'une fiche + horodate le jalon correspondant quand le nouveau statut le
  // matérialise. On n'écrit QUE des champs de cycle (statut + timestamps de jalon + tech_validated_by) :
  // les champs libres sensibles (rider, contact, matériel) ne sont jamais touchés ici.
  async function setStatus(c: ArtistCheckin, next: CheckinStatus) {
    setError("");
    const now = new Date().toISOString();
    const patch: Partial<ArtistCheckin> = { status: next };
    // Horodatage IDEMPOTENT des jalons : on pose le timestamp seulement s'il manque, on n'efface jamais
    // un jalon déjà franchi (revenir en arrière ne « dé-balance » pas l'artiste).
    if (next === "arrive" && c.arrived_at === null) patch.arrived_at = now;
    if (next === "balance" && c.soundcheck_at === null) patch.soundcheck_at = now;
    if (next === "pret" && c.tech_validated_at === null) {
      patch.tech_validated_at = now;
      patch.tech_validated_by = username;
    }
    const { error: e } = await supabase.from("artist_checkins").update(patch).eq("id", c.id);
    if (e) {
      setError(`Mise à jour refusée : ${e.message}`);
      return;
    }
    await reload();
  }

  // Marque explicitement un jalon (arrivée / balance / prêt) sans forcément changer le statut affiché :
  // l'accueil coche l'étape dès qu'elle est réelle. Idempotent (ne re-tamponne jamais).
  async function markMilestone(c: ArtistCheckin, key: "arrived_at" | "soundcheck_at" | "tech_validated_at") {
    setError("");
    if (c[key] !== null) return; // déjà franchi
    const now = new Date().toISOString();
    const patch: Partial<ArtistCheckin> = { [key]: now };
    if (key === "tech_validated_at") patch.tech_validated_by = username;
    const { error: e } = await supabase.from("artist_checkins").update(patch).eq("id", c.id);
    if (e) {
      setError(`Jalon refusé : ${e.message}`);
      return;
    }
    await reload();
  }

  // Rôle sans accès (server / security_counter / promoter) : miroir honnête de la RLS 0027, aucun fetch.
  if (!canView) {
    return (
      <div className="space-y-3 pb-4 text-white">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-sm text-white/50">
          L&apos;accueil artiste est réservé à la direction et à la sécurité.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className={CARD}>
          <div className="text-2xl font-black">{summary.total}</div>
          <div className="text-[10px] uppercase text-white/50">Artistes</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-sky-300">{summary.arrives}</div>
          <div className="text-[10px] uppercase text-white/50">Arrivés</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-emerald-300">{summary.prets}</div>
          <div className="text-[10px] uppercase text-white/50">Prêts</div>
        </div>
        <div className={CARD}>
          <div className="text-2xl font-black text-red-400">{summary.noShow}</div>
          <div className="text-[10px] uppercase text-white/50">No-show</div>
        </div>
      </div>
      <div className="text-center text-xs text-white/60">
        Entourage attendu (accompagnants) : <b className="text-white">{summary.accompagnants}</b>
      </div>

      {activeDate ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-white/40">
          Soirée du {activeDate} · {soireeCheckins.length} fiche{soireeCheckins.length > 1 ? "s" : ""}
          {!canManage ? " · lecture seule" : ""}
        </div>
      ) : null}

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">{error}</div>
      )}

      <div>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Accueil de la soirée</div>
        {loading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : soireeCheckins.length === 0 ? (
          <div className="text-center text-sm text-white/40">
            Aucune fiche d&apos;accueil artiste. Les fiches se créent au moment de la programmation ; rien n&apos;est inventé ici.
          </div>
        ) : (
          <ul className="space-y-2">
            {soireeCheckins.map((c) => {
              const terminal = isTerminalStatus(c.status);
              const ready = isReadyForStage(c);
              const progress = checkinProgress(c);
              return (
                <li key={c.id} className={CARD}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black">{c.artist_name}</div>
                      <div className="text-[11px] text-white/50">
                        {c.slot_label ? `${c.slot_label} · ` : ""}
                        {c.dressing_room ? `loge ${c.dressing_room} · ` : ""}
                        {c.companions > 0 ? `+${c.companions} accomp.` : "seul"}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold ${
                        ready
                          ? "bg-emerald-500/20 text-emerald-200"
                          : c.status === "no_show" || c.status === "annule"
                            ? "bg-red-500/20 text-red-200"
                            : "bg-white/10 text-white/70"
                      }`}
                    >
                      {checkinStatusLabel(c.status)}
                    </div>
                  </div>

                  {/* Cycle d'accueil : les 3 jalons (arrivée → balance → prêt). Chaque pastille reflète un
                      vrai timestamp ; direction peut cocher un jalon manquant. Sécurité voit sans agir. */}
                  <div className="mt-2 flex gap-1.5">
                    {MILESTONES.map((m) => {
                      const done = c[m.key] !== null;
                      const clickable = canManage && !done && !terminal;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          disabled={!clickable}
                          onClick={clickable ? () => markMilestone(c, m.key) : undefined}
                          className={`flex-1 rounded-lg border px-1.5 py-1 text-[10px] font-bold ${
                            done
                              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                              : clickable
                                ? "border-white/20 bg-black/30 text-white/60"
                                : "border-white/10 bg-black/20 text-white/25"
                          }`}
                        >
                          {done ? "✓ " : ""}
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1 text-center text-[9px] uppercase tracking-wide text-white/30">
                    Accueil {progress}/3
                  </div>

                  {/* Avancement du statut : direction seule (miroir WITH CHECK 0027). Un menu fermé sur le
                      vocabulaire de la lib — aucun champ libre. Sécurité : pas de contrôle affiché. */}
                  {canManage && (
                    <div className="mt-2">
                      <label className="mb-1 block text-[9px] uppercase tracking-wide text-white/30">Faire avancer le statut</label>
                      <select
                        className={INPUT}
                        value={c.status}
                        onChange={(e) => setStatus(c, e.target.value as CheckinStatus)}
                      >
                        {CHECKIN_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {checkinStatusLabel(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
