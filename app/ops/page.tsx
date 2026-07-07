"use client";

// /ops — surface d'exploitation live. Session/profil fiables via le socle Auth partagé (garde de route).
// Contenu opérationnel complet (bottom-nav ≤5, modules) = Choix 1 (surfaces autonomes). Ici : bootstrap auth.
import { AuthProvider, RequireAuth } from "@/app/_components/StaffAuth";
import { SurfaceStub } from "@/app/_components/SurfaceStub";
import type { StaffRole } from "@/lib/permissions";

// /ops ouvert à tous les rôles opérationnels (le promoteur y a son périmètre tables ; la RLS cadre).
const OPS_ROLES: readonly StaffRole[] = ["admin", "manager", "server", "security", "security_counter", "promoter"];

export default function OpsRoute() {
  return (
    <AuthProvider>
      <RequireAuth allow={OPS_ROLES}>
        <SurfaceStub surface="ops" accent="#f5495b" />
      </RequireAuth>
    </AuthProvider>
  );
}
