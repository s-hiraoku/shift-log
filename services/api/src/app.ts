import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  ContinueContextRequestSchema,
  DeleteRequestSchema,
  PermissionsConfigSchema,
  TimelineQuerySchema,
  WindowUploadSchema,
  canCollect,
} from "@shift-log/schema";
import { requireAuth } from "./middleware/auth.js";
import { sanitizeWindowUpload } from "./lib/sanitize.js";
import { isRawWindowExpired, store } from "./lib/store.js";
import { summarizeSixHourBundle, summarizeTenMinuteWindow } from "./jobs/summarize.js";
import { seedDemoData } from "./lib/demo.js";

export function createApp() {
  const app = new Hono();

  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true, service: "shift-log-api" }));

  app.use("/v1/*", requireAuth());

  app.get("/v1/permissions", (c) => c.json(store.permissions));

  app.put("/v1/permissions", async (c) => {
    const body = await c.req.json();
    store.setPermissions(PermissionsConfigSchema.parse(body));
    return c.json(store.permissions);
  });

  app.post("/v1/windows", async (c) => {
    if (!canCollect(store.permissions)) {
      return c.json(
        {
          error: "collection_disabled",
          message:
            "ShiftLog is default-off. Enable ShiftLog and Memories before uploading windows.",
        },
        403,
      );
    }

    const body = await c.req.json();
    const parsed = WindowUploadSchema.parse(body);
    const upload = sanitizeWindowUpload(parsed);
    store.purgeExpiredRawEvents();

    if (isRawWindowExpired(upload.metadata)) {
      return c.json(
        {
          error: "raw_event_expired",
          message:
            "Raw events older than 48 hours (by capture window_end) are not retained.",
        },
        410,
      );
    }

    store.putWindow(upload);
    summarizeTenMinuteWindow(store, upload);

    const recentTen = store
      .listMemories({ limit: 36 })
      .filter((m) => m.front_matter.kind === "ten_minute");
    if (recentTen.length >= 36 || recentTen.length % 6 === 0) {
      summarizeSixHourBundle(
        store,
        recentTen.map((m) => m.id).reverse(),
      );
    }

    return c.json({
      window_id: upload.metadata.window_id,
      accepted_events: upload.events.length,
      summarize_queued: true,
    });
  });

  app.get("/v1/timeline", (c) => {
    const query = TimelineQuerySchema.parse({
      q: c.req.query("q"),
      limit: c.req.query("limit") ?? "50",
      cursor: c.req.query("cursor"),
    });
    const items = store.listMemories(query);
    return c.json({ items, next_cursor: null });
  });

  app.get("/v1/memories/:id", (c) => {
    const id = c.req.param("id");
    const memory = store.getMemory(id);
    if (!memory) return c.json({ error: "not_found" }, 404);
    return c.json(memory);
  });

  app.get("/v1/search", (c) => {
    const query = TimelineQuerySchema.parse({
      q: c.req.query("q") ?? "",
      limit: c.req.query("limit") ?? "50",
    });
    return c.json({ items: store.listMemories(query) });
  });

  app.post("/v1/history/delete", async (c) => {
    const body = DeleteRequestSchema.parse(await c.req.json());
    const result = store.deleteByScope(body.scope);
    return c.json({ ...result, scope: body.scope });
  });

  /** Local MVP helper: seed demo windows + enable collection. */
  app.post("/v1/demo/seed", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { enable?: boolean };
    const result = seedDemoData({ enable: body.enable !== false });
    return c.json({ ok: true, ...result });
  });

  /**
   * Agent read endpoint: recent memories as working-memory context.
   * "続きやって" returns context only — does not execute (no Computer Use).
   */
  app.get("/v1/agent/recent", (c) => {
    const limit = Number(c.req.query("limit") ?? "12");
    const memories = store.listMemories({ limit: Math.min(limit, 36) });
    return c.json({
      mode: "context_only",
      memories,
      note: "Read-only working memory. Agents must not act without explicit user approval.",
    });
  });

  app.post("/v1/agent/continue", async (c) => {
    const body = ContinueContextRequestSchema.parse(
      (await c.req.json().catch(() => ({}))) ?? {},
    );
    const memories = store.listMemories({ limit: body.limit });
    return c.json({
      mode: "context_only" as const,
      prompt: body.prompt,
      memories,
      note: "Context only — ShiftLog v1 does not execute Computer Use. Return this context to the agent; do not operate the computer.",
    });
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
