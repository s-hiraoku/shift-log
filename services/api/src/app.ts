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
import { rateLimit } from "./middleware/rate-limit.js";
import { audit } from "./lib/audit.js";
import { sanitizeWindowUpload } from "./lib/sanitize.js";
import { isRawWindowExpired, purgeAllTenants, storeFor, type MemoryStore } from "./lib/store.js";
import { summarizeSixHourBundle, summarizeTenMinuteWindow } from "./jobs/summarize.js";
import { seedDemoData } from "./lib/demo.js";

const MAX_UPLOAD_BYTES = Number(process.env.SHIFTLOG_MAX_UPLOAD_BYTES ?? 512_000);

type AppEnv = {
  Variables: {
    userId: string;
  };
};

function tenant(c: { get: (k: "userId") => string }): MemoryStore {
  return storeFor(c.get("userId"));
}

function corsOrigin(): string | string[] {
  const raw = process.env.SHIFTLOG_CORS_ORIGINS;
  if (!raw || raw.trim() === "*") return "*";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: corsOrigin(),
    }),
  );

  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    if (c.req.path === "/health") return;
    let userId: string | undefined;
    try {
      userId = c.get("userId");
    } catch {
      userId = undefined;
    }
    audit({
      type: "http",
      userId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  app.get("/health", (c) => c.json({ ok: true, service: "shift-log-api" }));

  app.get("/internal/cron/purge", async (c) => {
    const expected = process.env.CRON_SECRET;
    const presented =
      c.req.header("x-cron-secret") ??
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
      c.req.query("secret") ??
      "";
    if (!expected || presented !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const removed = purgeAllTenants();
    audit({ type: "retention_purge", extra: { removed } });
    return c.json({ ok: true, removed });
  });

  app.use("/v1/*", requireAuth());
  app.use("/v1/*", rateLimit());

  app.use("/v1/windows", async (c, next) => {
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES) {
      return c.json({ error: "payload_too_large", max: MAX_UPLOAD_BYTES }, 413);
    }
    await next();
  });

  app.get("/v1/permissions", (c) => c.json(tenant(c).permissions));

  app.put("/v1/permissions", async (c) => {
    const body = await c.req.json();
    const store = tenant(c);
    store.setPermissions(PermissionsConfigSchema.parse(body));
    return c.json(store.permissions);
  });

  app.post("/v1/windows", async (c) => {
    const store = tenant(c);
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

    const text = await c.req.text();
    if (Buffer.byteLength(text) > MAX_UPLOAD_BYTES) {
      return c.json({ error: "payload_too_large", max: MAX_UPLOAD_BYTES }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
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
    await summarizeTenMinuteWindow(store, upload);

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
    return c.json({ items: tenant(c).listMemories(query), next_cursor: null });
  });

  app.get("/v1/memories/:id", (c) => {
    const memory = tenant(c).getMemory(c.req.param("id"));
    if (!memory) return c.json({ error: "not_found" }, 404);
    return c.json(memory);
  });

  app.get("/v1/search", (c) => {
    const query = TimelineQuerySchema.parse({
      q: c.req.query("q") ?? "",
      limit: c.req.query("limit") ?? "50",
    });
    return c.json({ items: tenant(c).listMemories(query) });
  });

  app.post("/v1/history/delete", async (c) => {
    const body = DeleteRequestSchema.parse(await c.req.json());
    const result = tenant(c).deleteByScope(body.scope);
    return c.json({ ...result, scope: body.scope });
  });

  /** Local MVP helper: seed demo windows + enable collection. */
  app.post("/v1/demo/seed", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { enable?: boolean };
    const result = await seedDemoData({
      enable: body.enable !== false,
      store: tenant(c),
    });
    return c.json({ ok: true, ...result });
  });

  /**
   * Agent read endpoint: recent memories as working-memory context.
   * "続きやって" returns context only — does not execute (no Computer Use).
   */
  app.get("/v1/agent/recent", (c) => {
    const limit = Number(c.req.query("limit") ?? "12");
    const memories = tenant(c).listMemories({ limit: Math.min(limit, 36) });
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
    const memories = tenant(c).listMemories({ limit: body.limit });
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
