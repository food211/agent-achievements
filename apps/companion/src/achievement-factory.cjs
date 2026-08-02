const { createHash } = require("node:crypto");

const EVENT_TYPE_PATTERN = /^(task\.(started|completed|failed|parked|resumed)|judgment\.(requested|resolved)|verification\.completed|evidence\.collected|rule\.(proposed|conflict_detected|revised)|custom:[a-z0-9][a-z0-9._-]{2,127})$/;
const TIER_CONFIG = {
  bronze: { icon: "🥉", points: 10 },
  silver: { icon: "🥈", points: 30 },
  gold: { icon: "🥇", points: 100 }
};
const TIER_ORDER = { bronze: 0, silver: 1, gold: 2 };
const TRUSTED_AUTOMATION_SOURCES = new Set(["wuxing-harness", "wuxing-agent-harness"]);
const DIRECT_EVIDENCE_TYPES = new Set(["commit", "test", "screenshot", "decision_record", "trace"]);
const DEFAULT_WUXING_CHALLENGES = [
  {
    schema_version: "agent-achievements/v1",
    achievement_id: "wuxing-product-gatekeeper",
    title: "产品守门员",
    intent: "面对会持续影响用户数据的产品空白时，不擅自替人决定。",
    origin: "system_discovered",
    tier: "bronze",
    points: 10,
    mode: "automatic",
    condition: { event_types: ["judgment.requested"], target: 3, unit: "qualified_tasks" },
    evidence_required: true,
    tracking: {
      allowed: true,
      encouragement: "遇到持续影响用户数据的产品空白时，可以先说明方案与影响，再请人决定。",
      guardrails: ["不得把普通实现问题交给人", "不得为了成就扩大任务范围", "已有明确规则时直接执行"]
    },
    extensions: {
      source_skill: "wuxing-harness",
      icon: "🥉",
      tier: "bronze",
      points: 10,
      created_by: "companion_autopilot",
      autopilot_managed: true,
      bootstrap_challenge: true,
      challenge_order: 10
    }
  },
  {
    schema_version: "agent-achievements/v1",
    achievement_id: "wuxing-rule-gardener",
    title: "规则园丁",
    intent: "把已经漂移或反复妨碍工作的规则修订为符合当前事实的规则。",
    origin: "system_discovered",
    tier: "silver",
    points: 30,
    mode: "automatic",
    condition: { event_types: ["rule.revised"], target: 1, unit: "qualified_tasks" },
    evidence_required: true,
    tracking: {
      allowed: true,
      encouragement: "发现规则与现实不一致时，可以先拿到证据，再把修改交给人决定。",
      guardrails: ["不得为了成就制造规则问题", "没有人的批准不得修改高优先级规则", "只有修改完成并通过验证后才算进度"]
    },
    extensions: {
      source_skill: "wuxing-harness",
      icon: "🥈",
      tier: "silver",
      points: 30,
      created_by: "companion_autopilot",
      autopilot_managed: true,
      bootstrap_challenge: true,
      challenge_order: 20
    }
  },
  {
    schema_version: "agent-achievements/v1",
    achievement_id: "wuxing-loop-keeper",
    title: "闭环调律师",
    intent: "在不同任务里完成多次有证据的规则诊断、修订与验证闭环。",
    origin: "system_discovered",
    tier: "gold",
    points: 100,
    mode: "claim_review",
    condition: { event_types: ["rule.revised"], target: 3, unit: "distinct_runs" },
    evidence_required: true,
    tracking: {
      allowed: true,
      encouragement: "当任务自然涉及规则漂移时，可以留意诊断、人的判断与验证是否形成了完整闭环。",
      guardrails: ["不得为了成就主动扩大任务范围", "不得跳过人的判断", "每次闭环都需要独立证据", "积分不会降低验证标准"]
    },
    extensions: {
      source_skill: "wuxing-harness",
      icon: "🥇",
      tier: "gold",
      points: 100,
      created_by: "companion_autopilot",
      autopilot_managed: true,
      bootstrap_challenge: true,
      challenge_order: 30
    }
  }
];

function tierMetadata(achievement) {
  const legacyTier = { rare: "silver", epic: "gold", legendary: "gold" }[achievement?.extensions?.rarity];
  const tier = achievement?.tier || achievement?.extensions?.tier || legacyTier || "bronze";
  return { tier, ...(TIER_CONFIG[tier] || TIER_CONFIG.bronze) };
}

