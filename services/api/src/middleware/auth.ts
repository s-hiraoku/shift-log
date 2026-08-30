import type { Context, Next } from "hono";

/**
 * Simple bearer auth for v1.
 * Set SHIFTLOG_API_TOKEN in the environment. Requests must send
 * Authorization: Bearer <token>.
 */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    const expected = process.env.SHIFTLOG_API_TOKEN ?? "dev-token";
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || match[1] !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
