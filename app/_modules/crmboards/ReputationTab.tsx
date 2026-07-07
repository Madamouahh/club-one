"use client";

// app/_modules/crmboards/ReputationTab.tsx — CONTENEUR autonome (intégrateur) du module RÉPUTATION &
// AVIS (B14). Récupère les avis SAISIS (table `reviews`, migration 0064, cantonnée par la RLS :
// direction admin/manager uniquement), les passe au composant PRÉSENTATIONNEL <ReputationBoard> (via la
// vue pure buildReputationView), et branche la SAISIE / RÉPONSE / STATUT réels sur des écritures directes
// (RLS 0064 = frontière dure).
//
// Même contrat d'appel que les autres conteneurs (StockView / ReservationBoardTab) : { supabase, role,
// username }. AUCUNE règle métier dupliquée : l'autorité reste la RLS 0064. Les gardes d'affichage
// (canViewReputation / canReplyReputation) sont un confort d'UI, jamais une sécurité.
//
// HONNÊTETÉ ASSUMÉE :
//   · Connecteur externe (Google/Meta/Tripadvisor API) : PRÊT À CONNECTER — NON ACTIVÉ. Bandeau explicite.
//   · Sans avis saisi, le module reste VIDE (jamais un faux « 5 étoiles »).
//   · Le board n'agrège que google/meta ; les avis tripadvisor/autre sont gérés ici mais signalés hors
//     agrégat (jamais déguisés en Google).
//   · Aucune réponse n'est publiée par l'app : « repondu » est un geste humain (bouton), le texte est
//     rédigé à la main. Aucun texte injecté (loi Evin).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import ReputationBoard from "@/components/ReputationBoard";
import type { StaffRole } from "@/lib/permissions";
import { buildReputationView, canReplyReputation, canViewReputation } from "@/lib/reputation";
import {
  DB_REVIEW_STATUSES,
  REVIEW_SOURCES,
  dbReviewStatusLabel,
  offBoardCount,
  recordsToBoardReviews,
  reviewSourceLabel,
  validateNewReview,
  type DbReviewStatus,
  type ReviewRecord,
} from "@/lib/reviewsData";

const REVIEW_SELECT = "id,source,rating,author,body,review_date,status,response,created_by,created_at";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-3";
const INPUT = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white";
const BTN = "rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40";

