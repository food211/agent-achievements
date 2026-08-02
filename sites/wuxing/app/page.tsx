"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Status = "pending" | "applied" | "rejected";
type Finding = {
  id: string;
  kind: string;
  relation: string;
  title: string;
  rulePath: string;
  rule: string;
  rationale: string;
  expected: string;
  observed: string;
  triggerCount: number;
  contradictionCount: number;
  evidence: Array<{ type: string; ref: string; summary: string }>;
  replacement: string;
  reason: string;
  impact: string;
  reversibility: string;
  status: Status;
};

const INITIAL_FINDINGS: Finding[] = [
  {
    id: "direction",
    kind: "直接冲突",
    relation: "火克金",
    title: "关系方向的规则描述已经写反",
    rulePath: ".claude/rules/data-integrity.md",
    rule: "关系由目标对象指向事件。",
    rationale: "项目初期用它约束数据关系的来源。",
    expected: "规则准确描述代码和测试共同维护的关系方向。",
    observed: "代码与测试始终使用相反方向，实际运行没有破坏。",
    triggerCount: 1,
    contradictionCount: 1,
    evidence: [
      { type: "code", ref: "server/src/graph/relations.ts", summary: "关系写入以事件为起点。" },
      { type: "test", ref: "tests/graph-relations.test.ts", summary: "测试断言与当前代码一致。" },
    ],
    replacement: "关系由事件指向其提及或关联的对象；来源必须能回溯到原始事件。",
    reason: "修正规则描述，不改变已经稳定运行的代码。",
    impact: "数据完整性规则文档，以及后续 Agent 对关系方向的理解。",
    reversibility: "只覆盖一条规则，版本控制可直接恢复。",
    status: "pending",
  },
  {
    id: "browser",
    kind: "反复阻碍",
    relation: "火克金",
    title: "浏览器验收规则没有区分是否有人值守",
    rulePath: ".claude/rules/browser-testing.md",
    rule: "所有前端改动都必须由 Agent 调用浏览器完成验收。",
    rationale: "避免无人托管时只改代码、不看真实页面。",
    expected: "前端改动能在真实页面里完成闭环。",
    observed: "人在电脑前时仍强制调用高延迟工具，小改动反复等待，人工截图反馈反而更快。",
    triggerCount: 3,
    contradictionCount: 2,
    evidence: [
      { type: "run", ref: "run:chat-scroll-01", summary: "小改动等待浏览器启动，人工已经能立即反馈。" },
      { type: "run", ref: "run:onboarding-copy-02", summary: "同类验收再次产生等待，没有增加有效证据。" },
      { type: "decision", ref: "decision:attended-browser", summary: "用户明确区分有人值守和无人托管。" },
    ],
    replacement: "无人托管运行前端任务时，Agent 自行调用浏览器闭环；用户在电脑前时，优先请求截图和目测反馈，只有无法定位的问题再调用浏览器。",
    reason: "保留真实页面验收，同时把执行者和触发条件写准确。",
    impact: "前端小改动的验证方式和工具等待时间。",
    reversibility: "规则文本可单独恢复，不影响浏览器工具本身。",
    status: "pending",
  },
  {
    id: "automation",
    kind: "先停下来",
    relation: "水克火",
    title: "补齐历史数据的自动行为缺少产品授权",
    rulePath: "AGENTS.md",
    rule: "没有明确产品规则时，Agent 可按数据完整性偏好补齐历史数据。",
    rationale: "希望减少数据缺口。",
    expected: "自动化只执行已经得到授权、边界清楚的数据改动。",
    observed: "新增定时任务或外部同步会改动大量既有数据，Agent 的完整性偏好不能替代产品判断。",
    triggerCount: 1,
    contradictionCount: 1,
    evidence: [{ type: "decision", ref: "decision:automation-boundary", summary: "用户要求实施前先给出建议、理由并询问。" }],
    replacement: "新增后台定时任务、无人触发的自动行为，或实质改变外部数据同步前，先向用户说明修改建议、理由、影响的数据范围和回退办法，得到确认后再实施。",
    reason: "让现实影响范围先中止行动，再由人决定是否继续。",
    impact: "定时任务、外部同步和大批量历史数据改动。",
    reversibility: "规则可恢复；被它拦下的方案尚未执行，不产生数据回滚成本。",
    status: "pending",
  },
];

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [findings, setFindings] = useState<Finding[]>(INITIAL_FINDINGS);
  const [selected, setSelected] = useState(INITIAL_FINDINGS[0].id);

  useEffect(() => {
    const storedTheme = localStorage.getItem("wuxing-harness-theme") as "light" | "dark" | null;
    setTheme(storedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    try {
      const stored = JSON.parse(localStorage.getItem("wuxing-harness-demo") || "null");
      if (Array.isArray(stored) && stored.length === INITIAL_FINDINGS.length) setFindings(stored);
    } catch { /* keep the demo fixture */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("wuxing-harness-theme", theme);
  }, [theme]);

  const finding = findings.find((item) => item.id === selected) || findings[0];
  const pending = useMemo(() => findings.filter((item) => item.status === "pending").length, [findings]);

  function decide(status: Status) {
    const next = findings.map((item) => item.id === selected ? { ...item, status } : item);
    setFindings(next);
    localStorage.setItem("wuxing-harness-demo", JSON.stringify(next));
  }

  function reset() {
    const next = INITIAL_FINDINGS.map((item) => ({ ...item, status: "pending" as Status }));
    setFindings(next);
    setSelected(next[0].id);
    localStorage.removeItem("wuxing-harness-demo");
  }

  return (
    <main className="page-shell">
      <header className="masthead">
        <div className="brand-mark" aria-hidden="true"><i /><i /><i /><i /><i /><span>克</span></div>
        <div className="brand-copy"><small>WUXING AGENT HARNESS</small><h1>五行 Harness</h1><p>给 AI 的规则做一次代谢</p></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Link className="quiet-button" style={{ textDecoration: "none" }} href="/install">安装 Skill</Link><button className="quiet-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "浅色" : "深色"}</button></div>
      </header>

      <section className="hero">
        <div><span className="eyebrow">这次审查</span><h2>规则还在，事实已经往前走了。</h2><p>Harness 对照规则、代码、测试和运行记录，把冲突带到你面前。你决定以后，它才会覆盖旧规则。</p></div>
        <div className="metrics" aria-label="审查统计">
          <Metric value="3" label="条规则被对照" />
          <Metric value={String(findings.length)} label="项问题带着证据" />
          <Metric value={String(pending)} label="项等你判断" />
        </div>
      </section>

      <section className="control-map" aria-label="五行 Harness 当前实现">
        <Control element="火" className="fire" title="执行结果" note="推翻旧规则" />
        <i>克</i>
        <Control element="金" className="metal" title="人的判断" note="批准或砍掉方案" />
        <i>克</i>
        <Control element="木" className="wood" title="修改方案" note="只留下合适的分支" />
        <div className="water-stop"><Control element="水" className="water" title="现实影响先叫停" note="自动任务和数据同步先问人" /></div>
      </section>

      <section className="audit-layout">
        <aside className="findings-panel">
          <div className="section-head"><div><small>待你判断</small><h2>发现的问题</h2></div><button className="quiet-button" onClick={reset}>重新演示</button></div>
          <div className="finding-list">{findings.map((item, index) => <button key={item.id} className={`finding-item ${selected === item.id ? "selected" : ""} ${item.status}`} onClick={() => setSelected(item.id)}><span className="finding-index">0{index + 1}</span><span><small>{item.kind} · {item.relation}</small><b>{item.title}</b><em>{item.status === "applied" ? "已覆盖" : item.status === "rejected" ? "已保留" : "待判断"}</em></span></button>)}</div>
        </aside>

        <article className="detail-panel">
          <header className="detail-head"><div><span className="kind-tag">{finding.kind}</span><span className="relation-tag">{finding.relation}</span><h2>{finding.title}</h2><p>{finding.kind === "直接冲突" ? "一份直接证据就该改" : finding.kind === "反复阻碍" ? "多次出现后再提" : "影响数据，交给人定"}</p></div><span className={`status ${finding.status}`}>{finding.status === "applied" ? "旧规则已覆盖" : finding.status === "rejected" ? "这次不改" : "等你判断"}</span></header>
          <section className="rule-block"><small>现在的规则 · {finding.rulePath}</small><blockquote>{finding.rule}</blockquote><p>当初是为了：{finding.rationale}</p></section>
          <div className="expectation-grid"><section><small>原本希望</small><p>{finding.expected}</p></section><section><small>实际发生</small><p>{finding.observed}</p></section></div>
          <section className="evidence-block"><small>触发 {finding.triggerCount} 次 · {finding.contradictionCount} 次结果与预期相反 · 证据 {finding.evidence.length} 条</small>{finding.evidence.map((item) => <article key={item.ref}><span>{item.type}</span><div><b>{item.summary}</b><code>{item.ref}</code></div></article>)}</section>
          <section className="proposal-block"><small>建议直接替换成</small><blockquote>{finding.replacement}</blockquote><div><p><b>为什么改</b>{finding.reason}</p><p><b>影响哪里</b>{finding.impact}</p><p><b>怎么恢复</b>{finding.reversibility}</p></div></section>
          {finding.status === "pending" ? <div className="decision-bar"><button className="approve" onClick={() => decide("applied")}>批准并覆盖</button><button onClick={() => decide("rejected")}>先不改</button><small>Harness 不会替你做这个判断</small></div> : <p className="settled-note">{finding.status === "applied" ? "你批准了这项修改。旧规则已经被新文本覆盖，历史留在版本控制里。" : "你保留了原规则。这项发现仍在记录中，不会悄悄变成修改。"}</p>}
        </article>
      </section>

      <footer><p><b>这次只做三条克线。</b>完整非阻塞任务队列、木克土、土克水和旺衰诊断还没有做。</p><Link href="/install">安装 Skill</Link></footer>
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function Control({ element, className, title, note }: { element: string; className: string; title: string; note: string }) { return <div><span className={`node ${className}`}>{element}</span><b>{title}</b><small>{note}</small></div>; }
