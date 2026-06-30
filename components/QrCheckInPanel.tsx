"use client";

import { useEffect, useId, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

export function QrCheckInPanel({
  onValidateQr,
  compact = false,
}: {
  onValidateQr: (token: string) => Promise<boolean>;
  compact?: boolean;
}) {
  const [qrValue, setQrValue] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrChecking, setQrChecking] = useState(false);

  async function submitQr(value: string) {
    if (qrChecking) return false;
    if (!value.trim()) return false;

    setQrChecking(true);
    let ok = false;
    try {
      ok = await onValidateQr(value);
    } finally {
      setQrChecking(false);
    }

    if (ok) {
      setQrValue("");
      setScannerOpen(false);
    }

    return ok;
  }

  return (
    <div className={`${compact ? "mb-3" : "mt-4"} rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3`}>
      <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
        Scanner QR invite promoteur
      </p>
      <p className="mb-2 text-[11px] text-white/45">
        Colle le lien QR ou le token unique recu par le client. La validation ajoute automatiquement +1 entree et bloque la reutilisation du QR.
      </p>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => setScannerOpen((current) => !current)}
          disabled={qrChecking}
          className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white"
        >
          {scannerOpen ? "Fermer camera" : "Scanner camera"}
        </button>
        <button
          onClick={() => submitQr(qrValue)}
          disabled={qrChecking}
          className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {qrChecking ? "Validation..." : "Valider manuel"}
        </button>
      </div>

      {scannerOpen && (
        <QrCameraScanner
          onScan={(value) => {
            return submitQr(value);
          }}
        />
      )}

      <div className="grid grid-cols-[1fr_88px] gap-2">
        <input
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
          placeholder="Coller lien QR ou token"
          value={qrValue}
          disabled={qrChecking}
          onChange={(event) => setQrValue(event.target.value)}
        />
        <button
          onClick={() => submitQr(qrValue)}
          disabled={qrChecking}
          className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {qrChecking ? "..." : "Valider"}
        </button>
      </div>
    </div>
  );
}

function QrCameraScanner({ onScan }: { onScan: (value: string) => Promise<boolean> }) {
  const reactId = useId();
  const readerId = `club-one-qr-reader-${reactId.replace(/:/g, "")}`;
  const [error, setError] = useState("");

  useEffect(() => {
    let scanner: Html5Qrcode | null = null;
    let alreadyScanned = false;

    async function startScanner() {
      try {
        scanner = new Html5Qrcode(readerId);
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async (decodedText) => {
            if (alreadyScanned) return;
            alreadyScanned = true;
            const ok = await onScan(decodedText);
            if (!ok) {
              alreadyScanned = false;
              return;
            }
            try {
              await scanner?.stop();
              scanner?.clear();
            } catch {
              // Camera may already be stopped after a successful scan.
            }
          },
          () => {}
        );
      } catch (err) {
        console.error("QR camera error:", err);
        setError("Camera indisponible. Autorise la camera ou colle le lien QR manuellement.");
      }
    }

    startScanner();

    return () => {
      alreadyScanned = true;
      if (scanner?.isScanning) {
        scanner
          .stop()
          .then(() => scanner?.clear())
          .catch(() => {});
      }
    };
  }, [readerId, onScan]);

  return (
    <div className="mb-3 rounded-2xl border border-white/10 bg-black/50 p-2">
      <div id={readerId} className="overflow-hidden rounded-xl" />
      {error && <p className="mt-2 text-xs font-bold text-red-300">{error}</p>}
    </div>
  );
}
