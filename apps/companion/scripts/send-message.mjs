import { readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const VERSION = "agent-achievements/v1";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") { options.help = true; continue; }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

function nextLines(socket) {
  let buffer = "";
  const queue = [];
  const waiting = [];
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const value = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const waiter = waiting.shift();
      if (waiter) waiter(value); else queue.push(value);
    }
  });
  return () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("companion-message-timeout")), 60_000);
    waiting.push((value) => { clearTimeout(timer); resolve(value); });
  });
}

export async function sendCompanionMessage(options) {
  const dataHome = path.resolve(options.dataHome || path.join(os.homedir(), ".agent-achievements"));
  const workspace = path.resolve(options.workspace || process.cwd());
  const text = String(options.message || "").trim();
  if (!text || text.length > 8_000) throw new Error("Message must contain 1-8000 characters.");
  const endpoint = JSON.parse(await readFile(path.join(dataHome, "connection.json"), "utf8"));
  if (endpoint.transport !== "tcp" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.host)) throw new Error("Companion endpoint is not loopback TCP.");
  const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
  const nextLine = nextLines(socket);
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  socket.write(`${JSON.stringify({ type: "assistant_client", schema_version: VERSION, token: endpoint.token, client_id: options.clientId || `code-agent-${process.pid}` })}\n`);
  const welcome = await nextLine();
  if (welcome.type !== "assistant_welcome") throw new Error("Companion did not accept the assistant client.");
  const requestId = randomUUID();
  socket.write(`${JSON.stringify({ type: "assistant_prompt", schema_version: VERSION, request_id: requestId, workspace, text })}\n`);
  const response = await nextLine();
  socket.end();
  if (response.type !== "assistant_prompt_ack" || response.status !== "accepted") throw new Error(response.detail || "Companion rejected the message.");
  return response;
}

function usage() {
  return "Usage: node send-message.mjs --workspace <path> --message <text> [--data-home <path>] [--client-id <id>]";
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else process.stdout.write(`${JSON.stringify(await sendCompanionMessage(options))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
