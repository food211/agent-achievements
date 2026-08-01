# Agent Achievements protocol v1

The canonical machine-readable schemas live in `packages/protocol/schemas/` in the Agent Achievements repository. This reference summarizes the agent-facing contract.

## Operations

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

The response contains at most three recent awards and three explicitly tracked achievements. Passive achievement progress is hidden from the agent until it unlocks.

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

Submit a claim only when event processing marks an achievement `claimable`:

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

## Protocol behavior

- Treat `event_id` as an idempotency key.
- Use ISO 8601 timestamps with a timezone.
- Keep vendor-specific data inside `extensions`.
- Prefer evidence references over copying private content.
- Treat achievement review as non-blocking.
- Keep hidden passive progress out of agent context.
