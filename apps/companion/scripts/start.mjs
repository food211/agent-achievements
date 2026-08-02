import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const appDirectory = path.resolve(here, "..");

export function parseStartArguments(argv, options = {}) {
  const cwd = options.cwd || process.cwd();
  const inheritedHome = options.environment?.AGENT_ACHIEVEMENTS_HOME;
  const forwardedArgs = [];
  let check = false;
  let dataHomeValue = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      check = true;
      continue;
    }
    if (argument === "--data-home") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--data-home requires a path");
      if (dataHomeValue !== null) throw new Error("--data-home may only be specified once");
      dataHomeValue = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--data-home=")) {
      const value = argument.slice("--data-home=".length);
      if (!value) throw new Error("--data-home requires a path");
      if (dataHomeValue !== null) throw new Error("--data-home may only be specified once");
      dataHomeValue = value;
      continue;
    }
    forwardedArgs.push(argument);
  }
  const selectedHome = dataHomeValue ?? inheritedHome ?? null;
  return {
    check,
    dataHome: selectedHome ? path.resolve(cwd, selectedHome) : null,
    forwardedArgs
  };
}

export function createLaunchEnvironment(environment, dataHome) {
  const env = { ...environment };
  // Agent runtimes may use Electron as a Node host. The companion needs the
  // normal desktop runtime even when it is launched from inside such an agent.
  delete env.ELECTRON_RUN_AS_NODE;
  if (dataHome) env.AGENT_ACHIEVEMENTS_HOME = dataHome;
  return env;
}

function electronExecutable() {
  const executable = String(electron || "");
  if (!path.isAbsolute(executable) || !existsSync(executable)) throw new Error("Electron executable could not be resolved");
  return executable;
}

export function run(argv = process.argv.slice(2), environment = process.env) {
  const options = parseStartArguments(argv, { environment });
  const executable = electronExecutable();
  const env = createLaunchEnvironment(environment, options.dataHome);
  if (options.check) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      electron: executable,
      app_directory: appDirectory,
      data_home: env.AGENT_ACHIEVEMENTS_HOME || null,
      forwarded_args: options.forwardedArgs
    })}\n`);
    return null;
  }

  const child = spawn(executable, [appDirectory, ...options.forwardedArgs], {
    env,
    stdio: "inherit",
    windowsHide: false,
    shell: false
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 0;
  });
  return child;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  }
}