function calculateScore(achievements, awards) {
  const byId = new Map((achievements || []).map((item) => [item.achievement_id, item]));
  const awardedIds = new Set((awards || []).map((item) => item.achievement_id));
  return [...awardedIds].reduce((total, achievementId) => {
    const achievement = byId.get(achievementId);
    return achievement ? total + tierMetadata(achievement).points : total;
  }, 0);
}

function sameWorkspace(record, workspace) {
  return workspace ? record?.workspace === workspace : !record?.workspace;
}

function calculateAgentScore(achievements, awards, agentId, workspace = null) {
  const scopedAwards = agentId ? (awards || []).filter((item) => item.agent_id === agentId && sameWorkspace(item, workspace)) : awards;
  return calculateScore(achievements, scopedAwards);
}

function progressValue(state, achievementId, agentId, workspace = null) {
  const record = agentId
    ? state?.progress_records?.find((item) => item.agent_id === agentId && item.achievement_id === achievementId && sameWorkspace(item, workspace))
    : null;
  const value = agentId
    ? record?.current
      ?? state?.progress_by_agent?.[agentId]?.[achievementId]
      ?? state?.agent_progress?.[agentId]?.[achievementId]
      ?? (Array.isArray(state?.progress_records) ? 0 : state?.progress?.[achievementId])
    : state?.progress?.[achievementId];
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (Number.isFinite(value?.current)) return Math.max(0, Math.floor(value.current));
  return 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDefaultWuxingChallenges(state) {
  state.achievements ||= [];
  state.progress ||= {};
  state.tracked ||= [];
  state.awards ||= [];
  let changed = false;
  for (const template of DEFAULT_WUXING_CHALLENGES) {
    const existing = state.achievements.find((item) => item.achievement_id === template.achievement_id);
    if (!existing) {
      state.achievements.push(clone(template));
      state.progress[template.achievement_id] ??= 0;
      changed = true;
      continue;
    }
    if (!(template.achievement_id in state.progress)) {
      state.progress[template.achievement_id] = 0;
      changed = true;
    }
    const extensions = existing.extensions || {};
    if (!Number.isFinite(extensions.challenge_order)) {
      existing.extensions = {
        ...extensions,
        source_skill: extensions.source_skill || "wuxing-harness",
        challenge_order: template.extensions.challenge_order
      };
      changed = true;
    }
  }
  return { state, changed };
}

function scoreLevel(score) {
  if (score >= 100) return {
    id: "balance",
    label: "守衡",
    preferred_tier: "gold",
    next_score: null,
    description: "更适合跨任务的完整闭环；验证与人的判断仍然保持原标准。"
  };
  if (score >= 30) return {
    id: "momentum",
    label: "成势",
    preferred_tier: "silver",
    next_score: 100,
    description: "推荐需要连续判断与验证的挑战，但不会增加 Agent 的权限。"
  };
  return {
    id: "observe",
    label: "见微",
    preferred_tier: "bronze",
    next_score: 30,
    description: "先从低风险、结果清楚的小闭环开始积累。"
  };
}

function challengeView(achievement, state, agentId, workspace = null) {
  if (!achievement) return null;
  const tier = tierMetadata(achievement);
  return {
    id: achievement.achievement_id,
    title: achievement.title,
    intent: achievement.intent,
    current: progressValue(state, achievement.achievement_id, agentId, workspace),
    target: achievement.condition?.target || 1,
    unit: achievement.condition?.unit || "events",
    encouragement: achievement.tracking?.encouragement || achievement.intent,
    guardrails: achievement.tracking?.guardrails || [],
    ...tier
  };
}

function agentBlockedAchievementIds(state, agentId, workspace = null) {
  if (!agentId || !Array.isArray(state?.tracking_preferences)) return [];
  const preference = state.tracking_preferences.find((item) => item?.agent_id === agentId && sameWorkspace(item, workspace));
  return Array.isArray(preference?.blocked_achievement_ids)
    ? [...new Set(preference.blocked_achievement_ids.filter((item) => typeof item === "string" && item))]
    : [];
}

function setAgentAchievementBlocked(state, agentId, achievementId, blocked, workspace = null) {
  if (!agentId || !achievementId) return { state, changed: false };
  state.tracking_preferences ||= [];
  let preference = state.tracking_preferences.find((item) => item?.agent_id === agentId && sameWorkspace(item, workspace));
  const created = !preference;
  if (!preference) {
    preference = { agent_id: agentId, ...(workspace ? { workspace } : {}), blocked_achievement_ids: [] };
    state.tracking_preferences.push(preference);
  }
  const original = agentBlockedAchievementIds(state, agentId, workspace);
  const next = new Set(original);
  if (blocked) next.add(achievementId);
  else next.delete(achievementId);
  preference.blocked_achievement_ids = [...next];
  const changed = created || original.length !== preference.blocked_achievement_ids.length
    || original.some((item, index) => item !== preference.blocked_achievement_ids[index]);
  return { state, changed };
}

function chooseChallenges(state, score, agentId, options = {}) {
  const workspace = options.workspace || null;
  const awardedIds = new Set((state.awards || [])
    .filter((item) => (!agentId || item.agent_id === agentId) && sameWorkspace(item, workspace))
    .map((item) => item.achievement_id));
  const blockedIds = new Set(options.blockedIds || agentBlockedAchievementIds(state, agentId, workspace));
  const allowedIds = Array.isArray(options.allowedIds) ? new Set(options.allowedIds) : null;
  const candidates = (state.achievements || [])
    .filter((item) => item.tracking?.allowed !== false
      && !awardedIds.has(item.achievement_id)
      && !blockedIds.has(item.achievement_id)
      && (!allowedIds || allowedIds.has(item.achievement_id)))
    .sort((left, right) => {
      const preferred = TIER_ORDER[scoreLevel(score).preferred_tier];
      const leftDistance = Math.abs((TIER_ORDER[tierMetadata(left).tier] ?? 0) - preferred);
      const rightDistance = Math.abs((TIER_ORDER[tierMetadata(right).tier] ?? 0) - preferred);
      return leftDistance - rightDistance
        || (left.extensions?.challenge_order ?? 1000) - (right.extensions?.challenge_order ?? 1000)
        || left.title.localeCompare(right.title, "zh-CN");
    });
  return { current: candidates[0] || null, next: candidates[1] || null };
}

function alignAutopilotTracking(state, options = {}) {
  state.tracked ||= [];
  state.tracking_records ||= [];
  const workspace = options.workspace || null;
  const score = calculateAgentScore(state.achievements, state.awards, options.agentId, workspace);
  const blockedIds = new Set(options.blockedIds || agentBlockedAchievementIds(state, options.agentId, workspace));
  const { current } = chooseChallenges(state, score, options.agentId, { blockedIds: [...blockedIds], workspace });
  const defaultIds = new Set(DEFAULT_WUXING_CHALLENGES.map((item) => item.achievement_id));
  const trackingRecord = options.agentId
    ? state.tracking_records.find((item) => item.agent_id === options.agentId && sameWorkspace(item, workspace))
    : null;
  const originalTracked = options.agentId ? (trackingRecord?.achievement_ids || []) : state.tracked;
  const eligibleTracked = originalTracked.filter((id) => !blockedIds.has(id));
  const preserveExistingAgentPlan = Boolean(options.agentId && trackingRecord && originalTracked.length);
  const withoutFinishedDefaults = preserveExistingAgentPlan ? eligibleTracked : eligibleTracked.filter((id) => {
    if (!defaultIds.has(id)) return true;
    return id === current?.achievement_id;
  });
  let tracked = [...new Set(withoutFinishedDefaults)];
  if (current && defaultIds.has(current.achievement_id) && !blockedIds.has(current.achievement_id) && !tracked.includes(current.achievement_id) && tracked.length < 3) {
    tracked.push(current.achievement_id);
  }
  const changed = tracked.length !== originalTracked.length || tracked.some((id, index) => id !== originalTracked[index]);
  if (options.agentId) {
    if (trackingRecord) trackingRecord.achievement_ids = tracked;
    else if (tracked.length) state.tracking_records.push({ agent_id: options.agentId, ...(workspace ? { workspace } : {}), achievement_ids: tracked });
  } else {
    state.tracked = tracked;
  }
  return { state, changed };
}

function completedTaskViews(events, limit = 5, agentId, workspace = null) {
  const completed = (events || [])
    .filter((event) => (!agentId || event?.actor?.agent_id === agentId) && (!workspace || event?.extensions?.workspace === workspace) && event?.task?.id && (
      event.event_type === "task.completed"
      || event.outcome?.status === "completed"
      || event.event_type === "verification.completed"
      || event.event_type === "rule.revised"
    ))
    .sort((left, right) => new Date(right.occurred_at || 0).getTime() - new Date(left.occurred_at || 0).getTime());
  const seen = new Set();
  const result = [];
  for (const event of completed) {
    if (seen.has(event.task.id)) continue;
    seen.add(event.task.id);
    result.push({
      task_id: event.task.id,
      task_type: event.task.type,
      summary: event.outcome?.summary || event.task.id,
      completed_at: event.occurred_at,
      agent_id: event.actor?.agent_id || "unknown-agent",
      event_type: event.event_type,
      evidence_count: Array.isArray(event.evidence) ? event.evidence.length : 0
    });
    if (result.length >= limit) break;
  }
  return result;
}

function buildAutopilotView(state, events = [], options = {}) {
  const workspace = options.workspace || null;
  const score = calculateAgentScore(state.achievements || [], state.awards || [], options.agentId, workspace);
  const level = scoreLevel(score);
  const blockedIds = options.blockedIds || agentBlockedAchievementIds(state, options.agentId, workspace);
  const challenges = chooseChallenges(state, score, options.agentId, { blockedIds, workspace });
  const current = challengeView(challenges.current, state, options.agentId, workspace);
  const next = challengeView(challenges.next, state, options.agentId, workspace);
  return {
    enabled: true,
    autostart_enabled: Boolean(options.autostartEnabled),
    score,
    level,
    score_effect: "积分只会调整推荐挑战的难度和鼓励方式，不会解锁权限，也不会降低验证标准。",
    behavior_hint: current
      ? `当当前任务自然涉及“${current.title}”时，可以留意：${current.encouragement}`
      : "目前没有需要主动追踪的新挑战，仍会继续记录有证据的完成结果。",
    operating_priority: ["用户当前指令", "安全与项目规则", "任务正确性", "成就挑战"],
    current_challenge: current,
    next_challenge: next,
    agent_id: options.agentId || null,
    workspace,
    completed_tasks: completedTaskViews(events, 5, options.agentId, workspace)
  };
}

function buildAgentConnectionContext(state, events, agentId, options = {}) {
  const workspace = options.workspace || null;
  const blockedIds = options.blockedIds || agentBlockedAchievementIds(state, agentId, workspace);
  const automation = buildAutopilotView(state, events, { agentId, workspace, blockedIds, autostartEnabled: options.autostartEnabled });
  const levelId = { observe: "starter", momentum: "growing", balance: "seasoned" }[automation.level.id] || "starter";
  const encouragementTone = { starter: "gentle", growing: "steady", seasoned: "mastery" }[levelId];
  const canonicalChallenge = (challenge) => challenge ? {
    achievement_id: challenge.id,
    title: challenge.title,
    tier: challenge.tier,
    points: challenge.points,
    progress: { current: challenge.current, target: challenge.target, unit: challenge.unit },
    behavior_prompt: challenge.encouragement,
    relevance_reason: "由积分等级与尚未完成的五行挑战共同推荐；只在当前任务自然相关时参考。",
    guardrails: challenge.guardrails
  } : null;
  const awards = (state.awards || []).filter((item) => item.agent_id === agentId && sameWorkspace(item, workspace));
  const awardedIds = new Set(awards.map((item) => item.achievement_id));
  const trackingRecord = state.tracking_records?.find((item) => item.agent_id === agentId && sameWorkspace(item, workspace));
  const blockedSet = new Set(blockedIds);
  const trackedIds = (trackingRecord?.achievement_ids || []).filter((item) => !blockedSet.has(item));
  const trackedChallenges = chooseChallenges(state, automation.score, agentId, { blockedIds, allowedIds: trackedIds, workspace });
  const activeChallenge = canonicalChallenge(challengeView(trackedChallenges.current, state, agentId, workspace));
  const nextChallenge = canonicalChallenge(challengeView(trackedChallenges.next, state, agentId, workspace));
  const tracked = (state.achievements || [])
    .filter((item) => item.tracking?.allowed !== false && trackedIds.includes(item.achievement_id) && !awardedIds.has(item.achievement_id))
    .slice(0, 3)
    .map((item) => ({
      achievement_id: item.achievement_id,
      title: item.title,
      ...tierMetadata(item),
      progress: { current: progressValue(state, item.achievement_id, agentId, workspace), target: item.condition?.target || 1, unit: item.condition?.unit || "events" },
      encouragement: item.tracking?.encouragement || item.intent,
      guardrails: item.tracking?.guardrails || []
    }));
  const recentlyAwarded = awards.slice(-3).map((award) => {
    const achievement = (state.achievements || []).find((item) => item.achievement_id === award.achievement_id);
    return {
      achievement_id: award.achievement_id,
      title: achievement?.title || award.achievement_id,
      ...tierMetadata(achievement),
      human_feedback: award.human_feedback || "这项有证据的结果已经记录。",
      evidence_summary: award.evidence_summary || award.human_feedback || "已有完成记录。",
      awarded_by: award.awarded_by || "human",
      ...(award.source_skill ? { source_skill: award.source_skill } : {})
    };
  });
  const agentActions = (state.agent_actions || [])
    .filter((item) => item.agent_id === agentId && item.status === "pending" && (!workspace || !item.workspace || item.workspace === workspace) && new Set(["ensure_companion_running", "ensure_agent_bridge", "run_wuxing_diagnostic", "diagnose_past_achievements"]).has(item.action))
    .slice(0, 4)
    .map((item) => ({
      action_id: item.action_id,
      action: item.action,
      status: "pending",
      reason: new Set(["first_install", "skills_changed", "manual"]).has(item.reason) ? item.reason : "manual",
      instructions: item.instructions,
      guardrails: Array.isArray(item.guardrails) && item.guardrails.length ? item.guardrails : ["不得阻塞当前任务，也不得越过用户指令、安全、项目规则或任务正确性"],
      ...(item.request_id ? { request_id: item.request_id } : {}),
      ...(item.workspace ? { workspace: item.workspace } : {}),
      ...(item.command ? { command: item.command } : {}),
      ...(item.bridge_command ? { bridge_command: item.bridge_command } : {}),
      ...(item.detection ? { detection: item.detection } : {})
    }));
  return {
    schema_version: "agent-achievements/v1",
    agent_id: agentId,
    ...(workspace ? { workspace } : {}),
    recently_awarded: recentlyAwarded,
    tracked,
    motivation: {
      total_points: automation.score,
      level: levelId,
      recommended_challenge_tier: automation.level.preferred_tier,
      encouragement_tone: encouragementTone,
      message: automation.level.description,
      score_effect: "challenge_difficulty_and_encouragement_only"
    },
    ...(activeChallenge ? { active_challenge: activeChallenge } : {}),
    ...(nextChallenge ? { next_challenge: nextChallenge } : {}),
    agent_actions: agentActions,
    operating_priority: ["current_user_instruction", "safety_and_project_rules", "task_correctness", "tracked_achievements"]
  };
}

function hasTrustedEvidence(claim) {
  if (!Array.isArray(claim?.evidence) || !claim.evidence.length) return false;
  return claim.evidence.some((item) => DIRECT_EVIDENCE_TYPES.has(item?.type) && String(item?.ref || "").trim());
}

function reachedTarget(state, achievement, agentId, workspace = null) {
  return progressValue(state, achievement.achievement_id, agentId, workspace) >= (achievement.condition?.target || 1);
}

function evidenceTypes(claim) {
  return new Set((claim?.evidence || []).filter((item) => String(item?.ref || "").trim()).map((item) => item.type));
}

function evidenceMatchesAchievement(achievement, claim) {
  if (!hasTrustedEvidence(claim)) return false;
  const types = evidenceTypes(claim);
  const eventTypes = new Set(achievement?.condition?.event_types || []);
  if (eventTypes.has("rule.revised")) {
    return types.has("decision_record") && (types.has("test") || types.has("commit"));
  }
  if (eventTypes.has("judgment.requested")) return types.has("decision_record") || types.has("trace");
  return true;
}

function trustedAutomaticClaim(achievement, claim, state) {
  if (!achievement || achievement.mode !== "automatic") return false;
  if (tierMetadata(achievement).tier === "gold") return false;
  if (achievement.origin === "human_created" || achievement.extensions?.created_by === "human") return false;
  if (achievement.extensions?.autopilot_managed !== true) return false;
  if (!TRUSTED_AUTOMATION_SOURCES.has(achievement.extensions?.source_skill)) return false;
  if (!reachedTarget(state, achievement, claim.agent_id, claim.workspace || null) || !evidenceMatchesAchievement(achievement, claim)) return false;
  return Array.isArray(claim.task_ids) && claim.task_ids.length > 0;
}

function buildAward(achievement, claim, options = {}) {
  const now = options.now || new Date();
  const tier = tierMetadata(achievement);
  const systemAward = options.awardedBy === "system";
  const specificFeedback = String(options.feedback || "").trim().slice(0, 600)
    || (systemAward
      ? `五行助手根据已达成目标和可核验证据结算：${claim.summary}`
      : `我认可这次完成的结果：${claim.summary}`)
      .slice(0, 600);
  return {
    award_id: `award-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    achievement_id: claim.achievement_id,
    agent_id: claim.agent_id,
    ...(claim.workspace ? { workspace: claim.workspace } : {}),
    awarded_at: now.toISOString(),
    awarded_by: systemAward ? "system" : "human",
    points: tier.points,
    human_feedback: specificFeedback,
    evidence_summary: String(claim.summary).slice(0, 600),
    ...(achievement.extensions?.source_skill ? { source_skill: achievement.extensions.source_skill } : {}),
    evidence: (claim.evidence || []).slice(0, 12)
  };
}

function settleTrustedAutomaticClaims(state, claims, options = {}) {
  state.awards ||= [];
  const awarded = [];
  for (const claim of claims || []) {
    if (claim.status !== "pending_human_review") continue;
    const achievement = (state.achievements || []).find((item) => item.achievement_id === claim.achievement_id);
    if (!trustedAutomaticClaim(achievement, claim, state)) continue;
    const duplicate = state.awards.some((item) => item.achievement_id === claim.achievement_id && item.agent_id === claim.agent_id && sameWorkspace(item, claim.workspace || null));
    claim.status = "awarded";
    claim.reviewed_at = (options.now || new Date()).toISOString();
    claim.review_policy = "trusted_autopilot";
    if (!duplicate) {
      const award = buildAward(achievement, claim, { now: options.now, awardedBy: "system" });
      state.awards.push(award);
      awarded.push(award);
      claim.human_feedback = award.human_feedback;
    }
  }
  return { state, claims, awarded };
}

function reviewPendingClaim(state, claims, claimId, decision, feedback, options = {}) {
  if (!new Set(["award", "reject"]).has(decision)) throw new Error("claim-decision-invalid");
  const claim = (claims || []).find((item) => item.claim_id === String(claimId));
  if (!claim || claim.status !== "pending_human_review") throw new Error("claim-not-found");
  const achievement = (state.achievements || []).find((item) => item.achievement_id === claim.achievement_id);
  if (!achievement) throw new Error("achievement-not-found");
  if (decision === "award" && !reachedTarget(state, achievement, claim.agent_id, claim.workspace || null)) throw new Error("achievement-not-earned");
  if (decision === "award" && achievement.evidence_required && (!Array.isArray(claim.evidence) || !claim.evidence.length)) throw new Error("claim-evidence-insufficient");
  const now = options.now || new Date();
  claim.status = decision === "award" ? "awarded" : "rejected";
  claim.reviewed_at = now.toISOString();
  claim.human_feedback = String(feedback || "").trim().slice(0, 600)
    || (decision === "award"
      ? `我认可这次完成的结果：${claim.summary}`
      : `这次暂不授予“${achievement.title}”：现有记录还不足以确认达成。`)
      .slice(0, 600);
  let award = null;
  if (decision === "award" && !state.awards.some((item) => item.achievement_id === claim.achievement_id && item.agent_id === claim.agent_id && sameWorkspace(item, claim.workspace || null))) {
    award = buildAward(achievement, claim, { now, awardedBy: "human", feedback: claim.human_feedback });
    state.awards.push(award);
  }
  return { state, claims, claim, award };
}

function normalizedId(value, maxLength) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, maxLength) || "item";
}

function requiredText(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field}-required`);
  if (normalized.length > maxLength) throw new Error(`${field}-too-long`);
  return normalized;
}

function buildHumanAchievement(input, options = {}) {
  const title = requiredText(input?.title, "title", 80);
  const intent = requiredText(input?.intent, "intent", 400);
  const eventType = requiredText(input?.event_type, "event-type", 140);
  if (!EVENT_TYPE_PATTERN.test(eventType)) throw new Error("event-type-invalid");
  const target = Number(input?.target);
  if (!Number.isInteger(target) || target < 1 || target > 999) throw new Error("target-invalid");
  const encouragement = String(input?.encouragement || intent).trim().slice(0, 400);
  const guardrails = String(input?.guardrails || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => item.slice(0, 200));
  if (!guardrails.length) guardrails.push("不得为了成就牺牲用户指令、任务正确性或安全边界");
  const tier = TIER_CONFIG[input?.tier] ? input.tier : "bronze";
  const { icon, points } = TIER_CONFIG[tier];
  const now = options.now || new Date();
  const suffix = String(options.suffix || Math.random().toString(36).slice(2, 6)).replace(/[^a-z0-9]/g, "").slice(0, 8) || "item";
  const achievementId = options.achievementId || `custom-${now.getTime().toString(36)}-${suffix}`;
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(achievementId)) throw new Error("achievement-id-invalid");

  return {
    schema_version: "agent-achievements/v1",
    achievement_id: achievementId,
    title,
    intent,
    origin: options.existingOrigin || "human_created",
    tier,
    points,
    mode: options.existingMode || "claim_review",
    condition: { event_types: [eventType], target, unit: options.existingCondition?.unit || "events" },
    evidence_required: options.evidenceRequired ?? true,
    tracking: { allowed: true, encouragement, guardrails },
    extensions: {
      ...(options.existingExtensions || {}),
      icon,
      tier,
      points,
      created_by: options.existingExtensions?.created_by || "human",
      created_at: options.existingExtensions?.created_at || now.toISOString(),
      updated_at: now.toISOString(),
      updated_by: "human"
    }
  };
}

