"use client";

// app/scan-porte-preview/page.tsx — ROUTE D'APERÇU ISOLÉE (CRM V0 : LE SCAN À LA PORTE, spec §V0 pt 5).
//
// Raison d'être : le composant de scan à la porte (GuestPassScanPanel) et sa logique PURE de portier
// (lib/crmScan : extractPassToken / interpretScanResult / precheckScannedPass) étaient construits et testés
// mais n'étaient montés NULLE PART. Cette page câble ce composant à un SIMULATEUR LOCAL du serveur pour que
// le fondateur voie l'écran du portier tourner : un QR scanné → présence enregistrée automatiquement →
// re-scan « déjà entré » → et tous les refus honnêtes (QR annulé, mauvaise soirée, QR inconnu, QR illisible).
//
// Périmètre volontairement étroit et SÛR (même discipline que /plan-salle-preview, /plan-salle-resa-preview,
// /call-list-preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · AUCUN réseau, AUCUN accès Supabase — le « serveur » est un SIMULATEUR EN MÉMOIRE. En réel, onScanPass
//     appelle la RPC SECURITY DEFINER scan_guest_pass_v1 (migration 0015) où réside TOUTE la sécurité
//     (rôle porte, soirée active, idempotence, présence seated) ; ce banc ne fait qu'exercer la logique
//     de présentation, JAMAIS une sécurité ;
//   · les QR affichés sont des FICTIONS de démonstration (jetons hexadécimaux « demo », étiquetés). AUCUN
//     vrai client (les 2050 OctoTable du LABO) n'est lu ;
//   · AUCUNE écriture, AUCUN envoi, AUCUNE mise en ligne.
//
// Le simulateur réutilise EXACTEMENT la logique de production : precheckScannedPass (refus 'invalid_token'
// sans réseau) + interpretScanResult (feedback honnête). Il ne fabrique jamais un faux succès.

import { useMemo, useRef, useState } from "react";

import { GuestPassScanPanel } from "@/components/GuestPassScanPanel";
import {
  interpretScanResult,
  precheckScannedPass,
  type ScanFeedback,
  type ScanPassResult,
} from "@/lib/crmScan";

// ————————————————————————————————————————————————————————————————
// QR de DÉMONSTRATION (100 % fictifs). Jetons = 64 hexadécimaux (forme réelle : 2 uuid concaténés), mais
// composés de motifs reconnaissables « demo » pour qu'ils ne puissent JAMAIS être confondus avec un vrai
// pass serveur. Aucun vrai client. Aucun jeton réel.
// ————————————————————————————————————————————————————————————————
const TOKEN_SOFIA = "5ed0da7a".repeat(8); // pass valide, EDEN, invitée simple
const TOKEN_MALIK = "0ade1177".repeat(8); // pass valide, EDEN, HÔTE de table
const TOKEN_CHLOE = "cacabeef".repeat(8); // QR annulé
const TOKEN_YANIS = "0ff5e77e".repeat(8); // valide mais autre soirée
const TOKEN_UNKNOWN = "deadfade".repeat(8); // jamais inscrit → inconnu du serveur
const URL_INVITATION = `https://club.example/i/${TOKEN_SOFIA}`; // QR d'INVITATION promoteur (≠ pass d'entrée)

// Enregistrement serveur simulé pour un pass connu (ce que scan_guest_pass_v1 « connaîtrait »).
type DemoPass = {
  first_name: string;
  univers: string;
  is_host: boolean;
  status: "active" | "cancelled" | "wrong_event";
};

const DEMO_PASSES: Record<string, DemoPass> = {
  [TOKEN_SOFIA]: { first_name: "Sofia (démo)", univers: "eden", is_host: false, status: "active" },
  [TOKEN_MALIK]: { first_name: "Malik (démo)", univers: "eden", is_host: true, status: "active" },
  [TOKEN_CHLOE]: { first_name: "Chloé (démo)", univers: "eden", is_host: false, status: "cancelled" },
  [TOKEN_YANIS]: { first_name: "Yanis (démo)", univers: "cercle", is_host: false, status: "wrong_event" },
};

// Construit le ScanPassResult que renverrait la RPC pour un pass connu, selon son statut et son idempotence.
function serverResultFor(pass: DemoPass, alreadyScanned: boolean): ScanPassResult {
  const base: ScanPassResult = {
    ok: false,
    code: "unknown_pass",
    message: "",
    first_name: pass.first_name,
    univers: pass.univers,
    is_host: pass.is_host,
    scanned_at: null,
    scanned_by: null,
  };
  if (pass.status === "cancelled") return { ...base, code: "pass_cancelled" };
  if (pass.status === "wrong_event") return { ...base, code: "wrong_event" };
  if (alreadyScanned) return { ...base, ok: true, code: "already_scanned" };
  return { ...base, ok: true, code: "ok" };
}

// Le simulateur : reproduit onScanPass en local. Il réutilise la MÊME logique que la production —
// precheckScannedPass (refus 'invalid_token' sans réseau) puis interpretScanResult. `seen` porte
// l'idempotence (mutable, comme le serait la table guest_visits côté serveur).
function simulateScan(rawScanned: string, seen: Set<string>): ScanFeedback {
  const pre = precheckScannedPass(rawScanned);
  if (!pre.ok) return pre.feedback; // QR illisible / URL / vide → refus, aucun « réseau »

  const pass = DEMO_PASSES[pre.token];
  if (!pass) {
    // Jeton bien formé mais inconnu du « serveur ».
    return interpretScanResult({
      ok: false,
      code: "unknown_pass",
      message: "",
      first_name: null,
      univers: null,
      is_host: null,
      scanned_at: null,
      scanned_by: null,
    });
  }

  const alreadyScanned = seen.has(pre.token);
  const result = serverResultFor(pass, alreadyScanned);
  // L'idempotence n'enregistre la présence que pour un pass admissible (ok/already), jamais un refus dur.
  if (result.ok) seen.add(pre.token);
  return interpretScanResult(result);
}

