import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  BRIDGE_RESTART_COOLDOWN_MS,
  BRIDGE_SWEEP_INTERVAL_MS,
  bridgeStatusIsFresh,
  processIsAlive,
  safeBridgeCommand,
  stopSupervisedBridges
} = require("../apps/companion/src/bridge-supervisor.cjs");

test("fresh bridge status also requires a live process", () => {
  const now = Date.parse("2026-08-02T03:00:00.000Z");
  const status = {
    agent_id: "agent-a",
    status: "connected",
    observed_at: new Date(now).toISOString(),
    pid: 42
  };
  assert.equal(bridgeStatusIsFresh(status, { agentId: "agent-a", now, processIsAlive: () => true }), true);
  assert.equal(bridgeStatusIsFresh(status, { agentId: "agent-a", now, processIsAlive: () => false }), false);
  assert.equal(bridgeStatusIsFresh({ ...status, pid: undefined }, { agentId: "agent-a", now, processIsAlive }), false);
  assert.equal(bridgeStatusIsFresh({ ...status, observed_at: new Date(now - 15_001).toISOString() }, { agentId: "agent-a", now, processIsAlive: () => true }), false);
});

test("process liveness treats ESRCH as dead and EPERM as alive", () => {
  assert.equal(processIsAlive(42, () => {}), true);
  assert.equal(processIsAlive(42, () => { const error = new Error("missing"); error.code = "ESRCH"; throw error; }), false);
  assert.equal(processIsAlive(42, () => { const error = new Error("denied"); error.code = "EPERM"; throw error; }), true);
  assert.equal(processIsAlive(0, () => {}), false);
});

test("bridge supervisor validates an explicit data home before launching", () => {
  const dataHome = path.resolve(".test-agent-achievements-home");
  const bridgeScript = fileURLToPath(new URL("../skills/use-agent-achievements/scripts/agent-bridge.mjs", import.meta.url));
  const adapter = {
    bridge_command: {
      program: process.execPath,
      args: [bridgeScript, "--data-home", dataHome, "--agent", "agent-a"],
      cwd: process.cwd()
    }
  };
  const command = safeBridgeCommand(adapter, { dataHome });
  assert.deepEqual(command?.args, adapter.bridge_command.args);
  assert.equal(safeBridgeCommand({
    bridge_command: { ...adapter.bridge_command, args: [bridgeScript, "--data-home", path.resolve("another-home"), "--agent", "agent-a"] }
  }, { dataHome }), null);
  assert.equal(safeBridgeCommand({
    bridge_command: { ...adapter.bridge_command, args: [bridgeScript, "--data-home", dataHome, `--data-home=${dataHome}`] }
  }, { dataHome }), null);
});

test("bridge supervision retries quickly after a dead process", () => {
  assert.ok(BRIDGE_SWEEP_INTERVAL_MS <= 1_000);
  assert.ok(BRIDGE_RESTART_COOLDOWN_MS <= 2_000);
});

test("quitting the companion stops every bridge it started", () => {
  let killed = 0;
  const records = new Map([
    ["agent-a", { running: true, child: { killed: false, kill: () => { killed += 1; } } }],
    ["agent-b", { running: true, child: { killed: true, kill: () => { killed += 1; } } }]
  ]);

  stopSupervisedBridges(records);

  assert.equal(killed, 1);
  assert.equal(records.size, 0);
});
