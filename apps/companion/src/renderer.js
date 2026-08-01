const pet = document.getElementById("pet");
const panel = document.getElementById("panel");
const close = document.getElementById("close");
const tracked = document.getElementById("tracked");
const awards = document.getElementById("awards");
const panelAgent = document.getElementById("panelAgent");
const taskSummary = document.getElementById("taskSummary");
const customAvatar = document.getElementById("customAvatar");
const defaultAvatar = document.getElementById("defaultAvatar");
const avatarHint = document.getElementById("avatarHint");
const chooseAvatar = document.getElementById("chooseAvatar");
const resetAvatar = document.getElementById("resetAvatar");
const autostart = document.getElementById("autostart");
const dragHandle = document.getElementById("dragHandle");
let previousAwardSignature = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function render(payload) {
  const session = payload.sessions[0];
  const displayName = session ? `${session.agent_id} · ${session.runtime.id}` : "Agent 休息中";
  panelAgent.textContent = displayName;
  taskSummary.textContent = session?.current_task?.summary || (session
    ? "Agent 在线，正在等待新的工作事件。"
    : "伙伴常驻在这里，等待 Agent 的下一次心跳。");
  pet.classList.toggle("online", Boolean(session));
  pet.title = session ? `${displayName} 正在工作` : "Agent 休息中 · 点击查看成就";
  customAvatar.hidden = !payload.avatar?.dataUrl;
  defaultAvatar.hidden = Boolean(payload.avatar?.dataUrl);
  if (payload.avatar?.dataUrl && customAvatar.src !== payload.avatar.dataUrl) customAvatar.src = payload.avatar.dataUrl;
  avatarHint.textContent = payload.avatar?.dataUrl ? "自定义形象 · Agent 也可以替你生成" : "默认小奖杯";
  tracked.innerHTML = payload.tracked.length
    ? payload.tracked.map((item) => `
      <article>
        <div><b>${escapeHtml(item.title)}</b><em>${item.current}/${item.target}</em></div>
        <p>${escapeHtml(item.encouragement)}</p>
        <span class="bar"><i style="width:${Math.min(100, item.current / item.target * 100)}%"></i></span>
      </article>`).join("")
    : "<p class='empty'>没有主动追踪的成就，Agent 会按任务本身工作。</p>";
  awards.innerHTML = payload.awards.length
    ? payload.awards.map((item) => `
      <article class="award">
        <div><b>🏆 ${escapeHtml(item.title)}</b></div>
        <p>${escapeHtml(item.human_feedback || "这项工作得到了人的认可。")}</p>
      </article>`).join("")
    : "<p class='empty'>还没有新奖杯。真实工作会慢慢填满这里。</p>";
  const awardSignature = payload.awards.map((item) => item.achievement_id).join("|");
  if (previousAwardSignature !== null && awardSignature !== previousAwardSignature) {
    pet.classList.remove("celebrate");
    requestAnimationFrame(() => pet.classList.add("celebrate"));
    setTimeout(() => pet.classList.remove("celebrate"), 1600);
  }
  previousAwardSignature = awardSignature;
}

pet.addEventListener("click", () => window.agentCompanion.toggle());
pet.addEventListener("mouseenter", () => window.agentCompanion.hover(true));
pet.addEventListener("mouseleave", () => window.agentCompanion.hover(false));
dragHandle.addEventListener("mouseenter", () => window.agentCompanion.hover(true));
dragHandle.addEventListener("mouseleave", () => window.agentCompanion.hover(false));
panel.addEventListener("mouseenter", () => window.agentCompanion.hover(true));
panel.addEventListener("mouseleave", () => window.agentCompanion.hover(false));
close.addEventListener("click", () => window.agentCompanion.collapse());
chooseAvatar.addEventListener("click", () => window.agentCompanion.chooseAvatar());
resetAvatar.addEventListener("click", () => window.agentCompanion.resetAvatar());
autostart.addEventListener("change", () => window.agentCompanion.setAutostart(autostart.checked));
window.agentCompanion.getAutostart().then((enabled) => { autostart.checked = enabled; });
window.agentCompanion.onState(render);
window.agentCompanion.onExpanded((expanded) => {
  pet.hidden = expanded;
  panel.classList.toggle("visible", expanded);
  panel.setAttribute("aria-hidden", String(!expanded));
});
