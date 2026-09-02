import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { isPostgresUrl, loadTenantAsync } from "../lib/persist.js";
import { storeFor } from "../lib/store.js";

export type AuthPrincipal = {
  userId: string;
};

/**
 * Token → user mapping.
 *
 * - `SHIFTLOG_API_TOKEN` → user `default`
 * - `SHIFTLOG_API_TOKENS=alice:tok1,bob:tok2` → one tenant per user
 * - Fail-closed: if neither is set, auth refuses every request unless
 *   `SHIFTLOG_ALLOW_INSECURE_DEV=1` (maps `dev-token` → `default` and logs).
 */
export function configuredPrincipals(): Map<string, string> {
  const map = new Map<string, string>();
  const multi = process.env.SHIFTLOG_API_TOKENS ?? "";
  for (const part of multi.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    if (sep <= 0) continue;
    const userId = trimmed.slice(0, sep).trim();
    const token = trimmed.slice(sep + 1);
    if (userId && token) map.set(token, userId);
  }
  const single = process.env.SHIFTLOG_API_TOKEN;
  if (single) map.set(single, "default");
  return map;
}

export function authIsConfigured(): boolean {
  return configuredPrincipals().size > 0;
}

export function insecureDevFallbackEnabled(): boolean {
  return process.env.SHIFTLOG_ALLOW_INSECURE_DEV === "1";
}

/** Throw if the process would start without any usable token. */
export function assertAuthConfigured(): void {
  if (authIsConfigured()) return;
  if (insecureDevFallbackEnabled()) {
    console.warn(
      "[auth] SHIFTLOG_ALLOW_INSECURE_DEV=1 — accepting Bearer dev-token as user 'default'. Do not use in production.",
    );
    return;
  }
  throw new Error(
    "SHIFTLOG_API_TOKEN or SHIFTLOG_API_TOKENS must be set. Refusing to start with an implicit token (fail-closed).",
  );
}

export function resolvePrincipal(token: string): AuthPrincipal | null {
  const map = configuredPrincipals();
  if (map.size === 0 && insecureDevFallbackEnabled() && token === "dev-token") {
    return { userId: "default" };
  }
  const userId = map.get(token);
  return userId ? { userId } : null;
}

function hashesEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return ha.length === hb.length && timingSafeEqual(ha, hb);
}

/** Compare the presented bearer against configured tokens without leaking which one matched via short-circuit on the raw secret. */
export function matchConfiguredToken(presented: string): AuthPrincipal | null {
  const map = configuredPrincipals();
  if (map.size === 0 && insecureDevFallbackEnabled() && hashesEqual(presented, "dev-token")) {
    return { userId: "default" };
  }
  for (const [token, userId] of map) {
    if (hashesEqual(presented, token)) return { userId };
  }
  return null;
}

export function requireAuth() {
  return async (c: Context, next: Next) => {
    if (!authIsConfigured() && !insecureDevFallbackEnabled()) {
      return c.json(
        {
          error: "auth_not_configured",
          message: "SHIFTLOG_API_TOKEN or SHIFTLOG_API_TOKENS is required.",
        },
        503,
      );
    }
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const principal = match ? matchConfiguredToken(match[1]!) : null;
    if (!principal) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("userId", principal.userId);
    if (isPostgresUrl()) {
      const snap = await loadTenantAsync(principal.userId);
      storeFor(principal.userId).hydrate(snap);
    }
    await next();
  };
}
