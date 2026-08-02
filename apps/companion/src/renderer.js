const pet = document.getElementById("pet");
const petStage = document.getElementById("petStage");
const openAchievements = document.getElementById("openAchievements");
const statusDot = pet.querySelector(".status-dot");
const panel = document.getElementById("panel");
const close = document.getElementById("close");
const tracked = document.getElementById("tracked");
const awards = document.getElementById("awards");
const pendingClaims = document.getElementById("pendingClaims");
const catalog = document.getElementById("catalog");
const collectionCount = document.getElementById("collectionCount");
const totalScore = document.getElementById("totalScore");
const autopilotStatus = document.getElementById("autopilotStatus");
const agentLevel = document.getElementById("agentLevel");
const scoreEffect = document.getElementById("scoreEffect");
const behaviorHint = document.getElementById("behaviorHint");
const currentChallenge = document.getElementById("currentChallenge");
const currentChallengeHint = document.getElementById("currentChallengeHint");
const currentChallengeProgress = document.getElementById("currentChallengeProgress");
const currentChallengeCount = document.getElementById("currentChallengeCount");
const nextChallenge = document.getElementById("nextChallenge");
const nextChallengeHint = document.getElementById("nextChallengeHint");
const challengeBoundaries = document.getElementById("challengeBoundaries");
const operatingPriority = document.getElementById("operatingPriority");
const completedTasks = document.getElementById("completedTasks");
const claimMessage = document.getElementById("claimMessage");
const workspaceSelector = document.getElementById("workspaceSelector");
const customAvatar = document.getElementById("customAvatar");
const defaultAvatar = document.getElementById("defaultAvatar");
const avatarHint = document.getElementById("avatarHint");
const chooseAvatar = document.getElementById("chooseAvatar");
const resetAvatar = document.getElementById("resetAvatar");
const autostart = document.getElementById("autostart");
const alwaysOnTop = document.getElementById("alwaysOnTop");
const companionTheme = document.getElementById("companionTheme");
const diagnoseRepository = document.getElementById("diagnoseRepository");
const diagnosisRequestStatus = document.getElementById("diagnosisRequestStatus");
const agentConversation = document.getElementById("agentConversation");
const agentConversationActivity = document.getElementById("agentConversationActivity");
const agentMessages = document.getElementById("agentMessages");
const agentReplyForm = document.getElementById("agentReplyForm");
const agentReply = document.getElementById("agentReply");
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
const suggestedCount = document.getElementById("suggestedCount");
const humanCount = document.getElementById("humanCount");
const DRAG_THRESHOLD = 5;
const TIER_CONFIG = { bronze: { label: "铜牌", icon: "🥉", points: 10 }, silver: { label: "银牌", icon: "🥈", points: 30 }, gold: { label: "金牌", icon: "🥇", points: 100 } };
let previousAwardSignature = null;
let petGesture = null;
let latestCatalog = [];
let latestDesigns = [];
let editingAchievementId = null;
let catalogOrigin = "system_suggested";
let latestDiagnostic = null;
let latestSessions = [];

function applyCompanionTheme(theme) {
  document.body.classList.toggle("theme-light", theme === "light");
  companionTheme.textContent = theme === "light" ? "深色" : "浅色";
  companionTheme.setAttribute("aria-label", `切换到${theme === "light" ? "深色" : "浅色"}主题`);
}

applyCompanionTheme(localStorage.getItem("companion-theme") || "dark");
companionTheme.addEventListener("click", () => {
  const next = document.body.classList.contains("theme-light") ? "dark" : "light";
  localStorage.setItem("companion-theme", next);
  applyCompanionTheme(next);
});

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
    : `<p class='empty collection-empty'>${catalogOrigin === "system_suggested" ? "五行助手正在准备适合当前 Agent 的挑战。" : catalogOrigin === "system_discovered" ? "诊断完成后，有证据的既有成果会出现在这里。" : "这里还没有你创建的成就。"}</p>`;
}

