# Wuxing Harness integration

This example shows a third-party system using Agent Achievements without sharing its internal scheduler or task model.

1. Wuxing Harness reads the tracked achievement context at task start.
2. A rule must be approved, applied, and verified before Harness emits a `rule.revised` event.
3. The achievement service updates progress and asks the Agent for an evidence-backed claim.
4. The desktop companion shows the claim to the human instead of awarding it automatically.
5. The human awards or rejects it; the result returns in the Agent's context on the next task.

The first-run diagnostic also shows retrospective settlement: the Agent identifies a positive workflow change already produced through Wuxing Harness, submits `initial-diagnostic.report.json`, and the companion awards the high-confidence silver discovery once. Installing Harness alone never earns it.

Files:

- `product-gatekeeper.achievement.json`: human-defined achievement;
- `judgment-requested.event.json`: normalized Harness event;
- `product-gatekeeper.claim.json`: evidence-backed agent claim;
- `agent-context.response.json`: compact task-start context.
- `agent-presence.json`: runtime-neutral session heartbeat for desktop companions.
- `initial-diagnostic.report.json`: evidence-backed retrospective discovery for the first companion settlement.

Run the local adapter from the repository root:

```powershell
node skills\use-agent-achievements\scripts\achievement-cli.mjs init
node skills\use-agent-achievements\scripts\achievement-cli.mjs define --input examples\wuxing-harness\product-gatekeeper.achievement.json
node skills\use-agent-achievements\scripts\achievement-cli.mjs track --achievement product-gatekeeper
node skills\use-agent-achievements\scripts\achievement-cli.mjs report --input examples\wuxing-harness\judgment-requested.event.json
```

When both Skills are installed side by side, `wuxing-harness` performs the event and claim handoff automatically. If Agent Achievements is absent, Harness keeps the event in its local outbox and continues the audit.
