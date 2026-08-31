import { describe, expect, it } from "vitest";
import type { WindowUpload } from "@shift-log/schema";
import { isRawWindowExpired, MemoryStore } from "./store.js";

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
    a.putMemory({
      id: "persist-1",
      created_at: "2026-08-30T01:10:00.000Z",
      updated_at: "2026-08-30T01:10:00.000Z",
      front_matter: {
        title: "persisted",
        description: "from disk",
        apps: ["Code"],
        device: "desk",
        window_start: "2026-08-30T01:00:00.000Z",
        window_end: "2026-08-30T01:10:00.000Z",
        kind: "ten_minute",
        window_ids: ["w1"],
        skill_candidate: false,
      },
      body: "hello",
    });
    const b = new MemoryStore();
    expect(b.permissions.enabled).toBe(true);
    expect(b.memories.has("persist-1")).toBe(true);
    process.env.VITEST = "1";
    delete process.env.SHIFTLOG_DATA_DIR;
  });
});
