import "./styles.css";

const labels = {
  direct_conflict: ["直接冲突", "一份直接证据就该改"],
  repeated_friction: ["反复阻碍", "多次出现后再提"],
  automation_boundary: ["先停下来", "影响数据，交给人定"]
};
const relationLabels = {
  fire_overcomes_metal: "火克金",
  metal_overcomes_wood: "金克木",
  water_overcomes_fire: "水克火"
};

const themeToggle = document.getElementById("themeToggle");
const metrics = document.getElementById("metrics");
const findingList = document.getElementById("findingList");
const detailPanel = document.getElementById("detailPanel");
const resetDemo = document.getElementById("resetDemo");
let findings = [];
let selectedId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "request-failed");
  return body;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("wuxing-harness-theme", theme);
  themeToggle.textContent = theme === "dark" ? "浅色" : "深色";
}

applyTheme(localStorage.getItem("wuxing-harness-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
themeToggle.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

function renderMetrics(value) {
  metrics.innerHTML = [
    [value.rules_examined, "条规则被对照"],
    [value.findings_raised, "项问题带着证据"],
    [value.pending_decisions, "项等你判断"]
  ].map(([number, label]) => `<div><strong>${number}</strong><span>${label}</span></div>`).join("");
}

function renderList() {
  findingList.innerHTML = findings.map((finding, index) => {
    const [kind] = labels[finding.kind];
    const status = finding.status === "applied" ? "已覆盖" : finding.status === "rejected" ? "已保留" : "待判断";
    return `<button class="finding-item ${selectedId === finding.finding_id ? "selected" : ""} ${finding.status}" data-id="${escapeHtml(finding.finding_id)}">
      <span class="finding-index">0${index + 1}</span>
      <span><small>${kind} · ${relationLabels[finding.relation]}</small><b>${escapeHtml(finding.title)}</b><em>${status}</em></span>
    </button>`;
  }).join("");
}

function renderDetail() {
  const finding = findings.find((item) => item.finding_id === selectedId);
  if (!finding) return;
  const [kind, threshold] = labels[finding.kind];
  const settled = finding.status !== "pending";
  detailPanel.innerHTML = `
    <header class="detail-head"><div><span class="kind-tag">${kind}</span><span class="relation-tag">${relationLabels[finding.relation]}</span><h2>${escapeHtml(finding.title)}</h2><p>${threshold}</p></div><span class="status ${finding.status}">${finding.status === "applied" ? "旧规则已覆盖" : finding.status === "rejected" ? "这次不改" : "等你判断"}</span></header>
    <section class="rule-block"><small>现在的规则 · ${escapeHtml(finding.rule.path)}</small><blockquote>${escapeHtml(finding.rule.text)}</blockquote><p>当初是为了：${escapeHtml(finding.rule.rationale)}</p></section>
    <div class="expectation-grid"><section><small>原本希望</small><p>${escapeHtml(finding.expected_outcome)}</p></section><section><small>实际发生</small><p>${escapeHtml(finding.observed_outcome)}</p></section></div>
    <section class="evidence-block"><small>触发 ${finding.trigger_count} 次 · ${finding.contradiction_count} 次结果与预期相反 · 证据 ${finding.evidence.length} 条</small>${finding.evidence.map((item) => `<article><span>${escapeHtml(item.type)}</span><div><b>${escapeHtml(item.summary)}</b><code>${escapeHtml(item.ref)}</code></div></article>`).join("")}</section>
    <section class="proposal-block"><small>建议直接替换成</small><blockquote>${escapeHtml(finding.proposal.replacement)}</blockquote><div><p><b>为什么改</b>${escapeHtml(finding.proposal.reason)}</p><p><b>影响哪里</b>${escapeHtml(finding.proposal.impact_scope)}</p><p><b>怎么恢复</b>${escapeHtml(finding.proposal.reversibility)}</p></div></section>
    ${settled ? `<p class="settled-note">${finding.status === "applied" ? "你批准了这项修改。旧规则已经被新文本覆盖，历史留在版本控制里。" : "你保留了原规则。这项发现仍在记录中，不会悄悄变成修改。"}</p>` : `<div class="decision-bar"><button class="approve" data-decision="approve">批准并覆盖</button><button data-decision="reject">先不改</button><small>Harness 不会替你做这个判断</small></div>`}
  `;
}

async function load() {
  const [findingData, metricData] = await Promise.all([api("/api/wuxing/findings"), api("/api/wuxing/metrics")]);
  findings = findingData.findings;
  selectedId = findings.find((item) => item.status === "pending")?.finding_id || findings[0]?.finding_id || null;
  renderMetrics(metricData);
  renderList();
  renderDetail();
}

findingList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-id]");
  if (!item) return;
  selectedId = item.dataset.id;
  renderList();
  renderDetail();
});

detailPanel.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-decision]");
  if (!button || !selectedId) return;
  button.disabled = true;
  try {
    const result = await api(`/api/wuxing/findings/${encodeURIComponent(selectedId)}/decision`, { method: "POST", body: JSON.stringify({ decision: button.dataset.decision }) });
    const current = findings.find((item) => item.finding_id === selectedId);
    current.status = result.finding.status === "approved" ? "applied" : result.finding.status;
    renderMetrics(result.metrics);
    renderList();
    renderDetail();
  } catch {
    button.disabled = false;
  }
});

resetDemo.addEventListener("click", async () => {
  resetDemo.disabled = true;
  try {
    const data = await api("/api/wuxing/demo/reset", { method: "POST", body: "{}" });
    findings = data.findings;
    selectedId = findings[0]?.finding_id || null;
    renderMetrics(data.metrics);
    renderList();
    renderDetail();
  } finally {
    resetDemo.disabled = false;
  }
});

load().catch(() => {
  detailPanel.innerHTML = '<div class="empty-state"><b>没有连上 Harness</b><p>请先启动本地服务，再刷新这里。</p></div>';
});
