"use client";

// app/_components/StaffAuth.tsx — SOCLE D'AUTHENTIFICATION STAFF PARTAGÉ (toutes surfaces).
//
// Résout la cause racine du bootstrap : au chargement direct d'une route (/staff, /ops, /dashboard) ou
// au refresh, getSession() pouvait renvoyer null avant l'hydratation du client → RPC en anon → flash login.
// Ici on s'appuie sur le SIGNAL FIABLE de supabase-js : onAuthStateChange émet INITIAL_SESSION avec la
// session persistée dès que le client est hydraté. On reste en état `loading` jusqu'à ce signal (aucun
// flash vers login), puis on récupère le profil via get_my_profile. Client singleton (supabaseBrowser).
//
// - status : 'loading' | 'authenticated' | 'unauthenticated' (jamais de flash : loading tant qu'indécis) ;
// - deep link / refresh : la session est restaurée par onAuthStateChange + getSession (chemin rapide) ;
// - expiration/renouvellement : autoRefreshToken + événements TOKEN_REFRESHED/SIGNED_OUT gérés ;
// - signIn/signOut ; garde de rôle par surface ; redirection selon rôle.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import type { StaffProfile } from "@/lib/authSession";
import type { StaffRole } from "@/lib/permissions";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  profile: StaffProfile | null;
  signIn: (username: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function firstProfile(data: unknown): StaffProfile | null {
  if (Array.isArray(data)) return (data[0] as StaffProfile) ?? null;
  return (data as StaffProfile) ?? null;
}

async function fetchProfile(): Promise<StaffProfile | null> {
  const { data, error } = await supabase.rpc("get_my_profile");
  if (error) return null;
  return firstProfile(data);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const settledRef = useRef(false);

  const resolveFromSession = useCallback(async (hasSession: boolean) => {
    if (!hasSession) {
      setProfile(null);
      setStatus("unauthenticated");
      settledRef.current = true;
      return;
    }
    const p = await fetchProfile();
    if (p) {
      setProfile(p);
      setStatus("authenticated");
    } else {
      // Session présente mais profil introuvable (compte non lié) → non authentifié explicite.
      setProfile(null);
      setStatus("unauthenticated");
    }
    settledRef.current = true;
  }, []);

  useEffect(() => {
    let mounted = true;

    // Chemin rapide : si la session est déjà hydratée, on résout immédiatement.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted || settledRef.current) return;
      if (data.session) void resolveFromSession(true);
    });

    // Signal AUTORITAIRE : INITIAL_SESSION (+ SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT) porte la session
    // persistée dès l'hydratation → restauration fiable au chargement direct / refresh / lien profond.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setStatus("unauthenticated");
        settledRef.current = true;
        return;
      }
      void resolveFromSession(!!session);
    });

    // Filet de sécurité : si aucun événement n'arrive (cas dégénéré), on tranche « non authentifié »
    // après un court délai plutôt que de rester bloqué en loading.
    const t = setTimeout(() => {
      if (mounted && !settledRef.current) {
        setStatus("unauthenticated");
      }
    }, 4000);

    return () => {
      mounted = false;
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, [resolveFromSession]);

  const signIn = useCallback(async (username: string, password: string) => {
    const email = `${username.trim().toLowerCase()}@clubone.local`;
    const { error } = await supabase.auth.signInWithPassword({ email, password: password.trim() });
    if (error) return { ok: false, message: "Identifiant ou code incorrect." };
    await resolveFromSession(true);
    return { ok: true };
  }, [resolveFromSession]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(() => ({ status, profile, signIn, signOut }), [status, profile, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}

// Surface d'accueil recommandée par rôle (redirection depuis « / »). L'appareil n'est jamais une permission.
export function defaultSurfaceForRole(role: StaffRole): string {
  if (role === "admin" || role === "manager") return "/dashboard";
  return "/staff";
}

const screenBase = "grid min-h-screen place-items-center bg-black p-6 text-white";
const cardBase = "w-full max-w-sm rounded-3xl border border-white/10 bg-[#0b0b0d] p-6";
const inputBase = "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-orange-500/50";

// Carte de connexion (via le provider). Affichée par la garde quand non authentifié.
export function LoginCard() {
  const { signIn } = useAuth();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const r = await signIn(user, pass);
    setBusy(false);
    if (!r.ok) setErr(r.message || "Connexion impossible.");
  }

  return (
    <main className={screenBase} data-testid="auth-login">
      <section className={cardBase}>
        <h1 className="text-2xl font-light tracking-[0.3em]">CLUB <span className="text-orange-500">O</span>NE</h1>
        <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/40">Connexion staff</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input aria-label="Identifiant" data-testid="auth-user" value={user}
            onChange={(e) => setUser(e.target.value)} placeholder="Identifiant" className={inputBase} autoComplete="username" />
          <input aria-label="Code" data-testid="auth-pass" type="password" value={pass}
            onChange={(e) => setPass(e.target.value)} placeholder="Code" className={inputBase} autoComplete="current-password" />
          {err ? <p className="text-sm text-red-300" role="alert" data-testid="auth-error">{err}</p> : null}
          <button type="submit" disabled={busy || !user || !pass} data-testid="auth-submit"
            className="w-full rounded-2xl bg-orange-500 px-4 py-3 font-black text-black transition hover:bg-orange-400 disabled:opacity-50">
            {busy ? "Connexion…" : "Entrer"}
          </button>
        </form>
      </section>
    </main>
  );
}

// GARDE DE ROUTE réutilisable : loading (aucun flash) → login si non authentifié → refus si rôle non
// autorisé → contenu. `allow` limite l'accès à une surface par rôle (miroir UI ; la RLS reste l'autorité).
export function RequireAuth({
  allow,
  children,
}: {
  allow?: readonly StaffRole[];
  children: React.ReactNode;
}) {
  const { status, profile } = useAuth();
  const router = useRouter();

  if (status === "loading") {
    return (
      <main className={screenBase} data-testid="auth-loading">
        <p className="text-white/50">Chargement…</p>
      </main>
    );
  }
  if (status === "unauthenticated" || !profile) {
    return <LoginCard />;
  }
  if (allow && !allow.includes(profile.role)) {
    return (
      <main className={screenBase} data-testid="auth-forbidden">
        <section className={`${cardBase} text-center`}>
          <p className="font-black text-white/85">Accès non autorisé</p>
          <p className="mt-2 text-sm text-white/55">Cette surface n&apos;est pas ouverte à votre rôle ({profile.role}).</p>
          <button data-testid="auth-goto-home" onClick={() => router.replace(defaultSurfaceForRole(profile.role))}
            className="mt-4 rounded-2xl bg-orange-500 px-4 py-2 font-black text-black">
            Aller à mon espace
          </button>
        </section>
      </main>
    );
  }
  return <>{children}</>;
}
