const DEFAULT_SIZE = { width: 274, height: 84 };

function clippedText(value, limit = 52) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function awardKey(award) {
  return award ? `${award.achievement_id || ""}:${award.awarded_at || award.created_at || ""}` : "";
}

function claimKey(claim) {
  return claim?.claim_id || "";
}

function bubbleMessage(previous, current) {
  if (!previous || !current) return null;

  const newestAward = current.awards?.[0];
  if (newestAward && awardKey(newestAward) !== awardKey(previous.awards?.[0])) {
    return {
      kind: "award",
      title: "Agent 获得新奖杯",
      body: `${newestAward.icon || "🏆"} ${clippedText(newestAward.title, 34)} · +${newestAward.points || 0} 分`
    };
  }

  const newestClaim = current.claims?.[0];
  if (newestClaim && claimKey(newestClaim) !== claimKey(previous.claims?.[0])) {
    return {
      kind: "claim",
      title: "有一项成果等你确认",
      body: clippedText(newestClaim.title || newestClaim.summary || "打开助手查看证据")
    };
  }

  const before = previous.agentConversation;
  const after = current.agentConversation;
  if (after?.status === "completed" && before?.status !== "completed") {
    const response = [...(after.messages || [])].reverse().find((item) => item.role === "assistant")?.text;
    return {
      kind: "reply",
      title: "Agent 有新消息",
      body: clippedText(response || "Agent 已经完成这一轮诊断，点我查看。")
    };
  }
  if (after?.status === "failed" && before?.status !== "failed") {
    return {
      kind: "error",
      title: "这条消息没有处理完成",
      body: clippedText(after.error || after.activity || "点我查看原因。")
    };
  }
  return null;
}

function bubblePlacement(petBounds, workArea, size = DEFAULT_SIZE, gap = 8, margin = 8) {
  const maximumWidth = Math.max(1, workArea.width - margin * 2);
  const maximumHeight = Math.max(1, workArea.height - margin * 2);
  const fitted = { width: Math.min(size.width, maximumWidth), height: Math.min(size.height, maximumHeight) };
  const roomOnLeft = petBounds.x - (workArea.x + margin);
  const roomOnRight = workArea.x + workArea.width - margin - (petBounds.x + petBounds.width);
  const placeLeft = roomOnLeft >= fitted.width + gap || roomOnLeft >= roomOnRight;
  const rawX = placeLeft
    ? petBounds.x - fitted.width - gap
    : petBounds.x + petBounds.width + gap;
  const rawY = petBounds.y + Math.round((petBounds.height - fitted.height) / 2);
  const bounds = {
    x: Math.max(workArea.x + margin, Math.min(rawX, workArea.x + workArea.width - margin - fitted.width)),
    y: Math.max(workArea.y + margin, Math.min(rawY, workArea.y + workArea.height - margin - fitted.height)),
    width: fitted.width,
    height: fitted.height
  };
  return {
    bounds,
    side: bounds.x < petBounds.x ? "left" : "right",
    anchorY: Math.max(22, Math.min(bounds.height - 22, petBounds.y + petBounds.height / 2 - bounds.y))
  };
}

function bubbleBounds(petBounds, workArea, size = DEFAULT_SIZE, gap = 8, margin = 8) {
  return bubblePlacement(petBounds, workArea, size, gap, margin).bounds;
}

module.exports = { DEFAULT_SIZE, bubbleBounds, bubbleMessage, bubblePlacement, clippedText };
