"use client";

// app/espace/[token]/page.tsx — MINI-ESPACE CLIENT (FUNNEL V0, spec MODULE_CRM_CLIENTS_VIP.md §V0 « Mini-espace »).
//
// Le client ouvre ce lien (reçu à l'inscription) → voit SES propres données, en LECTURE SEULE, sans mot de
// passe : ses prochaines soirées, ses QR d'entrée, l'historique de ses passages. C'est du PULL — aucune
// prospection, l'opt-in marketing ne conditionne rien ici.
//
// THIN CLIENT au-dessus de la RPC get_guest_space_v1 (migration 0019, SECURITY DEFINER) : le serveur ne
// renvoie QUE les données de CE client (jeton opaque non devinable), minimisées (ni téléphone, ni spend, ni
// tiers). Aucune écriture, aucun listing. Les helpers TS (crmSpace) ne font que présenter, jamais sécuriser.
//
// Règles dures respectées :
//   · lecture seule, données PROPRES du porteur du jeton (le serveur cantonne, pas l'UI) ;
//   · rien d'inventé : jeton inconnu → « espace introuvable » ; aucune donnée → état vide honnête ;
//   · les PHOTOS ne sont PAS exposées (droit à l'image non recueilli) → section « à venir » sans data.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@supabase/supabase-js";

import {
  extractSpaceToken,
  liveUpcomingPasses,
  normalizeSpacePayload,
  splitVisits,
  universLabel,
  visitStatusLabel,
  type GuestSpacePayload,
  type SpacePass,
  type SpaceVisit,
} from "@/lib/crmSpace";
import {
  currentMonthRef,
  formatSlot,
  groupEventsByDay,
  monthLabelFr,
  normalizeMonthEvents,
  normalizePreferences,
  readSpaceAccess,
  shiftMonth,
  validatePreferencesInput,
  venueLabel,
  VENUE_IDS,
  type GuestPreferences,
  type MonthEvent,
  type MonthRef,
  type VenueId,
} from "@/lib/guestPortal";
import {
  authErrorMessage,
  canAttemptRecovery,
  isPinFormat,
  parseAuthResult,
  sanitizePinInput,
  type AuthResult,
} from "@/lib/guestPortalAuth";

function requiredPublicEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

const supabaseUrl = requiredPublicEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requiredPublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Le jour d'exploitation courant (YYYY-MM-DD, heure locale) sert de référence à-venir/passé.
// C'est un simple repère d'affichage ; le serveur reste la source de vérité des données.
function todayExploitationDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateFr(iso: string): string {
  // iso = 'YYYY-MM-DD'. Affichage FR sans dépendance externe ni fuseau (on lit les composants bruts).
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

const shellClass = "grid min-h-screen place-items-center bg-black p-5 text-white";
const cardClass =
  "w-full max-w-md rounded-[2rem] border border-white/10 bg-[#070707] p-6 shadow-[0_0_40px_rgba(236,73,0,.18)]";

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="text-center">
      <h1 className="text-3xl font-light tracking-[0.38em]">
        CLUB <span className="text-orange-500">O</span>NE
      </h1>
      <p className="mt-2 text-xs uppercase tracking-[0.22em] text-white/40">{subtitle}</p>
    </div>
  );
}

function VisitRow({ v }: { v: SpaceVisit }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-black text-white/85">{v.event_title || universLabel(v.univers)}</p>
        <p className="mt-0.5 text-xs text-white/45">
          {formatDateFr(v.exploitation_date)} · {universLabel(v.univers)}
          {v.is_host ? " · Hôte de table" : ""}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-black text-white/60">
        {visitStatusLabel(v.status)}
      </span>
    </li>
  );
}

const sectionTitleClass = "text-xs uppercase tracking-[0.18em] text-white/40";
const inputClass =
  "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-orange-500/50";

// verify_guest_pin_v2 (0061, rate-limité) avec repli transparent sur v1 (0058) si l'env n'est pas encore migré.
// Retourne le résultat parsé (parseAuthResult) — le verrou 'locked' porte retry_after_seconds pour l'UX.
async function verifyPinRpc(token: string, pin: string): Promise<AuthResult> {
  let res = await supabase.rpc("verify_guest_pin_v2", { p_token: token, p_pin: pin });
  if (res.error && /verify_guest_pin_v2/.test(res.error.message || "")) {
    res = await supabase.rpc("verify_guest_pin_v1", { p_token: token, p_pin: pin });
  }
  if (res.error) {
    return {
      ok: false,
      code: "network",
      spaceToken: null,
      expiresAt: null,
      lockedUntil: null,
      retryAfterSeconds: null,
    };
  }
  return parseAuthResult(res.data);
}

