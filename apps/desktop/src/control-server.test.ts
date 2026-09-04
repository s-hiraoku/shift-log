import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PermissionsConfigSchema } from "@shift-log/schema";
import { DesktopCollector } from "./collector.js";
import { startControlServer, type ControlState } from "./control-server.js";

function enabledCollector(): DesktopCollector {
  return new DesktopCollector(
    PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true }),
    "http://localhost:8787",
    "dev-token",
  );
}

async function listen(server: Server): Promise<number> {
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
  }
  return (server.address() as AddressInfo).port;
}

describe("control server", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
          }),
      ),
    );
  });

  it("pauses and resumes collection over localhost HTTP", async () => {
    const collector = enabledCollector();
    const state: ControlState = { paused: false, lastApp: "Code <b>" };
    const server = startControlServer(collector, state, {
      port: 0,
      onQuit: () => undefined,
    });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const pause = await fetch(`${base}/pause`, { method: "POST" });
    expect(pause.status).toBe(200);
    expect(collector.isPaused()).toBe(true);

    collector.observe({
      id: "should-drop",
      type: "app_switch",
      ts: new Date().toISOString(),
      app: "Code",
    });

    const resume = await fetch(`${base}/resume`, { method: "POST" });
    expect(resume.status).toBe(200);
    expect(collector.isPaused()).toBe(false);

    const health = await fetch(`${base}/health`);
    const healthBody = (await health.json()) as { paused: boolean };
    expect(healthBody.paused).toBe(false);

    const menu = await fetch(`${base}/`);
    const html = await menu.text();
    expect(html).toContain("一時停止");
    expect(html).not.toContain("<b>");
    expect(html).toContain("Code &lt;b&gt;");
  });
});
