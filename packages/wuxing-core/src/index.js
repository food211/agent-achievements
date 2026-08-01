import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SCHEMA_VERSION = "wuxing-creation/v1";

export const ACTIONS = Object.freeze({
  water: { id: "water", label: "引水", meaning: "带回一个真实的现场" },
  wood: { id: "wood", label: "生枝", meaning: "从这里长出新的角度" },
  fire: { id: "fire", label: "点火", meaning: "让一句话真正往前走" },
  earth: { id: "earth", label: "落土", meaning: "把空话落成抓得住的东西" },
  metal: { id: "metal", label: "修枝", meaning: "留下真正需要的那一句" }
});

export const DEFAULT_SAMPLE = "我们总以为，创作需要更完整的方法、更准确的表达和更稳定的输出。只要不断优化流程，内容自然会变得更好。但真正重要的，也许还是保持耐心，相信时间会给出答案。";

const SAMPLE_FIXTURE = Object.freeze({
  diagnosis: {
    summary: "水弱，土滞",
    evidence: ["更完整的方法、更准确的表达和更稳定的输出", "保持耐心，相信时间会给出答案"],
    explanation: "结构完整，却只有概括，没有新的真实感受进入。",
    recommended_action: "water",
    why_this_action: "先补进一个只有你经历过的现场。",
    uncertainty: null,
    terrain: { water: "weak", wood: "balanced", fire: "weak", earth: "stagnant", metal: "strong" }
  },
  revisions: {
    water: {
      text: "昨晚十一点，我又把同一段开头删了第三遍。屏幕上的句子都没错，可读起来像隔着一层玻璃。那一刻我才发现，创作缺的往往不是更完整的方法，而是把手心里的犹豫、窗外的雨声和那个不愿承认的判断重新放回文字里。",
      exchange: "得到一个可感知的现场，放下了抽象的完整感。",
      learned_judgment: "你更在意真实细节带来的力量，不要用漂亮形容词替代它。"
    },
    wood: {
      text: "我们总以为创作需要一套更完整的方法。但方法也可能是一堵修得很整齐的墙：它让每句话都有位置，也让意外无处生长。也许下一步不是继续优化流程，而是故意留下一个岔路，让文字去到作者自己也没预料的地方。",
      exchange: "得到新的生长方向，放下了对完整路径的执着。",
      learned_judgment: "你愿意保留意外的分支，不希望结构过早封住可能性。"
    },
    fire: {
      text: "创作不会因为流程更完整就自然变好。真正拖住文字的，是我们迟迟不肯承担一句明确判断。方法可以继续优化，但先把最在意、最反对、最想推动的那句话说出来。",
      exchange: "得到更早的立场，放下了温和但无方向的铺垫。",
      learned_judgment: "你希望关键判断更早出现，不用完整铺垫稀释推进力。"
    },
    earth: {
      text: "这周我改了四版流程：删掉两个提示词模板，把一次生成拆成三步，还给每一版加了评分。输出确实更稳定了，但最满意的那段文字，仍然来自我补进去的一句真实对话。方法能整理创作，却不能替代发生过的东西。",
      exchange: "得到可核对的事实，放下了泛化的经验总结。",
      learned_judgment: "你希望抽象结论先落到事实，再决定它是否值得保留。"
    },
    metal: {
      text: "创作不会因为流程更完整就变好。方法只能稳定输出，不能替你决定什么值得说。",
      exchange: "得到更清楚的边界，放下了重复解释和缓冲。",
      learned_judgment: "你偏好删掉同义铺陈，让真正需要的判断单独站住。"
    }
  }
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }

export class JsonWuxingStore {
  constructor(file) {
    this.file = file;
    this.state = null;
  }

  read() {
    if (this.state) return clone(this.state);
    try { this.state = JSON.parse(fs.readFileSync(this.file, "utf8")); }
    catch { this.state = { schema_version: SCHEMA_VERSION, sessions: [], preferences: [], events: [] }; }
    return clone(this.state);
  }

  write(state) {
    this.state = clone(state);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, this.file);
  }
}

