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

  it("records Slack dwell without title when title_policy is app_only", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
        title_policy: { Slack: "app_only" },
      }),
      "http://localhost:8787",
      "dev-token",
    );
    collector.observe({
      id: "slack-channel",
      type: "front_window_summary",
      ts: "2026-09-13T01:00:00.000Z",
      app: "Slack",
      site: "app.slack.com",
      summary: "team_frontend-pr-n10n（チャンネル）",
      meta: { channel: "team_frontend-pr-n10n" },
    });
    collector.observe({
      id: "code-full",
      type: "front_window_summary",
      ts: "2026-09-13T01:01:00.000Z",
      app: "Code",
      summary: "collector.ts",
    });
    const window = collector.drainWindow(new Date("2026-09-13T01:00:00.000Z"));
    expect(window.events).toEqual([
      {
        id: "slack-channel",
        type: "front_window_summary",
        ts: "2026-09-13T01:00:00.000Z",
        device: "desk",
        app: "Slack",
      },
      {
        id: "code-full",
        type: "front_window_summary",
        ts: "2026-09-13T01:01:00.000Z",
        device: "desk",
        app: "Code",
        summary: "collector.ts",
      },
    ]);
    expect(JSON.stringify(window.events)).not.toContain("team_frontend-pr-n10n");
  });

  it("still drops excluded Slack even when title_policy is app_only", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
        apps: { mode: "exclude_listed", exclude: ["Slack"], include_only: [] },
        title_policy: { Slack: "app_only" },
      }),
      "http://localhost:8787",
      "dev-token",
    );
    collector.observe({
      id: "slack-excluded",
      type: "front_window_summary",
      ts: "2026-09-13T01:00:00.000Z",
      app: "Slack",
      summary: "team_frontend-pr-n10n（チャンネル）",
    });
    const window = collector.drainWindow(new Date("2026-09-13T01:00:00.000Z"));
    expect(window.events).toEqual([]);
  });

  it("strips Slack titles from OS ticks when title_policy is app_only", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
        title_policy: { slack: "app_only" },
      }),
      "http://localhost:8787",
      "dev-token",
    );
    emitOsTick(
      collector,
      { app: "Slack", title: "alice（DM）" },
      null,
    );
    const window = collector.drainWindow(new Date());
    expect(window.events.map((e) => e.app)).toEqual(["Slack", "Slack"]);
    expect(window.events.every((e) => e.summary === undefined)).toBe(true);
    expect(JSON.stringify(window.events)).not.toContain("alice");
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

  it("copies urlPath onto browser_navigation only", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
      }),
      "http://localhost:8787",
      "dev-token",
    );
    emitOsTick(
      collector,
      {
        app: "Google Chrome",
        title: "shift-log/pull/98",
        site: "github.com",
        urlPath: "/s-hiraoku/shift-log/pull/98",
      },
      null,
    );
    const window = collector.drainWindow(new Date());
    const nav = window.events.find((event) => event.type === "browser_navigation");
    const appSwitch = window.events.find((event) => event.type === "app_switch");
    expect(nav?.urlPath).toBe("/s-hiraoku/shift-log/pull/98");
    expect(appSwitch).toMatchObject({ type: "app_switch", app: "Google Chrome" });
    expect(appSwitch).not.toHaveProperty("urlPath");
  });

  it("drops navigation urlPath, summary, and site when title_policy is app_only", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
        title_policy: { "Google Chrome": "app_only" },
      }),
      "http://localhost:8787",
      "dev-token",
    );
    emitOsTick(
      collector,
      {
        app: "Google Chrome",
        title: "shift-log/pull/98",
        site: "github.com",
        urlPath: "/s-hiraoku/shift-log/pull/98",
      },
      null,
    );
    const nav = collector.drainWindow(new Date()).events.find((event) => event.type === "browser_navigation");
    expect(nav).toEqual({
      id: expect.any(String),
      ts: expect.any(String),
      type: "browser_navigation",
      device: "desk",
      app: "Google Chrome",
    });
  });

  it("drops the navigation event when the site is excluded", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
        sites: { mode: "exclude_listed", exclude: ["github.com"], include_only: [] },
      }),
      "http://localhost:8787",
      "dev-token",
    );
    emitOsTick(collector, { app: "Cursor", title: "shift-log" }, null);
    emitOsTick(
      collector,
      {
        app: "Google Chrome",
        title: "shift-log/pull/98",
        site: "github.com",
        urlPath: "/s-hiraoku/shift-log/pull/98",
      },
      { app: "Cursor", title: "shift-log" },
    );
    const window = collector.drainWindow(new Date());
    expect(window.events.map((event) => event.type)).toEqual(["app_switch", "front_window_summary"]);
    expect(window.events.map((event) => event.app)).toEqual(["Cursor", "Cursor"]);
    expect(window.events.some((event) => event.type === "browser_navigation")).toBe(false);
    expect(JSON.stringify(window.events)).not.toContain("/s-hiraoku/shift-log/pull/98");
  });

  it("copies interpreted editor and terminal title meta onto events", () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
      }),
      "http://localhost:8787",
      "dev-token",
    );
    emitOsTick(collector, { app: "Cursor", title: "shift-log — collector.ts" }, null);
    emitOsTick(
      collector,
      { app: "ghostty", title: "~/src/shift-log (main)" },
      { app: "Cursor", title: "shift-log — collector.ts" },
    );
    const window = collector.drainWindow(new Date());
    const cursor = window.events.find((e) => e.app === "Cursor");
    const ghostty = window.events.find((e) => e.app === "ghostty" && e.type === "front_window_summary");
    expect(cursor?.meta).toEqual({ project: "shift-log", file: "collector.ts" });
    expect(ghostty?.meta).toEqual({ cwd: "~/src/shift-log", branch: "main" });
  });

  it("keeps buffered events when upload rejects", async () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
      }),
      "http://127.0.0.1:1",
      "dev-token",
    );
    collector.observe({
      id: "keep-me",
      type: "app_switch",
      ts: "2026-09-12T00:00:00.000Z",
      app: "Code",
    });
    collector.upload = async () => {
      throw new Error("ECONNREFUSED");
    };

    const first = await collector.flushWindow(new Date("2026-09-12T00:00:00.000Z"));
    expect(first).toEqual({
      uploaded: false,
      retained: 1,
      windowId: "desk_2026-09-12T00:00:00.000Z",
    });
    expect(collector.pendingEventCount()).toBe(1);
    expect(collector.lastUploadError()).toBe("ECONNREFUSED");

    const retry = collector.drainWindow(new Date("2026-09-12T00:00:00.000Z"));
    expect(retry.events.map((e) => e.id)).toEqual(["keep-me"]);
  });

  it("keeps buffered events when upload returns HTTP 503", async () => {
    const collector = new DesktopCollector(
      PermissionsConfigSchema.parse({
        enabled: true,
        memories_enabled: true,
      }),
      "http://127.0.0.1:1",
      "dev-token",
    );
    collector.observe({
      id: "keep-503",
      type: "front_window_summary",
      ts: "2026-09-12T00:10:00.000Z",
      app: "Chrome",
    });
    collector.upload = async () => new Response("api down", { status: 503 });

    const first = await collector.flushWindow(new Date("2026-09-12T00:10:00.000Z"));
    expect(first.uploaded).toBe(false);
    expect(first.status).toBe(503);
    expect(first.retained).toBe(1);
    expect(collector.lastUploadError()).toBe("upload 503");

    collector.upload = async () => new Response("ok", { status: 200 });
    const second = await collector.flushWindow(new Date("2026-09-12T00:10:00.000Z"));
    expect(second).toEqual({
      uploaded: true,
      status: 200,
      retained: 0,
      windowId: "desk_2026-09-12T00:10:00.000Z",
    });
    expect(collector.pendingEventCount()).toBe(0);
    expect(collector.lastUploadError()).toBeUndefined();
  });
});
