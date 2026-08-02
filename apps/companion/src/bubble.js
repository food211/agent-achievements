const notification = document.getElementById("notification");
const chat = document.getElementById("chat");
const mark = document.getElementById("mark");
const title = document.getElementById("title");
const body = document.getElementById("body");
const workspace = document.getElementById("workspace");
const messages = document.getElementById("messages");
const activity = document.getElementById("activity");
const form = document.getElementById("form");
const input = document.getElementById("input");
const close = document.getElementById("close");
const newConversation = document.getElementById("new-conversation");
const marks = { award: "奖", claim: "候", reply: "水", error: "止" };
let mode = "notification";
let latestState = null;
let followLatest = true;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function renderState(payload) {
  latestState = payload;
  const previousScrollTop = messages.scrollTop;
  const shouldFollow = mode !== "chat" || followLatest;
  const session = (payload.sessions || []).find((item) => item.agent_id === payload.focusAgentId && item.workspace === payload.focusWorkspace && (!payload.focusRuntimeId || item.runtime?.id === payload.focusRuntimeId))
    || payload.sessions?.[0];
  const repository = session?.workspace?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "当前仓库";
  workspace.textContent = `${repository}${payload.agentConversation?.adapter_label ? ` · ${payload.agentConversation.adapter_label}` : ""}`;
  const conversation = payload.agentConversation;
  const busy = ["connecting", "streaming"].includes(conversation?.status);
  const unavailable = conversation?.status === "offline";
  activity.textContent = conversation?.error || conversation?.activity || (session ? "等待你的消息" : "等待 Code Agent 连接");
  input.disabled = busy || unavailable || !session?.workspace;
  form.querySelector("button").disabled = input.disabled;
  const items = [...(conversation?.messages || [])];
  if (conversation?.status === "streaming" && conversation.output) items.push({ role: "assistant", text: conversation.output, live: true });
  messages.innerHTML = items.length
    ? items.map((item) => `<article class="message ${item.role === "user" ? "user" : "agent"}${item.live ? " live" : ""}"><small>${item.role === "user" ? "你" : "Agent"}</small><p>${escapeHtml(item.text)}</p></article>`).join("")
    : `<p class="empty">${session ? "想让 Agent 做什么？" : "打开一个 Code Agent 工作区后，就能从这里和它说话。"}</p>`;
  if (shouldFollow) messages.scrollTop = messages.scrollHeight;
  else messages.scrollTop = previousScrollTop;
}

function setMode(next) {
  mode = next === "chat" ? "chat" : "notification";
  notification.hidden = mode !== "notification";
  chat.hidden = mode !== "chat";
  if (mode === "chat") {
    followLatest = true;
    if (latestState) renderState(latestState);
    requestAnimationFrame(() => input.focus());
  }
}

document.body.classList.toggle("theme-light", localStorage.getItem("companion-theme") === "light");
window.companionBubble.onMode(setMode);
function applyPlacement(placement) {
  const side = placement?.side || "left";
  const anchorY = Number(placement?.anchorY) || 42;
  for (const surface of [notification, chat]) {
    surface.dataset.side = side;
    surface.style.setProperty("--tail-y", `${anchorY - 8}px`);
  }
}
window.companionBubble.onPlacement(applyPlacement);
window.companionBubble.onMessage((message) => {
  notification.dataset.kind = message.kind || "reply";
  applyPlacement(message);
  mark.textContent = marks[message.kind] || "水";
  title.textContent = message.title || "五行助手";
  body.textContent = message.body || "有一条新消息";
});
window.companionBubble.onState(renderState);
notification.addEventListener("click", () => window.companionBubble.open());
close.addEventListener("click", () => window.companionBubble.dismiss());
newConversation.addEventListener("click", async () => {
  newConversation.disabled = true;
  try {
    const result = await window.companionBubble.newAgentConversation();
    if (result?.created) {
      followLatest = true;
      activity.textContent = "新对话已准备好";
      requestAnimationFrame(() => input.focus());
    }
  } catch (error) {
    activity.textContent = String(error?.message || "").includes("prompt-in-progress")
      ? "Agent 正在回复，请稍后再新建对话"
      : `新建对话失败：${error?.message || "请重试"}`;
  } finally {
    newConversation.disabled = false;
  }
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  followLatest = true;
  input.disabled = true;
  form.querySelector("button").disabled = true;
  activity.textContent = "正在发送…";
  try {
    await window.companionBubble.sendAgentMessage(text);
    input.value = "";
  } catch (error) {
    activity.textContent = `发送失败：${error?.message || "请重试"}`;
    input.disabled = false;
    form.querySelector("button").disabled = false;
  }
});
messages.addEventListener("scroll", () => {
  const distanceFromBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
  followLatest = distanceFromBottom <= 24;
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") window.companionBubble.dismiss(); });
