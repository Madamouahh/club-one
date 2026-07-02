"use client";

// app/i/[token]/page.tsx — PAGE PUBLIQUE d'inscription par QR (FUNNEL V0, spec MODULE_CRM_CLIENTS_VIP.md §V0).
//
// Le client scanne le QR d'un promoteur → arrive ici → s'inscrit LUI-MÊME (4 champs) → reçoit son
// QR d'entrée personnel. Route DISTINCTE de l'ancienne /invite/[token] (affichage QR promoteur legacy,
// migration 0003) qui reste intacte pendant la transition.
//
// C'est un THIN CLIENT au-dessus du socle 0014 : toute la sécurité est refaite en SQL par les RPC
// SECURITY DEFINER (get_invite_link_public en lecture, register_guest_via_invite_v1 en écriture).
// Les validations TS ci-dessous (crmFunnel) ne sont qu'un MIROIR pour l'UX, jamais une sécurité.
//
// Règles dures respectées (spec §V0) :
//   · le client s'inscrit LUI-MÊME (jamais l'hôte qui saisit les données d'un tiers) ;
//   · blocage < 18 ans à la DATE DE LA SOIRÉE (L.3342-1) avant tout appel serveur ;
//   · l'entrée gratuite N'EST PAS conditionnée à la case marketing (base légale = exécution du contrat) ;
//   · consentement DÉGROUPÉ (service ≠ marketing), non pré-coché, journalisé avec le TEXTE EXACT présenté ;
//   · AUCUN nom d'établissement inventé : tant que la raison sociale (etc.) n'est pas configurée, la case
//     concernée reste DÉSACTIVÉE (on ne journalise jamais un consentement contre un texte à placeholder).

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@supabase/supabase-js";

import {
  CONSENT_MARKETING_TEMPLATE,
  CONSENT_SERVICE_TEMPLATE,
  consentTextsReady,
  fillConsentText,
  normalizeE164,
  type ConsentValues,
} from "@/lib/crmClients";
import {
  inviteAvailability,
  registrationRefDate,
  validateRegistration,
  type FunnelUnivers,
  type InviteKind,
  type PublicInviteLink,
} from "@/lib/crmFunnel";

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

// ————————————————————————————————————————————————————————————————
// Données fondateur pour les textes de consentement (config, jamais devinées).
// Fournies par le fondateur via variables d'env publiques ; absentes aujourd'hui → placeholders visibles
// → cases désactivées (aucun consentement invalide journalisé). Se remplissent SANS toucher au code.
// ————————————————————————————————————————————————————————————————
const CONSENT_VALUES: ConsentValues = {
  raisonSociale: process.env.NEXT_PUBLIC_CLUB_RAISON_SOCIALE || null,
  maxParMois: process.env.NEXT_PUBLIC_CLUB_MARKETING_CADENCE
    ? Number(process.env.NEXT_PUBLIC_CLUB_MARKETING_CADENCE)
    : null,
  lienPolitique: process.env.NEXT_PUBLIC_CLUB_PRIVACY_URL || null,
};

const UNIVERS_LABELS: Record<FunnelUnivers, string> = {
  eden: "Eden",
  cercle: "Cercle",
  terminus: "Terminus",
};

const KIND_LABELS: Record<InviteKind, string> = {
  guest_list: "Invitation",
  team_vip: "Table VIP",
};

// Message d'indisponibilité honnête d'un lien (aucune promesse fabriquée).
const UNAVAILABLE_LABELS: Record<"unknown" | "expired" | "exhausted", string> = {
  unknown: "Cette invitation est introuvable ou a été retirée.",
  expired: "Cette invitation a expiré.",
  exhausted: "Cette invitation a atteint son nombre maximum d'inscriptions.",
};

// Codes d'erreur renvoyés par register_guest_via_invite_v1 → message utilisateur (copie d'UI).
const REGISTER_ERROR_LABELS: Record<string, string> = {
  invalid_token: "Lien invalide.",
  first_name_required: "Le prénom est obligatoire.",
  phone_invalid: "Numéro de téléphone invalide.",
  birthday_required: "La date de naissance est obligatoire.",
  underage: "Inscription réservée aux personnes majeures (18 ans et plus).",
  consent_service_text_missing: "Consentement invalide, réessayez.",
  consent_marketing_text_missing: "Consentement invalide, réessayez.",
  unknown_link: "Cette invitation est introuvable.",
  link_expired: "Cette invitation a expiré.",
  link_exhausted: "Cette invitation a atteint son quota d'inscriptions.",
};

