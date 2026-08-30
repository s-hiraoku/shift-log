import { describe, expect, it } from "vitest";
import { PermissionsConfigSchema } from "@shift-log/schema";
import { DesktopCollector } from "./collector.js";

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
});