function renderDiagnostic(diagnostic) {
  latestDiagnostic = diagnostic;
  const pending = diagnostic?.pending_discoveries || [];
  diagnosticCard.classList.toggle("complete", diagnostic?.status === "settled");
  if (!diagnostic) {
    diagnosticSummary.textContent = "助手正在创建首次诊断，不需要你操作。";
    requestDiagnostic.textContent = "重新回顾";
  } else if (diagnostic.status === "pending") {
    diagnosticSummary.textContent = "诊断请求已经交给 Agent；它会在不打断当前任务的前提下自动回顾。";
    requestDiagnostic.textContent = "诊断进行中";
  } else if (pending.length) {
    diagnosticSummary.textContent = `看过 ${diagnostic.scanned_skills} 个 Skills。有些已经记下，还有一些等你确认。`;
    requestDiagnostic.textContent = "重新回顾";
  } else {
    diagnosticSummary.textContent = `看完了 ${diagnostic.scanned_skills} 个 Skills，找到的成果已经放进图鉴。`;
    requestDiagnostic.textContent = "重新回顾";
  }
  requestDiagnostic.disabled = diagnostic?.status === "pending";
  diagnosticDiscoveries.innerHTML = pending.map((item) => `<article><span>${TIER_CONFIG[item.tier]?.icon || "🥉"}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.source_skill)} · ${escapeHtml(item.reason)}</small></div><button data-discovery-id="${escapeHtml(item.discovery_id)}">确认收下</button></article>`).join("");
}

