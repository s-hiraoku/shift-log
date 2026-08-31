import { describe, expect, it } from "vitest";
import {
  canCollect,
  isSourceAllowed,
  PermissionsConfigSchema,
  serializeMemoryMarkdown,
  WindowUploadSchema,
  type MemoryRecord,
} from "./index.js";

describe("permissions", () => {
  it("defaults to off and requires memories", () => {
    const config = PermissionsConfigSchema.parse({});
    expect(config.enabled).toBe(false);
    expect(config.memories_enabled).toBe(false);
    expect(canCollect(config)).toBe(false);
  });

  it("collects only when enabled, memories on, and not paused", () => {
    const config = PermissionsConfigSchema.parse({
      enabled: true,
      memories_enabled: true,
      paused: false,
    });
    expect(canCollect(config)).toBe(true);
    expect(canCollect({ ...config, paused: true })).toBe(false);
  });

  it("supports exclude and include_only modes", () => {
    const exclude = PermissionsConfigSchema.parse({
      apps: { mode: "exclude_listed", exclude: ["Slack"], include_only: [] },
    });
    expect(isSourceAllowed(exclude, "apps", "Code")).toBe(true);
    expect(isSourceAllowed(exclude, "apps", "Slack")).toBe(false);

    const include = PermissionsConfigSchema.parse({
      apps: { mode: "include_only", exclude: [], include_only: ["Code"] },
    });
    expect(isSourceAllowed(include, "apps", "Code")).toBe(true);
    expect(isSourceAllowed(include, "apps", "Slack")).toBe(false);
  });

  it("forbids screenshots and full keylog in capture policy", () => {
    const config = PermissionsConfigSchema.parse({});
    expect(config.capture_policy.screenshots).toBe(false);
    expect(config.capture_policy.full_keylog).toBe(false);
    expect(config.private_browsing_excluded).toBe(true);
  });
});

describe("window upload", () => {
  it("accepts dual-lane desk+mobile windows", () => {
    const start = "2026-08-30T01:00:00.000Z";
    const end = "2026-08-30T01:10:00.000Z";
    const parsed = WindowUploadSchema.parse({
      metadata: {
        window_id: "w1",
        window_start: start,
        window_end: end,
        devices: ["desk", "mobile"],
        dual_lane: true,
        event_count: 2,
        schema_version: "1",
      },
      events: [
        {
          id: "e1",
          type: "app_switch",
          ts: start,
          device: "desk",
          app: "Code",
          summary: "Switched to Code",
        },
        {
          id: "e2",
          type: "screen_enter",
          ts: start,
          device: "mobile",
          app: "Safari",
        },
      ],
    });
    expect(parsed.metadata.dual_lane).toBe(true);
  });
});

describe("memory markdown", () => {
  it("serializes YAML front matter and body", () => {
    const record: MemoryRecord = {
      id: "m1",
      created_at: "2026-08-30T01:10:00.000Z",
      updated_at: "2026-08-30T01:10:00.000Z",
      front_matter: {
        title: "Editing ShiftLog schema",
        description: "Worked on Zod schemas",
        apps: ["Code", "Terminal"],
        device: "desk",
        window_start: "2026-08-30T01:00:00.000Z",
        window_end: "2026-08-30T01:10:00.000Z",
        kind: "ten_minute",
        window_ids: ["w1"],
        skill_candidate: false,
      },
      body: "## 作業サマリ\n\nスキーマを定義した。",
    };
    const md = serializeMemoryMarkdown(record);
    expect(md).toContain("title:");
    expect(md).toContain("window_start:");
    expect(md).toContain("作業サマリ");
  });
});
