import type { MetadataRoute } from "next";

// app/manifest.ts — Web App Manifest idiomatique Next 16 (App Router).
// Sert /manifest.webmanifest et injecte automatiquement <link rel="manifest">.
// Couleurs alignées sur le thème sombre de l'app (app/globals.css : --background #0a0a0a).
// Icônes : réutilise les fichiers existants de public/ (voir docs/PWA_NOTES.md pour les manques).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Club One",
    short_name: "Club One",
    description: "Club One — gestion de soirées (plan de tables, flux, promoteurs, sécurité).",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    lang: "fr",
    dir: "ltr",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
