# Integration choices

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

Retrospective diagnosis is a second narrow workflow. The companion creates a request; the Agent reports only past, evidence-backed positive outcomes. The companion—not the Agent—applies the automatic-settlement policy and stores the award provenance.
