# Agent Achievements protocol v1

The canonical machine-readable schemas live in `packages/protocol/schemas/` in the Agent Achievements repository. This reference summarizes the agent-facing contract.

## Operations

### Bootstrap an installation

Run bootstrap once during installation and again whenever repair is needed:

```powershell
node <skill-path>/scripts/achievement-cli.mjs bootstrap --agent <agent-id> --runtime <runtime-id> --workspace <workspace> --capability <capability>
```

Bootstrap is idempotent. It initializes canonical state, seeds and schedules the bronze Product Gatekeeper, silver Rule Gardener, and gold Loop Tuner challenges, records truthful host capabilities, and queues Agent-owned follow-up work without erasing user-authored achievements or progress. Its `agent_next_actions` distinguish:

- `run_wuxing_diagnostic`, a current workspace rule-health diagnosis;
- `diagnose_past_achievements`, a retrospective of positive outcomes already completed;
- `ensure_companion_running`, a non-interactive probe and launch recipe for the installing Agent;
- `ensure_agent_bridge`, a file-freshness and live-PID probe plus an argv-style command for the persistent local Agent connection.

These actions are not user setup steps. The installing Agent consumes them immediately when the host permits, or resumes persisted work at the next Agent turn. The companion and protocol cannot wake a runtime that did not declare `background-wake`.

Close a successfully executed action with `action-complete --action <action-id> --summary <observable-result>`. Leave deferred or failed actions pending so context can return them on the next Agent turn.

At every Coding Agent process or session start, ensure the companion and bridge are alive before the first task, then rerun bootstrap. A host startup hook should perform the probes and detached launches; without one, the first Agent turn performs the same work automatically. The companion single-instance guard and per-Agent bridge lock make this idempotent.

### Maintain the persistent connection

The companion publishes `connection.json` in `AGENT_ACHIEVEMENTS_HOME` with a loopback TCP endpoint and random token. The bridge authenticates the first frame, keeps the socket open, sends heartbeats, retries with bounded backoff, and rereads discovery state after companion restarts or token rotation. Never copy this token into a prompt, log, evidence object, or remotely visible payload.

Bridge health is written to `bridges/<agent-hash>.json`; pushed context and pending actions are written to `agent-inbox.json`. Connection state and task state are separate: an authenticated idle connection prevents a healthy Agent adapter from looking disconnected, while normalized presence still determines whether the Agent is actively working. Connections, heartbeats, and uptime never count as achievement evidence.

### Report presence

Use a runtime-neutral heartbeat so desktop companions can follow any installed agent without inspecting vendor process names. A presence update contains:

- stable `session_id` and `agent_id`;
- runtime `id`;
- `active`, `idle`, or `stopped` status;
- `observed_at` and `expires_at` timestamps;
- optional current task ID and summary.

Refresh before expiry during long work. Consumers must treat expired sessions as offline even if no `stopped` update arrived. Presence controls visibility and is not achievement evidence.

### Get context

Provide `agent_id` and a task with `id`, `type`, `summary`, and `risk`. Risk is one of:

- `local_reversible`
- `persistent_data`
- `permissions`
- `external_system`
- `irreversible`
- `unknown`

The response contains at most three recent awards and the current automatically scheduled challenges. Every visible achievement includes its tier and points: bronze = 10, silver = 30, and gold = 100. Passive achievement progress is hidden from the Agent until it unlocks.

Achievement guidance is always a soft preference. The response priority remains current user instruction, safety and project rules, task correctness, then active challenges. Points may influence an otherwise equivalent implementation choice but may not grant permissions, enlarge scope, reduce verification, or justify gaming behavior.

The response may also contain up to three pending `design_requests`. Submit a draft matching `achievement-design-proposal.schema.json`; choose the lowest tier appropriate to the observable outcome and include guardrails against gaming. A trusted policy or human surface schedules and awards it; the Agent does not.

If bootstrap or the companion requests a retrospective, context may contain up to two `diagnostic_requests`. A report must match `achievement-diagnostic-report.schema.json`, attribute each discovery to an installed Skill, and include at least one concrete evidence reference. Installation, usage volume, and Agent self-description are not outcomes. Trusted award policy determines automatic settlement versus human review; the Agent never settles its own report.

### Report an event

Required event fields:

```json
{
  "schema_version": "agent-achievements/v1",
  "event_id": "evt_unique_id",
  "event_type": "task.completed",
  "occurred_at": "2026-08-01T02:14:00+08:00",
  "source": { "system": "third-party-agent", "version": "0.1.0" },
  "actor": { "agent_id": "agent-id" },
  "task": { "id": "task-id", "type": "code_change" },
  "outcome": { "status": "completed", "summary": "Observable outcome" },
  "evidence": [{ "type": "test", "ref": "tests/example.test.ts" }]
}
```

Core event types:

- `task.started`, `task.completed`, `task.failed`, `task.parked`, `task.resumed`
- `judgment.requested`, `judgment.resolved`
- `verification.completed`, `evidence.collected`
- `rule.proposed`, `rule.conflict_detected`, `rule.revised`

Use `custom:<vendor.event>` only when no core event matches. Custom events require an explicit achievement mapping.

Evidence types are `commit`, `test`, `screenshot`, `decision_record`, `impact_summary`, `trace`, and `external`.

### Submit a claim

Local event processing automatically creates a claim when the target is reached, and may settle an eligible bronze or silver system award during the same successful `report` call. Do not repeat `claim` after that call succeeds. When a remote adapter instead marks an achievement `claimable` without creating the claim, the Agent submits it without asking the user to create or track anything:

```json
{
  "schema_version": "agent-achievements/v1",
  "claim_id": "claim_unique_id",
  "achievement_id": "product-gatekeeper",
  "agent_id": "agent-id",
  "task_ids": ["task-id"],
  "summary": "Why the observed work meets the achievement",
  "evidence": [{ "type": "decision_record", "ref": "decision-123" }]
}
```

An agent may submit a claim but may not award itself an achievement.

Trusted human or policy surfaces can list pending claims and record a decision:

```powershell
node <skill-path>/scripts/achievement-cli.mjs claim-list
node <skill-path>/scripts/achievement-cli.mjs review --claim <claim-id> --decision award|reject --feedback <human-feedback>
```

`review` is reserved for a human action or trusted award-policy surface. Agents must not call it on their own behalf.

Trusted policy may automatically settle deterministic, evidence-backed bronze and silver claims. Gold claims always require review.

## Protocol behavior

- Treat `event_id` as an idempotency key.
- Use ISO 8601 timestamps with a timezone.
- Keep vendor-specific data inside `extensions`.
- Prefer evidence references over copying private content.
- Treat achievement review as non-blocking.
- Keep hidden passive progress out of agent context.
- Deduplicate system discoveries by diagnostic request and discovery ID so repeated scans cannot add points twice.
- Record meaningful task outcomes automatically, but do not create separate events for routine tool calls.
- Schedule new challenges without expanding the user's current task.
- Keep user instructions, safety, project rules, and correctness above points and challenges.
