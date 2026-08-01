const pet = document.getElementById("pet");
const statusDot = pet.querySelector(".status-dot");
const panel = document.getElementById("panel");
const close = document.getElementById("close");
const tracked = document.getElementById("tracked");
const awards = document.getElementById("awards");
const catalog = document.getElementById("catalog");
const collectionCount = document.getElementById("collectionCount");
const totalScore = document.getElementById("totalScore");
const panelAgent = document.getElementById("panelAgent");
const taskSummary = document.getElementById("taskSummary");
const customAvatar = document.getElementById("customAvatar");
const defaultAvatar = document.getElementById("defaultAvatar");
const avatarHint = document.getElementById("avatarHint");
const chooseAvatar = document.getElementById("chooseAvatar");
const resetAvatar = document.getElementById("resetAvatar");
const autostart = document.getElementById("autostart");
const openForge = document.getElementById("openForge");
const closeForge = document.getElementById("closeForge");
const forge = document.getElementById("forge");
const achievementForm = document.getElementById("achievementForm");
const badgePreview = document.getElementById("badgePreview");
const titlePreview = document.getElementById("titlePreview");
const rarityPreview = document.getElementById("rarityPreview");
const formMessage = document.getElementById("formMessage");
const editorTitle = document.getElementById("editorTitle");
const editorList = document.getElementById("editorList");
const newAchievement = document.getElementById("newAchievement");
const saveAchievement = document.getElementById("saveAchievement");
const trackingMessage = document.getElementById("trackingMessage");
const designBrief = document.getElementById("designBrief");
const requestDesign = document.getElementById("requestDesign");
const designRequests = document.getElementById("designRequests");
const designMessage = document.getElementById("designMessage");
const diagnosticCard = document.getElementById("diagnosticCard");
const diagnosticSummary = document.getElementById("diagnosticSummary");
const diagnosticDiscoveries = document.getElementById("diagnosticDiscoveries");
const requestDiagnostic = document.getElementById("requestDiagnostic");
const catalogTabs = document.getElementById("catalogTabs");
const systemCount = document.getElementById("systemCount");
const humanCount = document.getElementById("humanCount");
const DRAG_THRESHOLD = 5;
const TIER_CONFIG = { bronze: { label: "铜牌", icon: "🥉", points: 10 }, silver: { label: "银牌", icon: "🥈", points: 30 }, gold: { label: "金牌", icon: "🥇", points: 100 } };
let previousAwardSignature = null;
let petGesture = null;
let latestCatalog = [];
let latestDesigns = [];
let editingAchievementId = null;
let catalogOrigin = "system_discovered";
let latestDiagnostic = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function renderCatalog() {
  const items = latestCatalog.filter((item) => item.origin === catalogOrigin);
  for (const button of catalogTabs.querySelectorAll("button[data-origin]")) button.classList.toggle("selected", button.dataset.origin === catalogOrigin);
  catalog.innerHTML = items.length
    ? items.map((item) => `
      <article class="achievement-card tier-${escapeHtml(item.tier)} ${item.awarded ? "unlocked" : "locked"}">
        <span class="achievement-icon">${escapeHtml(item.icon)}</span>
        <div class="achievement-copy"><b>${escapeHtml(item.title)}</b><small>${TIER_CONFIG[item.tier]?.label || "铜牌"} · ${item.points} 分 · ${escapeHtml(item.intent)}</small>${item.source_skill ? `<label>来自 ${escapeHtml(item.source_skill)}</label>` : ""}<i><span style="width:${Math.min(100, item.current / item.target * 100)}%"></span></i></div>
        <em>${item.awarded ? `+${item.points}` : `${item.current}/${item.target}`}</em>
        ${item.tracked ? "<strong>追踪中</strong>" : ""}
        ${item.discovery_reason ? `<p class="discovery-reason">${escapeHtml(item.discovery_reason)}</p>` : ""}
        ${item.editable ? `<div class="card-actions"><button data-action="edit" data-id="${escapeHtml(item.id)}">编辑</button><button data-action="track" data-id="${escapeHtml(item.id)}" data-enabled="${String(!item.tracked)}" ${item.tracking_allowed ? "" : "disabled"}>${item.tracked ? "取消追踪" : "追踪"}</button></div>` : ""}
      </article>`).join("")
    : `<p class='empty collection-empty'>${catalogOrigin === "system_discovered" ? "还没有发现可验证的历史成就。完成初始化回顾后，它们会出现在这里。" : "还没有用户创建的成就，可以从“编辑成就”开始。"}</p>`;
}

