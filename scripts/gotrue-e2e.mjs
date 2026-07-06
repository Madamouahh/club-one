// scripts/gotrue-e2e.mjs — PREUVE NIVEAU 5 : parcours GoTrue RÉEL sur le clone non-prod.
//
// Pour CHAQUE rôle : signInWithPassword (email <username>@clubone.local, comme le front) → JWT émis
// par GoTrue → rôle résolu via rpc('get_my_profile') → requête RLS-gated avec le JWT RÉEL (PostgREST)
// → refresh token → logout. Aucune impersonation : c'est le vrai chemin d'auth de production.
//
// Usage : SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/gotrue-e2e.mjs
// (clé anon = clé publique, pas un secret ; jamais service_role ici.)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const PW = process.env.E2E_PASSWORD || "Rehearsal!2026";
if (!URL || !ANON) { console.error("SUPABASE_URL / SUPABASE_ANON_KEY requis"); process.exit(2); }

const ROLES = [
  { username: "admin",     role: "admin" },
  { username: "manager",   role: "manager" },
  { username: "promoter1", role: "promoter" },
  { username: "security",  role: "security" },
  { username: "counter",   role: "security_counter" },
  { username: "jeremy",    role: "server" },
];

function decodeJwt(tok) {
  try { return JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()); }
  catch { return {}; }
}

let failures = 0;
const rows = [];

for (const r of ROLES) {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `${r.username}@clubone.local`;
  const line = { username: r.username, expectedRole: r.role };
  try {
    // 1) LOGIN RÉEL
    const { data: signIn, error: signErr } = await c.auth.signInWithPassword({ email, password: PW });
    if (signErr || !signIn?.session) { line.login = "FAIL"; line.err = signErr?.message || "no session"; failures++; rows.push(line); continue; }
    line.login = "OK";

    // 2) JWT émis par GoTrue
    const jwt = signIn.session.access_token;
    const claims = decodeJwt(jwt);
    line.jwt = jwt ? "OK" : "FAIL";
    line.jwtSub = claims.sub === r.username ? claims.sub : (claims.sub || "?");
    line.jwtRole = claims.role; // 'authenticated' (rôle Postgres), pas le rôle métier
    line.hasRefresh = signIn.session.refresh_token ? "OK" : "FAIL";
    if (!jwt || claims.role !== "authenticated") failures++;

    // 3) RÔLE MÉTIER résolu via get_my_profile (RLS/SECDEF, JWT réel)
    const { data: prof, error: profErr } = await c.rpc("get_my_profile");
    const p = Array.isArray(prof) ? prof[0] : prof;
    line.resolvedRole = p?.role ?? (profErr ? `ERR:${profErr.message}` : "null");
    if (p?.role !== r.role) { line.roleMatch = "DIFF"; failures++; } else line.roleMatch = "OK";

    // 4) RLS avec JWT RÉEL (PostgREST) — visibilité club_tables + snapshot sécurité
    const { count: ctCount, error: ctErr } = await c.from("club_tables").select("*", { count: "exact", head: true });
    line.clubTables = ctErr ? `ERR:${ctErr.code || ctErr.message}` : ctCount;
    const { data: snap, error: snapErr } = await c.rpc("get_security_table_snapshot");
    line.secSnapshot = snapErr ? `ERR` : (Array.isArray(snap) ? snap.length : 0);

    // 5) REFRESH TOKEN
    const { data: refreshed, error: refErr } = await c.auth.refreshSession();
    line.refresh = (!refErr && refreshed?.session?.access_token) ? "OK" : "FAIL";
    if (refErr || !refreshed?.session?.access_token) failures++;

    // 6) LOGOUT
    const { error: outErr } = await c.auth.signOut();
    const { data: after } = await c.auth.getSession();
    line.logout = (!outErr && !after?.session) ? "OK" : "FAIL";
    if (outErr || after?.session) failures++;
  } catch (e) {
    line.fatal = String(e?.message || e); failures++;
  }
  rows.push(line);
}

console.log(JSON.stringify({ ok: failures === 0, failures, rows }, null, 2));
process.exit(failures === 0 ? 0 : 1);
