#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..");
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const dryRun = argv.includes("--dry-run");
const withAchievements = argv.includes("--with-achievements");
const skillNames = withAchievements ? ["wuxing-harness", "use-agent-achievements"] : ["wuxing-harness"];

function values(name) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${name}`) {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${name}-value-required`);
      result.push(argv[index + 1]);
      index += 1;
    }
  }
  return result;
}

function value(name, fallback = "") {
  return values(name).at(-1) || fallback;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function help() {
  process.stdout.write(`Install Wuxing Harness into any Agent Skills-compatible Code Agent.\n\n`);
  process.stdout.write(`Usage:\n  node scripts/install-agent-skills.mjs [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --target <skills-dir>  Install into an explicit user Skills directory. Repeatable.\n`);
  process.stdout.write(`  --project <dir>        Install into <dir>/.agents/skills. Repeatable.\n`);
  process.stdout.write(`  --workspace <dir>      Workspace to initialize. Defaults to the current directory.\n`);
  process.stdout.write(`  --agent <id>           Stable identity of the installing Code Agent.\n`);
  process.stdout.write(`  --runtime <id>         Truthful host runtime identifier.\n`);
  process.stdout.write(`  --capability <name>    Host capability discovered by the Agent. Repeatable.\n`);
  process.stdout.write(`  --data-home <dir>      Override the shared achievement state directory.\n`);
  process.stdout.write(`  --with-achievements    Also install the optional achievement integration Skill.\n`);
  process.stdout.write(`  --force                Replace an existing modified installation.\n`);
  process.stdout.write(`  --dry-run              Report destinations without writing files.\n`);
  process.stdout.write(`  --help                 Show this help.\n\n`);
  process.stdout.write(`Without options, installs to ~/.agents/skills, the cross-client convention.\n`);
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function digestTree(root) {
  const hash = createHash("sha256");
  async function visit(directory, relative = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(directory, entry.name);
      hash.update(childRelative.replaceAll("\\", "/"));
      if (entry.isDirectory()) await visit(child, childRelative);
      else if (entry.isFile()) hash.update(await readFile(child));
      else hash.update(`unsupported:${entry.name}`);
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function validateSource(skillName) {
  const source = path.join(repositoryRoot, "skills", skillName);
  const skillFile = path.join(source, "SKILL.md");
  const body = await readFile(skillFile, "utf8");
  if (!body.startsWith("---") || !body.includes(`name: ${skillName}`)) throw new Error(`skill-invalid:${skillName}`);
  return source;
}

async function installSkill(skillName, targetRoot) {
  const source = await validateSource(skillName);
  const destination = path.join(targetRoot, skillName);
  if (path.resolve(source) === path.resolve(destination)) throw new Error(`source-is-target:${skillName}`);
  if (dryRun) return { skill: skillName, destination, action: "would_install" };

  await mkdir(targetRoot, { recursive: true });
  if (await exists(destination)) {
    const [sourceDigest, destinationDigest] = await Promise.all([digestTree(source), digestTree(destination)]);
    if (sourceDigest === destinationDigest) return { skill: skillName, destination, action: "unchanged" };
    if (!force) throw new Error(`skill-modified:${destination}:pass --force to replace it`);
  }

  const suffix = `${process.pid}-${Date.now()}`;
  const temporary = path.join(targetRoot, `.${skillName}.install-${suffix}`);
  const backup = path.join(targetRoot, `.${skillName}.backup-${suffix}`);
  await cp(source, temporary, { recursive: true, force: true });
  let backedUp = false;
  try {
    if (await exists(destination)) {
      await rename(destination, backup);
      backedUp = true;
    }
    await rename(temporary, destination);
    if (backedUp) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (backedUp && !(await exists(destination))) await rename(backup, destination);
    throw error;
  }
  return { skill: skillName, destination, action: backedUp ? "replaced" : "installed" };
}

function runJson(script, arguments_, environment = process.env) {
  const result = spawnSync(process.execPath, [script, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment
  });
  if (result.status !== 0) {
    throw new Error(`activation-failed:${path.basename(script)}:${result.stderr.trim() || result.stdout.trim() || `exit-${result.status}`}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`activation-response-invalid:${path.basename(script)}`);
  }
}

async function activate(targetRoot, workspace, identity, capabilities, environment) {
  const harnessCli = path.join(targetRoot, "wuxing-harness", "scripts", "harness-cli.mjs");
  const harnessHome = path.resolve(environment.WUXING_HARNESS_HOME || path.join(workspace, ".wuxing-harness"));
  const harnessStatePath = path.join(harnessHome, "state.json");
  let harnessInitialization;
  if (await exists(harnessStatePath)) {
    const state = JSON.parse(await readFile(harnessStatePath, "utf8"));
    harnessInitialization = { ok: true, state_path: harnessStatePath, workspace: state.workspace || workspace, unchanged: true };
  } else {
    harnessInitialization = runJson(harnessCli, ["init", "--workspace", workspace, "--agent", identity.agent_id], environment);
  }

  let achievementBootstrap = null;
  let agentNextActions = [];
  if (withAchievements) {
    const achievementCli = path.join(targetRoot, "use-agent-achievements", "scripts", "achievement-cli.mjs");
    const bootstrapArgs = [
      "bootstrap",
      "--agent", identity.agent_id,
      "--runtime", identity.runtime_id,
      "--workspace", workspace
    ];
    for (const capability of capabilities) bootstrapArgs.push("--capability", capability);
    achievementBootstrap = runJson(achievementCli, bootstrapArgs, environment);
    agentNextActions = achievementBootstrap.agent_next_actions || achievementBootstrap.data?.agent_next_actions || [];
  }
  if (achievementBootstrap?.data?.adapter?.created) {
    for (const requiredAction of [
      "run_wuxing_diagnostic",
      "diagnose_past_achievements"
    ]) {
      if (!agentNextActions.some((item) => item.action === requiredAction)) {
        throw new Error(`activation-missing-action:${requiredAction}`);
      }
    }
  }

  return {
    workspace,
    skills_root: targetRoot,
    identity,
    capabilities,
    achievement_bootstrap: achievementBootstrap ? (achievementBootstrap.data || achievementBootstrap) : null,
    wuxing_harness: harnessInitialization,
    wuxing_coaching: null,
    immediate_handoff: withAchievements ? null : {
      kind: "wuxing_rule_audit",
      required_in_current_turn: true,
      instruction: "立即加载 wuxing-harness，并完全按 SKILL.md 的自然对话流程工作：先扫描真实规则，关注语义漂移、场景错误和自动化空白，再带着证据一次推进一条陈旧规则。用户可以修改筛选和提问方式；不要创建待办，不要用脚本状态机驱动对话，也不要把仓库调查或整套问卷丢给用户。只有形成明确处置后才按 schema 落库。"
    },
    agent_next_actions: agentNextActions,
    user_next_actions: []
  };
}

if (argv.includes("--help")) {
  help();
  process.exit(0);
}

const explicitTargets = values("target").map((value) => path.resolve(expandHome(value)));
const projects = values("project").map((entry) => path.resolve(expandHome(entry)));
const projectTargets = projects.map((project) => path.join(project, ".agents", "skills"));
const targets = [...new Set([...explicitTargets, ...projectTargets])];
if (!targets.length) targets.push(path.join(os.homedir(), ".agents", "skills"));

const agentId = value("agent", process.env.AGENT_ACHIEVEMENTS_AGENT_ID || "local-code-agent");
const runtimeId = value("runtime", process.env.AGENT_ACHIEVEMENTS_RUNTIME_ID || "agent-skills");
const declaredCapabilities = [...new Set(values("capability").flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean))];
const capabilities = declaredCapabilities;
const explicitWorkspaces = values("workspace").map((entry) => path.resolve(expandHome(entry)));
const workspaces = [...new Set([...explicitWorkspaces, ...projects])];
if (!workspaces.length) workspaces.push(process.cwd());
const dataHome = value("data-home");
const activationEnvironment = {
  ...process.env,
  ...(dataHome ? { AGENT_ACHIEVEMENTS_HOME: path.resolve(expandHome(dataHome)) } : {})
};

const installations = [];
for (const target of targets) {
  const targetStat = await stat(path.dirname(target)).catch(() => null);
  if (targetStat && !targetStat.isDirectory()) throw new Error(`target-parent-not-directory:${target}`);
  for (const skillName of skillNames) installations.push(await installSkill(skillName, target));
}

const activations = [];
if (!dryRun) {
  const activationTarget = targets[0];
  for (const workspace of workspaces) {
    activations.push(await activate(activationTarget, workspace, { agent_id: agentId, runtime_id: runtimeId }, capabilities, activationEnvironment));
  }
}

const pendingAgentActions = activations.flatMap((item) => item.agent_next_actions);

process.stdout.write(`${JSON.stringify({
  schema_version: "wuxing-installer/v1",
  ok: true,
  standard: "Agent Skills",
  targets,
  installations,
  achievements_included: withAchievements,
  companion_dependency: false,
  companion_distribution: "not_included",
  runtime_adapters_optional: true,
  adapter_contract: path.join(repositoryRoot, "docs", "code-agent-adapter-contract.md"),
  bootstrap_automatic: true,
  activation_complete: !dryRun && pendingAgentActions.length === 0,
  pending_agent_action_count: pendingAgentActions.length,
  activations,
  next_steps_for_agent: dryRun ? ["run_without_dry_run"] : pendingAgentActions,
  next_steps_for_user: []
}, null, 2)}\n`);
