# Wuxing Harness

> Install Wuxing Harness in any Code Agent to diagnose accumulated rules, record completed work, award evidence-backed trophies, and carry the next challenge into later tasks.

[简体中文](./README.md)

Wuxing Harness automatically audits accumulated Agent rules against current code, tests, run evidence, and explicit human decisions. Agent Achievements records verified outcomes, advances progress, creates eligible claims during the same successful report call, settles evidence-backed trophies through trusted policy or human review, and returns points and new challenges to later Agent context.

## Product model

- **Passive achievements** progress in the background and do not influence an agent before they unlock.
- **Active challenges** are scheduled automatically and appear in Agent context as soft encouragement.
- **System discoveries** retrospectively recognize positive outcomes already produced through installed Skills, rules, and verifiable artifacts.
- **Human-created achievements** are defined directly by a person or drafted by an Agent for human review.
- **Tiers and points.** Bronze, silver, and gold are worth 10, 30, and 100 points. Trusted policy may automatically award evidence-backed bronze and silver achievements; gold always remains under review. An Agent never awards itself.
- **Rules remain stronger than achievements.** User instructions, safety, project constraints, and task correctness always take priority.
- **Claims require evidence.** An agent may apply for an achievement but cannot award itself.
- **Review is non-blocking.** The Agent continues its primary task after `report` automatically creates an eligible claim.

Points are reinforcement, not authority. They may break a tie between equally safe, correct, in-scope approaches—for example by preferring clearer evidence or a more reusable implementation—but they never change permissions, risk tolerance, or requested scope.

The first integration is [Wuxing Harness](./skills/wuxing-harness/SKILL.md), but the protocol is intentionally runtime-neutral.

Bootstrap schedules three default Wuxing challenges: **Product Gatekeeper** (bronze, three independent judgment boundaries), **Rule Gardener** (silver, one approved and verified rule revision), and **Loop Tuner** (gold, three distinct verified rule-revision runs).

## Desktop companion

The desktop companion runs independently from every Code Agent. On Agent startup, the installed Skill automatically keeps a local `agent-bridge.mjs` alive and authenticated over loopback TCP; the companion does not inspect vendor process names:

- it stays visible, breathes and sleeps, and uses presence to show whether an agent is active;
- it can display the identity and current task of connected agents;
- its activity view sleeps when no valid work session remains, while the bridge stays connected;
- it expands to show tracked goals, progress, and recent human recognition.
- the whole trophy distinguishes a short click from a drag after a movement threshold;
- it snaps to the left, right, or top edge, keeps a clearly visible peek, and reveals itself on hover;
- opening and closing the panel restores the trophy's exact prior position;
- people may optionally create or edit bronze, silver, and gold achievements while the system schedules default challenges automatically;
- on first run, the companion asks the Agent to review evidence-backed positive outcomes and separates system discoveries from human-created goals;
- when a person only knows the behavior they want to encourage, they can ask an installed agent to return a schema-valid, editable achievement draft;
- it celebrates new achievements and offers an explicit launch-at-login toggle.

The persistent bridge carries context and actions and reconnects after companion restarts or endpoint-token rotation. Normalized `presence` still distinguishes real active, idle, and stopped work. A socket connection, heartbeat, or uptime is never task activity or achievement evidence.

On Windows, a five-element circle appears in the system tray while the companion stays out of the taskbar. Windows may initially place a new icon in the `^` overflow area; drag it into the notification area to keep it visible.

The companion stays on top by default. You can disable or re-enable this behavior from Appearance & presence or the tray menu; the choice is persisted locally.

The companion is also the desktop entry point for Wuxing Harness. “Audit rules” opens the public demonstration; the desktop shell adds dragging, always-on-top, snapping, and tray integration. Set `WUXING_ASSISTANT_URL=http://127.0.0.1:4318` to use the local service during development.

## Wuxing Harness

Agent rules tend to accumulate. Wuxing Harness audits those rules against current code, tests, run evidence, and explicit human decisions. Every proposed replacement includes evidence, impact scope, and reversibility. It waits for human approval before overwriting the old rule.

The current implementation covers three control relations:

- **Fire over Metal:** execution results overturn an old rule. A direct contradiction is raised once; recurring friction needs repeated evidence.
- **Metal over Wood:** the human approves or rejects a proposed branch.
- **Water over Fire:** new unattended automation, scheduled work, or external data synchronization pauses for human judgment.

```bash
npm install
npm run build --workspace=@agent-achievements/wuxing-assistant
npm run wuxing
```

Open `http://127.0.0.1:4318`. The demo walks through three evidence-backed rule problems from a real workspace. The public SPA demonstrates the same review loop without reading local files or requiring a model API key.

The current build does not claim a complete non-blocking task queue, Wood over Earth, Earth over Water, or prosperity-and-decline diagnostics.

