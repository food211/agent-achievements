#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "wuxing-harness/v1";
const args = process.argv.slice(2);
const command = args.shift();

function option(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const workspace = path.resolve(option("workspace", process.cwd()));
const home = path.resolve(process.env.WUXING_HARNESS_HOME || path.join(workspace, ".wuxing-harness"));
const statePath = path.join(home, "state.json");
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function emptyState() {
  return { schema_version: VERSION, workspace, findings: [], decisions: [], applications: [], achievement_sync: [] };
}

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return value.schema_version === VERSION ? value : emptyState();
  } catch {
    return emptyState();
  }
}

function writeState(state) {
  fs.mkdirSync(home, { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
}

function loadJson(file) {
  if (!file) throw new Error("input-required");
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function validateFinding(value) {
  const minimum = { direct_conflict: 1, repeated_friction: 2, automation_boundary: 1 }[value.kind];
  if (!minimum) throw new Error("finding-kind-invalid");
  if (!value.title || !value.rule?.path || !value.rule?.text) throw new Error("finding-rule-incomplete");
  if (!Number.isInteger(value.trigger_count) || value.trigger_count < 0 || !Number.isInteger(value.contradiction_count) || value.contradiction_count < 0 || value.contradiction_count > value.trigger_count) throw new Error("finding-counts-invalid");
  if (!Array.isArray(value.evidence) || value.evidence.length < minimum) throw new Error("finding-evidence-insufficient");
  if (value.evidence.some((item) => !item.type || !item.ref || !item.summary)) throw new Error("finding-evidence-invalid");
  const proposal = value.proposal || {};
  if (!proposal.replacement || !proposal.reason || !proposal.impact_scope || !proposal.reversibility) throw new Error("finding-proposal-incomplete");
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function achievementsCli() {
  const candidates = [
    process.env.AGENT_ACHIEVEMENTS_CLI,
    path.resolve(skillRoot, "..", "use-agent-achievements", "scripts", "achievement-cli.mjs")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function runAchievements(cli, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: process.env });
  if (result.status !== 0) return { ok: false, error: result.stderr.trim() || "achievement-command-failed" };
  try { return JSON.parse(result.stdout); } catch { return { ok: false, error: "achievement-response-invalid" }; }
}

function setupAchievements() {
  const cli = achievementsCli();
  if (!cli) return { status: "not_installed" };
  const initialized = runAchievements(cli, ["init"]);
  if (!initialized.ok) return { status: "failed", error: initialized.error };
  const definitions = ["rule-gardener.achievement.json", "product-gatekeeper.achievement.json", "loop-keeper.achievement.json"];
  for (const file of definitions) {
    const defined = runAchievements(cli, ["define", "--input", path.join(skillRoot, "references", file), "--if-absent"]);
    if (!defined.ok) return { status: "failed", error: defined.error };
  }
  return { status: "ready", achievements: ["wuxing-rule-gardener", "wuxing-product-gatekeeper", "wuxing-loop-keeper"] };
}

function normalizedEvidence(items) {
  return (items || []).map((item) => ({
    type: { test: "test", decision: "decision_record", run: "trace" }[item.type] || "external",
    ref: item.ref,
    summary: item.summary
  }));
}

function achievementEvent(finding, eventType, extraEvidence = []) {
  const eventId = `wuxing:${finding.finding_id}:${eventType}:${randomUUID()}`;
  const lifecycleEvidence = eventType === "judgment.requested"
    ? [{ type: "trace", ref: `wuxing-finding:${finding.finding_id}`, summary: "Harness 已挂起这条高影响分支并等待人的判断。" }]
    : [];
  return {
    schema_version: "agent-achievements/v1",
    event_id: eventId,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    source: { system: "wuxing-harness", version: "0.1.0" },
    actor: { agent_id: option("agent", "wuxing-agent") },
    task: { id: option("task-id", finding.finding_id), type: option("task-type", "rule-maintenance") },
    run: { id: option("run-id", option("task-id", finding.finding_id)) },
    outcome: {
      status: eventType === "judgment.requested" ? "parked" : "completed",
      summary: eventType === "judgment.requested" ? `规则边界需要人判断：${finding.title}` : `规则已经按人的决定修改并验证：${finding.title}`
    },
    evidence: [...normalizedEvidence(finding.evidence), ...lifecycleEvidence, ...extraEvidence],
    extensions: { finding_id: finding.finding_id, relation: finding.relation || "unmapped", human_decision_required: true }
  };
}

function syncAchievement(event, achievementId) {
  const eventDirectory = path.join(home, "achievement-events");
  fs.mkdirSync(eventDirectory, { recursive: true });
  const eventFile = path.join(eventDirectory, `${event.event_id.replace(/[^a-z0-9._-]/gi, "_")}.json`);
  fs.writeFileSync(eventFile, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  const cli = achievementsCli();
  if (!cli) return { status: "queued", event_file: eventFile };
  const reported = runAchievements(cli, ["report", "--input", eventFile]);
  if (!reported.ok) return { status: "failed", event_file: eventFile, error: reported.error };
  if (!(reported.next_actions || []).some((item) => item.action === "submit_claim" && item.achievement_id === achievementId)) {
    return { status: reported.data?.duplicate ? "already_reported" : "reported", event_file: eventFile };
  }
  const claim = {
    schema_version: "agent-achievements/v1",
    claim_id: `claim:${event.event_id}`,
    achievement_id: achievementId,
    agent_id: event.actor.agent_id,
    task_ids: [event.task.id],
    summary: event.outcome.summary,
    evidence: event.evidence
  };
  const claimDirectory = path.join(home, "achievement-claims");
  fs.mkdirSync(claimDirectory, { recursive: true });
  const claimFile = path.join(claimDirectory, `${claim.claim_id.replace(/[^a-z0-9._-]/gi, "_")}.json`);
  fs.writeFileSync(claimFile, `${JSON.stringify(claim, null, 2)}\n`, "utf8");
  const submitted = runAchievements(cli, ["claim", "--input", claimFile]);
  return { status: submitted.ok ? "claim_submitted" : "failed", event_file: eventFile, claim_file: claimFile, ...(submitted.ok ? {} : { error: submitted.error }) };
}

try {
  if (command === "init") {
    const state = emptyState();
    state.achievement_sync.push({ at: new Date().toISOString(), ...setupAchievements() });
    writeState(state);
    output({ ok: true, state_path: statePath, workspace });
  } else if (command === "propose") {
    const finding = loadJson(option("input"));
    validateFinding(finding);
    const state = readState();
    finding.schema_version = VERSION;
    finding.finding_id ||= `finding_${randomUUID()}`;
    finding.status = "pending";
    finding.created_at = new Date().toISOString();
    if (state.findings.some((item) => item.finding_id === finding.finding_id)) throw new Error("finding-id-duplicate");
    state.findings.push(finding);
    if (finding.kind === "automation_boundary") {
      state.achievement_sync.push({ finding_id: finding.finding_id, at: new Date().toISOString(), ...syncAchievement(achievementEvent(finding, "judgment.requested"), "wuxing-product-gatekeeper") });
    }
    writeState(state);
    output(finding);
  } else if (command === "list") {
    const state = readState();
    const status = option("status");
    output({ findings: status ? state.findings.filter((item) => item.status === status) : state.findings, decisions: state.decisions, applications: state.applications, achievement_sync: state.achievement_sync || [] });
  } else if (command === "decide") {
    const state = readState();
    const finding = state.findings.find((item) => item.finding_id === option("finding"));
    const decision = option("decision");
    if (!finding) throw new Error("finding-not-found");
    if (finding.status !== "pending") throw new Error("finding-already-decided");
    if (!['approve', 'reject'].includes(decision)) throw new Error("decision-invalid");
    finding.status = decision === "approve" ? "approved" : "rejected";
    const record = { decision_id: `decision_${randomUUID()}`, finding_id: finding.finding_id, decision, note: option("note"), decided_at: new Date().toISOString() };
    state.decisions.push(record);
    writeState(state);
    output(record);
  } else if (command === "applied") {
    const state = readState();
    const finding = state.findings.find((item) => item.finding_id === option("finding"));
    if (!finding) throw new Error("finding-not-found");
    if (finding.status !== "approved") throw new Error("finding-not-approved");
    const application = loadJson(option("input"));
    if (!application.path || !application.before || !application.after || !Array.isArray(application.validation)) throw new Error("application-incomplete");
    application.schema_version = VERSION;
    application.application_id = `application_${randomUUID()}`;
    application.finding_id = finding.finding_id;
    application.applied_at = new Date().toISOString();
    finding.status = "applied";
    state.applications.push(application);
    const extraEvidence = [
      { type: "decision_record", ref: state.decisions.find((item) => item.finding_id === finding.finding_id)?.decision_id || application.application_id, summary: "人已批准这次规则修改。" },
      ...application.validation.map((item) => ({ type: "test", ref: item, summary: "规则修改后完成验证。" }))
    ];
    state.achievement_sync.push({ finding_id: finding.finding_id, at: new Date().toISOString(), ...syncAchievement(achievementEvent(finding, "rule.revised", extraEvidence), "wuxing-rule-gardener") });
    writeState(state);
    output(application);
  } else {
    throw new Error("usage: init | propose --input file | list | decide --finding id --decision approve|reject | applied --finding id --input file");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
