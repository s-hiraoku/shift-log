import { describe, expect, it } from "vitest";
import type { WindowUpload } from "@shift-log/schema";
import { MemoryStore } from "./store.js";

describe("MemoryStore retention", () => {
  it("purges raw windows older than 48 hours but keeps memories", () => {
    const store = new MemoryStore();
    const oldUpload: WindowUpload = {
      metadata: {
        window_id: "old",
        window_start: "2026-08-20T01:00:00.000Z",
        window_end: "2026-08-20T01:10:00.000Z",
        devices: ["desk"],
        dual_lane: false,
        event_count: 0,
        paused: false,
        schema_version: "1",
      },
      events: [],
    };
    store.putWindow(oldUpload);
    const stored = store.windows.get("old")!;
    stored.uploaded_at = "2026-08-20T01:10:00.000Z";

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
        window_ids: ["old"],
        skill_candidate: false,
      },
      body: "still here",
    });

    const removed = store.purgeExpiredRawEvents(new Date("2026-08-30T01:00:00.000Z"));
    expect(removed).toBe(1);
    expect(store.windows.size).toBe(0);
    expect(store.memories.size).toBe(1);
  });
});
