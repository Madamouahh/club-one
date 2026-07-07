"use client";

// app/_modules/crm/SpendAttributionPanel.tsx — ATTRIBUTION DE DÉPENSE PAR CLIENT (Vague 6, Squad D4).
// Autonome : reçoit { supabase, role } et fait tout son fetch (comme StockView / CrmProfilePanel). Le
// chaînon manquant de l'historique des dépenses : direction (admin/manager) recherche un client, saisit une
// date de soirée + un montant réel, et l'attribue via la RPC attribute_guest_spend_v1 (migration 0068).
// Après attribution, on relit guest_360_v1 : la dépense (spend_attributed) passe de NULL à la valeur saisie
// (la RPC force status='seated', seul statut agrégé par la 360) → « dépense non identifiée » devient un
// montant réel. Rien n'est fabriqué : montant saisi par l'humain, base vide → écran vide honnête.
//
// SÉCURITÉ RÉELLE : RLS guest_visits (0013) + garde direction de la RPC (SECURITY DEFINER, 0068). Ce gating
// UI (admin/manager) est un confort, pas une frontière : la base refuse déjà tout appel hors périmètre.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffRole } from "@/lib/permissions";
import { spendSummary, type Guest360 } from "@/lib/crmProfile";
import {
  ATTRIBUTION_ERROR_LABELS,
  formatCentsAsEuro,
  parseEuroToCents,
  todayIso,
  validateEventDate,
  type AttributionFieldError,
} from "@/lib/spendAttribution";

// ————————————————————————————————————————————————————————————————
// Styles (miroir de CrmProfilePanel pour rester cohérent visuellement).
// ————————————————————————————————————————————————————————————————
const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const BTN_GHOST =
  "rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";
const LABEL = "text-[10px] font-bold uppercase tracking-wide text-white/50";

const GUESTS_LOAD_CAP = 1000;

type GuestRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
};

const GUEST_COLS = "id, first_name, last_name, phone, email";

