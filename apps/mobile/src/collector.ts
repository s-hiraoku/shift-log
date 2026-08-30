import {
  canCollect,
  isSourceAllowed,
  type InteractionEvent,
  type PermissionsConfig,
  type WindowUpload,
  WINDOW_DURATION_MINUTES,
} from "@shift-log/schema";

/**
 * Mobile collector stub (v1).
 * Sensors (when wired to OS): foreground app, screen enter/exit,
 * allowed browser navigations, notification open/close.
 * Full keystroke capture is forbidden.
 * Pause/resume via Control Center / notification actions.
 */
export class MobileCollector {
  private buffer: InteractionEvent[] = [];
  private pausedLocal = false;

  constructor(
    private permissions: PermissionsConfig,
    private apiBase: string,
    private token: string,
  ) {}

  /** Control Center / notification: Pause */
  pause(): void {
    this.pausedLocal = true;
  }

  /** Control Center / notification: Resume */
  resume(): void {
    this.pausedLocal = false;
  }

  observe(event: Omit<InteractionEvent, "device"> & { device?: "mobile" }): void {
    if (!canCollect(this.permissions) || this.pausedLocal || this.permissions.paused) {
      return;
    }
    if (event.app && !isSourceAllowed(this.permissions, "apps", event.app)) {
      return;
    }
    if (event.site && !isSourceAllowed(this.permissions, "sites", event.site)) {
      return;
    }
    if (event.meta?.privateBrowsing === true) return;

    const allowedTypes = new Set([
      "app_switch",
      "screen_enter",
      "screen_exit",
      "browser_navigation",
      "notification_open",
      "notification_close",
      "pause",
      "resume",
      "front_window_summary",
    ]);
    if (!allowedTypes.has(event.type)) {
      return;
    }

    this.buffer.push({ ...event, device: "mobile" });
  }

  drainWindow(windowStart: Date): WindowUpload {
    const window_end = new Date(
      windowStart.getTime() + WINDOW_DURATION_MINUTES * 60 * 1000,
    ).toISOString();
    const window_start = windowStart.toISOString();
    const events = this.buffer.splice(0, this.buffer.length);
    return {
      metadata: {
        window_id: `mobile_${window_start}`,
        window_start,
        window_end,
        devices: ["mobile"],
        dual_lane: false,
        event_count: events.length,
        paused: this.pausedLocal || this.permissions.paused,
        schema_version: "1",
      },
      events,
    };
  }

  /**
   * Merge desk + mobile buffers that share the same 10-minute window
   * into a dual-lane upload.
   */
  static mergeDualLane(desk: WindowUpload, mobile: WindowUpload): WindowUpload {
    const window_start = desk.metadata.window_start;
    const window_end = desk.metadata.window_end;
    const events = [...desk.events, ...mobile.events].sort((a, b) =>
      a.ts.localeCompare(b.ts),
    );
    return {
      metadata: {
        window_id: `dual_${window_start}`,
        window_start,
        window_end,
        devices: ["desk", "mobile"],
        dual_lane: true,
        event_count: events.length,
        paused: desk.metadata.paused || mobile.metadata.paused,
        schema_version: "1",
      },
      events,
    };
  }
}

export async function main(): Promise<void> {
  console.log(
    "[mobile] stub ready — foreground/screen/nav/notification only; no keylog",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
