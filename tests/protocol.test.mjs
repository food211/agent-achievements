import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

const schemaFiles = [
  "packages/protocol/schemas/event.schema.json",
  "packages/protocol/schemas/achievement.schema.json",
  "packages/protocol/schemas/context-request.schema.json",
  "packages/protocol/schemas/context-response.schema.json",
  "packages/protocol/schemas/claim.schema.json",
  "packages/protocol/schemas/presence.schema.json",
  "packages/protocol/schemas/achievement-design-request.schema.json",
  "packages/protocol/schemas/achievement-design-proposal.schema.json",
  "packages/protocol/schemas/achievement-diagnostic-request.schema.json",
  "packages/protocol/schemas/achievement-diagnostic-report.schema.json",
  "packages/protocol/schemas/award.schema.json",
  "packages/protocol/schemas/prompt-request.schema.json",
  "packages/protocol/schemas/prompt-ack.schema.json"
];

async function validator(schemaFile) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const file of schemaFiles) ajv.addSchema(await json(file));
  const schema = await json(schemaFile);
  return ajv.getSchema(schema.$id);
}

const fixtures = [
  ["packages/protocol/schemas/achievement.schema.json", "examples/wuxing-harness/product-gatekeeper.achievement.json"],
  ["packages/protocol/schemas/achievement.schema.json", "skills/wuxing-harness/references/rule-gardener.achievement.json"],
  ["packages/protocol/schemas/achievement.schema.json", "skills/wuxing-harness/references/product-gatekeeper.achievement.json"],
  ["packages/protocol/schemas/event.schema.json", "examples/wuxing-harness/judgment-requested.event.json"],
  ["packages/protocol/schemas/claim.schema.json", "examples/wuxing-harness/product-gatekeeper.claim.json"],
  ["packages/protocol/schemas/context-response.schema.json", "examples/wuxing-harness/agent-context.response.json"],
  ["packages/protocol/schemas/presence.schema.json", "examples/wuxing-harness/agent-presence.json"],
  ["packages/protocol/schemas/achievement-diagnostic-report.schema.json", "examples/wuxing-harness/initial-diagnostic.report.json"]
];

for (const [schemaFile, fixtureFile] of fixtures) {
  test(`${fixtureFile} conforms to v1`, async () => {
    const validate = await validator(schemaFile);
    assert.ok(validate, `missing validator for ${schemaFile}`);
    const fixture = await json(fixtureFile);
    assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
  });
}

test("strict event schema rejects accidental fields", async () => {
  const validate = await validator("packages/protocol/schemas/event.schema.json");
  const fixture = await json("examples/wuxing-harness/judgment-requested.event.json");
  fixture.accidental_field = true;
  assert.equal(validate(fixture), false);
  assert.ok(validate.errors.some((error) => error.keyword === "additionalProperties"));
});

test("achievement tiers enforce their fixed point values", async () => {
  const validate = await validator("packages/protocol/schemas/achievement.schema.json");
  const fixture = await json("examples/wuxing-harness/product-gatekeeper.achievement.json");
  fixture.points = 10;
  assert.equal(validate(fixture), false);
  assert.ok(validate.errors.some((error) => error.keyword === "const"));
});

test("Agent achievement design proposals conform to v1", async () => {
  const validate = await validator("packages/protocol/schemas/achievement-design-proposal.schema.json");
  const proposal = {
    schema_version: "agent-achievements/v1",
    request_id: "design-test-1234",
    agent_id: "codex-local",
    proposed_at: "2026-08-01T00:00:00.000Z",
    achievement: {
      title: "证据工匠",
      intent: "在关键判断前收集可核验的证据。",
      tier: "silver",
      event_type: "evidence.collected",
      target: 3,
      encouragement: "先找证据，再形成结论。",
      guardrails: ["不得为了成就扩大任务范围"]
    }
  };
  assert.equal(validate(proposal), true, JSON.stringify(validate.errors, null, 2));
});
