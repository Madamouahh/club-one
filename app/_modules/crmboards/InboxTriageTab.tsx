"use client";

// app/_modules/crmboards/InboxTriageTab.tsx — CONTENEUR autonome (intégrateur) du module DEMANDES /
// INBOX TRIÉES (B13). Récupère les vraies demandes de contact (table contact_requests, migration 0063,
// cantonnée par la RLS : direction seule), les mappe vers le modèle PUR (lib/contactInbox → lib/inboxTriage)
// et les passe au composant PRÉSENTATIONNEL existant <InboxTriageBoard>. Ajoute le TRAITEMENT STAFF réel :
// saisie d'une demande reçue hors ligne, changement de statut, assignation d'un responsable.
//
// Même contrat d'appel que les autres conteneurs (StockView / ReservationBoardTab) : { supabase, role,
// username }. AUCUNE règle métier dupliquée : l'autorité reste la RLS 0063 (admin/manager, fail-closed).
// La garde d'affichage (canViewContactInbox) reflète cette RLS côté UI — ce n'est PAS la sécurité.
//
// HONNÊTETÉ : loading / error / empty explicites ; aucune donnée fabriquée. « Répondre » n'est pas monté
// ici car la table 0063 ne stocke ni brouillon ni coordonnées normalisées E.164 : le board prépare déjà
// le lien wa.me / mailto à partir du contact réel — aucun envoi n'est jamais fait par l'app.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import InboxTriageBoard from "@/components/InboxTriageBoard";
import type { StaffRole } from "@/lib/permissions";
import { REQUESTER_TYPES, buildInboxTriage, requesterTypeLabel } from "@/lib/inboxTriage";
import {
  CONTACT_REQUEST_SELECT,
  CONTACT_STATUSES,
  canViewContactInbox,
  contactDisplayName,
  contactStatusLabel,
  mapContactRequestRows,
  validateContactRequestDraft,
  type ContactRequestRow,
  type ContactStatus,
} from "@/lib/contactInbox";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export default function InboxTriageTab({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const [rows, setRows] = useState<ContactRequestRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Instant de référence figé au chargement — le retard SLA se calcule contre CET instant réel (jamais
  // recalculé à chaque rendu, jamais un faux « à l'heure » : lib/inboxTriage exige un nowIso explicite).
  const [nowIso, setNowIso] = useState<string | null>(null);

  // Formulaire de saisie staff.
  const [fType, setFType] = useState<string>("client");
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fSubject, setFSubject] = useState("");
  const [fMessage, setFMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("contact_requests")
      .select(CONTACT_REQUEST_SELECT)
      .order("created_at", { ascending: false });
    if (e) {
      setError(e.message);
      return;
    }
    setError("");
    setRows((data ?? []) as ContactRequestRow[]);
    setNowIso(new Date().toISOString());
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("contact_requests")
        .select(CONTACT_REQUEST_SELECT)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (e) setError(e.message);
      else {
        setRows((data ?? []) as ContactRequestRow[]);
        setNowIso(new Date().toISOString());
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const view = useMemo(
    () => buildInboxTriage({ requests: mapContactRequestRows(rows), nowIso }),
    [rows, nowIso],
  );

  async function createRequest() {
    setError("");
    const draft = {
      requester_type: fType,
      subject: fSubject,
      full_name: fName,
      phone: fPhone,
      email: fEmail,
      message: fMessage,
    };
    const check = validateContactRequestDraft(draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("contact_requests").insert({
      requester_type: fType,
      subject: fSubject.trim(),
      full_name: fName.trim() || null,
      phone: fPhone.trim() || null,
      email: fEmail.trim() || null,
      message: fMessage.trim() || null,
      assigned_to: username,
    });
    if (e) {
      setError(`Saisie refusée : ${e.message}`);
      return;
    }
    setFName("");
    setFPhone("");
    setFEmail("");
    setFSubject("");
    setFMessage("");
    await load();
  }

  async function updateStatus(id: string, status: ContactStatus) {
    setError("");
    const { error: e } = await supabase
      .from("contact_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (e) {
      setError(`Changement de statut refusé : ${e.message}`);
      return;
    }
    await load();
  }

  async function assignTo(id: string, assigned: string) {
    setError("");
    const { error: e } = await supabase
      .from("contact_requests")
      .update({ assigned_to: assigned.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (e) {
      setError(`Assignation refusée : ${e.message}`);
      return;
    }
    await load();
  }

  // Garde d'affichage (confort UI, miroir de la RLS 0063). Les autres rôles n'ont de toute façon aucune
  // ligne (la RLS ne leur en renvoie aucune) — on l'affiche explicitement plutôt qu'une file vide trompeuse.
  if (!canViewContactInbox(role)) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Les demandes / l’inbox triée sont réservées à la direction / com (admin / manager). Ce rôle n’y a
        aucun accès (les demandes contiennent des coordonnées personnelles).
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-white/40">Chargement des demandes de contact…</div>
    );
  }

  return (
    <div className="space-y-4 pb-4 text-white">
      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      {/* Saisie staff : la direction enregistre une demande reçue hors ligne (appel, e-mail transféré…). */}
      <div className={CARD}>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">Saisir une demande</div>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              className={INPUT}
              value={fType}
              onChange={(e) => setFType(e.target.value)}
              aria-label="Profil « vous êtes »"
            >
              {REQUESTER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {requesterTypeLabel(t)}
                </option>
              ))}
            </select>
            <input
              className={INPUT}
              placeholder="Nom (optionnel)"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className={INPUT}
              inputMode="tel"
              placeholder="Téléphone"
              value={fPhone}
              onChange={(e) => setFPhone(e.target.value)}
            />
            <input
              className={INPUT}
              inputMode="email"
              placeholder="E-mail"
              value={fEmail}
              onChange={(e) => setFEmail(e.target.value)}
            />
          </div>
          <input
            className={INPUT}
            placeholder="Sujet"
            value={fSubject}
            onChange={(e) => setFSubject(e.target.value)}
          />
          <textarea
            className={INPUT}
            rows={2}
            placeholder="Message (optionnel)"
            value={fMessage}
            onChange={(e) => setFMessage(e.target.value)}
          />
          <button className={BTN} onClick={createRequest} disabled={!fSubject.trim()}>
            Enregistrer la demande
          </button>
          <p className="text-[10px] text-white/35">
            Au moins un contact (téléphone ou e-mail) est requis pour pouvoir répondre. Aucun envoi n’est
            fait par l’app : la réponse reste un geste humain.
          </p>
        </div>
      </div>

      {/* Vue triée honnête (files par profil, SLA, retard) — composant présentationnel B13. */}
      <InboxTriageBoard view={view} role={role} />

      {/* Gestion staff : statut + assignation par demande (autorité réelle = RLS 0063). */}
      <div className={CARD}>
        <div className="mb-2 text-xs font-bold uppercase text-white/50">
          Traitement des demandes ({rows.length})
        </div>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-white/30">
            Aucune demande enregistrée. La direction saisit les demandes reçues.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{r.subject}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">
                    {contactDisplayName(r.full_name)} · {requesterTypeLabelSafe(r.requester_type)}
                    {r.phone ? ` · ${r.phone}` : ""}
                    {r.email ? ` · ${r.email}` : ""}
                  </p>
                  {r.message && <p className="mt-1 text-[11px] text-white/55">{r.message}</p>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    className={INPUT}
                    value={isKnownStatus(r.status) ? r.status : "nouveau"}
                    onChange={(e) => updateStatus(r.id, e.target.value as ContactStatus)}
                    aria-label="Statut de la demande"
                  >
                    {CONTACT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {contactStatusLabel(s)}
                      </option>
                    ))}
                  </select>
                  <input
                    className={INPUT}
                    placeholder="Assigné à (username)"
                    defaultValue={r.assigned_to ?? ""}
                    onBlur={(e) => {
                      if ((e.target.value.trim() || null) !== (r.assigned_to ?? null)) {
                        assignTo(r.id, e.target.value);
                      }
                    }}
                    aria-label="Responsable assigné"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Libellé de profil tolérant : un type inconnu (ne devrait pas arriver, CHECK SQL) s'affiche brut plutôt
// que de planter — on ne fabrique aucun profil.
function requesterTypeLabelSafe(type: string): string {
  return (REQUESTER_TYPES as readonly string[]).includes(type)
    ? requesterTypeLabel(type as (typeof REQUESTER_TYPES)[number])
    : "profil inconnu";
}

function isKnownStatus(status: string): status is ContactStatus {
  return (CONTACT_STATUSES as readonly string[]).includes(status);
}
