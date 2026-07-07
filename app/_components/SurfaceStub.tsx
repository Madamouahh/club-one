"use client";

// SurfaceStub — contenu MINIMAL authentifié d'une surface (preuve du bootstrap auth). Le contenu métier
// réel (nav ops/dashboard + modules) est bâti dans le Choix 1 (surfaces autonomes). Ici on prouve
// seulement que la session/profil sont fiables sur la route : profil réel affiché + bascule de surface.

import Link from "next/link";
import { useAuth, defaultSurfaceForRole } from "@/app/_components/StaffAuth";

export function SurfaceStub({ surface, accent }: { surface: string; accent: string }) {
  const { profile, signOut } = useAuth();
  if (!profile) return null;
  return (
    <main className="grid min-h-screen place-items-center bg-black p-6 text-white" data-testid={`surface-${surface}`}>
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0b0b0d] p-6">
        <p className="text-[11px] uppercase tracking-[0.24em]" style={{ color: accent }} data-testid="surface-name">
          Surface {surface}
        </p>
        <h1 className="mt-2 text-2xl font-black">Authentifié ✓</h1>
        <p className="mt-1 text-sm text-white/55" data-testid="surface-profile">
          {profile.full_name} · {profile.role} · @{profile.username}
        </p>
        <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/45">
          Coquille de surface prête — le contenu opérationnel complet est monté à l&apos;étape suivante
          (surfaces autonomes). La session, le profil et la garde de rôle sont fiables sur cette route.
        </p>
        <div className="mt-5 flex flex-wrap gap-2" data-testid="surface-switch">
          <Link href="/staff" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/70">Mon espace</Link>
          <Link href="/ops" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/70">Ops</Link>
          <Link href="/dashboard" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/70">Dashboard</Link>
          <Link href={defaultSurfaceForRole(profile.role)} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-white/70">Accueil</Link>
        </div>
        <button onClick={() => void signOut()} data-testid="surface-logout" className="mt-5 text-xs font-black text-white/35 underline">
          Se déconnecter
        </button>
      </section>
    </main>
  );
}
