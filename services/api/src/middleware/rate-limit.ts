import type { Context, Next } from "hono";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function resetRateLimitBuckets(): void {
  buckets.clear();
}

function limitPerMinute(): number {
  const n = Number(process.env.SHIFTLOG_RATE_LIMIT_PER_MIN ?? 60);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export function rateLimit() {
  return async (c: Context, next: Next) => {
    const userId = (c.get("userId") as string | undefined) ?? "anon";
    const now = Date.now();
    const windowMs = 60_000;
    const limit = limitPerMinute();
    let bucket = buckets.get(userId);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(userId, bucket);
    }
    bucket.count += 1;
    c.header("x-ratelimit-limit", String(limit));
    c.header("x-ratelimit-remaining", String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) {
      return c.json(
        { error: "rate_limited", message: `More than ${limit} requests per minute.` },
        429,
      );
    }
    await next();
  };
}
