---
name: use-agent-achievements
description: Automatically connect a Code Agent to the Wuxing companion and Agent Achievements protocol after installation; bootstrap local state, keep the local bridge alive, maintain presence, read achievement guidance, record completed work so evidence-backed claims can be created, and continue queued diagnostics or challenges without user setup. Use at every Coding Agent startup and task boundary after installation, when another Skill reports an outcome, or when a third-party system integrates with agent-achievements/v1.
---

# Use Agent Achievements

This Skill follows the open Agent Skills folder format. Do not assume Codex, Claude Code, Cursor, OpenCode, or any other specific host. Resolve `<skill-path>` from the installed `SKILL.md` location and use the bundled scripts with Node.js 20 or newer.

Treat achievements as soft preferences. Keep this priority order:

1. current user instruction;
2. safety and project rules;
3. task correctness;
4. tracked achievements.

Never expand task scope, fabricate evidence, skip required checks, or interrupt useful work to obtain an achievement. Points are reinforcement, not authority. They may break a tie between equally safe, correct, in-scope approaches; they may not change permissions, risk tolerance, acceptance criteria, or the user's requested outcome.

## Activate automatically after installation

The repository installer normally runs bootstrap. If context or state is missing, run the same idempotent command yourself instead of asking the user to configure achievements:

```powershell
node <skill-path>/scripts/achievement-cli.mjs bootstrap --agent <agent-id> --runtime <runtime-id> --workspace <workspace> --capability <capability>
```

Repeat `--capability` for capabilities the current host actually exposes. Use stable, truthful IDs. Do not claim lifecycle hooks, post-task events, or background wake support that the host does not provide.

Consume every returned `agent_next_actions` item without asking the user to create, track, or claim anything:

- `ensure_companion_running`: use the action's probe and launch command to start the desktop companion once when this repository or an installed executable is available. Start it detached so the Agent task can continue. Do not treat the GUI as a protocol dependency and do not claim it was launched when the host cannot run desktop applications.
- `ensure_agent_bridge`: check the action's file-freshness probe and confirm the recorded PID is still alive. If either check fails, launch the exact `bridge_command` detached with `shell: false`. The bridge must remain alive after the invoking terminal returns; its per-Agent lock prevents duplicate instances, and it reconnects automatically when the companion starts, restarts, or rotates its endpoint and token. Do not copy the token into prompts, logs, or command arguments.
- `run_wuxing_diagnostic`: load the sibling `wuxing-harness` Skill and perform its initial read-only rule diagnosis. Store evidence-backed findings; do not silently modify rules that require human judgment.
- `diagnose_past_achievements`: inspect completed work, accepted rules, tests, commits, and reusable workflow improvements, then submit one retrospective report as described below.

After an action succeeds, close it so it is not assigned again:

```powershell
node <skill-path>/scripts/achievement-cli.mjs action-complete --action <action-id> --summary <observable-result>
```

Do not close a deferred or failed action. Keep its evidence and resume it later.

These are separate jobs: the first diagnoses current rule health; the second recognizes positive outcomes that already happened. If the runtime cannot continue in the background, leave pending actions intact and resume them at the beginning of the next Agent turn. Never tell the user that the Agent can be awakened when the host has no such capability.

## At every Agent start and task start

At process or session startup, a trusted hook should restore the companion when needed and then probe and restore the saved bridge before the first task. At the beginning of the first Agent turn, rerun the idempotent `bootstrap` command to refresh capabilities and consume any returned runtime actions; without a hook, that first turn performs the same recovery. Never ask the user to start either process.

Treat `connection.json` as a local discovery file owned by the companion. The bridge reads its loopback TCP endpoint and short-lived token, authenticates, keeps the socket open, follows endpoint or token rotation, and backs off while reconnecting. It writes connection health to `bridges/<agent-hash>.json` and delivered context or actions to `agent-inbox.json`. Keep these files under `AGENT_ACHIEVEMENTS_HOME`; never expose the token or accept a non-loopback endpoint.

A connected bridge means only that the communication path is alive. Continue sending normalized presence for actual `active`, `idle`, and `stopped` task state. Neither a connection nor a heartbeat is achievement evidence.

At every task start, announce the current agent session so a companion or third-party interface can distinguish real activity from an idle long connection:

```powershell
node <skill-path>/scripts/achievement-cli.mjs presence --agent <agent-id> --session <session-id> --runtime <runtime-id> --status active --task-id <id> --summary <summary>
```

Refresh the heartbeat during long work. It expires automatically if the agent crashes or cannot send a final update.

Then load context automatically:

```powershell
node <skill-path>/scripts/achievement-cli.mjs context --agent <agent-id> --task-id <id> --task-type <type> --summary <summary> --risk <risk> --format markdown
```

Apply only the returned active challenge or tracked achievements that naturally relate to the task. Treat their encouragement as a soft preference: prefer a relevant optional check, clearer evidence, or a safer reusable workflow when those choices already fit the task. Do not ask the user to select a challenge and do not expose hidden passive progress.

