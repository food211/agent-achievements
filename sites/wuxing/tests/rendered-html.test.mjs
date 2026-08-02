import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Wuxing Harness rule audit", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>五行 Harness<\/title>/);
  assert.match(html, /给 AI 的规则做一次代谢/);
  assert.match(html, /发现的问题/);
  assert.match(html, /批准并覆盖/);
  assert.match(html, /规则与成就闭环/);
  assert.match(html, /规则园丁/);
  assert.match(html, /反馈给 Agent/);
  assert.match(html, /href="\/install"/);
  assert.doesNotMatch(html, /五行创作调控|引水|改稿/);
});

test("renders an install guide for Agent-led and manual setup", async () => {
  const response = await render("/install");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /把安装交给 Agent/);
  assert.match(html, /复制安装指令/);
  assert.match(html, /第一次怎么用/);
  assert.match(html, /skills\/wuxing-harness/);
  assert.match(html, /use-agent-achievements/);
  assert.match(html, /工作区内容不会发到这个网站/);
});

test("the public demo no longer exposes the writing model endpoint", async () => {
  const response = await render("/api/wuxing");
  assert.equal(response.status, 404);
});
