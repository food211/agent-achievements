# Integration choices

## Portable installation

Install `wuxing-harness` and `use-agent-achievements` as sibling folders in any directory scanned by the host Code Agent. The cross-client default is `~/.agents/skills`; a client-specific directory is also valid.

The host Code Agent should discover its own Skills directory and lifecycle capabilities before installing. Follow `docs/code-agent-adapter-contract.md` from the repository. Keep host-specific Hook configuration in the user's Agent configuration, outside these portable Skills.

From the repository root:

```powershell
npm run install:skills
npm run install:skills -- --target <agent-skills-directory>
npm run install:skills -- --project <workspace>
```

The desktop companion is an independent Electron process. Skills exchange state with it through `~/.agent-achievements`; no Code Agent SDK or vendor process inspection is required.

## Local workspace

Use the bundled CLI and `.agent-achievements/` state for a local, portable integration. It requires only Node.js 20 or newer.

Initialize:

```powershell
node <skill-path>/scripts/achievement-cli.mjs init
node <skill-path>/scripts/achievement-cli.mjs define --input <achievement.json>
node <skill-path>/scripts/achievement-cli.mjs track --achievement <achievement-id>
```

The CLI creates:

```text
.agent-achievements/
├── state.json
├── events.jsonl
├── claims.jsonl
├── achievement-design-requests.json
├── achievement-diagnostics.json
└── presence.json
```

The default directory is `~/.agent-achievements` so a desktop companion and multiple agent workspaces can share one identity. Set `AGENT_ACHIEVEMENTS_HOME` to isolate a workspace or profile.

## Third-party system

Map native runtime events to `agent-achievements/v1` before submission. Do not make the achievement service understand vendor-specific task models.

Recommended HTTP mapping:

- `GET /v1/agents/{agent_id}/achievement-context`
- `POST /v1/presence`
- `POST /v1/events`
- `POST /v1/claims`
- `POST /v1/claims/{claim_id}/decision`

Use the same JSON Schemas for local files, HTTP payloads, MCP tools, and generated SDK types.

## Agent runtime adapter

Call context once at task start. Report meaningful events as they occur. Submit a claim only when requested by the report response. Avoid adding general-purpose achievement administration tools to the agent surface; creation, tracking, review, and revocation belong to the human interface.

Agent-assisted design is the narrow exception: after a human creates a design request, context exposes its ID and brief. The Agent may submit one schema-valid proposal for that request. It may not apply the proposal, change tracking, award points, or review its own claim.

Retrospective diagnosis is a second narrow workflow. The companion creates a request; the Agent reports only past, evidence-backed positive outcomes. The companion applies the automatic-settlement policy and stores the award provenance. The Agent does not.

Runtime hooks are optional translators. When a host exposes lifecycle hooks, an adapter may convert start, progress, idle, and stop events into the portable `presence` command. Without a hook, the Skill sends the same heartbeat directly. Do not make a host adapter a dependency of the protocol or desktop companion.
