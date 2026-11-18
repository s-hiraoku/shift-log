import { describe, expect, it } from "vitest";
import { ActivityQuerySchema, PermissionsConfigSchema, type WindowUpload } from "@shift-log/schema";
import { MemoryStore } from "./store.js";
import { getActivity, searchActivity } from "./activity.js";
import { sanitizeWindowUpload } from "./sanitize.js";

const permissions = PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true });
const now = new Date();
function upload(id = "window"): WindowUpload {
  return {
    metadata: { window_id: id, window_start: new Date(+now - 600_000).toISOString(), window_end: now.toISOString(), devices: ["desk"], dual_lane: false, event_count: 3, paused: false, schema_version: "1" },
    events: [0, 1, 2].map((i) => ({ id: `e${i}`, type: "accessibility_snapshot", ts: new Date(+now - (3 - i) * 1000).toISOString(), device: "desk", app: "ChatGPT", ax: { title: "Conversation", text: `User: Improve MCP ${i}\nAssistant: done`, truncated: false } })),
  };
}

describe("AX evidence search", () => {
  it("finds conversation text, pages without omissions and retrieves the original snapshot", () => {
    const store = new MemoryStore();
    store.putWindow(upload());
    const first = searchActivity(store.windows.values(), permissions, ActivityQuerySchema.parse({ q: "mcp", limit: 2 }), now)!;
    expect(first.items.map((x) => x.event_id)).toEqual(["e2", "e1"]);
    expect(first.items[0]?.snippet).toContain("Improve MCP");
    expect(first.has_more).toBe(true);
    const second = searchActivity(store.windows.values(), permissions, ActivityQuerySchema.parse({ q: "mcp", limit: 2, cursor: first.next_cursor }), now)!;
    expect(second.items.map((x) => x.event_id)).toEqual(["e0"]);
    expect(second.next_cursor).toBeNull();
    expect(getActivity(store.windows.values(), permissions, first.items[0]!.id, now)?.text).toContain("Assistant: done");
    expect(searchActivity(store.windows.values(), permissions, ActivityQuerySchema.parse({ q: "unrelated" }), now)?.items).toEqual([]);
    expect(searchActivity(store.windows.values(), permissions, ActivityQuerySchema.parse({ app: "Claude" }), now)?.items).toEqual([]);
    expect(searchActivity(store.windows.values(), permissions, ActivityQuerySchema.parse({ since: now.toISOString() }), now)?.items).toEqual([]);
    expect(searchActivity(store.windows.values(), permissions, ActivityQuerySchema.parse({ cursor: "invalid" }), now)).toBeNull();
  });

  it("hides deleted, expired, newly excluded and other-tenant evidence", () => {
    const store = new MemoryStore(); store.putWindow(upload());
    const id = searchActivity(store.windows.values(), permissions, ActivityQuerySchema.parse({}), now)!.items[0]!.id;
    expect(getActivity(store.windows.values(), permissions, id, new Date(+now + 49 * 3600_000))).toBeUndefined();
    expect(getActivity(new MemoryStore("other").windows.values(), permissions, id, now)).toBeUndefined();
    expect(getActivity(store.windows.values(), PermissionsConfigSchema.parse({ title_policy: { ChatGPT: "app_only" } }), id, now)).toBeUndefined();
    store.deleteByScope("all");
    expect(getActivity(store.windows.values(), permissions, id, now)).toBeUndefined();
  });

  it("redacts before storage and enforces AX exclusions on the API boundary", () => {
    const data = upload(); data.events[0]!.ax!.text = "API_KEY=secret-value";
    const clean = sanitizeWindowUpload(data, permissions);
    expect(clean.events[0]?.ax?.text).toContain("[redacted]");
    const restricted = PermissionsConfigSchema.parse({ title_policy: { ChatGPT: "app_only" } });
    expect(sanitizeWindowUpload(data, restricted).events).toEqual([]);
    expect(sanitizeWindowUpload(data, PermissionsConfigSchema.parse({ apps: { exclude: ["ChatGPT"] } })).events).toEqual([]);
    data.events[0]!.app = "Google Chrome";
    data.events[0]!.site = "chatgpt.com";
    data.events[0]!.meta = { privateBrowsingUnknown: true };
    expect(sanitizeWindowUpload(data, permissions).events.map((e) => e.id)).not.toContain("e0");
  });
});
