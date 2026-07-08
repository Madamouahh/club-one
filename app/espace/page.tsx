"use client";

// /espace — INDEX canonique du portail client (route statique → HTTP 200). L'espace personnel réel est
// servi par la route dynamique /espace/[token] (jeton = capacité révocable). Sans jeton, cette page
// explique l'accès et permet la RÉCUPÉRATION sans email : téléphone + code personnel → nouveau lien
// (recover_guest_access_v1, 0061, rate-limité, réponses neutres anti-énumération) → redirection.
// Aucune donnée sensible, aucun accès direct anon aux tables : la garde reste le jeton résolu côté serveur.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";

function sanitizePin(v: string): string {
  return v.replace(/\D/g, "").slice(0, 8);
}

export default function EspaceIndexPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!phone.trim() || pin.length < 4) {
      setErr("Renseignez votre téléphone et votre code à 4–8 chiffres.");
      return;
    }
    setBusy(true);
    const res = await supabase.rpc("recover_guest_access_v1", { p_phone: phone.trim(), p_pin: pin });
    setBusy(false);
    if (res.error) {
      setErr("Service momentanément indisponible. Réessayez.");
      return;
    }
    const data = (Array.isArray(res.data) ? res.data[0] : res.data) as Record<string, unknown> | null;
    const token = (data?.space_token ?? data?.token) as string | undefined;
    if (data?.ok && token) {
      router.push(`/espace/${encodeURIComponent(token)}`);
      return;
    }
    setErr("Téléphone ou code non reconnu. Vérifiez vos informations.");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-black p-5 text-white" data-testid="espace-index">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.02] p-6">
        <p className="text-center text-xs uppercase tracking-[0.2em] text-white/40">Club One</p>
        <h1 className="mt-1 text-center text-2xl font-black">Mon espace</h1>
        <p className="mt-3 text-center text-sm text-white/55">
          Accédez à votre espace via votre <strong>lien personnel</strong> (reçu de votre contact ou de l&apos;équipe).
          Lien perdu&nbsp;? Récupérez l&apos;accès ci-dessous — aucun email ni SMS n&apos;est envoyé.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
          <p className="text-center text-xs uppercase tracking-[0.18em] text-white/40">Récupérer mon accès</p>
          <input
            inputMode="tel"
            autoComplete="tel"
            aria-label="Téléphone"
            data-testid="espace-recover-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Téléphone (ex. +33600000000)"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-orange-500/50"
          />
          <input
            inputMode="numeric"
            autoComplete="off"
            aria-label="Code personnel"
            data-testid="espace-recover-pin"
            value={pin}
            onChange={(e) => setPin(sanitizePin(e.target.value))}
            placeholder="Code à 4–8 chiffres"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center tracking-[0.4em] text-white outline-none focus:border-orange-500/50"
          />
          {err ? <p className="text-sm text-red-300" role="alert" data-testid="espace-recover-error">{err}</p> : null}
          <button
            type="submit"
            disabled={busy}
            data-testid="espace-recover-submit"
            className="w-full rounded-2xl bg-orange-500 px-4 py-3 font-black text-black transition hover:bg-orange-400 disabled:opacity-50"
          >
            {busy ? "Vérification…" : "Retrouver mon espace"}
          </button>
        </form>
      </section>
    </main>
  );
}