function renderAutopilot(automation) {
  const current = automation?.current_challenge;
  const next = automation?.next_challenge;
  const connectionLabels = {
    connected_active: "自动运行 · Agent 活跃",
    connected_idle: "自动运行 · Agent 已连接",
    heartbeat_active: "自动运行 · Agent 活跃",
    heartbeat_idle: "自动运行 · Agent 在线"
  };
  autopilotStatus.textContent = connectionLabels[automation?.connection_status]
    || (automation?.autostart_enabled ? "自动运行 · 等待 Agent" : "自动运行 · 本次会话");
  agentLevel.textContent = automation?.level?.label || "见微";
  scoreEffect.textContent = [automation?.level?.description, automation?.score_effect].filter(Boolean).join(" ") || "积分正在调整推荐挑战";
  behaviorHint.textContent = automation?.behavior_hint || "助手会为当前 Agent 准备合适的下一项挑战。";
  currentChallenge.textContent = current ? `${current.icon} ${current.title}` : "暂时没有新挑战";
  currentChallengeHint.textContent = current?.intent || "已经完成的结果仍会继续记录。";
  currentChallengeProgress.style.width = current ? `${Math.min(100, current.current / current.target * 100)}%` : "0%";
  currentChallengeCount.textContent = current ? `${current.current}/${current.target}` : "";
  nextChallenge.textContent = next ? `${next.icon} ${next.title}` : "等待下一次诊断";
  nextChallengeHint.textContent = next?.intent || "新的可靠证据出现后，助手会继续安排。";
  challengeBoundaries.innerHTML = (current?.guardrails || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>保持用户指令、安全、项目规则和任务正确性的优先级。</li>";
  operatingPriority.textContent = `优先级：${(automation?.operating_priority || []).join(" ＞ ")}`;
  completedTasks.innerHTML = automation?.completed_tasks?.length
    ? automation.completed_tasks.map((item) => `<article class="completed-task"><div><b>${escapeHtml(item.summary)}</b><em>${item.evidence_count} 条证据</em></div><small>${escapeHtml(item.agent_id)} · ${escapeHtml(item.task_type)} · ${new Date(item.completed_at).toLocaleString("zh-CN")}</small></article>`).join("")
    : "<p class='empty'>Agent 完成任务后，结果与证据会自动记在这里。</p>";
}

function render(payload) {
  latestSessions = payload.sessions || [];
  const session = latestSessions.find((item) => item.agent_id === payload.focusAgentId && item.workspace === payload.focusWorkspace && (!payload.focusRuntimeId || item.runtime?.id === payload.focusRuntimeId))
    || latestSessions.find((item) => item.status === "active")
    || latestSessions[0];
  const isActive = session?.status === "active";
  const isIdle = session?.status === "idle";
  const workspaceName = session?.workspace ? session.workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "";
  workspaceSelector.innerHTML = latestSessions.length
    ? latestSessions.map((item, index) => {
      const name = item.workspace ? item.workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : item.runtime.id;
      const selected = item.agent_id === session?.agent_id && item.workspace === session?.workspace && item.runtime?.id === session?.runtime?.id ? " selected" : "";
      return `<option value="${index}"${selected}>${escapeHtml(name)} · ${escapeHtml(item.runtime?.id || item.agent_id)}</option>`;
    }).join("")
    : "<option>Agent 休息中</option>";
  workspaceSelector.disabled = latestSessions.length < 2;
  pet.classList.toggle("online", isActive);
  pet.classList.toggle("idle", isIdle);
  const statusText = isActive ? "Agent 正在工作" : isIdle ? "Agent 正在等待" : "Agent 离线";
  pet.title = `${statusText} · 点击和 Agent 聊天`;
  statusDot.title = statusText;
  statusDot.setAttribute("aria-label", statusText);
  customAvatar.hidden = !payload.avatar?.dataUrl;
  defaultAvatar.hidden = Boolean(payload.avatar?.dataUrl);
  if (payload.avatar?.dataUrl && customAvatar.src !== payload.avatar.dataUrl) customAvatar.src = payload.avatar.dataUrl;
  avatarHint.textContent = payload.avatar?.dataUrl ? "自定义形象 · Agent 也可以替你生成" : "默认五行助手";
  const conversation = payload.agentConversation;
  agentConversation.hidden = !conversation;
  if (conversation) {
    const busy = ["connecting", "streaming"].includes(conversation.status);
    agentConversationActivity.textContent = conversation.error || conversation.activity || "";
    agentReply.disabled = busy;
    agentReplyForm.querySelector("button").disabled = busy;
    const messages = [...(conversation.messages || [])];
    if (conversation.status === "streaming" && conversation.output) messages.push({ role: "assistant", text: conversation.output, live: true });
    agentMessages.innerHTML = messages.map((item) => `<article class="${item.role === "user" ? "from-user" : "from-agent"}${item.live ? " live" : ""}"><small>${item.role === "user" ? "你" : "当前 Agent"}</small><p>${escapeHtml(item.text)}</p></article>`).join("");
    agentMessages.scrollTop = agentMessages.scrollHeight;
  }
  latestCatalog = payload.catalog;
  latestDesigns = payload.designs || [];
  const unlocked = payload.catalog.filter((item) => item.awarded).length;
  collectionCount.textContent = `${unlocked}/${payload.catalog.length} 已解锁`;
  totalScore.textContent = `${payload.score} 积分`;
  renderAutopilot(payload.automation);
  systemCount.textContent = payload.catalog.filter((item) => item.origin === "system_discovered").length;
  suggestedCount.textContent = payload.catalog.filter((item) => item.origin === "system_suggested").length;
  humanCount.textContent = payload.catalog.filter((item) => item.origin === "human_created").length;
  if (!payload.catalog.some((item) => item.origin === catalogOrigin)) {
    catalogOrigin = ["system_suggested", "system_discovered", "human_created"].find((origin) => payload.catalog.some((item) => item.origin === origin)) || "system_suggested";
  }
  renderCatalog();
  renderDiagnostic(payload.diagnostic);
  tracked.innerHTML = payload.tracked.length
    ? payload.tracked.map((item) => `
      <article>
        <div><b>${escapeHtml(item.title)}</b><span><em>${item.current}/${item.target}</em><button class="untrack" data-id="${escapeHtml(item.id)}">取消追踪</button></span></div>
        <p>${escapeHtml(item.encouragement)}</p>
        <span class="bar"><i style="width:${Math.min(100, item.current / item.target * 100)}%"></i></span>
      </article>`).join("")
    : "<p class='empty'>还没有追踪中的成就。</p>";
  awards.innerHTML = payload.awards.length
    ? payload.awards.map((item) => `
      <article class="award">
        <div><b>${escapeHtml(item.icon)} ${escapeHtml(item.title)}</b><em>+${item.points} 分</em></div>
        <p>${escapeHtml(item.human_feedback || "这项有证据的成果已经获得奖杯。")}</p>
        ${item.source_skill ? `<small>系统发现 · 来自 ${escapeHtml(item.source_skill)}</small>` : ""}
      </article>`).join("")
    : "<p class='empty'>最近还没有拿到新成就。</p>";
  pendingClaims.innerHTML = payload.claims?.length
    ? payload.claims.map((item) => `
      <article>
        <div><b>${escapeHtml(item.icon)} ${escapeHtml(item.title)}</b><em>${escapeHtml(item.tier_label)} · ${item.points} 分</em></div>
        <p>${escapeHtml(item.summary)}</p>
        <small>${item.current}/${item.target} · ${escapeHtml(item.evidence_count)} 条证据 · ${escapeHtml(item.eligibility_reason)}</small>
        <details class="claim-evidence"><summary>查看证据</summary><ul>${item.evidence.map((evidence) => `<li><b>${escapeHtml(evidence.type)}</b><span>${escapeHtml(evidence.summary || evidence.ref)}</span><code>${escapeHtml(evidence.ref)}</code></li>`).join("") || "<li>没有可核验的证据。</li>"}</ul></details>
        <label class="claim-feedback">给 Agent 的话<textarea data-claim-feedback="${escapeHtml(item.claim_id)}" maxlength="600">${escapeHtml(item.suggested_feedback)}</textarea></label>
        <div class="claim-actions"><button data-claim-id="${escapeHtml(item.claim_id)}" data-claim-decision="award" ${item.eligible ? "" : "disabled"}>认可并授予</button><button data-claim-id="${escapeHtml(item.claim_id)}" data-claim-decision="reject">这次不授予</button></div>
      </article>`).join("")
    : "<p class='empty'>没有等待确认的成就申请。</p>";
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

pendingClaims.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-claim-id]");
  if (!button) return;
  button.disabled = true;
  claimMessage.textContent = button.dataset.claimDecision === "award" ? "正在核对进度和证据…" : "正在记录这次判断…";
  const feedback = pendingClaims.querySelector(`[data-claim-feedback="${CSS.escape(button.dataset.claimId)}"]`)?.value || "";
  try {
    await window.agentCompanion.reviewClaim(button.dataset.claimId, button.dataset.claimDecision, feedback);
    claimMessage.textContent = button.dataset.claimDecision === "award" ? "成就已经授予，Agent 下次会看到这句话。" : "已经记录为这次不授予。";
  } catch (error) {
    const message = String(error?.message || "");
    claimMessage.textContent = message.includes("achievement-not-earned")
      ? "还没有达到成就目标，暂时不能授予。"
      : message.includes("claim-evidence-insufficient")
        ? "现有证据还不足以授予，请让 Agent 补充可核验记录。"
        : `处理失败：${message || "请稍后重试"}`;
    button.disabled = false;
  }
});

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
petStage.addEventListener("mouseenter", () => window.agentCompanion.hover(true));
petStage.addEventListener("mouseleave", () => window.agentCompanion.hover(false));
openAchievements.addEventListener("click", (event) => {
  event.stopPropagation();
  window.agentCompanion.openAchievements();
});
panel.addEventListener("mouseenter", () => window.agentCompanion.hover(true));
panel.addEventListener("mouseleave", () => window.agentCompanion.hover(false));
close.addEventListener("click", () => window.agentCompanion.collapse());
chooseAvatar.addEventListener("click", () => window.agentCompanion.chooseAvatar());
resetAvatar.addEventListener("click", () => window.agentCompanion.resetAvatar());
autostart.addEventListener("change", () => window.agentCompanion.setAutostart(autostart.checked));
window.agentCompanion.getAutostart().then((enabled) => { autostart.checked = enabled; });
alwaysOnTop.addEventListener("change", () => window.agentCompanion.setAlwaysOnTop(alwaysOnTop.checked));
window.agentCompanion.getAlwaysOnTop().then((enabled) => { alwaysOnTop.checked = enabled; });
window.agentCompanion.onAlwaysOnTop((enabled) => { alwaysOnTop.checked = enabled; });
diagnoseRepository.addEventListener("click", async () => {
  diagnoseRepository.disabled = true;
  diagnosisRequestStatus.textContent = "正在把诊断提示词发送给当前 Agent…";
  try {
    const result = await window.agentCompanion.requestWuxingDiagnostic();
    const repository = result.workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    diagnosisRequestStatus.textContent = result.delivery?.status === "delivered"
      ? `已在 ${repository} 开始诊断。`
      : result.target_session_status === "active"
        ? `提示词已送达 ${repository}，Agent 会在当前工作结束后自动开始。`
        : `提示词已排进 ${repository}，切回该仓库的 Agent 会话后自动开始。`;
  } catch (error) {
    const message = String(error?.message || "");
    diagnosisRequestStatus.textContent = message.includes("agent-not-connected")
      ? "没有连接中的 Code Agent，暂时无法确定当前仓库。"
      : message.includes("workspace-not-detected")
        ? "当前 Agent 尚未上报仓库路径，请重新打开一次 Agent 会话。"
        : message.includes("prompt-injection-unsupported")
          ? "这个 Agent 的适配器还不支持提示词注入。"
        : `启动失败：${message || "请重试"}`;
  } finally {
    diagnoseRepository.disabled = false;
  }
});

agentReplyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = agentReply.value.trim();
  if (!text) return;
  agentReply.disabled = true;
  agentReplyForm.querySelector("button").disabled = true;
  diagnosisRequestStatus.textContent = "正在把你的回复发送给诊断 Agent…";
  try {
    await window.agentCompanion.sendAgentMessage(text);
    agentReply.value = "";
    diagnosisRequestStatus.textContent = "回复已送达，Agent 正在继续诊断。";
  } catch (error) {
    diagnosisRequestStatus.textContent = `发送失败：${error?.message || "请重试"}`;
    agentReply.disabled = false;
    agentReplyForm.querySelector("button").disabled = false;
  }
});

workspaceSelector.addEventListener("change", async () => {
  const session = latestSessions[Number(workspaceSelector.value)];
  if (!session) return;
  diagnosisRequestStatus.textContent = `正在切换到 ${session.workspace.replace(/[\\/]+$/, "").split(/[\\/]/).pop()}…`;
  try {
    await window.agentCompanion.setFocusWorkspace(session.agent_id, session.workspace, session.runtime?.id || "");
    diagnosisRequestStatus.textContent = "";
  } catch (error) {
    diagnosisRequestStatus.textContent = `切换失败：${error?.message || "请重试"}`;
  }
});
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
    designMessage.textContent = "已经交给 Agent，草案写好后会回到这里。";
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
  formMessage.textContent = "草案已经放进来，改好后再保存。";
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
  petStage.hidden = expanded;
  panel.classList.toggle("visible", expanded);
  panel.setAttribute("aria-hidden", String(!expanded));
  requestAnimationFrame(() => requestAnimationFrame(() => window.agentCompanion.transitionReady()));
});
