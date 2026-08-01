const ACTIONS = {
  water: ["引水", "加入可感知的具体经历、场景、关系或身体感受"],
  wood: ["生枝", "长出一个有意外感的角度或联想"],
  fire: ["点火", "更早给出有推动力的判断"],
  earth: ["落土", "把抽象感慨替换成可验证、可触摸的细节"],
  metal: ["修枝", "删除冗余、过度修辞和失真的情绪"],
} as const;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function extractJson(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model-json-invalid");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function safePreferences(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const statement = String(source.statement || "").trim().slice(0, 200);
    if (!statement) return [];
    return [{ action: String(source.action || "").slice(0, 20), statement, status: source.status === "stable" ? "stable" : "candidate" }];
  });
}

function uncertainDiagnosis() {
  return {
    summary: "这段我还看不准",
    evidence: [],
    explanation: "还没找到能撑住判断的句子。",
    recommended_action: null,
    why_this_action: null,
    uncertainty: "先不改。换一段文字，或者再补一点细节。",
    terrain: { water: "unknown", wood: "unknown", fire: "unknown", earth: "unknown", metal: "unknown" },
  };
}

function validDiagnosis(value: unknown, sourceText: string) {
  if (!value || typeof value !== "object") return uncertainDiagnosis();
  const result = value as Record<string, unknown>;
  const evidence = Array.isArray(result.evidence) ? result.evidence.filter((item): item is string => typeof item === "string").slice(0, 2) : [];
  const action = result.recommended_action;
  if (result.uncertainty) return uncertainDiagnosis();
  if (!evidence.length || evidence.some((item) => !sourceText.includes(item)) || (action !== null && !Object.hasOwn(ACTIONS, String(action)))) return uncertainDiagnosis();
  return {
    summary: String(result.summary || "").slice(0, 40),
    evidence,
    explanation: String(result.explanation || "").slice(0, 100),
    recommended_action: action,
    why_this_action: String(result.why_this_action || "").slice(0, 80),
    uncertainty: null,
    terrain: result.terrain,
  };
}

function validRevision(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("model-revision-invalid");
  const result = value as Record<string, unknown>;
  const text = String(result.text || "").trim();
  const exchange = String(result.exchange || "").trim();
  const learned = String(result.learned_judgment || "").trim();
  if (!text || !exchange || !learned) throw new Error("model-revision-invalid");
  return { text: text.slice(0, 12000), exchange: exchange.slice(0, 200), learned_judgment: learned.slice(0, 240) };
}

async function complete(system: string, user: string) {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!authToken && !apiKey) throw new Error("model-key-missing");
  const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  if (apiKey) headers["x-api-key"] = apiKey;
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-opus-5", max_tokens: 1800, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
  });
  if (!response.ok) throw new Error(`model-request-failed:${response.status}`);
  const payload = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return extractJson(payload.content?.filter((item) => item.type === "text").map((item) => item.text || "").join("\n") || "");
}

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 64 * 1024) return json({ error: "request-too-large" }, 413);
    const body = await request.json() as Record<string, unknown>;
    const text = String(body.text || "").trim();
    if (text.length < 20) return json({ error: "text-too-short" }, 400);
    if (text.length > 8000) return json({ error: "text-too-long" }, 400);
    const preferences = safePreferences(body.preferences);
    if (body.operation === "diagnose") {
      const result = await complete(
        "你是写作诊断编辑。五行只描述当前作品：水是现实感知与具体现场，木是新角度与可能性，火是判断与推进，土是事实与结构，金是取舍与边界。绝不分析作者人格、命理或固定类型。只输出 JSON。",
        `从原文引用一到两处短证据，只给一个主判断。找不到证据就明确说看不准，不得编造。\n\n原文：\n${text}\n\n创作偏好：\n${JSON.stringify(preferences)}\n\n输出 JSON：{"summary":"如：水弱，土滞","evidence":["短证据"],"explanation":"不超过45字","recommended_action":"water|wood|fire|earth|metal|null","why_this_action":"不超过30字或null","uncertainty":"证据充分时为null，否则用自然语言说明","terrain":{"water":"weak|balanced|strong|stagnant|unknown","wood":"weak|balanced|strong|stagnant|unknown","fire":"weak|balanced|strong|stagnant|unknown","earth":"weak|balanced|strong|stagnant|unknown","metal":"weak|balanced|strong|stagnant|unknown"}}`,
      );
      return json(validDiagnosis(result, text));
    }
    if (body.operation === "rewrite") {
      const action = String(body.action) as keyof typeof ACTIONS;
      if (!ACTIONS[action]) return json({ error: "unknown-action" }, 400);
      const [label, instruction] = ACTIONS[action];
      const result = await complete(
        "你是写作改稿编辑。保留原文意图、长度级别和第一人称，不写泛化鸡汤，不凭空捏造事实。需要真实信息时使用方括号占位。只输出 JSON。",
        `原文：\n${text}\n\n动作：${label}。${instruction}\n\n当前诊断：\n${JSON.stringify(body.diagnosis)}\n\n创作偏好：\n${JSON.stringify(preferences)}\n\n输出 JSON：{"text":"改写后的完整文本","exchange":"这次得到什么，放下什么","learned_judgment":"一句可由用户确认或否决的偏好归纳"}`,
      );
      return json(validRevision(result));
    }
    return json({ error: "unknown-operation" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "request-failed";
    return json({ error: message }, message.includes("missing") ? 503 : 502);
  }
}
