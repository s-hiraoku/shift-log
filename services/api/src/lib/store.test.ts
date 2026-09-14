import { afterEach, describe, expect, it } from "vitest";
import type { WindowUpload } from "@shift-log/schema";
import {
  isRawWindowExpired,
  isTenMinuteMemoryExpired,
  MemoryStore,
  purgeAllTenants,
  storeFor,
} from "./store.js";

function baseUpload(
  overrides: Partial<WindowUpload["metadata"]> & { window_id: string },
): WindowUpload {
  return {
    metadata: {
      window_id: overrides.window_id,
      window_start: overrides.window_start ?? "2026-08-20T01:00:00.000Z",
      window_end: overrides.window_end ?? "2026-08-20T01:10:00.000Z",
      devices: ["desk"],
      dual_lane: false,
      event_count: 0,
      paused: false,
      schema_version: "1",
    },
    events: [],
  };
}

describe("MemoryStore retention", () => {
  it("purges raw windows by capture window_end, not uploaded_at", () => {
    const store = new MemoryStore();
    const staleCapture = baseUpload({
      window_id: "stale-capture",
      window_start: "2026-08-20T01:00:00.000Z",
      window_end: "2026-08-20T01:10:00.000Z",
    });
    // Offline retry: uploaded recently, but captured >48h ago
    const stored = store.putWindow(staleCapture, new Date("2026-08-30T00:50:00.000Z"));
    expect(stored).toBeNull();

    const fresh = baseUpload({
      window_id: "fresh",
      window_start: "2026-08-29T12:00:00.000Z",
      window_end: "2026-08-29T12:10:00.000Z",
    });
    expect(store.putWindow(fresh, new Date("2026-08-30T01:00:00.000Z"))).not.toBeNull();

    // Simulate a window that was stored then aged past retention by capture time
    store.windows.set("aged", {
      metadata: {
        window_id: "aged",
        window_start: "2026-08-20T01:00:00.000Z",
        window_end: "2026-08-20T01:10:00.000Z",
        devices: ["desk"],
        dual_lane: false,
        event_count: 0,
        paused: false,
        schema_version: "1",
      },
      events: [],
      uploaded_at: "2026-08-30T00:50:00.000Z", // recent upload must not extend retention
    });

    store.putMemory({
      id: "keep",
      created_at: "2026-08-20T01:10:00.000Z",
      updated_at: "2026-08-20T01:10:00.000Z",
      front_matter: {
        title: "kept",
        description: "memory remains",
        apps: [],
        device: "desk",
        window_start: "2026-08-20T01:00:00.000Z",
        window_end: "2026-08-20T01:10:00.000Z",
        kind: "ten_minute",
        window_ids: ["aged"],
        skill_candidate: false,
      },
      body: "still here",
    });

    const removed = store.purgeExpiredRawEvents(new Date("2026-08-30T01:00:00.000Z"));
    expect(removed).toBe(1);
    expect(store.windows.has("aged")).toBe(false);
    expect(store.windows.has("fresh")).toBe(true);
    expect(store.memories.size).toBe(1);
  });

  it("treats window_end older than 48h as expired", () => {
    expect(
      isRawWindowExpired(
        { window_end: "2026-08-20T01:10:00.000Z" },
        new Date("2026-08-30T01:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isRawWindowExpired(
        { window_end: "2026-08-29T12:00:00.000Z" },
        new Date("2026-08-30T01:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("sweeps ten-minute memories older than 14 days and keeps six-hour rows", () => {
    const store = new MemoryStore();
    const now = new Date("2026-09-15T00:00:00.000Z");
    store.putMemory({
      id: "old-10m",
      created_at: "2026-08-20T01:10:00.000Z",
      updated_at: "2026-08-20T01:10:00.000Z",
      front_matter: {
        title: "old ten",
        description: "should go",
        apps: ["ghostty"],
        device: "desk",
        window_start: "2026-08-20T01:00:00.000Z",
        window_end: "2026-08-20T01:10:00.000Z",
        kind: "ten_minute",
        window_ids: ["w-old"],
        skill_candidate: false,
      },
      body: "drop",
    });
    store.putMemory({
      id: "fresh-10m",
      created_at: "2026-09-14T12:10:00.000Z",
      updated_at: "2026-09-14T12:10:00.000Z",
      front_matter: {
        title: "fresh ten",
        description: "keep",
        apps: ["Code"],
        device: "desk",
        window_start: "2026-09-14T12:00:00.000Z",
        window_end: "2026-09-14T12:10:00.000Z",
        kind: "ten_minute",
        window_ids: ["w-fresh"],
        skill_candidate: false,
      },
      body: "keep",
    });
    store.putMemory({
      id: "old-6h",
      created_at: "2026-08-20T06:00:00.000Z",
      updated_at: "2026-08-20T06:00:00.000Z",
      front_matter: {
        title: "old six",
        description: "keep",
        apps: ["ghostty"],
        device: "desk",
        window_start: "2026-08-20T00:00:00.000Z",
        window_end: "2026-08-20T06:00:00.000Z",
        kind: "six_hour",
        window_ids: ["w-old"],
        skill_candidate: false,
      },
      body: "keep",
    });

    expect(
      isTenMinuteMemoryExpired(store.getMemory("old-10m")!, now),
    ).toBe(true);
    expect(
      isTenMinuteMemoryExpired(store.getMemory("old-6h")!, now),
    ).toBe(false);

    const removed = store.purgeExpiredTenMinuteMemories(now);
    expect(removed).toBe(1);
    expect(store.memories.has("old-10m")).toBe(false);
    expect(store.memories.has("fresh-10m")).toBe(true);
    expect(store.memories.has("old-6h")).toBe(true);
  });

  it("honors SHIFTLOG_TEN_MINUTE_RETENTION_DAYS on the hourly sweep", () => {
    const previous = process.env.SHIFTLOG_TEN_MINUTE_RETENTION_DAYS;
    process.env.SHIFTLOG_TEN_MINUTE_RETENTION_DAYS = "1";
    const store = storeFor("retention-1d");
    store.putMemory({
      id: "two-days-old",
      created_at: "2026-09-13T00:10:00.000Z",
      updated_at: "2026-09-13T00:10:00.000Z",
      front_matter: {
        title: "two days",
        description: "gone at 1 day retention",
        apps: [],
        device: "desk",
        window_start: "2026-09-13T00:00:00.000Z",
        window_end: "2026-09-13T00:10:00.000Z",
        kind: "ten_minute",
        window_ids: ["w-2d"],
        skill_candidate: false,
      },
      body: "drop",
    });
    const removed = purgeAllTenants(new Date("2026-09-15T00:00:00.000Z"));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(store.memories.has("two-days-old")).toBe(false);
    if (previous === undefined) delete process.env.SHIFTLOG_TEN_MINUTE_RETENTION_DAYS;
    else process.env.SHIFTLOG_TEN_MINUTE_RETENTION_DAYS = previous;
  });
});

describe("MemoryStore deleteByScope overlap", () => {
  it("deletes memories whose window overlaps the cutoff, not only those that start after it", () => {
    const store = new MemoryStore();
    const now = new Date("2026-08-30T12:00:00.000Z");

    store.putMemory({
      id: "six-hour-overlap",
      created_at: "2026-08-30T06:00:00.000Z",
      updated_at: "2026-08-30T12:00:00.000Z",
      front_matter: {
        title: "spans last hour",
        description: "started 6h ago, ends now",
        apps: ["Code"],
        device: "desk",
        window_start: "2026-08-30T06:00:00.000Z",
        window_end: "2026-08-30T12:00:00.000Z",
        kind: "six_hour",
        window_ids: [],
        skill_candidate: false,
      },
      body: "should be deleted when clearing last hour",
    });

    store.putMemory({
      id: "older-six-hour",
      created_at: "2026-08-30T04:00:00.000Z",
      updated_at: "2026-08-30T10:00:00.000Z",
      front_matter: {
        title: "ends before cutoff",
        description: "fully outside last hour",
        apps: [],
        device: "desk",
        window_start: "2026-08-30T04:00:00.000Z",
        window_end: "2026-08-30T10:00:00.000Z",
        kind: "six_hour",
        window_ids: [],
        skill_candidate: false,
      },
      body: "keep",
    });

    store.windows.set("cross-cutoff", {
      metadata: {
        window_id: "cross-cutoff",
        window_start: "2026-08-30T10:55:00.000Z",
        window_end: "2026-08-30T11:05:00.000Z",
        devices: ["desk"],
        dual_lane: false,
        event_count: 0,
        paused: false,
        schema_version: "1",
      },
      events: [],
      uploaded_at: "2026-08-30T11:05:00.000Z",
    });

    const result = store.deleteByScope("last_hour", now);
    expect(result.deleted_memories).toBe(1);
    expect(result.deleted_windows).toBe(1);
    expect(store.memories.has("six-hour-overlap")).toBe(false);
    expect(store.memories.has("older-six-hour")).toBe(true);
    expect(store.windows.has("cross-cutoff")).toBe(false);
  });
});


describe("MemoryStore persistence", () => {
  afterEach(async () => {
    process.env.VITEST = "1";
    delete process.env.SHIFTLOG_DATA_DIR;
    const { resetPersistCache } = await import("./persist.js");
    resetPersistCache();
  });

  it("round-trips permissions and memories when SHIFTLOG_DATA_DIR is set", async () => {
    const dir = await import("node:fs/promises").then(async (fs) => {
      const os = await import("node:os");
      const path = await import("node:path");
      const d = await fs.mkdtemp(path.join(os.tmpdir(), "shiftlog-"));
      return d;
    });
    process.env.SHIFTLOG_DATA_DIR = dir;
    delete process.env.VITEST;
    const { MemoryStore } = await import("./store.js");
    const a = new MemoryStore();
    a.setPermissions({
      ...a.permissions,
      enabled: true,
      memories_enabled: true,
    });
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 10 * 60_000);
    a.putMemory({
      id: "persist-1",
      created_at: windowEnd.toISOString(),
      updated_at: windowEnd.toISOString(),
      front_matter: {
        title: "persisted",
        description: "from disk",
        apps: ["Code"],
        device: "desk",
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        kind: "ten_minute",
        window_ids: ["w1"],
        skill_candidate: false,
      },
      body: "hello",
    });
    const b = new MemoryStore();
    expect(b.permissions.enabled).toBe(true);
    expect(b.memories.has("persist-1")).toBe(true);
  });
});

describe("MemoryStore listMemories window range", () => {
  it("selects a bucket before applying limit, so newer rows do not hide it", () => {
    const store = new MemoryStore();
    const put = (id: string, start: string) => {
      store.putMemory({
        id,
        created_at: start,
        updated_at: start,
        front_matter: {
          title: id,
          description: id,
          apps: ["Code"],
          device: "desk",
          window_start: start,
          window_end: new Date(new Date(start).getTime() + 10 * 60_000).toISOString(),
          kind: "ten_minute",
          window_ids: [id],
          skill_candidate: false,
        },
        body: id,
      });
    };
    put("old-bucket", "2026-09-11T00:10:00.000Z");
    put("new-1", "2026-09-12T12:10:00.000Z");
    put("new-2", "2026-09-12T12:20:00.000Z");
    put("new-3", "2026-09-12T12:30:00.000Z");

    const newest = store.listMemories({ limit: 2, kind: "ten_minute" });
    expect(newest.map((m) => m.id)).toEqual(["new-3", "new-2"]);

    const bucket = store.listMemories({
      limit: 2,
      kind: "ten_minute",
      windowStartGte: "2026-09-11T00:00:00.000Z",
      windowStartLt: "2026-09-11T06:00:00.000Z",
    });
    expect(bucket.map((m) => m.id)).toEqual(["old-bucket"]);
  });

  it("matches entity values and keeps window_start inside since/until", () => {
    const store = new MemoryStore();
    store.putMemory({
      id: "pony",
      created_at: "2026-09-10T08:10:00.000Z",
      updated_at: "2026-09-10T08:10:00.000Z",
      front_matter: {
        title: "Ghostty / Slack",
        description: "PR review",
        apps: ["ghostty", "Slack"],
        device: "desk",
        window_start: "2026-09-10T08:00:00.000Z",
        window_end: "2026-09-10T08:10:00.000Z",
        kind: "ten_minute",
        window_ids: ["pony"],
        skill_candidate: false,
        entities: [{ kind: "github_repo", value: "DietrichGebert/ponytail" }],
      },
      body: "reviewed a PR",
    });
    store.putMemory({
      id: "recent",
      created_at: "2026-09-12T12:10:00.000Z",
      updated_at: "2026-09-12T12:10:00.000Z",
      front_matter: {
        title: "Code",
        description: "editor",
        apps: ["Code"],
        device: "desk",
        window_start: "2026-09-12T12:00:00.000Z",
        window_end: "2026-09-12T12:10:00.000Z",
        kind: "ten_minute",
        window_ids: ["recent"],
        skill_candidate: false,
      },
      body: "unrelated",
    });

    expect(store.listMemories({ q: "ponytail", limit: 10 }).map((m) => m.id)).toEqual(["pony"]);
    expect(
      store
        .listMemories({
          q: "ponytail",
          limit: 10,
          since: "2026-09-12T00:00:00.000Z",
          until: "2026-09-12T23:59:59.000Z",
        })
        .map((m) => m.id),
    ).toEqual([]);
    expect(
      store
        .listMemories({
          limit: 10,
          since: "2026-09-12T00:00:00.000Z",
          until: "2026-09-12T23:59:59.000Z",
        })
        .map((m) => m.id),
    ).toEqual(["recent"]);
  });
});
