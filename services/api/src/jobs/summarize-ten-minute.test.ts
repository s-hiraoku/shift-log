import { describe, expect, it } from "vitest";
import type { InteractionEvent, WindowUpload } from "@shift-log/schema";
import { deterministicTenMinuteBody } from "./summarize.js";

const WINDOW_START = "2026-09-11T06:39:00.000Z";
const WINDOW_END = "2026-09-11T06:49:00.000Z";

function event(
  id: string,
  ts: string,
  type: InteractionEvent["type"],
  app: string,
  summary: string,
  site?: string,
): InteractionEvent {
  return {
    id,
    type,
    ts,
    device: "desk",
    app,
    summary,
    ...(site ? { site } : {}),
  };
}

/** 15 events matching the 2026-09-11 ghostty ↔ Slack desk window in #34. */
export function ghosttySlackRoundTripUpload(): WindowUpload {
  return {
    metadata: {
      window_id: "w-2026-09-11-0639",
      window_start: WINDOW_START,
      window_end: WINDOW_END,
      devices: ["desk"],
      dual_lane: false,
      event_count: 15,
      paused: false,
      schema_version: "1",
    },
    events: [
      event("e01", "2026-09-11T06:39:00.000Z", "app_switch", "ghostty", "Focused ghostty"),
      event("e02", "2026-09-11T06:39:15.000Z", "front_window_summary", "ghostty", "hiraoku.shinichi"),
      event("e03", "2026-09-11T06:40:00.000Z", "app_switch", "Slack", "Focused Slack"),
      event(
        "e04",
        "2026-09-11T06:40:15.000Z",
        "front_window_summary",
        "Slack",
        "team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail",
        "github.com",
      ),
      event("e05", "2026-09-11T06:41:00.000Z", "app_switch", "ghostty", "Focused ghostty"),
      event("e06", "2026-09-11T06:41:15.000Z", "front_window_summary", "ghostty", "hiraoku.shinichi"),
      event("e07", "2026-09-11T06:42:00.000Z", "app_switch", "Slack", "Focused Slack"),
      event(
        "e08",
        "2026-09-11T06:42:15.000Z",
        "front_window_summary",
        "Slack",
        "team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail",
        "github.com",
      ),
      event("e09", "2026-09-11T06:43:00.000Z", "app_switch", "ghostty", "Focused ghostty"),
      event("e10", "2026-09-11T06:43:15.000Z", "front_window_summary", "ghostty", "hiraoku.shinichi"),
      event("e11", "2026-09-11T06:44:00.000Z", "app_switch", "Slack", "Focused Slack"),
      event(
        "e12",
        "2026-09-11T06:44:15.000Z",
        "front_window_summary",
        "Slack",
        "team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail",
        "github.com",
      ),
      event("e13", "2026-09-11T06:45:00.000Z", "app_switch", "ghostty", "Focused ghostty"),
      event("e14", "2026-09-11T06:45:15.000Z", "front_window_summary", "ghostty", "hiraoku.shinichi"),
      event("e15", "2026-09-11T06:47:00.000Z", "front_window_summary", "ghostty", "hiraoku.shinichi"),
    ],
  };
}

const EXPECTED_BODY = [
  "## アプリ別滞在時間",
  "",
  "- 06:39 ghostty 420秒",
  "- 06:39 Slack 180秒",
  "",
  "## Focus span",
  "",
  "- 06:39-06:40 ghostty — hiraoku.shinichi",
  "- 06:40-06:41 Slack — team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail",
  "- 06:41-06:42 ghostty — hiraoku.shinichi",
  "- 06:42-06:43 Slack — team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail",
  "- 06:43-06:44 ghostty — hiraoku.shinichi",
  "- 06:44-06:45 Slack — team_frontend-pr-n10n（チャンネル） - DietrichGebert/ponytail",
  "- 06:45-06:49 ghostty — hiraoku.shinichi",
  "",
  "> skill_candidate: Repeated app switching within a narrow app set",
].join("\n");

describe("deterministicTenMinuteBody", () => {
  it("builds dwell + HH:MM focus spans from a 15-event ghostty/Slack round trip", () => {
    const upload = ghosttySlackRoundTripUpload();
    const out = deterministicTenMinuteBody(upload);

    expect(out.body).toBe(EXPECTED_BODY);
    expect(out.aggregate.apps_dwell).toEqual({ ghostty: 420, Slack: 180 });
    expect(out.aggregate.active_seconds).toBe(600);
    expect(out.aggregate.active_seconds).toBe(
      Object.values(out.aggregate.apps_dwell).reduce((sum, n) => sum + n, 0),
    );
    expect(out.aggregate.top_app).toBe("ghostty");
    expect(out.aggregate.sites).toEqual(["github.com"]);
    expect(out.aggregate.spans).toHaveLength(7);

    const contentLines = out.body
      .split("\n")
      .filter((line) => line.startsWith("- ") || line.startsWith("> "));
    for (const line of contentLines.filter((line) => line.startsWith("- "))) {
      expect(line).toMatch(/\d{2}:\d{2}/);
    }
  });

  it("keeps Slack dwell and uses the app name when titles were omitted", () => {
    const upload: WindowUpload = {
      metadata: {
        window_id: "w-app-only",
        window_start: "2026-09-13T01:00:00.000Z",
        window_end: "2026-09-13T01:10:00.000Z",
        devices: ["desk"],
        dual_lane: false,
        event_count: 2,
        paused: false,
        schema_version: "1",
      },
      events: [
        {
          id: "s1",
          type: "app_switch",
          ts: "2026-09-13T01:00:00.000Z",
          device: "desk",
          app: "Slack",
        },
        {
          id: "s2",
          type: "front_window_summary",
          ts: "2026-09-13T01:00:15.000Z",
          device: "desk",
          app: "Slack",
        },
      ],
    };
    const out = deterministicTenMinuteBody(upload);
    expect(out.aggregate.apps_dwell).toEqual({ Slack: 600 });
    expect(out.body).toContain("- 01:00 Slack 600秒");
    expect(out.body).toContain("- 01:00-01:10 Slack — Slack");
    expect(out.body).not.toContain("チャンネル");
    expect(out.aggregate.sites).toEqual([]);
  });
});
