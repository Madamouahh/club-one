// scripts/seed-auth-users.mjs
// Phase 0b - cree les comptes Supabase Auth du staff et relie staff_users.auth_id.
// A lancer manuellement par le fondateur, jamais en CI publique.
//
// Prerequis :
//   1. Appliquer 0003_phase0b_identity_and_rls.sql pour ajouter staff_users.auth_id.
//   2. Copier scripts/staff-passwords.example.json vers scripts/staff-passwords.local.json.
//   3. Remplir un nouveau mot de passe fort par compte staff.
//   4. Lancer avec des variables explicites dans PowerShell :
//        $env:SUPABASE_URL="https://TON-PROJET.supabase.co"
//        $env:SUPABASE_SERVICE_ROLE_KEY="CLE_SERVICE_ROLE"
//        node .\scripts\seed-auth-users.mjs
//        Remove-Item Env:SUPABASE_URL
//        Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
//
// Par defaut, un compte Auth existant garde son mot de passe.
// Ajouter --reset-existing-passwords pour forcer la rotation des comptes existants.

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = "clubone.local";
const PASSWORDS_PATH = "scripts/staff-passwords.local.json";
const RESET_EXISTING_PASSWORDS = process.argv.includes("--reset-existing-passwords");

function fail(message) {
  console.error(`ERREUR: ${message}`);
  process.exit(1);
}

if (!URL) fail("SUPABASE_URL manquante.");
if (!SERVICE_KEY) fail("SUPABASE_SERVICE_ROLE_KEY manquante.");

try {
  new URL(URL);
} catch {
  fail("SUPABASE_URL invalide.");
}

try {
  execFileSync("git", ["check-ignore", "-q", PASSWORDS_PATH], { stdio: "ignore" });
} catch {
  fail(`${PASSWORDS_PATH} doit etre ignore par Git avant de continuer.`);
}

let passwordFileRaw;
let passwordsRaw;
try {
  passwordFileRaw = readFileSync(new URL("./staff-passwords.local.json", import.meta.url), "utf8");
  passwordsRaw = JSON.parse(passwordFileRaw);
} catch {
  fail(`${PASSWORDS_PATH} introuvable ou invalide.`);
}

if (!passwordsRaw || typeof passwordsRaw !== "object" || Array.isArray(passwordsRaw)) {
  fail(`${PASSWORDS_PATH} doit contenir un objet JSON.`);
}

const rawTopLevelKeys = [...passwordFileRaw.matchAll(/^\s*"([^"]+)"\s*:/gm)]
  .map((match) => match[1].trim().toLowerCase())
  .filter((username) => !username.startsWith("_"));
const duplicateRawKeys = rawTopLevelKeys.filter(
  (username, index) => rawTopLevelKeys.indexOf(username) !== index,
);
if (duplicateRawKeys.length > 0) {
  fail(`username duplique dans ${PASSWORDS_PATH}: ${[...new Set(duplicateRawKeys)].join(", ")}`);
}

const passwordEntries = Object.entries(passwordsRaw)
  .filter(([username]) => !username.startsWith("_"))
  .map(([username, password]) => [username.trim().toLowerCase(), password]);

const passwordUsernames = passwordEntries.map(([username]) => username);
const duplicatePasswordUsernames = passwordUsernames.filter(
  (username, index) => passwordUsernames.indexOf(username) !== index,
);
if (duplicatePasswordUsernames.length > 0) {
  fail(`username duplique dans ${PASSWORDS_PATH}: ${[...new Set(duplicatePasswordUsernames)].join(", ")}`);
}

for (const [username, password] of passwordEntries) {
  if (!username) fail(`username vide dans ${PASSWORDS_PATH}.`);
  if (typeof password !== "string" || password.trim().length < 12 || password === "REMPLACER") {
    fail(`mot de passe local invalide pour ${username}.`);
  }
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  return users;
}

function expectedEmail(username) {
  return `${username}@${DOMAIN}`;
}

