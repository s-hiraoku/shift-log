import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config.js";
import { startMcpServer, type RunningServer } from "./app.js";

const MCP_TOKEN = "m".repeat(32);
const API_TOKEN = "a".repeat(32);
const MEMORY_ID = "mem_6h_2026-09-11T00:00:00.000Z";

const MEMORY = {
  id: MEMORY_ID,
  front_matter: {
    title: "Ponytail",
    description: "PR review",
    apps: ["Ghostty"],
    device: "desk",
    window_start: "2026-09-11T00:00:00.000Z",
    window_end: "2026-09-11T00:10:00.000Z",
    kind: "ten_minute",
    window_ids: ["w1"],
    skill_candidate: false,
  },
  body: "looked at ponytail",
  created_at: "2026-09-11T00:10:00.000Z",
  updated_at: "2026-09-11T00:10:00.000Z",
};

const RECENT = {
  mode: "context_only",
  memories: [MEMORY],
  note: "Read-only working memory.",
};

const CONTINUED = {
  mode: "context_only",
  prompt: "ponytail",
  memories: [{ ...MEMORY, matched_by: "keyword" }],
  note: "Context only.",
};

type RecordedRequest = {
  method: string;
  path: string;
  rawPath: string;
  query: Record<string, string>;
  authorization: string | null;
  body: unknown;
};

type FakeApi = {
  origin: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
};

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = closers.splice(0);
  for (const close of pending.reverse()) {
    await close();
  }
});

describe("parseConfig", () => {
  const base = { SHIFTLOG_API_TOKEN: API_TOKEN, SHIFTLOG_MCP_TOKEN: MCP_TOKEN };

  it("refuses a missing MCP token, dev-token, a short token, and a token equal to the API token", () => {
    expect(() => parseConfig({ SHIFTLOG_API_TOKEN: API_TOKEN }, [])).toThrow(ConfigError);
    expect(() =>
      parseConfig({ SHIFTLOG_API_TOKEN: API_TOKEN, SHIFTLOG_MCP_TOKEN: "dev-token" }, []),
    ).toThrow(/dev-token/);
    expect(() =>
      parseConfig({ SHIFTLOG_API_TOKEN: API_TOKEN, SHIFTLOG_MCP_TOKEN: "short-token" }, []),
    ).toThrow(/32 characters/);
    expect(() =>
      parseConfig({ SHIFTLOG_API_TOKEN: MCP_TOKEN, SHIFTLOG_MCP_TOKEN: MCP_TOKEN }, []),
    ).toThrow(/differ/);
    expect(() => parseConfig({ SHIFTLOG_MCP_TOKEN: MCP_TOKEN }, [])).toThrow(/SHIFTLOG_API_TOKEN/);
    expect(() => parseConfig({ ...base, SHIFTLOG_MCP_PORT: "8787" }, [])).toThrow(/reserved/);
  });

  it("defaults the port to 8790 and the origin to loopback 8787", () => {
    const config = parseConfig(base, []);
    expect(config.port).toBe(8790);
    expect(config.apiOrigin).toBe("http://127.0.0.1:8787");
    expect(parseConfig(base, ["--port", "0"]).port).toBe(0);
  });
});

