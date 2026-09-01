import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { store } from "./lib/store.js";

const token = "dev-token";

function authHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

describe("ShiftLog API", () => {
  const app = createApp();

  beforeEach(() => {
    store.reset();
    process.env.SHIFTLOG_API_TOKEN = token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/v1/timeline");
    expect(res.status).toBe(401);
  });

  it("blocks window upload when default-off", async () => {
    const res = await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: "w1",
          window_start: "2026-08-30T01:00:00.000Z",
          window_end: "2026-08-30T01:10:00.000Z",
          devices: ["desk"],
          dual_lane: false,
          event_count: 1,
          schema_version: "1",
        },
        events: [
          {
            id: "e1",
            type: "click",
            ts: "2026-08-30T01:01:00.000Z",
            device: "desk",
            app: "Code",
          },
        ],
      }),
    });
    expect(res.status).toBe(403);
  });

  it("uploads window, summarizes, lists timeline, and continues as context-only", async () => {
    await app.request("/v1/permissions", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        enabled: true,
        memories_enabled: true,
        paused: false,
        private_browsing_excluded: true,
      }),
    });

    const upload = await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: "w-desk-mobile",
          window_start: "2026-08-30T01:00:00.000Z",
          window_end: "2026-08-30T01:10:00.000Z",
          devices: ["desk", "mobile"],
          dual_lane: true,
          event_count: 3,
          schema_version: "1",
        },
        events: [
          {
            id: "e1",
            type: "app_switch",
            ts: "2026-08-30T01:01:00.000Z",
            device: "desk",
            app: "Code",
            summary: "Editor focused",
          },
          {
            id: "e2",
            type: "typing_presence",
            ts: "2026-08-30T01:02:00.000Z",
            device: "desk",
            app: "Code",
            typing: { active: true, approxChars: 40 },
          },
          {
            id: "e3",
            type: "browser_navigation",
            ts: "2026-08-30T01:03:00.000Z",
            device: "mobile",
            app: "Safari",
            site: "example.com",
          },
        ],
      }),
    });
    expect(upload.status).toBe(200);
    const uploaded = await upload.json();
    expect(uploaded.accepted_events).toBe(3);

    const timeline = await app.request("/v1/timeline", { headers: authHeaders() });
    const timelineBody = await timeline.json();
    expect(timelineBody.items.length).toBeGreaterThan(0);

    const cont = await app.request("/v1/agent/continue", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ prompt: "続きやって" }),
    });
    const contBody = await cont.json();
    expect(contBody.mode).toBe("context_only");
    expect(contBody.memories.length).toBeGreaterThan(0);
  });

  it("deletes events and memories together", async () => {
    store.permissions = {
      ...store.permissions,
      enabled: true,
      memories_enabled: true,
    };

    await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: "w-del",
          window_start: "2026-08-30T02:00:00.000Z",
          window_end: "2026-08-30T02:10:00.000Z",
          devices: ["desk"],
          dual_lane: false,
          event_count: 1,
          schema_version: "1",
        },
        events: [
          {
            id: "e-del",
            type: "shortcut",
            ts: "2026-08-30T02:01:00.000Z",
            device: "desk",
            app: "Terminal",
            shortcut: "Cmd+C",
          },
        ],
      }),
    });

    const del = await app.request("/v1/history/delete", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ scope: "all" }),
    });
    const delBody = await del.json();
    expect(delBody.deleted_windows).toBeGreaterThan(0);
    expect(delBody.deleted_memories).toBeGreaterThan(0);
    expect(store.windows.size).toBe(0);
    expect(store.memories.size).toBe(0);
  });

  it("sanitizes private browsing and keyText on upload", async () => {
    store.permissions = {
      ...store.permissions,
      enabled: true,
      memories_enabled: true,
    };

    const res = await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: "w-sanitize",
          window_start: "2026-08-30T03:00:00.000Z",
          window_end: "2026-08-30T03:10:00.000Z",
          devices: ["desk"],
          dual_lane: false,
          event_count: 2,
          schema_version: "1",
        },
        events: [
          {
            id: "private",
            type: "browser_navigation",
            ts: "2026-08-30T03:01:00.000Z",
            device: "desk",
            app: "Chrome",
            meta: { privateBrowsing: true },
          },
          {
            id: "keys",
            type: "typing_presence",
            ts: "2026-08-30T03:02:00.000Z",
            device: "desk",
            app: "Code",
            typing: { active: true },
            meta: { keyText: "secret" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted_events).toBe(1);
    const stored = store.windows.get("w-sanitize");
    expect(stored?.events).toHaveLength(1);
    expect(stored?.events[0]?.meta).toBeUndefined();
  });

  it("rejects windows whose capture time already exceeded 48h", async () => {
    store.permissions = {
      ...store.permissions,
      enabled: true,
      memories_enabled: true,
    };

    const res = await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: "w-old",
          window_start: "2020-01-01T00:00:00.000Z",
          window_end: "2020-01-01T00:10:00.000Z",
          devices: ["desk"],
          dual_lane: false,
          event_count: 0,
          schema_version: "1",
        },
        events: [],
      }),
    });
    expect(res.status).toBe(410);
  });
  it("seeds demo data and enables collection", async () => {
    const res = await app.request("/v1/demo/seed", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ enable: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windows).toBeGreaterThan(0);
    expect(body.permissions_enabled).toBe(true);
    expect(store.memories.size).toBeGreaterThan(0);
  });
});
