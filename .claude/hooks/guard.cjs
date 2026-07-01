#!/usr/bin/env node
// PreToolUse guard for Club One. Reads the Claude Code hook JSON payload from
// stdin. Exit code 2 blocks the tool call (Claude Code shows stderr to the
// model as the block reason) - this is the documented hook contract used
// throughout this harness (see .claude/rules/40-testing-and-proof.md on what
// "confirmed" vs "deduced" means for this mechanism).
// Exit code 0 allows the call.
//
// Scope: only inspects Bash tool_input.command. All other tools are allowed.
// This is a text-pattern guard, not a sandbox: it catches the documented
// dangerous command shapes, not every possible obfuscation.
//
// Hard rule: git push is NEVER allowed from here, unconditionally. There is
// no environment variable, argument, or file that lifts this block. Pushing
// is a manual action the user performs outside Claude Code after an explicit
// GO. See CLAUDE.md "Claude Code ne pousse jamais."

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function isEnvExampleRead(command) {
  return /\.env[.\w-]*\.example\b/i.test(command);
}

const HARD_BLOCKS = [
  {
    test: (c) => /git(\.exe)?\s+push\b[^\n]*\borigin\/?\s+main\b/i.test(c),
    reason: "Push vers main interdit (voir .claude/rules/10-git-safety.md).",
  },
  {
    test: (c) => /git(\.exe)?\s+push\b[^\n]*(?:^|\s):main\b/i.test(c),
    reason: "Push vers main interdit (refspec :main).",
  },
  {
    test: (c) => /git(\.exe)?\s+push\b[^\n]*\s(--force|-f)\b/i.test(c),
    reason: "Force push interdit.",
  },
  {
    test: (c) => /git(\.exe)?\s+(checkout|switch)\s+(-b\s+\S+\s+)?main\b/i.test(c),
    reason: "Checkout direct de main interdit sans demande explicite.",
  },
  {
    test: (c) => /git(\.exe)?\s+merge\b[^\n]*\bmain\b/i.test(c),
    reason: "Fusion dans/depuis main interdite sans validation explicite.",
  },
  {
    // Any remaining git push, on any branch, with any argument combination.
    // Deliberately unconditional: no env var, flag, or file can bypass this.
    // Claude Code never pushes; the user pushes manually after GO.
    test: (c) => /git(\.exe)?\s+push\b/i.test(c),
    reason:
      "git push est interdit depuis Claude Code, sans exception. Le push est une operation manuelle de l'utilisateur, hors Claude Code, apres validation explicite.",
  },
  {
    test: (c) => /supabase(\.exe)?\s+db\s+push/i.test(c),
    reason: "supabase db push est interdit en phase d'audit/gouvernance.",
  },
  {
    test: (c) => /supabase(\.exe)?\s+migration\s+up/i.test(c),
    reason: "supabase migration up est interdit en phase d'audit/gouvernance.",
  },
  {
    test: (c) => /supabase(\.exe)?\s+link/i.test(c),
    reason: "supabase link est interdit sans GO explicite.",
  },
  {
    test: (c) =>
      /(psql|supabase(\.exe)?\s+db\s+execute)[^\n]*(0008_event_scope_preparation|0009_phase0b_rls_cutover)/i.test(c),
    reason: "Execution directe de 0008/0009 interdite sans GO explicite et base non-production.",
  },
  {
    test: (c) => /staff-passwords\.local\.json/i.test(c),
    reason: "Lecture/affichage de scripts/staff-passwords.local.json interdit.",
  },
  {
    test: (c) => {
      if (isEnvExampleRead(c)) return false; // .env.local.example is the committed template, not a secret.
      return /(cat|type|more|less|Get-Content|gc)\s+[^\n]*\.env(\.|"|'|\s|$)/i.test(c);
    },
    reason: "Lecture de fichier .env interdite.",
  },
  {
    test: (c) => /(service_role|sb_secret)/i.test(c),
    reason: "Reference a un secret Supabase (service_role/sb_secret) detectee - commande bloquee par prudence.",
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
    if (rule.test(command)) {
      process.stderr.write(`[club-one guard] BLOQUE: ${rule.reason}\ncommande: ${command}\n`);
      process.exit(2);
    }
  }

  process.exit(0);
}

main();
