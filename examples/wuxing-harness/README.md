# Wuxing Harness integration

This example shows a third-party system using Agent Achievements without sharing its internal scheduler or task model.

1. Wuxing Harness reads the tracked achievement context at task start.
2. It emits `agent-achievements/v1` events for meaningful outcomes.
3. The achievement service updates both tracked and hidden passive progress.
4. The agent submits a claim only when the event response marks an achievement claimable.
5. A human reviews evidence; the review never blocks Harness execution.

Files:

- `product-gatekeeper.achievement.json`: human-defined achievement;
- `judgment-requested.event.json`: normalized Harness event;
- `product-gatekeeper.claim.json`: evidence-backed agent claim;
- `agent-context.response.json`: compact task-start context.
- `agent-presence.json`: runtime-neutral session heartbeat for desktop companions.

Run the local adapter from the repository root:

```powershell
node skills\use-agent-achievements\scripts\achievement-cli.mjs init
node skills\use-agent-achievements\scripts\achievement-cli.mjs define --input examples\wuxing-harness\product-gatekeeper.achievement.json
node skills\use-agent-achievements\scripts\achievement-cli.mjs track --achievement product-gatekeeper
node skills\use-agent-achievements\scripts\achievement-cli.mjs report --input examples\wuxing-harness\judgment-requested.event.json
```
