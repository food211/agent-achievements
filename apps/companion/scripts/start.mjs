import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(here, "..");
const env = { ...process.env };

// Agent runtimes may use Electron as a Node host. The companion needs the
// normal desktop runtime even when it is launched from inside such an agent.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [appDirectory], {
  env,
  stdio: "inherit",
  windowsHide: false
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 0;
});