// ————————————————————————————————————————————————————————————————
// (E6/RL) Re-accès d'un lien EXPIRÉ par PIN — SANS email/SMS (verify_guest_pin_v2, 0061). Ré-arme l'expiration,
// applique le RATE LIMITING (verrou après N échecs). Le client détient encore SON lien : il ré-arme l'accès.
// ————————————————————————————————————————————————————————————————
function PinReAccess({
  token,
  hasPin,
  onUnlocked,
}: {
  token: string;
  hasPin: boolean;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [locked, setLocked] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const r = await verifyPinRpc(token, pin);
    setBusy(false);
    if (r.ok) {
      onUnlocked();
      return;
    }
    setLocked(r.code === "locked");
    setErr(authErrorMessage(r.code, { retryAfterSeconds: r.retryAfterSeconds }));
  }

  return (
    <div className="mt-8 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
      <p className="font-black text-amber-200">Lien expiré</p>
      <p className="mt-2 text-sm text-white/55">
        {hasPin
          ? "Ce lien a expiré. Saisissez votre code personnel pour le réactiver (aucun email requis)."
          : "Ce lien a expiré et aucun code de secours n'a été défini. Utilisez la récupération ci-dessous ou rapprochez-vous de votre contact Club One."}
      </p>
      {hasPin ? (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            inputMode="numeric"
            autoComplete="off"
            aria-label="Code personnel à 4 à 8 chiffres"
            value={pin}
            onChange={(e) => setPin(sanitizePinInput(e.target.value))}
            placeholder="Code à 4–8 chiffres"
            className={`${inputClass} text-center tracking-[0.4em]`}
          />
          {err ? (
            <p className={`text-sm ${locked ? "text-amber-300" : "text-red-300"}`} role="alert">
              {err}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || locked || pin.length < 4}
            className="w-full rounded-2xl bg-orange-500 px-4 py-3 font-black text-black transition hover:bg-orange-400 disabled:opacity-50"
          >
            {busy ? "Vérification…" : "Réactiver mon espace"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// (RC) RÉCUPÉRATION SANS EMAIL — le client a PERDU son lien : téléphone + PIN → NOUVEAU lien (recover_guest_access_v1,
// 0061). Redirige vers le nouveau jeton. Rate-limité côté serveur ; réponses neutres (anti-énumération).
// ————————————————————————————————————————————————————————————————
function RecoveryForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const res = await supabase.rpc("recover_guest_access_v1", { p_phone: phone.trim(), p_pin: pin });
    setBusy(false);
    if (res.error) {
      setErr(
        /recover_guest_access_v1/.test(res.error.message || "")
          ? "Récupération indisponible sur cet environnement."
          : "Service momentanément indisponible. Réessayez.",
      );
      return;
    }
    const r = parseAuthResult(res.data);
    if (r.ok && r.spaceToken) {
      // Nouveau lien émis : on navigue vers l'espace ré-armé (aucun email, aucun jeton permanent).
      router.push(`/espace/${encodeURIComponent(r.spaceToken)}`);
      return;
    }
    setErr(authErrorMessage(r.code, { retryAfterSeconds: r.retryAfterSeconds }));
  }

  return (
    <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.02] p-5 text-left">
      {open ? (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-center text-xs uppercase tracking-[0.18em] text-white/40">Récupérer mon accès</p>
          <p className="text-center text-xs text-white/50">
            Saisissez votre téléphone et votre code personnel. Aucun email ni SMS n&apos;est envoyé.
          </p>
          <input
            inputMode="tel"
            autoComplete="tel"
            aria-label="Téléphone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Téléphone (ex. +33600000000)"
            className={inputClass}
          />
          <input
            inputMode="numeric"
            autoComplete="off"
            aria-label="Code personnel"
            value={pin}
            onChange={(e) => setPin(sanitizePinInput(e.target.value))}
            placeholder="Code à 4–8 chiffres"
            className={`${inputClass} text-center tracking-[0.4em]`}
          />
          {err ? (
            <p className="text-sm text-red-300" role="alert">
              {err}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !canAttemptRecovery({ phone, pin })}
            className="w-full rounded-2xl bg-orange-500 px-4 py-3 font-black text-black transition hover:bg-orange-400 disabled:opacity-50"
          >
            {busy ? "Récupération…" : "Récupérer mon accès"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-center text-xs font-black text-orange-300 underline underline-offset-2"
        >
          J&apos;ai perdu mon lien — récupérer avec mon téléphone et mon code
        </button>
      )}
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// (RV) LOGOUT + RÉVOCATION — logout = abandon du jeton côté client (on quitte la vue) ; révocation = appel
// serveur revoke_guest_token_v1 (0061) qui tue le lien courant. Le re-accès légitime repasse par le PIN.
// ————————————————————————————————————————————————————————————————
function LogoutRevoke({ token, onLoggedOut }: { token: string; onLoggedOut: (revoked: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function revoke() {
    setErr("");
    setBusy(true);
    const res = await supabase.rpc("revoke_guest_token_v1", { p_token: token });
    setBusy(false);
    if (res.error && !/revoke_guest_token_v1/.test(res.error.message || "")) {
      setErr("Révocation momentanément indisponible. Réessayez.");
      return;
    }
    // Que la RPC existe ou non, on considère la session terminée côté client (le jeton est abandonné).
    onLoggedOut(!res.error);
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black text-white/60">Sécurité de mon accès</p>
          <p className="mt-0.5 text-[11px] text-white/40">
            Se déconnecter oublie ce lien sur cet appareil. Révoquer le désactive définitivement partout.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onLoggedOut(false)}
          className="shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-black text-white/70"
        >
          Se déconnecter
        </button>
      </div>
      {confirming ? (
        <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs text-red-200">
            Révoquer ce lien le rend inutilisable, y compris pour vous. Vous devrez récupérer votre accès
            (téléphone + code). Continuer ?
          </p>
          {err ? (
            <p className="mt-2 text-xs text-red-300" role="alert">
              {err}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="rounded-full bg-red-500 px-4 py-2 text-xs font-black text-black disabled:opacity-50"
            >
              {busy ? "Révocation…" : "Révoquer définitivement"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-black text-white/60"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 text-xs font-black text-red-300 underline underline-offset-2"
        >
          Révoquer ce lien définitivement
        </button>
      )}
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// (E2) Préférences de service (musique / table / allergies) + droit à l'image — self-service.
// ————————————————————————————————————————————————————————————————
function PreferencesSection({
  token,
  initialPrefs,
  initialImageConsent,
  hasPin,
}: {
  token: string;
  initialPrefs: GuestPreferences;
  initialImageConsent: boolean;
  hasPin: boolean;
}) {
  const [musique, setMusique] = useState(initialPrefs.musique ?? "");
  const [table, setTable] = useState(initialPrefs.table ?? "");
  const [allergies, setAllergies] = useState(initialPrefs.allergies ?? "");
  const [imageConsent, setImageConsent] = useState(initialImageConsent);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  // PIN optionnel : mise en place d'un code de secours (set_guest_pin_v1) pour ré-accès si le lien expire.
  // Si un PIN existe déjà, la modification passe par rotate_guest_pin_v1 (0061) : vérifie l'ANCIEN puis pose
  // le NOUVEAU (rate-limité). L'état hasPin devient local pour refléter la mise en place sans recharger.
  const [pinDefined, setPinDefined] = useState(hasPin);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [oldPin, setOldPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState("");
  const [pinErr, setPinErr] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSaved(false);
    // Validation MIROIR (jamais une sécurité) : le serveur re-tronque/whiteliste de toute façon.
    const { clean } = validatePreferencesInput({ musique, table, allergies });
    setBusy(true);
    const { data, error } = await supabase.rpc("set_guest_preferences_v1", {
      p_token: token,
      p_prefs: clean,
      p_image_consent: imageConsent,
    });
    setBusy(false);
    if (error) {
      setErr("Enregistrement momentanément indisponible. Réessayez.");
      return;
    }
    const row = (data ?? {}) as { ok?: boolean; code?: string };
    if (!row.ok) {
      setErr(row.code === "expired" ? "Ce lien a expiré." : "Enregistrement refusé.");
      return;
    }
    setSaved(true);
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    setPinMsg("");
    setPinErr(false);
    if (!isPinFormat(pin)) {
      setPinErr(true);
      setPinMsg("Le code doit contenir 4 à 8 chiffres.");
      return;
    }
    setPinBusy(true);
    // Un PIN déjà défini → ROTATION (vérifie l'ancien, 0061) ; sinon MISE EN PLACE (0058).
    const res = pinDefined
      ? await supabase.rpc("rotate_guest_pin_v1", { p_token: token, p_old_pin: oldPin, p_new_pin: pin })
      : await supabase.rpc("set_guest_pin_v1", { p_token: token, p_pin: pin });
    setPinBusy(false);
    if (res.error) {
      setPinErr(true);
      setPinMsg("Indisponible pour le moment.");
      return;
    }
    const r = parseAuthResult(res.data);
    if (r.ok) {
      setPinMsg(
        pinDefined
          ? "Code modifié. L'ancien code n'est plus valable."
          : "Code enregistré. Il permettra de réactiver ce lien s'il expire.",
      );
      setPin("");
      setOldPin("");
      setPinOpen(false);
      setPinDefined(true);
      return;
    }
    setPinErr(true);
    setPinMsg(authErrorMessage(r.code, { retryAfterSeconds: r.retryAfterSeconds }));
  }

  return (
    <div className="mt-6">
      <h2 className={sectionTitleClass}>Mes préférences</h2>
      <form onSubmit={save} className="mt-3 space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div>
          <label className="mb-1 block text-xs text-white/50">Ambiance musicale préférée</label>
          <input
            value={musique}
            onChange={(e) => setMusique(e.target.value)}
            placeholder="Ex. house, hip-hop…"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/50">Préférence de table / placement</label>
          <input
            value={table}
            onChange={(e) => setTable(e.target.value)}
            placeholder="Ex. près du DJ, en retrait…"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/50">Allergies / régime</label>
          <input
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
            placeholder="Ex. arachides, sans gluten…"
            className={inputClass}
          />
        </div>
        <label className="flex gap-3 text-xs leading-relaxed text-white/70">
          <input
            type="checkbox"
            checked={imageConsent}
            onChange={(e) => setImageConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
          />
          <span>
            J&apos;autorise Club One à me photographier / filmer pendant les soirées et à utiliser ces images
            (droit à l&apos;image). Révocable à tout moment ici.
          </span>
        </label>
        {err ? <p className="text-sm text-red-300">{err}</p> : null}
        {saved ? <p className="text-sm text-emerald-300">Préférences enregistrées.</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-2xl bg-orange-500 px-4 py-3 font-black text-black transition hover:bg-orange-400 disabled:opacity-50"
        >
          {busy ? "Enregistrement…" : "Enregistrer mes préférences"}
        </button>
      </form>

      {/* PIN de secours (E6/RP) — optionnel : réactive un lien expiré / récupère l'accès sans email. */}
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        {pinDefined ? (
          <p className="text-xs text-white/50">
            Un code de secours est défini : il réactive ce lien s&apos;il expire et permet de récupérer votre
            accès (téléphone + code) si vous perdez ce lien.
          </p>
        ) : (
          <p className="text-xs text-white/50">
            Astuce sécurité : définissez un code de secours pour réactiver ce lien s&apos;il expire ou récupérer
            votre accès si vous le perdez.
          </p>
        )}
        {pinOpen ? (
          <form onSubmit={savePin} className="mt-3 space-y-2">
            {pinDefined ? (
              <input
                inputMode="numeric"
                autoComplete="off"
                aria-label="Ancien code"
                value={oldPin}
                onChange={(e) => setOldPin(sanitizePinInput(e.target.value))}
                placeholder="Ancien code"
                className={`${inputClass} text-center tracking-[0.4em]`}
              />
            ) : null}
            <input
              inputMode="numeric"
              autoComplete="off"
              aria-label={pinDefined ? "Nouveau code" : "Code de secours"}
              value={pin}
              onChange={(e) => setPin(sanitizePinInput(e.target.value))}
              placeholder={pinDefined ? "Nouveau code (4 à 8 chiffres)" : "4 à 8 chiffres"}
              className={`${inputClass} text-center tracking-[0.4em]`}
            />
            <button
              type="submit"
              disabled={pinBusy || pin.length < 4 || (pinDefined && oldPin.length < 4)}
              className="w-full rounded-2xl border border-orange-500/40 bg-orange-500/10 px-4 py-2.5 text-sm font-black text-orange-200 disabled:opacity-50"
            >
              {pinBusy ? "Enregistrement…" : pinDefined ? "Modifier mon code" : "Définir mon code"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setPinOpen(true)}
            className="mt-2 text-xs font-black text-orange-300 underline underline-offset-2"
          >
            {pinDefined ? "Modifier mon code de secours" : "Définir un code de secours"}
          </button>
        )}
        {pinMsg ? (
          <p className={`mt-2 text-xs ${pinErr ? "text-red-300" : "text-emerald-300"}`} role="status">
            {pinMsg}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// (E3) Agenda mensuel public — soirées publiées d'un mois, filtrées par salle (public_month_events_v1).
// ————————————————————————————————————————————————————————————————
function MonthlyAgenda() {
  const [month, setMonth] = useState<MonthRef>(() => currentMonthRef(new Date()));
  const [venue, setVenue] = useState<VenueId | null>(null);
  const [events, setEvents] = useState<MonthEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("public_month_events_v1", {
        p_venue: venue,
        p_year: month.year,
        p_month: month.month,
      });
      if (cancelled) return;
      setEvents(error ? [] : normalizeMonthEvents(data));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, month]);

  const days = useMemo(() => groupEventsByDay(events, venue), [events, venue]);

  return (
    <div className="mt-6">
      <h2 className={sectionTitleClass}>Agenda des soirées</h2>

      {/* Navigation mensuelle */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-black text-white/70"
          aria-label="Mois précédent"
        >
          ‹
        </button>
        <p className="font-black capitalize text-white/85">{monthLabelFr(month)}</p>
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-black text-white/70"
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>

      {/* Filtre salle */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setVenue(null)}
          className={`rounded-full px-3 py-1 text-[11px] font-black ${
            venue === null ? "bg-orange-500 text-black" : "bg-white/[0.06] text-white/60"
          }`}
        >
          Toutes
        </button>
        {VENUE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setVenue(id)}
            className={`rounded-full px-3 py-1 text-[11px] font-black ${
              venue === id ? "bg-orange-500 text-black" : "bg-white/[0.06] text-white/60"
            }`}
          >
            {venueLabel(id)}
          </button>
        ))}
      </div>

      {/* Liste par jour */}
      {loading ? (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/45">
          Chargement de l&apos;agenda…
        </p>
      ) : days.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/45">
          Aucune soirée publiée pour ce mois {venue ? `au ${venueLabel(venue)}` : ""}.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {days.map((day) => (
            <div key={day.date}>
              <p className="mb-2 text-xs font-black text-white/40">{formatDateFr(day.date)}</p>
              <ul className="space-y-2">
                {day.events.map((ev) => {
                  const key = ev.slug || `${ev.venue_id}-${ev.event_date}-${ev.title}`;
                  const open = openSlug === key;
                  const slot = formatSlot(ev);
                  return (
                    <li
                      key={key}
                      className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenSlug((cur) => (cur === key ? null : key))}
                        className="flex w-full items-center justify-between gap-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-black text-white/85">
                            {ev.title || venueLabel(ev.venue_id)}
                          </p>
                          <p className="mt-0.5 text-xs text-white/45">
                            {venueLabel(ev.venue_id)}
                            {slot ? ` · ${slot}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-white/40">{open ? "−" : "+"}</span>
                      </button>
                      {open ? (
                        <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-sm text-white/60">
                          {ev.description ? <p>{ev.description}</p> : null}
                          {ev.artistes ? (
                            <p>
                              <span className="text-white/40">Programmation : </span>
                              {ev.artistes}
                            </p>
                          ) : null}
                          {ev.lineup && ev.lineup.length > 0 ? (
                            <p>
                              <span className="text-white/40">Line-up : </span>
                              {ev.lineup.join(", ")}
                            </p>
                          ) : null}
                          {!ev.description && !ev.artistes && (!ev.lineup || ev.lineup.length === 0) ? (
                            <p className="text-white/40">Détails à venir.</p>
                          ) : null}
                          {ev.ticket_url ? (
                            <a
                              href={ev.ticket_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block rounded-full bg-orange-500 px-4 py-1.5 text-[11px] font-black text-black"
                            >
                              Billetterie →
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuestSpacePage() {
  const params = useParams<{ token: string }>();
  const rawToken = useMemo(() => decodeURIComponent(String(params?.token || "")), [params]);
  const token = useMemo(() => extractSpaceToken(rawToken), [rawToken]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [space, setSpace] = useState<GuestSpacePayload | null>(null);
  const [openPassToken, setOpenPassToken] = useState<string | null>(null);

  // (RV) Logout/révocation : abandon du jeton côté client (on cesse d'afficher les données de cette session).
  const [loggedOut, setLoggedOut] = useState<null | { revoked: boolean }>(null);

  // E6 — durcissement du lien porteur : signaux d'expiration + PIN renvoyés par get_guest_space_v2 (0058).
  const [expired, setExpired] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  // E2 — préférences/consentement, préremplies depuis le payload v2, éditables via set_guest_preferences_v1.
  const [prefs, setPrefs] = useState<GuestPreferences>({});
  const [imageConsent, setImageConsent] = useState(false);

  const refDate = useMemo(() => todayExploitationDate(), []);

  // Charge le mini-espace via get_guest_space_v2 : version durcie (rejette les jetons expirés) qui expose EN
  // PLUS preferences/image_consent. Best-effort : si v2 est absente (env non migré 0058), repli sur v1.
  const loadSpace = useCallback(async () => {
    if (!token) {
      setLoadError("Lien invalide.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    let res = await supabase.rpc("get_guest_space_v2", { p_space_token: token });
    // Repli transparent vers v1 si la RPC v2 n'existe pas encore (migration 0058 non appliquée).
    if (res.error && /get_guest_space_v2/.test(res.error.message || "")) {
      res = await supabase.rpc("get_guest_space_v1", { p_space_token: token });
    }
    if (res.error) {
      setLoadError("Espace momentanément indisponible. Réessayez plus tard.");
      setLoading(false);
      return;
    }
    const access = readSpaceAccess(res.data);
    setExpired(access.expired);
    setHasPin(access.hasPin);
    const payload = normalizeSpacePayload(res.data);
    setSpace(payload);
    if (payload.found) {
      const raw = (res.data ?? {}) as Record<string, unknown>;
      setPrefs(normalizePreferences(raw.preferences));
      setImageConsent(raw.image_consent === true);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadSpace();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSpace]);

  // (RV) DÉCONNECTÉ : le jeton a été abandonné (logout) ou révoqué. On n'affiche AUCUNE donnée.
  if (loggedOut) {
    return (
      <main className={shellClass}>
        <section className={cardClass}>
          <Header subtitle="Mon espace" />
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="font-black text-white/80">
              {loggedOut.revoked ? "Lien révoqué" : "Vous êtes déconnecté"}
            </p>
            <p className="mt-2 text-sm text-white/55">
              {loggedOut.revoked
                ? "Ce lien a été désactivé. Récupérez votre accès avec votre téléphone et votre code."
                : "Ce lien n'est plus affiché sur cet appareil. Rouvrez votre lien personnel ou récupérez votre accès ci-dessous."}
            </p>
          </div>
          <RecoveryForm />
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className={shellClass}>
        <section className={cardClass}>
          <Header subtitle="Mon espace" />
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="font-black text-white/70">Chargement…</p>
          </div>
        </section>
      </main>
    );
  }

  // (E6/RL) Lien EXPIRÉ : on ne montre AUCUNE donnée. Re-accès par PIN (verify v2, rate-limité) OU récupération
  // téléphone+PIN si le lien est aussi perdu — tout SANS email/SMS.
  if (expired && token) {
    return (
      <main className={shellClass}>
        <section className={cardClass}>
          <Header subtitle="Mon espace" />
          <PinReAccess token={token} hasPin={hasPin} onUnlocked={loadSpace} />
          <RecoveryForm />
        </section>
      </main>
    );
  }

  if (loadError || !space || !space.found) {
    return (
      <main className={shellClass}>
        <section className={cardClass}>
          <Header subtitle="Mon espace" />
          <div className="mt-8 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
            <p className="font-black text-amber-200">Espace introuvable</p>
            <p className="mt-2 text-sm text-white/55">
              {loadError || "Ce lien n'est pas (ou plus) valide. Rapprochez-vous de votre contact Club One."}
            </p>
          </div>
          {/* Récupération sans email : le client qui a perdu/révoqué son lien retrouve l'accès. */}
          <RecoveryForm />
        </section>
      </main>
    );
  }

  const visits: SpaceVisit[] = space.visits ?? [];
  const passes: SpacePass[] = space.passes ?? [];
  const { upcoming, past } = splitVisits(visits, refDate);
  const livePasses = liveUpcomingPasses(passes, refDate);

  return (
    <main className={shellClass}>
      <section className={cardClass}>
        <Header subtitle="Mon espace" />

        {space.first_name ? (
          <p className="mt-5 text-center text-lg font-black text-white/85">
            Bonjour {space.first_name} 👋
          </p>
        ) : null}

        {/* ——— Mes QR d'entrée (soirées à venir non scannées) ——— */}
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-[0.18em] text-white/40">Mes QR d&apos;entrée</h2>
          {livePasses.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/45">
              Aucun QR d&apos;entrée actif pour le moment. Vos prochaines invitations apparaîtront ici.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {livePasses.map((p) => {
                // liveUpcomingPasses garantit un jeton non-null ; repli défensif au cas où.
                const qr = p.qr_token ?? "";
                return (
                  <li
                    key={qr || p.exploitation_date}
                    className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-black text-white/85">
                          {p.event_title || universLabel(p.univers)}
                        </p>
                        <p className="mt-0.5 text-xs text-white/45">
                          {formatDateFr(p.exploitation_date)} · {universLabel(p.univers)}
                          {p.is_host ? " · QR d'équipe (hôte)" : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenPassToken((cur) => (cur === qr ? null : qr))}
                        className="shrink-0 rounded-full bg-orange-500 px-3 py-1.5 text-[11px] font-black text-black"
                      >
                        {openPassToken === qr ? "Masquer" : "Afficher"}
                      </button>
                    </div>
                    {openPassToken === qr ? (
                      <div className="mt-3">
                        <div className="mx-auto grid place-items-center rounded-3xl bg-white p-4">
                          <QRCodeSVG value={qr} size={200} />
                        </div>
                        <p className="mt-2 break-all text-center text-[11px] text-white/30">{qr}</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ——— Prochaines soirées ——— */}
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-[0.18em] text-white/40">Prochaines soirées</h2>
          {upcoming.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/45">
              Pas de soirée à venir enregistrée. À bientôt !
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((v) => (
                <VisitRow key={`${v.exploitation_date}-${v.univers}`} v={v} />
              ))}
            </ul>
          )}
        </div>

        {/* ——— Mes passages ——— */}
        {past.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-xs uppercase tracking-[0.18em] text-white/40">Mes passages</h2>
            <ul className="mt-3 space-y-2">
              {past.map((v) => (
                <VisitRow key={`${v.exploitation_date}-${v.univers}`} v={v} />
              ))}
            </ul>
          </div>
        ) : null}

        {/* ——— (E3) Agenda mensuel public (Eden / Cercle / Terminus) ——— */}
        {token ? <MonthlyAgenda /> : null}

        {/* ——— (E2) Préférences de service + droit à l'image (self-service) ——— */}
        {token ? (
          <PreferencesSection
            token={token}
            initialPrefs={prefs}
            initialImageConsent={imageConsent}
            hasPin={hasPin}
          />
        ) : null}

        {/* ——— Photos : état honnête, aucune donnée (stockage photo non branché) ——— */}
        <div className="mt-6">
          <h2 className={sectionTitleClass}>Photos des soirées</h2>
          <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/45">
            {imageConsent
              ? "Merci ! Vos photos apparaîtront ici dès qu'elles seront disponibles."
              : "Bientôt disponible. Activez le droit à l'image ci-dessus pour y figurer."}
          </p>
        </div>

        {/* ——— (RV) Logout + révocation du lien ——— */}
        {token ? (
          <LogoutRevoke token={token} onLoggedOut={(revoked) => setLoggedOut({ revoked })} />
        ) : null}

        <p className="mt-6 rounded-2xl bg-white/[0.03] px-4 py-3 text-center text-[11px] text-white/40">
          Espace personnel. Conservez ce lien ou ajoutez-le à vos favoris.
        </p>
      </section>
    </main>
  );
}
