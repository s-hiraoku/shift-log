import type { InteractionEvent, WindowUpload } from "@shift-log/schema";
import { PermissionsConfigSchema } from "@shift-log/schema";
import { sanitizeWindowUpload } from "./sanitize.js";
import { store as defaultStore, type MemoryStore } from "./store.js";
import { summarizeTenMinuteWindow } from "../jobs/summarize.js";

function minutesAgo(mins: number, from = new Date()): Date {
  return new Date(from.getTime() - mins * 60 * 1000);
}

function iso(d: Date): string {
  return d.toISOString();
}

function demoWindow(opts: {
  id: string;
  start: Date;
  device: "desk" | "mobile" | "both";
  events: InteractionEvent[];
}): WindowUpload {
  const end = new Date(opts.start.getTime() + 10 * 60 * 1000);
  const devices =
    opts.device === "both"
      ? (["desk", "mobile"] as const)
      : ([opts.device] as const);
  return {
    metadata: {
      window_id: opts.id,
      window_start: iso(opts.start),
      window_end: iso(end),
      devices: [...devices],
      dual_lane: opts.device === "both",
      event_count: opts.events.length,
      paused: false,
      schema_version: "1",
    },
    events: opts.events,
  };
}

/** Seed recent windows so timeline/settings flows work without a real OS collector. */
export function seedDemoData(
  opts: { enable?: boolean; store?: MemoryStore } = {},
): {
  windows: number;
  memories: number;
  permissions_enabled: boolean;
} {
  const store = opts.store ?? defaultStore;
  if (opts.enable !== false) {
    store.setPermissions(
      PermissionsConfigSchema.parse({
        ...store.permissions,
        enabled: true,
        memories_enabled: true,
        paused: false,
      }),
    );
  }

  const now = new Date();
  const samples: WindowUpload[] = [
    demoWindow({
      id: `demo_desk_${iso(minutesAgo(40, now))}`,
      start: minutesAgo(40, now),
      device: "desk",
      events: [
        {
          id: "d1",
          type: "app_switch",
          ts: iso(minutesAgo(38, now)),
          device: "desk",
          app: "Code",
          summary: "Opened ShiftLog monorepo",
        },
        {
          id: "d2",
          type: "typing_presence",
          ts: iso(minutesAgo(35, now)),
          device: "desk",
          app: "Code",
          typing: { active: true, approxChars: 120 },
          summary: "Editing API store persistence",
        },
        {
          id: "d3",
          type: "browser_navigation",
          ts: iso(minutesAgo(33, now)),
          device: "desk",
          app: "Chrome",
          site: "github.com",
          summary: "Checked pull request diff",
        },
      ],
    }),
    demoWindow({
      id: `demo_dual_${iso(minutesAgo(25, now))}`,
      start: minutesAgo(25, now),
      device: "both",
      events: [
        {
          id: "u1",
          type: "app_switch",
          ts: iso(minutesAgo(24, now)),
          device: "desk",
          app: "Terminal",
          summary: "Ran pnpm test",
        },
        {
          id: "u2",
          type: "screen_enter",
          ts: iso(minutesAgo(23, now)),
          device: "mobile",
          app: "Slack",
          summary: "Checked team thread",
        },
        {
          id: "u3",
          type: "notification_open",
          ts: iso(minutesAgo(22, now)),
          device: "mobile",
          app: "Slack",
          summary: "Opened mention notification",
        },
        {
          id: "u4",
          type: "front_window_summary",
          ts: iso(minutesAgo(20, now)),
          device: "desk",
          app: "Code",
          summary: "Back to failing test fix",
        },
      ],
    }),
    demoWindow({
      id: `demo_mobile_${iso(minutesAgo(12, now))}`,
      start: minutesAgo(12, now),
      device: "mobile",
      events: [
        {
          id: "m1",
          type: "app_switch",
          ts: iso(minutesAgo(11, now)),
          device: "mobile",
          app: "Safari",
          summary: "Read Computer History docs",
        },
        {
          id: "m2",
          type: "browser_navigation",
          ts: iso(minutesAgo(10, now)),
          device: "mobile",
          app: "Safari",
          site: "learn.chatgpt.com",
          summary: "Opened Computer History page",
        },
      ],
    }),
  ];

  let windows = 0;
  for (const raw of samples) {
    if (store.windows.has(raw.metadata.window_id)) continue;
    const upload = sanitizeWindowUpload(raw);
    const stored = store.putWindow(upload);
    if (!stored) continue;
    summarizeTenMinuteWindow(store, upload);
    windows += 1;
  }

  return {
    windows,
    memories: store.memories.size,
    permissions_enabled:
      store.permissions.enabled && store.permissions.memories_enabled,
  };
}