function renderDiagnostic(diagnostic) {
  latestDiagnostic = diagnostic;
  const pending = diagnostic?.pending_discoveries || [];
  diagnosticCard.classList.toggle("complete", diagnostic?.status === "settled");
  if (!diagnostic) {
    diagnosticSummary.textContent = "桌宠会请 Agent 检查 Skill、规则和真实成果，只奖励有证据的正向改变。";
    requestDiagnostic.textContent = "开始回顾";
  } else if (diagnostic.status === "pending") {
    diagnosticSummary.textContent = "诊断请求已进入 Agent 上下文。Agent 会在不打断当前任务的前提下回顾真实成果。";
    requestDiagnostic.textContent = "等待 Agent";
  } else if (pending.length) {
    diagnosticSummary.textContent = `已扫描 ${diagnostic.scanned_skills} 个 Skills；高可信成果已自动结算，其余需要你确认。`;
    requestDiagnostic.textContent = "重新回顾";
  } else {
    diagnosticSummary.textContent = `回顾完成：已扫描 ${diagnostic.scanned_skills} 个 Skills，有证据的成果已经收入图鉴。`;
    requestDiagnostic.textContent = "重新回顾";
  }
  requestDiagnostic.disabled = diagnostic?.status === "pending";
  diagnosticDiscoveries.innerHTML = pending.map((item) => `<article><span>${TIER_CONFIG[item.tier]?.icon || "🥉"}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.source_skill)} · ${escapeHtml(item.reason)}</small></div><button data-discovery-id="${escapeHtml(item.discovery_id)}">确认收下</button></article>`).join("");
}

function render(payload) {
  const session = payload.sessions.find((item) => item.status === "active") || payload.sessions[0];
  const isActive = session?.status === "active";
  const isIdle = session?.status === "idle";
  const displayName = session ? `${session.agent_id} · ${session.runtime.id}` : "Agent 休息中";
  panelAgent.textContent = displayName;
  taskSummary.textContent = session?.current_task?.summary || (session
    ? "Agent 在线，正在等待新的工作事件。"
    : "伙伴常驻在这里，等待 Agent 的下一次心跳。");
  pet.classList.toggle("online", isActive);
  pet.classList.toggle("idle", isIdle);
  const statusText = isActive ? "Agent 正在工作" : isIdle ? "Agent 正在等待" : "Agent 离线";
  pet.title = `${statusText} · 点击查看成就`;
  statusDot.title = statusText;
  statusDot.setAttribute("aria-label", statusText);
  customAvatar.hidden = !payload.avatar?.dataUrl;
  defaultAvatar.hidden = Boolean(payload.avatar?.dataUrl);
  if (payload.avatar?.dataUrl && customAvatar.src !== payload.avatar.dataUrl) customAvatar.src = payload.avatar.dataUrl;
  avatarHint.textContent = payload.avatar?.dataUrl ? "自定义形象 · Agent 也可以替你生成" : "默认小奖杯";
  latestCatalog = payload.catalog;
  latestDesigns = payload.designs || [];
  const unlocked = payload.catalog.filter((item) => item.awarded).length;
  collectionCount.textContent = `${unlocked}/${payload.catalog.length} 已解锁`;
  totalScore.textContent = `${payload.score} 积分`;
  systemCount.textContent = payload.catalog.filter((item) => item.origin === "system_discovered").length;
  humanCount.textContent = payload.catalog.filter((item) => item.origin === "human_created").length;
  if (!payload.catalog.some((item) => item.origin === catalogOrigin) && payload.catalog.some((item) => item.origin === "human_created")) catalogOrigin = "human_created";
  renderCatalog();
  renderDiagnostic(payload.diagnostic);
  tracked.innerHTML = payload.tracked.length
    ? payload.tracked.map((item) => `
      <article>
        <div><b>${escapeHtml(item.title)}</b><span><em>${item.current}/${item.target}</em><button class="untrack" data-id="${escapeHtml(item.id)}">取消追踪</button></span></div>
        <p>${escapeHtml(item.encouragement)}</p>
        <span class="bar"><i style="width:${Math.min(100, item.current / item.target * 100)}%"></i></span>
      </article>`).join("")
    : "<p class='empty'>没有主动追踪的成就，Agent 会按任务本身工作。</p>";
  awards.innerHTML = payload.awards.length
    ? payload.awards.map((item) => `
      <article class="award">
        <div><b>${escapeHtml(item.icon)} ${escapeHtml(item.title)}</b><em>+${item.points} 分</em></div>
        <p>${escapeHtml(item.human_feedback || "这项工作得到了人的认可。")}</p>
        ${item.source_skill ? `<small>系统发现 · 来自 ${escapeHtml(item.source_skill)}</small>` : ""}
      </article>`).join("")
    : "<p class='empty'>还没有新奖杯。真实工作会慢慢填满这里。</p>";
  const awardSignature = payload.awards.map((item) => item.achievement_id).join("|");
  if (previousAwardSignature !== null && awardSignature !== previousAwardSignature) {
    if (payload.catalog.some((item) => item.origin === "system_discovered")) { catalogOrigin = "system_discovered"; renderCatalog(); }
    pet.classList.remove("celebrate");
    requestAnimationFrame(() => pet.classList.add("celebrate"));
    setTimeout(() => pet.classList.remove("celebrate"), 1600);
  }
  previousAwardSignature = awardSignature;
  renderDesignRequests(latestDesigns);
  if (forge.classList.contains("visible")) renderEditorList();
}