async function run() {
  const { data: staff, error } = await admin
    .from("staff_users")
    .select("id, username, role, full_name, auth_id");

  if (error) {
    fail(
      "lecture staff_users impossible. Verifier que la table existe et que 0003 a ajoute la colonne auth_id.",
    );
  }

  if (!staff || staff.length === 0) fail("aucun compte staff trouve dans staff_users.");

  const staffByUsername = new Map();
  const staffByAuthId = new Map();
  for (const row of staff) {
    const username = String(row.username || "").trim().toLowerCase();
    if (!username) fail("un compte staff possede un username vide.");
    if (staffByUsername.has(username)) fail(`username staff duplique: ${username}`);
    staffByUsername.set(username, row);

    if (row.auth_id) {
      if (staffByAuthId.has(row.auth_id)) fail(`auth_id staff duplique detecte pour ${username}.`);
      staffByAuthId.set(row.auth_id, row);
    }
  }

  for (const username of staffByUsername.keys()) {
    if (!passwordUsernames.includes(username)) {
      fail(`mot de passe local manquant pour ${username}.`);
    }
  }

  for (const username of passwordUsernames) {
    if (!staffByUsername.has(username)) {
      fail(`mot de passe local fourni pour un compte staff inexistant: ${username}.`);
    }
  }

  const emails = [...staffByUsername.keys()].map(expectedEmail);
  const duplicateEmails = emails.filter((email, index) => emails.indexOf(email) !== index);
  if (duplicateEmails.length > 0) {
    fail(`email synthetique duplique: ${[...new Set(duplicateEmails)].join(", ")}`);
  }

  const authUsers = await listAllAuthUsers();
  const authByEmail = new Map();
  const authById = new Map();
  for (const user of authUsers) {
    authById.set(user.id, user);
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) continue;
    if (authByEmail.has(email)) fail(`email Auth duplique detecte: ${email}`);
    authByEmail.set(email, user);
  }

  let created = 0;
  let existing = 0;
  let linked = 0;
  let repaired = 0;
  let failed = 0;
  const createdButUnlinked = [];

  for (const [username, password] of passwordEntries) {
    const row = staffByUsername.get(username);
    const email = expectedEmail(username);

    try {
      let user = authByEmail.get(email) || null;

      if (row.auth_id) {
        const linkedUser = authById.get(row.auth_id);
        if (!linkedUser) {
          throw new Error(`auth_id existant sans utilisateur Auth correspondant pour ${username}`);
        }
        const linkedEmail = String(linkedUser.email || "").trim().toLowerCase();
        if (linkedEmail !== email) {
          throw new Error(`auth_id de ${username} pointe vers un email Auth inattendu`);
        }
        user = linkedUser;
      }

      if (user) {
        const linkedStaff = staffByAuthId.get(user.id);
        if (linkedStaff && String(linkedStaff.username).toLowerCase() !== username) {
          throw new Error(`email Auth deja lie a un autre compte staff`);
        }

        existing++;
        if (RESET_EXISTING_PASSWORDS) {
          const updated = await admin.auth.admin.updateUserById(user.id, {
            password,
            email_confirm: true,
            user_metadata: { username, full_name: row.full_name, role: row.role },
          });
          if (updated.error) throw updated.error;
        }
      } else {
        const createdUser = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { username, full_name: row.full_name, role: row.role },
        });
        if (createdUser.error) throw createdUser.error;
        user = createdUser.data.user;
        authByEmail.set(email, user);
        authById.set(user.id, user);
        created++;
      }

      if (row.auth_id === user.id) {
        linked++;
        continue;
      }

      const link = await admin.from("staff_users").update({ auth_id: user.id }).eq("id", row.id);
      if (link.error) {
        if (!row.auth_id) createdButUnlinked.push(username);
        throw link.error;
      }

      if (row.auth_id) repaired++;
      else linked++;
    } catch (error) {
      failed++;
      console.error(`FAIL ${username}: ${error.message || error}`);
    }
  }

  console.log("\nBilan Phase 0b Auth seed");
  console.log(`crees=${created}`);
  console.log(`deja_existants=${existing}`);
  console.log(`lies=${linked}`);
  console.log(`liens_repares=${repaired}`);
  console.log(`erreurs=${failed}`);
  console.log(`crees_non_lies=${createdButUnlinked.length}`);
  if (createdButUnlinked.length > 0) {
    console.log(`crees_non_lies_usernames=${createdButUnlinked.join(",")}`);
  }

  if (failed > 0) process.exit(1);
}

run().catch((error) => fail(error.message || String(error)));
