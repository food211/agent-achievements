const { createHash } = require("node:crypto");

const EVENT_TYPE_PATTERN = /^(task\.(started|completed|failed|parked|resumed)|judgment\.(requested|resolved)|verification\.completed|evidence\.collected|rule\.(proposed|conflict_detected|revised)|custom:[a-z0-9][a-z0-9._-]{2,127})$/;
const TIER_CONFIG = {
  bronze: { icon: "🥉", points: 10 },
  silver: { icon: "🥈", points: 30 },
  gold: { icon: "🥇", points: 100 }
};

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
        created_at: now.toISOString()
      }
    },
    award: {
      award_id: `award-${digest}-${normalizedId(discovery.discovery_id, 24)}`,
      achievement_id: achievementId,
      agent_id: options.agentId || "unknown-agent",
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

module.exports = { buildHumanAchievement, buildSystemAchievement, calculateScore, settleDiagnosticReport, tierMetadata, TIER_CONFIG, updateTrackedIds };
