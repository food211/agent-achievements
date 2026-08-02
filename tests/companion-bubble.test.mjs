import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { bubbleBounds, bubbleMessage, bubblePlacement, clippedText } = require("../apps/companion/src/companion-bubble.cjs");

test("the bubble announces only new Agent outcomes after initial state", () => {
  const base = { awards: [], claims: [], agentConversation: { status: "streaming", messages: [] } };
  assert.equal(bubbleMessage(null, base), null);
  assert.deepEqual(bubbleMessage(base, {
    ...base,
    agentConversation: { status: "completed", messages: [{ role: "assistant", text: "发现一条已经漂移的规则，请你确认。" }] }
  }), {
    kind: "reply",
    title: "Agent 有新消息",
    body: "发现一条已经漂移的规则，请你确认。"
  });
  assert.deepEqual(bubbleMessage(base, {
    ...base,
    awards: [{ achievement_id: "rule-gardener", awarded_at: "2026-08-02T00:00:00Z", icon: "🏆", title: "规则园丁", points: 30 }]
  }), {
    kind: "award",
    title: "Agent 获得新奖杯",
    body: "🏆 规则园丁 · +30 分"
  });
});

test("the bubble stays inside the display and chooses the useful side of the pet", () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(bubbleBounds({ x: 1800, y: 900, width: 94, height: 100 }, work), { x: 1518, y: 908, width: 274, height: 84 });
  assert.deepEqual(bubbleBounds({ x: 0, y: 0, width: 94, height: 100 }, work), { x: 102, y: 8, width: 274, height: 84 });
  assert.equal(clippedText("一段很长的消息内容", 7), "一段很长的消…");
});

test("a scaled short display shrinks the chat bubble and keeps its tail aimed at the pet", () => {
  const placement = bubblePlacement(
    { x: 390, y: 130, width: 94, height: 100 },
    { x: 0, y: 0, width: 500, height: 300 },
    { width: 342, height: 318 }
  );
  assert.deepEqual(placement.bounds, { x: 40, y: 8, width: 342, height: 284 });
  assert.equal(placement.side, "left");
  assert.equal(placement.anchorY, 172);
  assert.ok(placement.bounds.y + placement.bounds.height <= 292);
});
