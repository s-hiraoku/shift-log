import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { storeFor } from "./lib/store.js";
import { resetRateLimitBuckets } from "./middleware/rate-limit.js";

const app = createApp();
const headers = { authorization: "Bearer alice-token", "content-type": "application/json" };

beforeEach(() => {
  vi.stubEnv("SHIFTLOG_API_TOKEN", "");
  vi.stubEnv("SHIFTLOG_API_TOKENS", "alice:alice-token,bob:bob-token");
  vi.stubEnv("SHIFTLOG_LLM_API_KEY", "");
  storeFor("alice").reset(); storeFor("bob").reset(); resetRateLimitBuckets();
});
afterEach(() => vi.unstubAllEnvs());

describe("activity HTTP API", () => {
  it("uploads and searches AX conversation text, isolates tenants and deletes evidence with history", async () => {
    await app.request("/v1/permissions", { method: "PUT", headers, body: JSON.stringify({ enabled: true, memories_enabled: true }) });
    const now = new Date().toISOString();
    expect((await app.request("/v1/windows", { method: "POST", headers, body: JSON.stringify({
      metadata: { window_id: "w-ax", window_start: now, window_end: now, devices: ["desk"], event_count: 1, schema_version: "1" },
      events: [{ id: "ax-one", type: "accessibility_snapshot", device: "desk", ts: now, app: "ChatGPT", ax: { title: "MCP", text: "User: improve retrieval\nAssistant: added search\nAPI_KEY=secret-value", truncated: false } }],
    }) })).status).toBe(200);
    const result = await (await app.request("/v1/activity?q=RETRIEVAL", { headers })).json();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].snippet).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    const id = result.items[0].id;
    const full = await app.request(`/v1/activity/${id}`, { headers });
    expect(full.status).toBe(200);
    expect((await full.json()).text).toContain("Assistant: added search");
    const bob = { authorization: "Bearer bob-token" };
    expect((await (await app.request("/v1/activity", { headers: bob })).json()).items).toEqual([]);
    expect((await app.request(`/v1/activity/${id}`, { headers: bob })).status).toBe(404);
    expect((await app.request("/v1/activity")).status).toBe(401);
    expect((await app.request("/v1/activity?cursor=invalid", { headers })).status).toBe(400);
    expect((await app.request("/v1/activity?limit=101", { headers })).status).toBe(400);
    expect((await app.request("/v1/activity?since=2026-11-06T00:00:00Z&until=2026-11-05T00:00:00Z", { headers })).status).toBe(400);
    await app.request("/v1/history/delete", { method: "POST", headers, body: JSON.stringify({ scope: "all" }) });
    expect((await app.request(`/v1/activity/${id}`, { headers })).status).toBe(404);
  });
});
