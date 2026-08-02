# Integration choices

## Zero-setup activation

Install `wuxing-harness` and `use-agent-achievements` as sibling folders in a directory the host Code Agent can read. The installing Agent, not the user, must discover the workspace, Skills directory, stable identity, runtime ID, and truthful host capabilities. Follow `docs/code-agent-adapter-contract.md`.

From the repository root:

```powershell
node scripts/install-agent-skills.mjs --target <skills-directory> --workspace <workspace> --agent <agent-id> --runtime <runtime-id> --capability agent-skills --capability task-boundary
```

`--project <workspace>` selects `<workspace>/.agents/skills`. Repeat `--target` and `--capability` when needed. The installer copies both Skills, runs the idempotent achievement bootstrap, initializes Wuxing Harness for the workspace, seeds the bronze Product Gatekeeper, silver Rule Gardener, and gold Loop Tuner challenges, and returns four Agent-owned startup actions:

- start or detect the desktop companion;
- start or detect the persistent per-Agent bridge;
- a current workspace rule diagnosis;
- a retrospective of positive outcomes already completed.

The installing Agent consumes those actions in the same turn when possible. No user action is needed to initialize state, start the connection, track a default challenge, report routine completions, or submit a claim.

`ensure_companion_running` contains a probe and an absolute Node launch command. `ensure_agent_bridge` contains a file-freshness plus live-PID probe and an argv-style `bridge_command`. Both commands carry the selected data-home as an explicit argument. Launch both detached with `shell: false`; the bridge lock prevents duplicate per-Agent instances. The portable installer returns `activation_complete: false` while Agent-owned actions remain. It does not launch Electron during tests or pretend to install a GUI across every platform; source installs retain the repository that contains the companion runtime.

## Host capability discovery

Declare only capabilities the runtime actually exposes:

- `agent-skills`: native discovery of the open Skill folder format;
- `task-boundary`: execution at Agent turn start and end;
- `lifecycle-hook`: trusted session lifecycle hooks;
- `post-task-event`: normalized completion events;
- `background-wake`: an explicit API that can resume an Agent without a new user turn.

If the host has no native Agent Skills support, keep these portable folders unchanged and add a minimal host-owned rule bridge that loads both `SKILL.md` files at each task boundary. Do not add vendor branches to the portable protocol.

Hooks can automate companion and bridge restoration, presence, and task event capture. On every Coding Agent startup, a trusted startup hook restores the companion when needed, then probes and restores the saved `bridge_command` before the first task. Without hooks, the Skill performs the same recovery automatically at the beginning of the first Agent turn, then runs the bootstrap, context, event, claim, and queued-action loop. Pending actions persist to the next turn. A runtime without `background-wake` cannot be awakened by the companion or this Skill; never claim otherwise.

## Local state

The default shared directory is `~/.agent-achievements`; set `AGENT_ACHIEVEMENTS_HOME` to isolate a profile. Wuxing workspace state lives at `<workspace>/.wuxing-harness` unless `WUXING_HARNESS_HOME` overrides it.

Bootstrap directly when repairing an installation:

```powershell
node <skill-path>/scripts/achievement-cli.mjs bootstrap --agent <agent-id> --runtime <runtime-id> --workspace <workspace> --capability <capability>
node <wuxing-skill-path>/scripts/harness-cli.mjs init --workspace <workspace> --agent <agent-id>
```

These commands are idempotent. They must not erase awards, progress, queued diagnostics, or user-authored achievements.

## Persistent local connection

The companion writes `connection.json` under `AGENT_ACHIEVEMENTS_HOME`. It contains a loopback TCP endpoint and a random authentication token; the token is local state, not prompt context. The Agent launches the `bridge_command` returned by bootstrap rather than rebuilding a shell command from strings.

The bridge:

- accepts only loopback endpoints and authenticates its first message;
- keeps one connection per Agent identity and sends heartbeat frames;
- reconnects with bounded backoff when the companion is unavailable;
- rereads `connection.json` so companion restarts and token rotation require no user action;
- writes `bridges/<agent-hash>.json` with `connected`, `reconnecting`, or `stopped` health plus a live PID;
- writes pushed context and pending actions to `agent-inbox.json` without copying secrets.

Connection health is not task activity. Continue to use `presence.json` for active, idle, or stopped work. Neither socket heartbeats nor connection duration may advance an achievement or satisfy evidence requirements.

## Runtime loop

At every task boundary:

1. send runtime-neutral presence and get task context;
2. obey user instructions, safety, project rules, and correctness before achievement guidance;
3. report one meaningful outcome with evidence references;
4. let local `report` create the claim automatically; use explicit claim submission only when a remote adapter requests it and has not already created one;
5. retain scheduled challenges as soft preferences for future relevant tasks;
6. mark the session idle or stopped.

Points may guide a tie between equally valid, in-scope approaches. They never grant permissions, justify extra scope, or weaken verification. An Agent may report and claim but may not award itself.

## Third-party systems

Map native runtime events to `agent-achievements/v1` before submission. Do not make the achievement service understand vendor-specific task models.

Recommended HTTP mapping:

- `GET /v1/agents/{agent_id}/achievement-context`
- `POST /v1/bootstrap`
- `POST /v1/presence`
- `POST /v1/events`
- `POST /v1/claims`
- `POST /v1/claims/{claim_id}/decision`

Use the same JSON Schemas for local files, HTTP payloads, MCP tools, and generated SDK types. Human or trusted policy surfaces own award decisions; Agent-facing adapters do not expose self-award operations.
