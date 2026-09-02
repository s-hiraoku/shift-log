import {
  canCollect,
  isSourceAllowed,
  type InteractionEvent,
  type PermissionsConfig,
  type WindowUpload,
  WINDOW_DURATION_MINUTES,
} from "@shift-log/schema";
import { observeFrontWindow, type FrontWindow } from "./os-observe.js";

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

function requireToken(): string {
  const token = process.env.SHIFTLOG_API_TOKEN;
  if (token) return token;
  if (process.env.SHIFTLOG_ALLOW_INSECURE_DEV === "1") return "dev-token";
  throw new Error(
    "SHIFTLOG_API_TOKEN is required for the collector (fail-closed). Set SHIFTLOG_ALLOW_INSECURE_DEV=1 only for local demos.",
  );
}

function emitDemoTick(
  collector: DesktopCollector,
  apps: string[],
  appIdx: number,
): number {
  const app = apps[appIdx % apps.length]!;
  const now = new Date().toISOString();
  collector.observe({
    id: `tick_switch_${Date.now()}`,
    type: "app_switch",
    ts: now,
    app,
    summary: `Demo focus: ${app}`,
  });
  collector.observe({
    id: `tick_front_${Date.now()}`,
    type: "front_window_summary",
    ts: now,
    app,
    summary: `Demo window summary for ${app}`,
  });
  return appIdx + 1;
}

export function emitOsTick(
  collector: DesktopCollector,
  observed: FrontWindow,
  last: { app: string; title: string } | null,
): { app: string; title: string } {
  const now = new Date().toISOString();
  if (observed.privateBrowsing) return last ?? { app: observed.app, title: observed.title };
  if (!last || last.app !== observed.app) {
    collector.observe({
      id: `os_switch_${Date.now()}`,
      type: "app_switch",
      ts: now,
      app: observed.app,
      site: observed.site,
      summary: `Focused ${observed.app}`,
    });
  }
  if (observed.site && (!last || last.title !== observed.title)) {
    collector.observe({
      id: `os_nav_${Date.now()}`,
      type: "browser_navigation",
      ts: now,
      app: observed.app,
      site: observed.site,
      summary: observed.title.slice(0, 200) || observed.site,
    });
  } else if (!last || last.title !== observed.title) {
    collector.observe({
      id: `os_front_${Date.now()}`,
      type: "front_window_summary",
      ts: now,
      app: observed.app,
      site: observed.site,
      summary: observed.title.slice(0, 200) || observed.app,
    });
  }
  return { app: observed.app, title: observed.title };
}

/**
 * Collector loop. Default: observe the real frontmost window (macOS / Linux).
 * `--demo` keeps the previous synthetic loop for CI / machines without OS hooks.
 * Never captures screenshots, mic, system audio, or keystroke text.
 */
export async function main(): Promise<void> {
  const apiBase = process.env.SHIFTLOG_API_ORIGIN ?? "http://localhost:8787";
  const token = requireToken();
  const demo = process.argv.includes("--demo") || process.env.SHIFTLOG_DEMO === "1";
  const tickMs = Number(process.env.SHIFTLOG_TICK_MS ?? (demo ? 15_000 : 5_000));
  const flushMs = Number(
    process.env.SHIFTLOG_FLUSH_MS ?? WINDOW_DURATION_MINUTES * 60 * 1000,
  );

  async function loadPermissions(): Promise<PermissionsConfig> {
    const res = await fetch(`${apiBase}/v1/permissions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`permissions ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as PermissionsConfig;
  }

  let permissions = await loadPermissions();
  const collector = new DesktopCollector(permissions, apiBase, token);
  console.log(
    "[desktop] collector ready. captures=off, private_browsing=excluded, keylog=forbidden",
  );
  console.log(
    `[desktop] canCollect=${canCollect(permissions)} paused=${permissions.paused} demo=${demo}`,
  );
  console.log(`[desktop] tick=${tickMs}ms flush=${flushMs}ms`);

  const demoApps = ["Code", "Chrome", "Terminal", "Slack", "Notion"];
  let demoIdx = 0;
  let lastFront: { app: string; title: string } | null = null;
  let windowStart = new Date();

  async function flush(): Promise<void> {
    try {
      permissions = await loadPermissions();
      collector.setPermissions(permissions);
    } catch (err) {
      console.warn("[desktop] permissions refresh failed:", err);
    }
    if (!canCollect(permissions)) {
      console.log("[desktop] collection disabled — enable ShiftLog + Memories in Settings");
      return;
    }
    const upload = collector.drainWindow(windowStart);
    windowStart = new Date();
    if (upload.events.length === 0) {
      console.log("[desktop] flush skipped (no events)");
      return;
    }
    const res = await collector.upload(upload);
    const body = await res.text();
    console.log(`[desktop] uploaded window ${upload.metadata.window_id} status=${res.status} ${body}`);
  }

  async function tick(): Promise<void> {
    if (!canCollect(permissions) && !demo) return;
    if (demo) {
      demoIdx = emitDemoTick(collector, demoApps, demoIdx);
      return;
    }
    const observed = await observeFrontWindow();
    if (!observed) {
      console.warn("[desktop] front window unavailable (need Accessibility / xdotool)");
      return;
    }
    lastFront = emitOsTick(collector, observed, lastFront);
    console.log(`[desktop] observed app=${observed.app} title=${observed.title.slice(0, 80)}`);
  }

  await tick();

  if (!demo && process.env.SHIFTLOG_ONCE === "1") {
    await flush();
    return;
  }

  setInterval(() => {
    void tick();
  }, tickMs);
  setInterval(() => {
    void flush();
  }, flushMs);

  await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
