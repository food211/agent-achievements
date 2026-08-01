---
name: use-agent-achievements
description: Read tracked AI achievements, report normalized evidence-backed work events, and submit achievement claims without blocking the primary task. Use when an Agent Achievements workspace or API is present, when a user asks the agent to pursue or report an achievement, or when another agent system needs to integrate with the agent-achievements/v1 protocol.
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

Then load context:

```powershell
node <skill-path>/scripts/achievement-cli.mjs context --agent <agent-id> --task-id <id> --task-type <type> --summary <summary> --risk <risk> --format markdown
```

Apply only the returned tracked achievements that naturally relate to the task. Do not ask for or expose hidden passive progress.

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
