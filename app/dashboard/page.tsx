"use client";

// /dashboard — management desktop. Réservé à la direction (garde de rôle). Session fiable via le socle
// Auth partagé. Contenu complet (sidebar 8 sections + modules) = Choix 1 (surfaces autonomes).
import { AuthProvider, RequireAuth } from "@/app/_components/StaffAuth";
import { SurfaceStub } from "@/app/_components/SurfaceStub";
import type { StaffRole } from "@/lib/permissions";

const DASHBOARD_ROLES: readonly StaffRole[] = ["admin", "manager"];

export default function DashboardRoute() {
  return (
    <AuthProvider>
      <RequireAuth allow={DASHBOARD_ROLES}>
        <SurfaceStub surface="dashboard" accent="#5b8cff" />
      </RequireAuth>
    </AuthProvider>
  );
}
