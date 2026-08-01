import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const require = createRequire(import.meta.url);
const { settleDiagnosticReport } = require("../apps/companion/src/achievement-factory.cjs");
const cli = path.resolve("skills/use-agent-achievements/scripts/achievement-cli.mjs");

function run(home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, AGENT_ACHIEVEMENTS_HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function discovery(overrides = {}) {
  return {
    discovery_id: "rule-gardener",
    title: "规则园丁",
    intent: "把已经漂移的规则修订为符合真实工作的规则。",
    tier: "silver",
    source_skill: "wuxing-agent-harness",
    reason: "识别并修订了妨碍 Agent 工作的旧规则。",
    confidence: "high",
    evidence: [{ type: "decision_record", ref: "decision:wuxing-review", summary: "用户确认规则已修订。" }],
    ...overrides
  };
}

test("a pending first-run diagnosis can receive an evidence-backed report", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "agent-achievements-diagnostic-"));
  run(home, ["init"]);
  const requested = run(home, ["diagnostic-request", "--reason", "first_run"]);
  const report = {
    schema_version: "agent-achievements/v1",
    request_id: requested.data.request_id,
    agent_id: "codex-test",
    diagnosed_at: "2026-08-01T00:00:00.000Z",
    sources: { skills: ["wuxing-agent-harness"], rule_scopes: 2 },
    discoveries: [discovery()]
  };
  const reportPath = path.join(home, "diagnostic-report.json");
  await writeFile(reportPath, JSON.stringify(report), "utf8");
  run(home, ["diagnostic-submit", "--input", reportPath]);
  const document = JSON.parse(await readFile(path.join(home, "achievement-diagnostics.json"), "utf8"));
  assert.equal(document.requests[0].status, "reported");
  assert.equal(document.requests[0].report.discoveries[0].source_skill, "wuxing-agent-harness");
});

test("only high-confidence bronze and silver discoveries settle automatically", async () => {
  const state = { schema_version: "agent-achievements/v1", achievements: [], progress: {}, tracked: [], awards: [] };
  const report = {
    request_id: "diagnostic-test-001",
    agent_id: "codex-test",
    discoveries: [
      discovery(),
      discovery({ discovery_id: "needs-confirmation", confidence: "medium" }),
      discovery({ discovery_id: "gold-needs-confirmation", tier: "gold" })
    ]
  };
  const first = settleDiagnosticReport(state, report, { now: new Date("2026-08-01T00:00:00.000Z") });
  assert.equal(first.awarded.length, 1);
  assert.deepEqual(first.pending, ["needs-confirmation", "gold-needs-confirmation"]);
  assert.equal(first.state.awards[0].awarded_by, "system");
  assert.equal(first.state.achievements[0].origin, "system_discovered");
  assert.equal(first.state.achievements[0].points, 30);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const eventSchema = JSON.parse(await readFile(new URL("../packages/protocol/schemas/event.schema.json", import.meta.url), "utf8"));
  const achievementSchema = JSON.parse(await readFile(new URL("../packages/protocol/schemas/achievement.schema.json", import.meta.url), "utf8"));
  const awardSchema = JSON.parse(await readFile(new URL("../packages/protocol/schemas/award.schema.json", import.meta.url), "utf8"));
  ajv.addSchema(eventSchema);
  assert.equal(ajv.compile(achievementSchema)(first.state.achievements[0]), true);
  assert.equal(ajv.compile(awardSchema)(first.state.awards[0]), true);
  const duplicate = settleDiagnosticReport(first.state, report, { now: new Date("2026-08-02T00:00:00.000Z") });
  assert.equal(duplicate.awarded.length, 0);
  assert.equal(duplicate.state.awards.length, 1);
});

test("a human can confirm one pending discovery without settling the others", () => {
  const state = { schema_version: "agent-achievements/v1", achievements: [], progress: {}, tracked: [], awards: [] };
  const report = {
    request_id: "diagnostic-test-002",
    agent_id: "codex-test",
    discoveries: [
      discovery({ discovery_id: "medium-item", confidence: "medium" }),
      discovery({ discovery_id: "gold-item", tier: "gold" })
    ]
  };
  const result = settleDiagnosticReport(state, report, { confirmDiscoveryId: "medium-item" });
  assert.equal(result.awarded.length, 1);
  assert.deepEqual(result.pending, ["gold-item"]);
});
