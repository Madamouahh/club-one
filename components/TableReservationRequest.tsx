"use client";

// components/TableReservationRequest.tsx — FLUX CLIENT « demande de résa » (chunk 4 de PLAN_SALLE_EDEN).
//
// Composant PRÉSENTATIONNEL : il ne fait AUCUN réseau. On lui passe la table sélectionnée sur le plan
// (venue_tables, migration 0024), le contexte de la soirée, et un callback `onSubmit`. L'appel réel
// (RPC request_table_reservation_v1, SECURITY DEFINER, anon) est fait par le PARENT — ce composant
// n'accorde AUCUN droit : il présente le funnel et prépare le brouillon.
//
// Règles dures (spec §3 + funnel §V0), miroir de app/i/[token]/page.tsx :
//   · le client s'inscrit LUI-MÊME (mêmes 4 champs + party_size/créneau) ;
//   · blocage < 18 ans à la DATE DE LA SOIRÉE (L.3342-1) avant tout appel serveur ;
//   · consentement DÉGROUPÉ (service ≠ marketing), non pré-coché, journalisé avec le TEXTE EXACT ;
//   · AUCUN nom d'établissement inventé : si la raison sociale n'est pas configurée, la case reste
//     désactivée (jamais de consentement journalisé contre un texte à placeholder) ;
//   · la DEMANDE naît `pending` — jamais une confirmation automatique (un manager valide ensuite).

import React, { useMemo, useState } from "react";
import {
  CONSENT_MARKETING_TEMPLATE,
  CONSENT_SERVICE_TEMPLATE,
  consentTextsReady,
  fillConsentText,
  normalizeE164,
  type ConsentValues,
} from "@/lib/crmClients";
import { registrationRefDate } from "@/lib/crmFunnel";
import { capacityKnown, capacityLabel, tableKindLabel, type VenueTable } from "@/lib/venueTables";
import type { TableAvailability } from "@/lib/floorPlanView";
import {
  isTableRequestable,
  seatingNotice,
  validateReservationDraft,
  type ReservationDraftError,
} from "@/lib/resaRequest";

// La charge utile envoyée au parent = les paramètres de la RPC request_table_reservation_v1.
export type ReservationSubmitPayload = {
  venueTableId: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string;
  birthday: string;
  partySize: number;
  slot: string | null;
  guestNote: string | null;
  consentService: boolean;
  consentServiceText: string | null;
  consentMarketing: boolean;
  consentMarketingText: string | null;
};

export type ReservationSubmitResult = { ok: boolean; code: string; message: string };

// Erreurs de validation TS (miroir) → message utilisateur.
const VALIDATION_LABELS: Record<ReservationDraftError, string> = {
  first_name_required: "Renseignez votre prénom.",
  phone_invalid: "Numéro de téléphone invalide (ex. 06 12 34 56 78).",
  birthday_required: "Renseignez votre date de naissance.",
  birthday_invalid: "Date de naissance invalide.",
  underage: "Réservation réservée aux personnes majeures (18 ans et plus).",
  consent_service_text_missing: "Consentement invalide.",
  consent_marketing_text_missing: "Consentement invalide.",
  party_size_invalid: "Indiquez un nombre de personnes valide.",
  party_over_capacity: "Le nombre de personnes dépasse la capacité de cette table.",
  table_unavailable: "Cette table n'est plus disponible.",
};