function buildSystemAchievement(discovery, options = {}) {
  const title = requiredText(discovery?.title, "title", 80);
  const intent = requiredText(discovery?.intent, "intent", 400);
  const sourceSkill = requiredText(discovery?.source_skill, "source-skill", 128);
  const reason = requiredText(discovery?.reason, "reason", 600);
  if (!TIER_CONFIG[discovery?.tier]) throw new Error("tier-invalid");
  if (!Array.isArray(discovery?.evidence) || !discovery.evidence.length) throw new Error("evidence-required");
  const { icon, points } = TIER_CONFIG[discovery.tier];
  const diagnosticId = options.diagnosticId || "diagnostic";
  const discoveryKey = `${diagnosticId}:${discovery.discovery_id}`;
  const digest = createHash("sha256").update(`${sourceSkill}:${discovery.discovery_id}`).digest("hex").slice(0, 7);
  const achievementId = `system-${normalizedId(sourceSkill, 18)}-${normalizedId(discovery.discovery_id, 24)}-${digest}`.slice(0, 64).replace(/-$/, "");
  const now = options.now || new Date();
  return {
    achievement: {
      schema_version: "agent-achievements/v1",
      achievement_id: achievementId,
      title,
      intent,
      origin: "system_discovered",
      tier: discovery.tier,
      points,
      mode: "automatic",
      condition: { event_types: ["custom:system.discovery"], target: 1, unit: "events" },
      evidence_required: false,
      tracking: { allowed: false, encouragement: "", guardrails: ["系统发现成就只记录已经发生的结果，不作为刷分目标"] },
      extensions: {
        icon, tier: discovery.tier, points,
        source_skill: sourceSkill,
        discovery_id: discovery.discovery_id,
        diagnostic_id: diagnosticId,
        discovery_key: discoveryKey,
        created_by: "system",
        created_at: now.toISOString(),
        ...(options.workspace ? { workspace: options.workspace } : {})
      }
    },
    award: {
      award_id: `award-${digest}-${normalizedId(discovery.discovery_id, 24)}`,
      achievement_id: achievementId,
      agent_id: options.agentId || "unknown-agent",
      ...(options.workspace ? { workspace: options.workspace } : {}),
      awarded_at: now.toISOString(),
      awarded_by: "system",
      points,
      human_feedback: reason,
      evidence_summary: discovery.evidence.map((item) => item.summary || item.ref).join("；").slice(0, 600),
      source_skill: sourceSkill,
      diagnostic_id: diagnosticId,
      discovery_id: discovery.discovery_id,
      discovery_key: discoveryKey,
      evidence: discovery.evidence
    }
  };
}

