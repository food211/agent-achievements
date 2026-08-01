import "./styles.css";

const DEFAULT_SAMPLE = "我们总以为，创作需要更完整的方法、更准确的表达和更稳定的输出。只要不断优化流程，内容自然会变得更好。但真正重要的，也许还是保持耐心，相信时间会给出答案。";
const ACTIONS = [
  ["water", "引水", "加一个真实现场"],
  ["wood", "生枝", "换个角度往下写"],
  ["fire", "点火", "早点把话说出来"],
  ["earth", "落土", "用事实换掉空话"],
  ["metal", "修枝", "删到只剩需要的"]
];

const sourceText = document.getElementById("sourceText");
const diagnoseButton = document.getElementById("diagnose");
const message = document.getElementById("message");
const diagnosis = document.getElementById("diagnosis");
const actions = document.getElementById("actions");
const terrain = document.getElementById("terrain");
const revision = document.getElementById("revision");
const judgment = document.getElementById("judgment");
const learnedJudgment = document.getElementById("learnedJudgment");
const accept = document.getElementById("accept");
const reject = document.getElementById("reject");
const judgmentActions = document.getElementById("judgmentActions");
const judgmentResult = document.getElementById("judgmentResult");
const preferences = document.getElementById("preferences");
const themeToggle = document.getElementById("themeToggle");
let currentSession = null;
let currentIntervention = null;

sourceText.value = DEFAULT_SAMPLE;
actions.innerHTML = ACTIONS.map(([id, label, meaning]) => `<button data-action="${id}"><b>${label}</b><small>${meaning}</small></button>`).join("");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "浅色" : "深色";
  themeToggle.setAttribute("aria-label", `切换到${theme === "dark" ? "浅色" : "深色"}主题`);
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#111b18" : "#ebe7dc";
}

const savedTheme = localStorage.getItem("wuxing-theme");
applyTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("wuxing-theme", next);
  applyTheme(next);
});

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "request-failed");
  return body;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  if (text) button.dataset.original ||= button.textContent;
  button.textContent = busy ? text : button.dataset.original || button.textContent;
}

async function loadPreferences() {
  const data = await api("/api/wuxing/preferences");
  preferences.innerHTML = data.preferences.length ? data.preferences.map((item) => `<article><span>${item.status === "stable" ? "已经记住" : "刚记下"}</span><b>${escapeHtml(item.statement)}</b><small>${escapeHtml(ACTIONS.find(([id]) => id === item.action)?.[1] || item.action)} · 第 ${item.confirmations} 次</small></article>`).join("") : "<p>你收下的判断会先放在这里。相似的选择多了，我才会把它当成偏好。</p>";
}

function renderDiagnosis(value) {
  terrain.dataset.focus = value.recommended_action || "none";
  if (value.uncertainty) {
    diagnosis.className = "diagnosis uncertain";
    diagnosis.innerHTML = `<b>${escapeHtml(value.summary)}</b><p>${escapeHtml(value.uncertainty)}</p>`;
  } else {
    diagnosis.className = "diagnosis";
    diagnosis.innerHTML = `<small>我看到的是</small><h2>${escapeHtml(value.summary)}</h2><p>${escapeHtml(value.explanation)}</p><ul>${value.evidence.map((item) => `<li>“${escapeHtml(item)}”</li>`).join("")}</ul><strong>${escapeHtml(value.why_this_action)}</strong>`;
  }
  for (const button of actions.querySelectorAll("button")) {
    button.disabled = Boolean(value.uncertainty);
    button.classList.toggle("recommended", button.dataset.action === value.recommended_action);
  }
}

diagnoseButton.addEventListener("click", async () => {
  setBusy(diagnoseButton, true, "我在读…");
  message.textContent = "";
  judgment.hidden = true;
  judgmentActions.hidden = false;
  judgmentResult.textContent = "";
  revision.className = "revision empty-state";
  revision.innerHTML = "<b>我在读这段文字</b><p>先找出它卡在哪，再动笔。</p>";
  try {
    currentSession = await api("/api/wuxing/sessions", { method: "POST", body: JSON.stringify({ text: sourceText.value }) });
    currentIntervention = null;
    renderDiagnosis(currentSession.diagnosis);
    revision.innerHTML = "<b>选一个动作</b><p>我标出了最想先试的那个，你也可以选别的。</p>";
  } catch (error) {
    message.textContent = error.message === "text-too-short" ? "再多写一点，我现在还看不出它卡在哪。" : "这次没读出来，再试一次。";
  } finally { setBusy(diagnoseButton, false); }
});

actions.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !currentSession) return;
  for (const item of actions.querySelectorAll("button")) item.classList.toggle("selected", item === button);
  terrain.dataset.focus = button.dataset.action;
  setBusy(button, true, "改稿中…");
  try {
    currentIntervention = await api(`/api/wuxing/sessions/${encodeURIComponent(currentSession.session_id)}/interventions`, { method: "POST", body: JSON.stringify({ action: button.dataset.action }) });
    revision.className = "revision";
    revision.innerHTML = `<small>${escapeHtml(currentIntervention.action_label)}之后</small><p>${escapeHtml(currentIntervention.text)}</p><strong>${escapeHtml(currentIntervention.exchange)}</strong>`;
    learnedJudgment.textContent = currentIntervention.learned_judgment;
    judgment.hidden = false;
  } catch { message.textContent = "这次没改出来，再试一次。"; }
  finally { setBusy(button, false); }
});

async function decide(accepted) {
  if (!currentSession || !currentIntervention) return;
  try {
    await api(`/api/wuxing/sessions/${encodeURIComponent(currentSession.session_id)}/judgment`, { method: "POST", body: JSON.stringify({ accepted, feedback: accepted ? "" : "本次调控没有更接近我" }) });
    judgmentActions.hidden = true;
    judgmentResult.className = accepted ? "judgment-result settled" : "judgment-result rejected";
    judgmentResult.textContent = accepted ? "先放在这里，下次碰到相似的文字再看。" : "好，这次不算。";
    await loadPreferences();
  } catch { message.textContent = "这次没记住，再试一次。"; }
}

accept.addEventListener("click", () => decide(true));
reject.addEventListener("click", () => decide(false));
loadPreferences().catch(() => { preferences.innerHTML = "<p>我还没读到以前的偏好。</p>"; });
