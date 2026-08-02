---
name: use-agent-achievements
description: Maintain Agent Achievements presence, read tracked AI achievements, report normalized evidence-backed work events, and submit achievement claims without blocking the primary task. Use at the start of every task after Agent Achievements is installed, when a user asks the agent to pursue or report an achievement, or when another agent system integrates with the agent-achievements/v1 protocol.
---

# Use Agent Achievements

Treat achievements as soft preferences. Keep this priority order:

1. current user instruction;
2. safety and project rules;
3. task correctness;
4. tracked achievements.

Never expand task scope, fabricate evidence, skip required checks, or interrupt useful work to obtain an achievement.

## At task start

Announce the current agent session so a companion or third-party interface can follow the installed agent rather than a vendor-specific process:

```powershell
node <skill-path>/scripts/achievement-cli.mjs presence --agent <agent-id> --session <session-id> --runtime <runtime-id> --status active --task-id <id> --summary <summary>
```

Refresh the heartbeat during long work. It expires automatically if the agent crashes or cannot send a final update.

For Codex, prefer the bundled lifecycle adapter so presence does not depend on the model remembering to refresh it:

```powershell
node <skill-path>/scripts/install-codex-hooks.mjs
```

After installation, the user must review and trust the hook in Codex `/hooks`. The adapter marks the session active on prompts and tool progress, idle when a turn stops, and stopped when the session ends. Do not also send routine manual heartbeats when this adapter is active.

Then load context:

```powershell
node <skill-path>/scripts/achievement-cli.mjs context --agent <agent-id> --task-id <id> --task-type <type> --summary <summary> --risk <risk> --format markdown
```

Apply only the returned tracked achievements that naturally relate to the task. Do not ask for or expose hidden passive progress.

If the context contains `design_requests`, the human has explicitly asked an Agent to help design an achievement. When it does not conflict with the primary task, draft a proposal that rewards an observable outcome rather than raw activity, includes guardrails against gaming, and chooses the lowest suitable tier. Write a proposal matching `achievement-design-proposal.schema.json`, then submit it with:

```powershell
node <skill-path>/scripts/achievement-cli.mjs design-submit --input <proposal.json>
```

Tier values are fixed: bronze = 10 points, silver = 30 points, gold = 100 points. Never choose a higher tier merely to motivate yourself. The human still reviews and saves the draft.

If the context contains `diagnostic_requests`, perform a retrospective diagnosis of positive outcomes already created through installed Skills and project rules. Inspect concrete artifacts such as accepted rule revisions, commits, tests, decision records, and reusable workflow changes. Do not reward installation, tool calls, activity volume, or unverified self-description. Submit at most eight discoveries matching `achievement-diagnostic-report.schema.json` with:

```powershell
node <skill-path>/scripts/achievement-cli.mjs diagnostic-submit --input <report.json>
```

Use `high` confidence only when the Skill attribution and positive outcome both have direct evidence. The companion may automatically settle high-confidence bronze or silver discoveries. Medium-confidence and all gold discoveries require human confirmation. Never fabricate evidence or split one outcome into multiple discoveries.

## During and after work

Report only meaningful, observable events. Create an event JSON file matching `references/protocol.md`, then run:

```powershell
node <skill-path>/scripts/achievement-cli.mjs report --input <event.json>
```

Use a stable `event_id`; retries are idempotent. Attach references rather than raw private task content when possible.

If the response contains `next_actions.action = submit_claim`, prepare the requested evidence and run:

```powershell
node <skill-path>/scripts/achievement-cli.mjs claim --input <claim.json>
```

Continue the primary task after submitting. Never wait for achievement review.

Pending claims appear in the desktop companion under “等待认可”. The human can award or reject them there. `claim-list` and `review` also exist for a human-operated adapter, but an Agent must never call `review` to award itself.

## At task or session end

Mark a still-open session idle when more user work may arrive, or stopped when the runtime is ending:

```powershell
node <skill-path>/scripts/achievement-cli.mjs presence --agent <agent-id> --session <session-id> --runtime <runtime-id> --status idle
```

Presence controls the companion's awake, working, and sleeping state. It is not achievement evidence by itself.

## Companion appearance

The companion defaults to an animated living trophy. Only when the user explicitly asks for a custom companion image, use an available image-generation capability or a user-provided file. Prefer a square PNG or WebP with a transparent or simple background, a readable silhouette, and no text. Install it with:

```powershell
node <skill-path>/scripts/achievement-cli.mjs avatar --input <png-jpg-webp-or-svg>
```

The companion detects the new image automatically. Restore the default trophy with `avatar --reset`. Never replace the user's avatar merely to pursue an achievement.

## Reporting to the user

- Mention a newly awarded achievement and the human feedback briefly.
- Do not narrate routine progress increments unless asked.
- State clearly when evidence is insufficient instead of stretching the criteria.
- Let the human award, reject, revoke, or track achievements.

Read [references/protocol.md](references/protocol.md) when constructing payloads or integrating a third-party system. Read [references/integration.md](references/integration.md) when selecting file, HTTP, or runtime adapters.