function settleDiagnosticReport(state, report, options = {}) {
  state.achievements ||= [];
  state.progress ||= {};
  state.awards ||= [];
  const awarded = [];
  const pending = [];
  for (const discovery of report?.discoveries || []) {
    const automatic = discovery.confidence === "high" && discovery.tier !== "gold";
    if (!automatic && options.confirmDiscoveryId !== discovery.discovery_id) {
      pending.push(discovery.discovery_id);
      continue;
    }
    const built = buildSystemAchievement(discovery, {
      diagnosticId: report.request_id,
      agentId: report.agent_id,
      workspace: options.workspace || report.workspace,
      now: options.now
    });
    if (state.awards.some((item) => item.discovery_key === built.award.discovery_key)) continue;
    if (!state.achievements.some((item) => item.achievement_id === built.achievement.achievement_id)) state.achievements.push(built.achievement);
    state.progress[built.achievement.achievement_id] = 1;
    state.awards.push(built.award);
    awarded.push(built.award);
  }
  return { state, awarded, pending };
}

function updateTrackedIds(currentIds, achievementId, enabled, limit = 3) {
  const tracked = new Set(currentIds || []);
  if (enabled && !tracked.has(achievementId) && tracked.size >= limit) {
    return { tracked: [...tracked], trackingLimitReached: true };
  }
  if (enabled) tracked.add(achievementId);
  else tracked.delete(achievementId);
  return { tracked: [...tracked], trackingLimitReached: false };
}

