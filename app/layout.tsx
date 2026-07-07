import type { Metadata } from "next";
import "./globals.css";
import PwaRegister from "@/app/_components/PwaRegister";

// Le manifest est servi par app/manifest.ts (/manifest.webmanifest, lien auto-injecté par Next 16).
export const metadata: Metadata = {
  title: "Club One",
  description: "Club One VIP Management",

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
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}