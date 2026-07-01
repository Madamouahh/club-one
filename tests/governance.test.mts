import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const guardPath = join(root, ".claude", "hooks", "guard.cjs");

// Every call below only ever spawns `node guard.cjs` with a simulated JSON
// payload on stdin. No git/supabase/psql command is ever actually executed
// by this test file - the guard only ever sees the command as inert text.
function runGuard(command: string, env: Record<string, string> = {}) {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  return spawnSync(process.execPath, [guardPath], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("governance files expected by CLAUDE.md are present", () => {
  const expected = [
    "CLAUDE.md",
    ".claude/settings.json",
    ".claude/hooks/guard.cjs",
    ".claude/rules/00-governance.md",
    ".claude/rules/10-git-safety.md",
    ".claude/rules/20-security-supabase.md",
    ".claude/rules/30-cost-model-routing.md",
    ".claude/rules/40-testing-and-proof.md",
    ".claude/rules/50-club-one-domain.md",
    ".claude/agents/governor.md",
    ".claude/agents/security-architect.md",
    ".claude/agents/integrator.md",
    ".claude/agents/sql-auditor.md",
    ".claude/agents/frontend-specialist.md",
    ".claude/agents/test-auditor.md",
    ".claude/skills/audit-readonly/SKILL.md",
    ".claude/skills/migration-review/SKILL.md",
    ".claude/skills/release-gate/SKILL.md",
    ".claude/skills/incident-review/SKILL.md",
    "docs/CLAUDE_HANDOFF.md",
  ];

  for (const relativePath of expected) {
    assert.ok(existsSync(join(root, relativePath)), `missing governance file: ${relativePath}`);
  }
});

test("all @imports in CLAUDE.md resolve to existing files", () => {
  const claudeMd = readFileSync(join(root, "CLAUDE.md"), "utf8");
  const imports = [...claudeMd.matchAll(/^@(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(imports.length > 0, "expected at least one @import in CLAUDE.md");
  for (const importPath of imports) {
    assert.ok(existsSync(join(root, importPath)), `CLAUDE.md @import points to a missing file: ${importPath}`);
  }
});

test("settings.json is valid JSON and wires the Bash guard hook", () => {
  const raw = readFileSync(join(root, ".claude", "settings.json"), "utf8");
  const settings = JSON.parse(raw);
  const bashHooks = settings.hooks?.PreToolUse?.find((entry: { matcher?: string }) => entry.matcher === "Bash");
  assert.ok(bashHooks, "no PreToolUse hook wired for Bash");
  assert.match(bashHooks.hooks[0].command, /guard\.cjs/);
  assert.ok(Array.isArray(settings.permissions?.deny) && settings.permissions.deny.length > 0);
  assert.ok(
    settings.permissions.deny.some((entry: string) => /git push\*/.test(entry)),
    "permissions.deny should also deny git push as a secondary layer"
  );
});

test("guard.cjs source contains no ALLOW_GIT_PUSH or equivalent override mechanism", () => {
  const source = readFileSync(join(root, ".claude", "hooks", "guard.cjs"), "utf8");
  assert.doesNotMatch(source, /ALLOW_GIT_PUSH/);
  assert.doesNotMatch(source, /override/i);
});

test("no governance file contains a plausible secret value", () => {
  const files = ["CLAUDE.md", ".claude/settings.json", ".claude/hooks/guard.cjs", "docs/CLAUDE_HANDOFF.md"];
  const secretShapes = [/eyJ[A-Za-z0-9_-]{10,}/, /sb_secret_[A-Za-z0-9]/, /service_role"\s*:\s*"[^"]{10,}/];
  for (const relativePath of files) {
    const content = readFileSync(join(root, relativePath), "utf8");
    for (const shape of secretShapes) {
      assert.doesNotMatch(content, shape, `possible secret literal in ${relativePath}`);
    }
  }
});

// --- Allowed (must not be blocked) ---------------------------------------

test("guard allows benign local commands", () => {
  assert.equal(runGuard("node -e \"console.log('safe-hook-smoke-test')\"").status, 0);
  assert.equal(runGuard("npm run lint").status, 0);
  assert.equal(runGuard("git status -sb").status, 0);
  assert.equal(runGuard("git diff --check origin/security/auth-front..HEAD").status, 0);
  assert.equal(runGuard("git log --oneline -15").status, 0);
  assert.equal(runGuard("git show --stat --summary HEAD").status, 0);
  assert.equal(runGuard("npm run test:rls").status, 0);
});

test("guard does not block reading normal source/doc files", () => {
  assert.equal(runGuard("cat SECURITY_PHASE0B.md").status, 0);
  assert.equal(runGuard("type SECURITY_PHASE0B.md").status, 0);
  assert.equal(runGuard("cat app/page.tsx").status, 0);
});

test("guard does not false-positive on documentary mentions of Supabase", () => {
  assert.equal(runGuard("grep -rn Supabase SECURITY_PHASE0B.md").status, 0);
  assert.equal(runGuard("git log --oneline --grep=Supabase").status, 0);
});

test("guard allows reading the committed .env example template", () => {
  assert.equal(runGuard("cat .env.local.example").status, 0);
});

test("guard ignores non-Bash tools entirely", () => {
  const payload = JSON.stringify({ tool_name: "Read", tool_input: { file_path: ".env" } });
  const result = spawnSync(process.execPath, [guardPath], { input: payload, encoding: "utf8" });
  assert.equal(result.status, 0);
});

// --- Blocked (git push: unconditional, no override) -----------------------

test("guard blocks every git push shape unconditionally, with no override", () => {
  const cases = [
    "git push",
    "git push origin security/auth-front",
    "git push origin main",
    "git push --force",
    "git push --force origin security/auth-front",
    "git push -f origin main",
    "git.exe push origin main",
  ];
  for (const command of cases) {
    const result = runGuard(command);
    assert.equal(result.status, 2, `expected block for: ${command}`);
  }
});

test("ALLOW_GIT_PUSH=1 no longer overrides the push block", () => {
  const result = runGuard("git push origin security/auth-front", { ALLOW_GIT_PUSH: "1" });
  assert.equal(result.status, 2, "ALLOW_GIT_PUSH=1 must not lift the git push block");
});

test("no environment variable lifts the git push block", () => {
  const result = runGuard("git push origin security/auth-front", {
    ALLOW_GIT_PUSH: "1",
    GIT_PUSH_GO: "1",
    CLAUDE_ALLOW_PUSH: "1",
    FORCE_PUSH_OK: "true",
  });
  assert.equal(result.status, 2);
});

test("guard blocks checkout of main and merges into main", () => {
  assert.equal(runGuard("git checkout main").status, 2);
  assert.equal(runGuard("git merge main").status, 2);
});

// --- Blocked (Supabase / migrations) ---------------------------------------

test("guard blocks supabase db push, migration up, and link (with and without npx/.exe)", () => {
  assert.equal(runGuard("supabase db push").status, 2);
  assert.equal(runGuard("npx supabase db push").status, 2);
  assert.equal(runGuard("supabase.exe db push").status, 2);
  assert.equal(runGuard("supabase migration up").status, 2);
  assert.equal(runGuard("supabase link --project-ref abc123").status, 2);
});

test("guard blocks direct psql execution of 0008 or 0009", () => {
  assert.equal(
    runGuard("psql $DATABASE_URL -f supabase/migrations/0008_event_scope_preparation.sql").status,
    2
  );
  assert.equal(
    runGuard("psql $DATABASE_URL -f supabase/migrations/0009_phase0b_rls_cutover.sql").status,
    2
  );
});

// --- Blocked (secrets) ------------------------------------------------------

test("guard blocks reading the staff passwords secret file", () => {
  assert.equal(runGuard("cat scripts/staff-passwords.local.json").status, 2);
});

test("guard blocks reading .env files across common Windows/PowerShell/Bash forms", () => {
  assert.equal(runGuard("cat .env.local").status, 2);
  assert.equal(runGuard("type .env.local").status, 2);
  assert.equal(runGuard("Get-Content .env.local").status, 2);
  assert.equal(runGuard("gc .env").status, 2);
});

test("guard blocks commands referencing service_role or sb_secret text", () => {
  assert.equal(runGuard("echo $SUPABASE_SERVICE_ROLE_KEY | grep service_role").status, 2);
  assert.equal(runGuard("echo sb_secret_abc123").status, 2);
});
