"use client";

// app/_components/PwaRegister.tsx — Enregistre le service worker, surface un prompt
// "mise à jour disponible" et un indicateur hors-ligne / reconnexion.
// Monté une seule fois par l'intégrateur dans app/layout.tsx (voir docs/PWA_NOTES.md).
// Toute la logique pure (machine à états connexion) vit dans lib/pwa.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  nextConnectionStatus,
  shouldShowConnectionBanner,
  type ConnectionStatus,
} from "@/lib/pwa";

export default function PwaRegister() {
  const [connection, setConnection] = useState<ConnectionStatus>("online");
  const [updateReady, setUpdateReady] = useState(false);
  const waitingWorker = useRef<ServiceWorker | null>(null);

  // Vérifie une connectivité réelle (navigator.onLine peut mentir) puis fait avancer la machine.
  const probeReconnect = useCallback(async () => {
    try {
      const res = await fetch("/manifest.webmanifest", {
        method: "HEAD",
        cache: "no-store",
      });
      setConnection((s) =>
        nextConnectionStatus(s, res.ok ? "reconnect-confirmed" : "reconnect-failed"),
      );
    } catch {
      setConnection((s) => nextConnectionStatus(s, "reconnect-failed"));
    }
  }, []);

  // 1) Enregistrement du service worker + détection d'une mise à jour en attente.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const markWaiting = (worker: ServiceWorker | null) => {
      if (!worker) return;
      waitingWorker.current = worker;
      setUpdateReady(true);
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          markWaiting(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // Nouveau SW installé alors qu'un contrôleur existe déjà = mise à jour prête.
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              markWaiting(registration.waiting || installing);
            }
          });
        });
      })
      .catch(() => {
        /* enregistrement best-effort : l'app fonctionne sans SW */
      });

    // Recharge une seule fois quand le nouveau SW prend le contrôle.
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  // 2) État de connexion (offline / reconnexion vérifiée).
  useEffect(() => {
    if (typeof window === "undefined") return;

    setConnection(navigator.onLine ? "online" : "offline");

    const handleOffline = () =>
      setConnection((s) => nextConnectionStatus(s, "offline"));
    const handleOnline = () => {
      setConnection((s) => nextConnectionStatus(s, "online"));
      void probeReconnect();
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [probeReconnect]);

  const applyUpdate = useCallback(() => {
    const worker = waitingWorker.current;
    if (!worker) {
      window.location.reload();
      return;
    }
    worker.postMessage({ type: "SKIP_WAITING" });
    setUpdateReady(false);
    // controllerchange déclenchera le reload.
  }, []);

  const showConnection = shouldShowConnectionBanner(connection);

  if (!updateReady && !showConnection) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        pointerEvents: "none",
      }}
    >
      {showConnection && (
        <div
          role="status"
          style={{
            pointerEvents: "auto",
            margin: "0 auto",
            maxWidth: 420,
            width: "100%",
            padding: "10px 14px",
            borderRadius: 10,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            background: connection === "offline" ? "#3b0d0d" : "#3b2a0d",
            color: "#ededed",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {connection === "offline"
            ? "Hors ligne — les données affichées peuvent être obsolètes."
            : "Reconnexion en cours…"}
        </div>
      )}

      {updateReady && (
        <div
          role="alert"
          style={{
            pointerEvents: "auto",
            margin: "0 auto",
            maxWidth: 420,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            borderRadius: 10,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            background: "#111827",
            color: "#ededed",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <span>Une nouvelle version est disponible.</span>
          <button
            type="button"
            onClick={applyUpdate}
            style={{
              cursor: "pointer",
              flexShrink: 0,
              padding: "6px 12px",
              borderRadius: 8,
              border: "none",
              background: "#ededed",
              color: "#0a0a0a",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Mettre à jour
          </button>
        </div>
      )}
    </div>
  );
}
