import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const installer = path.join(repositoryRoot, "scripts", "install-agent-skills.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
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
  const workspace = path.join(temporary, "workspace");
  const dataHome = path.join(temporary, "agent-data");
  try {
    const installArgs = [
      "--target", target,
      "--workspace", workspace,
      "--data-home", dataHome,
      "--agent", "portable-agent",
      "--runtime", "generic-code-agent",
      "--capability", "agent-skills",
      "--capability", "task-boundary"
    ];
    const installed = run(installArgs);
    assert.equal(installed.status, 0, installed.stderr);
    const output = JSON.parse(installed.stdout);
    assert.equal(output.standard, "Agent Skills");
    assert.equal(output.companion_dependency, false);
    assert.equal(output.companion_distribution, "source_repository");
    assert.equal(output.runtime_adapters_optional, true);
    assert.equal(output.bootstrap_automatic, true);
    assert.equal(output.activation_complete, false);
    assert.equal(output.pending_agent_action_count, 4);
    assert.deepEqual(output.next_steps_for_user, []);
    assert.match(output.adapter_contract, /code-agent-adapter-contract\.md$/);
    assert.deepEqual(output.installations.map((item) => item.skill), ["wuxing-harness", "use-agent-achievements"]);
    for (const skill of ["wuxing-harness", "use-agent-achievements"]) {
      const body = await readFile(path.join(target, skill, "SKILL.md"), "utf8");
      assert.match(body, new RegExp(`name: ${skill}`));
    }

    assert.equal(output.activations.length, 1);
    assert.deepEqual(output.activations[0].identity, { agent_id: "portable-agent", runtime_id: "generic-code-agent" });
    assert.deepEqual(output.activations[0].capabilities, ["agent-skills", "task-boundary"]);
    assert.ok(output.activations[0].agent_next_actions.some((item) => item.action === "run_wuxing_diagnostic"));
    assert.ok(output.activations[0].agent_next_actions.some((item) => item.action === "diagnose_past_achievements"));
    const companionAction = output.activations[0].agent_next_actions.find((item) => item.action === "ensure_companion_running");
    assert.ok(companionAction, "bootstrap must assign companion startup to the installing Agent");
    assert.ok(companionAction.detection || companionAction.probe || companionAction.check, "companion action must include a non-mutating detection method");
    assert.ok(companionAction.command || companionAction.launch, "companion action must include a launch command");
    assert.equal(companionAction.command.program, process.execPath);
    assert.match(companionAction.command.args[0], /apps[\\/]companion[\\/]scripts[\\/]start\.mjs$/);
    assert.ok(await readFile(companionAction.command.args[0], "utf8"));
    const bridgeAction = output.activations[0].agent_next_actions.find((item) => item.action === "ensure_agent_bridge");
    assert.ok(bridgeAction, "bootstrap must assign the persistent Agent bridge to the installing Agent");
    assert.equal(bridgeAction.detection.type, "file_freshness");
    assert.equal(bridgeAction.detection.expected_status, "connected");
    assert.match(bridgeAction.detection.path, /[\\/]bridges[\\/][a-f0-9]{16}\.json$/);
    assert.match(bridgeAction.bridge_command.args[0], /agent-bridge\.mjs$/);
    assert.deepEqual(
      bridgeAction.bridge_command.args.slice(1, 7),
      ["--agent", "portable-agent", "--runtime", "generic-code-agent", "--session", bridgeAction.bridge_command.args[6]]
    );
    assert.ok(await readFile(bridgeAction.bridge_command.args[0], "utf8"));
    assert.deepEqual(
      new Set(output.activations[0].agent_next_actions.map((item) => item.action)),
      new Set(["ensure_companion_running", "ensure_agent_bridge", "run_wuxing_diagnostic", "diagnose_past_achievements"])
    );
    assert.ok(output.next_steps_for_agent.some((item) => item.action === "ensure_agent_bridge"));
    assert.equal(output.activations[0].wuxing_harness.ok, true);
    const harnessStatePath = path.join(workspace, ".wuxing-harness", "state.json");
    const harnessStateBeforeRepeat = await readFile(harnessStatePath, "utf8");
    const harnessState = JSON.parse(harnessStateBeforeRepeat);
    assert.equal(harnessState.workspace, path.resolve(workspace));
    assert.equal(harnessState.achievement_sync.at(-1).status, "ready");
    const achievementState = JSON.parse(await readFile(path.join(dataHome, "state.json"), "utf8"));
    assert.deepEqual(achievementState.adapters[0].bridge_command, bridgeAction.bridge_command);
    assert.ok(achievementState.achievements.some((item) => item.achievement_id === "wuxing-rule-gardener"));
    assert.ok(achievementState.achievements.some((item) => item.achievement_id === "wuxing-product-gatekeeper"));
    assert.ok(achievementState.achievements.some((item) => item.achievement_id === "wuxing-loop-keeper"));
    const loopKeeper = achievementState.achievements.find((item) => item.achievement_id === "wuxing-loop-keeper");
    assert.equal(loopKeeper.tier, "gold");
    assert.equal(loopKeeper.mode, "claim_review");

    const achievementCli = path.join(target, "use-agent-achievements", "scripts", "achievement-cli.mjs");
    const presence = runNode(achievementCli, [
      "presence", "--agent", "portable-agent", "--session", "session-1", "--runtime", "generic-code-agent",
      "--status", "active", "--task-id", "task-1", "--summary", "Portable runtime"
    ], { AGENT_ACHIEVEMENTS_HOME: dataHome });
    assert.equal(presence.status, 0, presence.stderr);

    const repeated = run(installArgs);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.ok(JSON.parse(repeated.stdout).installations.every((item) => item.action === "unchanged"));
    assert.equal(await readFile(harnessStatePath, "utf8"), harnessStateBeforeRepeat, "repeat install must not reset Harness findings");
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
  const workspace = path.join(temporary, "workspace");
  const dataHome = path.join(temporary, "agent-data");
  try {
    const args = ["--target", target, "--workspace", workspace, "--data-home", dataHome];
    const initial = run(args);
    assert.equal(initial.status, 0, initial.stderr);
    assert.deepEqual(JSON.parse(initial.stdout).activations[0].capabilities, [], "the installer must not invent host capabilities");
    await writeFile(path.join(target, "wuxing-harness", "local-note.txt"), "keep me", "utf8");
    const refused = run(args);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /skill-modified/);
    const replaced = run([...args, "--force"]);
    assert.equal(replaced.status, 0, replaced.stderr);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("dry run never bootstraps local state", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wuxing-skills-"));
  const target = path.join(temporary, "skills");
  const workspace = path.join(temporary, "workspace");
  const dataHome = path.join(temporary, "agent-data");
  try {
    const result = run(["--target", target, "--workspace", workspace, "--data-home", dataHome, "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.activations, []);
    await assert.rejects(readFile(path.join(dataHome, "state.json"), "utf8"));
    await assert.rejects(readFile(path.join(workspace, ".wuxing-harness", "state.json"), "utf8"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
