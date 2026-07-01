#!/usr/bin/env node
// PreToolUse guard for Club One. Reads the Claude Code hook JSON payload from
// stdin. Exit code 2 blocks the tool call (Claude Code shows stderr to the
// model as the block reason) - this is the stable, documented hook contract.
// Exit code 0 allows the call.
//
// Scope: only inspects Bash tool_input.command. All other tools are allowed.
// This is a text-pattern guard, not a sandbox: it catches the documented
// dangerous command shapes, not every possible obfuscation.

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

const HARD_BLOCKS = [
  {
    test: /git\s+push\b[^\n]*\borigin\/?\s+main\b/i,
    reason: "Push vers main interdit (voir .claude/rules/10-git-safety.md).",
  },
  {
    test: /git\s+push\b[^\n]*(?:^|\s):main\b/i,
    reason: "Push vers main interdit (refspec :main).",
  },
  {
    test: /git\s+push\b[^\n]*\s(--force|-f)\b/i,
    reason: "Force push interdit sans ordre explicite hors de ce garde-fou.",
  },
  {
    test: /git\s+(checkout|switch)\s+(-b\s+\S+\s+)?main\b/i,
    reason: "Checkout direct de main interdit sans demande explicite.",
  },
  {
    test: /git\s+merge\b[^\n]*\bmain\b/i,
    reason: "Fusion dans/depuis main interdite sans validation explicite.",
  },
  {
    test: /supabase\s+db\s+push/i,
    reason: "supabase db push est interdit en phase d'audit/gouvernance.",
  },
  {
    test: /supabase\s+migration\s+up/i,
    reason: "supabase migration up est interdit en phase d'audit/gouvernance.",
  },
  {
    test: /supabase\s+link/i,
    reason: "supabase link est interdit sans GO explicite.",
  },
  {
    test: /(psql|supabase\s+db\s+execute)[^\n]*(0008_event_scope_preparation|0009_phase0b_rls_cutover)/i,
    reason: "Execution directe de 0008/0009 interdite sans GO explicite et base non-production.",
  },
  {
    test: /staff-passwords\.local\.json/i,
    reason: "Lecture/affichage de scripts/staff-passwords.local.json interdit.",
  },
  {
    test: /(cat|type|more|less|Get-Content|gc)\s+[^\n]*\.env(\.|"|'|\s|$)/i,
    reason: "Lecture de fichier .env interdite.",
  },
  {
    test: /(service_role|sb_secret)/i,
    reason: "Reference a un secret Supabase (service_role/sb_secret) detectee - commande bloquee par prudence.",
  },
];

const SOFT_BLOCK_UNLESS_OVERRIDE = [
  {
    test: /git\s+push\b/i,
    reason:
      "git push sans GO explicite. Definir ALLOW_GIT_PUSH=1 dans l'environnement de la commande pour confirmer un GO deja obtenu de l'utilisateur.",
    override: () => process.env.ALLOW_GIT_PUSH === "1",
  },
];

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  if (payload.tool_name !== "Bash") process.exit(0);

  const command = String((payload.tool_input && payload.tool_input.command) || "");
  if (!command) process.exit(0);

  for (const rule of HARD_BLOCKS) {
    if (rule.test.test(command)) {
      process.stderr.write(`[club-one guard] BLOQUE: ${rule.reason}\ncommande: ${command}\n`);
      process.exit(2);
    }
  }

  for (const rule of SOFT_BLOCK_UNLESS_OVERRIDE) {
    if (rule.test.test(command) && !rule.override()) {
      process.stderr.write(`[club-one guard] BLOQUE: ${rule.reason}\ncommande: ${command}\n`);
      process.exit(2);
    }
  }

  process.exit(0);
}

main();
