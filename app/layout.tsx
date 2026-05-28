import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Club One",
  description: "Club One VIP Management",

  manifest: "/manifest.json",

  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Club One",
  },

  icons: {
    icon: "/icon-192.png",
    apple: "/icon-180.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}