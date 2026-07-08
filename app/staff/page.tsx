"use client";

// app/staff — ESPACE PERSONNEL SALARIÉ (mobile-first). Surface DISTINCTE du dashboard direction et de
// l'app d'exploitation /ops : le salarié gère toute sa relation opérationnelle depuis son téléphone
// (aujourd'hui, planning, notifications, profil) sans voir les outils lourds de direction.
//
// RÉUTILISE (aucun 2ᵉ système) : session Auth staff (lib/authSession), lib/rhSelf (split/confirmable),
// RPC confirm_my_shift_v1 (0020) + respond/mark notifications (0072). La RLS 0011 cantonne déjà chaque
// salarié à SES shifts ; 0072 cantonne SES notifications. Ce front ne fait que lire (scopé RLS) et agir.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import { AuthProvider, RequireAuth, useAuth } from "@/app/_components/StaffAuth";
import { splitMyShifts, summarizeMyHours, canSelfConfirm, shiftStatusLabel } from "@/lib/rhSelf";
import type { StaffShift } from "@/lib/rhPlanning";

// Shift enrichi des colonnes de cycle de vie 0072 (héritage StaffShift + versioning/publication).
type StaffShiftFull = StaffShift & {
  version: number;
  original_planned_start: string | null;
  modification_reason: string | null;
  acknowledged_at: string | null;
  published_at: string | null;
};

type StaffNotif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  severity: "info" | "critical";
  requires_action: boolean;
  status: string;
  shift_id: string | null;
  expires_at: string | null;
  created_at: string;
};

type StaffMemberSelf = {
  full_name: string;
  poste: string | null;
  contrat_type: string | null;
  actif: boolean;
};

type Screen = "today" | "planning" | "notifs" | "profil";

function fmtDateFr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return `${String(dt.getHours()).padStart(2, "0")}h${String(dt.getMinutes()).padStart(2, "0")}`;
}

const NOTIF_STATUS_LABEL: Record<string, string> = {
  non_lue: "Non lue",
  lue: "Lue",
  confirmation_requise: "Réponse requise",
  confirmee: "Confirmée",
  refusee: "Refusée",
  expiree: "Expirée",
};

const card = "rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3";
const shell = "min-h-screen bg-black text-white pb-24";