export class MemoryWuxingStore {
  constructor() { this.state = { schema_version: SCHEMA_VERSION, sessions: [], preferences: [], events: [] }; }
  read() { return clone(this.state); }
  write(state) { this.state = clone(state); }
}

export class PresetWritingProvider {
  diagnose({ text }) {
    if (text.trim() === DEFAULT_SAMPLE) return clone(SAMPLE_FIXTURE.diagnosis);
    return {
      summary: "这段我还看不准",
      evidence: [],
      explanation: "还没找到足够具体的句子。",
      recommended_action: null,
      why_this_action: null,
      uncertainty: "先不改。换一段文字，或者再补一点细节。",
      terrain: { water: "unknown", wood: "unknown", fire: "unknown", earth: "unknown", metal: "unknown" }
    };
  }

  rewrite({ text, action, preferences }) {
    if (text.trim() !== DEFAULT_SAMPLE || !SAMPLE_FIXTURE.revisions[action]) throw new Error("revision-unavailable");
    const revision = clone(SAMPLE_FIXTURE.revisions[action]);
    revision.preference_context = preferences.map((item) => item.statement);
    return revision;
  }
}

function extractJson(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model-json-invalid");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export class AnthropicWritingProvider {
  constructor({ baseUrl = "https://api.anthropic.com", authToken = "", apiKey = "", model = "claude-opus-5", fetchImpl = globalThis.fetch } = {}) {
    if (!authToken && !apiKey) throw new Error("model-key-missing");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.authToken = authToken;
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
  }

  async complete(system, user) {
    const headers = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
    if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.model, max_tokens: 1800, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(45000)
      });
    } catch (error) {
      throw new Error(`model-network-failed:${error.cause?.code || error.name || "unknown"}`);
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`model-request-failed:${response.status}:${detail.slice(0, 240)}`);
    }
    const payload = await response.json();
    return payload.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || "";
  }

  async diagnose({ text, preferences }) {
    const result = extractJson(await this.complete(
      "你是写作诊断编辑。五行只描述当前作品：水=现实感知与具体现场，木=新角度与可能性，火=判断与推进，土=事实与结构，金=取舍与边界。绝不分析作者人格、命理或固定类型。只输出 JSON。",
      `从原文引用 1–2 处短证据，只给一个主判断。证据不足必须明确 uncertainty，不得编造。\n\n原文：\n${text}\n\n已确认或待验证的创作偏好：\n${preferences.map((item) => `- [${item.status}] ${item.statement}`).join("\n") || "无"}\n\n输出 JSON：{"summary":"如：水弱，土滞","evidence":["短证据"],"explanation":"不超过45字","recommended_action":"water|wood|fire|earth|metal|null","why_this_action":"不超过30字或null","uncertainty":"证据充分时为null，否则说明原因","terrain":{"water":"weak|balanced|strong|stagnant|unknown","wood":"...","fire":"...","earth":"...","metal":"..."}}`
    ));
    if (!Array.isArray(result.evidence) || !result.terrain) throw new Error("model-diagnosis-invalid");
    if (result.recommended_action && !ACTIONS[result.recommended_action]) throw new Error("model-action-invalid");
    return result;
  }

  async rewrite({ text, action, preferences }) {
    const result = extractJson(await this.complete(
      "你是写作改稿编辑。保留原文意图、长度级别和第一人称，不写泛化鸡汤，不凭空捏造事实；需要真实信息时使用方括号占位。只输出 JSON。",
      `原文：\n${text}\n\n动作：${ACTIONS[action].label}——${ACTIONS[action].meaning}\n\n可参考的创作偏好：\n${preferences.map((item) => `- [${item.status}] ${item.statement}`).join("\n") || "无"}\n\n输出 JSON：{"text":"改写后的完整文本","exchange":"这次得到什么，放下什么","learned_judgment":"一句可由用户确认或否决的偏好归纳"}`
    ));
    if (!result.text || !result.exchange || !result.learned_judgment) throw new Error("model-revision-invalid");
    result.preference_context = preferences.map((item) => item.statement);
    return result;
  }
}

export class WuxingEngine {
  constructor({ store = new MemoryWuxingStore(), provider = new PresetWritingProvider(), now = () => new Date(), id = randomUUID, onEvent = null } = {}) {
    this.store = store;
    this.provider = provider;
    this.now = now;
    this.id = id;
    this.onEvent = onEvent;
  }

