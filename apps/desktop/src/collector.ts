import {
  canCollect,
  isSourceAllowed,
  type InteractionEvent,
  type PermissionsConfig,
  type WindowUpload,
  WINDOW_DURATION_MINUTES,
} from "@shift-log/schema";

/**
 * Desktop collector (v1 stub).
 * - Menu bar pause/resume is represented by permissions.paused
 * - Never captures screenshots, mic, system audio, or full keylogs
 * - Private browsing is permanently excluded
 * - Emits desk-lane events into 10-minute windows
 */
export class DesktopCollector {
  private buffer: InteractionEvent[] = [];
  private pausedLocal = false;

  constructor(
    private permissions: PermissionsConfig,
    private apiBase: string,
    private token: string,
  ) {}

  setPermissions(permissions: PermissionsConfig): void {
    this.permissions = permissions;
  }

  /** Menu bar: Pause */
  pause(): void {
    this.pausedLocal = true;
    this.buffer.push({
      id: `pause_${Date.now()}`,
      type: "pause",
      ts: new Date().toISOString(),
      device: "desk",
      summary: "Collection paused from menu bar",
    });
  }

  /** Menu bar: Resume */
  resume(): void {
    this.pausedLocal = false;
    this.buffer.push({
      id: `resume_${Date.now()}`,
      type: "resume",
      ts: new Date().toISOString(),
      device: "desk",
      summary: "Collection resumed from menu bar",
    });
  }

  observe(event: Omit<InteractionEvent, "device"> & { device?: "desk" }): void {
    if (!canCollect(this.permissions) || this.pausedLocal || this.permissions.paused) {
      return;
    }
    if (event.app && !isSourceAllowed(this.permissions, "apps", event.app)) {
      return;
    }
    if (event.site && !isSourceAllowed(this.permissions, "sites", event.site)) {
      return;
    }
    // Private browsing permanently excluded
    if (event.meta?.privateBrowsing === true) {
      return;
    }
    // Never accept full keystroke payloads
    if (event.type === "typing_presence" && typeof event.meta?.keyText === "string") {
      const { keyText: _removed, ...rest } = event.meta;
      event = { ...event, meta: rest };
    }

    this.buffer.push({
      ...event,
      device: "desk",
    });
  }

  drainWindow(windowStart: Date): WindowUpload {
    const window_end = new Date(
      windowStart.getTime() + WINDOW_DURATION_MINUTES * 60 * 1000,
    ).toISOString();
    const window_start = windowStart.toISOString();
    const events = this.buffer.splice(0, this.buffer.length);
    return {
      metadata: {
        window_id: `desk_${window_start}`,
        window_start,
        window_end,
        devices: ["desk"],
        dual_lane: false,
        event_count: events.length,
        paused: this.pausedLocal || this.permissions.paused,
        schema_version: "1",
      },
      events,
    };
  }

  async upload(window: WindowUpload): Promise<Response> {
    return fetch(`${this.apiBase}/v1/windows`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(window),
    });
  }
}

/** Demo loop for local development — not a production accessibility hook. */
export async function main(): Promise<void> {
  const apiBase = process.env.SHIFTLOG_API_ORIGIN ?? "http://localhost:8787";
  const token = process.env.SHIFTLOG_API_TOKEN ?? "dev-token";

  const permissionsRes = await fetch(`${apiBase}/v1/permissions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const permissions = (await permissionsRes.json()) as PermissionsConfig;

  const collector = new DesktopCollector(permissions, apiBase, token);
  console.log(
    "[desktop] collector ready. captures=off, private_browsing=excluded, keylog=forbidden",
  );
  console.log(
    `[desktop] canCollect=${canCollect(permissions)} paused=${permissions.paused}`,
  );

  // Simulated observation for stub / integration testing
  collector.observe({
    id: `demo_${Date.now()}`,
    type: "front_window_summary",
    ts: new Date().toISOString(),
    app: "Code",
    summary: "Editing ShiftLog monorepo",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