// Erreurs de validation TS (miroir) → message utilisateur.
const VALIDATION_LABELS: Record<string, string> = {
  first_name_required: "Renseignez votre prénom.",
  phone_invalid: "Numéro de téléphone invalide (ex. 06 12 34 56 78).",
  birthday_required: "Renseignez votre date de naissance.",
  birthday_invalid: "Date de naissance invalide.",
  underage: "Inscription réservée aux personnes majeures (18 ans et plus).",
  consent_service_text_missing: "Consentement invalide.",
  consent_marketing_text_missing: "Consentement invalide.",
};

type PublicLinkRow = {
  valid: boolean;
  kind: string | null;
  univers: string | null;
  event_title: string | null;
  exploitation_date: string | null;
  expires_at: string | null;
  uses_count: number | null;
  max_uses: number | null;
};

type RegisterRow = {
  ok: boolean;
  code: string;
  message: string;
  qr_token: string | null;
  guest_id: string | null;
};

function toPublicInviteLink(row: PublicLinkRow | null): PublicInviteLink | null {
  if (!row) return null;
  return {
    valid: !!row.valid,
    kind: (row.kind as InviteKind | null) ?? null,
    univers: (row.univers as FunnelUnivers | null) ?? null,
    eventTitle: row.event_title,
    exploitationDate: row.exploitation_date,
    expiresAt: row.expires_at,
    usesCount: row.uses_count ?? 0,
    maxUses: row.max_uses ?? 0,
  };
}

