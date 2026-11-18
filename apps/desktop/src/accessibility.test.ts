import { describe, expect, it } from "vitest";
import { PermissionsConfigSchema } from "@shift-log/schema";
import { observeAccessibility, parseAccessibilitySnapshot } from "./accessibility.js";
import { DesktopCollector, emitOsTick } from "./collector.js";

const permissions = PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true });
const front = { app: "ChatGPT", title: "Conversation" };
const ax = { title: front.title, text: "User: investigate MCP\nAssistant: fixed search", truncated: false };

describe("AX conversation capture", () => {
  it("captures changed text even when the app and title stay the same, and redacts secrets", () => {
    const collector = new DesktopCollector(permissions, "http://localhost", "test");
    expect(collector.observeAx(front, ax)).toBe("recorded");
    expect(collector.observeAx(front, ax)).toBe("unchanged");
    expect(collector.observeAx(front, { ...ax, text: ax.text + "\nAPI_KEY=secret-value" })).toBe("recorded");
    const events = collector.drainWindow(new Date()).events;
    expect(events).toHaveLength(2);
    expect(events[0]?.ax?.text).toContain("fixed search");
    expect(events[1]?.ax?.text).toContain("[redacted]");
    expect(JSON.stringify(events)).not.toContain("secret-value");
  });

  it.each([
    { ...front, privateBrowsing: true },
    { app: "1Password", title: "Secrets" },
    { app: "Google Chrome", title: "Chat", site: "chatgpt.com", privateBrowsingUnknown: true },
    { app: "Google Chrome", title: "Chat" },
  ])("does not read AX for excluded or unclassified contexts: %j", async (context) => {
    let calls = 0;
    expect((await observeAccessibility(context, permissions, async () => { calls++; return "{}"; }, "darwin")).status).toBe("excluded");
    expect(calls).toBe(0);
  });

  it("checks app/site policies and pause before reading or buffering AX", async () => {
    for (const p of [
      PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true, title_policy: { ChatGPT: "app_only" } }),
      PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true, apps: { exclude: ["ChatGPT"] } }),
      PermissionsConfigSchema.parse({ enabled: false }),
    ]) {
      expect((await observeAccessibility(front, p, async () => { throw new Error("must not run"); }, "darwin")).status).toBe("excluded");
      expect(new DesktopCollector(p, "http://localhost", "t").observeAx(front, ax)).toBe("excluded");
    }
    const collector = new DesktopCollector(permissions, "http://localhost", "t");
    collector.pause();
    expect(collector.observeAx(front, ax)).toBe("excluded");
    const browser = { app: "Google Chrome", title: "Chat", site: "blocked.example", urlPath: "/chat" };
    expect((await observeAccessibility(browser, PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true, sites: { exclude: ["blocked.example"] } }), async () => "{}", "darwin")).status).toBe("excluded");
  });

  it("rejects focus and browser URL races, and exposes missing helper/permission status", async () => {
    expect(parseAccessibilitySnapshot(JSON.stringify({ status: "ok", app: "Claude", ...ax }), front).status).toBe("focus_changed");
    const browser = { app: "Google Chrome", title: "Chat", site: "chatgpt.com", urlPath: "/c/one" };
    expect(parseAccessibilitySnapshot(JSON.stringify({ status: "ok", ...browser, text: "private", url: "https://other.example/c/one" }), browser).status).toBe("focus_changed");
    expect(parseAccessibilitySnapshot('{"status":"permission_denied"}', front).status).toBe("permission_denied");
    expect((await observeAccessibility(front, permissions, async () => { throw Object.assign(new Error(), { code: "ENOENT" }); }, "darwin")).status).toBe("helper_missing");
    expect((await observeAccessibility(front, permissions, async () => "bad json", "darwin")).status).toBe("unavailable");
  });

  it("bounds AX payloads and retries the same text after a successful flush", async () => {
    const collector = new DesktopCollector(permissions, "http://localhost", "t");
    for (let i = 0; i < 10; i++) expect(collector.observeAx(front, { ...ax, text: String.fromCharCode(97 + i).repeat(12000) })).toBe("recorded");
    expect(collector.observeAx(front, { ...ax, text: "z".repeat(12000) })).toBe("budget_exhausted");
    collector.upload = async () => new Response("ok");
    await collector.flushWindow(new Date());
    expect(collector.observeAx(front, ax)).toBe("recorded");
  });

  it("records same-title browser navigations when only the URL changes", () => {
    const collector = new DesktopCollector(permissions, "http://localhost", "t");
    const browser = { app: "Google Chrome", title: "Chat", site: "chatgpt.com", urlPath: "/c/one" };
    const last = emitOsTick(collector, browser, null);
    emitOsTick(collector, { ...browser, urlPath: "/c/two" }, last);
    expect(collector.drainWindow(new Date()).events.filter((e) => e.type === "browser_navigation").map((e) => e.urlPath)).toEqual(["/c/one", "/c/two"]);
  });
});
