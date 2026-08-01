const pet = document.getElementById("pet");
const panel = document.getElementById("panel");
const close = document.getElementById("close");
const tracked = document.getElementById("tracked");
const awards = document.getElementById("awards");
const agentName = document.getElementById("agentName");
const panelAgent = document.getElementById("panelAgent");
const taskSummary = document.getElementById("taskSummary");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function render(payload) {
  const session = payload.sessions[0];
  const displayName = session ? `${session.agent_id} · ${session.runtime.id}` : "Agent 醒着";
  agentName.textContent = displayName;
  panelAgent.textContent = displayName;
  taskSummary.textContent = session?.current_task?.summary || "Agent 在线，正在等待新的工作事件。";
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
}

pet.addEventListener("click", () => window.agentCompanion.toggle());
close.addEventListener("click", () => window.agentCompanion.collapse());
window.agentCompanion.onState(render);
window.agentCompanion.onExpanded((expanded) => {
  pet.hidden = expanded;
  panel.classList.toggle("visible", expanded);
  panel.setAttribute("aria-hidden", String(!expanded));
});

