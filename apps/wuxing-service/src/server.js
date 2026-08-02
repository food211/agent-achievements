import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonHarnessStore, WuxingHarnessEngine } from "@agent-achievements/wuxing-core";

const port = Number(process.env.PORT || process.env.WUXING_PORT || 4318);
const dataHome = path.resolve(process.env.WUXING_DATA_HOME || path.join(os.homedir(), ".wuxing-harness"));
const assistantDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wuxing-assistant/dist");
const stateFile = path.join(dataHome, "state.json");
let engine = createEngine();
const MIME_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function createEngine() {
  const value = new WuxingHarnessEngine({ store: new JsonHarnessStore(stateFile) });
  if (!value.listFindings().length) value.seedDemo();
  return value;
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error("body-too-large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendStatic(response, file) {
  response.writeHead(200, { "content-type": MIME_TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, system: "wuxing-harness", version: "v1" });
    if (request.method === "GET" && url.pathname === "/api/wuxing/findings") return send(response, 200, { findings: engine.listFindings({ status: url.searchParams.get("status") || undefined }) });
    if (request.method === "GET" && url.pathname === "/api/wuxing/metrics") return send(response, 200, engine.getMetrics());
    if (request.method === "GET" && url.pathname === "/api/wuxing/events") return send(response, 200, { events: engine.listEvents({ after: Number(url.searchParams.get("after") || 0) }) });
    if (request.method === "POST" && url.pathname === "/api/wuxing/demo/reset") {
      fs.rmSync(stateFile, { force: true });
      engine = createEngine();
      return send(response, 200, { findings: engine.listFindings(), metrics: engine.getMetrics() });
    }
    const decision = url.pathname.match(/^\/api\/wuxing\/findings\/([^/]+)\/decision$/);
    if (request.method === "POST" && decision) {
      const body = await readBody(request);
      const findingId = decodeURIComponent(decision[1]);
      const result = engine.decide(findingId, { decision: body.decision, note: body.note });
      let application = null;
      if (body.decision === "approve") {
        application = engine.markApplied(findingId, {
          path: result.finding.rule.path,
          before: result.finding.rule.text,
          after: result.finding.proposal.replacement,
          validation: ["重新读取规则", "确认旧描述已被覆盖"]
        });
      }
      return send(response, 200, { ...result, application, metrics: engine.getMetrics() });
    }
    if (request.method === "GET" && fs.existsSync(assistantDist)) {
      const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const candidate = path.resolve(assistantDist, requested);
      if (candidate.startsWith(`${assistantDist}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return sendStatic(response, candidate);
      const index = path.join(assistantDist, "index.html");
      if (!url.pathname.startsWith("/api/") && fs.existsSync(index)) return sendStatic(response, index);
    }
    return send(response, 404, { error: "not-found" });
  } catch (error) {
    const clientErrors = ["decision-invalid", "finding-already-decided"];
    const status = clientErrors.includes(error.message) ? 400 : error.message.endsWith("not-found") ? 404 : 500;
    return send(response, status, { error: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`五行 Harness 已启动：http://localhost:${port}`);
  console.log(`审查记录：${dataHome}`);
});