If the context contains `design_requests`, draft a proposal without making the user fill in a detailed achievement form. Reward an observable outcome rather than raw activity, include guardrails against gaming, and choose the lowest suitable tier. Write a proposal matching `achievement-design-proposal.schema.json`, then submit it with:

```powershell
node <skill-path>/scripts/achievement-cli.mjs design-submit --input <proposal.json>
```

Tier values are fixed: bronze = 10 points, silver = 30 points, gold = 100 points. Never choose a higher tier merely to motivate yourself. A trusted policy engine may schedule the draft; the Agent must not award it to itself.

If the context contains `diagnostic_requests`, perform a retrospective diagnosis of positive outcomes already created through installed Skills and project rules. Inspect concrete artifacts such as accepted rule revisions, commits, tests, decision records, and reusable workflow changes. Do not reward installation, tool calls, activity volume, or unverified self-description. Submit at most eight discoveries matching `achievement-diagnostic-report.schema.json` with:

```powershell
node <skill-path>/scripts/achievement-cli.mjs diagnostic-submit --input <report.json>
```

Use `high` confidence only when the Skill attribution and positive outcome both have direct evidence. The trusted award policy, not the Agent, decides whether a result is awarded automatically or needs human review. Never fabricate evidence or split one outcome into multiple discoveries.

## Record completed work automatically

Report every meaningful completed, failed, or parked task without waiting for the user to request a record. Do not turn individual tool calls or trivial edits into separate achievements. Create an event JSON file matching `references/protocol.md`, include concrete evidence references gathered during normal verification, then run:

```powershell
node <skill-path>/scripts/achievement-cli.mjs report --input <event.json>
```

Use a stable `event_id`; retries are idempotent. Attach references rather than raw private task content when possible.

The local engine creates the claim—and eligible bronze or silver system award—as part of `report`. Do not submit the same claim again. The explicit `claim` operation is a compatibility fallback only: if a remote adapter returns `next_actions.action = submit_claim` without having created a claim, prepare the requested evidence and submit it immediately without asking the user to fill in or track anything:

```powershell
node <skill-path>/scripts/achievement-cli.mjs claim --input <claim.json>
```

Continue the primary task after submitting. Never wait for achievement review. Process any returned challenge-scheduling action only as a soft preference for later relevant work; never add unrequested work to the current task.

Pending claims and automatically awarded trophies appear in the desktop companion. `claim-list` and `review` exist for trusted human or policy surfaces, but an Agent must never call `review` to award itself.

## At every task or session end

Mark a still-open session idle when more user work may arrive, or stopped when the runtime is ending:

```powershell
node <skill-path>/scripts/achievement-cli.mjs presence --agent <agent-id> --session <session-id> --runtime <runtime-id> --status idle
```

Presence controls the companion's awake, working, and sleeping state. It is not achievement evidence by itself.

## Host capability and degradation

The commands above are the portable baseline. A host-specific adapter may automate presence and task-event reporting when the Code Agent exposes trusted hooks. Keep adapters thin: translate trusted host events into this protocol and preserve the same priority and evidence rules.

Without hooks, execute this Skill at Agent turn boundaries. The first turn checks and restores the persistent bridge, then automates context, completion recording, claims, and queued actions while the Agent is running. It cannot wake a stopped Agent or observe tasks completed outside the Agent. Persist work for the next turn instead of asking the user to relay it manually.

Codex users may optionally install the bundled adapter:

```powershell
node <skill-path>/scripts/install-codex-hooks.mjs
```

Do not run this installer in another Code Agent, and do not send duplicate manual heartbeats while the adapter is active. If the host requires explicit trust for hooks, continue with the portable turn-boundary mode until trust exists; achievement operation must not be blocked.

## Companion appearance

The companion defaults to an animated five-element assistant. Only when the user explicitly asks for a custom image, use an available image-generation capability or a user-provided file. Prefer a square PNG or WebP with a transparent or simple background, a readable silhouette, and no text. Install it with:

```powershell
node <skill-path>/scripts/achievement-cli.mjs avatar --input <png-jpg-webp-or-svg>
```

The companion detects the new image automatically. Restore the default assistant with `avatar --reset`. Never replace the user's avatar merely to pursue an achievement.

## Reporting to the user

- Mention a newly awarded trophy and its feedback briefly.
- Do not narrate routine progress increments unless asked.
- State clearly when evidence is insufficient instead of stretching the criteria.
- Do not ask the user to initialize, create, track, or submit routine claims.
- Let trusted award policy or the human surface award, reject, revoke, or schedule achievements; never self-award.

Read [references/protocol.md](references/protocol.md) when constructing payloads or integrating a third-party system. Read [references/integration.md](references/integration.md) when selecting file, HTTP, or runtime adapters.