  emit(state, type, session, data = {}) {
    const event = {
      schema_version: SCHEMA_VERSION,
      event_id: `evt_${this.id()}`,
      event_type: type,
      occurred_at: this.now().toISOString(),
      session_id: session.session_id,
      data
    };
    state.events.push(event);
    this.onEvent?.(clone(event));
    return event;
  }

  async start(text) {
    const normalized = String(text || "").trim();
    if (normalized.length < 20) throw new Error("text-too-short");
    const state = this.store.read();
    const preferences = state.preferences.filter((item) => item.status !== "deleted");
    const session = {
      schema_version: SCHEMA_VERSION,
      session_id: `wuxing_${this.id()}`,
      status: "diagnosed",
      created_at: this.now().toISOString(),
      original_text: normalized,
      preference_context: preferences.map((item) => ({ preference_id: item.preference_id, statement: item.statement, status: item.status })),
      diagnosis: await this.provider.diagnose({ text: normalized, preferences }),
      interventions: [],
      decision: null
    };
    state.sessions.push(session);
    this.emit(state, "diagnosis.ready", session, { diagnosis: session.diagnosis, preference_context: session.preference_context });
    if (session.diagnosis.recommended_action) this.emit(state, "judgment.requested", session, { recommended_action: session.diagnosis.recommended_action });
    this.store.write(state);
    return clone(session);
  }

  async intervene(sessionId, action) {
    if (!ACTIONS[action]) throw new Error("unknown-action");
    const state = this.store.read();
    const session = state.sessions.find((item) => item.session_id === sessionId);
    if (!session) throw new Error("session-not-found");
    if (session.diagnosis.uncertainty) throw new Error("diagnosis-uncertain");
    const preferences = state.preferences.filter((item) => item.status !== "deleted");
    const output = await this.provider.rewrite({ text: session.original_text, action, diagnosis: session.diagnosis, preferences });
    const intervention = { action, action_label: ACTIONS[action].label, created_at: this.now().toISOString(), ...output };
    session.interventions.push(intervention);
    session.status = "revised";
    this.emit(state, "intervention.selected", session, { action });
    this.emit(state, "revision.ready", session, { action, exchange: output.exchange, learned_judgment: output.learned_judgment });
    this.store.write(state);
    return clone(intervention);
  }

  judge(sessionId, { accepted, feedback = "" } = {}) {
    const state = this.store.read();
    const session = state.sessions.find((item) => item.session_id === sessionId);
    const intervention = session?.interventions.at(-1);
    if (!session || !intervention) throw new Error("revision-not-found");
    session.decision = { accepted: Boolean(accepted), feedback: String(feedback).trim(), decided_at: this.now().toISOString() };
    session.status = accepted ? "accepted" : "rejected";
    if (accepted) {
      let preference = state.preferences.find((item) => item.action === intervention.action && item.statement === intervention.learned_judgment && item.status !== "deleted");
      if (preference) {
        preference.confirmations += 1;
        preference.status = preference.confirmations >= 2 ? "stable" : "candidate";
        preference.updated_at = this.now().toISOString();
      } else {
        preference = {
          schema_version: SCHEMA_VERSION,
          preference_id: `pref_${this.id()}`,
          action: intervention.action,
          statement: intervention.learned_judgment,
          status: "candidate",
          confirmations: 1,
          created_at: this.now().toISOString(),
          updated_at: this.now().toISOString()
        };
        state.preferences.push(preference);
      }
      session.preference_id = preference.preference_id;
      this.emit(state, "preference.accepted", session, { preference: clone(preference) });
    } else {
      this.emit(state, "preference.rejected", session, { action: intervention.action, feedback: session.decision.feedback });
    }
    this.store.write(state);
    return clone(session);
  }

  getSession(sessionId) { return this.store.read().sessions.find((item) => item.session_id === sessionId) || null; }
  listPreferences() { return this.store.read().preferences.filter((item) => item.status !== "deleted"); }
  listEvents({ after = 0 } = {}) { return this.store.read().events.slice(after); }
}
