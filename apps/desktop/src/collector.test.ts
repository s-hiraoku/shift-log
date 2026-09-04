import { describe, expect, it } from "vitest";
import { PermissionsConfigSchema } from "@shift-log/schema";
import { DesktopCollector, emitOsTick } from "./collector.js";

describe("DesktopCollector", () => {
  it("does not collect when default-off", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({}),
      "http://localhost:8787",
      "dev-token",
    );
    collector.observe({
      id: "1",
      type: "click",
      ts: new Date().toISOString(),
      app: "Code",
    });
    const window = collector.drainWindow(new Date());
    expect(window.events).toHaveLength(0);
  });

  it("drops private browsing and strips keyText", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
      }),
      "http://localhost:8787",
      "dev-token",
    );
    collector.observe({
      id: "p",
      type: "browser_navigation",
      ts: new Date().toISOString(),
      app: "Safari",
      site: "secret.example",
      meta: { privateBrowsing: true },
    });
    collector.observe({
      id: "t",
      type: "typing_presence",
      ts: new Date().toISOString(),
      app: "Code",
      typing: { active: true, approxChars: 3 },
      meta: { keyText: "password", other: true },
    });
    const window = collector.drainWindow(new Date());
    expect(window.events).toHaveLength(1);
    expect(window.events[0]?.meta?.keyText).toBeUndefined();
    expect(window.events[0]?.meta?.other).toBe(true);
  });

  it("respects pause from menu bar", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
      }),
      "http://localhost:8787",
      "dev-token",
    );
    collector.pause();
    collector.observe({
      id: "x",
      type: "click",
      ts: new Date().toISOString(),
      app: "Code",
    });
    const window = collector.drainWindow(new Date());
    expect(window.events.every((e) => e.type === "pause")).toBe(true);
  });

  it("emits app_switch and front_window_summary from an OS observation", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
      }),
      "http://localhost:8787",
      "dev-token",
    );
    emitOsTick(collector, { app: "Cursor", title: "shift-log" }, null);
    emitOsTick(
      collector,
      { app: "Google Chrome", title: "github.com — Pull request", site: "github.com" },
      { app: "Cursor", title: "shift-log" },
    );
    const window = collector.drainWindow(new Date());
    expect(window.events.map((e) => e.type)).toEqual([
      "app_switch",
      "front_window_summary",
      "app_switch",
      "browser_navigation",
    ]);
    expect(window.events.some((e) => e.type === "typing_presence")).toBe(false);
  });
});
