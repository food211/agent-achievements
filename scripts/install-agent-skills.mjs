#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..");
const skillNames = ["wuxing-harness", "use-agent-achievements"];
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const dryRun = argv.includes("--dry-run");

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

if (argv.includes("--help")) {
  help();
  process.exit(0);
}

const explicitTargets = values("target").map((value) => path.resolve(expandHome(value)));
const projectTargets = values("project").map((value) => path.resolve(expandHome(value), ".agents", "skills"));
const targets = [...new Set([...explicitTargets, ...projectTargets])];
if (!targets.length) targets.push(path.join(os.homedir(), ".agents", "skills"));

const installations = [];
for (const target of targets) {
  const targetStat = await stat(path.dirname(target)).catch(() => null);
  if (targetStat && !targetStat.isDirectory()) throw new Error(`target-parent-not-directory:${target}`);
  for (const skillName of skillNames) installations.push(await installSkill(skillName, target));
}

process.stdout.write(`${JSON.stringify({
  schema_version: "wuxing-installer/v1",
  ok: true,
  standard: "Agent Skills",
  targets,
  installations,
  companion_dependency: false,
  runtime_adapters_optional: true,
  adapter_contract: path.join(repositoryRoot, "docs", "code-agent-adapter-contract.md"),
  next_steps: ["reload_skill_index", "initialize_achievements", "verify_presence", "initialize_wuxing_harness"]
}, null, 2)}\n`);