// Filtre client-side sur les fiches chargées (téléphone / email / prénom / nom), insensible à la casse.
function filterGuests(guests: readonly GuestRow[], query: string): GuestRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...guests];
  return guests.filter((g) => {
    const hay = `${g.first_name} ${g.last_name ?? ""} ${g.phone} ${g.email ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
}

function labelFor(err: AttributionFieldError): string {
  return ATTRIBUTION_ERROR_LABELS[err];
}

// ════════════════════════════════════════════════════════════════
export default function SpendAttributionPanel({
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

  const loadGuests = useCallback(async () => {
    setLoading(true);
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
      if (e) setError(e.message);
      else {
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

  // ————— Gating UI (rappel : la vraie garde est la RLS + la RPC direction) —————
  if (!isDirection) {
    return (
      <div className="rounded-3xl border border-white/10 bg-[#070707] p-4 text-white">
        <div className="text-sm font-black">Attribution de dépense</div>
        <p className="mt-2 text-xs text-white/50">
          Accès réservé à la direction (admin / manager). La base applique la même règle (RLS guest_visits
          0013 + garde direction de la RPC 0068).
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto rounded-3xl border border-white/10 bg-[#070707] p-3 text-white">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-lg font-black">CRM · Attribution de dépense</h2>
        <button className={BTN_GHOST} onClick={() => void loadGuests()} disabled={loading}>
          Rafraîchir
        </button>
      </div>
      <p className="text-[11px] leading-snug text-white/35">
        Reliez une dépense réelle d&apos;une soirée à un client : sélectionnez la fiche, saisissez la date
        de soirée et le montant. Rien n&apos;est fabriqué — le montant est saisi, jamais deviné. La dépense
        alimente aussitôt l&apos;historique 360 du client.
      </p>

      {error && (
        <div className="mt-2 rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      <div className="mt-3">
        <input
          className={INPUT}
          placeholder="Rechercher un client : téléphone, email, prénom, nom…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="mt-6 text-center text-sm text-white/40">Chargement…</div>
      ) : guests.length === 0 ? (
        <div className="mt-6 text-center text-sm text-white/40">
          Aucune fiche client. La base se remplit via le funnel de réservation, l&apos;import CSV ou la
          saisie directe (onglet Fiches clients).
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,340px)_1fr]">
          {/* Colonne liste */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className={LABEL}>
                {filtered.length} / {guests.length} fiche{guests.length > 1 ? "s" : ""}
              </span>
            </div>
            {capped && (
              <div className="mb-1 text-[10px] text-amber-300/80">
                Page limitée à {GUESTS_LOAD_CAP} fiches (les plus récentes). Affinez la recherche.
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-white/40">Aucun résultat pour cette recherche.</div>
            ) : (
              <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {filtered.map((g) => (
                  <li key={g.id}>
                    <button
                      data-testid={`spend-guest-${g.id}`}
                      className={`w-full rounded-xl border px-3 py-2 text-left ${
                        g.id === selectedId
                          ? "border-orange-500/60 bg-orange-500/10"
                          : "border-white/10 bg-white/[0.03]"
                      }`}
                      onClick={() => setSelectedId(g.id)}
                    >
                      <div className="truncate text-sm font-bold">
                        {g.first_name} {g.last_name ?? ""}
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
          </div>

          {/* Colonne attribution */}
          <div>
            {!selected ? (
              <div className={`${CARD} text-center text-sm text-white/40`}>
                Sélectionnez un client pour lui attribuer une dépense.
              </div>
            ) : (
              <AttributionForm key={selected.id} supabase={supabase} guest={selected} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Formulaire d'attribution + aperçu 360 (dépense) du client sélectionné.
// ════════════════════════════════════════════════════════════════
function AttributionForm({
  supabase,
  guest,
}: {
  supabase: SupabaseClient;
  guest: GuestRow;
}) {
  const [eventDate, setEventDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [dateErr, setDateErr] = useState("");
  const [amountErr, setAmountErr] = useState("");
  const [submitErr, setSubmitErr] = useState("");
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [three60, setThree60] = useState<Guest360 | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");

  const load360 = useCallback(async () => {
    setDetailLoading(true);
    setDetailError("");
    const { data, error } = await supabase.rpc("guest_360_v1", { p_guest_id: guest.id });
    if (error) setDetailError(error.message);
    else setThree60(((data as Guest360[] | null) || [])[0] ?? null);
    setDetailLoading(false);
  }, [supabase, guest.id]);

  useEffect(() => {
    void load360();
  }, [load360]);

  async function submit() {
    setDateErr("");
    setAmountErr("");
    setSubmitErr("");
    setMsg("");

    // Validation PURE (miroir des gardes SQL) — champ par champ pour un message précis.
    const dateRes = validateEventDate(eventDate, todayIso());
    if (!dateRes.ok) {
      setDateErr(labelFor(dateRes.error));
      return;
    }
    const amountRes = parseEuroToCents(amount);
    if (!amountRes.ok) {
      setAmountErr(labelFor(amountRes.error));
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.rpc("attribute_guest_spend_v1", {
      p_guest_id: guest.id,
      p_event_date: dateRes.value,
      p_amount_cents: amountRes.cents,
    });
    setSubmitting(false);

    if (error) {
      setSubmitErr(`Attribution refusée : ${error.message}`);
      return;
    }
    const stored = typeof data === "number" ? data : Number(data);
    setMsg(
      Number.isFinite(stored)
        ? `Dépense attribuée : ${stored.toLocaleString("fr-FR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} € pour la soirée du ${dateRes.value}.`
        : "Dépense attribuée.",
    );
    setAmount("");
    await load360(); // la 360 reflète aussitôt le nouveau total (status seated → spend_is_known=true).
  }

  const spend = three60 ? spendSummary(three60) : null;

  return (
    <div className="space-y-3">
      {/* Client + saisie */}
      <div className={CARD}>
        <div className="mb-2 flex items-center justify-between">
          <span className={LABEL}>Client</span>
          <span className="text-[11px] text-white/50">{guest.phone}</span>
        </div>
        <div className="text-sm font-bold">
          {guest.first_name} {guest.last_name ?? ""}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <div className={LABEL}>Date de soirée</div>
            <input
              type="date"
              className={INPUT}
              value={eventDate}
              max={todayIso()}
              onChange={(e) => setEventDate(e.target.value)}
            />
            {dateErr && <div className="mt-1 text-[11px] font-bold text-red-300">{dateErr}</div>}
          </div>
          <div>
            <div className={LABEL}>Montant (€)</div>
            <input
              className={INPUT}
              inputMode="decimal"
              placeholder="ex. 450,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            {amountErr && <div className="mt-1 text-[11px] font-bold text-red-300">{amountErr}</div>}
          </div>
        </div>

        <p className="mt-2 text-[10px] leading-snug text-white/35">
          L&apos;univers (salle) est résolu automatiquement depuis la visite déjà saisie ou l&apos;événement
          de la soirée. Si plusieurs univers sont programmés ce jour sans visite préalable, l&apos;attribution
          est refusée (aucun choix au hasard) — saisissez d&apos;abord la visite.
        </p>

        {submitErr && (
          <div className="mt-2 rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-[11px] font-bold text-red-200">
            {submitErr}
          </div>
        )}
        {msg && <div className="mt-2 text-[11px] font-bold text-emerald-300">{msg}</div>}

        <button className={`${BTN} mt-2`} onClick={submit} disabled={submitting}>
          {submitting ? "Attribution…" : "Attribuer la dépense"}
        </button>
      </div>

      {/* Aperçu 360 — dépense attribuée (honnête : NULL = non identifiée) */}
      <div className={CARD}>
        <div className={`${LABEL} mb-2`}>Historique 360 — dépense attribuée</div>
        {detailLoading ? (
          <div className="text-center text-sm text-white/40">Chargement…</div>
        ) : detailError ? (
          <div className="text-[11px] font-bold text-red-300">{detailError}</div>
        ) : !three60 ? (
          <div className="text-[11px] text-white/40">Aucune donnée 360 (fiche hors périmètre ou vide).</div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-xs">
            {spend && spend.known ? (
              <div className="text-sm font-black text-emerald-300">
                {formatCentsAsEuro(Math.round((spend.total ?? 0) * 100))}
                <span className="ml-1 text-[11px] font-normal text-white/50">
                  (12 m :{" "}
                  {spend.last12m != null ? formatCentsAsEuro(Math.round(spend.last12m * 100)) : "—"} ·{" "}
                  {spend.visitsWithSpend} visite{spend.visitsWithSpend > 1 ? "s" : ""} chiffrée
                  {spend.visitsWithSpend > 1 ? "s" : ""})
                </span>
              </div>
            ) : (
              <div className="text-sm font-bold text-white/50">Dépense non identifiée</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
