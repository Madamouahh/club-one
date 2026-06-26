// scripts/seed-auth-users.mjs
// Phase 0b — crée/maj les comptes Supabase Auth du staff et relie staff_users.auth_id.
// À LANCER PAR LE FONDATEUR (jamais en CI public) car il faut la clé service_role.
//
// Prérequis :
//   1. Remplir scripts/staff-passwords.local.json (gitignoré) : { "maxime": "<nouveau mdp fort>", ... }
//      -> profite-en pour ROTER les mots de passe compromis.
//   2. Lancer :
//        SUPABASE_URL="https://xsotmjnaffaibgqgookt.supabase.co" \
//        SUPABASE_SERVICE_ROLE_KEY="<clé service_role>" \
//        node scripts/seed-auth-users.mjs
//
// Idempotent : relançable sans danger (crée si absent, sinon met à jour le mot de passe).
// N'imprime jamais les mots de passe.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const URL = process.env.SUPABASE_URL || "https://xsotmjnaffaibgqgookt.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = "clubone.local"; // email synthétique : <username>@clubone.local

if (!SERVICE_KEY) {
  console.error("ERREUR: SUPABASE_SERVICE_ROLE_KEY manquante.");
  process.exit(1);
}

let passwords;
try {
  passwords = JSON.parse(readFileSync(new URL("./staff-passwords.local.json", import.meta.url)));
} catch {
  console.error("ERREUR: scripts/staff-passwords.local.json introuvable ou invalide.");
  console.error('Format attendu : { "maxime": "NouveauMotDePasse", "jerome": "..." }');
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  // ~10 comptes : une page suffit largement.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function run() {
  // Récupère les profils staff (service_role => bypass RLS).
  const { data: staff, error } = await admin
    .from("staff_users")
    .select("id, username, role, full_name, auth_id");
  if (error) {
    console.error("ERREUR lecture staff_users:", error.message);
    process.exit(1);
  }

  const byUsername = new Map(staff.map((s) => [String(s.username).toLowerCase(), s]));
  let ok = 0, skipped = 0, failed = 0;

  for (const [usernameRaw, password] of Object.entries(passwords)) {
    const username = usernameRaw.trim().toLowerCase();
    const row = byUsername.get(username);
    if (!row) {
      console.warn(`SKIP ${username}: aucun staff_users.username correspondant.`);
      skipped++;
      continue;
    }
    const email = `${username}@${DOMAIN}`;

    try {
      let userId;
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: row.full_name, role: row.role },
      });

      if (created.error) {
        // Existe déjà -> retrouver l'id et mettre à jour le mot de passe.
        const existing = await findUserByEmail(email);
        if (!existing) throw created.error;
        const upd = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
        if (upd.error) throw upd.error;
        userId = existing.id;
        console.log(`MAJ  ${username} -> mot de passe réinitialisé`);
      } else {
        userId = created.data.user.id;
        console.log(`NEW  ${username} -> compte Auth créé`);
      }

      const link = await admin.from("staff_users").update({ auth_id: userId }).eq("id", row.id);
      if (link.error) throw link.error;
      ok++;
    } catch (e) {
      console.error(`FAIL ${username}: ${e.message || e}`);
      failed++;
    }
  }

  console.log(`\nTerminé. OK=${ok}  SKIP=${skipped}  FAIL=${failed}`);
  if (failed > 0) process.exit(1);
}

run();
