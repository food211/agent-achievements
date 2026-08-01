# Agent Achievements

[简体中文](./README.md)

**What if AI agents could remember what humans appreciated about their work?**

Agent Achievements is an open achievement layer for AI agents. Third-party systems report normalized work events, humans define and award evidence-backed achievements, and agents receive a compact view of what they earned and what they are currently encouraged to pursue.

## Product model

- **Passive achievements** progress in the background and do not influence an agent before they unlock.
- **Tracked achievements** are explicitly selected by a human and appear in agent context as soft encouragement.
- **System discoveries** retrospectively recognize positive outcomes already produced through installed Skills, rules, and verifiable artifacts.
- **Human-created achievements** are defined directly by a person or drafted by an Agent for human review.
- **Tiers and points.** Bronze, silver, and gold are worth 10, 30, and 100 points. Points are added only after a human awards the achievement.
- **Rules remain stronger than achievements.** User instructions, safety, project constraints, and task correctness always take priority.
- **Claims require evidence.** An agent may apply for an achievement but cannot award itself.
- **Review is non-blocking.** The agent continues its primary task after submitting a claim.

The first integration is [Wuxing Agent Harness](./examples/wuxing-harness/README.md), but the protocol is intentionally runtime-neutral.

## Desktop companion

The living trophy follows the lifecycle of any installed agent through the runtime-neutral `presence` heartbeat. It does not inspect Codex-specific process names:

- it stays visible, breathes and sleeps, and uses presence to show whether an agent is active;
- it can display the identity and current task of connected agents;
- it sleeps when heartbeats expire or sessions stop;
- it expands to show tracked goals, progress, and recent human recognition.
- the whole trophy distinguishes a short click from a drag after a movement threshold;
- it snaps to the left, right, or top edge, keeps a clearly visible peek, and reveals itself on hover;
- opening and closing the panel restores the trophy's exact prior position;
- people can create or edit bronze, silver, and gold achievements, preserve existing progress, and switch tracked goals from either the catalog or tracked list;
- on first run, the companion asks the Agent to review evidence-backed positive outcomes and separates system discoveries from human-created goals;
- when a person only knows the behavior they want to encourage, they can ask an installed agent to return a schema-valid, editable achievement draft;
- it celebrates new achievements and offers an explicit launch-at-login toggle.

On Windows, a dedicated high-contrast living-trophy icon appears in the system tray while the companion stays out of the taskbar.

The status light is green while an agent is working, amber while it is waiting after a turn, and gray when no valid session remains. Codex can keep this state current through its official lifecycle hooks:

```powershell
node skills/use-agent-achievements/scripts/install-codex-hooks.mjs
```

Review and trust the installed hook in Codex `/hooks`. It writes normalized presence only, does not read prompt content, and never counts presence as achievement evidence.

Window geometry and typography use system DIPs, and the companion repositions itself when display scale metrics change.

The companion and the Skill share normalized state in `~/.agent-achievements`. Set `AGENT_ACHIEVEMENTS_HOME` to isolate a profile or workspace.

Choose a custom image in the expanded panel, or let an agent install a generated image with:

```powershell
node skills/use-agent-achievements/scripts/achievement-cli.mjs avatar --input <image-path>
```

PNG, JPG, WebP, and SVG files up to 5 MB are supported. Use `avatar --reset` to restore the trophy.

## Repository map

```text
agent-achievements/
├── apps/demo/                         # Human UI + agent context preview
├── apps/companion/                    # Desktop companion following agent presence
├── packages/protocol/                 # Canonical JSON Schemas
├── skills/use-agent-achievements/     # Installable agent Skill
├── examples/wuxing-harness/           # Third-party integration example
└── tests/                              # Schema conformance tests
```

## Quick start

Node.js 20 or newer is required.

```powershell
npm install
npm run dev
```

Start the desktop companion:

```powershell
npm run companion
```

Run validation:

```powershell
npm run validate
```

## Agent-facing operations

The normal task protocol deliberately exposes only three actions:

1. `achievements_get_context` at task start;
2. `achievements_report_event` for meaningful work events;
3. `achievements_submit_claim` only when the event response marks an achievement as claimable.

A separate `presence` lifecycle signal controls the companion's activity state and never counts as achievement evidence.

Only after a human explicitly asks for design help does agent context include `design_requests`. An installed agent can submit an `achievement-design-proposal.schema.json` draft, but the human must edit or save it and remains the only authority that can award it.

First-run and manual retrospectives add `diagnostic_requests`. The Agent submits evidence-backed discoveries; the companion automatically settles only high-confidence bronze or silver results. Medium-confidence discoveries and all gold awards require human confirmation. Installing or invoking a Skill is never sufficient evidence.

See [the protocol reference](./skills/use-agent-achievements/references/protocol.md) for payloads and behavior. The JSON Schemas in [`packages/protocol/schemas`](./packages/protocol/schemas) are the canonical source for every public `agent-achievements/v1` payload.

## License

[MIT](./LICENSE)
