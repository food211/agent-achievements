import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SCHEMA_VERSION = "wuxing-harness/v1";
export const ACHIEVEMENT_SCHEMA_VERSION = "agent-achievements/v1";

export const RELATIONS = Object.freeze({
  fire_overcomes_metal: {
    id: "fire_overcomes_metal",
    label: "火克金",
    meaning: "执行结果推翻旧规则"
  },
  metal_overcomes_wood: {
    id: "metal_overcomes_wood",
    label: "金克木",
    meaning: "人的判断砍掉不合适的方案"
  },
  water_overcomes_fire: {
    id: "water_overcomes_fire",
    label: "水克火",
    meaning: "现实信号中止正在跑的行动"
  }
});

export const FINDING_KINDS = Object.freeze({
  direct_conflict: {
    id: "direct_conflict",
    label: "规则与事实冲突",
    relation: "fire_overcomes_metal",
    minimum_evidence: 1
  },
  repeated_friction: {
    id: "repeated_friction",
    label: "规则反复造成阻碍",
    relation: "fire_overcomes_metal",
    minimum_evidence: 2
  },
  automation_boundary: {
    id: "automation_boundary",
    label: "自动行为需要人判断",
    relation: "water_overcomes_fire",
    minimum_evidence: 1
  }
});

export const DEMO_INVENTORY = Object.freeze([
  { path: ".claude/rules/data-integrity.md", kind: "rule", summary: "数据关系与事件抽取约束" },
  { path: ".claude/rules/browser-testing.md", kind: "rule", summary: "前端改动的浏览器验收要求" },
  { path: "AGENTS.md", kind: "rule", summary: "自动任务和外部数据同步边界" },
  { path: "server/src", kind: "code", summary: "当前实现" },
  { path: "tests", kind: "test", summary: "行为验证" }
]);

