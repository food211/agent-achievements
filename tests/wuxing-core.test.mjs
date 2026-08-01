import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicWritingProvider, DEFAULT_SAMPLE, MemoryWuxingStore, WuxingEngine } from "../packages/wuxing-core/src/index.js";

function testEngine() {
  let sequence = 0;
  return new WuxingEngine({
    store: new MemoryWuxingStore(),
    id: () => String(++sequence),
    now: () => new Date("2026-08-02T01:00:00+08:00")
  });
}

test("the wuxing core completes diagnosis, intervention, and conservative preference settlement", async () => {
  const engine = testEngine();
  const session = await engine.start(DEFAULT_SAMPLE);
  assert.equal(session.diagnosis.summary, "水弱，土滞");
  assert.equal(session.diagnosis.recommended_action, "water");
  assert.equal(session.diagnosis.evidence.length, 2);

  const revision = await engine.intervene(session.session_id, "water");
  assert.match(revision.text, /昨晚十一点/);
  assert.equal(revision.action_label, "引水");

  const settled = engine.judge(session.session_id, { accepted: true });
  assert.equal(settled.status, "accepted");
  assert.equal(engine.listPreferences()[0].status, "candidate");
  assert.equal(engine.listPreferences()[0].confirmations, 1);
});

test("an accepted judgment is visible to the next generation without becoming a stable rule", async () => {
  const engine = testEngine();
  const first = await engine.start(DEFAULT_SAMPLE);
  await engine.intervene(first.session_id, "water");
  engine.judge(first.session_id, { accepted: true });

  const second = await engine.start(DEFAULT_SAMPLE);
  assert.equal(second.preference_context.length, 1);
  const revision = await engine.intervene(second.session_id, "water");
  assert.deepEqual(revision.preference_context, ["你更在意真实细节带来的力量，不要用漂亮形容词替代它。"]);
  engine.judge(second.session_id, { accepted: true });
  assert.equal(engine.listPreferences()[0].status, "stable");
  assert.equal(engine.listPreferences()[0].confirmations, 2);
});

test("rejected judgments remain events and never become preferences", async () => {
  const engine = testEngine();
  const session = await engine.start(DEFAULT_SAMPLE);
  await engine.intervene(session.session_id, "metal");
  engine.judge(session.session_id, { accepted: false, feedback: "删得太狠" });
  assert.equal(engine.listPreferences().length, 0);
  assert.equal(engine.listEvents().at(-1).event_type, "preference.rejected");
});

test("the preset provider refuses to invent a diagnosis for unmatched text", async () => {
  const engine = testEngine();
  const session = await engine.start("这是一段长度足够、但没有预置诊断证据的临时文本，因此系统必须明确表示无法判断。" );
  assert.ok(session.diagnosis.uncertainty);
  await assert.rejects(() => engine.intervene(session.session_id, "water"), /diagnosis-uncertain/);
});

test("the Anthropic provider keeps the key server-side and defaults to Claude Opus 5", async () => {
  let request;
  const provider = new AnthropicWritingProvider({
    baseUrl: "https://models.example.test",
    authToken: "private-token",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ summary: "水弱", evidence: ["一段证据"], explanation: "缺少现场", recommended_action: "water", why_this_action: "补现场", uncertainty: null, terrain: { water: "weak", wood: "balanced", fire: "balanced", earth: "balanced", metal: "balanced" } }) }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  await provider.diagnose({ text: DEFAULT_SAMPLE, preferences: [] });
  assert.equal(request.url, "https://models.example.test/v1/messages");
  assert.equal(request.body.model, "claude-opus-5");
  assert.equal(request.options.headers.authorization, "Bearer private-token");
  assert.doesNotMatch(request.options.body, /private-token/);
});