export default function PublicRegistrationPage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => decodeURIComponent(String(params?.token || "")), [params]);

  const [link, setLink] = useState<PublicInviteLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Champs du formulaire (4 champs de la spec).
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [consentService, setConsentService] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState<RegisterRow | null>(null);
  // Lien du MINI-ESPACE client, résolu APRÈS inscription depuis le QR délivré (RPC resolve_space_from_pass_v1,
  // migration 0019). Détenir le qr_token = être ce client → aucune exposition nouvelle. Optionnel : si la
  // résolution échoue (réseau, ou RPC absente sur un environnement non migré), l'inscription reste valide.
  const [spaceToken, setSpaceToken] = useState<string | null>(null);

  // Textes de consentement EXACTS (constantes lib), remplis avec les données fondateur si présentes.
  const serviceText = useMemo(() => fillConsentText(CONSENT_SERVICE_TEMPLATE, CONSENT_VALUES), []);
  const marketingText = useMemo(
    () => fillConsentText(CONSENT_MARKETING_TEMPLATE, CONSENT_VALUES),
    [],
  );
  // Case activable seulement si son texte est complet (aucun placeholder → consentement valide).
  const serviceReady = !!(CONSENT_VALUES.raisonSociale && CONSENT_VALUES.raisonSociale.trim());
  const marketingReady = consentTextsReady(CONSENT_VALUES).ready;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setLoadError(UNAVAILABLE_LABELS.unknown);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc("get_invite_link_public", { p_token: token });
      if (cancelled) return;
      if (error) {
        setLoadError("Impossible de charger l'invitation. Réessayez plus tard.");
        setLoading(false);
        return;
      }
      const row = (Array.isArray(data) ? data[0] : data) as PublicLinkRow | null;
      setLink(toPublicInviteLink(row));
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Une fois le QR d'entrée délivré, on résout le jeton du mini-espace (best-effort, jamais bloquant).
  useEffect(() => {
    let cancelled = false;
    const qr = result?.qr_token;
    if (!qr) return;
    async function resolve(qrToken: string) {
      const { data, error } = await supabase.rpc("resolve_space_from_pass_v1", { p_qr_token: qrToken });
      if (cancelled || error) return;
      const row = (Array.isArray(data) ? data[0] : data) as { found?: boolean; space_token?: string } | null;
      if (row?.found && row.space_token) setSpaceToken(String(row.space_token));
    }
    resolve(qr);
    return () => {
      cancelled = true;
    };
  }, [result?.qr_token]);

  const availability = useMemo(
    () => inviteAvailability(link, new Date()),
    [link],
  );

  const phoneE164 = useMemo(() => normalizeE164(phone), [phone]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    if (!link) return;

    const refDate = registrationRefDate(link.exploitationDate, new Date());
    const check = validateRegistration(
      {
        firstName,
        lastName: lastName || null,
        phoneE164,
        birthday,
        consentService,
        consentServiceText: consentService ? serviceText : null,
        consentMarketing,
        consentMarketingText: consentMarketing ? marketingText : null,
      },
      refDate,
    );
    if (!check.ok) {
      setFormErrors(check.errors);
      return;
    }
    setFormErrors([]);
    setSubmitting(true);

    // La sécurité réelle est côté SQL : on renvoie le TEXTE EXACT présenté pour journalisation CNIL.
    const { data, error } = await supabase.rpc("register_guest_via_invite_v1", {
      p_token: token,
      p_first_name: firstName.trim(),
      p_last_name: lastName.trim() || null,
      p_phone_e164: phoneE164,
      p_birthday: birthday,
      p_consent_service: consentService,
      p_consent_service_text: consentService ? serviceText : null,
      p_consent_marketing: consentMarketing,
      p_consent_marketing_text: consentMarketing ? marketingText : null,
    });
    setSubmitting(false);

    if (error) {
      setServerError("Une erreur est survenue. Réessayez.");
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as RegisterRow | null;
    if (!row) {
      setServerError("Réponse inattendue du serveur.");
      return;
    }
    if (!row.ok) {
      setServerError(REGISTER_ERROR_LABELS[row.code] || row.message || "Inscription refusée.");
      // Un lien épuisé/expiré entre-temps : rafraîchit l'état d'ouverture du formulaire.
      if (row.code === "link_exhausted" || row.code === "link_expired" || row.code === "unknown_link") {
        setLink((prev) => (prev ? { ...prev, usesCount: prev.maxUses } : prev));
      }
      return;
    }
    setResult(row);
  }

  const shellClass =
    "grid min-h-screen place-items-center bg-black p-5 text-white";
  const cardClass =
    "w-full max-w-md rounded-[2rem] border border-white/10 bg-[#070707] p-6 shadow-[0_0_40px_rgba(236,73,0,.18)]";

  const header = (
    <div className="text-center">
      <h1 className="text-3xl font-light tracking-[0.38em]">
        CLUB <span className="text-orange-500">O</span>NE
      </h1>
      <p className="mt-2 text-xs uppercase tracking-[0.22em] text-white/40">Inscription soirée</p>
    </div>
  );

  // ————— État : chargement —————
  if (loading) {
    return (
      <main className={shellClass}>
        <section className={cardClass}>
          {header}
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="font-black text-white/70">Chargement…</p>
          </div>
        </section>
      </main>
    );
  }

  // ————— État : erreur de chargement —————
  if (loadError) {
    return (
      <main className={shellClass}>
        <section className={cardClass}>
          {header}
          <div className="mt-8 rounded-3xl border border-red-500/30 bg-red-500/10 p-6 text-center">
            <p className="font-black text-red-300">Invitation indisponible</p>
            <p className="mt-2 text-sm text-white/55">{loadError}</p>
          </div>
        </section>
      </main>
    );
  }

  // ————— État : succès (QR d'entrée délivré) —————
  if (result && result.qr_token) {
    const already = result.code === "already_registered";
    return (
      <main className={shellClass}>
        <section className={cardClass}>
          {header}
          <div className="mt-6 rounded-3xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-center">
            <p className="text-lg font-black text-emerald-200">
              {already ? "Vous êtes déjà inscrit(e)" : "Inscription confirmée"}
            </p>
            <p className="mt-1 text-sm text-white/55">
              Voici votre QR d&apos;entrée personnel. Présentez-le à la porte.
            </p>
          </div>
          <div className="mx-auto mt-6 grid place-items-center rounded-3xl bg-white p-4">
            <QRCodeSVG value={result.qr_token} size={240} />
          </div>
          <p className="mt-4 break-all text-center text-[11px] text-white/30">{result.qr_token}</p>
          <p className="mt-4 rounded-2xl bg-white/[0.03] px-4 py-3 text-center text-xs text-white/45">
            Conservez cette page ou faites-en une capture d&apos;écran. Le contrôle légal 18+ est
            effectué : aucune entrée n&apos;est délivrée aux mineurs.
          </p>
          {spaceToken ? (
            <a
              href={`/espace/${encodeURIComponent(spaceToken)}`}
              className="mt-4 block rounded-2xl border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-center text-sm font-black text-orange-200"
            >
              Accéder à mon espace →
            </a>
          ) : null}
        </section>
      </main>
    );
  }

  // ————— État : lien fermé (inconnu / expiré / épuisé) —————
  if (!availability.open) {
    return (
      <main className={shellClass}>
        <section className={cardClass}>
          {header}
          <div className="mt-8 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
            <p className="font-black text-amber-200">Invitation indisponible</p>
            <p className="mt-2 text-sm text-white/55">{UNAVAILABLE_LABELS[availability.reason]}</p>
          </div>
        </section>
      </main>
    );
  }

  // ————— État : formulaire d'inscription —————
  const univers = link?.univers ? UNIVERS_LABELS[link.univers] : null;
  const kind = link?.kind ? KIND_LABELS[link.kind] : null;

  return (
    <main className={shellClass}>
      <section className={cardClass}>
        {header}

        <div className="mt-5 rounded-3xl border border-orange-500/25 bg-orange-500/[0.06] p-4 text-center">
          {kind && <p className="text-xs uppercase tracking-[0.2em] text-orange-300">{kind}</p>}
          <p className="mt-1 text-lg font-black">{link?.eventTitle || "Soirée Club One"}</p>
          <p className="mt-1 text-sm text-white/55">
            {univers ? `Salle ${univers}` : "Salle"}
            {link?.exploitationDate ? ` · ${link.exploitationDate}` : ""}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3" noValidate>
          <div>
            <label className="mb-1 block text-xs text-white/50">Prénom *</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-orange-500/50"
              autoComplete="given-name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Nom</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-orange-500/50"
              autoComplete="family-name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Téléphone *</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="06 12 34 56 78"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-orange-500/50"
              autoComplete="tel"
            />
            {phone.trim() && !phoneE164 && (
              <p className="mt-1 text-[11px] text-amber-300/80">Format non reconnu (ex. 06 12 34 56 78).</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">Date de naissance *</label>
            <input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-orange-500/50"
            />
            <p className="mt-1 text-[11px] text-white/35">
              Obligatoire pour le contrôle légal 18+ (entrée refusée aux mineurs).
            </p>
          </div>

          {/* Consentements DÉGROUPÉS, non pré-cochés. L'entrée gratuite ne dépend d'AUCUNE des deux cases. */}
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <label className="flex gap-3 text-xs leading-relaxed text-white/70">
              <input
                type="checkbox"
                checked={consentService}
                disabled={!serviceReady}
                onChange={(e) => setConsentService(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500 disabled:opacity-40"
              />
              <span className={serviceReady ? "" : "opacity-50"}>{serviceText}</span>
            </label>
            <label className="flex gap-3 text-xs leading-relaxed text-white/70">
              <input
                type="checkbox"
                checked={consentMarketing}
                disabled={!marketingReady}
                onChange={(e) => setConsentMarketing(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500 disabled:opacity-40"
              />
              <span className={marketingReady ? "" : "opacity-50"}>{marketingText}</span>
            </label>
            {(!serviceReady || !marketingReady) && (
              <p className="text-[11px] text-white/35">
                Les préférences de communication seront activées une fois les mentions légales de
                l&apos;établissement configurées. L&apos;inscription et le QR d&apos;entrée
                fonctionnent sans.
              </p>
            )}
          </div>

          {formErrors.length > 0 && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              {formErrors.map((code) => (
                <p key={code} className="text-sm text-red-300">
                  {VALIDATION_LABELS[code] || code}
                </p>
              ))}
            </div>
          )}
          {serverError && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-sm text-red-300">{serverError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-orange-500 px-4 py-3 font-black text-black transition hover:bg-orange-400 disabled:opacity-50"
          >
            {submitting ? "Inscription…" : "Je m'inscris et je reçois mon QR"}
          </button>
          <p className="text-center text-[11px] text-white/30">
            En vous inscrivant, vous obtenez votre QR d&apos;entrée personnel pour cette soirée.
          </p>
        </form>
      </section>
    </main>
  );
}
