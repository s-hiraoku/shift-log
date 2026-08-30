import { describe, expect, it } from "vitest";
import { PermissionsConfigSchema } from "@shift-log/schema";
import { MobileCollector } from "./collector.js";

describe("MobileCollector", () => {
  it("rejects full keylog style typing events", () => {
    const collector = new MobileCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
      }),
      "http://localhost:8787",
      "dev-token",
    );
    collector.observe({
      id: "bad",
      type: "typing_presence",
      ts: new Date().toISOString(),
      app: "Notes",
      typing: { active: true },
    });
    const window = collector.drainWindow(new Date());
    expect(window.events).toHaveLength(0);
  });

  it("merges desk and mobile into dual lanes", () => {
    const perms = PermissionsConfigSchema.parse({
      enabled: true,
      memories_enabled: true,
    });
    const mobile = new MobileCollector(perms, "", "");
    mobile.observe({
      id: "m1",
      type: "screen_enter",
      ts: "2026-08-30T01:00:00.000Z",
      app: "Safari",
    });
    const mobileWindow = mobile.drainWindow(new Date("2026-08-30T01:00:00.000Z"));
    const deskWindow = {
      metadata: {
        window_id: "desk",
        window_start: "2026-08-30T01:00:00.000Z",
        window_end: "2026-08-30T01:10:00.000Z",
        devices: ["desk" as const],
        dual_lane: false,
        event_count: 1,
        paused: false,
        schema_version: "1" as const,
      },
      events: [
        {
          id: "d1",
          type: "click" as const,
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk" as const,
          app: "Code",
        },
      ],
    };
    const merged = MobileCollector.mergeDualLane(deskWindow, mobileWindow);
    expect(merged.metadata.dual_lane).toBe(true);
    expect(merged.metadata.devices).toEqual(["desk", "mobile"]);
    expect(merged.events).toHaveLength(2);
  });
});
