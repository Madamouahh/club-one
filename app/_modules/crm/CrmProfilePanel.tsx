"use client";

// app/_modules/crm/CrmProfilePanel.tsx — FICHE CLIENT CRM (V1), staff direction (admin/manager).
// Autonome : reçoit { supabase, role } et fait tout son fetch (comme StockView). S'appuie sur le backend
// 0059 (guests + email, guest_tags, guest_notes, RPC guest_360_v1) et sur la logique PURE de lib/crmProfile
// + app/_modules/crm/crmPanelHelpers. Ne fabrique RIEN : base vide → écran vide honnête ; dépense NULL →
// « dépense non identifiée » (jamais un 0 € inventé) ; opt-out toujours visible ; aucune fusion automatique.
//
// La sécurité RÉELLE est la RLS 0013/0059 (direction = tout ; promoteur = SES clients ; anon = rien). Ce
// gating UI (admin/manager) est un confort, pas une frontière : la base refuse déjà tout accès hors périmètre.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import {
  detectDuplicates,
  normalizeEmail,
  spendSummary,
  validateNote,
  validateTag,
  guestToCsvCells,
  type CsvImportError,
  type DedupCandidate,
  type Guest360,
  type GuestImportFields,
} from "@/lib/crmProfile";
import { normalizeE164 } from "@/lib/crmClients";
import {
  buildCsvImportReport,
  buildGuestCsv,
  buildMergePreview,
  filterGuests,
  isIsoDateString,
  parseCsv,
  phoneWouldChange,
  type CsvImportReport,
  type MergePreviewGuest,
} from "./crmPanelHelpers";

// ————————————————————————————————————————————————————————————————
// Styles (miroir de StockView pour rester cohérent visuellement).
// ————————————————————————————————————————————————————————————————
const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const BTN_GHOST =
  "rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const LABEL = "text-[10px] font-bold uppercase tracking-wide text-white/50";

const GUESTS_LOAD_CAP = 1000; // on charge une page ; la dédup/recherche opèrent sur ces fiches chargées.

// ————————————————————————————————————————————————————————————————
// Types de lignes DB (colonnes réellement sélectionnées).
// ————————————————————————————————————————————————————————————————
type GuestRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string;
  birthday: string | null;
  owner_promoter: string | null;
  consent_service: boolean;
  consent_marketing: boolean;
  image_consent: boolean | null;
  opt_out_at: string | null;
  created_at: string | null;
};

type TagRow = { id: string; guest_id: string; tag: string; created_at: string };
type NoteRow = { id: string; guest_id: string; body: string; author: string | null; created_at: string };

const GUEST_COLS =
  "id, first_name, last_name, email, phone, birthday, owner_promoter, consent_service, consent_marketing, image_consent, opt_out_at, created_at";

const CSV_ERROR_LABELS: Record<CsvImportError, string> = {
  wrong_column_count: "Nombre de colonnes incorrect (attendu : phone, first_name, last_name, email, birthday)",
  phone_required: "Téléphone manquant",
  phone_invalid: "Téléphone non normalisable",
  first_name_required: "Prénom manquant",
  email_invalid: "Email invalide",
  birthday_invalid: "Date de naissance invalide (AAAA-MM-JJ)",
};

function fmtEuro(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR");
}