export default function ReputationTab({
  supabase,
  role,
  username,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const canManage = canReplyReputation(role);

  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Saisie d'un nouvel avis.
  const [nSource, setNSource] = useState<string>("google");
  const [nRating, setNRating] = useState("");
  const [nAuthor, setNAuthor] = useState("");
  const [nBody, setNBody] = useState("");
  const [nDate, setNDate] = useState("");

  // Brouillons de réponse par avis (édition inline).
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("reviews")
      .select(REVIEW_SELECT)
      .order("created_at", { ascending: false });
    if (e) {
      setError(e.message);
      return;
    }
    setError("");
    setRecords((data ?? []) as ReviewRecord[]);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("reviews")
        .select(REVIEW_SELECT)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (e) setError(e.message);
      else setRecords((data ?? []) as ReviewRecord[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // Vue agrégée pour le board (google/meta seulement). L'instant de référence pour le SLA vient de l'app
  // (runtime) — le calcul lui-même reste pur (lib/reputation).
  const view = useMemo(
    () =>
      buildReputationView({
        reviews: recordsToBoardReviews(records),
        nowIso: new Date().toISOString(),
      }),
    [records],
  );

  const offBoard = useMemo(() => offBoardCount(records), [records]);

  async function addReview() {
    setError("");
    const check = validateNewReview({
      source: nSource,
      rating: nRating,
      author: nAuthor,
      body: nBody,
      review_date: nDate,
    });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const { error: e } = await supabase.from("reviews").insert({
      source: check.value.source,
      rating: check.value.rating,
      author: check.value.author,
      body: check.value.body,
      review_date: check.value.review_date,
      created_by: username,
    });
    if (e) {
      setError(`Saisie refusée : ${e.message}`);
      return;
    }
    setNRating("");
    setNAuthor("");
    setNBody("");
    setNDate("");
    await load();
  }

  async function setStatus(id: string, status: DbReviewStatus) {
    setError("");
    const { error: e } = await supabase.from("reviews").update({ status }).eq("id", id);
    if (e) {
      setError(`Changement de statut refusé : ${e.message}`);
      return;
    }
    await load();
  }

  // « Enregistrer la réponse » = geste HUMAIN : on stocke le texte rédigé à la main et on marque `repondu`.
  // Aucune publication externe (loi Evin : aucun texte injecté par l'outil).
  async function saveResponse(id: string) {
    setError("");
    const text = (drafts[id] ?? "").trim();
    if (!text) {
      setError("Réponse vide : rien à enregistrer.");
      return;
    }
    const { error: e } = await supabase
      .from("reviews")
      .update({ response: text, status: "repondu" })
      .eq("id", id);
    if (e) {
      setError(`Réponse refusée : ${e.message}`);
      return;
    }
    await load();
  }

  // Garde d'affichage (confort UI, miroir de la RLS 0064). Les rôles hors direction n'ont de toute façon
  // aucune ligne via la RLS ; on l'affiche explicitement plutôt qu'une liste vide trompeuse.
  if (!canViewReputation(role)) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        La réputation &amp; les avis sont réservés à la direction / com (admin / manager, matrice B14). Ce
        rôle n’y a aucun accès.
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4 text-white">
      {/* Bandeau connecteur : honnêteté assumée. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[10px] uppercase tracking-wide text-white/40">
        Connecteur externe (Google / Meta / Tripadvisor) · PRÊT À CONNECTER — NON ACTIVÉ · saisie manuelle
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-white/40">Chargement des avis…</div>
      ) : (
        <>
          {/* Vue agrégée présentationnelle (google/meta). Vide honnête si aucun avis. */}
          <ReputationBoard view={view} role={role} />

          {offBoard > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/45">
              {offBoard} avis Tripadvisor / autre saisis, gérés ci-dessous mais HORS de l’agrégat Google /
              Meta (aucune plateforme n’est déguisée).
            </div>
          )}

          {/* Saisie d'un nouvel avis (direction). */}
          {canManage && (
            <div className={CARD}>
              <div className="mb-2 text-xs font-bold uppercase text-white/50">Saisir un avis</div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={INPUT}
                    value={nSource}
                    onChange={(e) => setNSource(e.target.value)}
                  >
                    {REVIEW_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {reviewSourceLabel(s)}
                      </option>
                    ))}
                  </select>
                  <input
                    className={INPUT}
                    inputMode="numeric"
                    placeholder="Note 1-5 (opt.)"
                    value={nRating}
                    onChange={(e) => setNRating(e.target.value)}
                  />
                </div>
                <input
                  className={INPUT}
                  placeholder="Auteur (nom affiché sur la plateforme)"
                  value={nAuthor}
                  onChange={(e) => setNAuthor(e.target.value)}
                />
                <textarea
                  className={INPUT}
                  rows={2}
                  placeholder="Texte de l'avis (optionnel)"
                  value={nBody}
                  onChange={(e) => setNBody(e.target.value)}
                />
                <input
                  className={INPUT}
                  type="date"
                  value={nDate}
                  onChange={(e) => setNDate(e.target.value)}
                />
                <button className={BTN} onClick={addReview} disabled={!nAuthor.trim()}>
                  Enregistrer l’avis
                </button>
              </div>
            </div>
          )}

          {/* Gestion : statut + réponse humaine, sur TOUS les avis (toutes sources). */}
          <div>
            <div className="mb-2 text-xs font-bold uppercase text-white/50">
              Gestion des avis ({records.length})
            </div>
            {records.length === 0 ? (
              <div className="text-center text-sm text-white/40">
                Aucun avis saisi. La direction saisit les avis réels — aucun avis n’est fabriqué.
              </div>
            ) : (
              <ul className="space-y-2">
                {records.map((rec) => (
                  <li key={rec.id} className={CARD}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-bold">
                          <span className="truncate">{rec.author}</span>
                          {rec.rating !== null && (
                            <span className="shrink-0 text-[11px] font-bold text-amber-300">
                              {rec.rating}/5 ★
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-white/50">
                          {reviewSourceLabel(rec.source)}
                          {" · "}
                          {dbReviewStatusLabel(rec.status)}
                          {rec.review_date ? ` · ${rec.review_date}` : ""}
                        </div>
                      </div>
                    </div>

                    {rec.body && (
                      <p className="mt-2 text-[12px] leading-relaxed text-white/60">« {rec.body} »</p>
                    )}

                    {rec.response && (
                      <p className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] px-2 py-1.5 text-[12px] text-emerald-100/80">
                        Réponse : {rec.response}
                      </p>
                    )}

                    {canManage && (
                      <div className="mt-2.5 space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {DB_REVIEW_STATUSES.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setStatus(rec.id, s)}
                              disabled={rec.status === s}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                                rec.status === s
                                  ? "border-white/30 bg-white/15 text-white"
                                  : "border-white/10 text-white/60 hover:bg-white/10"
                              }`}
                            >
                              {dbReviewStatusLabel(s)}
                            </button>
                          ))}
                        </div>
                        <textarea
                          className={INPUT}
                          rows={2}
                          placeholder="Réponse rédigée à la main (aucun texte injecté par l'outil)"
                          value={drafts[rec.id] ?? rec.response ?? ""}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [rec.id]: e.target.value }))
                          }
                        />
                        <button
                          className={BTN}
                          onClick={() => saveResponse(rec.id)}
                          disabled={!((drafts[rec.id] ?? rec.response ?? "").trim())}
                        >
                          Enregistrer la réponse &amp; marquer répondu
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-white/35">
            Aucune réponse n’est publiée par l’app : « répondu » est un geste humain, le texte est rédigé à
            la main (loi Evin : aucune mention d’alcool ajoutée par l’outil). Sans avis saisi, le module
            reste vide — aucune note, aucun avis n’est inventé.
          </p>
        </>
      )}
    </div>
  );
}