The status light is green while an agent is working, amber while it is waiting after a turn, and gray when no valid session remains. Codex can keep this state current through its official lifecycle hooks:

```powershell
node skills/use-agent-achievements/scripts/install-codex-hooks.mjs
```

The installing Agent should inspect and install the hook. If Codex still shows a native trust prompt, that prompt is a host security boundary and must not be bypassed. The hook maintains normalized activity and restores the local bridge; it does not read prompt content, and neither presence nor connection uptime counts as achievement evidence.

Window geometry and typography use system DIPs, and the companion repositions itself when display scale metrics change.

The companion and the Skill share normalized state in `~/.agent-achievements`. Set `AGENT_ACHIEVEMENTS_HOME` to isolate a profile or workspace.

Choose a custom image in the expanded panel, or let an agent install a generated image with:

```powershell
node skills/use-agent-achievements/scripts/achievement-cli.mjs avatar --input <image-path>
```

PNG, JPG, WebP, and SVG files up to 5 MB are supported. Use `avatar --reset` to restore the animated five-element assistant.

## Repository map

```text
agent-achievements/
├── apps/demo/                         # Human UI + agent context preview
├── apps/companion/                    # Desktop companion following agent presence
├── packages/protocol/                 # Canonical JSON Schemas
├── skills/use-agent-achievements/     # Installable agent Skill
├── skills/wuxing-harness/              # Installable rule-audit Skill
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

Ask the current Coding Agent to adapt itself. This is the only setup request the user needs to make:

```text
Install Wuxing Harness from https://github.com/food211/harness-assistant. Read docs/code-agent-adapter-contract.md, discover your actual Skills or rules directory, workspace, stable identity, and truthful lifecycle capabilities, then install wuxing-harness and use-agent-achievements as sibling Skills. Run automatic bootstrap and consume all four actions: ensure_companion_running, ensure_agent_bridge, run_wuxing_diagnostic, and diagnose_past_achievements. Keep the companion and agent-bridge.mjs detached from the terminal. Restore the bridge from a real startup hook when available, or automatically during the first turn of every new session; do not claim pre-message connectivity on a host without such a hook. Verify that the bridge is connected and later tasks load encouragement, record outcomes, let report create claims, and receive new challenges. Do not ask me to initialize, start the connection, create, track, or claim achievements. Be truthful if background wake is unavailable, but do not make me maintain the connection manually.
```

The repository installer is the lower-level copy mechanism:

```powershell
npm run install:skills
```

For a Code Agent with a client-specific Skills directory, pass it explicitly:

```powershell
npm run install:skills -- --target <agent-skills-directory>
```

For one workspace, install into `<workspace>/.agents/skills`:

```powershell
npm run install:skills -- --project <workspace-directory>
```

The installer bootstraps local state, built-in Wuxing challenges, the workspace Harness state, and four pending Agent-owned actions: companion startup, persistent bridge startup, initial rule diagnosis, and a separate retrospective. The installing Agent must consume or truthfully defer those actions before declaring adaptation complete; the user does not need a terminal step. Source installs currently launch the companion from the retained repository, so that repository must remain available. The companion publishes a loopback endpoint and random token in `connection.json`; the bridge reconnects automatically, writes health under `bridges/`, and stores pushed context in `agent-inbox.json` without exposing secrets. A startup hook restores the companion and then the bridge before the first task when available; otherwise the first Agent turn restores both automatically. The bridge can remain connected, but cannot wake a stopped Agent unless the host explicitly supports that capability.

Run validation:

```powershell
npm run validate
```

## Agent-facing operations

Installation adds one idempotent `bootstrap` operation. The normal local task flow needs only two achievement actions:

1. `achievements_get_context` at task start;
2. `achievements_report_event` for meaningful work events.

Local `report` creates a claim during the same successful call when its target is reached, so the Agent must not submit it again after success. `achievements_submit_claim` remains only as a compatibility operation for a remote adapter that requests submission without already creating a claim. Separate bridge and `presence` signals carry messages and activity state; neither ever counts as achievement evidence.

When context includes `design_requests`, the Agent returns a schema-valid observable challenge without making the user fill in a detailed form. A trusted policy or human surface schedules and awards it; the Agent does not.

Bootstrap queues two runtime actions and two independent diagnostic jobs: it keeps the companion and Agent bridge alive, Wuxing diagnoses current rule health, and the achievement retrospective recognizes positive outcomes that already happened. The Agent submits evidence-backed discoveries and the trusted award policy determines automatic settlement versus human review. Installing a Skill, opening a connection, or sending heartbeats is never sufficient evidence.

See [the protocol reference](./skills/use-agent-achievements/references/protocol.md) for payloads and behavior. The JSON Schemas in [`packages/protocol/schemas`](./packages/protocol/schemas) are the canonical source for every public `agent-achievements/v1` payload.

## License

[MIT](./LICENSE)
