import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { store } from "./lib/store.js";
import { resetRateLimitBuckets } from "./middleware/rate-limit.js";
import { sixHourBucketUtc } from "./jobs/summarize.js";

const token = "dev-token";

function authHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/** Capture times relative to now so the 48h raw-event retention never expires fixtures. */
function recentWindow(windowId: string, opts: { minutesAgo?: number; durationMin?: number } = {}) {
  const durationMin = opts.durationMin ?? 10;
  const end = new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000);
  const start = new Date(end.getTime() - durationMin * 60_000);
  return {
    window_id: windowId,
    window_start: start.toISOString(),
    window_end: end.toISOString(),
    at: (offsetMin: number) =>
      new Date(start.getTime() + offsetMin * 60_000).toISOString(),
  };
}

function expiredWindow(windowId: string) {
  const end = new Date(Date.now() - 49 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 10 * 60_000);
  return {
    window_id: windowId,
    window_start: start.toISOString(),
    window_end: end.toISOString(),
  };
}

describe("ShiftLog API", () => {
  const app = createApp();
  const originalCron = process.env.CRON_SECRET;
  const originalLimit = process.env.SHIFTLOG_RATE_LIMIT_PER_MIN;

  beforeEach(() => {
    store.reset();
    process.env.SHIFTLOG_API_TOKEN = token;
    resetRateLimitBuckets();
  });

  afterEach(() => {
    if (originalCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCron;
    if (originalLimit === undefined) delete process.env.SHIFTLOG_RATE_LIMIT_PER_MIN;
    else process.env.SHIFTLOG_RATE_LIMIT_PER_MIN = originalLimit;
    resetRateLimitBuckets();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/v1/timeline");
    expect(res.status).toBe(401);
  });

  it("blocks window upload when default-off", async () => {
    const w = recentWindow("w1");
    const res = await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: w.window_id,
          window_start: w.window_start,
          window_end: w.window_end,
          devices: ["desk"],
          dual_lane: false,
          event_count: 1,
          schema_version: "1",
        },
        events: [
          {
            id: "e1",
            type: "click",
            ts: w.at(1),
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

    const w = recentWindow("w-desk-mobile");
    const upload = await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: w.window_id,
          window_start: w.window_start,
          window_end: w.window_end,
          devices: ["desk", "mobile"],
          dual_lane: true,
          event_count: 3,
          schema_version: "1",
        },
        events: [
          {
            id: "e1",
            type: "app_switch",
            ts: w.at(1),
            device: "desk",
            app: "Code",
            summary: "Editor focused",
          },
          {
            id: "e2",
            type: "typing_presence",
            ts: w.at(2),
            device: "desk",
            app: "Code",
            typing: { active: true, approxChars: 40 },
          },
          {
            id: "e3",
            type: "browser_navigation",
            ts: w.at(3),
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

    const w = recentWindow("w-del");
    await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: w.window_id,
          window_start: w.window_start,
          window_end: w.window_end,
          devices: ["desk"],
          dual_lane: false,
          event_count: 1,
          schema_version: "1",
        },
        events: [
          {
            id: "e-del",
            type: "shortcut",
            ts: w.at(1),
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

    const w = recentWindow("w-sanitize");
    const res = await app.request("/v1/windows", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        metadata: {
          window_id: w.window_id,
          window_start: w.window_start,
          window_end: w.window_end,
          devices: ["desk"],
          dual_lane: false,
          event_count: 2,
          schema_version: "1",
        },
        events: [
          {
            id: "private",
            type: "browser_navigation",
            ts: w.at(1),
            device: "desk",
            app: "Chrome",
            meta: { privateBrowsing: true },
          },
          {
            id: "keys",
            type: "typing_presence",
            ts: w.at(2),
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
          ...expiredWindow("w-old"),
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

  it("rejects oversize uploads", async () => {
    const res = await app.request("/v1/windows", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-length": "999999",
      },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });

  it("rate-limits a tenant after the per-minute budget", async () => {
    process.env.SHIFTLOG_RATE_LIMIT_PER_MIN = "2";
    resetRateLimitBuckets();
    const first = await app.request("/v1/permissions", { headers: authHeaders() });
    const second = await app.request("/v1/permissions", { headers: authHeaders() });
    const third = await app.request("/v1/permissions", { headers: authHeaders() });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });

  it("requires CRON_SECRET for retention purge", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    const denied = await app.request("/internal/cron/purge");
    expect(denied.status).toBe(401);
    const ok = await app.request("/internal/cron/purge", {
      headers: { authorization: "Bearer cron-test-secret" },
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
  });

  it("writes one six-hour memory per UTC bucket and overwrites that id", async () => {
    process.env.SHIFTLOG_RATE_LIMIT_PER_MIN = "200";
    resetRateLimitBuckets();
    store.permissions = {
      ...store.permissions,
      enabled: true,
      memories_enabled: true,
    };

    async function postWindow(windowId: string, startIso: string) {
      const start = new Date(startIso);
      const end = new Date(start.getTime() + 10 * 60_000);
      const res = await app.request("/v1/windows", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          metadata: {
            window_id: windowId,
            window_start: start.toISOString(),
            window_end: end.toISOString(),
            devices: ["desk"],
            dual_lane: false,
            event_count: 1,
            schema_version: "1",
          },
          events: [
            {
              id: `${windowId}-e`,
              type: "app_switch",
              ts: start.toISOString(),
              device: "desk",
              app: "Code",
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
    }

    const current = sixHourBucketUtc(new Date().toISOString());
    const bucketMs = 6 * 60 * 60 * 1000;
    const starts = [0, 1, 2, 3].map((i) =>
      new Date(new Date(current.start).getTime() - i * bucketMs + 10 * 60_000).toISOString(),
    );

    for (let i = 0; i < 7; i++) {
      const start = new Date(new Date(current.start).getTime() + (10 + i * 10) * 60_000);
      await postWindow(`w-new-${i}`, start.toISOString());
    }
    await postWindow("w-b1", starts[1]!);
    await postWindow("w-b2", starts[2]!);
    await postWindow("w-b3", starts[3]!);

    const sixHour = [...store.memories.values()].filter(
      (m) => m.front_matter.kind === "six_hour",
    );
    expect(sixHour).toHaveLength(4);

    const newestId = sixHour.find((m) =>
      m.front_matter.window_ids.includes("w-new-0"),
    )?.id;
    expect(newestId).toMatch(/^mem_6h_/);
    const newestRecord = store.getMemory(newestId!);
    expect(newestRecord?.front_matter.window_ids).toHaveLength(7);
    expect(
      sixHour.filter((m) => m.id === newestId),
    ).toHaveLength(1);

    const created = newestRecord!.created_at;
    await postWindow(
      "w-new-extra",
      new Date(new Date(current.start).getTime() + 90 * 60_000).toISOString(),
    );
    const after = store.getMemory(newestId!);
    expect(after?.created_at).toBe(created);
    expect(after?.front_matter.window_ids).toHaveLength(8);
    expect(
      [...store.memories.values()].filter((m) => m.front_matter.kind === "six_hour"),
    ).toHaveLength(4);

    const filtered = await app.request("/v1/timeline?kind=six_hour&limit=20", {
      headers: authHeaders(),
    });
    const filteredBody = await filtered.json();
    expect(filteredBody.items).toHaveLength(4);
    expect(
      filteredBody.items.every((m: { front_matter: { kind: string } }) => m.front_matter.kind === "six_hour"),
    ).toBe(true);

    const tens = await app.request("/v1/timeline?kind=ten_minute&limit=20", {
      headers: authHeaders(),
    });
    const tensBody = await tens.json();
    expect(
      tensBody.items.every((m: { front_matter: { kind: string } }) => m.front_matter.kind === "ten_minute"),
    ).toBe(true);
    expect(tensBody.items.length).toBeGreaterThan(0);
  });
});
