import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const installer = path.join(repositoryRoot, "scripts", "install-agent-skills.mjs");

function run(...args) {
  return spawnSync(process.execPath, [installer, ...args], { cwd: repositoryRoot, encoding: "utf8" });
}

function runNode(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...env, CODEX_HOME: "" }
  });
}

test("installs both portable Skills into any explicit Code Agent directory", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wuxing-skills-"));
  const target = path.join(temporary, "custom-agent", "skills");
  try {
    const installed = run("--target", target);
    assert.equal(installed.status, 0, installed.stderr);
    const output = JSON.parse(installed.stdout);
    assert.equal(output.standard, "Agent Skills");
    assert.equal(output.companion_dependency, false);
    assert.equal(output.runtime_adapters_optional, true);
    assert.match(output.adapter_contract, /code-agent-adapter-contract\.md$/);
    assert.deepEqual(output.installations.map((item) => item.skill), ["wuxing-harness", "use-agent-achievements"]);
    for (const skill of ["wuxing-harness", "use-agent-achievements"]) {
      const body = await readFile(path.join(target, skill, "SKILL.md"), "utf8");
      assert.match(body, new RegExp(`name: ${skill}`));
    }

    const dataHome = path.join(temporary, "agent-data");
    const achievementCli = path.join(target, "use-agent-achievements", "scripts", "achievement-cli.mjs");
    const initialized = runNode(achievementCli, ["init"], { AGENT_ACHIEVEMENTS_HOME: dataHome });
    assert.equal(initialized.status, 0, initialized.stderr);
    const presence = runNode(achievementCli, [
      "presence", "--agent", "portable-agent", "--session", "session-1", "--runtime", "generic-code-agent",
      "--status", "active", "--task-id", "task-1", "--summary", "Portable runtime"
    ], { AGENT_ACHIEVEMENTS_HOME: dataHome });
    assert.equal(presence.status, 0, presence.stderr);

    const harnessCli = path.join(target, "wuxing-harness", "scripts", "harness-cli.mjs");
    const harness = runNode(harnessCli, ["init", "--workspace", temporary], { AGENT_ACHIEVEMENTS_HOME: dataHome });
    assert.equal(harness.status, 0, harness.stderr);
    const harnessState = runNode(harnessCli, ["list", "--workspace", temporary], { AGENT_ACHIEVEMENTS_HOME: dataHome });
    assert.equal(harnessState.status, 0, harnessState.stderr);
    assert.equal(JSON.parse(harnessState.stdout).achievement_sync.at(-1).status, "ready");

    const repeated = run("--target", target);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.ok(JSON.parse(repeated.stdout).installations.every((item) => item.action === "unchanged"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("desktop companion source has no Code Agent runtime dependency", async () => {
  const main = await readFile(path.join(repositoryRoot, "apps", "companion", "src", "main.cjs"), "utf8");
  assert.doesNotMatch(main, /CODEX_HOME|CLAUDE_CONFIG_DIR|\.codex|\.claude/i);
  assert.match(main, /AGENT_ACHIEVEMENTS_HOME/);
});

test("does not silently overwrite a modified Skill", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wuxing-skills-"));
  const target = path.join(temporary, ".agents", "skills");
  try {
    assert.equal(run("--target", target).status, 0);
    await writeFile(path.join(target, "wuxing-harness", "local-note.txt"), "keep me", "utf8");
    const refused = run("--target", target);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /skill-modified/);
    const replaced = run("--target", target, "--force");
    assert.equal(replaced.status, 0, replaced.stderr);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
