import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  DEMO_FINDINGS,
  DEMO_INVENTORY,
  MemoryHarnessStore,
  WuxingHarnessEngine,
  buildAchievementEvent,
  validateFinding
} from "../packages/wuxing-core/src/index.js";

function testEngine() {
  let sequence = 0;
  return new WuxingHarnessEngine({
    store: new MemoryHarnessStore(),
    id: () => String(++sequence),
    now: () => new Date("2026-08-02T01:00:00+08:00")
  });
}

test("the harness raises evidence-backed findings and waits for human judgment", () => {
  const engine = testEngine();
  const audit = engine.startAudit({ workspace: "voice-md", inventory: DEMO_INVENTORY });
  const finding = engine.addFinding(audit.audit_id, DEMO_FINDINGS[0]);
  engine.finishAudit(audit.audit_id);

  assert.equal(finding.relation, "fire_overcomes_metal");
  assert.equal(finding.status, "pending");
  assert.equal(engine.getMetrics().pending_decisions, 1);
  assert.equal(engine.listEvents().at(-1).event_type, "audit.completed");
});

test("direct contradictions need one evidence item but repeated friction needs several", () => {
  const direct = structuredClone(DEMO_FINDINGS[0]);
  direct.evidence = direct.evidence.slice(0, 1);
  assert.equal(validateFinding(direct).kind, "direct_conflict");

  const friction = structuredClone(DEMO_FINDINGS[1]);
  friction.evidence = friction.evidence.slice(0, 1);
  assert.throws(() => validateFinding(friction), /finding-evidence-insufficient/);
});

test("approved findings can be applied by overwriting the old rule", () => {
  const engine = testEngine();
  const audit = engine.startAudit({ workspace: "voice-md", inventory: DEMO_INVENTORY });
  const finding = engine.addFinding(audit.audit_id, DEMO_FINDINGS[0]);
  const result = engine.decide(finding.finding_id, { decision: "approve", note: "代码和测试一致" });
  assert.equal(result.finding.status, "approved");

  const application = engine.markApplied(finding.finding_id, {
    path: finding.rule.path,
    before: finding.rule.text,
    after: finding.proposal.replacement,
    validation: ["npm test"]
  });
  assert.equal(application.after, finding.proposal.replacement);
  assert.equal(engine.getMetrics().applied_changes, 1);
  assert.equal(engine.listFindings()[0].status, "applied");
});

test("an applied rule becomes a normalized evidence-backed achievement event", async () => {
  const engine = testEngine();
  const audit = engine.startAudit({ workspace: "voice-md", inventory: DEMO_INVENTORY });
  const finding = engine.addFinding(audit.audit_id, DEMO_FINDINGS[0]);
  engine.decide(finding.finding_id, { decision: "approve", note: "同意修改" });
  const application = engine.markApplied(finding.finding_id, {
    path: finding.rule.path,
    before: finding.rule.text,
    after: finding.proposal.replacement,
    validation: ["tests/graph-relations.test.ts"]
  });
  const harnessEvent = engine.listEvents().at(-1);
  const event = buildAchievementEvent({ harnessEvent, finding: engine.listFindings()[0], application, agentId: "codex-test" });
  const schema = JSON.parse(await fs.readFile(new URL("../packages/protocol/schemas/event.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(event.event_type, "rule.revised");
  assert.equal(event.actor.agent_id, "codex-test");
  assert.equal(validate(event), true, JSON.stringify(validate.errors));
});

test("rejected findings remain recorded and do not become changes", () => {
  const engine = testEngine();
  const audit = engine.startAudit({ workspace: "voice-md", inventory: DEMO_INVENTORY });
  const finding = engine.addFinding(audit.audit_id, DEMO_FINDINGS[1]);
  engine.decide(finding.finding_id, { decision: "reject", note: "继续收集证据" });
  assert.equal(engine.getMetrics().rejected_changes, 1);
  assert.equal(engine.getMetrics().applied_changes, 0);
  assert.throws(() => engine.markApplied(finding.finding_id, { path: "x", before: "a", after: "b" }), /finding-not-approved/);
});

test("the demo contains all three implemented control relations without claiming the unfinished queue", () => {
  const engine = testEngine();
  const audit = engine.seedDemo();
  assert.equal(audit.findings.length, 3);
  assert.deepEqual(new Set(audit.findings.map((item) => item.relation)), new Set(["fire_overcomes_metal", "water_overcomes_fire"]));
  assert.equal(engine.getMetrics().pending_decisions, 3);
  assert.equal("non_blocking_queue" in engine.getMetrics(), false);
});

test("the installable Skill example conforms to the strict finding schema", async () => {
  const [schema, fixture] = await Promise.all([
    fs.readFile(new URL("../skills/wuxing-harness/references/finding.schema.json", import.meta.url), "utf8").then(JSON.parse),
    fs.readFile(new URL("../examples/wuxing-harness/browser-rule.finding.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
});
