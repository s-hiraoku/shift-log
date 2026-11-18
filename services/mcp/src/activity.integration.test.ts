import { serve } from "@hono/node-server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../../api/src/app.js";
import { store } from "../../api/src/lib/store.js";
import { DesktopCollector } from "../../../apps/desktop/src/collector.js";
import { PermissionsConfigSchema } from "@shift-log/schema";
import { startMcpServer } from "./app.js";
import { parseConfig } from "./config.js";

afterEach(() => vi.unstubAllEnvs());

it("serves collector AX text through the real authenticated API and MCP search/get", async () => {
  vi.stubEnv("SHIFTLOG_API_TOKEN", "api-test");
  vi.stubEnv("SHIFTLOG_API_TOKENS", "");
  vi.stubEnv("SHIFTLOG_LLM_API_KEY", "");
  store.reset();
  const permissions = PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true });
  store.setPermissions(permissions);
  const app = createApp();
  const collector = new DesktopCollector(permissions, "http://unused", "api-test");
  collector.upload = (data) => app.request("/v1/windows", { method: "POST", headers: { authorization: "Bearer api-test", "content-type": "application/json" }, body: JSON.stringify(data) });
  collector.observeAx({ app: "ChatGPT", title: "Conversation" }, { title: "Conversation", text: "User: search AX conversation\nAssistant: implementation complete", truncated: false });
  expect((await collector.flushWindow(new Date())).uploaded).toBe(true);
  const api = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!api.listening) await new Promise<void>((resolve) => api.once("listening", resolve));
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("API did not bind");
  const mcp = await startMcpServer(parseConfig({ SHIFTLOG_API_TOKEN: "api-test", SHIFTLOG_MCP_TOKEN: "m".repeat(32), SHIFTLOG_API_ORIGIN: `http://127.0.0.1:${address.port}` }, ["--port", "0"]));
  const client = new Client({ name: "ax-integration-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(mcp.url, { requestInit: { headers: { authorization: `Bearer ${"m".repeat(32)}` } } }));
    const search = await client.callTool({ name: "search_activity", arguments: { q: "AX conversation" } });
    expect(search.isError).not.toBe(true);
    const data = search.structuredContent as { items: Array<{ id: string; snippet: string }> };
    expect(data.items[0]?.snippet).toContain("implementation complete");
    const full = await client.callTool({ name: "get_activity", arguments: { id: data.items[0]!.id } });
    expect(full.structuredContent).toMatchObject({ source: "accessibility", app: "ChatGPT", text: "User: search AX conversation\nAssistant: implementation complete" });
    expect((await client.callTool({ name: "get_activity", arguments: { id: ".." } })).isError).toBe(true);
  } finally {
    await client.close(); await mcp.close();
    await new Promise<void>((resolve, reject) => api.close((err) => err ? reject(err) : resolve()));
  }
});
