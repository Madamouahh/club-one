"use client";

import { useState } from "react";
import { QrCameraScanner } from "./QrCheckInPanel";
import type { ScanFeedback } from "@/lib/crmScan";

// Panneau de SCAN À LA PORTE du QR d'entrée d'un client inscrit via le funnel CRM (spec §V0 pt 5).
// Distinct du « QR invite promoteur » : ici on scanne le QR PERSONNEL du client → sa présence
// (seated) se constate automatiquement (RPC scan_guest_pass_v1, migration 0015). Toute la sécurité
// est en SQL ; ce composant ne fait qu'afficher un feedback honnête (validé / déjà entré / refusé).
export function GuestPassScanPanel({
  onScanPass,
}: {
  onScanPass: (rawToken: string) => Promise<ScanFeedback>;
}) {
  const [manualValue, setManualValue] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);

  // Retourne true si l'entrée est admise (ok OU déjà entré) → la caméra peut se fermer. Un refus
  // dur laisse la caméra ouverte pour rescanner sans re-cliquer.
  async function runScan(value: string): Promise<boolean> {
    if (scanning) return false;
    if (!value.trim()) return false;
    setScanning(true);
    try {
      const result = await onScanPass(value);
      setFeedback(result);
      if (result.admitted) {
        setManualValue("");
        setScannerOpen(false);
      }
      return result.admitted;
    } finally {
      setScanning(false);
    }
  }

  const toneClasses =
    feedback?.tone === "ok"
      ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
      : feedback?.tone === "warn"
        ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
        : "border-red-400/40 bg-red-500/15 text-red-200";

  return (
    <div className="mt-3 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-3">
      <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-sky-300">
        Scanner QR d&apos;entrée invité (funnel)
      </p>
      <p className="mb-2 text-[11px] text-white/45">
        Scanne le QR personnel du client inscrit : sa présence est enregistrée automatiquement. Le
        re-scan du même QR ne compte pas deux fois.
      </p>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => setScannerOpen((current) => !current)}
          disabled={scanning}
          className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white"
        >
          {scannerOpen ? "Fermer caméra" : "Scanner caméra"}
        </button>
        <button
          onClick={() => runScan(manualValue)}
          disabled={scanning}
          className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? "Scan..." : "Valider manuel"}
        </button>
      </div>

      {scannerOpen && <QrCameraScanner onScan={(value) => runScan(value)} />}

      <div className="grid grid-cols-[1fr_88px] gap-2">
        <input
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
          placeholder="Coller le token d'entrée"
          value={manualValue}
          disabled={scanning}
          onChange={(event) => setManualValue(event.target.value)}
        />
        <button
          onClick={() => runScan(manualValue)}
          disabled={scanning}
          className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? "..." : "Valider"}
        </button>
      </div>

      {feedback && (
        <div className={`mt-3 rounded-xl border px-3 py-2 ${toneClasses}`}>
          <p className="text-sm font-black">{feedback.title}</p>
          {feedback.detail && <p className="mt-0.5 text-[11px] opacity-80">{feedback.detail}</p>}
        </div>
      )}
    </div>
  );
}
