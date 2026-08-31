import { describe, expect, it } from "vitest";
import type { WindowUpload } from "@shift-log/schema";
import { sanitizeWindowUpload } from "./sanitize.js";

describe("sanitizeWindowUpload", () => {
  it("drops private-browsing events and strips keyText", () => {
    const upload: WindowUpload = {
      metadata: {
        window_id: "w1",
        window_start: "2026-08-30T01:00:00.000Z",
        window_end: "2026-08-30T01:10:00.000Z",
        devices: ["desk"],
        dual_lane: false,
        event_count: 3,
        paused: false,
        schema_version: "1",
      },
      events: [
        {
          id: "ok",
          type: "click",
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk",
          app: "Code",
        },
        {
          id: "private",
          type: "browser_navigation",
          ts: "2026-08-30T01:02:00.000Z",
          device: "desk",
          app: "Chrome",
          site: "secret.example",
          meta: { privateBrowsing: true },
        },
        {
          id: "keys",
          type: "typing_presence",
          ts: "2026-08-30T01:03:00.000Z",
          device: "desk",
          app: "Code",
          typing: { active: true, approxChars: 12 },
          meta: { keyText: "password123", source: "field" },
        },
      ],
    };

    const sanitized = sanitizeWindowUpload(upload);
    expect(sanitized.events).toHaveLength(2);
    expect(sanitized.events.map((e) => e.id)).toEqual(["ok", "keys"]);
    expect(sanitized.events[1]?.meta).toEqual({ source: "field" });
    expect(sanitized.events[1]?.meta).not.toHaveProperty("keyText");
    expect(sanitized.metadata.event_count).toBe(2);
  });
});
