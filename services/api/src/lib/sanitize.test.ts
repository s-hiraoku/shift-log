import { describe, expect, it } from "vitest";
import { PermissionsConfigSchema, type WindowUpload } from "@shift-log/schema";
import { sanitizeWindowUpload } from "./sanitize.js";

const sampleMeta = {
  window_id: "w1",
  window_start: "2026-08-30T01:00:00.000Z",
  window_end: "2026-08-30T01:10:00.000Z",
  devices: ["desk"] as const,
  dual_lane: false,
  event_count: 3,
  paused: false,
  schema_version: "1",
};

describe("sanitizeWindowUpload", () => {
  it("drops private-browsing events and strips keyText", () => {
    const upload: WindowUpload = {
      metadata: sampleMeta,
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
          urlPath: "https://secret.example/docs?token=secret#section",
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

  it("drops title, site, and meta for apps with title_policy app_only", () => {
    const upload: WindowUpload = {
      metadata: { ...sampleMeta, window_id: "w-app-only", event_count: 2 },
      events: [
        {
          id: "slack-channel",
          type: "front_window_summary",
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk",
          app: "Slack",
          site: "app.slack.com",
          summary: "team_frontend-pr-n10n（チャンネル）",
          meta: { channel: "team_frontend-pr-n10n" },
        },
        {
          id: "code-full",
          type: "front_window_summary",
          ts: "2026-08-30T01:02:00.000Z",
          device: "desk",
          app: "Code",
          summary: "collector.ts",
        },
      ],
    };

    const sanitized = sanitizeWindowUpload(
      upload,
      PermissionsConfigSchema.parse({ title_policy: { Slack: "app_only" } }),
    );
    expect(sanitized.events).toEqual([
      {
        id: "slack-channel",
        type: "front_window_summary",
        ts: "2026-08-30T01:01:00.000Z",
        device: "desk",
        app: "Slack",
      },
      {
        id: "code-full",
        type: "front_window_summary",
        ts: "2026-08-30T01:02:00.000Z",
        device: "desk",
        app: "Code",
        summary: "collector.ts",
      },
    ]);
    expect(JSON.stringify(sanitized.events)).not.toContain("team_frontend-pr-n10n");
  });

  it("stores the pathname from an absolute urlPath and keeps it on a second pass", () => {
    const upload: WindowUpload = {
      metadata: { ...sampleMeta, window_id: "w-path", event_count: 1 },
      events: [
        {
          id: "nav",
          type: "browser_navigation",
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk",
          app: "Safari",
          site: "learn.chatgpt.com",
          urlPath: "https://learn.chatgpt.com/docs?token=secret#section",
        },
      ],
    };
    const once = sanitizeWindowUpload(upload);
    expect(once.events).toEqual([
      {
        id: "nav",
        type: "browser_navigation",
        ts: "2026-08-30T01:01:00.000Z",
        device: "desk",
        app: "Safari",
        site: "learn.chatgpt.com",
        urlPath: "/docs",
      },
    ]);
    expect(upload.events[0]?.urlPath).toBe("https://learn.chatgpt.com/docs?token=secret#section");
    const twice = sanitizeWindowUpload(once);
    expect(twice.events[0]?.urlPath).toBe("/docs");
  });

  it("drops urlPath when privacy mode was not classified", () => {
    const upload: WindowUpload = {
      metadata: { ...sampleMeta, window_id: "w-unknown", event_count: 1 },
      events: [
        {
          id: "nav",
          type: "browser_navigation",
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk",
          app: "Safari",
          site: "github.com",
          summary: "Permissions",
          urlPath: "/settings/permissions",
          meta: { privateBrowsingUnknown: true },
        },
      ],
    };
    const sanitized = sanitizeWindowUpload(upload);
    expect(sanitized.events).toEqual([
      {
        id: "nav",
        type: "browser_navigation",
        ts: "2026-08-30T01:01:00.000Z",
        device: "desk",
        app: "Safari",
        site: "github.com",
        summary: "Permissions",
        meta: { privateBrowsingUnknown: true },
      },
    ]);
    expect(JSON.stringify(sanitized.events)).not.toContain("/settings/permissions");
  });

  it("drops urlPath when title_policy is app_only", () => {
    const upload: WindowUpload = {
      metadata: { ...sampleMeta, window_id: "w-path-app-only", event_count: 1 },
      events: [
        {
          id: "nav",
          type: "browser_navigation",
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk",
          app: "Safari",
          site: "learn.chatgpt.com",
          summary: "Docs",
          urlPath: "https://learn.chatgpt.com/docs?token=secret#section",
        },
      ],
    };
    const sanitized = sanitizeWindowUpload(
      upload,
      PermissionsConfigSchema.parse({ title_policy: { Safari: "app_only" } }),
    );
    expect(sanitized.events).toEqual([
      {
        id: "nav",
        type: "browser_navigation",
        ts: "2026-08-30T01:01:00.000Z",
        device: "desk",
        app: "Safari",
      },
    ]);
  });

  it("keeps an excluded site and removes urlPath", () => {
    const upload: WindowUpload = {
      metadata: { ...sampleMeta, window_id: "w-excluded-site", event_count: 1 },
      events: [
        {
          id: "nav",
          type: "browser_navigation",
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk",
          app: "Safari",
          site: "learn.chatgpt.com",
          summary: "Docs",
          urlPath: "https://learn.chatgpt.com/docs?token=secret#section",
        },
      ],
    };
    const sanitized = sanitizeWindowUpload(
      upload,
      PermissionsConfigSchema.parse({
        sites: { mode: "exclude_listed", exclude: ["learn.chatgpt.com"], include_only: [] },
      }),
    );
    expect(sanitized.events).toEqual([
      {
        id: "nav",
        type: "browser_navigation",
        ts: "2026-08-30T01:01:00.000Z",
        device: "desk",
        app: "Safari",
        site: "learn.chatgpt.com",
        summary: "Docs",
      },
    ]);
  });

  it("removes urlPath when its host disagrees with site", () => {
    const upload: WindowUpload = {
      metadata: { ...sampleMeta, window_id: "w-host-mismatch", event_count: 1 },
      events: [
        {
          id: "nav",
          type: "browser_navigation",
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk",
          app: "Google Chrome",
          site: "github.com",
          summary: "Pull request",
          urlPath: "https://evil.example/phish?token=secret#frag",
        },
      ],
    };
    const sanitized = sanitizeWindowUpload(upload);
    expect(sanitized.events).toEqual([
      {
        id: "nav",
        type: "browser_navigation",
        ts: "2026-08-30T01:01:00.000Z",
        device: "desk",
        app: "Google Chrome",
        site: "github.com",
        summary: "Pull request",
      },
    ]);
  });

  it("removes urlPath when site is missing or blank", () => {
    const upload: WindowUpload = {
      metadata: { ...sampleMeta, window_id: "w-no-site", event_count: 2 },
      events: [
        {
          id: "missing",
          type: "browser_navigation",
          ts: "2026-08-30T01:01:00.000Z",
          device: "desk",
          app: "Safari",
          urlPath: "https://learn.chatgpt.com/docs?token=secret#section",
        },
        {
          id: "blank",
          type: "browser_navigation",
          ts: "2026-08-30T01:02:00.000Z",
          device: "desk",
          app: "Safari",
          site: "   ",
          urlPath: "/docs?token=1#section",
        },
      ],
    };
    const sanitized = sanitizeWindowUpload(upload);
    expect(sanitized.events).toEqual([
      {
        id: "missing",
        type: "browser_navigation",
        ts: "2026-08-30T01:01:00.000Z",
        device: "desk",
        app: "Safari",
      },
      {
        id: "blank",
        type: "browser_navigation",
        ts: "2026-08-30T01:02:00.000Z",
        device: "desk",
        app: "Safari",
        site: "   ",
      },
    ]);
  });
});