export function TableReservationRequest({
  table,
  availability,
  eventTitle,
  eventDate,
  consentValues,
  onSubmit,
}: {
  table: VenueTable;
  availability: TableAvailability | undefined;
  eventTitle: string | null;
  eventDate: string | null; // ISO YYYY-MM-DD
  consentValues: ConsentValues;
  onSubmit: (payload: ReservationSubmitPayload) => Promise<ReservationSubmitResult>;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [partySizeText, setPartySizeText] = useState("");
  const [slot, setSlot] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [consentService, setConsentService] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<ReservationDraftError[]>([]);
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState<ReservationSubmitResult | null>(null);

  // Textes de consentement EXACTS (constantes lib) remplis avec les données fondateur si présentes.
  const serviceText = useMemo(() => fillConsentText(CONSENT_SERVICE_TEMPLATE, consentValues), [consentValues]);
  const marketingText = useMemo(() => fillConsentText(CONSENT_MARKETING_TEMPLATE, consentValues), [consentValues]);
  const serviceReady = !!(consentValues.raisonSociale && consentValues.raisonSociale.trim());
  const marketingReady = consentTextsReady(consentValues).ready;

  const phoneE164 = useMemo(() => normalizeE164(phone), [phone]);
  const partySize = Number.parseInt(partySizeText, 10);

  // La table doit rester demandable (active + libre couche-demandes) : sinon on n'ouvre pas le formulaire.
  const requestable = isTableRequestable(table, availability);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");

    const refDate = registrationRefDate(eventDate, new Date());
    const check = validateReservationDraft(
      {
        firstName,
        lastName: lastName || null,
        phoneE164,
        birthday,
        partySize,
        slot: slot || null,
        guestNote: guestNote || null,
        consentService,
        consentServiceText: consentService ? serviceText : null,
        consentMarketing,
        consentMarketingText: consentMarketing ? marketingText : null,
      },
      table,
      availability,
      refDate,
    );
    if (!check.ok) {
      setFormErrors(check.errors);
      return;
    }
    setFormErrors([]);
    setSubmitting(true);
    try {
      const res = await onSubmit({
        venueTableId: table.id,
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        phoneE164: phoneE164 as string, // validé non-null ci-dessus
        birthday,
        partySize,
        slot: slot.trim() || null,
        guestNote: guestNote.trim() || null,
        consentService,
        consentServiceText: consentService ? serviceText : null,
        consentMarketing,
        consentMarketingText: consentMarketing ? marketingText : null,
      });
      if (res.ok) setDone(res);
      else setServerError(res.message || "Demande refusée.");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Une erreur est survenue. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  const cardClass = "rounded-2xl border border-white/10 bg-white/[0.03] p-4";

  // ————— État : demande envoyée (pending) —————
  if (done) {
    return (
      <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-5 text-center">
        <p className="text-lg font-black text-amber-200">Demande envoyée</p>
        <p className="mt-1 text-sm text-white/55">
          {done.message || "Un responsable validera votre demande."} Vous n&apos;êtes pas encore
          confirmé(e) : la table reste à valider par l&apos;établissement.
        </p>
      </div>
    );
  }

  // ————— État : table non demandable (déjà prise / inactive) — honnête, pas de faux formulaire —————
  if (!requestable) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center text-sm text-white/50">
        La table {table.label} n&apos;est pas disponible à la demande pour cette soirée.
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-black text-white">Demander la table {table.label}</p>
          <p className="text-[11px] text-white/45">
            {tableKindLabel(table)}
            {capacityKnown(table) ? ` · ${capacityLabel(table.capacity)} places` : " · capacité à confirmer"}
          </p>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-white/40">{seatingNotice(table)}</p>
      <div className="mt-2 rounded-xl border border-orange-500/20 bg-orange-500/[0.06] px-3 py-2 text-center">
        <p className="text-sm font-black">{eventTitle || "Soirée Club One"}</p>
        <p className="text-[11px] text-white/50">{eventDate || "Date à préciser"}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-white/50">Prénom *</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-white/50">Nom</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-white/50">Téléphone *</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="06 12 34 56 78"
            autoComplete="tel"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
          />
          {phone.trim() && !phoneE164 && (
            <span className="text-[11px] text-amber-300/80">Format non reconnu (ex. 06 12 34 56 78).</span>
          )}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-white/50">Date de naissance *</span>
            <input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-white/50">Nombre de personnes *</span>
            <input
              inputMode="numeric"
              value={partySizeText}
              onChange={(e) => setPartySizeText(e.target.value)}
              placeholder="ex. 4"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-white/50">Créneau souhaité (facultatif)</span>
            <input
              type="text"
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              placeholder="ex. 23h30"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-white/50">Note (facultatif)</span>
            <input
              type="text"
              value={guestNote}
              onChange={(e) => setGuestNote(e.target.value)}
              placeholder="ex. anniversaire"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
            />
          </label>
        </div>
        <p className="text-[11px] text-white/35">
          Date de naissance obligatoire pour le contrôle légal 18+ (demande refusée aux mineurs).
        </p>

        {/* Consentements DÉGROUPÉS, non pré-cochés. La demande ne dépend d'AUCUNE des deux cases. */}
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <label className="flex gap-3 text-[11px] leading-relaxed text-white/70">
            <input
              type="checkbox"
              checked={consentService}
              disabled={!serviceReady}
              onChange={(e) => setConsentService(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500 disabled:opacity-40"
            />
            <span className={serviceReady ? "" : "opacity-50"}>{serviceText}</span>
          </label>
          <label className="flex gap-3 text-[11px] leading-relaxed text-white/70">
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
              l&apos;établissement configurées. La demande de réservation fonctionne sans.
            </p>
          )}
        </div>

        {formErrors.length > 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
            {formErrors.map((code) => (
              <p key={code} className="text-sm text-red-300">
                {VALIDATION_LABELS[code] || code}
              </p>
            ))}
          </div>
        )}
        {serverError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
            <p className="text-sm text-red-300">{serverError}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-black text-black transition hover:bg-orange-400 disabled:opacity-50"
        >
          {submitting ? "Envoi…" : "Envoyer ma demande"}
        </button>
        <p className="text-center text-[11px] text-white/30">
          Votre demande sera validée par un responsable. Ce n&apos;est pas une confirmation automatique.
        </p>
      </form>
    </div>
  );
}
