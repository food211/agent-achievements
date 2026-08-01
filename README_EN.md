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

## Repository map

```text
agent-achievements/
├── apps/demo/                         # Human UI + agent context preview
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

Run validation:

```powershell
npm run validate
```

## Agent-facing operations

The protocol deliberately exposes only three actions:

1. `achievements_get_context` at task start;
2. `achievements_report_event` for meaningful work events;
3. `achievements_submit_claim` only when the event response marks an achievement as claimable.

See [the protocol reference](./skills/use-agent-achievements/references/protocol.md) for payloads and behavior. The JSON Schemas in [`packages/protocol/schemas`](./packages/protocol/schemas) are the canonical source for every public `agent-achievements/v1` payload.

## Status

This repository currently contains the hackathon MVP: strict v1 schemas, a portable Skill, a Wuxing Harness example, and an interactive browser demo. A hosted API, authentication, and production persistence are intentionally left for the next milestone.

## License

[MIT](./LICENSE)