describe("MCP HTTP", () => {
  it("returns 401 without a token, with the wrong token, and with the API token", async () => {
    const api = await startFakeApi();
    const mcp = await startMcp(api.origin);
    for (const headers of [
      {},
      { authorization: "Bearer wrong-token" },
      { authorization: `Bearer ${API_TOKEN}` },
    ]) {
      const res = await fetch(mcp.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: initializeBody(),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    const ok = await fetch(mcp.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${MCP_TOKEN}`,
      },
      body: initializeBody(),
    });
    expect(ok.status).toBe(200);
    expect(api.requests).toEqual([]);
  });

  it("lists five read-only tools and maps each call onto the ShiftLog API", async () => {
    const api = await startFakeApi({
      "GET /v1/agent/recent": { status: 200, json: RECENT },
      "POST /v1/agent/continue": { status: 200, json: CONTINUED },
      "GET /v1/timeline": { status: 200, json: { items: [MEMORY], next_cursor: null } },
      "GET /v1/search": { status: 200, json: { items: [MEMORY] } },
      [`GET /v1/memories/${MEMORY_ID}`]: { status: 200, json: MEMORY },
    });
    const mcp = await startMcp(api.origin);
    const client = new Client({ name: "shiftlog-mcp-test", version: "0" });
    closers.push(async () => {
      await client.close();
    });
    await client.connect(
      new StreamableHTTPClientTransport(mcp.url, {
        requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } },
      }),
    );

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "continue_context",
      "get_memory",
      "recent_memories",
      "search_memories",
      "timeline",
    ]);
    for (const tool of listed.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    const recent = await client.callTool({ name: "recent_memories", arguments: { limit: 12 } });
    expect(recent.structuredContent).toEqual(RECENT);
    expect(api.requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/agent/recent",
      query: { limit: "12" },
      authorization: `Bearer ${API_TOKEN}`,
      body: null,
    });
    expect(api.requests[0]?.rawPath.includes("mode")).toBe(false);

    const continued = await client.callTool({
      name: "continue_context",
      arguments: { prompt: "ponytail", limit: 12 },
    });
    expect(continued.structuredContent).toEqual(CONTINUED);
    expect(api.requests[1]).toMatchObject({
      method: "POST",
      path: "/v1/agent/continue",
      authorization: `Bearer ${API_TOKEN}`,
      body: { prompt: "ponytail", limit: 12 },
    });
    expect(api.requests[1]?.body).not.toHaveProperty("mode");

    const timeline = await client.callTool({
      name: "timeline",
      arguments: { q: "ponytail", limit: 20 },
    });
    expect(timeline.structuredContent).toEqual({ items: [MEMORY], next_cursor: null });
    expect(api.requests[2]).toMatchObject({
      method: "GET",
      path: "/v1/timeline",
      query: { q: "ponytail", limit: "20" },
      authorization: `Bearer ${API_TOKEN}`,
    });

    const search = await client.callTool({
      name: "search_memories",
      arguments: { q: "ponytail" },
    });
    expect(search.structuredContent).toEqual({ items: [MEMORY] });
    expect(api.requests[3]).toMatchObject({
      method: "GET",
      path: "/v1/search",
      query: { q: "ponytail", limit: "50" },
      authorization: `Bearer ${API_TOKEN}`,
    });

    const beforeGet = api.requests.length;
    const got = await client.callTool({ name: "get_memory", arguments: { id: MEMORY_ID } });
    expect(got.structuredContent).toEqual(MEMORY);
    const getRequest = api.requests[beforeGet];
    expect(getRequest?.method).toBe("GET");
    expect(getRequest?.path).toBe(`/v1/memories/${MEMORY_ID}`);
    expect(getRequest?.rawPath).toBe(`/v1/memories/${encodeURIComponent(MEMORY_ID)}`);
    expect(getRequest?.authorization).toBe(`Bearer ${API_TOKEN}`);
    expect(getRequest?.query).toEqual({});
  });

  it("does not call the API for a dot-segment id and reports not_found for a miss", async () => {
    const api = await startFakeApi({
      "GET /v1/memories/missing": { status: 404, json: { error: "not_found" } },
    });
    const mcp = await startMcp(api.origin);
    const client = new Client({ name: "shiftlog-mcp-test", version: "0" });
    closers.push(async () => {
      await client.close();
    });
    await client.connect(
      new StreamableHTTPClientTransport(mcp.url, {
        requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } },
      }),
    );

    const dot = await client.callTool({ name: "get_memory", arguments: { id: "." } });
    expect(dot.isError).toBe(true);
    const dots = await client.callTool({ name: "get_memory", arguments: { id: ".." } });
    expect(dots.isError).toBe(true);
    expect(api.requests).toEqual([]);

    const missing = await client.callTool({ name: "get_memory", arguments: { id: "missing" } });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/^not_found/);
    expect(api.requests).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/v1/memories/missing",
        authorization: `Bearer ${API_TOKEN}`,
      }),
    ]);
  });
});

function decodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  const block = result.content?.find((item) => item.type === "text");
  return block?.text ?? "";
}

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  });
}

async function startMcp(origin: string): Promise<RunningServer> {
  const running = await startMcpServer(
    parseConfig(
      {
        SHIFTLOG_MCP_TOKEN: MCP_TOKEN,
        SHIFTLOG_API_TOKEN: API_TOKEN,
        SHIFTLOG_API_ORIGIN: origin,
      },
      ["--port", "0"],
    ),
  );
  closers.push(() => running.close());
  return running;
}

function startFakeApi(
  routes: Record<string, { status: number; json: unknown }> = {},
): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    void record(req, res, routes, requests);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("fake API did not bind"));
        return;
      }
      const api: FakeApi = {
        origin: `http://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      };
      closers.push(() => api.close());
      resolve(api);
    });
  });
}

async function record(
  req: IncomingMessage,
  res: ServerResponse,
  routes: Record<string, { status: number; json: unknown }>,
  requests: RecordedRequest[],
): Promise<void> {
  const rawUrl = req.url ?? "/";
  const url = new URL(rawUrl, "http://127.0.0.1");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  const path = decodePath(url.pathname);
  requests.push({
    method: req.method ?? "GET",
    path,
    rawPath: rawUrl.split("?")[0] ?? rawUrl,
    query: Object.fromEntries(url.searchParams),
    authorization: typeof req.headers.authorization === "string" ? req.headers.authorization : null,
    body,
  });
  const route = routes[`${req.method} ${path}`];
  if (!route) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("unknown route");
    return;
  }
  res.writeHead(route.status, { "content-type": "application/json" });
  res.end(JSON.stringify(route.json));
}
