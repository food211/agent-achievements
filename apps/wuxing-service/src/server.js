import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicWritingProvider, JsonWuxingStore, PresetWritingProvider, WuxingEngine } from "@agent-achievements/wuxing-core";
import { ProxyAgent } from "undici";

const port = Number(process.env.PORT || process.env.WUXING_PORT || 4318);
const dataHome = path.resolve(process.env.WUXING_DATA_HOME || path.join(os.homedir(), ".wuxing-creation"));
const assistantDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wuxing-assistant/dist");
const modelDispatcher = process.env.MODEL_HTTPS_PROXY ? new ProxyAgent(process.env.MODEL_HTTPS_PROXY) : null;
const modelFetch = modelDispatcher ? (url, options) => fetch(url, { ...options, dispatcher: modelDispatcher }) : globalThis.fetch;
const provider = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY
  ? new AnthropicWritingProvider({
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      authToken: process.env.ANTHROPIC_AUTH_TOKEN,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL,
      fetchImpl: modelFetch
    })
  : new PresetWritingProvider();
const engine = new WuxingEngine({ store: new JsonWuxingStore(path.join(dataHome, "state.json")), provider });
const MIME_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

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
    if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, system: "wuxing-creation", version: "v1" });
    if (request.method === "GET" && url.pathname === "/api/wuxing/preferences") return send(response, 200, { preferences: engine.listPreferences() });
    if (request.method === "GET" && url.pathname === "/api/wuxing/events") return send(response, 200, { events: engine.listEvents({ after: Number(url.searchParams.get("after") || 0) }) });
    if (request.method === "POST" && url.pathname === "/api/wuxing/sessions") {
      const body = await readBody(request);
      return send(response, 201, await engine.start(body.text));
    }
    const intervention = url.pathname.match(/^\/api\/wuxing\/sessions\/([^/]+)\/interventions$/);
    if (request.method === "POST" && intervention) {
      const body = await readBody(request);
      return send(response, 200, await engine.intervene(decodeURIComponent(intervention[1]), body.action));
    }
    const judgment = url.pathname.match(/^\/api\/wuxing\/sessions\/([^/]+)\/judgment$/);
    if (request.method === "POST" && judgment) {
      const body = await readBody(request);
      return send(response, 200, engine.judge(decodeURIComponent(judgment[1]), body));
    }
    const session = url.pathname.match(/^\/api\/wuxing\/sessions\/([^/]+)$/);
    if (request.method === "GET" && session) {
      const value = engine.getSession(decodeURIComponent(session[1]));
      return value ? send(response, 200, value) : send(response, 404, { error: "session-not-found" });
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
    const status = ["text-too-short", "unknown-action", "diagnosis-uncertain", "revision-unavailable"].includes(error.message) ? 400 : error.message.endsWith("not-found") ? 404 : 500;
    return send(response, status, { error: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`五行创作内核已启动：http://localhost:${port}`);
  console.log(`数据目录：${dataHome}`);
  console.log(`模型 Provider：${provider instanceof AnthropicWritingProvider ? "Anthropic Messages API" : "预置样本"}`);
  if (modelDispatcher) console.log("模型网络：已使用服务端代理");
});
