import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const guardPath = join(root, ".claude", "hooks", "guard.cjs");

function runGuard(command: string, env: Record<string, string> = {}) {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  const result = spawnSync(process.execPath, [guardPath], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return result;
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

test("settings.json is valid JSON and wires the Bash guard hook", () => {
  const raw = readFileSync(join(root, ".claude", "settings.json"), "utf8");
  const settings = JSON.parse(raw);
  const bashHooks = settings.hooks?.PreToolUse?.find((entry: { matcher?: string }) => entry.matcher === "Bash");
  assert.ok(bashHooks, "no PreToolUse hook wired for Bash");
  assert.match(bashHooks.hooks[0].command, /guard\.cjs/);
  assert.ok(Array.isArray(settings.permissions?.deny) && settings.permissions.deny.length > 0);
});

test("no governance file contains a plausible secret value", () => {
  const files = [
    "CLAUDE.md",
    ".claude/settings.json",
    ".claude/hooks/guard.cjs",
    "docs/CLAUDE_HANDOFF.md",
  ];
  const secretShapes = [/eyJ[A-Za-z0-9_-]{10,}/, /sb_secret_[A-Za-z0-9]/, /service_role"\s*:\s*"[^"]{10,}/];
  for (const relativePath of files) {
    const content = readFileSync(join(root, relativePath), "utf8");
    for (const shape of secretShapes) {
      assert.doesNotMatch(content, shape, `possible secret literal in ${relativePath}`);
    }
  }
});

test("guard allows a safe command", () => {
  const result = runGuard("git status -sb");
  assert.equal(result.status, 0);
});

test("guard blocks push to main", () => {
  const result = runGuard("git push origin main");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /main/i);
});

test("guard blocks force push", () => {
  const result = runGuard("git push --force origin security/auth-front");
  assert.equal(result.status, 2);
});

test("guard blocks any git push without override, allows with explicit override", () => {
  const blocked = runGuard("git push origin security/auth-front");
  assert.equal(blocked.status, 2);

  const overridden = runGuard("git push origin security/auth-front", { ALLOW_GIT_PUSH: "1" });
  assert.equal(overridden.status, 0);
});

test("guard blocks supabase db push", () => {
  const result = runGuard("supabase db push");
  assert.equal(result.status, 2);
});

test("guard blocks supabase migration up", () => {
  const result = runGuard("supabase migration up");
  assert.equal(result.status, 2);
});

test("guard blocks supabase link", () => {
  const result = runGuard("supabase link --project-ref abc123");
  assert.equal(result.status, 2);
});

test("guard blocks reading the staff passwords secret file", () => {
  const result = runGuard("cat scripts/staff-passwords.local.json");
  assert.equal(result.status, 2);
});

test("guard blocks reading .env files", () => {
  const result = runGuard("cat .env.local");
  assert.equal(result.status, 2);
});

test("guard blocks commands referencing service_role or sb_secret text", () => {
  const result = runGuard("echo $SUPABASE_SERVICE_ROLE_KEY | grep service_role");
  assert.equal(result.status, 2);
});

test("guard blocks direct execution of 0008/0009 against a database", () => {
  const result = runGuard("psql $DATABASE_URL -f supabase/migrations/0009_phase0b_rls_cutover.sql");
  assert.equal(result.status, 2);
});

test("guard blocks checkout of main and merges into main", () => {
  assert.equal(runGuard("git checkout main").status, 2);
  assert.equal(runGuard("git merge main").status, 2);
});

test("guard ignores non-Bash tools", () => {
  const payload = JSON.stringify({ tool_name: "Read", tool_input: { file_path: ".env" } });
  const result = spawnSync(process.execPath, [guardPath], { input: payload, encoding: "utf8" });
  assert.equal(result.status, 0);
});
