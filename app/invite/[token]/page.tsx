"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@supabase/supabase-js";

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

type PromoterGuestEntry = {
  id: string;
  event_date: string;
  promoter_username: string;
  guest_name: string;
  phone: string;
  access_mode: "avec_alcool" | "sans_alcool";
  payment_status: "regle" | "en_attente" | "offert";
  qr_token: string;
  checked_in: boolean;
  checked_in_at?: string | null;
  checked_in_by?: string;
};

function publicInviteUrl(token: string) {
  return `https://club-one-bay.vercel.app/invite/${encodeURIComponent(token)}`;
}

function promoterLabel(username: string) {
  const labels: Record<string, string> = {
    mathias: "Mathias",
    quentin: "Quentin",
    lawrence: "Lawrence",
    maxime: "Maxime",
  };

  return labels[username] || username;
}

function accessLabel(value: PromoterGuestEntry["access_mode"]) {
  return value === "avec_alcool" ? "Avec alcool" : "Sans alcool";
}

function paymentLabel(value: PromoterGuestEntry["payment_status"]) {
  if (value === "regle") return "Réglé";
  if (value === "offert") return "Offert";
  return "En attente";
}

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => decodeURIComponent(String(params?.token || "")), [params]);
  const [entry, setEntry] = useState<PromoterGuestEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadInvitation() {
      if (!token) {
        setError("Invitation introuvable.");
        setLoading(false);
        return;
      }

      // RPC publique (SECURITY DEFINER) : renvoie une seule invitation par token,
      // sans exposer toute la table ni le téléphone. Voir migration 0003 get_invite.
      const { data, error: fetchError } = await supabase.rpc("get_invite", {
        p_token: token,
      });

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        setError("Invitation invalide ou supprimée.");
        setLoading(false);
        return;
      }

      setEntry(row as PromoterGuestEntry);
      setLoading(false);
    }

    loadInvitation();
  }, [token]);

  return (
    <main className="grid min-h-screen place-items-center bg-black p-5 text-white">
      <section className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#070707] p-6 text-center shadow-[0_0_40px_rgba(236,73,0,.18)]">
        <h1 className="text-3xl font-light tracking-[0.38em]">
          CLUB <span className="text-orange-500">O</span>NE
        </h1>
        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-white/40">
          Invitation officielle
        </p>

        {loading && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <p className="font-black text-white/70">Chargement...</p>
          </div>
        )}

        {!loading && error && (
          <div className="mt-8 rounded-3xl border border-red-500/30 bg-red-500/10 p-6">
            <p className="font-black text-red-300">QR invalide</p>
            <p className="mt-2 text-sm text-white/55">{error}</p>
          </div>
        )}

        {!loading && entry && (
          <>
            <div
              className={`mt-6 rounded-3xl border p-4 ${
                entry.checked_in
                  ? "border-red-500/35 bg-red-500/10"
                  : "border-emerald-400/25 bg-emerald-500/10"
              }`}
            >
              <p className="text-2xl font-black">{entry.guest_name}</p>
              <p className="mt-1 text-sm text-orange-300">
                Promoteur : {promoterLabel(entry.promoter_username)}
              </p>
              <p className="mt-1 text-sm text-white/55">Soirée : {entry.event_date}</p>
              <p className="mt-1 text-sm text-white/55">Accès : {accessLabel(entry.access_mode)}</p>
              <p className="mt-1 text-sm text-white/55">Statut : {paymentLabel(entry.payment_status)}</p>
            </div>

            <div className="mx-auto mt-6 inline-block rounded-3xl bg-white p-4">
              <QRCodeSVG value={publicInviteUrl(entry.qr_token)} size={260} />
            </div>

            <p
              className={`mt-6 rounded-2xl px-4 py-3 text-sm font-black ${
                entry.checked_in
                  ? "bg-red-500/15 text-red-300"
                  : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {entry.checked_in
                ? "QR déjà utilisé — ne pas accepter une deuxième fois"
                : "Présente ce QR à l’entrée"}
            </p>

            <p className="mt-4 break-all text-[11px] text-white/30">
              {publicInviteUrl(entry.qr_token)}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
