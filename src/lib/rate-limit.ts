import "server-only";
import { HttpError } from "@/lib/http";

/**
 * Fixed-window rate limits, in memory. Enough for one server; with several instances use a shared
 * store (Redis) or your edge/CDN's rate limiting. Limits protect your Banxa quota and stop code guessing.
 */

const buckets: Map<string, { count: number; resetAt: number }> = ((globalThis as { __rateLimits?: Map<string, { count: number; resetAt: number }> }).__rateLimits ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (++bucket.count > limit) throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
}

/** The client's IP. Behind a proxy or CDN, make sure it sets X-Forwarded-For and strips any value the client sent. */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
