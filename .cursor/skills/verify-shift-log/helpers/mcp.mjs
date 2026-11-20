#!/usr/bin/env node
/**
 * Drive the isolated read-only ShiftLog MCP server started by launch-mcp.sh.
 *
 *   node helpers/mcp.mjs unauthorized
 *   node helpers/mcp.mjs api-token
 *   node helpers/mcp.mjs list
 *   node helpers/mcp.mjs call <tool> '<json args>'
 *
 * unauthorized / api-token print {"status":<number>,"body":...} and exit 0 only for HTTP 401.
 * list prints [{name, readOnlyHint, description}, ...].
 * call prints the tool's structuredContent.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");

function die(msg) {
  console.error(`verify-shift-log mcp: ${msg}`);
  process.exit(1);
}

function loadState() {
  const file =
    process.env.SHIFTLOG_VERIFY_STATE ||
    process.env.SHIFTLOG_VERIFY_CURRENT ||
    "/tmp/shiftlog-verify-current";
  if (!existsSync(file)) die(`no state file at ${file}. Run helpers/launch.sh first.`);
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  if (!env.SHIFTLOG_MCP_ORIGIN || !env.SHIFTLOG_MCP_TOKEN) {
    die(`MCP is not in ${realpathSync(file)}. Run helpers/launch-mcp.sh first.`);
  }
  return env;
}

function mcpUrl(env) {
  return new URL("/mcp", env.SHIFTLOG_MCP_ORIGIN.endsWith("/")
    ? env.SHIFTLOG_MCP_ORIGIN
    : `${env.SHIFTLOG_MCP_ORIGIN}/`);
}

const initBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "verify-shift-log", version: "0" },
  },
});

async function postInitialize(url, authorization) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (authorization) headers.authorization = authorization;
  const res = await fetch(url, { method: "POST", headers, body: initBody });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function expect401(url, authorization) {
  const result = await postInitialize(url, authorization);
  console.log(JSON.stringify(result));
  if (result.status !== 401) process.exit(1);
}

async function loadClient() {
  const require = createRequire(resolve(repoRoot, "services/mcp/package.json"));
  const href = pathToFileURL(require.resolve("@modelcontextprotocol/client")).href;
  return import(href);
}

async function withClient(env, fn) {
  const { Client, StreamableHTTPClientTransport } = await loadClient();
  const client = new Client({ name: "verify-shift-log", version: "0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl(env), {
        requestInit: { headers: { Authorization: `Bearer ${env.SHIFTLOG_MCP_TOKEN}` } },
      }),
    );
    await fn(client);
  } finally {
    await client.close();
  }
}

const [cmd, toolName, rawArgs] = process.argv.slice(2);
const env = loadState();
const url = mcpUrl(env);

if (cmd === "unauthorized") {
  await expect401(url, undefined);
} else if (cmd === "api-token") {
  if (!env.SHIFTLOG_API_TOKEN) die("SHIFTLOG_API_TOKEN missing from state");
  await expect401(url, `Bearer ${env.SHIFTLOG_API_TOKEN}`);
} else if (cmd === "list") {
  await withClient(env, async (client) => {
    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => ({
      name: tool.name,
      readOnlyHint: tool.annotations?.readOnlyHint ?? null,
      description: tool.description ?? "",
    }));
    console.log(JSON.stringify(tools, null, 2));
  });
} else if (cmd === "call") {
  if (!toolName) die("usage: mcp.mjs call <tool> '<json args>'");
  let args = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      die(`arguments are not JSON: ${rawArgs}`);
    }
  }
  await withClient(env, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: args });
    if (result.isError) {
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify(result.structuredContent, null, 2));
  });
} else {
  die("usage: mcp.mjs unauthorized | api-token | list | call <tool> '<json>'");
}