export const DEMO_FINDINGS = Object.freeze([
  {
    finding_id: "finding-rule-direction",
    kind: "direct_conflict",
    title: "关系方向的规则描述已经写反",
    rule: {
      path: ".claude/rules/data-integrity.md",
      locator: "关系边来源",
      text: "关系由目标对象指向事件。",
      rationale: "项目初期用它约束数据关系的来源。"
    },
    expected_outcome: "规则准确描述代码和测试共同维护的关系方向。",
    observed_outcome: "代码与测试始终使用相反方向，实际运行没有破坏。",
    trigger_count: 1,
    contradiction_count: 1,
    evidence: [
      { type: "code", ref: "server/src/graph/relations.ts", summary: "关系写入以事件为起点。" },
      { type: "test", ref: "tests/graph-relations.test.ts", summary: "测试断言与当前代码一致。" }
    ],
    proposal: {
      replacement: "关系由事件指向其提及或关联的对象；来源必须能回溯到原始事件。",
      reason: "修正规则描述，不改变已经稳定运行的代码。",
      impact_scope: "数据完整性规则文档，以及后续 Agent 对关系方向的理解。",
      reversibility: "只覆盖一条规则，版本控制可直接恢复。"
    }
  },
  {
    finding_id: "finding-browser-context",
    kind: "repeated_friction",
    title: "浏览器验收规则没有区分是否有人值守",
    rule: {
      path: ".claude/rules/browser-testing.md",
      locator: "前端验证",
      text: "所有前端改动都必须由 Agent 调用浏览器完成验收。",
      rationale: "避免无人托管时只改代码、不看真实页面。"
    },
    expected_outcome: "前端改动能在真实页面里完成闭环。",
    observed_outcome: "人在电脑前时仍强制调用高延迟工具，小改动反复等待，人工截图反馈反而更快。",
    trigger_count: 3,
    contradiction_count: 2,
    evidence: [
      { type: "run", ref: "run:chat-scroll-01", summary: "小改动等待浏览器启动，人工已经能立即反馈。" },
      { type: "run", ref: "run:onboarding-copy-02", summary: "同类验收再次产生等待，没有增加有效证据。" },
      { type: "decision", ref: "decision:attended-browser", summary: "用户明确区分有人值守和无人托管。" }
    ],
    proposal: {
      replacement: "无人托管运行前端任务时，Agent 自行调用浏览器闭环；用户在电脑前时，优先请求截图和目测反馈，只有无法定位的问题再调用浏览器。",
      reason: "保留真实页面验收，同时把执行者和触发条件写准确。",
      impact_scope: "前端小改动的验证方式和工具等待时间。",
      reversibility: "规则文本可单独恢复，不影响浏览器工具本身。"
    }
  },
  {
    finding_id: "finding-automation-gate",
    kind: "automation_boundary",
    title: "补齐历史数据的自动行为缺少产品授权",
    rule: {
      path: "AGENTS.md",
      locator: "自动化边界",
      text: "没有明确产品规则时，Agent 可按数据完整性偏好补齐历史数据。",
      rationale: "希望减少数据缺口。"
    },
    expected_outcome: "自动化只执行已经得到授权、边界清楚的数据改动。",
    observed_outcome: "新增定时任务或外部同步会改动大量既有数据，Agent 的完整性偏好不能替代产品判断。",
    trigger_count: 1,
    contradiction_count: 1,
    evidence: [
      { type: "decision", ref: "decision:automation-boundary", summary: "用户要求实施前先给出建议、理由并询问。" }
    ],
    proposal: {
      replacement: "新增后台定时任务、无人触发的自动行为，或实质改变外部数据同步前，先向用户说明修改建议、理由、影响的数据范围和回退办法，得到确认后再实施。",
      reason: "让现实影响范围先中止行动，再由人决定是否继续。",
      impact_scope: "定时任务、外部同步和大批量历史数据改动。",
      reversibility: "规则可恢复；被它拦下的方案尚未执行，不产生数据回滚成本。"
    }
  }
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function initialState() {
  return { schema_version: SCHEMA_VERSION, audits: [], findings: [], decisions: [], applications: [], events: [] };
}

export class JsonHarnessStore {
  constructor(file) {
    this.file = file;
    this.state = null;
  }

  read() {
    if (this.state) return clone(this.state);
    try {
      this.state = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (this.state.schema_version !== SCHEMA_VERSION) this.state = initialState();
    } catch {
      this.state = initialState();
    }
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

export class MemoryHarnessStore {
  constructor() { this.state = initialState(); }
  read() { return clone(this.state); }
  write(state) { this.state = clone(state); }
}

export function validateFinding(input) {
  const finding = clone(input || {});
  const definition = FINDING_KINDS[finding.kind];
  if (!definition) throw new Error("finding-kind-invalid");
  if (!finding.title || !finding.rule?.path || !finding.rule?.text) throw new Error("finding-rule-incomplete");
  if (!Number.isInteger(finding.trigger_count) || finding.trigger_count < 0 || !Number.isInteger(finding.contradiction_count) || finding.contradiction_count < 0 || finding.contradiction_count > finding.trigger_count) throw new Error("finding-counts-invalid");
  if (!Array.isArray(finding.evidence) || finding.evidence.length < definition.minimum_evidence) throw new Error("finding-evidence-insufficient");
  if (finding.evidence.some((item) => !item.type || !item.ref || !item.summary)) throw new Error("finding-evidence-invalid");
  const proposal = finding.proposal || {};
  if (!proposal.replacement || !proposal.reason || !proposal.impact_scope || !proposal.reversibility) throw new Error("finding-proposal-incomplete");
  finding.relation = definition.relation;
  finding.status = finding.status || "pending";
  return finding;
}

function achievementEvidence(item) {
  const type = { test: "test", decision: "decision_record", run: "trace" }[item.type] || "external";
  return { type, ref: item.ref, summary: item.summary };
}

export function buildAchievementEvent({ harnessEvent, finding, application = null, agentId = "wuxing-agent", taskId, taskType = "rule-maintenance" }) {
  if (!harnessEvent?.event_id || !finding?.finding_id) throw new Error("achievement-event-input-incomplete");
  const eventTypes = {
    "finding.raised": "rule.conflict_detected",
    "finding.approved": "judgment.resolved",
    "finding.rejected": "judgment.resolved",
    "finding.applied": "rule.revised"
  };
  const eventType = eventTypes[harnessEvent.event_type];
  if (!eventType) return null;
  const evidence = (finding.evidence || []).map(achievementEvidence);
  if (application) {
    evidence.push({ type: "decision_record", ref: application.application_id, summary: "人已批准这次规则修改。" });
    for (const item of application.validation || []) evidence.push({ type: "test", ref: item, summary: "规则修改后完成验证。" });
  }
  const status = eventType === "rule.revised" ? "completed" : eventType === "judgment.resolved" ? "completed" : "observed";
  const summary = eventType === "rule.revised"
    ? `已按人的决定修改并验证规则：${finding.title}`
    : eventType === "judgment.resolved"
      ? `人已${finding.status === "rejected" ? "保留原规则" : "批准修改"}：${finding.title}`
      : `发现一条有证据的规则问题：${finding.title}`;
  return {
    schema_version: ACHIEVEMENT_SCHEMA_VERSION,
    event_id: `wuxing:${harnessEvent.event_id}`,
    event_type: eventType,
    occurred_at: harnessEvent.occurred_at,
    source: { system: "wuxing-harness", version: "0.1.0" },
    actor: { agent_id: agentId },
    task: { id: taskId || finding.finding_id, type: taskType },
    outcome: { status, summary },
    evidence,
    extensions: {
      harness_event_id: harnessEvent.event_id,
      finding_id: finding.finding_id,
      relation: finding.relation,
      human_decision_required: true
    }
  };
}

export class WuxingHarnessEngine {
  constructor({ store = new MemoryHarnessStore(), now = () => new Date(), id = randomUUID, onEvent = null } = {}) {
    this.store = store;
    this.now = now;
    this.id = id;
    this.onEvent = onEvent;
  }

  emit(state, type, data = {}) {
    const event = {
      schema_version: SCHEMA_VERSION,
      event_id: `evt_${this.id()}`,
      event_type: type,
      occurred_at: this.now().toISOString(),
      data
    };
    state.events.push(event);
    this.onEvent?.(clone(event));
    return event;
  }

  startAudit({ workspace = "workspace", inventory = [] } = {}) {
    const state = this.store.read();
    const audit = {
      schema_version: SCHEMA_VERSION,
      audit_id: `audit_${this.id()}`,
      workspace: String(workspace),
      status: "collecting",
      started_at: this.now().toISOString(),
      inventory: clone(inventory),
      rules_examined: inventory.filter((item) => item.kind === "rule").length
    };
    state.audits.push(audit);
    this.emit(state, "audit.started", { audit_id: audit.audit_id, workspace: audit.workspace, rules_examined: audit.rules_examined });
    this.store.write(state);
    return clone(audit);
  }

  addFinding(auditId, input) {
    const state = this.store.read();
    const audit = state.audits.find((item) => item.audit_id === auditId);
    if (!audit) throw new Error("audit-not-found");
    const finding = validateFinding({ ...input, finding_id: input.finding_id || `finding_${this.id()}` });
    if (state.findings.some((item) => item.finding_id === finding.finding_id)) throw new Error("finding-id-duplicate");
    finding.schema_version = SCHEMA_VERSION;
    finding.audit_id = auditId;
    finding.created_at = this.now().toISOString();
    state.findings.push(finding);
    this.emit(state, "finding.raised", { audit_id: auditId, finding_id: finding.finding_id, kind: finding.kind, relation: finding.relation });
    this.store.write(state);
    return clone(finding);
  }

  finishAudit(auditId) {
    const state = this.store.read();
    const audit = state.audits.find((item) => item.audit_id === auditId);
    if (!audit) throw new Error("audit-not-found");
    audit.status = "awaiting_decisions";
    audit.completed_at = this.now().toISOString();
    audit.finding_count = state.findings.filter((item) => item.audit_id === auditId).length;
    this.emit(state, "audit.completed", { audit_id: auditId, finding_count: audit.finding_count });
    this.store.write(state);
    return clone(audit);
  }

  decide(findingId, { decision, note = "" } = {}) {
    if (!['approve', 'reject'].includes(decision)) throw new Error("decision-invalid");
    const state = this.store.read();
    const finding = state.findings.find((item) => item.finding_id === findingId);
    if (!finding) throw new Error("finding-not-found");
    if (finding.status !== "pending") throw new Error("finding-already-decided");
    const record = {
      schema_version: SCHEMA_VERSION,
      decision_id: `decision_${this.id()}`,
      finding_id: findingId,
      decision,
      note: String(note).trim(),
      decided_at: this.now().toISOString()
    };
    finding.status = decision === "approve" ? "approved" : "rejected";
    state.decisions.push(record);
    this.emit(state, `finding.${finding.status}`, { finding_id: findingId, decision_id: record.decision_id });
    this.store.write(state);
    return { finding: clone(finding), decision: clone(record) };
  }

  markApplied(findingId, { path: rulePath, before, after, validation = [] } = {}) {
    const state = this.store.read();
    const finding = state.findings.find((item) => item.finding_id === findingId);
    if (!finding) throw new Error("finding-not-found");
    if (finding.status !== "approved") throw new Error("finding-not-approved");
    if (!rulePath || !before || !after) throw new Error("application-incomplete");
    const application = {
      schema_version: SCHEMA_VERSION,
      application_id: `application_${this.id()}`,
      finding_id: findingId,
      path: rulePath,
      before,
      after,
      validation: clone(validation),
      applied_at: this.now().toISOString()
    };
    finding.status = "applied";
    state.applications.push(application);
    this.emit(state, "finding.applied", { finding_id: findingId, application_id: application.application_id, path: rulePath });
    this.store.write(state);
    return clone(application);
  }

  seedDemo() {
    const audit = this.startAudit({ workspace: "真实 Agent 工作区", inventory: DEMO_INVENTORY });
    for (const finding of DEMO_FINDINGS) this.addFinding(audit.audit_id, finding);
    this.finishAudit(audit.audit_id);
    return this.getAudit(audit.audit_id);
  }

  getAudit(auditId) {
    const state = this.store.read();
    const audit = state.audits.find((item) => item.audit_id === auditId);
    if (!audit) return null;
    return { ...clone(audit), findings: clone(state.findings.filter((item) => item.audit_id === auditId)) };
  }

  listFindings({ status } = {}) {
    const findings = this.store.read().findings;
    return clone(status ? findings.filter((item) => item.status === status) : findings);
  }

  listEvents({ after = 0 } = {}) { return this.store.read().events.slice(after); }

  getMetrics() {
    const state = this.store.read();
    return {
      rules_examined: state.audits.reduce((sum, item) => sum + (item.rules_examined || 0), 0),
      findings_raised: state.findings.length,
      pending_decisions: state.findings.filter((item) => item.status === "pending").length,
      approved_changes: state.findings.filter((item) => ["approved", "applied"].includes(item.status)).length,
      applied_changes: state.findings.filter((item) => item.status === "applied").length,
      rejected_changes: state.findings.filter((item) => item.status === "rejected").length,
      direct_conflicts: state.findings.filter((item) => item.kind === "direct_conflict").length,
      repeated_friction: state.findings.filter((item) => item.kind === "repeated_friction").length
    };
  }
}
