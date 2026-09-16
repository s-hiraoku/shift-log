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
});
