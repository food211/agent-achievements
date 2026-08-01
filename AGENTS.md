# Repository guide

This repository builds an open achievement layer for AI agents.

## Product boundaries

- Treat achievements as soft preferences. Never let them override user instructions, safety constraints, project rules, or task correctness.
- Passive achievements update silently. Only explicitly tracked achievements may be shown to an agent as encouragement.
- An agent may submit evidence-backed claims but may not award itself an achievement.
- Achievement review must never block the agent's primary task.
- Keep the agent interface small: get context, report an event, submit a claim.

## Protocol rules

- `packages/protocol/schemas/` is the canonical protocol source.
- Use JSON Schema 2020-12 and version all public payloads with `agent-achievements/v1`.
- Keep core objects strict with `additionalProperties: false`; put vendor data in `extensions`.
- Preserve event idempotency through `event_id`.
- Human and agent views may render differently, but must derive from the same canonical state.

## Validation

- Run `npm test` after changing schemas or examples.
- Run `npm run build` after changing the demo.
- Validate the installable Skill with the repository's documented `quick_validate.py` command.

