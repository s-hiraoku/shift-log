import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { storeFor } from "../lib/store.js";
import { assertAuthConfigured, matchConfiguredToken } from "./auth.js";

const original = {
  token: process.env.SHIFTLOG_API_TOKEN,
  tokens: process.env.SHIFTLOG_API_TOKENS,
  insecure: process.env.SHIFTLOG_ALLOW_INSECURE_DEV,
};

afterEach(() => {
  process.env.SHIFTLOG_API_TOKEN = original.token;
  process.env.SHIFTLOG_API_TOKENS = original.tokens;
  process.env.SHIFTLOG_ALLOW_INSECURE_DEV = original.insecure;
});

describe("auth configuration", () => {
  it("is fail-closed when no tokens are configured", () => {
    delete process.env.SHIFTLOG_API_TOKEN;
    delete process.env.SHIFTLOG_API_TOKENS;
    delete process.env.SHIFTLOG_ALLOW_INSECURE_DEV;
    expect(() => assertAuthConfigured()).toThrow(/fail-closed/);
    expect(matchConfiguredToken("dev-token")).toBeNull();
  });

  it("maps SHIFTLOG_API_TOKENS to distinct users", () => {
    delete process.env.SHIFTLOG_API_TOKEN;
    process.env.SHIFTLOG_API_TOKENS = "alice:alice-secret,bob:bob-secret";
    expect(matchConfiguredToken("alice-secret")).toEqual({ userId: "alice" });
    expect(matchConfiguredToken("bob-secret")).toEqual({ userId: "bob" });
    expect(matchConfiguredToken("other")).toBeNull();
  });

  it("isolates tenant data between tokens", async () => {
    delete process.env.SHIFTLOG_API_TOKEN;
    process.env.SHIFTLOG_API_TOKENS = "alice:alice-secret,bob:bob-secret";
    const app = createApp();
    storeFor("alice").reset();
    storeFor("bob").reset();

    const aliceHeaders = {
      authorization: "Bearer alice-secret",
      "content-type": "application/json",
    };
    const bobHeaders = {
      authorization: "Bearer bob-secret",
      "content-type": "application/json",
    };

    await app.request("/v1/permissions", {
      method: "PUT",
      headers: aliceHeaders,
      body: JSON.stringify({
        enabled: true,
        memories_enabled: true,
        paused: false,
        private_browsing_excluded: true,
      }),
    });

    const now = new Date();
    const start = new Date(now.getTime() - 10 * 60 * 1000);
    await app.request("/v1/windows", {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({
        metadata: {
          window_id: "alice-w",
          window_start: start.toISOString(),
          window_end: now.toISOString(),
          devices: ["desk"],
          dual_lane: false,
          event_count: 1,
          schema_version: "1",
        },
        events: [
          {
            id: "e-alice",
            type: "app_switch",
            ts: now.toISOString(),
            device: "desk",
            app: "Code",
          },
        ],
      }),
    });

    const aliceTimeline = await app.request("/v1/timeline", { headers: aliceHeaders });
    const bobTimeline = await app.request("/v1/timeline", { headers: bobHeaders });
    expect((await aliceTimeline.json()).items.length).toBeGreaterThan(0);
    expect((await bobTimeline.json()).items).toEqual([]);
  });
});