pet.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  pet.setPointerCapture(event.pointerId);
  petGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  pet.classList.add("pressed");
  window.agentCompanion.dragPrepare();
});
pet.addEventListener("pointermove", (event) => {
  if (!petGesture || event.pointerId !== petGesture.pointerId) return;
  if (!petGesture.dragging) {
    const dx = event.clientX - petGesture.x;
    const dy = event.clientY - petGesture.y;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    petGesture.dragging = true;
    pet.classList.add("dragging");
  }
  window.agentCompanion.dragMove();
});

function finishPetGesture(event, allowClick) {
  if (!petGesture || event.pointerId !== petGesture.pointerId) return;
  const wasDragging = petGesture.dragging;
  petGesture = null;
  pet.classList.remove("pressed", "dragging");
  if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
  window.agentCompanion.dragEnd(wasDragging);
  if (allowClick && !wasDragging) window.agentCompanion.toggle();
}

pet.addEventListener("pointerup", (event) => finishPetGesture(event, true));
pet.addEventListener("pointercancel", (event) => finishPetGesture(event, false));
pet.addEventListener("lostpointercapture", (event) => finishPetGesture(event, false));
pet.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  window.agentCompanion.toggle();
});
pet.addEventListener("mouseenter", () => window.agentCompanion.hover(true));
pet.addEventListener("mouseleave", () => window.agentCompanion.hover(false));
panel.addEventListener("mouseenter", () => window.agentCompanion.hover(true));
panel.addEventListener("mouseleave", () => window.agentCompanion.hover(false));
close.addEventListener("click", () => window.agentCompanion.collapse());
chooseAvatar.addEventListener("click", () => window.agentCompanion.chooseAvatar());
resetAvatar.addEventListener("click", () => window.agentCompanion.resetAvatar());
autostart.addEventListener("change", () => window.agentCompanion.setAutostart(autostart.checked));
window.agentCompanion.getAutostart().then((enabled) => { autostart.checked = enabled; });
function renderEditorList() {
  const editable = latestCatalog.filter((item) => item.editable);
  editorList.innerHTML = editable.length
    ? editable.map((item) => `<button class="${item.id === editingAchievementId ? "selected" : ""}" data-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.icon)}</span><b>${escapeHtml(item.title)}</b><small>${item.tracked ? "追踪中" : `${item.current}/${item.target}`}</small></button>`).join("")
    : "<p class='empty'>还没有成就，请新建第一项。</p>";
}

