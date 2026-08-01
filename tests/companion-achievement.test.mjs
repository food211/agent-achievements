import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const require = createRequire(import.meta.url);
const { buildHumanAchievement, calculateScore, updateTrackedIds } = require("../apps/companion/src/achievement-factory.cjs");

test("the companion creates a protocol-valid human achievement", async () => {
  const achievement = buildHumanAchievement({
    tier: "gold",
    title: "边界导航员",
    intent: "遇到产品边界时先提供影响分析，再请求人的判断。",
    event_type: "judgment.requested",
    target: 3,
    encouragement: "先看整体用户体验，再决定是否询问。",
    guardrails: "不得把普通实现问题交给人",
    track: true
  }, { now: new Date("2026-08-01T00:00:00.000Z"), suffix: "test" });

  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const eventSchema = JSON.parse(await readFile(new URL("../packages/protocol/schemas/event.schema.json", import.meta.url), "utf8"));
  const achievementSchema = JSON.parse(await readFile(new URL("../packages/protocol/schemas/achievement.schema.json", import.meta.url), "utf8"));
  ajv.addSchema(eventSchema);
  const validate = ajv.compile(achievementSchema);
  assert.equal(validate(achievement), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(achievement.extensions.created_by, "human");
  assert.equal(achievement.mode, "claim_review");
  assert.equal(achievement.tier, "gold");
  assert.equal(achievement.points, 100);
});

test("the companion rejects invalid achievement goals", () => {
  assert.throws(() => buildHumanAchievement({ title: "", intent: "x", event_type: "task.completed", target: 1 }), /title-required/);
  assert.throws(() => buildHumanAchievement({ title: "x", intent: "x", event_type: "unknown", target: 1 }), /event-type-invalid/);
  assert.throws(() => buildHumanAchievement({ title: "x", intent: "x", event_type: "task.completed", target: 0 }), /target-invalid/);
});

test("editing preserves identity and protocol semantics", () => {
  const updated = buildHumanAchievement({ title: "新版", intent: "新的目标", event_type: "task.completed", target: 5 }, {
    achievementId: "existing-achievement",
    existingMode: "automatic",
    existingCondition: { unit: "qualified_tasks" },
    evidenceRequired: false,
    existingExtensions: { created_at: "2026-07-01T00:00:00.000Z", created_by: "human" },
    now: new Date("2026-08-01T00:00:00.000Z")
  });
  assert.equal(updated.achievement_id, "existing-achievement");
  assert.equal(updated.mode, "automatic");
  assert.equal(updated.condition.unit, "qualified_tasks");
  assert.equal(updated.evidence_required, false);
  assert.equal(updated.extensions.created_at, "2026-07-01T00:00:00.000Z");
});

test("tracking can switch while enforcing the three-item limit", () => {
  assert.deepEqual(updateTrackedIds(["a", "b"], "c", true), { tracked: ["a", "b", "c"], trackingLimitReached: false });
  assert.deepEqual(updateTrackedIds(["a", "b", "c"], "d", true), { tracked: ["a", "b", "c"], trackingLimitReached: true });
  assert.deepEqual(updateTrackedIds(["a", "b", "c"], "b", false), { tracked: ["a", "c"], trackingLimitReached: false });
});

test("points are counted once per human-awarded achievement", () => {
  const achievements = [
    { achievement_id: "bronze-item", tier: "bronze", points: 10 },
    { achievement_id: "gold-item", tier: "gold", points: 100 }
  ];
  const awards = [
    { achievement_id: "bronze-item" },
    { achievement_id: "gold-item" },
    { achievement_id: "gold-item" }
  ];
  assert.equal(calculateScore(achievements, awards), 110);
});