// Carnet de QR de démonstration (chaque ligne montre le jeton complet + ce qu'il doit produire).
const DEMO_QRS: { label: string; token: string; expect: string }[] = [
  { label: "Sofia — pass valide (EDEN)", token: TOKEN_SOFIA, expect: "Entrée validée · re-scan → « déjà entré »" },
  { label: "Malik — pass valide, HÔTE de table", token: TOKEN_MALIK, expect: "Entrée validée · tag HÔTE" },
  { label: "Chloé — QR annulé", token: TOKEN_CHLOE, expect: "Refus : QR annulé" },
  { label: "Yanis — autre soirée", token: TOKEN_YANIS, expect: "Refus : mauvaise soirée" },
  { label: "QR jamais inscrit", token: TOKEN_UNKNOWN, expect: "Refus : QR inconnu" },
  { label: "QR d'INVITATION promoteur (une URL)", token: URL_INVITATION, expect: "Refus : QR illisible (≠ pass d'entrée)" },
];

function toneClasses(tone: ScanFeedback["tone"]): string {
  return tone === "ok"
    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
    : tone === "warn"
      ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
      : "border-red-400/40 bg-red-500/15 text-red-200";
}

export default function ScanPortePreviewPage() {
  // L'idempotence est portée par un Set stable sur toute la session du banc (comme guest_visits côté serveur).
  const seenRef = useRef<Set<string>>(new Set());
  const [carnetFeedback, setCarnetFeedback] = useState<Record<string, ScanFeedback>>({});
  const [scanCount, setScanCount] = useState(0);

  // onScanPass réel du composant : asynchrone, exactement comme la RPC. Ici il délègue au simulateur local.
  const onScanPass = useMemo(
    () => async (rawToken: string): Promise<ScanFeedback> => {
      const fb = simulateScan(rawToken, seenRef.current);
      setScanCount((c) => c + 1);
      return fb;
    },
    [],
  );

  function runCarnet(token: string) {
    const fb = simulateScan(token, seenRef.current);
    setCarnetFeedback((prev) => ({ ...prev, [token]: fb }));
    setScanCount((c) => c + 1);
  }

  function resetIdempotence() {
    seenRef.current = new Set();
    setCarnetFeedback({});
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-[#0a0a0f] px-4 py-8 text-white">
      {/* Bandeau ambre NON négociable : banc de démonstration, pas l'écran opérationnel. */}
      <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
        <p className="font-black uppercase tracking-wider">Démonstration — QR fictifs, serveur simulé</p>
        <p className="mt-1 text-amber-100/80">
          Aucun vrai client, aucun vrai QR, aucun réseau. Le « serveur » est un simulateur en mémoire. En
          réel, le scan appelle la RPC <code>scan_guest_pass_v1</code> (migration 0015) où réside TOUTE la
          sécurité (rôle porte, soirée active, idempotence). Ce banc n&apos;exerce que la présentation. Les
          rôles porte autorisés : <code>admin</code>, <code>manager</code>, <code>security</code>,{" "}
          <code>security_counter</code> — jamais un promoteur ni un serveur.
        </p>
      </div>

      <header className="mb-4">
        <h1 className="text-lg font-black">Scan à la porte — aperçu</h1>
        <p className="mt-1 text-[12px] text-white/50">
          Le portier scanne le QR personnel d&apos;un client inscrit via le funnel : sa présence est
          enregistrée automatiquement. Le re-scan du même QR ne compte pas deux fois (idempotence).
        </p>
      </header>

      {/* Le composant RÉEL du porte-monnaie de scan, câblé au simulateur. */}
      <GuestPassScanPanel onScanPass={onScanPass} />

      {/* Carnet de QR de démonstration : un clic rejoue exactement onScanPass (même logique de production). */}
      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/50">
            Carnet de QR de démonstration
          </p>
          <button
            type="button"
            onClick={resetIdempotence}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-bold text-white/60 hover:text-white/90"
          >
            Réinitialiser (vider les présences simulées)
          </button>
        </div>
        <p className="mb-3 text-[11px] text-white/40">
          Clique une ligne pour simuler son scan (identique à un scan caméra / collage manuel). Clique deux
          fois « Sofia » pour voir « déjà entré ». Total de scans simulés : {scanCount}.
        </p>

        <div className="space-y-2">
          {DEMO_QRS.map((qr) => {
            const fb = carnetFeedback[qr.token];
            return (
              <div key={qr.token} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black">{qr.label}</p>
                    <p className="mt-0.5 text-[11px] text-white/40">Attendu : {qr.expect}</p>
                    <p className="mt-1 truncate font-mono text-[10px] text-white/25" title={qr.token}>
                      {qr.token}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => runCarnet(qr.token)}
                    className="shrink-0 rounded-xl bg-sky-500 px-3 py-2 text-xs font-black text-black"
                  >
                    Scanner
                  </button>
                </div>
                {fb && (
                  <div className={`mt-2 rounded-xl border px-3 py-2 ${toneClasses(fb.tone)}`}>
                    <p className="text-sm font-black">{fb.title}</p>
                    {fb.detail && <p className="mt-0.5 text-[11px] opacity-80">{fb.detail}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
