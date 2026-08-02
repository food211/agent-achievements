#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

function emptyState() {
  return { schema_version: VERSION, workspace, findings: [], decisions: [], applications: [] };
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

try {
  if (command === "init") {
    const state = emptyState();
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
    writeState(state);
    output(finding);
  } else if (command === "list") {
    const state = readState();
    const status = option("status");
    output({ findings: status ? state.findings.filter((item) => item.status === status) : state.findings, decisions: state.decisions, applications: state.applications });
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
    writeState(state);
    output(application);
  } else {
    throw new Error("usage: init | propose --input file | list | decide --finding id --decision approve|reject | applied --finding id --input file");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
