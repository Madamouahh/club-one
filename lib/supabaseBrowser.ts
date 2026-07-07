// lib/supabaseBrowser.ts — CLIENT SUPABASE NAVIGATEUR UNIQUE (singleton) partagé par TOUTES les surfaces
// staff (/, /staff, /ops, /dashboard). Un seul GoTrueClient → une seule session persistée, lue de façon
// cohérente au chargement direct d'une route, au refresh et sur lien profond. Élimine le cas « Multiple
// GoTrueClient instances » (deux clients concurrents sur la même clé de stockage) qui rendait getSession()
// non fiable quand le gros module monolithe était monté sur une route secondaire.
//
// - storageKey EXPLICITE et stable (indépendant de la dérivation par host, source d'incohérence en Preview).
// - persistSession + autoRefreshToken : la session survit au refresh et se renouvelle.
// - garde globalThis : une seule instance par contexte navigateur, même si plusieurs modules l'importent.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export const STAFF_AUTH_STORAGE_KEY = "club-one-staff-auth";

const globalRef = globalThis as unknown as { __clubOneSupabase?: SupabaseClient };

export const supabaseBrowser: SupabaseClient =
  globalRef.__clubOneSupabase ??
  (globalRef.__clubOneSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: STAFF_AUTH_STORAGE_KEY,
    },
  }));
