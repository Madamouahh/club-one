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

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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

export default function GuestSpacePage() {
  const params = useParams<{ token: string }>();
  const rawToken = useMemo(() => decodeURIComponent(String(params?.token || "")), [params]);
  const token = useMemo(() => extractSpaceToken(rawToken), [rawToken]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [space, setSpace] = useState<GuestSpacePayload | null>(null);
  const [openPassToken, setOpenPassToken] = useState<string | null>(null);

  const refDate = useMemo(() => todayExploitationDate(), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setLoadError("Lien invalide.");
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc("get_guest_space_v1", { p_space_token: token });
      if (cancelled) return;
      if (error) {
        setLoadError("Espace momentanément indisponible. Réessayez plus tard.");
        setLoading(false);
        return;
      }
      setSpace(normalizeSpacePayload(data));
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

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

        {/* ——— Photos : état honnête, aucune donnée (droit à l'image non recueilli) ——— */}
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-[0.18em] text-white/40">Photos des soirées</h2>
          <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/45">
            Bientôt disponible.
          </p>
        </div>

        <p className="mt-6 rounded-2xl bg-white/[0.03] px-4 py-3 text-center text-[11px] text-white/40">
          Espace personnel en lecture seule. Conservez ce lien ou ajoutez-le à vos favoris.
        </p>
      </section>
    </main>
  );
}