// ════════════════════════════════════════════════════════════════
export default function CrmProfilePanel({
  supabase,
  role,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
}) {
  const isDirection = role === "admin" || role === "manager";

  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [capped, setCapped] = useState(false);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Chargement de la liste des fiches (page) — RLS = frontière réelle.
  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("guests")
      .select(GUEST_COLS)
      .order("created_at", { ascending: false })
      .limit(GUESTS_LOAD_CAP);
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    const rows = (data || []) as GuestRow[];
    setGuests(rows);
    setCapped(rows.length >= GUESTS_LOAD_CAP);
    setError("");
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!isDirection) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("guests")
        .select(GUEST_COLS)
        .order("created_at", { ascending: false })
        .limit(GUESTS_LOAD_CAP);
      if (!active) return;
      if (e) {
        setError(e.message);
      } else {
        const rows = (data || []) as GuestRow[];
        setGuests(rows);
        setCapped(rows.length >= GUESTS_LOAD_CAP);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, isDirection]);

  const filtered = useMemo(() => filterGuests(guests, query), [guests, query]);
  const selected = useMemo(
    () => guests.find((g) => g.id === selectedId) ?? null,
    [guests, selectedId],
  );

  // ————— Gating UI (rappel : la vraie garde est la RLS) —————
  if (!isDirection) {
    return (
      <div className="rounded-3xl border border-white/10 bg-[#070707] p-4 text-white">
        <div className="text-sm font-black">Fiche client CRM</div>
        <p className="mt-2 text-xs text-white/50">
          Accès réservé à la direction (admin / manager). Les promoteurs disposent de leur call-list dans
          l&apos;onglet CRM. La base applique la même règle (RLS 0013/0059).
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3 text-white">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-lg font-black">CRM · Fiches clients</h2>
        <button className={BTN_GHOST} onClick={() => void load()} disabled={loading}>
          Rafraîchir
        </button>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Répertoire clients enrichi : identité, consentements, tags, notes internes, historique 360 et
        dédup. Rien n&apos;est fabriqué — une dépense non attribuée reste « non identifiée » (jamais 0 €).
      </p>

      {error && (
        <div className="mt-2 rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      {/* Recherche */}
      <div className="mt-3">
        <input
          className={INPUT}
          placeholder="Rechercher : téléphone, email, prénom, nom…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="mt-6 text-center text-sm text-white/40">Chargement…</div>
      ) : guests.length === 0 ? (
        <div className="mt-6 text-center text-sm text-white/40">
          Aucune fiche client. La base se remplit via le funnel de réservation, l&apos;import CSV ou la
          saisie directe.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,340px)_1fr]">
          {/* Colonne liste */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className={LABEL}>
                {filtered.length} / {guests.length} fiche{guests.length > 1 ? "s" : ""}
              </span>
              <button className={BTN_GHOST} onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
                Export CSV
              </button>
            </div>
            {capped && (
              <div className="mb-1 text-[10px] text-amber-300/80">
                Page limitée à {GUESTS_LOAD_CAP} fiches (les plus récentes). Affinez la recherche.
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-white/40">Aucun résultat pour cette recherche.</div>
            ) : (
              <ul className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
                {filtered.map((g) => (
                  <li key={g.id}>
                    <button
                      className={`w-full rounded-xl border px-3 py-2 text-left ${
                        g.id === selectedId
                          ? "border-orange-500/60 bg-orange-500/10"
                          : "border-white/10 bg-white/[0.03]"
                      }`}
                      onClick={() => setSelectedId(g.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold">
                          {g.first_name} {g.last_name ?? ""}
                        </span>
                        {g.opt_out_at && (
                          <span className="shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-200">
                            STOP
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-white/45">
                        {g.phone}
                        {g.email ? ` · ${g.email}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <DedupSection guests={guests} onSelect={setSelectedId} supabase={supabase} role={role} onMerged={load} />
            <CsvImportSection supabase={supabase} onImported={load} />
          </div>

          {/* Colonne détail */}
          <div>
            {!selected ? (
              <div className={`${CARD} text-center text-sm text-white/40`}>
                Sélectionnez une fiche pour l&apos;éditer et voir son historique 360.
              </div>
            ) : (
              <GuestDetail
                key={selected.id}
                supabase={supabase}
                guest={selected}
                onSaved={load}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ————————————————————————————————————————————————————————————————
// Export CSV — de la liste courante (filtrée), téléchargement côté client.
// ————————————————————————————————————————————————————————————————
function exportCsv(rows: readonly GuestRow[]) {
  const fields: GuestImportFields[] = rows.map((g) => ({
    phone: g.phone,
    first_name: g.first_name,
    last_name: g.last_name,
    email: g.email,
    birthday: g.birthday,
  }));
  const csv = buildGuestCsv(fields);
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `guests_export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ════════════════════════════════════════════════════════════════
// Détail d'une fiche : édition identité + consentements + tags + notes + historique 360.
// ════════════════════════════════════════════════════════════════
function GuestDetail({
  supabase,
  guest,
  onSaved,
}: {
  supabase: SupabaseClient;
  guest: GuestRow;
  onSaved: () => Promise<void>;
}) {
  // Formulaire identité
  const [firstName, setFirstName] = useState(guest.first_name);
  const [lastName, setLastName] = useState(guest.last_name ?? "");
  const [phone, setPhone] = useState(guest.phone);
  const [email, setEmail] = useState(guest.email ?? "");
  const [birthday, setBirthday] = useState(guest.birthday ?? "");
  const [ficheError, setFicheError] = useState("");
  const [ficheMsg, setFicheMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // 360 + tags + notes
  const [three60, setThree60] = useState<Guest360 | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");

  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [noteError, setNoteError] = useState("");

  const loadDetail = useCallback(async () => {
    setDetailLoading(true);
    const [rpc, tg, nt] = await Promise.all([
      supabase.rpc("guest_360_v1", { p_guest_id: guest.id }),
      supabase
        .from("guest_tags")
        .select("id, guest_id, tag, created_at")
        .eq("guest_id", guest.id)
        .order("tag", { ascending: true }),
      supabase
        .from("guest_notes")
        .select("id, guest_id, body, author, created_at")
        .eq("guest_id", guest.id)
        .order("created_at", { ascending: false }),
    ]);
    if (rpc.error) setDetailError(rpc.error.message);
    else setThree60(((rpc.data as Guest360[] | null) || [])[0] ?? null);
    if (!tg.error) setTags((tg.data || []) as TagRow[]);
    if (!nt.error) setNotes((nt.data || []) as NoteRow[]);
    setDetailLoading(false);
  }, [supabase, guest.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const phoneChanged = phoneWouldChange(guest.phone, phone);

  async function saveFiche() {
    setFicheError("");
    setFicheMsg("");
    const fn = firstName.trim();
    if (!fn) {
      setFicheError("Prénom requis.");
      return;
    }
    const phoneNorm = normalizeE164(phone);
    if (!phoneNorm) {
      setFicheError("Téléphone invalide (format FR ou E.164).");
      return;
    }
    let emailNorm: string | null = null;
    if (email.trim()) {
      emailNorm = normalizeEmail(email);
      if (!emailNorm) {
        setFicheError("Email invalide.");
        return;
      }
    }
    let bday: string | null = null;
    if (birthday.trim()) {
      if (!isIsoDateString(birthday.trim())) {
        setFicheError("Date de naissance invalide (AAAA-MM-JJ).");
        return;
      }
      bday = birthday.trim();
    }
    setSaving(true);
    const { error: e } = await supabase
      .from("guests")
      .update({
        first_name: fn,
        last_name: lastName.trim() || null,
        phone: phoneNorm,
        email: emailNorm,
        birthday: bday,
      })
      .eq("id", guest.id);
    setSaving(false);
    if (e) {
      // Le conflit d'unicité téléphone est l'erreur métier la plus probable (clé de dédup).
      setFicheError(
        /duplicate|unique/i.test(e.message)
          ? "Ce téléphone appartient déjà à une autre fiche (clé de dédup). Vérifiez les doublons."
          : `Enregistrement refusé : ${e.message}`,
      );
      return;
    }
    setFicheMsg("Fiche enregistrée.");
    await onSaved();
    await loadDetail();
  }

  // ————— Consentements (écriture honnête sur les colonnes guests) —————
  async function patchGuest(patch: Record<string, unknown>) {
    setFicheError("");
    const { error: e } = await supabase.from("guests").update(patch).eq("id", guest.id);
    if (e) {
      setFicheError(`Mise à jour refusée : ${e.message}`);
      return;
    }
    await onSaved();
    await loadDetail();
  }

  async function toggleConsentService(next: boolean) {
    const patch: Record<string, unknown> = { consent_service: next };
    if (next && !guest.consent_service) patch.consent_service_at = new Date().toISOString();
    await patchGuest(patch);
  }

  async function toggleConsentMarketing(next: boolean) {
    if (next && guest.opt_out_at) {
      setFicheError("Marketing impossible : ce client est en opt-out (STOP définitif).");
      return;
    }
    const patch: Record<string, unknown> = { consent_marketing: next };
    if (next && !guest.consent_marketing) patch.consent_marketing_at = new Date().toISOString();
    await patchGuest(patch);
  }

  async function setImageConsent(next: boolean | null) {
    await patchGuest({ image_consent: next });
  }

  // ————— Tags —————
  async function addGuestTag() {
    setTagError("");
    const v = validateTag(tagInput);
    if (!v.ok) {
      setTagError(v.error === "too_long" ? "Étiquette trop longue (max 64)." : "Étiquette vide.");
      return;
    }
    const { error: e } = await supabase.from("guest_tags").insert({ guest_id: guest.id, tag: v.value });
    if (e) {
      setTagError(/duplicate|unique/i.test(e.message) ? "Étiquette déjà présente." : e.message);
      return;
    }
    setTagInput("");
    await loadDetail();
  }

  async function removeGuestTag(id: string) {
    const { error: e } = await supabase.from("guest_tags").delete().eq("id", id);
    if (e) setTagError(e.message);
    else await loadDetail();
  }

  // ————— Notes —————
  async function addNote() {
    setNoteError("");
    const v = validateNote(noteInput);
    if (!v.ok) {
      setNoteError(v.error === "too_long" ? "Note trop longue (max 4000)." : "Note vide.");
      return;
    }
    const { error: e } = await supabase
      .from("guest_notes")
      .insert({ guest_id: guest.id, body: noteInput.trim() });
    if (e) {
      setNoteError(e.message);
      return;
    }
    setNoteInput("");
    await loadDetail();
  }

  const spend = three60 ? spendSummary(three60) : null;

  return (
    <div className="space-y-3">
      {/* Identité */}
      <div className={CARD}>
        <div className="mb-2 flex items-center justify-between">
          <span className={LABEL}>Fiche</span>
          {guest.owner_promoter && (
            <span className="text-[10px] text-white/40">promoteur : {guest.owner_promoter}</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className={LABEL}>Prénom *</div>
            <input className={INPUT} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <div className={LABEL}>Nom</div>
            <input data-testid="crm-lastname" className={INPUT} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <div className={LABEL}>Téléphone * (clé de dédup)</div>
            <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <div className={LABEL}>Email</div>
            <input className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <div className={LABEL}>Naissance (AAAA-MM-JJ)</div>
            <input
              className={INPUT}
              placeholder="1998-05-04"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
            />
          </div>
        </div>
        {phoneChanged && (
          <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
            Le téléphone est la clé de déduplication : le modifier peut créer ou masquer un doublon.
            Vérifiez avant d&apos;enregistrer.
          </div>
        )}
        {ficheError && (
          <div className="mt-2 rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-[11px] font-bold text-red-200">
            {ficheError}
          </div>
        )}
        {ficheMsg && <div className="mt-2 text-[11px] font-bold text-emerald-300">{ficheMsg}</div>}
        <button data-testid="crm-save" className={`${BTN} mt-2`} onClick={saveFiche} disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer la fiche"}
        </button>
      </div>

      {/* Consentements */}
      <div className={CARD}>
        <div className={`${LABEL} mb-2`}>Consentements (RGPD / Évin)</div>
        <div className="space-y-2">
          <ConsentToggle
            label="Service (confirmations de réservation)"
            value={guest.consent_service}
            onChange={toggleConsentService}
          />
          <ConsentToggle
            label="Marketing (invitations, agenda)"
            value={guest.consent_marketing}
            disabled={!!guest.opt_out_at}
            onChange={toggleConsentMarketing}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-white/70">Droit à l&apos;image</span>
            <div className="flex gap-1">
              <button
                className={guest.image_consent === true ? BTN : BTN_GHOST}
                onClick={() => setImageConsent(true)}
              >
                Oui
              </button>
              <button
                className={guest.image_consent === false ? BTN : BTN_GHOST}
                onClick={() => setImageConsent(false)}
              >
                Non
              </button>
              <button
                className={guest.image_consent == null ? BTN : BTN_GHOST}
                onClick={() => setImageConsent(null)}
              >
                Non recueilli
              </button>
            </div>
          </div>
          <div
            className={`rounded-xl border px-3 py-1.5 text-[11px] ${
              guest.opt_out_at
                ? "border-red-500/40 bg-red-500/10 text-red-200"
                : "border-white/10 bg-white/[0.03] text-white/50"
            }`}
          >
            {guest.opt_out_at
              ? `Opt-out (STOP) reçu le ${fmtDateTime(guest.opt_out_at)} — définitif : aucun envoi. La levée est un acte admin en base.`
              : "Aucun opt-out. Le client peut être contacté selon ses consentements ci-dessus."}
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className={CARD}>
        <div className={`${LABEL} mb-2`}>Tags</div>
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 ? (
            <span className="text-[11px] text-white/40">Aucun tag.</span>
          ) : (
            tags.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px]"
              >
                {t.tag}
                <button
                  className="text-white/40 hover:text-red-300"
                  onClick={() => removeGuestTag(t.id)}
                  aria-label={`Retirer ${t.tag}`}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className={INPUT}
            placeholder="Ajouter un tag (ex. VIP maison)"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addGuestTag();
            }}
          />
          <button data-testid="crm-tag-add" className={BTN} onClick={addGuestTag} disabled={!tagInput.trim()}>
            Ajouter
          </button>
        </div>
        {tagError && <div className="mt-1 text-[11px] font-bold text-red-300">{tagError}</div>}
      </div>

      {/* Historique 360 */}
      <div className={CARD}>
        <div className={`${LABEL} mb-2`}>Historique 360</div>
        {detailLoading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : detailError ? (
          <div className="text-[11px] font-bold text-red-300">{detailError}</div>
        ) : !three60 ? (
          <div className="text-[11px] text-white/40">Aucune donnée 360 (fiche hors périmètre ou vide).</div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Venues (seated)" value={three60.visits_seated_total} />
              <Stat label="Résa actives" value={three60.visits_booked_active} />
              <Stat label="No-shows" value={three60.no_shows_total} tone="amber" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <Stat label="Demandes résa" value={three60.reservation_requests_total} />
              <Stat label="Tables distinctes" value={three60.distinct_tables_requested} />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-xs">
              <div className={LABEL}>Dépense attribuée</div>
              {spend && spend.known ? (
                <div className="text-sm font-black text-emerald-300">
                  {fmtEuro(spend.total ?? 0)}
                  <span className="ml-1 text-[11px] font-normal text-white/50">
                    (12 m : {spend.last12m != null ? fmtEuro(spend.last12m) : "—"} · {spend.visitsWithSpend}{" "}
                    visite{spend.visitsWithSpend > 1 ? "s" : ""} chiffrée{spend.visitsWithSpend > 1 ? "s" : ""})
                  </span>
                </div>
              ) : (
                <div className="text-sm font-bold text-white/50">Dépense non identifiée</div>
              )}
            </div>
            <div className="text-[10px] text-white/35">
              Première venue : {three60.first_seen_date ?? "—"} · Dernière venue :{" "}
              {three60.last_seated_date ?? "—"}
            </div>
          </div>
        )}
      </div>

      {/* Notes timeline */}
      <div className={CARD}>
        <div className={`${LABEL} mb-2`}>Notes internes (timeline)</div>
        <div className="flex gap-2">
          <input
            className={INPUT}
            placeholder="Ajouter une note (usage commercial neutre)"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addNote();
            }}
          />
          <button data-testid="crm-note-add" className={BTN} onClick={addNote} disabled={!noteInput.trim()}>
            Ajouter
          </button>
        </div>
        {noteError && <div className="mt-1 text-[11px] font-bold text-red-300">{noteError}</div>}
        <ul className="mt-2 space-y-1.5">
          {notes.length === 0 ? (
            <li className="text-[11px] text-white/40">Aucune note.</li>
          ) : (
            notes.map((n) => (
              <li key={n.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="text-xs text-white/85">{n.body}</div>
                <div className="mt-0.5 text-[10px] text-white/35">
                  {fmtDateTime(n.created_at)}
                  {n.author ? ` · ${n.author}` : ""}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <div className={`text-lg font-black ${tone === "amber" ? "text-amber-400" : "text-white"}`}>
        {value}
      </div>
      <div className="text-[9px] uppercase text-white/40">{label}</div>
    </div>
  );
}

function ConsentToggle({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-white/70">{label}</span>
      <button
        className={`rounded-xl px-3 py-1 text-xs font-bold ${
          value ? "bg-emerald-600 text-white" : "border border-white/15 bg-white/5 text-white/70"
        } disabled:opacity-40`}
        disabled={disabled}
        onClick={() => onChange(!value)}
      >
        {value ? "Accordé" : "Refusé"}
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Déduplication — groupes candidats + APERÇU non destructif. Aucune fusion exécutée.
// ════════════════════════════════════════════════════════════════
function DedupSection({
  guests,
  onSelect,
  supabase,
  role,
  onMerged,
}: {
  guests: readonly GuestRow[];
  onSelect: (id: string) => void;
  supabase: SupabaseClient;
  role: StaffRole;
  onMerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [merging, setMerging] = useState("");
  const [mergeMsg, setMergeMsg] = useState("");
  const canMerge = role === "admin" || role === "manager";

  async function confirmMerge(keepId: string, dropIds: string[]) {
    setMerging(keepId);
    setMergeMsg("");
    try {
      for (const drop of dropIds) {
        const { data, error } = await supabase.rpc("merge_guests_v1", { p_keep: keepId, p_drop: drop });
        const row = Array.isArray(data) ? data[0] : data;
        if (error) throw new Error(error.message);
        if (!row?.ok) throw new Error(row?.message || "Fusion refusée");
      }
      setMergeMsg("Fusion effectuée.");
      onMerged();
    } catch (e) {
      setMergeMsg(e instanceof Error ? e.message : "Erreur de fusion");
    } finally {
      setMerging("");
    }
  }

  const groups = useMemo(() => {
    const candidates: DedupCandidate[] = guests.map((g) => ({
      guest_id: g.id,
      phone: g.phone,
      email: g.email,
      first_name: g.first_name,
      last_name: g.last_name,
    }));
    return detectDuplicates(candidates);
  }, [guests]);

  const byId = useMemo(() => {
    const m = new Map<string, MergePreviewGuest>();
    for (const g of guests) {
      m.set(g.id, {
        id: g.id,
        first_name: g.first_name,
        last_name: g.last_name,
        email: g.email,
        phone: g.phone,
        birthday: g.birthday,
        created_at: g.created_at,
      });
    }
    return m;
  }, [guests]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of guests) m.set(g.id, `${g.first_name} ${g.last_name ?? ""}`.trim());
    return m;
  }, [guests]);

  const keyLabel = { phone: "téléphone", email: "email", name: "nom" } as const;

  return (
    <div className={`${CARD} mt-3`}>
      <button className="flex w-full items-center justify-between" onClick={() => setOpen((o) => !o)}>
        <span className={LABEL}>Doublons candidats ({groups.length})</span>
        <span className="text-white/40">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {groups.length === 0 ? (
            <div className="text-[11px] text-white/40">
              Aucun doublon détecté sur les fiches chargées. Aucune fusion à l&apos;aveugle.
            </div>
          ) : (
            groups.map((g, i) => {
              const preview = buildMergePreview(g, byId);
              return (
                <div key={`${g.key}-${g.value}-${i}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
                  <div className="text-[11px] text-white/60">
                    Même {keyLabel[g.key]} : <b className="text-white/80">{g.value}</b>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {g.guestIds.map((id) => (
                      <li key={id}>
                        <button
                          className={`text-[11px] underline ${
                            preview && preview.primaryId === id ? "text-emerald-300" : "text-white/60"
                          }`}
                          onClick={() => onSelect(id)}
                        >
                          {nameById.get(id) || id}
                          {preview && preview.primaryId === id ? " (fiche conservée)" : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {preview && (
                    <div className="mt-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/55">
                      <div className="font-bold text-white/70">Aperçu de fusion (non appliqué) :</div>
                      <div>
                        Résultat → {preview.resulting.first_name ?? "—"} {preview.resulting.last_name ?? ""} ·{" "}
                        {preview.resulting.phone ?? "—"} · {preview.resulting.email ?? "—"} ·{" "}
                        {preview.resulting.birthday ?? "—"}
                      </div>
                      {preview.conflicts.length > 0 && (
                        <div className="mt-0.5 text-amber-300/90">
                          {preview.conflicts.length} conflit(s) à arbitrer :{" "}
                          {preview.conflicts
                            .map((c) => `${c.field} (« ${c.primary} » vs « ${c.incoming} »)`)
                            .join(", ")}
                        </div>
                      )}
                      <div className="mt-0.5 italic text-white/40">
                        Acte destructif : les fiches secondaires sont fusionnées dans la fiche conservée.
                      </div>
                      {canMerge && (
                        <button
                          className={`${BTN} mt-1.5 w-full`}
                          disabled={merging === preview.primaryId}
                          onClick={() =>
                            confirmMerge(
                              preview.primaryId,
                              g.guestIds.filter((id) => id !== preview.primaryId),
                            )
                          }
                        >
                          {merging === preview.primaryId ? "Fusion…" : "Confirmer la fusion"}
                        </button>
                      )}
                      {mergeMsg && <div className="mt-1 text-emerald-300">{mergeMsg}</div>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Import CSV — parse + rapport par ligne, insertion des seules lignes valides sur confirmation.
// ════════════════════════════════════════════════════════════════
function CsvImportSection({
  supabase,
  onImported,
}: {
  supabase: SupabaseClient;
  onImported: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<CsvImportReport | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; failed: number; errors: string[] } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setResult(null);
    setReport(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setReport(buildCsvImportReport(parseCsv(text)));
  }

  async function runImport() {
    if (!report || report.validCount === 0) return;
    setImporting(true);
    const errors: string[] = [];
    let inserted = 0;
    let failed = 0;
    // Insertion ligne par ligne : un conflit d'unicité (téléphone) n'annule pas tout le lot.
    for (const row of report.rows) {
      if (!row.ok) continue;
      const { error } = await supabase.from("guests").insert({
        phone: row.value.phone,
        first_name: row.value.first_name,
        last_name: row.value.last_name,
        email: row.value.email,
        birthday: row.value.birthday,
      });
      if (error) {
        failed++;
        errors.push(
          `${row.value.phone} : ${
            /duplicate|unique/i.test(error.message) ? "déjà en base (téléphone)" : error.message
          }`,
        );
      } else {
        inserted++;
      }
    }
    setImporting(false);
    setResult({ inserted, failed, errors });
    if (inserted > 0) await onImported();
  }

  return (
    <div className={`${CARD} mt-3`}>
      <button className="flex w-full items-center justify-between" onClick={() => setOpen((o) => !o)}>
        <span className={LABEL}>Import CSV</span>
        <span className="text-white/40">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="text-[10px] text-white/40">
            Colonnes : phone, first_name, last_name, email, birthday. En-tête optionnel. Seules les lignes
            valides sont insérées, sur confirmation.
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block w-full text-[11px] text-white/70 file:mr-2 file:rounded-lg file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white"
          />
          {report && (
            <div className="space-y-1">
              <div className="text-[11px] text-white/70">
                {fileName} — {report.validCount} valide(s), {report.errorCount} en erreur
                {report.headerSkipped ? " (en-tête ignoré)" : ""}.
              </div>
              {report.errorCount > 0 && (
                <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-red-500/30 bg-red-500/5 p-2">
                  {report.rows
                    .filter((r) => !r.ok)
                    .map((r, i) =>
                      r.ok ? null : (
                        <li key={i} className="text-[10px] text-red-200/90">
                          Ligne {r.line} : {r.errors.map((er) => CSV_ERROR_LABELS[er]).join(" ; ")}
                        </li>
                      ),
                    )}
                </ul>
              )}
              <button
                className={BTN}
                onClick={runImport}
                disabled={importing || report.validCount === 0}
              >
                {importing ? "Import…" : `Importer ${report.validCount} ligne(s) valide(s)`}
              </button>
            </div>
          )}
          {result && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[11px]">
              <div className="font-bold text-emerald-300">{result.inserted} fiche(s) insérée(s).</div>
              {result.failed > 0 && (
                <div className="mt-0.5 text-red-200/90">
                  {result.failed} refusée(s) :
                  <ul className="mt-0.5 space-y-0.5">
                    {result.errors.map((er, i) => (
                      <li key={i}>{er}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