function renderDesignRequests(items) {
  designRequests.innerHTML = items.length ? items.map((item) => {
    const proposal = item.proposal?.achievement;
    return `<article><span>${item.status === "proposed" ? "草案就绪" : "等待 Agent"}</span><b>${escapeHtml(proposal?.title || item.brief)}</b>${proposal ? `<small>${TIER_CONFIG[proposal.tier]?.icon || "🥉"} ${TIER_CONFIG[proposal.tier]?.label || "铜牌"} · ${TIER_CONFIG[proposal.tier]?.points || 10} 分</small><button data-request-id="${escapeHtml(item.request_id)}">载入草案</button>` : ""}</article>`;
  }).join("") : "";
}

function beginNewAchievement() {
  editingAchievementId = null;
  achievementForm.reset();
  achievementForm.elements.achievement_id.value = "";
  achievementForm.elements.design_request_id.value = "";
  editorTitle.textContent = "新建成就";
  saveAchievement.textContent = "创建成就";
  badgePreview.textContent = "🥉";
  titlePreview.textContent = "新的成就";
  rarityPreview.textContent = "铜牌 · 10 分";
  formMessage.textContent = "";
  renderEditorList();
  achievementForm.elements.title.focus();
}

function beginEditAchievement(achievementId) {
  const item = latestCatalog.find((candidate) => candidate.id === achievementId);
  if (!item?.editable) return beginNewAchievement();
  editingAchievementId = item.id;
  achievementForm.elements.achievement_id.value = item.id;
  achievementForm.elements.tier.value = item.tier;
  achievementForm.elements.title.value = item.title;
  achievementForm.elements.intent.value = item.intent;
  const eventSelect = achievementForm.elements.event_type;
  if (![...eventSelect.options].some((option) => option.value === item.event_type)) eventSelect.add(new Option(`自定义：${item.event_type}`, item.event_type));
  eventSelect.value = item.event_type;
  achievementForm.elements.target.value = item.target;
  achievementForm.elements.encouragement.value = item.encouragement;
  achievementForm.elements.guardrails.value = item.guardrails;
  achievementForm.elements.track.checked = item.tracked;
  editorTitle.textContent = "编辑成就";
  saveAchievement.textContent = "保存修改";
  badgePreview.textContent = item.icon;
  titlePreview.textContent = item.title;
  rarityPreview.textContent = `${TIER_CONFIG[item.tier]?.label || "铜牌"} · ${item.points} 分`;
  formMessage.textContent = "";
  renderEditorList();
}

function setForgeOpen(open, achievementId) {
  forge.classList.toggle("visible", open);
  forge.setAttribute("aria-hidden", String(!open));
  formMessage.textContent = "";
  if (open) {
    if (achievementId) beginEditAchievement(achievementId);
    else if (latestCatalog.some((item) => item.editable)) beginEditAchievement(latestCatalog.find((item) => item.editable).id);
    else beginNewAchievement();
  }
}
openForge.addEventListener("click", () => setForgeOpen(true));
closeForge.addEventListener("click", () => setForgeOpen(false));
newAchievement.addEventListener("click", beginNewAchievement);
editorList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (button) beginEditAchievement(button.dataset.id);
});