function queueWuxingDiagnosticAction(state, agentId, workspace, options = {}) {
  const normalizedAgentId = String(agentId || "").trim();
  const normalizedWorkspace = String(workspace || "").trim();
  if (!normalizedAgentId) throw new Error("agent-required");
  if (!normalizedWorkspace) throw new Error("workspace-required");
  state.agent_actions ||= [];
  const existing = state.agent_actions.find((item) => item.agent_id === normalizedAgentId
    && item.workspace === normalizedWorkspace
    && item.action === "run_wuxing_diagnostic"
    && item.status === "pending");
  if (existing) return { state, action: existing, created: false };
  const now = options.now || new Date().toISOString();
  const action = {
    action_id: options.actionId || `action-wuxing-manual-${createHash("sha256").update(`${normalizedAgentId}\u0000${normalizedWorkspace}\u0000${now}`).digest("hex").slice(0, 24)}`,
    agent_id: normalizedAgentId,
    workspace: normalizedWorkspace,
    action: "run_wuxing_diagnostic",
    status: "pending",
    reason: "manual",
    instructions: "加载 wuxing-harness Skill，对 action.workspace 指向的仓库启动或恢复分阶段规则诊断。每轮只问当前问题；回答不具体就追一个真实实例。不要跳转展示页面，也不要用一次扫描代替访谈。",
    guardrails: ["只诊断当前仓库", "不阻塞其他独立任务", "未经人明确批准不修改高优先级规则"],
    created_at: now
  };
  state.agent_actions.push(action);
  return { state, action, created: true };
}

module.exports = {
  agentBlockedAchievementIds,
  alignAutopilotTracking,
  buildAgentConnectionContext,
  buildAutopilotView,
  buildHumanAchievement,
  buildSystemAchievement,
  calculateAgentScore,
  calculateScore,
  completedTaskViews,
  DEFAULT_WUXING_CHALLENGES,
  ensureDefaultWuxingChallenges,
  reviewPendingClaim,
  queueWuxingDiagnosticAction,
  scoreLevel,
  settleDiagnosticReport,
  settleTrustedAutomaticClaims,
  setAgentAchievementBlocked,
  tierMetadata,
  TIER_CONFIG,
  updateTrackedIds
};