function StaffInner() {
  const { profile } = useAuth();
  const [screen, setScreen] = useState<Screen>("today");
  const [shifts, setShifts] = useState<StaffShiftFull[]>([]);
  const [notifs, setNotifs] = useState<StaffNotif[]>([]);
  const [member, setMember] = useState<StaffMemberSelf | null>(null);
  const [busy, setBusy] = useState(false);

  const refDate = useMemo(() => new Date(), []);

  const load = useCallback(async (username: string) => {
    const [shiftRes, notifRes, memberRes] = await Promise.all([
      // Brouillons cachés au salarié (published_at IS NOT NULL). RLS 0011 cantonne déjà à SES shifts.
      supabase.from("staff_shifts").select("*").not("published_at", "is", null),
      supabase.from("staff_notifications").select("*").order("created_at", { ascending: false }),
      supabase.from("staff_members").select("full_name, poste, contrat_type, actif").eq("username", username).maybeSingle(),
    ]);
    setShifts((shiftRes.data as StaffShiftFull[]) ?? []);
    setNotifs((notifRes.data as StaffNotif[]) ?? []);
    setMember((memberRes.data as StaffMemberSelf | null) ?? null);
  }, []);

  useEffect(() => {
    if (profile) void load(profile.username);
  }, [profile, load]);

  const split = useMemo(() => splitMyShifts(shifts, refDate), [shifts, refDate]);
  const hours = useMemo(() => summarizeMyHours(shifts, refDate), [shifts, refDate]);
  const nextShift = split.upcoming[0] as StaffShiftFull | undefined;
  const pendingNotifs = notifs.filter((n) => n.status === "confirmation_requise").length;

  // « En service » : un shift du jour confirmé/présent → le bouton MODE SOIRÉE apparaît (handoff /ops).
  // La « date du jour » est calculée dans le FUSEAU D'EXPLOITATION (Europe/Paris), jamais dans le fuseau
  // du navigateur : la soirée appartient à la date d'exploitation parisienne, indépendamment du fuseau du
  // client ou du serveur (aucune fragilité à la bascule minuit UTC/local). `en-CA` → format ISO YYYY-MM-DD.
  const todayIso = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(refDate),
    [refDate],
  );
  const enService = shifts.some(
    (s) => s.exploitation_date === todayIso && (s.status === "confirme" || s.status === "present"),
  );

  async function confirmShift(id: string) {
    setBusy(true);
    await supabase.rpc("confirm_my_shift_v1", { p_shift_id: id });
    if (profile) await load(profile.username);
    setBusy(false);
  }
  async function respondNotif(id: string, accept: boolean) {
    setBusy(true);
    await supabase.rpc("respond_staff_notification_v1", { p_notification_id: id, p_accept: accept });
    if (profile) await load(profile.username);
    setBusy(false);
  }
  async function markRead(id: string) {
    await supabase.rpc("mark_staff_notification_read_v1", { p_notification_id: id });
    if (profile) await load(profile.username);
  }

  if (!profile) return null; // garanti par RequireAuth ; garde de type

  return (
    <main className={shell} data-testid="staff-space">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-black/90 px-5 py-4 backdrop-blur">
        <h1 className="text-lg font-black tracking-[0.28em]">
          MON <span className="text-orange-500">ESPACE</span>
        </h1>
        <p className="mt-0.5 text-xs text-white/45">
          {profile.full_name} · {profile.role}
        </p>
      </header>

      <div className="space-y-4 p-5">
        {enService ? (
          <Link
            href="/ops"
            data-testid="staff-open-ops"
            className="block rounded-2xl bg-orange-500 px-4 py-4 text-center font-black text-black transition hover:bg-orange-400"
          >
            OUVRIR LE MODE SOIRÉE →
          </Link>
        ) : null}

        {/* ——— AUJOURD'HUI ——— */}
        {screen === "today" && (
          <section data-testid="staff-today" className="space-y-3">
            {nextShift ? (
              <div className={card} data-testid="staff-today-shift">
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Prochaine prise de poste</p>
                <p className="mt-1 text-lg font-black">{fmtDateFr(nextShift.exploitation_date)}</p>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <Row k="Poste" v={nextShift.poste || "—"} />
                  <Row
                    k={nextShift.original_planned_start ? "Arrivée demandée" : "Horaire"}
                    v={fmtTime(nextShift.planned_start)}
                    highlight={!!nextShift.original_planned_start}
                  />
                  {nextShift.original_planned_start ? (
                    <>
                      <Row k="Horaire initial" v={fmtTime(nextShift.original_planned_start)} strike />
                      {nextShift.modification_reason ? <Row k="Motif" v={nextShift.modification_reason} /> : null}
                    </>
                  ) : null}
                  <Row k="Statut" v={shiftStatusLabel(nextShift.status)} />
                </dl>
                {canSelfConfirm(nextShift) ? (
                  <button
                    type="button"
                    data-testid="staff-confirm-btn"
                    disabled={busy}
                    onClick={() => confirmShift(nextShift.id)}
                    className="mt-3 w-full rounded-2xl bg-emerald-500 px-4 py-3 font-black text-black disabled:opacity-50"
                  >
                    CONFIRMER MA PRÉSENCE
                  </button>
                ) : (
                  <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-center text-sm text-white/60">
                    Présence {shiftStatusLabel(nextShift.status).toLowerCase()}.
                  </p>
                )}
              </div>
            ) : (
              <div className={card} data-testid="staff-today-empty">
                <p className="text-sm text-white/55">Aucune prise de poste à venir pour le moment.</p>
              </div>
            )}
          </section>
        )}

        {/* ——— PLANNING ——— */}
        {screen === "planning" && (
          <section data-testid="staff-planning" className="space-y-3">
            <div className={card}>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Mon planning</p>
              <p className="mt-1 text-sm text-white/70">
                {hours.aVenir} à venir · {hours.aConfirmer} à confirmer · {hours.presents} présences
              </p>
            </div>
            {split.upcoming.length === 0 ? (
              <p className={`${card} text-sm text-white/45`}>Aucun créneau à venir.</p>
            ) : (
              <ul className="space-y-2">
                {(split.upcoming as StaffShiftFull[]).map((s) => (
                  <li key={s.id} data-testid="staff-shift-row" className={card}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-black text-white/85">{fmtDateFr(s.exploitation_date)}</p>
                        <p className="mt-0.5 text-xs text-white/45">
                          {s.poste || "—"} · {fmtTime(s.planned_start)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-black text-white/60">
                        {shiftStatusLabel(s.status)}
                      </span>
                    </div>
                    {canSelfConfirm(s) ? (
                      <button
                        type="button"
                        data-testid="staff-shift-confirm"
                        disabled={busy}
                        onClick={() => confirmShift(s.id)}
                        className="mt-2 w-full rounded-xl bg-emerald-500/90 px-3 py-2 text-sm font-black text-black disabled:opacity-50"
                      >
                        Confirmer
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ——— NOTIFICATIONS ——— */}
        {screen === "notifs" && (
          <section data-testid="staff-notifs" className="space-y-2">
            {notifs.length === 0 ? (
              <p className={`${card} text-sm text-white/45`}>Aucune notification.</p>
            ) : (
              notifs.map((n) => (
                <div
                  key={n.id}
                  data-testid="staff-notif-row"
                  className={`rounded-2xl border px-4 py-3 ${
                    n.severity === "critical"
                      ? "border-red-500/40 bg-red-500/10"
                      : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-black text-white/85">{n.title}</p>
                    <span className="shrink-0 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-black text-white/60">
                      {NOTIF_STATUS_LABEL[n.status] || n.status}
                    </span>
                  </div>
                  {n.body ? <p className="mt-1 text-sm text-white/60">{n.body}</p> : null}
                  {n.requires_action && n.status === "confirmation_requise" ? (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        data-testid="staff-notif-accept"
                        disabled={busy}
                        onClick={() => respondNotif(n.id, true)}
                        className="flex-1 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-black disabled:opacity-50"
                      >
                        ACCEPTER
                      </button>
                      <button
                        type="button"
                        data-testid="staff-notif-decline"
                        disabled={busy}
                        onClick={() => respondNotif(n.id, false)}
                        className="flex-1 rounded-xl border border-white/15 px-3 py-2 text-sm font-black text-white/70 disabled:opacity-50"
                      >
                        JE NE SUIS PAS DISPONIBLE
                      </button>
                    </div>
                  ) : n.status === "non_lue" ? (
                    <button
                      type="button"
                      data-testid="staff-notif-read"
                      onClick={() => markRead(n.id)}
                      className="mt-2 text-xs font-black text-white/40 underline"
                    >
                      Marquer comme lue
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </section>
        )}

        {/* ——— PROFIL ——— */}
        {screen === "profil" && (
          <section data-testid="staff-profil" className={card}>
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">Mon profil</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row k="Nom" v={profile.full_name} />
              <Row k="Identifiant" v={profile.username} />
              <Row k="Rôle" v={profile.role} />
              <Row k="Poste" v={member?.poste || "—"} />
              <Row k="Contrat" v={member?.contrat_type || "—"} />
              <Row k="Heures pointées" v={hours.heuresReellesCumul == null ? "—" : `${hours.heuresReellesCumul} h`} />
            </dl>
            <p className="mt-3 text-[11px] text-white/30">
              Vos données personnelles uniquement. Aucun salaire, aucune donnée d&apos;autres salariés.
            </p>
          </section>
        )}
      </div>

      {/* ——— Navigation bas (max 4 entrées) ——— */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-white/10 bg-black/95 backdrop-blur">
        {(
          [
            ["today", "Aujourd'hui", 0],
            ["planning", "Planning", 0],
            ["notifs", "Notifs", pendingNotifs],
            ["profil", "Profil", 0],
          ] as [Screen, string, number][]
        ).map(([key, label, badge]) => (
          <button
            key={key}
            type="button"
            data-testid={`staff-nav-${key}`}
            onClick={() => setScreen(key)}
            className={`relative py-3 text-xs font-black ${screen === key ? "text-orange-400" : "text-white/50"}`}
          >
            {label}
            {badge > 0 ? (
              <span className="absolute right-3 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] text-white">
                {badge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </main>
  );
}

function Row({ k, v, highlight, strike }: { k: string; v: string; highlight?: boolean; strike?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-white/40">{k}</dt>
      <dd className={`text-right font-semibold ${highlight ? "text-orange-300" : "text-white/80"} ${strike ? "line-through text-white/30" : ""}`}>
        {v}
      </dd>
    </div>
  );
}

// Export de route : socle Auth partagé (provider) + garde. Le contenu /staff ne s'affiche qu'authentifié,
// sans flash de login, session restaurée de façon fiable (chargement direct, refresh, lien profond).
export default function StaffRoute() {
  return (
    <AuthProvider>
      <RequireAuth>
        <StaffInner />
      </RequireAuth>
    </AuthProvider>
  );
}