async function toggleTracking(achievementId, enabled) {
  trackingMessage.textContent = "正在更新追踪…";
  try {
    const result = await window.agentCompanion.setAchievementTracking(achievementId, enabled);
    trackingMessage.textContent = result.tracking_limit_reached ? "最多同时追踪 3 项，请先取消一项。" : (enabled ? "已开始追踪。" : "已取消追踪。");
  } catch (error) {
    trackingMessage.textContent = `切换失败：${error.message || "请重试"}`;
  }
}
catalog.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "edit") setForgeOpen(true, button.dataset.id);
  if (button.dataset.action === "track") toggleTracking(button.dataset.id, button.dataset.enabled === "true");
});
catalogTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-origin]");
  if (!button) return;
  catalogOrigin = button.dataset.origin;
  renderCatalog();
});
requestDiagnostic.addEventListener("click", async () => {
  diagnosticSummary.textContent = "正在创建回顾请求…";
  try { await window.agentCompanion.requestAchievementDiagnostic(); }
  catch (error) { diagnosticSummary.textContent = `启动失败：${error.message || "请重试"}`; }
});
diagnosticDiscoveries.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-discovery-id]");
  if (!button || !latestDiagnostic) return;
  button.disabled = true;
  button.textContent = "结算中…";
  try { await window.agentCompanion.confirmDiagnosticDiscovery(latestDiagnostic.request_id, button.dataset.discoveryId); }
  catch (error) { diagnosticSummary.textContent = `确认失败：${error.message || "请重试"}`; button.disabled = false; button.textContent = "确认收下"; }
});
tracked.addEventListener("click", (event) => {
  const button = event.target.closest("button.untrack[data-id]");
  if (button) toggleTracking(button.dataset.id, false);
});
achievementForm.addEventListener("input", () => {
  const tier = TIER_CONFIG[achievementForm.elements.tier.value] || TIER_CONFIG.bronze;
  badgePreview.textContent = tier.icon;
  titlePreview.textContent = achievementForm.elements.title.value.trim() || "新的成就";
  rarityPreview.textContent = `${tier.label} · ${tier.points} 分`;
});

requestDesign.addEventListener("click", async () => {
  designMessage.textContent = "正在提交设计委托…";
  try {
    await window.agentCompanion.requestAchievementDesign(designBrief.value);
    designBrief.value = "";
    designMessage.textContent = "已交给 Agent。下次 Agent 读取成就上下文时会返回草案。";
  } catch (error) {
    designMessage.textContent = `委托失败：${error.message || "请填写设计目标"}`;
  }
});
designRequests.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-request-id]");
  if (!button) return;
  const request = latestDesigns.find((item) => item.request_id === button.dataset.requestId);
  const draft = request?.proposal?.achievement;
  if (!draft) return;
  beginNewAchievement();
  achievementForm.elements.design_request_id.value = request.request_id;
  achievementForm.elements.tier.value = draft.tier;
  achievementForm.elements.title.value = draft.title;
  achievementForm.elements.intent.value = draft.intent;
  const eventSelect = achievementForm.elements.event_type;
  if (![...eventSelect.options].some((option) => option.value === draft.event_type)) eventSelect.add(new Option(`自定义：${draft.event_type}`, draft.event_type));
  eventSelect.value = draft.event_type;
  achievementForm.elements.target.value = draft.target;
  achievementForm.elements.encouragement.value = draft.encouragement;
  achievementForm.elements.guardrails.value = (draft.guardrails || []).join("\n");
  achievementForm.dispatchEvent(new Event("input"));
  formMessage.textContent = "Agent 草案已载入，请由人确认后保存。";
});
achievementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(achievementForm);
  formMessage.textContent = editingAchievementId ? "正在保存修改…" : "正在创建成就…";
  try {
    const result = await window.agentCompanion.saveAchievement({
      achievement_id: values.get("achievement_id"),
      design_request_id: values.get("design_request_id"),
      tier: values.get("tier"),
      title: values.get("title"),
      intent: values.get("intent"),
      event_type: values.get("event_type"),
      target: Number(values.get("target")),
      encouragement: values.get("encouragement"),
      guardrails: values.get("guardrails"),
      track: values.get("track") === "on"
    });
    formMessage.textContent = result.tracking_limit_reached
      ? "成就已保存；主动追踪已满 3 项。"
      : (result.created ? "成就已加入图鉴。" : "修改已保存。");
    setTimeout(() => setForgeOpen(false), 850);
  } catch (error) {
    formMessage.textContent = `保存失败：${error.message || "请检查填写内容"}`;
  }
});
window.agentCompanion.onState(render);
window.agentCompanion.onExpanded((expanded) => {
  pet.hidden = expanded;
  panel.classList.toggle("visible", expanded);
  panel.setAttribute("aria-hidden", String(!expanded));
  requestAnimationFrame(() => requestAnimationFrame(() => window.agentCompanion.transitionReady()));
});
