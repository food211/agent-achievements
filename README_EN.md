# Agent Achievements

[简体中文](./README.md)

**What if AI agents could remember what humans appreciated about their work?**

Agent Achievements is an open achievement layer for AI agents. Third-party systems report normalized work events, humans define and award evidence-backed achievements, and agents receive a compact view of what they earned and what they are currently encouraged to pursue.

## Product model

- **Passive achievements** progress in the background and do not influence an agent before they unlock.
- **Tracked achievements** are explicitly selected by a human and appear in agent context as soft encouragement.
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
- its bottom edge is a dedicated drag handle with a hover cue, while the trophy remains a click-only target;
- it snaps to any screen edge, retreats to a small peek, and reveals itself on hover;
- it celebrates new achievements and offers an explicit launch-at-login toggle.

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

The protocol deliberately exposes only three actions:

1. `achievements_get_context` at task start;
2. `achievements_report_event` for meaningful work events;
3. `achievements_submit_claim` only when the event response marks an achievement as claimable.

A separate `presence` lifecycle signal controls companion visibility and never counts as achievement evidence.

See [the protocol reference](./skills/use-agent-achievements/references/protocol.md) for payloads and behavior. The JSON Schemas in [`packages/protocol/schemas`](./packages/protocol/schemas) are the canonical source for every public `agent-achievements/v1` payload.

## License

[MIT](./LICENSE)
